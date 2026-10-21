import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import type { Profile } from "@/lib/market/canonical";
import { fmpSlot } from "@/lib/market/fmp";
import { ProfileRows, profileOf } from "@/lib/market/fmp-schema";
import { forFmp } from "@/lib/market/symbols";
import { parseOrThrow } from "@/lib/market/validate";
import { fetchRetry, retryServerErrors } from "@/lib/net";

/** Financial Modeling Prep. Free tier: `profile` (price, market cap, change, 52w range) and `search-name`. */
const BASE = "https://financialmodelingprep.com/stable";

/** A profile row as FMP sends it, stamped with when it was fetched (kept through the cache). */
type Stamped = Record<string, unknown> & { fetchedAt?: string };

/**
 * A company's profile in the canonical shape (fraction change, market cap in dollars or null). FMP's
 * profile carries no quote time, so its as-of is the time it was fetched: stamped when the answer is
 * loaded and kept in the cache, so a cache hit 14 minutes later still says when the price was read.
 */
export async function fmpProfile(raw: string): Promise<Profile | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  const symbol = forFmp(raw);
  const rows = await cacheJson<Stamped[] | null>(`fmp:profile:${symbol}`, 15 * 60_000, async () => {
    // The plan's daily limit (see FMP_LIMIT_KEY in market/fmp): skip the request while it is in force.
    if (await cacheGet("fmp:daily-limit")) return null;
    // The shared per-minute budget (market/fmp). With none left it throws, so nothing is cached for long
    // (cacheJson remembers a failure for half a minute) and callers fall back as on any outage.
    await fmpSlot();
    // One retry on a network failure or a 5xx; never on 429, which is the plan's quota.
    const res = await fetchRetry(`${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${key}`, { cache: "no-store", timeoutMs: 10_000, retryOn: retryServerErrors });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as unknown;
    if (data && typeof data === "object" && /Limit Reach/i.test(String((data as { "Error Message"?: string })["Error Message"] ?? ""))) { await cacheSet("fmp:daily-limit", "1", 30 * 60_000); return null; }
    const fetchedAt = new Date().toISOString();
    return Array.isArray(data) ? (data as Stamped[]).map((r) => ({ ...r, fetchedAt })) : null; // FMP returns an object with a message on plan errors
  }, { shared: true });
  if (!rows?.length) return null;
  const [p] = parseOrThrow(ProfileRows, rows, "FMP", "profile");
  // Entries cached before the stamp existed read as fetched now.
  return profileOf(p, typeof rows[0].fetchedAt === "string" ? rows[0].fetchedAt : new Date().toISOString());
}
