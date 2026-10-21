/**
 * Alpha Vantage with a person's own key. Alpha Vantage takes the key only as the `apikey` query
 * parameter, so the URL is never logged or put in an error (byo/http.ts). Problems come back as HTTP 200
 * with `{ "Error Message" }` (bad symbol or function), `{ "Note" }` or `{ "Information" }` (the key's
 * limit, or a premium-only request). From its documented answers:
 * - `TIME_SERIES_DAILY` → `{ "Time Series (Daily)": { "2026-10-20": { "1. open", "2. high", "3. low", "4. close", "5. volume" } } }`
 *   (full history is premium on newer keys: the compact 100 days answer then);
 * - `GLOBAL_QUOTE` → `{ "Global Quote": { "05. price", "07. latest trading day", "10. change percent": "1.23%" } }`;
 * - `OVERVIEW` → `{ Symbol, Name, Description, Exchange, Sector, Industry, MarketCapitalization, 52WeekHigh, 52WeekLow }` ("None" for none);
 * - `FX_DAILY` → `{ "Time Series FX (Daily)": { date: { "4. close" } } }`;
 * - `EARNINGS` → `{ quarterlyEarnings: [{ fiscalDateEnding, reportedDate, reportedEPS, estimatedEPS }] }`;
 * - `DIVIDENDS` → `{ data: [{ ex_dividend_date, payment_date, amount }] }`.
 */
import { z } from "zod";
import type { DailyBar, Profile } from "../canonical";
import { isoDay, pctToFraction, toNumber } from "../canonical";
import { isFxPair } from "../kinds";
import type { LiveQuote } from "../registry";
import { SourceError } from "../source-error";
import type { DividendData, EarningsData } from "../street-types";
import { canonical } from "../symbols";
import { parseOrThrow } from "../validate";
import { keyedJson } from "./http";

export const ALPHA = "https://www.alphavantage.co/query";
/** Alpha Vantage spells share classes with a dash ("BRK-B"). */
export const forAlpha = (symbol: string) => canonical(symbol).replace(".", "-");

/** Alpha Vantage's in-band problems as a SourceError; nothing when the answer is data. Pure. */
export function alphaError(raw: unknown): SourceError | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r["Error Message"] === "string") return new SourceError("alphavantage", "empty", "Alpha Vantage has no data for this.");
  if (typeof r.Note === "string") return new SourceError("alphavantage", "rate-limit", "Alpha Vantage says your key's request limit is reached.", 429);
  if (typeof r.Information === "string") return /premium/i.test(r.Information) ? new SourceError("alphavantage", "empty", "That needs a premium Alpha Vantage plan.") : new SourceError("alphavantage", "rate-limit", "Alpha Vantage says your key's request limit is reached.", 429);
  return null;
}
const checked = (raw: unknown) => { const e = alphaError(raw); if (e) throw e; return raw; };

const ohlc = z.looseObject({ "1. open": z.string(), "2. high": z.string(), "3. low": z.string(), "4. close": z.string(), "5. volume": z.string().optional() });
const Daily = z.looseObject({ "Time Series (Daily)": z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ohlc) });
const FxDaily = z.looseObject({ "Time Series FX (Daily)": z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ohlc.omit({ "5. volume": true })) });
const Global = z.looseObject({ "Global Quote": z.looseObject({ "05. price": z.string(), "07. latest trading day": z.string().optional(), "10. change percent": z.string().optional() }) });
const Overview = z.looseObject({ Symbol: z.string(), Name: z.string().nullish(), Description: z.string().nullish(), Exchange: z.string().nullish(), Sector: z.string().nullish(), Industry: z.string().nullish(), MarketCapitalization: z.string().nullish(), "52WeekHigh": z.string().nullish(), "52WeekLow": z.string().nullish() });
const Earnings = z.looseObject({ quarterlyEarnings: z.array(z.looseObject({ fiscalDateEnding: z.string(), reportedDate: z.string().nullish(), reportedEPS: z.string().nullish(), estimatedEPS: z.string().nullish() })) });
const Dividends = z.looseObject({ data: z.array(z.looseObject({ ex_dividend_date: z.string(), payment_date: z.string().nullish(), amount: z.string() })) });

const textOrNull = (s: string | null | undefined) => (s && s !== "None" && s !== "-" ? s : "");

