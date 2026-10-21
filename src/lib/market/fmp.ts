/**
 * Market data from Financial Modeling Prep: quotes, daily history (stocks, indices, FX, commodities,
 * crypto), earnings and estimates, analyst grades and targets, dividends, splits, executives, peers,
 * Treasury rates, movers, sectors, M&A and insider feeds. Every call is cached (memory, then Postgres),
 * with lifetimes matched to how often the data changes.
 */
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { withinRate } from "@/lib/locks";
import { fetchRetry, retryServerErrors } from "@/lib/net";
import type { z } from "zod";
import { quoteTtlMs } from "./calendar";
import type { Quote as CanonicalQuote, DailyBar } from "./canonical";
import * as S from "./fmp-schema";
import { forFmp } from "./symbols";
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
  for (let i = 0; i < 10; i++) {
    if (await withinRate("fmp:second", perSecond, 1_000)) {
      if (await withinRate("fmp:minute", perMinute, 60_000)) return;
      break;
    }
    await pause(300 + Math.random() * 400);
  }
  throw Object.assign(new MarketDataError(FMP_BUSY), { status: 503 });
}

async function get<T>(path: string, params: Record<string, string | number | undefined>, ttlMs: number): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new MarketDataError("Market data is not set up on this server yet.");
  if (params.symbol !== undefined) params = { ...params, symbol: forFmp(String(params.symbol)) }; // FMP spells classes BRK-B
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const cacheKey = `fmp:${path}?${qs}`;
  return cacheJson<T>(cacheKey, ttlMs, async () => {
    if (await cacheGet(FMP_LIMIT_KEY)) throw new MarketDataError(LIMIT_MESSAGE);
    await fmpSlot();
    // One retry on a network failure or a 5xx; never on 429, which is the plan's quota.
    const res = await fetchRetry(`${BASE}/${path}?${qs}${qs ? "&" : ""}apikey=${key}`, { cache: "no-store", timeoutMs: 10_000, retryOn: retryServerErrors });
    const text = await res.text();
    if (/Limit Reach/i.test(text)) { await cacheSet(FMP_LIMIT_KEY, "1", 30 * MIN); throw new MarketDataError(LIMIT_MESSAGE); }
    if (!res.ok || /^\s*(Restricted Endpoint|Premium|\{\s*"Error Message")/.test(text)) throw Object.assign(new MarketDataError("This market data is not available right now; the market-data plan may not include it."), { cause: new Error(`FMP ${res.status} for ${path}`) });
    return JSON.parse(text) as T;
  }, { shared: true });
}

/** How long quote-like data stays fresh: a minute while the NYSE session is open, longer otherwise (holidays and early closes included). */
export const quoteTtl = (at = new Date()): number => quoteTtlMs(at);

/** Validate one endpoint's answer (SourceError "schema" on drift). */
const rows = <T extends z.ZodType>(schema: T, data: unknown, endpoint: string): z.output<T> => parseOrThrow(schema, data, "FMP", endpoint);

