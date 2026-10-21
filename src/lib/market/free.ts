/**
 * Free, keyless sources for what Nasdaq does not carry:
 * - currencies: the European Central Bank's daily reference rates (free to reuse with attribution),
 *   through Frankfurter, an open-source service that republishes them;
 * - crypto: CoinGecko's public API (attribution requested; rate limited, so cached for 15 minutes).
 * Both return daily closes, oldest first, like the other providers.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import { backupEnabled } from "./nasdaq";
import { fetchRetry } from "@/lib/net";
import { z } from "zod";
import { CG } from "@/lib/crypto/schema";
import { marketDate } from "./calendar";
import type { FxRate } from "./canonical";
import { parseOrThrow } from "./validate";

/** Frankfurter's time series: { rates: { "2026-10-20": { USD: 1.08 } } }. */
const EcbSeries = z.looseObject({ rates: z.record(z.string(), z.record(z.string(), z.number())) });

const MIN = 60_000, HOUR = 60 * MIN;

async function getJson<T>(url: string, key: string, ttlMs: number): Promise<T | null> {
  if (!backupEnabled()) return null;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T | null;
  let data: T | null = null;
  try {
    const res = await fetchRetry(url, { headers: { Accept: "application/json", "User-Agent": "YouBank research terminal" }, cache: "no-store", timeoutMs: 12_000 });
    if (res.ok) data = (await res.json()) as T;
  } catch { /* network or timeout */ }
  await cacheSet(key, JSON.stringify(data), data ? ttlMs : 5 * MIN);
  return data;
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
  const d = await getJson<unknown>(`https://api.frankfurter.app/${from}..${to}?from=${base}&to=${quote}`, `ecb:${base}${quote}:${from}`, 6 * HOUR);
  if (d === null) return [];
  return ecbRates(parseOrThrow(EcbSeries, d, "ECB", "frankfurter timeseries").rates, base, quote).map((r) => ({ date: r.date, close: r.rate }));
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
  const d = await getJson<unknown>(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, `coingecko:${id}:365`, 15 * MIN);
  const prices = d === null ? [] : parseOrThrow(CG.chart, d, "CoinGecko", "market_chart").prices;
  const byDay = new Map<string, number>();
  for (const [t, p] of prices) if (typeof t === "number" && typeof p === "number" && p > 0) byDay.set(new Date(t).toISOString().slice(0, 10), p);
  return [...byDay.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
