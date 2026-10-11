import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { requireDb, schema } from "@/db";
import { siteUrl } from "@/lib/site";

/**
 * How long the signed session cookie is trusted before the session is read from the database again
 * (seconds). Fifteen minutes keeps polling pages from costing a query each; the cost is that a session
 * revoked elsewhere keeps working for up to that long.
 */
export const SESSION_DATA_TTL = Math.min(Math.max(Number(process.env.AUTH_SESSION_DATA_TTL) || 900, 60), 3_600);

function build() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret || !clientId || !clientSecret) throw new Error("Sign-in is not configured: BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  return betterAuth({
    // Google sends people back here, so it must be the address registered with the OAuth client.
    baseURL: process.env.BETTER_AUTH_URL || siteUrl(),
    secret,
    database: drizzleAdapter(requireDb(), {
      provider: "pg",
      schema: { user: schema.authUsers, session: schema.authSessions, account: schema.authAccounts, verification: schema.authVerifications },
    }),
    socialProviders: { google: { clientId, clientSecret, prompt: "select_account" } },
    session: { cookieCache: { enabled: true, maxAge: SESSION_DATA_TTL } },
    account: { encryptOAuthTokens: true },
    // Lets server actions and route handlers set the refreshed session cookie through next/headers.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof build>;
let instance: Auth | null = null;

/**
 * Sign-in (Better Auth, self-hosted on our own database): the handler and session access.
 *
 * Built on first use, not at import: a missing setting would otherwise fail every module that touches
 * the session (every API route) before any of them could answer, leaving bare 500 pages and a health
 * check that cannot report the missing setting. Built lazily, the error is thrown from the call, where
 * guarded() and the error pages turn it into a referenced "our side" message and /api/health names it.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    instance ??= build();
    const value = Reflect.get(instance, prop, instance) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});