export type Quote = S.FmpQuoteRow;
export async function quote(symbol: string, ttlMs = quoteTtl()): Promise<Quote | null> {
  const got = await get<unknown>("quote", { symbol }, ttlMs).then((d) => rows(S.QuoteRows, d, "quote")).catch(() => []);
  return got[0] ?? null;
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

/** Daily bars, oldest first. `from` is an ISO date (default five years back). */
export async function history(symbol: string, from?: string): Promise<Bar[]> {
  const start = from ?? new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const data = rows(S.BarRows, await get<unknown>("historical-price-eod/full", { symbol, from: start }, 3 * HOUR), "historical-price-eod/full");
  return data.map(S.barOf).filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Daily closes only (lighter), oldest first; works for indices, FX pairs, commodities and crypto. */
export async function closes(symbol: string, from?: string): Promise<{ date: string; close: number }[]> {
  const start = from ?? new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const data = rows(S.LightRows, await get<unknown>("historical-price-eod/light", { symbol, from: start }, 3 * HOUR), "historical-price-eod/light");
  return data.map((r) => ({ date: r.date.slice(0, 10), close: r.price })).filter((r) => r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type PriceChange = z.output<typeof S.PriceChangeRows>[number];
export async function priceChange(symbol: string): Promise<PriceChange | null> {
  const got = await get<unknown>("stock-price-change", { symbol }, quoteTtl()).then((d) => rows(S.PriceChangeRows, d, "stock-price-change")).catch(() => []);
  return got[0] ?? null;
}

export type Earning = z.output<typeof S.EarningRows>[number];
/** Every report on record, upcoming first (the plan caps `limit` at 5, so none is sent). */
export const earnings = async (symbol: string): Promise<Earning[]> => rows(S.EarningRows, await get<unknown>("earnings", { symbol }, 6 * HOUR), "earnings");

export type Estimate = z.output<typeof S.EstimateRows>[number];
export const estimates = async (symbol: string, period: "annual" | "quarter" = "annual"): Promise<Estimate[]> => rows(S.EstimateRows, await get<unknown>("analyst-estimates", { symbol, period, limit: 10 }, 12 * HOUR), "analyst-estimates");

export type Grade = z.output<typeof S.GradeRows>[number];
export const grades = async (symbol: string): Promise<Grade[]> => rows(S.GradeRows, await get<unknown>("grades", { symbol, limit: 60 }, 6 * HOUR), "grades");

export type Target = z.output<typeof S.TargetRows>[number];
export async function priceTarget(symbol: string): Promise<Target | null> {
  const got = await get<unknown>("price-target-consensus", { symbol }, 6 * HOUR).then((d) => rows(S.TargetRows, d, "price-target-consensus")).catch(() => []);
  return got[0] ?? null;
}

export type Dividend = z.output<typeof S.DividendRows>[number];
export const dividends = async (symbol: string): Promise<Dividend[]> => rows(S.DividendRows, await get<unknown>("dividends", { symbol }, 12 * HOUR), "dividends");

export type Split = z.output<typeof S.SplitRows>[number];
export const splits = async (symbol: string): Promise<Split[]> => rows(S.SplitRows, await get<unknown>("splits", { symbol }, 24 * HOUR), "splits");

export type Executive = z.output<typeof S.ExecutiveRows>[number];
export const executives = async (symbol: string): Promise<Executive[]> => rows(S.ExecutiveRows, await get<unknown>("key-executives", { symbol }, 24 * HOUR), "key-executives");

export type Peer = z.output<typeof S.PeerRows>[number];
export const peers = async (symbol: string): Promise<Peer[]> => rows(S.PeerRows, await get<unknown>("stock-peers", { symbol }, 24 * HOUR), "stock-peers");

export type TreasuryRow = z.output<typeof S.TreasuryRows>[number];
export const treasury = async (from?: string, to?: string): Promise<TreasuryRow[]> => rows(S.TreasuryRows, await get<unknown>("treasury-rates", { from, to }, 2 * HOUR), "treasury-rates");

export type Mover = z.output<typeof S.MoverRows>[number];
export const movers = async (kind: "most-actives" | "biggest-gainers" | "biggest-losers"): Promise<Mover[]> => rows(S.MoverRows, await get<unknown>(kind, {}, 5 * MIN), kind);

export type SectorPerf = z.output<typeof S.SectorRows>[number];
export const sectorSnapshot = async (date: string): Promise<SectorPerf[]> => rows(S.SectorRows, await get<unknown>("sector-performance-snapshot", { date }, 30 * MIN), "sector-performance-snapshot");
/** Daily average change by exchange for one sector; the endpoint needs both ends of the range. */
export const sectorHistory = async (sector: string, from: string, to: string): Promise<SectorPerf[]> => rows(S.SectorRows, await get<unknown>("historical-sector-performance", { sector, from, to }, 6 * HOUR), "historical-sector-performance");

export type Deal = z.output<typeof S.DealRows>[number];
export const mergers = async (page = 0): Promise<Deal[]> => rows(S.DealRows, await get<unknown>("mergers-acquisitions-latest", { page }, 30 * MIN), "mergers-acquisitions-latest");

export type EarningsEvent = z.output<typeof S.EarningsEventRows>[number];
export const earningsCalendar = async (from: string, to: string): Promise<EarningsEvent[]> => rows(S.EarningsEventRows, await get<unknown>("earnings-calendar", { from, to }, HOUR), "earnings-calendar");

export type Indicator = z.output<typeof S.IndicatorRows>[number];
export const indicator = async (name: string, from?: string): Promise<Indicator[]> => rows(S.IndicatorRows, await get<unknown>("economic-indicators", { name, from }, 12 * HOUR), "economic-indicators");

export type RatingSnapshot = z.output<typeof S.RatingRows>[number];
export async function ratingSnapshot(symbol: string): Promise<RatingSnapshot | null> {
  const got = await get<unknown>("ratings-snapshot", { symbol }, 12 * HOUR).then((d) => rows(S.RatingRows, d, "ratings-snapshot")).catch(() => []);
  return got[0] ?? null;
}
