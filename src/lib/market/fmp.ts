/**
 * Market data from Financial Modeling Prep: quotes, daily history (stocks, indices, FX, commodities,
 * crypto), earnings and estimates, analyst grades and targets, dividends, splits, executives, peers,
 * Treasury rates, movers, sectors, M&A and insider feeds. Every call is cached (memory, then Postgres),
 * with lifetimes matched to how often the data changes.
 */
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";

const BASE = "https://financialmodelingprep.com/stable";
const MIN = 60_000, HOUR = 60 * MIN;

export class MarketDataError extends Error {}

/**
 * The plan's daily request limit. Once FMP reports it, every call stops for 30 minutes (answers already
 * cached keep serving), so a busy terminal does not spend the next day's quota on failures.
 */
export const FMP_LIMIT_KEY = "fmp:daily-limit";
const LIMIT_MESSAGE = "The market-data plan's daily request limit is used up; it resets daily.";

async function get<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new MarketDataError("Market data is not configured (FMP_API_KEY).");
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const cacheKey = `fmp:${path}?${qs}`;
  return cacheJson<T>(cacheKey, ttlMs, async () => {
    if (await cacheGet(FMP_LIMIT_KEY)) throw new MarketDataError(LIMIT_MESSAGE);
    const res = await fetch(`${BASE}/${path}?${qs}${qs ? "&" : ""}apikey=${key}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    if (/Limit Reach/i.test(text)) { await cacheSet(FMP_LIMIT_KEY, "1", 30 * MIN); throw new MarketDataError(LIMIT_MESSAGE); }
    if (!res.ok || /^\s*(Restricted Endpoint|Premium|\{\s*"Error Message")/.test(text)) throw new MarketDataError(`Market data unavailable for ${path}`);
    return JSON.parse(text) as T;
  });
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
export async function quote(symbol: string, ttlMs = quoteTtl()): Promise<Quote | null> {
  const rows = await get<Quote[]>("quote", { symbol }, ttlMs).catch(() => []);
  return rows[0] ?? null;
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

/** Daily bars, oldest first. `from` is an ISO date (default five years back). */
export async function history(symbol: string, from?: string): Promise<Bar[]> {
  const start = from ?? new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const rows = await get<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]>("historical-price-eod/full", { symbol, from: start }, 3 * HOUR);
  return rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })).filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Daily closes only (lighter), oldest first; works for indices, FX pairs, commodities and crypto. */
export async function closes(symbol: string, from?: string): Promise<{ date: string; close: number }[]> {
  const start = from ?? new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const rows = await get<{ date: string; price: number }[]>("historical-price-eod/light", { symbol, from: start }, 3 * HOUR);
  return rows.map((r) => ({ date: r.date, close: r.price })).filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
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
