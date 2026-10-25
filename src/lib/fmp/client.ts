import { cacheEntry, cacheGet, cacheSet } from "@/lib/cache";
import { budget, MARKET_STALE_IF_ERROR_MS } from "@/lib/market/budgets";
import type { Profile } from "@/lib/market/canonical";
import { fmpSlot, MarketDataError } from "@/lib/market/fmp";
import { ProfileRows, profileOf } from "@/lib/market/fmp-schema";
import { noteFreshness } from "@/lib/market/provenance";
import { callSource } from "@/lib/market/source";
import { SourceError } from "@/lib/market/source-error";
import { forFmp } from "@/lib/market/symbols";
import { parseOrThrow } from "@/lib/market/validate";
import { fetchRetry, retryServerErrors } from "@/lib/net";

/** Financial Modeling Prep. Free tier: `profile` (price, market cap, change, 52w range) and `search-name`. */
const BASE = "https://financialmodelingprep.com/stable";

const PROFILE_TTL = 15 * 60_000;

/**
 * A company's profile in the canonical shape (fraction change, market cap in dollars or null), or null
 * when FMP has none for the symbol (or no key is set). A failure (timeout, network, 5xx, the daily limit,
 * an unreadable answer, drift: SourceError "schema") is thrown, not cached, so the registry falls back at
 * once and the next request asks again; past its 15 minutes the last profile keeps answering while one
 * refresh runs, and for a day when FMP fails, flagged stale. FMP's profile carries no quote time, so its
 * as-of is when FMP answered (kept through the cache): a cache hit 14 minutes later still says when the
 * price was read.
 */
export async function fmpProfile(raw: string): Promise<Profile | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  const symbol = forFmp(raw);
  const e = await cacheEntry<unknown[] | null>(`fmp:profile:${symbol}`, PROFILE_TTL, async () => {
    // The plan's daily limit (see FMP_LIMIT_KEY in market/fmp): skip the request while it is in force.
    if (await cacheGet("fmp:daily-limit")) throw new MarketDataError("The market-data plan's daily request limit is used up; it resets daily.");
    return callSource("fmp", "profile", async () => {
      // The shared per-minute budget (market/fmp). With none left it throws, and callers fall back as on any outage.
      await fmpSlot();
      const b = budget();
      // One retry on a network failure or a 5xx in background jobs, none on interactive paths; never on 429.
      const res = await fetchRetry(`${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${key}`, { cache: "no-store", timeoutMs: b.fmpTimeoutMs, retries: b.fmpRetries, retryOn: retryServerErrors });
      // A 5xx or 429 is a failure (the next source answers); another 4xx means "not on this plan": nothing, kept 15 minutes as before.
      if (res.status >= 500 || res.status === 429) throw Object.assign(new Error(`FMP ${res.status} for profile`), { status: res.status });
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      if (data && typeof data === "object" && /Limit Reach/i.test(String((data as { "Error Message"?: string })["Error Message"] ?? ""))) {
        await cacheSet("fmp:daily-limit", "1", 30 * 60_000);
        throw new SourceError("fmp", "rate-limit", "FMP's daily limit was reached", 429);
      }
      if (!Array.isArray(data)) return null; // FMP returns an object with a message on plan errors
      // Drift is FMP failing: counted for the breaker and never cached, so the last good profile keeps serving.
      if (data.length) parseOrThrow(ProfileRows, data, "FMP", "profile");
      return data;
    }, { label: "FMP" });
  }, { shared: true, staleMs: PROFILE_TTL, staleIfErrorMs: MARKET_STALE_IF_ERROR_MS });
  const fetchedAt = new Date(e.fetchedAt).toISOString();
  if (e.stale) noteFreshness({ stale: true, fetchedAt });
  if (!e.value?.length) return null;
  const [p] = parseOrThrow(ProfileRows, e.value, "FMP", "profile");
  return { ...profileOf(p, fetchedAt), ...(e.stale ? { stale: true } : {}) };
}
