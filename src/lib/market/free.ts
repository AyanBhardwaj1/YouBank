/**
 * Free, keyless sources for what Nasdaq does not carry:
 * - currencies: the European Central Bank's daily reference rates (free to reuse with attribution),
 *   through Frankfurter, an open-source service that republishes them;
 * - crypto: CoinGecko's public API (attribution requested; rate limited, so cached for 15 minutes).
 * Both return daily closes, oldest first, like the other providers.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import { backupEnabled } from "./nasdaq";

const MIN = 60_000, HOUR = 60 * MIN;

async function getJson<T>(url: string, key: string, ttlMs: number): Promise<T | null> {
  if (!backupEnabled()) return null;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T | null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let data: T | null = null;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "YouBank research terminal" }, cache: "no-store", signal: ctrl.signal });
    if (res.ok) data = (await res.json()) as T;
  } catch { /* network or timeout */ } finally { clearTimeout(timer); }
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
  const to = new Date().toISOString().slice(0, 10);
  const d = await getJson<{ rates?: Record<string, Record<string, number>> }>(`https://api.frankfurter.app/${from}..${to}?from=${base}&to=${quote}`, `ecb:${base}${quote}:${from}`, 6 * HOUR);
  return Object.entries(d?.rates ?? {}).map(([date, r]) => ({ date, close: r[quote] })).filter((x) => x.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

const COINS: Record<string, string> = { BTCUSD: "bitcoin", ETHUSD: "ethereum", SOLUSD: "solana" };
export const isCrypto = (symbol: string) => symbol.toUpperCase() in COINS;

/** A coin's daily closes in dollars for the last year (CoinGecko's public API). */
export async function coinGeckoHistory(symbol: string): Promise<Close[]> {
  const id = COINS[symbol.toUpperCase()];
  if (!id) return [];
  const d = await getJson<{ prices?: [number, number][] }>(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, `coingecko:${id}:365`, 15 * MIN);
  const byDay = new Map<string, number>();
  for (const [t, p] of d?.prices ?? []) if (p > 0) byDay.set(new Date(t).toISOString().slice(0, 10), p);
  return [...byDay.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
