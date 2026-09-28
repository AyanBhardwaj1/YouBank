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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let data: T | null = null;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: HEADERS, cache: "no-store", signal: ctrl.signal });
    if (res.ok) data = ((await res.json()) as { data?: T | null })?.data ?? null;
  } catch { /* network, timeout or a blocked request */ } finally { clearTimeout(timer); }
  await cacheSet(key, JSON.stringify(data), data ? ttlMs : 5 * MIN);
  return data;
}

/* ---------------- Parsing ---------------- */

/** "$1,234.56", "+0.58%", "30,002,768", "N/A" -> number or null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,%\s+]/g, "");
  if (!t || /^n\/?a$/i.test(t) || t === "--") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "09/25/2026", "9/5/2026", "Aug 10, 2026" -> "2026-09-25"; anything else -> null. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(v.trim());
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

/* ---------------- History and quotes ---------------- */

export type AssetClass = "stocks" | "etf";
type HistRow = { date: string; close: string; volume: string; open: string; high: string; low: string };
export type NasdaqBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Which asset class a symbol answers to (stocks first, then ETFs), remembered for a day. */
async function assetClassOf(symbol: string): Promise<AssetClass | null> {
  const key = `nasdaq:class:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit === "none" ? null : (hit as AssetClass);
  for (const c of ["stocks", "etf"] as const) {
    const info = await get<{ symbol?: string; primaryData?: { lastSalePrice?: string } }>(`/quote/${encodeURIComponent(symbol)}/info?assetclass=${c}`, 15 * MIN);
    if (info?.primaryData && num(info.primaryData.lastSalePrice) !== null) { await cacheSet(key, c, 24 * HOUR); return c; }
  }
  await cacheSet(key, "none", 30 * MIN);
  return null;
}

/** Daily bars, oldest first, from `from` (ISO) to today. */
export async function nasdaqHistory(symbol: string, from: string): Promise<NasdaqBar[]> {
  const cls = await assetClassOf(symbol);
  if (!cls) return [];
  const to = new Date().toISOString().slice(0, 10);
  const d = await get<{ tradesTable?: { rows?: HistRow[] } }>(`/quote/${encodeURIComponent(symbol)}/historical?assetclass=${cls}&fromdate=${from}&limit=9999&todate=${to}`, 3 * HOUR);
  const rows = d?.tradesTable?.rows ?? [];
  return rows
    .map((r) => ({ date: isoDate(r.date) ?? "", open: num(r.open) ?? NaN, high: num(r.high) ?? NaN, low: num(r.low) ?? NaN, close: num(r.close) ?? NaN, volume: num(r.volume) ?? 0 }))
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type NasdaqQuote = { symbol: string; name: string; price: number; change: number | null; changePct: number | null; volume: number | null; asOf: string; exchange: string; realTime: boolean };

export async function nasdaqQuote(symbol: string): Promise<NasdaqQuote | null> {
  const cls = await assetClassOf(symbol);
  if (!cls) return null;
  const d = await get<{ symbol: string; companyName?: string; exchange?: string; primaryData?: { lastSalePrice?: string; netChange?: string; percentageChange?: string; lastTradeTimestamp?: string; isRealTime?: boolean; volume?: string } }>(`/quote/${encodeURIComponent(symbol)}/info?assetclass=${cls}`, 5 * MIN);
  const p = d?.primaryData;
  const price = num(p?.lastSalePrice);
  if (!d || !p || price === null) return null;
  return {
    symbol: d.symbol, name: (d.companyName ?? "").replace(/ (Common Stock|Class [A-C] Common Stock|Ordinary Shares).*$/i, ""), price,
    change: num(p.netChange), changePct: num(p.percentageChange), volume: num(p.volume), asOf: p.lastTradeTimestamp ?? "", exchange: d.exchange ?? "", realTime: !!p.isRealTime,
  };
}

export type NasdaqSummary = { marketCap: number | null; high52: number | null; low52: number | null; previousClose: number | null; target1y: number | null; annualDividend: number | null; exDividendDate: string | null; yield: number | null; sector: string; industry: string; exchange: string };

export async function nasdaqSummary(symbol: string): Promise<NasdaqSummary | null> {
  const cls = await assetClassOf(symbol);
  if (!cls) return null;
  const d = await get<{ summaryData?: Record<string, { value?: string }> }>(`/quote/${encodeURIComponent(symbol)}/summary?assetclass=${cls}`, 30 * MIN);
  const s = d?.summaryData;
  if (!s) return null;
  const v = (k: string) => s[k]?.value;
  const [hi, lo] = (v("FiftTwoWeekHighLow") ?? v("FiftyTwoWeekHighLow") ?? "").split("/").map(num);
  return {
    marketCap: num(v("MarketCap")), high52: hi ?? null, low52: lo ?? null, previousClose: num(v("PreviousClose")), target1y: num(v("OneYrTarget")),
    annualDividend: num(v("AnnualizedDividend")), exDividendDate: isoDate(v("ExDividendDate")), yield: num(v("Yield")) !== null ? (num(v("Yield")) as number) / 100 : null,
    sector: v("Sector") ?? "", industry: v("Industry") ?? "", exchange: v("Exchange") ?? "",
  };
}

/* ---------------- The Street ---------------- */

export type NasdaqDividend = { exDate: string; amount: number; payDate: string | null; declared: string | null };

export async function nasdaqDividends(symbol: string): Promise<{ payments: NasdaqDividend[]; payoutRatio: number | null; annualized: number | null }> {
  const d = await get<{ payoutRatio?: string | number; annualizedDividend?: string | number; dividends?: { rows?: { exOrEffDate: string; type: string; amount: string; declarationDate: string; paymentDate: string }[] } }>(`/quote/${encodeURIComponent(symbol)}/dividends?assetclass=stocks`, 12 * HOUR);
  const rows = d?.dividends?.rows ?? [];
  return {
    payments: rows.filter((r) => /cash/i.test(r.type ?? "cash")).map((r) => ({ exDate: isoDate(r.exOrEffDate) ?? "", amount: num(r.amount) ?? 0, payDate: isoDate(r.paymentDate), declared: isoDate(r.declarationDate) })).filter((r) => r.exDate && r.amount > 0),
    payoutRatio: num(d?.payoutRatio) !== null ? (num(d?.payoutRatio) as number) / 100 : null,
    annualized: num(d?.annualizedDividend),
  };
}

export type NasdaqSurprise = { quarter: string; reported: string | null; eps: number | null; consensus: number | null; surprisePct: number | null };

export async function nasdaqEarningsSurprise(symbol: string): Promise<NasdaqSurprise[]> {
  const d = await get<{ earningsSurpriseTable?: { rows?: { fiscalQtrEnd: string; dateReported: string; eps: number | string; consensusForecast: string; percentageSurprise: string }[] } }>(`/company/${encodeURIComponent(symbol)}/earnings-surprise`, 6 * HOUR);
  return (d?.earningsSurpriseTable?.rows ?? []).map((r) => ({ quarter: r.fiscalQtrEnd, reported: isoDate(r.dateReported), eps: num(r.eps), consensus: num(r.consensusForecast), surprisePct: num(r.percentageSurprise) }));
}

/** The next report date (Nasdaq's vendor estimates it from past dates until the company announces) and the quarter's EPS consensus. */
export async function nasdaqEarningsDate(symbol: string): Promise<{ date: string | null; epsConsensus: number | null; estimated: boolean } | null> {
  const d = await get<{ reportText?: string; announcement?: string }>(`/analyst/${encodeURIComponent(symbol)}/earnings-date`, 6 * HOUR);
  if (!d?.reportText && !d?.announcement) return null;
  const text = `${d.announcement ?? ""} ${d.reportText ?? ""}`;
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text) ?? /([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  const eps = /consensus EPS forecast for the quarter is \$?(-?[\d.]+)/i.exec(text);
  return { date: m ? isoDate(m[1]) : null, epsConsensus: eps ? Number(eps[1]) : null, estimated: /estimated|derived from an algorithm/i.test(text) };
}

export type NasdaqForecast = { period: string; consensus: number | null; high: number | null; low: number | null; estimates: number | null };

export async function nasdaqEpsForecast(symbol: string): Promise<{ quarterly: NasdaqForecast[]; yearly: NasdaqForecast[] }> {
  type Row = { fiscalEnd: string; consensusEPSForecast: number | string; highEPSForecast: number | string; lowEPSForecast: number | string; noOfEstimates: number | string };
  const d = await get<{ quarterlyForecast?: { rows?: Row[] }; yearlyForecast?: { rows?: Row[] } }>(`/analyst/${encodeURIComponent(symbol)}/earnings-forecast`, 12 * HOUR);
  const map = (rows: Row[] | undefined) => (rows ?? []).map((r) => ({ period: r.fiscalEnd, consensus: num(r.consensusEPSForecast), high: num(r.highEPSForecast), low: num(r.lowEPSForecast), estimates: num(r.noOfEstimates) }));
  return { quarterly: map(d?.quarterlyForecast?.rows), yearly: map(d?.yearlyForecast?.rows) };
}

export type NasdaqTargets = { low: number | null; high: number | null; mean: number | null; buy: number; hold: number; sell: number };

export async function nasdaqTargets(symbol: string): Promise<NasdaqTargets | null> {
  const d = await get<{ consensusOverview?: { lowPriceTarget?: number; highPriceTarget?: number; priceTarget?: number; buy?: number; hold?: number; sell?: number } }>(`/analyst/${encodeURIComponent(symbol)}/targetprice`, 12 * HOUR);
  const c = d?.consensusOverview;
  if (!c || (c.priceTarget === undefined && c.buy === undefined)) return null;
  return { low: num(c.lowPriceTarget), high: num(c.highPriceTarget), mean: num(c.priceTarget), buy: Number(c.buy ?? 0), hold: Number(c.hold ?? 0), sell: Number(c.sell ?? 0) };
}

export type NasdaqRatings = { mean: string; summary: string; actions: { date: string | null; firm: string; action: string; from: string; to: string }[] };

export async function nasdaqRatings(symbol: string): Promise<NasdaqRatings | null> {
  const d = await get<{ meanRatingType?: string; ratingsSummary?: string; upgradesDowngrades?: { date?: string; brokerName?: string; action?: string; previousRating?: string; newRating?: string; ratingsChange?: string }[] }>(`/analyst/${encodeURIComponent(symbol)}/ratings`, 12 * HOUR);
  if (!d) return null;
  return {
    mean: d.meanRatingType ?? "", summary: d.ratingsSummary ?? "",
    actions: (d.upgradesDowngrades ?? []).map((a) => ({ date: isoDate(a.date ?? ""), firm: a.brokerName ?? "", action: a.action ?? a.ratingsChange ?? "", from: a.previousRating ?? "", to: a.newRating ?? "" })),
  };
}

/* ---------------- Market-wide ---------------- */

export type NasdaqMover = { symbol: string; name: string; price: number; change: number | null; changePct: number | null; volume: number | null };

/** The day's most active (by shares), biggest gainers and biggest losers across US exchanges. */
export async function nasdaqMovers(): Promise<{ actives: NasdaqMover[]; gainers: NasdaqMover[]; losers: NasdaqMover[] } | null> {
  type T = { table?: { rows?: { symbol: string; name: string; lastSalePrice: string; lastSaleChange: string; change: string }[] } };
  const d = await get<{ STOCKS?: Record<string, T> }>(`/marketmovers?assetclass=stocks&exchangestatus=currentMarket&limit=25`, 5 * MIN);
  const s = d?.STOCKS;
  if (!s) return null;
  const rows = (t: T | undefined, pctColumn: boolean) => (t?.table?.rows ?? []).map((r) => {
    const price = num(r.lastSalePrice) ?? 0, change = num(r.lastSaleChange);
    return { symbol: r.symbol, name: r.name, price, change, changePct: pctColumn ? num(r.change) : change !== null && price - change ? (change / (price - change)) * 100 : null, volume: pctColumn ? null : num(r.change) };
  });
  return { actives: rows(s.MostActiveByShareVolume, false), gainers: rows(s.MostAdvanced, true), losers: rows(s.MostDeclined, true) };
}
