/**
 * Every data source, by dataset, in one place (docs/data-layer.md). Each dataset has an ordered list of
 * provider adapters; the default order is today's (FMP first, then the free backups, then AI research
 * where a screen uses it). The fallback, hedging, breakers, budgets, stale copies and telemetry run over
 * that list generically (chain.ts, source.ts, cache.ts), so adding a source is one entry here.
 *
 * A caller can reorder or trim a chain per request (`resolveChain(dataset, { prefer, exclude })`), e.g.
 * with a person's preferred sources; with no preference the default order is used. Nothing is stored per
 * person here. The adapter that answered is recorded in provenance (`sources: [{ id, label }]`).
 *
 * Some datasets are "staged": their screen runs several requests per source and merges them
 * (src/lib/terminal/street.ts for earnings, estimates, analysts and dividends; src/lib/crypto/* for
 * crypto markets and DeFi). Their adapters are listed (id, label, free, key) so the list is complete, and
 * the screens still run them in the default order.
 */
import type { CompanyFacts } from "@/lib/edgar/facts";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { getSubmissions } from "@/lib/edgar/submissions";
import { fmpProfile } from "@/lib/fmp/client";
import type { MoverRow } from "@/lib/terminal/markets";
import type { Deal } from "./fmp";
import { barsEntry, quoteEntry, type Bar } from "./fmp";
import { quoteOf } from "./fmp-schema";
import { BLS_SERIES, blsSeries, type BlsObs } from "./bls";
import { isStaleQuote } from "./calendar";
import type { Profile } from "./canonical";
import { runChain, isEmptyAnswer, type Attempt } from "./chain";
import { coinGeckoHistory, ecbPair } from "./free";
import { fredSeries, MACRO_SERIES, type Obs } from "./fred";
import { isCrypto, isFxPair, nyseSession, PROXIES } from "./kinds";
import { backupEnabled, nasdaqHistory, nasdaqQuote, nasdaqSummary } from "./nasdaq";
import { noteAdapter, noteSource, type AnsweredBy, type Provider, type SourceMeta } from "./provenance";
import { canonical } from "./symbols";
import { treasuryCurves, type CurveRow } from "./treasury";
import { barsFrom } from "./fmp";

/* ---------------- Types ---------------- */

export type ChainOptions = {
  /** Adapter ids to try first, in this order (unknown ids are ignored); the rest follow in default order. */
  prefer?: string[];
  /** Adapter ids never to use for this request. */
  exclude?: string[];
};

/** One adapter's answer: the data, plus what provenance should say about it. `label` names a stand-in in words ("S&P 500 via SPY"). */
export type Answer<R> = { data: R; note?: string; via?: string; label?: string; meta?: SourceMeta };

export type Adapter<A, R> = {
  /** Stable id (preferences and provenance use it): "fmp", "nasdaq", "sec". */
  id: string;
  /** Its name for people: "Financial Modeling Prep". */
  label: string;
  /** The provenance provider it reports as (the screen badge). */
  provider: Provider;
  /** Breaker and stats key. */
  source: string;
  /** Free to use (no paid plan behind it). */
  free: boolean;
  /** The environment variable it needs, when it needs one. */
  needsKey?: string;
  /** A backup: off when MARKET_BACKUP=off. */
  backup?: boolean;
  /** Whether it can answer these arguments at all (the ECB: currency pairs only). */
  covers?: (args: A) => boolean;
  /** The request. Null or an empty answer means "not here": the next adapter is asked. Absent on staged datasets. */
  fetch?: (args: A) => Promise<Answer<R> | null>;
  /** For a staged dataset: the module that runs it. */
  staged?: string;
};

export type { Profile };
/** A latest quote: price and the day's change as a fraction (null when the feed has none), with its as-of. */
export type LiveQuote = { price: number; changePct: number | null; asOf: string | null; source: Provider };
type BarsArgs = { symbol: string; from: string };
type Sectors = { date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[]; via?: string };
type Movers = { actives: MoverRow[]; gainers: MoverRow[]; losers: MoverRow[] };
type None = Record<string, never>;

