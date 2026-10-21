/**
 * Market data from Financial Modeling Prep: quotes, daily history (stocks, indices, FX, commodities,
 * crypto), earnings and estimates, analyst grades and targets, dividends, splits, executives, peers,
 * Treasury rates, movers, sectors, M&A and insider feeds. Every call is cached (memory, then Postgres),
 * with lifetimes matched to how often the data changes.
 */
import { cacheEntry, cacheGet, cacheSet, type CacheEntry } from "@/lib/cache";
import { withinRate } from "@/lib/locks";
import { fetchRetry, retryServerErrors } from "@/lib/net";
import type { z } from "zod";
import { budget, MARKET_STALE_IF_ERROR_MS } from "./budgets";
import { quoteTtlMs } from "./calendar";
import type { Quote as CanonicalQuote, DailyBar } from "./canonical";
import * as S from "./fmp-schema";
import { noteFreshness } from "./provenance";
import { callSource, classifyAs } from "./source";
import { SourceError } from "./source-error";
import { canonical, forFmp } from "./symbols";
import { parseOrThrow } from "./validate";

const BASE = "https://financialmodelingprep.com/stable";
const MIN = 60_000, HOUR = 60 * MIN;

export class MarketDataError extends Error {}

/**
 * The plan's daily request limit. Once FMP reports it, every call stops for 30 minutes (answers already
 * cached keep serving), so a busy terminal does not spend the next day's quota on failures.
 */
export const FMP_LIMIT_KEY = "fmp:daily-limit";
const LIMIT_MESSAGE = "The market-data plan's daily request limit is used up; it resets daily.";

/**
 * FMP's per-minute call limit (FMP_CALLS_PER_MINUTE, 250 by default: under the Starter plan's 300) counts
 * every instance's calls together, so each upstream call takes a slot in a budget kept in the database:
 * per minute, and per second at a twelfth of that so a burst cannot spend the whole minute at once. A call
 * that finds no slot within a few seconds fails as "busy" (an answer already cached keeps serving), rather
 * than going over and drawing a 429. Counting fails open (src/lib/locks).
 */
export const fmpPerMinute = () => Math.min(Math.max(Math.round(Number(process.env.FMP_CALLS_PER_MINUTE)) || 250, 10), 3_000);
export const FMP_BUSY = "Market data is busy right now. Try again in a minute.";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fmpSlot(): Promise<void> {
  const perMinute = fmpPerMinute(), perSecond = Math.max(2, Math.ceil(perMinute / 12));
  // Interactive requests give up sooner (budgets.ts): the next source answers instead.
  for (let i = 0, tries = budget().fmpSlotTries; i < tries; i++) {
    if (await withinRate("fmp:second", perSecond, 1_000)) {
      if (await withinRate("fmp:minute", perMinute, 60_000)) return;
      break;
    }
    await pause(300 + Math.random() * 400);
  }
  throw Object.assign(new MarketDataError(FMP_BUSY), { status: 503 });
}

/**
 * How FMP failed, for the fallback and the breaker (source-error.ts): its "Limit Reach" message and our own
 * budget being spent are rate limits; a plan that does not include an endpoint or symbol is "empty" (not
 * an outage); a status is kept from the cause.
 */
function classify(e: unknown): SourceError | undefined {
  if (!(e instanceof MarketDataError)) return undefined;
  if (e.message === LIMIT_MESSAGE || e.message === FMP_BUSY) return new SourceError("fmp", "rate-limit", e.message, 429, { cause: e });
  const status = (e as { upstreamStatus?: number }).upstreamStatus;
  if (status !== undefined && status >= 500) return new SourceError("fmp", "http", e.message, status, { cause: e });
  return new SourceError("fmp", "empty", e.message, status, { cause: e });
}

/**
 * One upstream request (no cache): the daily-limit flag, the shared budget, the interactive or background
 * timeout, and, given the endpoint's schema, its check: drift is FMP failing (SourceError "schema"), so it
 * counts for the breaker, is never cached, and the last good copy or the next source answers.
 */
