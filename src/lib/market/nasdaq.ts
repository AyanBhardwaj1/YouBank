/**
 * Nasdaq.com's quote API: the first backup when FMP is out (its daily limit) or does not cover a symbol
 * (the free plan's prices stop at about 87 tickers). No key. It covers every US-listed stock and ETF,
 * NYSE included: daily history, quotes, a summary (market cap, 52-week range, dividend), dividend
 * history, earnings surprises and dates, EPS forecasts, analyst targets and ratings, and the day's movers.
 *
 * It is the API behind nasdaq.com, not a licensed feed: Nasdaq's site terms are for personal use. It is
 * a backup for the free beta, switched off everywhere with MARKET_BACKUP=off; a paid plan (FMP Starter
 * and its display licence) is the answer before charging users.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchRetry, retryServerErrors } from "@/lib/net";
import type { z } from "zod";
import { marketDate, parseEtStamp } from "./calendar";
import { isoDay, pctToFraction, toNumber, type DailyBar, type Quote } from "./canonical";
import * as S from "./nasdaq-schema";
import { forNasdaq } from "./symbols";
import { parseOrThrow } from "./validate";

export const BASE = "https://api.nasdaq.com/api";
/** The headers a browser on nasdaq.com sends; without them the API refuses or hangs. */
export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};
const MIN = 60_000, HOUR = 60 * MIN;

/** Backups (Nasdaq, AI research) are on unless MARKET_BACKUP=off. */
export const backupEnabled = () => (process.env.MARKET_BACKUP ?? "on").trim().toLowerCase() !== "off";

/** One GET, cached: answers for `ttlMs`, failures for five minutes (so a hiccup does not stick for hours). */
async function get<T>(path: string, ttlMs: number): Promise<T | null> {
  if (!backupEnabled()) return null;
  const key = `nasdaq:${path}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T | null;
  let data: T | null = null;
  try {
    // A 429 here is Nasdaq throttling us: not repeated. A network failure or a 5xx gets one more try.
    const res = await fetchRetry(`${BASE}${path}`, { headers: HEADERS, cache: "no-store", timeoutMs: 12_000, retryOn: retryServerErrors });
    if (res.ok) data = ((await res.json()) as { data?: T | null })?.data ?? null;
  } catch { /* network, timeout or a blocked request */ }
  await cacheSet(key, JSON.stringify(data), data ? ttlMs : 5 * MIN);
  return data;
}

/* ---------------- Parsing ---------------- */

/** "$1,234.56", "+0.58%", "30,002,768", "N/A" -> number or null. */
export const num = toNumber;

/** "09/25/2026", "9/5/2026", "Aug 10, 2026" -> "2026-09-25"; anything else -> null. */
export const isoDate = isoDay;

/** The symbol as Nasdaq spells it (BRK.B), for a URL path. */
const sym = (symbol: string) => encodeURIComponent(forNasdaq(symbol));

/** One endpoint's `data`, checked: null stays null (Nasdaq has nothing), anything else must match. */
const check = <T extends z.ZodType>(schema: T, data: unknown, endpoint: string): z.output<T> | null => (data === null || data === undefined ? null : parseOrThrow(schema, data, "Nasdaq", endpoint));

/* ---------------- History and quotes ---------------- */

export type AssetClass = "stocks" | "etf";
export type NasdaqBar = DailyBar;

/** Which asset class a symbol answers to (stocks first, then ETFs), remembered for a day. */
async function assetClassOf(symbol: string): Promise<AssetClass | null> {
  const key = `nasdaq:class:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit === "none" ? null : (hit as AssetClass);
  for (const c of ["stocks", "etf"] as const) {
    const info = await get<{ symbol?: string; primaryData?: { lastSalePrice?: string } }>(`/quote/${sym(symbol)}/info?assetclass=${c}`, 15 * MIN);
    if (info?.primaryData && num(info.primaryData.lastSalePrice) !== null) { await cacheSet(key, c, 24 * HOUR); return c; }
  }
  await cacheSet(key, "none", 30 * MIN);
  return null;
}

