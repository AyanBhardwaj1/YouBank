/**
 * Twelve Data with a person's own key (header `Authorization: apikey <key>`), from its documented answers.
 * Errors come back as HTTP 200 with `{ status: "error", code, message }`, so the status field is checked:
 * - `GET /time_series?symbol=&interval=1day&start_date=&order=ASC&outputsize=5000` →
 *   `{ meta: { symbol, exchange_timezone }, values: [{ datetime, open, high, low, close, volume }], status: "ok" }`
 *   (numbers as text); currency pairs as "EUR/USD";
 * - `GET /quote?symbol=` → `{ symbol, name, exchange, timestamp, close, previous_close, percent_change }`;
 * - key check `GET /api_usage` → `{ current_usage, plan_limit }`.
 * Twelve Data asks for "Data provided by Twelve Data" wherever its data is shown (sources-meta.ts).
 */
import { z } from "zod";
import type { DailyBar } from "../canonical";
import { epochToIso, pctToFraction } from "../canonical";
import { isFxPair } from "../kinds";
import type { LiveQuote } from "../registry";
import { SourceError } from "../source-error";
import { canonical } from "../symbols";
import { parseOrThrow } from "../validate";
import { keyedJson, keyRefused } from "./http";

export const TWELVE = "https://api.twelvedata.com";
const auth = (key: string) => ({ Authorization: `apikey ${key}` });
/** "EURUSD" -> "EUR/USD"; share classes with a dot ("BRK.B"). */
export const forTwelve = (symbol: string) => { const s = canonical(symbol); return isFxPair(s) ? `${s.slice(0, 3)}/${s.slice(3)}` : s; };

const numText = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/).transform(Number)]);
const optText = z.union([numText, z.literal(""), z.null()]).nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
const Err = z.looseObject({ status: z.literal("error"), code: z.number().nullish(), message: z.string().nullish() });
const Series = z.looseObject({ status: z.literal("ok").optional(), values: z.array(z.looseObject({ datetime: z.string().regex(/^\d{4}-\d{2}-\d{2}/), open: numText, high: numText, low: numText, close: numText, volume: optText })) });
const QuoteAnswer = z.looseObject({ symbol: z.string(), close: numText, previous_close: optText, percent_change: optText, timestamp: optText, datetime: z.string().nullish() });

/** Twelve Data's own error answer (sent with HTTP 200) as a SourceError; nothing when it is not one. Pure. */
export function twelveError(raw: unknown): SourceError | null {
  const e = Err.safeParse(raw);
  if (!e.success) return null;
  const code = e.data.code ?? 400;
  if (code === 401 || code === 403) return new SourceError("twelvedata", "http", keyRefused("twelvedata"), code);
  if (code === 429) return new SourceError("twelvedata", "rate-limit", "Twelve Data says your key's request limit is reached.", 429);
  // 400/404: not covered by this key's plan, or no such symbol: "nothing here", the next source is asked.
  return new SourceError("twelvedata", "empty", "Twelve Data has no data for this on your plan.", code);
}

/** A time series as daily bars, oldest first. Pure. */
export function twelveBars(raw: unknown): DailyBar[] {
  const err = twelveError(raw);
  if (err) throw err;
  return parseOrThrow(Series, raw, "Twelve Data", "time_series").values
    .map((v) => ({ date: v.datetime.slice(0, 10), open: v.open, high: v.high, low: v.low, close: v.close, volume: v.volume ?? 0 }))
    .filter((b) => b.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** A quote: percent change to a fraction, its Unix timestamp as the as-of. Pure. */
export function twelveQuote(raw: unknown): LiveQuote | null {
  const err = twelveError(raw);
  if (err) throw err;
  const q = parseOrThrow(QuoteAnswer, raw, "Twelve Data", "quote");
  return q.close > 0 ? { price: q.close, changePct: pctToFraction(q.percent_change), asOf: epochToIso(q.timestamp), source: "Twelve Data" } : null;
}

export const twelvedata = {
  bars: async (key: string, symbol: string, from: string) => twelveBars(await keyedJson({ provider: "twelvedata", op: "daily-bars", key, headers: auth(key), url: `${TWELVE}/time_series?symbol=${encodeURIComponent(forTwelve(symbol))}&interval=1day&start_date=${from}&order=ASC&outputsize=5000` })),
  quote: async (key: string, symbol: string) => twelveQuote(await keyedJson({ provider: "twelvedata", op: "quote", key, headers: auth(key), url: `${TWELVE}/quote?symbol=${encodeURIComponent(forTwelve(symbol))}` })),
  test: async (key: string) => { const r = await keyedJson({ provider: "twelvedata", op: "key-test", key, headers: auth(key), url: `${TWELVE}/api_usage` }); const err = twelveError(r); if (err) throw err; return true; },
};