/** Daily (or FX daily) series as bars, oldest first. Pure. */
export function alphaBars(raw: unknown, fx = false): DailyBar[] {
  checked(raw);
  const series = fx ? parseOrThrow(FxDaily, raw, "Alpha Vantage", "FX_DAILY")["Time Series FX (Daily)"] : parseOrThrow(Daily, raw, "Alpha Vantage", "TIME_SERIES_DAILY")["Time Series (Daily)"];
  return Object.entries(series).map(([date, v]) => ({ date, open: Number(v["1. open"]), high: Number(v["2. high"]), low: Number(v["3. low"]), close: Number(v["4. close"]), volume: Number((v as { "5. volume"?: string })["5. volume"] ?? 0) || 0 }))
    .filter((b) => Number.isFinite(b.close) && b.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** GLOBAL_QUOTE: the latest trading day's price (end of day on free keys, so it is dated to that day). Pure. */
export function alphaQuote(raw: unknown): LiveQuote | null {
  const q = parseOrThrow(Global, checked(raw), "Alpha Vantage", "GLOBAL_QUOTE")["Global Quote"];
  const price = toNumber(q["05. price"]);
  const day = isoDay(q["07. latest trading day"]);
  return price && price > 0 ? { price, changePct: pctToFraction(q["10. change percent"]), asOf: day ? `${day}T20:00:00.000Z` : null, source: "Alpha Vantage" } : null;
}

/** OVERVIEW as a profile without a price ("None" reads as empty, never 0). Pure. */
export function alphaProfile(raw: unknown, symbol: string): Profile | null {
  const o = parseOrThrow(Overview, checked(raw), "Alpha Vantage", "OVERVIEW");
  if (!o.Symbol) return null;
  const cap = toNumber(textOrNull(o.MarketCapitalization));
  return {
    symbol: canonical(symbol), name: textOrNull(o.Name), price: null, change: null, changePct: null, marketCap: cap && cap > 0 ? cap : null,
    low52: toNumber(textOrNull(o["52WeekLow"])), high52: toNumber(textOrNull(o["52WeekHigh"])), exchange: textOrNull(o.Exchange),
    industry: textOrNull(o.Industry), sector: textOrNull(o.Sector), website: "", description: textOrNull(o.Description), source: "Alpha Vantage", asOf: null,
  };
}

/** EARNINGS as reported quarters, newest first, dated by the report date where given. No forward estimates. Pure. */
export function alphaEarnings(raw: unknown): EarningsData {
  const rows = parseOrThrow(Earnings, checked(raw), "Alpha Vantage", "EARNINGS").quarterlyEarnings;
  const quarters = rows.flatMap((r) => {
    const eps = toNumber(textOrNull(r.reportedEPS)), date = isoDay(r.reportedDate) ?? isoDay(r.fiscalDateEnding);
    return eps === null || !date ? [] : [{ date, epsActual: eps, epsEstimated: toNumber(textOrNull(r.estimatedEPS)), revenueActual: null, revenueEstimated: null, datedBy: isoDay(r.reportedDate) ? "report" as const : "period" as const }];
  }).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16);
  return { quarters, next: null, annual: [] };
}

/** DIVIDENDS as payments by ex-date, with pay dates. Pure. */
export function alphaDividends(raw: unknown): DividendData {
  const rows = parseOrThrow(Dividends, checked(raw), "Alpha Vantage", "DIVIDENDS").data;
  const payments = rows.flatMap((r) => { const date = isoDay(r.ex_dividend_date), amount = toNumber(r.amount); return date && amount && amount > 0 ? [{ date, amount, payDate: isoDay(r.payment_date ?? "") }] : []; });
  return { payments, frequency: "", basis: "ex-date" };
}

const url = (key: string, params: Record<string, string>) => `${ALPHA}?${new URLSearchParams({ ...params, apikey: key })}`;

export const alphavantage = {
  bars: async (key: string, symbol: string) => {
    const s = canonical(symbol);
    if (isFxPair(s)) return alphaBars(await keyedJson({ provider: "alphavantage", op: "fx", key, url: url(key, { function: "FX_DAILY", from_symbol: s.slice(0, 3), to_symbol: s.slice(3), outputsize: "full" }) }), true);
    const full = await keyedJson({ provider: "alphavantage", op: "daily-bars", key, url: url(key, { function: "TIME_SERIES_DAILY", symbol: forAlpha(s), outputsize: "full" }) });
    // Full history is premium on newer keys: then the last 100 days.
    const premium = alphaError(full)?.message.includes("premium");
    return alphaBars(premium ? await keyedJson({ provider: "alphavantage", op: "daily-bars", key, url: url(key, { function: "TIME_SERIES_DAILY", symbol: forAlpha(s), outputsize: "compact" }) }) : full);
  },
  quote: async (key: string, symbol: string) => alphaQuote(await keyedJson({ provider: "alphavantage", op: "quote", key, url: url(key, { function: "GLOBAL_QUOTE", symbol: forAlpha(symbol) }) })),
  profile: async (key: string, symbol: string) => alphaProfile(await keyedJson({ provider: "alphavantage", op: "profile", key, url: url(key, { function: "OVERVIEW", symbol: forAlpha(symbol) }) }), symbol),
  earnings: async (key: string, symbol: string) => alphaEarnings(await keyedJson({ provider: "alphavantage", op: "earnings", key, url: url(key, { function: "EARNINGS", symbol: forAlpha(symbol) }) })),
  dividends: async (key: string, symbol: string) => alphaDividends(await keyedJson({ provider: "alphavantage", op: "dividends", key, url: url(key, { function: "DIVIDENDS", symbol: forAlpha(symbol) }) })),
  test: async (key: string) => !!(await alphavantage.quote(key, "IBM")),
};