async function fetchFmp<T>(path: string, qs: string, op: string, schema?: z.ZodType): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new MarketDataError("Market data is not set up on this server yet.");
  if (await cacheGet(FMP_LIMIT_KEY)) throw classifyAs(new MarketDataError(LIMIT_MESSAGE), new SourceError("fmp", "rate-limit", LIMIT_MESSAGE, 429));
  return callSource("fmp", op, async () => {
    await fmpSlot();
    const b = budget();
    // One retry on a network failure or a 5xx in background jobs; none on interactive paths (the next
    // source is the retry); never on 429, which is the plan's quota.
    const res = await fetchRetry(`${BASE}/${path}?${qs}${qs ? "&" : ""}apikey=${key}`, { cache: "no-store", timeoutMs: b.fmpTimeoutMs, retries: b.fmpRetries, retryOn: retryServerErrors });
    const text = await res.text();
    if (/Limit Reach/i.test(text)) { await cacheSet(FMP_LIMIT_KEY, "1", 30 * MIN); throw new MarketDataError(LIMIT_MESSAGE); }
    if (!res.ok || /^\s*(Restricted Endpoint|Premium|\{\s*"Error Message")/.test(text)) throw Object.assign(new MarketDataError("This market data is not available right now; the market-data plan may not include it."), { cause: new Error(`FMP ${res.status} for ${path}`), upstreamStatus: res.status });
    const data = JSON.parse(text) as T;
    if (schema) parseOrThrow(schema, data, "FMP", path);
    return data;
  }, { classify, label: "FMP" });
}

/**
 * Stale windows for every FMP answer: past its lifetime the last answer keeps serving for as long again
 * while one refresh runs (capped at an hour), and for a day when FMP fails, flagged stale (provenance).
 */
const staleFor = (ttlMs: number) => ({ staleMs: Math.min(ttlMs, HOUR), staleIfErrorMs: MARKET_STALE_IF_ERROR_MS });

async function getEntry<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number, schema?: z.ZodType): Promise<CacheEntry<T>> {
  if (!process.env.FMP_API_KEY) throw new MarketDataError("Market data is not set up on this server yet.");
  if (params.symbol !== undefined) params = { ...params, symbol: forFmp(String(params.symbol)) }; // FMP spells classes BRK-B; one key for every spelling
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const e = await cacheEntry<T>(`fmp:${path}?${qs}`, ttlMs, () => fetchFmp<T>(path, qs, path, schema), { shared: true, ...staleFor(ttlMs) });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number, schema?: z.ZodType): Promise<T> {
  return (await getEntry<T>(path, params, ttlMs, schema)).value;
}

/** How long quote-like data stays fresh: a minute while the NYSE session is open, longer otherwise (holidays and early closes included). */
export const quoteTtl = (at = new Date()): number => quoteTtlMs(at);

/** Validate one endpoint's answer (SourceError "schema" on drift). */
const rows = <T extends z.ZodType>(schema: T, data: unknown, endpoint: string): z.output<T> => parseOrThrow(schema, data, "FMP", endpoint);

export type Quote = S.FmpQuoteRow;
/** The latest quote (checked), or null when FMP has none; FMP's failures, drift included, are thrown (the registry falls back on them). */
export async function quoteEntry(symbol: string, ttlMs = quoteTtl()): Promise<{ quote: Quote | null; fetchedAt: number; stale: boolean }> {
  const e = await getEntry<unknown>("quote", { symbol }, ttlMs, S.QuoteRows);
  return { quote: rows(S.QuoteRows, e.value, "quote")[0] ?? null, fetchedAt: e.fetchedAt, stale: e.stale };
}
export async function quote(symbol: string, ttlMs = quoteTtl()): Promise<Quote | null> {
  return (await quoteEntry(symbol, ttlMs).catch(() => null))?.quote ?? null;
}

/** One quote in the canonical shape (fraction change, FMP's own timestamp as the as-of). */
export async function fmpQuote(symbol: string, ttlMs = quoteTtl()): Promise<CanonicalQuote | null> {
  const q = await quote(symbol, ttlMs);
  return q ? S.quoteOf(q) : null;
}

/** Quotes for several symbols in parallel (the batch endpoint is not on this plan), a few at a time. */
export async function quotes(symbols: string[], ttlMs = quoteTtl()): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const queue = [...new Set(symbols)];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) { const q = await quote(s, ttlMs).catch(() => null); if (q) out[s] = q; }
  }));
  return out;
}

export type Bar = DailyBar;

