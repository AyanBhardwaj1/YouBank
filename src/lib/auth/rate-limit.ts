/**
 * Sign-in's rate limits, counted in the database (kv_cache) so every serverless instance shares them.
 * Better Auth's default store is memory, which on Vercel is per instance: a burst spread over instances
 * would never trip it. Counting fails open (src/lib/locks): a database blip never locks people out.
 */
import { withinRate } from "@/lib/locks";

type Rule = { window: number; max: number };

/** Seconds until the fixed window that `now` falls in ends. Pure. */
export const secondsLeft = (windowSec: number, now = Date.now()) => {
  const ms = windowSec * 1000;
  return Math.max(1, Math.ceil(((Math.floor(now / ms) + 1) * ms - now) / 1000));
};

export const authRateStorage = {
  // Only `consume` is used (atomic, one upsert); get/set exist for the interface.
  get: async () => null,
  set: async () => undefined,
  async consume(key: string, rule: Rule): Promise<{ allowed: boolean; retryAfter: number | null }> {
    if (await withinRate(`auth:${key}`, rule.max, rule.window * 1000)) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: secondsLeft(rule.window) };
  },
};

/**
 * Per address. Better Auth allows 3 tries in 10 s on sign-in and sign-up paths and 100 in 10 s elsewhere;
 * password sign-in and sign-up get a longer window instead (an office or campus shares one address, so the
 * numbers allow a crowd but not a guessing run), and session reads are not counted (every page asks).
 */
export const AUTH_RATE_RULES: Record<string, Rule | false> = {
  "/get-session": false,
  "/sign-in/email": { window: 300, max: 30 },
  "/sign-up/email": { window: 3600, max: 50 },
};
