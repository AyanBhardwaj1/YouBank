import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * How long the signed session cookie is trusted before the server asks Neon Auth again (seconds).
 * Every signed-in person costs one such call per period, all from our servers' addresses, and Neon
 * Auth rate-limits them: at the SDK's default of five minutes, a load test from one address started
 * signing people out at about 17 refreshes a second. Fifteen minutes cuts those calls to a third; the
 * cost is that a session revoked elsewhere keeps working for up to that long.
 */
const SESSION_DATA_TTL = Math.min(Math.max(Number(process.env.NEON_AUTH_SESSION_DATA_TTL) || 900, 60), 3_600);

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null = null;

/**
 * Server-side Neon Auth (managed Better Auth): handler, middleware, and session access.
 *
 * Built on first use, not at import: the SDK throws when its settings are missing, and at import that
 * would fail every module that touches the session (every API route, the proxy) before any of them could
 * answer, leaving bare 500 pages and a health check that cannot report the missing setting. Built
 * lazily, the error is thrown from the call, where guarded() and the error pages turn it into a
 * referenced "our side" message and /api/health names the setting.
 */
export const auth: NeonAuth = new Proxy({} as NeonAuth, {
  get(_target, prop) {
    instance ??= createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET!, sessionDataTtl: SESSION_DATA_TTL },
    });
    const value = Reflect.get(instance, prop, instance) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});