/** The start of the canonical bars range: five years back (every feature's window fits inside it). */
export const barsFrom = () => new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const BARS_TTL = 3 * HOUR;

/**
 * Daily bars for a symbol over the canonical range, oldest first: one cache key per symbol (not per
 * start date, and not per spelling: BRK.B, BRK-B and brk/b share the canonical symbol's key), so GP, the
 * boards, PORT, the news sparks and copy trading share one upstream call and each slices its own window.
 * The full endpoint covers stocks, ETFs, indices, FX, commodities and crypto; when the plan answers
 * nothing there for a symbol, the closes-only endpoint is tried once in the same load. Each answer is
 * checked (drift is SourceError "schema"). A caller asking for more than five years gets a key of its own.
 */
export async function barsEntry(symbol: string, from?: string): Promise<{ bars: Bar[]; fetchedAt: number; stale: boolean }> {
  const canonicalFrom = barsFrom();
  const start = from && from < canonicalFrom ? from : canonicalFrom;
  const sym = canonical(symbol);
  const key = start === canonicalFrom ? `fmp:bars:v1:${sym}` : `fmp:bars:v1:${sym}:${start}`;
  if (!process.env.FMP_API_KEY) throw new MarketDataError("Market data is not set up on this server yet.");
  const e = await cacheEntry<Bar[]>(key, BARS_TTL, async () => {
    const qs = `symbol=${encodeURIComponent(forFmp(sym))}&from=${start}`; // FMP spells classes BRK-B
    let bars: Bar[] = [];
    try {
      bars = rows(S.BarRows, await fetchFmp<unknown>("historical-price-eod/full", qs, "historical-price-eod/full", S.BarRows), "historical-price-eod/full").map(S.barOf);
    } catch (err) {
      // Only "the plan has nothing here" tries the closes-only endpoint; an outage, the limit, a busy budget or drift is thrown.
      const status = (err as { upstreamStatus?: number }).upstreamStatus;
      if (!(err instanceof MarketDataError) || err.message === LIMIT_MESSAGE || err.message === FMP_BUSY || (status !== undefined && status >= 500)) throw err;
    }
    if (!bars.length) bars = rows(S.LightRows, await fetchFmp<unknown>("historical-price-eod/light", qs, "historical-price-eod/light", S.LightRows), "historical-price-eod/light").map((r) => ({ date: r.date.slice(0, 10), open: r.price, high: r.price, low: r.price, close: r.price, volume: 0 }));
    return bars.filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, { shared: true, ...staleFor(BARS_TTL) });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  const since = from ?? canonicalFrom;
  return { bars: e.value.filter((b) => b.date >= since), fetchedAt: e.fetchedAt, stale: e.stale };
}

/** Daily bars, oldest first. `from` is an ISO date (default five years back). */
export async function history(symbol: string, from?: string): Promise<Bar[]> {
  return (await barsEntry(symbol, from)).bars;
}

/** Daily closes only, oldest first; works for indices, FX pairs, commodities and crypto. */
export async function closes(symbol: string, from?: string): Promise<{ date: string; close: number }[]> {
  return (await barsEntry(symbol, from)).bars.map((r) => ({ date: r.date, close: r.close }));
}

export type PriceChange = z.output<typeof S.PriceChangeRows>[number];
export async function priceChange(symbol: string): Promise<PriceChange | null> {
  const got = await get<unknown>("stock-price-change", { symbol }, quoteTtl(), S.PriceChangeRows).then((d) => rows(S.PriceChangeRows, d, "stock-price-change")).catch(() => []);
  return got[0] ?? null;
}

export type Earning = z.output<typeof S.EarningRows>[number];
/** Every report on record, upcoming first (the plan caps `limit` at 5, so none is sent). */
export const earnings = async (symbol: string): Promise<Earning[]> => rows(S.EarningRows, await get<unknown>("earnings", { symbol }, 6 * HOUR, S.EarningRows), "earnings");

export type Estimate = z.output<typeof S.EstimateRows>[number];
export const estimates = async (symbol: string, period: "annual" | "quarter" = "annual"): Promise<Estimate[]> => rows(S.EstimateRows, await get<unknown>("analyst-estimates", { symbol, period, limit: 10 }, 12 * HOUR, S.EstimateRows), "analyst-estimates");

export type Grade = z.output<typeof S.GradeRows>[number];
export const grades = async (symbol: string): Promise<Grade[]> => rows(S.GradeRows, await get<unknown>("grades", { symbol, limit: 60 }, 6 * HOUR, S.GradeRows), "grades");

export type Target = z.output<typeof S.TargetRows>[number];
export async function priceTarget(symbol: string): Promise<Target | null> {
  const got = await get<unknown>("price-target-consensus", { symbol }, 6 * HOUR, S.TargetRows).then((d) => rows(S.TargetRows, d, "price-target-consensus")).catch(() => []);
  return got[0] ?? null;
}

export type Dividend = z.output<typeof S.DividendRows>[number];
export const dividends = async (symbol: string): Promise<Dividend[]> => rows(S.DividendRows, await get<unknown>("dividends", { symbol }, 12 * HOUR, S.DividendRows), "dividends");

export type Split = z.output<typeof S.SplitRows>[number];
export const splits = async (symbol: string): Promise<Split[]> => rows(S.SplitRows, await get<unknown>("splits", { symbol }, 24 * HOUR, S.SplitRows), "splits");

export type Executive = z.output<typeof S.ExecutiveRows>[number];
export const executives = async (symbol: string): Promise<Executive[]> => rows(S.ExecutiveRows, await get<unknown>("key-executives", { symbol }, 24 * HOUR, S.ExecutiveRows), "key-executives");

export type Peer = z.output<typeof S.PeerRows>[number];
export const peers = async (symbol: string): Promise<Peer[]> => rows(S.PeerRows, await get<unknown>("stock-peers", { symbol }, 24 * HOUR, S.PeerRows), "stock-peers");

export type TreasuryRow = z.output<typeof S.TreasuryRows>[number];
export const treasury = async (from?: string, to?: string): Promise<TreasuryRow[]> => rows(S.TreasuryRows, await get<unknown>("treasury-rates", { from, to }, 2 * HOUR, S.TreasuryRows), "treasury-rates");

export type Mover = z.output<typeof S.MoverRows>[number];
export const movers = async (kind: "most-actives" | "biggest-gainers" | "biggest-losers"): Promise<Mover[]> => rows(S.MoverRows, await get<unknown>(kind, {}, 5 * MIN, S.MoverRows), kind);

export type SectorPerf = z.output<typeof S.SectorRows>[number];
export const sectorSnapshot = async (date: string): Promise<SectorPerf[]> => rows(S.SectorRows, await get<unknown>("sector-performance-snapshot", { date }, 30 * MIN, S.SectorRows), "sector-performance-snapshot");
/** Daily average change by exchange for one sector; the endpoint needs both ends of the range. */
export const sectorHistory = async (sector: string, from: string, to: string): Promise<SectorPerf[]> => rows(S.SectorRows, await get<unknown>("historical-sector-performance", { sector, from, to }, 6 * HOUR, S.SectorRows), "historical-sector-performance");

export type Deal = z.output<typeof S.DealRows>[number];
export const mergers = async (page = 0): Promise<Deal[]> => rows(S.DealRows, await get<unknown>("mergers-acquisitions-latest", { page }, 30 * MIN, S.DealRows), "mergers-acquisitions-latest");

export type EarningsEvent = z.output<typeof S.EarningsEventRows>[number];
export const earningsCalendar = async (from: string, to: string): Promise<EarningsEvent[]> => rows(S.EarningsEventRows, await get<unknown>("earnings-calendar", { from, to }, HOUR, S.EarningsEventRows), "earnings-calendar");

export type Indicator = z.output<typeof S.IndicatorRows>[number];
export const indicator = async (name: string, from?: string): Promise<Indicator[]> => rows(S.IndicatorRows, await get<unknown>("economic-indicators", { name, from }, 12 * HOUR, S.IndicatorRows), "economic-indicators");

export type RatingSnapshot = z.output<typeof S.RatingRows>[number];
export async function ratingSnapshot(symbol: string): Promise<RatingSnapshot | null> {
  const got = await get<unknown>("ratings-snapshot", { symbol }, 12 * HOUR, S.RatingRows).then((d) => rows(S.RatingRows, d, "ratings-snapshot")).catch(() => []);
  return got[0] ?? null;
}
