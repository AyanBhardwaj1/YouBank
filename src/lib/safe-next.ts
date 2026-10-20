/**
 * Where to land after signing in or onboarding: a `next` path, only inside the app (never another
 * site, never a protocol-relative URL). Anything else is the app's home. Pure; safe on the client.
 */
export const safeNext = (v: unknown): string =>
  typeof v === "string" && /^\/app(\/[A-Za-z0-9/_\-?=&.%]*)?$/.test(v) && !v.startsWith("//") ? v : "/app";
