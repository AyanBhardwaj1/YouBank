/**
 * Finnhub with a person's own key (header `X-Finnhub-Token`), from its documented answers:
 * - `GET /api/v1/quote?symbol=` → `{ c, d, dp, pc, t }` (price, change, percent change, previous close,
 *   Unix seconds). An unknown symbol answers zeros, read as "nothing here";
 * - `GET /api/v1/stock/profile2?symbol=` → `{ name, exchange, finnhubIndustry, marketCapitalization (millions), weburl }`;
 * - `GET /api/v1/stock/earnings?symbol=` → `[{ actual, estimate, period }]` (period = fiscal quarter end,
 *   not the report date, so no price reaction is read from it);
 * - `GET /api/v1/stock/recommendation?symbol=` → `[{ period, strongBuy, buy, hold, sell, strongSell }]`.
 * Finnhub's terms ask that its data be deleted when a subscription ends: removing the key purges it.
 */
import { z } from "zod";
import type { Profile } from "../canonical";
import { epochToIso } from "../canonical";
import type { LiveQuote } from "../registry";
import type { AnalystData, EarningsData } from "../street-types";
import { canonical } from "../symbols";
import { parseOrThrow } from "../validate";
import { keyedJson } from "./http";

export const FINNHUB = "https://finnhub.io/api/v1";
const auth = (key: string) => ({ "X-Finnhub-Token": key });
const MILLION = 1e6;

const optNum = z.number().nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
const QuoteAnswer = z.looseObject({ c: optNum, dp: optNum, pc: optNum, t: optNum });
const Profile2 = z.looseObject({ name: z.string().nullish(), exchange: z.string().nullish(), finnhubIndustry: z.string().nullish(), marketCapitalization: optNum, weburl: z.string().nullish(), ticker: z.string().nullish() });
const EarningRows = z.array(z.looseObject({ actual: optNum, estimate: optNum, period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
const RecoRows = z.array(z.looseObject({ period: z.string(), strongBuy: optNum, buy: optNum, hold: optNum, sell: optNum, strongSell: optNum }));

/** The quote: percent change to a fraction, Unix time as the as-of; a zero price (unknown symbol) is nothing. Pure. */
export function finnhubQuote(raw: unknown): LiveQuote | null {
  const q = parseOrThrow(QuoteAnswer, raw, "Finnhub", "quote");
  return q.c && q.c > 0 ? { price: q.c, changePct: q.dp === null ? null : q.dp / 100, asOf: epochToIso(q.t), source: "Finnhub" } : null;
}

/** profile2 as a profile without a price; market cap from millions to dollars. Empty object: nothing. Pure. */
export function finnhubProfile(raw: unknown, symbol: string): Profile | null {
  const p = parseOrThrow(Profile2, raw, "Finnhub", "profile2");
  if (!p.name) return null;
  return {
    symbol: canonical(symbol), name: p.name, price: null, change: null, changePct: null, marketCap: p.marketCapitalization && p.marketCapitalization > 0 ? p.marketCapitalization * MILLION : null,
    low52: null, high52: null, exchange: p.exchange ?? "", industry: p.finnhubIndustry ?? "", sector: "", website: p.weburl ?? "", description: "", source: "Finnhub", asOf: null,
  };
}

/** Earnings surprises as quarters, dated by the fiscal period's end (no report date in this answer). Pure. */
export function finnhubEarnings(raw: unknown): EarningsData {
  const quarters = parseOrThrow(EarningRows, raw, "Finnhub", "stock/earnings").flatMap((r) => (r.actual === null ? [] : [{ date: r.period, epsActual: r.actual, epsEstimated: r.estimate, revenueActual: null, revenueEstimated: null, datedBy: "period" as const }]))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return { quarters, next: null, annual: [] };
}

/** Recommendation trends as the latest month's counts (strong buys with buys, strong sells with sells). Pure. */
export function finnhubAnalysts(raw: unknown): AnalystData | null {
  const r = parseOrThrow(RecoRows, raw, "Finnhub", "stock/recommendation").sort((a, b) => (a.period < b.period ? 1 : -1))[0];
  if (!r) return null;
  const sum = (...xs: (number | null)[]) => (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));
  return { target: null, counts: { buy: sum(r.strongBuy, r.buy), hold: r.hold, sell: sum(r.sell, r.strongSell) }, firms: [], actions: [], snapshot: null };
}

const get = (key: string, op: string, path: string) => keyedJson({ provider: "finnhub", op, key, headers: auth(key), url: `${FINNHUB}${path}` });
const sym = (s: string) => encodeURIComponent(canonical(s));

export const finnhub = {
  quote: async (key: string, symbol: string) => finnhubQuote(await get(key, "quote", `/quote?symbol=${sym(symbol)}`)),
  profile: async (key: string, symbol: string) => finnhubProfile(await get(key, "profile", `/stock/profile2?symbol=${sym(symbol)}`), symbol),
  earnings: async (key: string, symbol: string) => finnhubEarnings(await get(key, "earnings", `/stock/earnings?symbol=${sym(symbol)}`)),
  analysts: async (key: string, symbol: string) => finnhubAnalysts(await get(key, "analysts", `/stock/recommendation?symbol=${sym(symbol)}`)),
  test: async (key: string) => { await finnhub.quote(key, "AAPL"); return true; },
};
