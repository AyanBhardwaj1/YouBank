/**
 * Free, keyless sources for what Nasdaq does not carry:
 * - currencies: the European Central Bank's daily reference rates (free to reuse with attribution),
 *   through Frankfurter, an open-source service that republishes them, and from the ECB's own data API
 *   when Frankfurter fails. Public data: not switched off by MARKET_BACKUP=off (only the unverified
 *   backups are);
 * - crypto: CoinGecko's public API (attribution requested; rate limited, so cached for 15 minutes).
 * Both return daily closes, oldest first, like the other providers.
 */
import { cacheEntry } from "@/lib/cache";
import { backupEnabled } from "./nasdaq";
import { fetchRetry } from "@/lib/net";
import { z } from "zod";
import { CG } from "@/lib/crypto/schema";
import { budget, MARKET_STALE_IF_ERROR_MS } from "./budgets";
import { marketDate } from "./calendar";
import type { FxRate } from "./canonical";
import { noteFreshness } from "./provenance";
import { callSource } from "./source";
import { parseOrThrow } from "./validate";

/** Frankfurter's time series: { rates: { "2026-10-20": { USD: 1.08 } } }. */
const EcbSeries = z.looseObject({ rates: z.record(z.string(), z.record(z.string(), z.number())) });

const MIN = 60_000, HOUR = 60 * MIN;

/** One GET, cached like nasdaq.ts: answers for `ttlMs`, failures not shared across instances (read as null). */
async function getJson<T>(url: string, key: string, ttlMs: number, source: "ecb" | "coingecko"): Promise<T | null> {
  if (source === "coingecko" && !backupEnabled()) return null;
  try {
    const e = await cacheEntry<T | null>(key, ttlMs, () => callSource(source, source === "ecb" ? "rates" : "market_chart", async () => {
      const res = await fetchRetry(url, { headers: { Accept: "application/json", "User-Agent": "YouBank research terminal" }, cache: "no-store", timeoutMs: budget().freeTimeoutMs });
      if (res.status >= 500 || res.status === 429) throw Object.assign(new Error(`${source} ${res.status}`), { status: res.status });
      if (!res.ok) return null; // a refusal or "not found": nothing, kept five minutes as before
      return (await res.json()) as T;
    }, { label: source === "ecb" ? "The ECB's rates" : "CoinGecko" }), { staleMs: ttlMs, staleIfErrorMs: MARKET_STALE_IF_ERROR_MS, ttlFor: (v) => (v === null ? 5 * MIN : undefined) });
    if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
    return e.value;
  } catch {
    return null;
  }
}

export type Close = { date: string; close: number };

/**
 * A currency pair's daily history from the ECB reference rates, in the market's quoting convention:
 * "EURUSD" is dollars per euro, "USDJPY" yen per dollar. CNH (offshore yuan) uses the CNY fixing.
 */
export async function ecbPair(pair: string, from: string): Promise<Close[]> {
  const base = pair.slice(0, 3).toUpperCase(), quote = pair.slice(3, 6).toUpperCase().replace("CNH", "CNY");
  if (base.length !== 3 || quote.length !== 3) return [];
  const to = marketDate();
  const d = await getJson<unknown>(`https://api.frankfurter.app/${from}..${to}?from=${base}&to=${quote}`, `ecb:${base}${quote}:${from}`, 6 * HOUR, "ecb");
  if (d === null) return ecbDirect(base, quote, from);
  return ecbRates(parseOrThrow(EcbSeries, d, "ECB", "frankfurter timeseries").rates, base, quote).map((r) => ({ date: r.date, close: r.rate }));
}

/** The ECB's own data API (SDMX, CSV): units of each currency per euro, by day. */
const ECB_SDMX = "https://data-api.ecb.europa.eu/service/data/EXR";
const EcbCsv = z.object({
  cols: z.array(z.string()).refine((c) => ["CURRENCY", "TIME_PERIOD", "OBS_VALUE"].every((k) => c.includes(k)), "CURRENCY, TIME_PERIOD and OBS_VALUE columns"),
  rows: z.array(z.array(z.string())),
});

/** The ECB's CSV as per-euro rates by currency and day, checked by column name (never by position). Pure. */
export function parseEcbCsv(text: string): Record<string, Record<string, number>> {
  const [head = "", ...lines] = text.trim().split(/\r?\n/);
  const { cols, rows } = parseOrThrow(EcbCsv, { cols: head.split(","), rows: lines.map((l) => l.split(",")) }, "ECB", "EXR csvdata");
  const [ci, ti, vi] = ["CURRENCY", "TIME_PERIOD", "OBS_VALUE"].map((k) => cols.indexOf(k));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const v = Number(r[vi]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(r[ti] ?? "") && Number.isFinite(v) && v > 0) (out[r[ti]] ??= {})[r[ci]] = v;
  }
  return out;
}

/** A pair from per-euro rates: quote per base (EURUSD: dollars per euro). The cross is derived, and the attribution says so. Pure. */
export function crossFromEuro(perEuro: Record<string, Record<string, number>>, base: string, quote: string): Close[] {
  const per = (r: Record<string, number>, c: string) => (c === "EUR" ? 1 : r[c]);
  return Object.entries(perEuro).map(([date, r]) => ({ date, close: per(r, quote) / per(r, base) })).filter((x) => Number.isFinite(x.close) && x.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function ecbDirect(base: string, quote: string, from: string): Promise<Close[]> {
  const codes = [base, quote].filter((c) => c !== "EUR").join("+");
  const url = `${ECB_SDMX}/D.${codes}.EUR.SP00.A?startPeriod=${from}&format=csvdata`;
  try {
    const e = await cacheEntry<Record<string, Record<string, number>>>(`ecb:sdmx:${codes}:${from}`, 6 * HOUR, () => callSource("ecb", "sdmx", async () => {
      const res = await fetchRetry(url, { headers: { Accept: "text/csv" }, cache: "no-store", timeoutMs: budget().freeTimeoutMs });
      if (!res.ok) throw Object.assign(new Error(`ECB ${res.status}`), { status: res.status });
      return parseEcbCsv(await res.text());
    }, { label: "The ECB's rates" }), { staleMs: 6 * HOUR, staleIfErrorMs: MARKET_STALE_IF_ERROR_MS });
    if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
    return crossFromEuro(e.value, base, quote);
  } catch {
    return [];
  }
}

/** Frankfurter's daily rates as canonical FX rates, oldest first. */
export function ecbRates(rates: Record<string, Record<string, number>>, base: string, quote: string): FxRate[] {
  return Object.entries(rates).map(([date, r]) => ({ base, quote, date, rate: r[quote], source: "ECB" })).filter((x) => x.rate > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

const COINS: Record<string, string> = { BTCUSD: "bitcoin", ETHUSD: "ethereum", SOLUSD: "solana" };
export const isCrypto = (symbol: string) => symbol.toUpperCase() in COINS;

/** A coin's daily closes in dollars for the last year (CoinGecko's public API). */
export async function coinGeckoHistory(symbol: string): Promise<Close[]> {
  const id = COINS[symbol.toUpperCase()];
  if (!id) return [];
  const d = await getJson<unknown>(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, `coingecko:${id}:365`, 15 * MIN, "coingecko");
  const prices = d === null ? [] : parseOrThrow(CG.chart, d, "CoinGecko", "market_chart").prices;
  const byDay = new Map<string, number>();
  for (const [t, p] of prices) if (typeof t === "number" && typeof p === "number" && p > 0) byDay.set(new Date(t).toISOString().slice(0, 10), p);
  return [...byDay.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
