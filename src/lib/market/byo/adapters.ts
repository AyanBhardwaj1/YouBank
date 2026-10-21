/**
 * The adapters a person's own keys unlock, by dataset (registry.ts lists them as USER_KEY_ADAPTERS, apart
 * from the shared default chains). Each one:
 * - answers only where keyedEligibility allows (user-context.ts): that person's interactive requests,
 *   never jobs, never shared data;
 * - reads the key at fetch time (decrypted server-side, byo/store.ts) and caches the answer only in that
 *   person's own partition (byo/cache.ts), never in a shared cache;
 * - reports itself as "your key" in provenance, so screens badge it and exports leave it out.
 * Alpaca is not offered: whether its OAuth tokens may call the market-data API is not confirmed by
 * Alpaca's documentation (docs/data-layer.md).
 */
import { barsFrom } from "../fmp";
import type { Profile } from "../canonical";
import { isFxPair, nyseSession } from "../kinds";
import { quoteMeta } from "../quote-meta";
import type { Adapter, Answer, LiveQuote } from "../registry";
import { metaOf, type KeyProvider, type SourceId } from "../sources-meta";
import type { AnalystData, DividendData, EarningsData } from "../street-types";
import { canonical } from "../symbols";
import { keyFor } from "../user-context";
import { alphavantage } from "./alphavantage";
import { keyedCache } from "./cache";
import { finnhub } from "./finnhub";
import { fmpKey } from "./fmp-key";
import { tiingo } from "./tiingo";
import { twelvedata } from "./twelvedata";
import type { Provider } from "../provenance";

const MIN = 60_000, HOUR = 60 * MIN;
/** How long a keyed answer is kept in the person's own partition. */
const TTL = { quote: MIN, bars: 3 * HOUR, profile: 6 * HOUR, street: 6 * HOUR } as const;

const PROVIDER: Record<KeyProvider, Provider> = { tiingo: "Tiingo", twelvedata: "Twelve Data", alphavantage: "Alpha Vantage", finnhub: "Finnhub", fmp: "FMP (your key)" };

type Bars = { symbol: string; from: string };
type Sym = { symbol: string };
type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
const BAR_FIELDS = ["open", "high", "low", "close", "volume"];

/** The empty answers ("nothing here"): null, an empty list. */
const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * A keyed adapter: the catalogue's metadata for `id`, and a fetch that reads the person's key, asks the
 * provider (through their own cache partition) and marks the answer as theirs.
 */
function keyed<A, R>(id: SourceId, fields: string[], ttlMs: number, what: (a: A) => string, load: (key: string, a: A) => Promise<R | null>, finish?: (r: R, a: A) => Answer<R>): Adapter<A, R> {
  const m = metaOf(id), p = m.keyProvider!;
  return {
    ...m, provider: PROVIDER[p], source: id, free: false, fields,
    fetch: async (a) => {
      const k = await keyFor(p);
      if (!k) return null;
      const { value, fetchedAt } = await keyedCache(k.userId, p, `${id}:${what(a)}`, ttlMs, () => load(k.key, a));
      if (empty(value)) return null;
      const base = finish ? finish(value as R, a) : { data: value as R };
      return { ...base, meta: { ...base.meta, fetchedAt: new Date(fetchedAt).toISOString() }, yourKey: true };
    },
  };
}

/** Bars over the canonical range (one partition entry per symbol), sliced to the caller's start. */
const bars = (id: SourceId, load: (key: string, symbol: string, from: string) => Promise<Bar[]>, covers?: (a: Bars) => boolean): Adapter<Bars, Bar[]> => ({
  ...keyed<Bars, Bar[]>(id, BAR_FIELDS, TTL.bars, (a) => `bars:${canonical(a.symbol)}`, (key, a) => load(key, a.symbol, barsFrom()), (r, a) => ({ data: r.filter((b) => b.date >= a.from) })),
  ...(covers ? { covers } : {}),
});

const quote = (id: SourceId, load: (key: string, symbol: string) => Promise<LiveQuote | null>, note?: string): Adapter<Sym & { ttlMs?: number }, LiveQuote> =>
  keyed(id, ["price", "changePct"], TTL.quote, (a) => `quote:${canonical(a.symbol)}`, (key, a) => load(key, a.symbol), (q, a) => ({ data: q, meta: quoteMeta(q.asOf, false, nyseSession(a.symbol)), ...(note ? { note } : {}) }));

const profile = (id: SourceId, fields: string[], load: (key: string, symbol: string) => Promise<Profile | null>): Adapter<Sym, Profile> =>
  keyed(id, fields, TTL.profile, (a) => `profile:${canonical(a.symbol)}`, (key, a) => load(key, a.symbol));

const street = <R>(id: SourceId, fields: string[], kind: string, load: (key: string, symbol: string) => Promise<R | null>): Adapter<Sym, R> =>
  keyed(id, fields, TTL.street, (a) => `${kind}:${canonical(a.symbol)}`, (key, a) => load(key, a.symbol));

const fx = (a: Bars) => isFxPair(canonical(a.symbol));
const notFx = (a: Bars) => !fx(a);
const PROFILE_FIELDS = ["name", "exchange", "description"];

export const USER_KEY_ADAPTERS = {
  "daily-bars": [bars("tiingo", tiingo.bars, notFx), bars("twelvedata", twelvedata.bars, notFx), bars("alphavantage", (k, s) => alphavantage.bars(k, s), notFx), bars("fmp-key", fmpKey.bars, notFx)],
  fx: [bars("twelvedata", twelvedata.bars, fx), bars("alphavantage", (k, s) => alphavantage.bars(k, s), fx), bars("fmp-key", fmpKey.bars, fx)],
  quote: [quote("tiingo", tiingo.quote, "Real time from IEX only, not the consolidated tape"), quote("twelvedata", twelvedata.quote), quote("finnhub", finnhub.quote), quote("alphavantage", alphavantage.quote, "Alpha Vantage's free quote is the latest close"), quote("fmp-key", fmpKey.quote)],
  profile: [
    profile("fmp-key", ["name", "price", "changePct", "marketCap", "low52", "high52", "exchange", "sector", "industry", "description", "website"], fmpKey.profile),
    profile("alphavantage", ["name", "marketCap", "low52", "high52", "exchange", "sector", "industry", "description"], alphavantage.profile),
    profile("finnhub", ["name", "marketCap", "exchange", "industry", "website"], finnhub.profile),
    profile("tiingo", PROFILE_FIELDS, tiingo.profile),
  ],
  earnings: [street<EarningsData>("fmp-key", ["quarters", "next"], "earnings", fmpKey.earnings), street<EarningsData>("finnhub", ["quarters"], "earnings", finnhub.earnings), street<EarningsData>("alphavantage", ["quarters"], "earnings", alphavantage.earnings)],
  analysts: [street<AnalystData>("fmp-key", ["target", "firms"], "analysts", fmpKey.analysts), street<AnalystData>("finnhub", ["counts"], "analysts", finnhub.analysts)],
  dividends: [street<DividendData>("fmp-key", ["payments"], "dividends", fmpKey.dividends), street<DividendData>("alphavantage", ["payments"], "dividends", alphavantage.dividends)],
};

/** Each provider's key check: one cheap call that only succeeds with a working key. */
export const KEY_TESTS: Record<KeyProvider, (key: string) => Promise<boolean>> = {
  tiingo: tiingo.test, twelvedata: twelvedata.test, alphavantage: alphavantage.test, finnhub: finnhub.test, fmp: fmpKey.test,
};
