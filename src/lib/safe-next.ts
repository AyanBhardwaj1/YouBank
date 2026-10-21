/**
 * Where to land after signing in or onboarding: a `next` path, only inside the app (never another
 * site, never a protocol-relative URL). Anything else is the app's home. Pure; safe on the client.
 *
 * The path is resolved the way a browser resolves it before it is checked, so dot segments, plain or
 * percent-encoded ("/app/../api/auth", "/app/%2e%2e/sign-in"), cannot climb out of /app into the API,
 * the auth endpoints or the sign-in page (a loop). What is returned is that resolved path.
 */
export const safeNext = (v: unknown): string => {
  if (typeof v !== "string" || !/^\/app(\/[A-Za-z0-9/_\-?=&.%]*)?$/.test(v) || v.startsWith("//")) return "/app";
  try {
    const u = new URL(v, "http://n.invalid");
    if (u.origin !== "http://n.invalid" || !(u.pathname === "/app" || u.pathname.startsWith("/app/"))) return "/app";
    return u.pathname + u.search;
  } catch {
    return "/app";
  }
};