/** Daily bars, oldest first, from `from` (ISO) to today. */
export async function nasdaqHistory(symbol: string, from: string): Promise<NasdaqBar[]> {
  const cls = await assetClassOf(symbol);
  if (!cls) return [];
  const to = marketDate();
  const d = check(S.Historical, await get<unknown>(`/quote/${sym(symbol)}/historical?assetclass=${cls}&fromdate=${from}&limit=9999&todate=${to}`, 3 * HOUR), "historical");
  return (d?.tradesTable?.rows ?? []).map(barOf).filter((b): b is DailyBar => b !== null).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** One history row as a bar; a missing open, high or low is the close (a closes-only day), never NaN. */
function barOf(r: { date: string; close: string; open?: unknown; high?: unknown; low?: unknown; volume?: unknown }): DailyBar | null {
  const date = isoDate(r.date), close = num(r.close);
  if (!date || close === null || close <= 0) return null;
  return { date, open: num(r.open) ?? close, high: num(r.high) ?? close, low: num(r.low) ?? close, close, volume: num(r.volume) ?? 0 };
}

export type NasdaqQuote = Quote;

/** A quote in the canonical shape: fraction change, the last trade's time (New York) as the as-of, delayed unless Nasdaq says real time. */
export async function nasdaqQuote(symbol: string): Promise<NasdaqQuote | null> {
  const cls = await assetClassOf(symbol);
  if (!cls) return null;
  const d = check(S.Info, await get<unknown>(`/quote/${sym(symbol)}/info?assetclass=${cls}`, 5 * MIN), "info");
  const p = d?.primaryData;
  const price = num(p?.lastSalePrice);
  if (!d || !p || price === null) return null;
  return {
    symbol: d.symbol, name: d.companyName.replace(/ (Common Stock|Class [A-C] Common Stock|Ordinary Shares).*$/i, ""), price,
    change: num(p.netChange), changePct: pctToFraction(p.percentageChange), volume: num(p.volume), previousClose: null, exchange: d.exchange,
    source: "Nasdaq", asOf: parseEtStamp(p.lastTradeTimestamp), delayed: !p.isRealTime,
  };
}

export type NasdaqSummary = { marketCap: number | null; high52: number | null; low52: number | null; previousClose: number | null; target1y: number | null; annualDividend: number | null; exDividendDate: string | null; yield: number | null; sector: string; industry: string; exchange: string };

export async function nasdaqSummary(symbol: string): Promise<NasdaqSummary | null> {
  const cls = await assetClassOf(symbol);
  if (!cls) return null;
  const d = check(S.Summary, await get<unknown>(`/quote/${sym(symbol)}/summary?assetclass=${cls}`, 30 * MIN), "summary");
  const s = d?.summaryData;
  if (!s) return null;
  const v = (k: string) => { const x = s[k]?.value; return x === null || x === undefined ? undefined : String(x); };
  const [hi, lo] = (v("FiftTwoWeekHighLow") ?? v("FiftyTwoWeekHighLow") ?? "").split("/").map(num);
  return {
    marketCap: num(v("MarketCap")), high52: hi ?? null, low52: lo ?? null, previousClose: num(v("PreviousClose")), target1y: num(v("OneYrTarget")),
    annualDividend: num(v("AnnualizedDividend")), exDividendDate: isoDate(v("ExDividendDate")), yield: pctToFraction(v("Yield")),
    sector: v("Sector") ?? "", industry: v("Industry") ?? "", exchange: v("Exchange") ?? "",
  };
}

/* ---------------- The Street ---------------- */

export type NasdaqDividend = { exDate: string; amount: number; payDate: string | null; declared: string | null };

export async function nasdaqDividends(symbol: string): Promise<{ payments: NasdaqDividend[]; payoutRatio: number | null; annualized: number | null }> {
  const d = check(S.Dividends, await get<unknown>(`/quote/${sym(symbol)}/dividends?assetclass=stocks`, 12 * HOUR), "dividends");
  const rows = d?.dividends?.rows ?? [];
  return {
    payments: rows.filter((r) => /cash/i.test(r.type || "cash")).map((r) => ({ exDate: isoDate(r.exOrEffDate) ?? "", amount: num(r.amount) ?? 0, payDate: isoDate(r.paymentDate), declared: isoDate(r.declarationDate) })).filter((r) => r.exDate && r.amount > 0),
    payoutRatio: pctToFraction(d?.payoutRatio),
    annualized: num(d?.annualizedDividend),
  };
}

/** `surprise` is a fraction (Nasdaq writes a percent). */
export type NasdaqSurprise = { quarter: string; reported: string | null; eps: number | null; consensus: number | null; surprise: number | null };

export async function nasdaqEarningsSurprise(symbol: string): Promise<NasdaqSurprise[]> {
  const d = check(S.Surprise, await get<unknown>(`/company/${sym(symbol)}/earnings-surprise`, 6 * HOUR), "earnings-surprise");
  return (d?.earningsSurpriseTable?.rows ?? []).map((r) => ({ quarter: r.fiscalQtrEnd, reported: isoDate(r.dateReported), eps: num(r.eps), consensus: num(r.consensusForecast), surprise: pctToFraction(r.percentageSurprise) }));
}

/** The next report date (Nasdaq's vendor estimates it from past dates until the company announces) and the quarter's EPS consensus. */
export async function nasdaqEarningsDate(symbol: string): Promise<{ date: string | null; epsConsensus: number | null; estimated: boolean } | null> {
  const d = check(S.EarningsDate, await get<unknown>(`/analyst/${sym(symbol)}/earnings-date`, 6 * HOUR), "earnings-date");
  if (!d?.reportText && !d?.announcement) return null;
  const text = `${d.announcement ?? ""} ${d.reportText ?? ""}`;
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text) ?? /([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  const eps = /consensus EPS forecast for the quarter is \$?(-?[\d.]+)/i.exec(text);
  return { date: m ? isoDate(m[1]) : null, epsConsensus: eps ? Number(eps[1]) : null, estimated: /estimated|derived from an algorithm/i.test(text) };
}

export type NasdaqForecast = { period: string; consensus: number | null; high: number | null; low: number | null; estimates: number | null };

export async function nasdaqEpsForecast(symbol: string): Promise<{ quarterly: NasdaqForecast[]; yearly: NasdaqForecast[] }> {
  type Row = { fiscalEnd: string; consensusEPSForecast?: unknown; highEPSForecast?: unknown; lowEPSForecast?: unknown; noOfEstimates?: unknown };
  const d = check(S.Forecast, await get<unknown>(`/analyst/${sym(symbol)}/earnings-forecast`, 12 * HOUR), "earnings-forecast");
  const map = (rows: Row[] | null | undefined) => (rows ?? []).map((r) => ({ period: r.fiscalEnd, consensus: num(r.consensusEPSForecast), high: num(r.highEPSForecast), low: num(r.lowEPSForecast), estimates: num(r.noOfEstimates) }));
  return { quarterly: map(d?.quarterlyForecast?.rows), yearly: map(d?.yearlyForecast?.rows) };
}

/** Rating counts are null when Nasdaq does not report them (not zero ratings). */
export type NasdaqTargets = { low: number | null; high: number | null; mean: number | null; buy: number | null; hold: number | null; sell: number | null };

export async function nasdaqTargets(symbol: string): Promise<NasdaqTargets | null> {
  const d = check(S.Targets, await get<unknown>(`/analyst/${sym(symbol)}/targetprice`, 12 * HOUR), "targetprice");
  const c = d?.consensusOverview;
  if (!c || (c.priceTarget == null && c.buy == null)) return null;
  return { low: num(c.lowPriceTarget), high: num(c.highPriceTarget), mean: num(c.priceTarget), buy: num(c.buy), hold: num(c.hold), sell: num(c.sell) };
}

export type NasdaqRatings = { mean: string; summary: string; actions: { date: string | null; firm: string; action: string; from: string; to: string }[] };

export async function nasdaqRatings(symbol: string): Promise<NasdaqRatings | null> {
  const d = check(S.Ratings, await get<unknown>(`/analyst/${sym(symbol)}/ratings`, 12 * HOUR), "ratings");
  if (!d) return null;
  return {
    mean: d.meanRatingType, summary: d.ratingsSummary,
    actions: (d.upgradesDowngrades ?? []).map((a) => ({ date: isoDate(a.date), firm: a.brokerName, action: a.action || a.ratingsChange, from: a.previousRating, to: a.newRating })),
  };
}

/* ---------------- Market-wide ---------------- */

/** A mover; `changePct` is a fraction. */
export type NasdaqMover = { symbol: string; name: string; price: number; change: number | null; changePct: number | null; volume: number | null };

/** The day's most active (by shares), biggest gainers and biggest losers across US exchanges. */
export async function nasdaqMovers(): Promise<{ actives: NasdaqMover[]; gainers: NasdaqMover[]; losers: NasdaqMover[] } | null> {
  const d = check(S.Movers, await get<unknown>(`/marketmovers?assetclass=stocks&exchangestatus=currentMarket&limit=25`, 5 * MIN), "marketmovers");
  const s = d?.STOCKS;
  if (!s) return null;
  type T = NonNullable<z.output<typeof S.Movers>["STOCKS"]>["MostAdvanced"];
  const rows = (t: T, pctColumn: boolean): NasdaqMover[] => (t?.table?.rows ?? []).flatMap((r) => {
    const price = num(r.lastSalePrice), change = num(r.lastSaleChange);
    if (price === null) return [];
    return [{ symbol: r.symbol, name: r.name, price, change, changePct: pctColumn ? pctToFraction(r.change) : change !== null && price - change ? change / (price - change) : null, volume: pctColumn ? null : num(r.change) }];
  });
  return { actives: rows(s.MostActiveByShareVolume, false), gainers: rows(s.MostAdvanced, true), losers: rows(s.MostDeclined, true) };
}