export type Datasets = {
  "daily-bars": { args: BarsArgs; result: Bar[] };
  fx: { args: BarsArgs; result: Bar[] };
  crypto: { args: BarsArgs; result: Bar[] };
  intraday: { args: { symbol: string }; result: Bar[] };
  quote: { args: { symbol: string; ttlMs?: number }; result: LiveQuote };
  profile: { args: { symbol: string }; result: Profile };
  fundamentals: { args: { cik: string }; result: CompanyFacts };
  filings: { args: { cik: string }; result: Awaited<ReturnType<typeof getSubmissions>> };
  estimates: { args: { symbol: string }; result: unknown };
  earnings: { args: { symbol: string }; result: unknown };
  analysts: { args: { symbol: string }; result: unknown };
  dividends: { args: { symbol: string }; result: unknown };
  deals: { args: None; result: { deals: Deal[]; via?: string } };
  movers: { args: None; result: Movers };
  sectors: { args: None; result: Sectors };
  curve: { args: None; result: CurveRow[] };
  macro: { args: { series: string }; result: (Obs | BlsObs)[] };
  "crypto-market": { args: None; result: unknown };
  defi: { args: None; result: unknown };
};
export type DatasetId = keyof Datasets;
type A<D extends DatasetId> = Datasets[D]["args"];
type R<D extends DatasetId> = Datasets[D]["result"];

/* ---------------- ETF stand-ins ---------------- */

/** What each proxied symbol is, for the stand-in label ("S&P 500 via SPY"). */
const PROXY_NAMES: Record<string, string> = {
  "^GSPC": "S&P 500", "^DJI": "Dow Jones Industrial", "^IXIC": "Nasdaq Composite", "^RUT": "Russell 2000", "^GSPTSE": "S&P/TSX Composite", "^BVSP": "Bovespa",
  "^FTSE": "FTSE 100", "^GDAXI": "DAX", "^FCHI": "CAC 40", "^STOXX50E": "Euro Stoxx 50", "^N225": "Nikkei 225", "^HSI": "Hang Seng", "000001.SS": "Shanghai Composite",
  "^AXJO": "ASX 200", GCUSD: "Gold", SIUSD: "Silver", CLUSD: "WTI crude", BZUSD: "Brent crude", NGUSD: "Natural gas", HGUSD: "Copper", ZCUSX: "Corn", ZWUSX: "Wheat",
};

/** "S&P 500 via SPY": an ETF standing in for an index or commodity is never shown as its level without this. */
export const standInLabel = (symbol: string): string | undefined => (PROXIES[symbol] ? `${PROXY_NAMES[symbol] ?? symbol} via ${PROXIES[symbol]}` : undefined);

/* ---------------- Adapters ---------------- */

const asBars = (xs: { date: string; close: number }[]): Bar[] => xs.map((x) => ({ date: x.date, open: x.close, high: x.close, low: x.close, close: x.close, volume: 0 }));
const iso = (ms: number) => new Date(ms).toISOString();
/**
 * A quote's freshness: its as-of, stale when it is behind the NYSE session (calendar.ts), delayed when the
 * feed says so. Off-session quotes are not judged, and their as-of is left out of the answer's oldest as-of.
 */
const quoteMeta = (asOf: string | null, delayed: boolean | undefined, session: boolean): SourceMeta => ({ ...(asOf && session ? { asOf, stale: isStaleQuote(asOf) } : {}), ...(delayed ? { delayed } : {}) });
/** Backups fetch the canonical range (one cache key per symbol) and slice. */
const canonicalFrom = (from: string) => (from < barsFrom() ? from : barsFrom());

