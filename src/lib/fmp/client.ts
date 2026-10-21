import { cacheEntry, cacheGet, cacheSet } from "@/lib/cache";
import { budget, MARKET_STALE_IF_ERROR_MS } from "@/lib/market/budgets";
import { fmpSlot, MarketDataError } from "@/lib/market/fmp";
import { noteFreshness } from "@/lib/market/provenance";
import { callSource } from "@/lib/market/source";
import { SourceError } from "@/lib/market/source-error";
import { fetchRetry, retryServerErrors } from "@/lib/net";

/** Financial Modeling Prep. Free tier: `profile` (price, market cap, change, 52w range) and `search-name`. */
const BASE = "https://financialmodelingprep.com/stable";

export type FmpProfile = {
  symbol: string; price: number; marketCap: number; change: number; changePercentage: number; range: string;
  companyName: string; cik: string; exchange: string; exchangeFullName: string; industry: string; sector: string;
  website: string; description: string; city?: string; state?: string; ipoDate?: string; fullTimeEmployees?: string;
};

const PROFILE_TTL = 15 * 60_000;

/**
 * The profile, or null when FMP has none for the symbol (or no key is set). A failure (timeout, network,
 * 5xx, the daily limit, an unreadable answer) is thrown, not cached, so the registry falls back at once and
 * the next request asks again; past its 15 minutes the last profile keeps answering while one refresh
 * runs, and for a day when FMP fails, flagged stale. `fetchedAt` is when FMP answered, not when the cache did.
 */
export async function fmpProfile(symbol: string): Promise<(FmpProfile & { fetchedAt: string; stale?: boolean }) | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  const e = await cacheEntry<FmpProfile[] | null>(`fmp:profile:${symbol}`, PROFILE_TTL, async () => {
    // The plan's daily limit (see FMP_LIMIT_KEY in market/fmp): skip the request while it is in force.
    if (await cacheGet("fmp:daily-limit")) throw new MarketDataError("The market-data plan's daily request limit is used up; it resets daily.");
    return callSource("fmp", "profile", async () => {
      // The shared per-minute budget (market/fmp). With none left it throws, and callers fall back as on any outage.
      await fmpSlot();
      const b = budget();
      // One retry on a network failure or a 5xx in background jobs, none on interactive paths; never on 429.
      const res = await fetchRetry(`${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${key}`, { cache: "no-store", timeoutMs: b.fmpTimeoutMs, retries: b.fmpRetries, retryOn: retryServerErrors });
      if (!res.ok) throw Object.assign(new Error(`FMP ${res.status} for profile`), { status: res.status });
      const data = (await res.json()) as unknown;
      if (data && typeof data === "object" && /Limit Reach/i.test(String((data as { "Error Message"?: string })["Error Message"] ?? ""))) {
        await cacheSet("fmp:daily-limit", "1", 30 * 60_000);
        throw new SourceError("fmp", "rate-limit", "FMP's daily limit was reached", 429);
      }
      return Array.isArray(data) ? (data as FmpProfile[]) : null; // FMP returns an object with a message on plan errors
    }, { label: "FMP" });
  }, { shared: true, staleMs: PROFILE_TTL, staleIfErrorMs: MARKET_STALE_IF_ERROR_MS });
  const fetchedAt = new Date(e.fetchedAt).toISOString();
  if (e.stale) noteFreshness({ stale: true, fetchedAt });
  const p = e.value?.[0];
  return p ? { ...p, fetchedAt, ...(e.stale ? { stale: true } : {}) } : null;
}
