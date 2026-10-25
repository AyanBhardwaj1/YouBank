/**
 * Tiingo with a person's own key (header `Authorization: Token <key>`), from its documented answers:
 * - end-of-day prices `GET /tiingo/daily/{ticker}/prices?startDate=` → `[{ date, open, high, low, close,
 *   volume, adjClose, …, divCash, splitFactor }]`. `close` is as traded; splits are restated here from
 *   `splitFactor` (split-adjusted, not dividend-adjusted, like the other sources' bars);
 * - IEX top of book `GET /iex/?tickers=` → `[{ ticker, last, tngoLast, prevClose, timestamp, lastSaleTimestamp }]`:
 *   real time, but IEX only (not the consolidated tape), and labelled so;
 * - metadata `GET /tiingo/daily/{ticker}` → `{ ticker, name, exchangeCode, description }`;
 * - key check `GET /api/test` → `{ message }`.
 */
import { z } from "zod";
import type { DailyBar, Profile } from "../canonical";
import type { LiveQuote } from "../registry";
import { canonical } from "../symbols";
import { parseOrThrow } from "../validate";
import { keyedJson } from "./http";

export const TIINGO = "https://api.tiingo.com";
const auth = (key: string) => ({ Authorization: `Token ${key}` });
/** Tiingo spells share classes with a dash ("BRK-B"), in lower case in paths. */
export const forTiingo = (symbol: string) => canonical(symbol).replace(".", "-");

const num = z.number().refine(Number.isFinite);
const optNum = z.number().nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
const EodRows = z.array(z.looseObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}/), open: num, high: num, low: num, close: num, volume: optNum, splitFactor: optNum }));
const IexRows = z.array(z.looseObject({ ticker: z.string(), last: optNum, tngoLast: optNum, prevClose: optNum, timestamp: z.string().nullish(), lastSaleTimestamp: z.string().nullish() }));
const Meta = z.looseObject({ ticker: z.string(), name: z.string().nullish(), exchangeCode: z.string().nullish(), description: z.string().nullish() });

/** Tiingo's daily rows as split-adjusted bars, oldest first: each price divided by the splits after its day. Pure. */
export function tiingoBars(raw: unknown): DailyBar[] {
  const rows = parseOrThrow(EodRows, raw, "Tiingo", "daily prices").sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: DailyBar[] = new Array(rows.length);
  let factor = 1; // the product of the split factors after this row's day
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    out[i] = { date: r.date.slice(0, 10), open: r.open / factor, high: r.high / factor, low: r.low / factor, close: r.close / factor, volume: Math.round((r.volume ?? 0) * factor) };
    const sf = r.splitFactor ?? 1;
    if (sf > 0 && sf !== 1) factor *= sf;
  }
  return out.filter((b) => b.close > 0);
}

/** Tiingo's IEX answer as a quote: the last IEX trade, its change on the previous close, its trade time. Pure. */
export function tiingoQuote(raw: unknown): LiveQuote | null {
  const r = parseOrThrow(IexRows, raw, "Tiingo", "iex")[0];
  const price = r?.last ?? r?.tngoLast ?? null;
  if (!r || price === null || price <= 0) return null;
  return { price, changePct: r.prevClose ? price / r.prevClose - 1 : null, asOf: r.lastSaleTimestamp ?? r.timestamp ?? null, source: "Tiingo" };
}

/** Tiingo's metadata as a profile without a price (name, exchange, description). Pure. */
export function tiingoProfile(raw: unknown, symbol: string): Profile {
  const m = parseOrThrow(Meta, raw, "Tiingo", "meta");
  return {
    symbol: canonical(symbol), name: m.name ?? "", price: null, change: null, changePct: null, marketCap: null, low52: null, high52: null,
    exchange: m.exchangeCode ?? "", industry: "", sector: "", website: "", description: m.description ?? "", source: "Tiingo", asOf: null,
  };
}

export const tiingo = {
  bars: async (key: string, symbol: string, from: string) => tiingoBars(await keyedJson({ provider: "tiingo", op: "daily-bars", key, headers: auth(key), url: `${TIINGO}/tiingo/daily/${encodeURIComponent(forTiingo(symbol).toLowerCase())}/prices?startDate=${from}` })),
  quote: async (key: string, symbol: string) => tiingoQuote(await keyedJson({ provider: "tiingo", op: "quote", key, headers: auth(key), url: `${TIINGO}/iex/?tickers=${encodeURIComponent(forTiingo(symbol).toLowerCase())}` })),
  profile: async (key: string, symbol: string) => tiingoProfile(await keyedJson({ provider: "tiingo", op: "profile", key, headers: auth(key), url: `${TIINGO}/tiingo/daily/${encodeURIComponent(forTiingo(symbol).toLowerCase())}` }), symbol),
  test: async (key: string) => { const r = (await keyedJson({ provider: "tiingo", op: "key-test", key, headers: auth(key), url: `${TIINGO}/api/test` })) as { message?: unknown }; return typeof r?.message === "string"; },
};