const FMP = { id: "fmp", label: "Financial Modeling Prep", provider: "FMP", source: "fmp", free: false, needsKey: "FMP_API_KEY" } as const;
const NASDAQ = { id: "nasdaq", label: "Nasdaq.com", provider: "Nasdaq", source: "nasdaq", free: true, backup: true } as const;
const SEC = { id: "sec", label: "SEC EDGAR", provider: "SEC EDGAR", source: "sec", free: true } as const;
const RESEARCH = { id: "ai-research", label: "AI web research", provider: "AI research", source: "ai-research", free: false, needsKey: "OPENAI_API_KEY", backup: true } as const;

const fmpBars: Adapter<BarsArgs, Bar[]> = {
  ...FMP,
  fetch: async ({ symbol, from }) => {
    const e = await barsEntry(symbol, from);
    return { data: e.bars, meta: { fetchedAt: iso(e.fetchedAt), stale: e.stale } };
  },
};

const nasdaqBars: Adapter<BarsArgs, Bar[]> = {
  ...NASDAQ,
  covers: ({ symbol }) => !isFxPair(canonical(symbol)) && !isCrypto(symbol),
  fetch: async ({ symbol, from }) => {
    const s = canonical(symbol), target = PROXIES[s] ?? s;
    const bars = (await nasdaqHistory(target, canonicalFrom(from))).filter((b) => b.date >= from);
    if (!bars.length) return null;
    // An ETF standing in for an index or commodity says so, in the data and in the sources note.
    const label = standInLabel(s);
    return { data: bars, via: PROXIES[s], label, note: label };
  },
};

const ecbBars: Adapter<BarsArgs, Bar[]> = {
  id: "ecb", label: "European Central Bank reference rates", provider: "ECB", source: "ecb", free: true, backup: true,
  covers: ({ symbol }) => isFxPair(canonical(symbol)),
  fetch: async ({ symbol, from }) => {
    const s = canonical(symbol);
    const xs = (await ecbPair(s, canonicalFrom(from))).filter((x) => x.date >= from);
    return xs.length ? { data: asBars(xs), via: "ECB fixing", note: `${s} from the ECB's daily reference rates` } : null;
  },
};

const coinGeckoBars: Adapter<BarsArgs, Bar[]> = {
  id: "coingecko", label: "CoinGecko", provider: "CoinGecko", source: "coingecko", free: true, backup: true,
  covers: ({ symbol }) => isCrypto(symbol),
  fetch: async ({ symbol, from }) => {
    const xs = (await coinGeckoHistory(canonical(symbol))).filter((x) => x.date >= from);
    return xs.length ? { data: asBars(xs) } : null;
  },
};

/** FMP's quote in the canonical units (fraction change), its own timestamp as the as-of, judged against the NYSE session when the symbol trades on it. */
const fmpQuote: Adapter<{ symbol: string; ttlMs?: number }, LiveQuote> = {
  ...FMP,
  fetch: async ({ symbol, ttlMs }) => {
    const e = await quoteEntry(symbol, ttlMs);
    if (!e.quote) return null;
    const q = quoteOf(e.quote), m = quoteMeta(q.asOf, false, nyseSession(symbol));
    return { data: { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "FMP" }, meta: { ...m, fetchedAt: iso(e.fetchedAt), stale: e.stale || !!m.stale } };
  },
};

const nasdaqQuoteAdapter: Adapter<{ symbol: string; ttlMs?: number }, LiveQuote> = {
  ...NASDAQ,
  covers: ({ symbol }) => { const s = canonical(symbol); return !isFxPair(s) && !isCrypto(s) && !PROXIES[s]; },
  fetch: async ({ symbol }) => {
    const q = await nasdaqQuote(symbol).catch(() => null);
    return q ? { data: { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "Nasdaq" }, meta: quoteMeta(q.asOf, q.delayed, true) } : null;
  },
};

/** FMP's profile (canonical shape); its as-of is when FMP answered, kept through the cache. */
const fmpProfileAdapter: Adapter<{ symbol: string }, Profile> = {
  ...FMP,
  fetch: async ({ symbol }) => {
    const p = await fmpProfile(symbol);
    return p ? { data: p, meta: { ...(p.asOf ? { asOf: p.asOf } : {}), ...(p.fetchedAt ? { fetchedAt: p.fetchedAt } : {}), stale: !!p.stale } } : null;
  },
};

