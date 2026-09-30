import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * How long the signed session cookie is trusted before the server asks Neon Auth again (seconds).
 * Every signed-in person costs one such call per period, all from our servers' addresses, and Neon
 * Auth rate-limits them: at the SDK's default of five minutes, a load test from one address started
 * signing people out at about 17 refreshes a second. Fifteen minutes cuts those calls to a third; the
 * cost is that a session revoked elsewhere keeps working for up to that long.
 */
const SESSION_DATA_TTL = Math.min(Math.max(Number(process.env.NEON_AUTH_SESSION_DATA_TTL) || 900, 60), 3_600);

/** Server-side Neon Auth (managed Better Auth): handler, middleware, and session access. */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET!, sessionDataTtl: SESSION_DATA_TTL },
});
