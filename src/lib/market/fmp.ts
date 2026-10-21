/**
 * Market data from Financial Modeling Prep: quotes, daily history (stocks, indices, FX, commodities,
 * crypto), earnings and estimates, analyst grades and targets, dividends, splits, executives, peers,
 * Treasury rates, movers, sectors, M&A and insider feeds. Every call is cached (memory, then Postgres),
 * with lifetimes matched to how often the data changes.
 */
import { cacheEntry, cacheGet, cacheSet, type CacheEntry } from "@/lib/cache";
import { withinRate } from "@/lib/locks";
import { fetchRetry, retryServerErrors } from "@/lib/net";
import { budget, MARKET_STALE_IF_ERROR_MS } from "./budgets";
import { noteFreshness } from "./provenance";
import { callSource, classifyAs } from "./source";
import { SourceError } from "./source-error";

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

/** One upstream request (no cache): the daily-limit flag, the shared budget, the interactive or background timeout. */
async function fetchFmp<T>(path: string, qs: string, op: string): Promise<T> {
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
    return JSON.parse(text) as T;
  }, { classify, label: "FMP" });
}

/**
 * Stale windows for every FMP answer: past its lifetime the last answer keeps serving for as long again
 * while one refresh runs (capped at an hour), and for a day when FMP fails, flagged stale (provenance).
 */
const staleFor = (ttlMs: number) => ({ staleMs: Math.min(ttlMs, HOUR), staleIfErrorMs: MARKET_STALE_IF_ERROR_MS });

async function getEntry<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number, cacheKey?: string): Promise<CacheEntry<T>> {
  if (!process.env.FMP_API_KEY) throw new MarketDataError("Market data is not set up on this server yet.");
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const e = await cacheEntry<T>(cacheKey ?? `fmp:${path}?${qs}`, ttlMs, () => fetchFmp<T>(path, qs, path), { shared: true, ...staleFor(ttlMs) });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number): Promise<T> {
  return (await getEntry<T>(path, params, ttlMs)).value;
}

/** How long quote-like data stays fresh: a minute while US markets are open, longer otherwise. */
function quoteTtl(): number {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins <= 960 ? MIN : 30 * MIN;
}