/**
 * Nasdaq's quote and summary as a profile. Nasdaq has no description or website; those stay empty, and
 * missing figures stay null (never 0). The price keeps Nasdaq's own trade time as its as-of.
 */
const nasdaqProfile: Adapter<{ symbol: string }, Profile> = {
  ...NASDAQ,
  fetch: async ({ symbol }) => {
    const [q, s] = await Promise.all([nasdaqQuote(symbol).catch(() => null), nasdaqSummary(symbol).catch(() => null)]);
    if (!q) return null;
    const fetchedAt = new Date().toISOString();
    return {
      data: {
        symbol: canonical(symbol), name: q.name, price: q.price, change: q.change, changePct: q.changePct, marketCap: s?.marketCap ?? null,
        low52: s?.low52 ?? null, high52: s?.high52 ?? null, exchange: s?.exchange || q.exchange, industry: s?.industry ?? "", sector: s?.sector ?? "", website: "", description: "",
        source: "Nasdaq", asOf: q.asOf ?? fetchedAt, fetchedAt, delayed: q.delayed,
      },
      meta: quoteMeta(q.asOf ?? fetchedAt, q.delayed, true),
    };
  },
};

/** The market-wide screens' per-source requests live with the screens (lazy, so this module stays a leaf). */
const markets = () => import("@/lib/terminal/markets");

const DEFAULTS = {
  "daily-bars": [fmpBars, nasdaqBars],
  fx: [fmpBars, ecbBars],
  crypto: [fmpBars, coinGeckoBars],
  intraday: [],
  quote: [fmpQuote, nasdaqQuoteAdapter],
  profile: [fmpProfileAdapter, nasdaqProfile],
  fundamentals: [{ ...SEC, fetch: async ({ cik }) => ({ data: await getCompanyFacts(cik) }) }],
  filings: [{ ...SEC, fetch: async ({ cik }) => ({ data: await getSubmissions(cik) }) }],
  estimates: [{ ...FMP, staged: "src/lib/terminal/street.ts" }, { ...NASDAQ, staged: "src/lib/terminal/street.ts" }, { ...RESEARCH, staged: "src/lib/terminal/street.ts" }],
  earnings: [{ ...FMP, staged: "src/lib/terminal/street.ts" }, { ...NASDAQ, staged: "src/lib/terminal/street.ts" }, { ...RESEARCH, staged: "src/lib/terminal/street.ts" }],
  analysts: [{ ...FMP, staged: "src/lib/terminal/street.ts" }, { ...NASDAQ, staged: "src/lib/terminal/street.ts" }, { ...RESEARCH, staged: "src/lib/terminal/street.ts" }],
  dividends: [{ ...FMP, staged: "src/lib/terminal/street.ts" }, { ...NASDAQ, staged: "src/lib/terminal/street.ts" }, { ...SEC, staged: "src/lib/terminal/street.ts" }, { ...RESEARCH, staged: "src/lib/terminal/street.ts" }],
  deals: [
    { ...FMP, fetch: async () => { const d = await (await markets()).fmpDeals(); return d ? { data: { deals: d } } : null; } },
    { ...SEC, fetch: async () => { const d = await (await markets()).edgarDeals(); return d.length ? { data: { deals: d, via: "SEC EDGAR merger filings" }, note: "Deals from merger filings on EDGAR" } : null; } },
  ],
  movers: [
    { ...FMP, fetch: async () => { const m = await (await markets()).fmpMovers(); return m ? { data: m } : null; } },
    { ...NASDAQ, fetch: async () => { const m = await (await markets()).nasdaqMoversView(); return m ? { data: m } : null; } },
  ],
  sectors: [
    { ...FMP, fetch: async () => { const s = await (await markets()).fmpSectors(); return s ? { data: s } : null; } },
    { ...NASDAQ, label: "SPDR sector ETFs on Nasdaq.com", fetch: async () => { const s = await (await markets()).etfSectors(); return s ? { data: s, note: "Sectors via the SPDR sector ETFs" } : null; } },
  ],
  curve: [{ id: "treasury", label: "US Treasury par yield curve", provider: "US Treasury", source: "treasury", free: true, fetch: async () => ({ data: await treasuryCurves() }) }],
  macro: [
    { id: "fred", label: "FRED (St. Louis Fed)", provider: "FRED", source: "fred", free: true, covers: ({ series }) => MACRO_SERIES.some((m) => m.id === series), fetch: async ({ series }) => ({ data: await fredSeries(series) }) },
    { id: "bls", label: "Bureau of Labor Statistics", provider: "BLS", source: "bls", free: true, covers: ({ series }) => series in BLS_SERIES, fetch: async ({ series }) => ({ data: (await blsSeries())[series] ?? [] }) },
  ],
  "crypto-market": [{ id: "coingecko", label: "CoinGecko", provider: "CoinGecko", source: "coingecko", free: true, staged: "src/lib/crypto/market.ts" }],
  defi: [{ id: "defillama", label: "DefiLlama", provider: "DefiLlama", source: "defillama", free: true, staged: "src/lib/crypto/defi.ts" }],
} satisfies { [D in DatasetId]: Adapter<A<D>, R<D>>[] };

