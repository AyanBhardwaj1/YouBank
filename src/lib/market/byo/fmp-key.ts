/**
 * Financial Modeling Prep with a person's OWN key ("fmp-key"), apart from YouBank's account ("fmp"): the
 * same /stable answers and the same schemas (fmp-schema.ts), but none of the owner account's machinery
 * (its daily-limit flag, its shared per-minute budget, its shared caches). FMP takes the key only as the
 * `apikey` query parameter; the URL is never logged or put in an error (byo/http.ts). Problems come back
 * as `{ "Error Message" }` (a bad key, the limit, a plan without the endpoint) or HTTP 402.
 */
import type { z } from "zod";
import type { DailyBar, Profile } from "../canonical";
import * as S from "../fmp-schema";
import type { LiveQuote } from "../registry";
import { SourceError } from "../source-error";
import type { AnalystData, DividendData, EarningsData } from "../street-types";
import { canonical, forFmp } from "../symbols";
import { parseOrThrow } from "../validate";
import { keyedJson, keyRefused } from "./http";

export const FMP_STABLE = "https://financialmodelingprep.com/stable";

/** FMP's in-band problems as a SourceError; nothing when the answer is data. Pure. */
export function fmpKeyError(raw: unknown): SourceError | null {
  const msg = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)["Error Message"] : undefined;
  if (typeof msg !== "string") return null;
  if (/invalid api key|apikey/i.test(msg)) return new SourceError("fmp-key", "http", keyRefused("fmp"), 401);
  if (/limit reach/i.test(msg)) return new SourceError("fmp-key", "rate-limit", "FMP says your key's daily limit is reached.", 429);
  return new SourceError("fmp-key", "empty", "Your FMP plan does not include this.");
}

async function get<S extends z.ZodType>(key: string, op: string, path: string, params: Record<string, string>, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await keyedJson({ provider: "fmp", op, key, url: `${FMP_STABLE}/${path}?${new URLSearchParams({ ...params, apikey: key })}` });
  } catch (e) {
    // 402: the person's plan does not include the endpoint or symbol ("nothing here", not an outage).
    if ((e as { status?: number }).status === 402) throw new SourceError("fmp-key", "empty", "Your FMP plan does not include this.", 402);
    throw e;
  }
  const err = fmpKeyError(raw);
  if (err) throw err;
  return parseOrThrow(schema, raw, "FMP (your key)", path);
}

const sym = (s: string) => forFmp(canonical(s));

export const fmpKey = {
  bars: async (key: string, symbol: string, from: string): Promise<DailyBar[]> => (await get(key, "daily-bars", "historical-price-eod/full", { symbol: sym(symbol), from }, S.BarRows)).map(S.barOf).filter((b) => b.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1)),
  quote: async (key: string, symbol: string): Promise<LiveQuote | null> => {
    const r = (await get(key, "quote", "quote", { symbol: sym(symbol) }, S.QuoteRows))[0];
    if (!r) return null;
    const q = S.quoteOf(r);
    return { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "FMP (your key)" };
  },
  profile: async (key: string, symbol: string): Promise<Profile | null> => {
    const r = (await get(key, "profile", "profile", { symbol: sym(symbol) }, S.ProfileRows))[0];
    return r ? { ...S.profileOf(r, new Date().toISOString()), symbol: canonical(symbol), source: "FMP (your key)" } : null;
  },
  earnings: async (key: string, symbol: string): Promise<EarningsData> => {
    const rows = await get(key, "earnings", "earnings", { symbol: sym(symbol) }, S.EarningRows);
    const quarters = rows.filter((r) => r.epsActual !== null).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16)
      .map((r) => ({ date: r.date.slice(0, 10), epsActual: r.epsActual as number, epsEstimated: r.epsEstimated, revenueActual: r.revenueActual, revenueEstimated: r.revenueEstimated }));
    const up = rows.filter((r) => r.epsActual === null).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    return { quarters, next: up ? { date: up.date.slice(0, 10), epsEstimated: up.epsEstimated, revenueEstimated: up.revenueEstimated } : null, annual: [] };
  },
  dividends: async (key: string, symbol: string): Promise<DividendData> => {
    const rows = await get(key, "dividends", "dividends", { symbol: sym(symbol) }, S.DividendRows);
    return { payments: rows.flatMap((r) => { const amount = r.adjDividend || r.dividend; return amount ? [{ date: r.date.slice(0, 10), amount, payDate: r.paymentDate || null }] : []; }), frequency: rows[0]?.frequency ?? "", basis: "ex-date" };
  },
  analysts: async (key: string, symbol: string): Promise<AnalystData | null> => {
    const [g, t] = await Promise.all([get(key, "analysts", "grades", { symbol: sym(symbol), limit: "60" }, S.GradeRows), get(key, "analysts", "price-target-consensus", { symbol: sym(symbol) }, S.TargetRows).catch(() => [])]);
    if (!g.length && !t[0]) return null;
    const firms = new Map<string, { firm: string; grade: string; date: string; action: string }>();
    for (const x of [...g].sort((a, b) => (a.date < b.date ? 1 : -1))) if (!firms.has(x.gradingCompany)) firms.set(x.gradingCompany, { firm: x.gradingCompany, grade: x.newGrade, date: x.date.slice(0, 10), action: x.action });
    const tg = t[0];
    return { target: tg ? { high: tg.targetHigh, low: tg.targetLow, mean: tg.targetConsensus, median: tg.targetMedian } : null, counts: null, firms: [...firms.values()], actions: g.map((x) => ({ date: x.date.slice(0, 10), action: x.action })), snapshot: null };
  },
  test: async (key: string) => !!(await fmpKey.quote(key, "AAPL")),
};