export type Quote = {
  symbol: string; name: string; price: number; changePercentage: number; change: number; volume: number;
  dayLow: number; dayHigh: number; yearHigh: number; yearLow: number; marketCap: number; priceAvg50: number; priceAvg200: number;
  exchange: string; open: number; previousClose: number; timestamp: number;
};
/** The latest quote, or null when FMP has none; FMP's failures are thrown (the registry falls back on them). */
export async function quoteEntry(symbol: string, ttlMs = quoteTtl()): Promise<{ quote: Quote | null; fetchedAt: number; stale: boolean }> {
  const e = await getEntry<Quote[]>("quote", { symbol }, ttlMs);
  return { quote: e.value?.[0] ?? null, fetchedAt: e.fetchedAt, stale: e.stale };
}
export async function quote(symbol: string, ttlMs = quoteTtl()): Promise<Quote | null> {
  return (await quoteEntry(symbol, ttlMs).catch(() => null))?.quote ?? null;
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

export type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** The start of the canonical bars range: five years back (every feature's window fits inside it). */
export const barsFrom = () => new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const BARS_TTL = 3 * HOUR;
type FullRow = { date: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * Daily bars for a symbol over the canonical range, oldest first: one cache key per symbol (not per
 * start date), so GP, the boards, PORT, the news sparks and copy trading share one upstream call and
 * each slices its own window. The full endpoint covers stocks, ETFs, indices, FX, commodities and crypto;
 * when the plan answers nothing there for a symbol, the closes-only endpoint is tried once in the same
 * load. A caller asking for more than five years gets a key of its own.
 */
export async function barsEntry(symbol: string, from?: string): Promise<{ bars: Bar[]; fetchedAt: number; stale: boolean }> {
  const canonical = barsFrom();
  const start = from && from < canonical ? from : canonical;
  const key = start === canonical ? `fmp:bars:v1:${symbol}` : `fmp:bars:v1:${symbol}:${start}`;
  if (!process.env.FMP_API_KEY) throw new MarketDataError("Market data is not set up on this server yet.");
  const e = await cacheEntry<Bar[]>(key, BARS_TTL, async () => {
    const qs = `symbol=${encodeURIComponent(symbol)}&from=${start}`;
    let rows: Bar[] = [];
    try {
      rows = (await fetchFmp<FullRow[]>("historical-price-eod/full", qs, "historical-price-eod/full")).map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    } catch (err) {
      if (!(err instanceof MarketDataError) || err.message === LIMIT_MESSAGE || err.message === FMP_BUSY) throw err;
    }
    if (!rows.length) rows = (await fetchFmp<{ date: string; price: number }[]>("historical-price-eod/light", qs, "historical-price-eod/light")).map((r) => ({ date: r.date, open: r.price, high: r.price, low: r.price, close: r.price, volume: 0 }));
    return rows.filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, { shared: true, ...staleFor(BARS_TTL) });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  const since = from ?? canonical;
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

export type PriceChange = Record<"1D" | "5D" | "1M" | "3M" | "6M" | "ytd" | "1Y" | "3Y" | "5Y" | "10Y" | "max", number>;
export async function priceChange(symbol: string): Promise<PriceChange | null> {
  const rows = await get<(PriceChange & { symbol: string })[]>("stock-price-change", { symbol }, quoteTtl()).catch(() => []);
  return rows[0] ?? null;
}

export type Earning = { date: string; epsActual: number | null; epsEstimated: number | null; revenueActual: number | null; revenueEstimated: number | null };
/** Every report on record, upcoming first (the plan caps `limit` at 5, so none is sent). */
export const earnings = (symbol: string) => get<Earning[]>("earnings", { symbol }, 6 * HOUR);

export type Estimate = {
  date: string; revenueLow: number; revenueHigh: number; revenueAvg: number; ebitdaAvg: number; ebitAvg: number; netIncomeAvg: number;
  epsAvg: number; epsHigh: number; epsLow: number; numAnalystsRevenue: number; numAnalystsEps: number;
};
export const estimates = (symbol: string, period: "annual" | "quarter" = "annual") => get<Estimate[]>("analyst-estimates", { symbol, period, limit: 10 }, 12 * HOUR);

export type Grade = { date: string; gradingCompany: string; previousGrade: string; newGrade: string; action: string };
export const grades = (symbol: string) => get<Grade[]>("grades", { symbol, limit: 60 }, 6 * HOUR);

export type Target = { targetHigh: number; targetLow: number; targetConsensus: number; targetMedian: number };
export async function priceTarget(symbol: string): Promise<Target | null> {
  const rows = await get<Target[]>("price-target-consensus", { symbol }, 6 * HOUR).catch(() => []);
  return rows[0] ?? null;
}

export type Dividend = { date: string; recordDate: string; paymentDate: string; declarationDate: string; adjDividend: number; dividend: number; yield: number; frequency: string };
export const dividends = (symbol: string) => get<Dividend[]>("dividends", { symbol }, 12 * HOUR);

export type Split = { date: string; numerator: number; denominator: number };
export const splits = (symbol: string) => get<Split[]>("splits", { symbol }, 24 * HOUR);

export type Executive = { title: string; name: string; pay: number | null; currencyPay: string; gender: string; yearBorn: number | null; active: boolean | null };
export const executives = (symbol: string) => get<Executive[]>("key-executives", { symbol }, 24 * HOUR);

export type Peer = { symbol: string; companyName: string; price: number; mktCap: number };
export const peers = (symbol: string) => get<Peer[]>("stock-peers", { symbol }, 24 * HOUR);

export type TreasuryRow = { date: string; month1: number; month2: number; month3: number; month6: number; year1: number; year2: number; year3: number; year5: number; year7: number; year10: number; year20: number; year30: number };
export const treasury = (from?: string, to?: string) => get<TreasuryRow[]>("treasury-rates", { from, to }, 2 * HOUR);

export type Mover = { symbol: string; price: number; name: string; change: number; changesPercentage: number; exchange: string };
export const movers = (kind: "most-actives" | "biggest-gainers" | "biggest-losers") => get<Mover[]>(kind, {}, 5 * MIN);

export type SectorPerf = { date: string; sector: string; exchange: string; averageChange: number };
export const sectorSnapshot = (date: string) => get<SectorPerf[]>("sector-performance-snapshot", { date }, 30 * MIN);
/** Daily average change by exchange for one sector; the endpoint needs both ends of the range. */
export const sectorHistory = (sector: string, from: string, to: string) => get<SectorPerf[]>("historical-sector-performance", { sector, from, to }, 6 * HOUR);

export type Deal = { symbol: string; companyName: string; cik: string; targetedCompanyName: string; targetedCik: string; targetedSymbol: string; transactionDate: string; acceptedDate: string; link: string };
export const mergers = (page = 0) => get<Deal[]>("mergers-acquisitions-latest", { page }, 30 * MIN);

export type EarningsEvent = { symbol: string; date: string; epsActual: number | null; epsEstimated: number | null; revenueActual: number | null; revenueEstimated: number | null };
export const earningsCalendar = (from: string, to: string) => get<EarningsEvent[]>("earnings-calendar", { from, to }, HOUR);

export type Indicator = { name: string; date: string; value: number };
export const indicator = (name: string, from?: string) => get<Indicator[]>("economic-indicators", { name, from }, 12 * HOUR);

export type RatingSnapshot = { symbol: string; rating: string; overallScore: number; discountedCashFlowScore: number; returnOnEquityScore: number; returnOnAssetsScore: number; debtToEquityScore: number; priceToEarningsScore: number; priceToBookScore: number };
export async function ratingSnapshot(symbol: string): Promise<RatingSnapshot | null> {
  const rows = await get<RatingSnapshot[]>("ratings-snapshot", { symbol }, 12 * HOUR).catch(() => []);
  return rows[0] ?? null;
}