/** Every dataset's adapters in default order (read-only: preferences go through resolveChain). */
export const REGISTRY: { readonly [D in DatasetId]: readonly Adapter<A<D>, R<D>>[] } = DEFAULTS;

/** A dataset's adapters for this request: preferred ids first (in the order given), then the default order, minus exclusions. */
export function resolveChain<D extends DatasetId>(dataset: D, opts: ChainOptions = {}): Adapter<A<D>, R<D>>[] {
  const all = REGISTRY[dataset] as readonly Adapter<A<D>, R<D>>[];
  const exclude = new Set(opts.exclude ?? []);
  const first = (opts.prefer ?? []).map((id) => all.find((a) => a.id === id)).filter((a): a is Adapter<A<D>, R<D>> => !!a);
  return [...new Set([...first, ...all])].filter((a) => !exclude.has(a.id));
}

/** Nothing in the chain covers the request (every source excluded, switched off or not covering it). */
export class NoSourceError extends Error { constructor(dataset: string) { super(`No source covers ${dataset} for this`); this.name = "NoSourceError"; } }

export type Answered<R> = Answer<R> & { by: AnsweredBy; provider: Provider };

/**
 * The first valid answer for `dataset` from its chain (resolveChain), with fallback on any failure,
 * hedging on interactive requests, and the answer's source noted in provenance. Rejects with the first
 * source's own error when every source fails; with an empty-answer error when none had data.
 */
export async function fromChain<D extends DatasetId>(dataset: D, args: A<D>, opts: ChainOptions = {}): Promise<Answered<R<D>>> {
  const chain = resolveChain(dataset, opts).filter((a) => a.fetch && (!a.backup || backupEnabled()) && (!a.covers || a.covers(args)));
  if (!chain.length) throw new NoSourceError(dataset);
  const attempts: Attempt<{ a: Adapter<A<D>, R<D>>; ans: Answer<R<D>> | null }>[] = chain.map((a) => ({
    id: a.id, source: a.source, op: dataset, label: a.label, wrap: false,
    run: async () => ({ a, ans: await a.fetch!(args) }),
    valid: ({ ans }) => !!ans && (!Array.isArray(ans.data) || ans.data.length > 0),
  }));
  const { value } = await runChain(attempts);
  const { a, ans } = value;
  noteSource(a.provider, ans!.note, ans!.meta);
  noteAdapter({ id: a.id, label: a.label, provider: a.provider });
  return { ...ans!, by: { id: a.id, label: a.label }, provider: a.provider };
}

export { isEmptyAnswer };
