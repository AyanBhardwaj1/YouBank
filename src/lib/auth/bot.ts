/**
 * Keeping bots out of sign-up and out of "email me a reset link" (which a bot can use to flood someone's inbox):
 * - Cloudflare Turnstile, when TURNSTILE_SECRET_KEY (server) and NEXT_PUBLIC_TURNSTILE_SITE_KEY (browser) are
 *   set: the form gets a mostly invisible challenge, and the server checks its token with Cloudflare before the
 *   request goes any further. Turnstile is free, private (no image puzzles, no tracking) and fails closed: no
 *   valid token, no account.
 * - A honeypot, always: the forms carry a field people never see (hidden from sight and from screen readers)
 *   whose value travels as the x-yb-hp header; form-filling bots fill it and are refused.
 * Together with the per-address limits on sign-up (src/lib/auth/rate-limit.ts). Server only.
 */
type Env = Record<string, string | undefined>;

export const BOT_PATHS = new Set(["/sign-up/email", "/request-password-reset"]);
export const TOKEN_HEADER = "x-turnstile-token";
export const HONEYPOT_HEADER = "x-yb-hp";
export const BOT_REFUSED = "We could not confirm you are a person. Reload the page and try again.";
const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Whether Turnstile is checked on the server. Pure. */
export const turnstileOn = (env: Env = process.env) => !!env.TURNSTILE_SECRET_KEY?.trim();

/** Whether the honeypot was filled (a bot). Pure. */
export const honeypotTripped = (value: string | null | undefined) => !!value && value.trim().length > 0;

/**
 * Ask Cloudflare whether a Turnstile token is good. A missing token, a refusal or no answer within five seconds
 * all count as no: an account is never made on a check that did not happen.
 */
export async function verifyTurnstile(token: string | null | undefined, ip: string | null, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
  try {
    const res = await fetcher(VERIFY, { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}

/** The whole check for one request to a guarded path: null when it may go on, else the refusal. */
export async function botCheck(path: string, headers: Headers | undefined, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!BOT_PATHS.has(path)) return null;
  if (honeypotTripped(headers?.get(HONEYPOT_HEADER))) return BOT_REFUSED;
  if (!turnstileOn(env)) return null;
  const ip = headers?.get("x-real-ip") ?? headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return (await verifyTurnstile(headers?.get(TOKEN_HEADER), ip, env, fetcher)) ? null : BOT_REFUSED;
}
