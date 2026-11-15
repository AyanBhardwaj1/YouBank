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
  // A whole office, campus or conference on one wifi shares an address: enough for a room signing in at once.
  // Guessing one account's password is stopped per account instead (accountLimit below).
  "/sign-in/email": { window: 300, max: 150 },
  "/sign-up/email": { window: 3600, max: 200 },
};

/** Password sign-in tries per account (by email, whatever the address): enough for a few typos, not a guessing run. */
export const ACCOUNT_RULE: Rule = { window: 900, max: 10 };
export const ACCOUNT_LIMITED = "Too many sign-in attempts for this account. Wait 15 minutes, or reset your password from “Forgot your password?”.";

/** Whether another password sign-in for this email is allowed now. Fails open, like the other limits. */
export async function accountLimit(email: unknown): Promise<boolean> {
  const e = typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "";
  if (!e) return true;
  return withinRate(`auth:account:${e}`, ACCOUNT_RULE.max, ACCOUNT_RULE.window * 1000);
}
