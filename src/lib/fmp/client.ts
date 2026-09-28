import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";

/** Financial Modeling Prep. Free tier: `profile` (price, market cap, change, 52w range) and `search-name`. */
const BASE = "https://financialmodelingprep.com/stable";

export type FmpProfile = {
  symbol: string; price: number; marketCap: number; change: number; changePercentage: number; range: string;
  companyName: string; cik: string; exchange: string; exchangeFullName: string; industry: string; sector: string;
  website: string; description: string; city?: string; state?: string; ipoDate?: string; fullTimeEmployees?: string;
};

export async function fmpProfile(symbol: string): Promise<(FmpProfile & { fetchedAt: string }) | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  const rows = await cacheJson<FmpProfile[] | null>(`fmp:profile:${symbol}`, 15 * 60_000, async () => {
    // The plan's daily limit (see FMP_LIMIT_KEY in market/fmp): skip the request while it is in force.
    if (await cacheGet("fmp:daily-limit")) return null;
    const res = await fetch(`${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${key}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as unknown;
    if (data && typeof data === "object" && /Limit Reach/i.test(String((data as { "Error Message"?: string })["Error Message"] ?? ""))) { await cacheSet("fmp:daily-limit", "1", 30 * 60_000); return null; }
    return Array.isArray(data) ? (data as FmpProfile[]) : null; // FMP returns an object with a message on plan errors
  });
  const p = rows?.[0];
  return p ? { ...p, fetchedAt: new Date().toISOString() } : null;
}
