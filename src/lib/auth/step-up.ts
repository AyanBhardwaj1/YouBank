/**
 * Step-up: a fresh authenticator code before a risky action (saving broker keys, live trading consent,
 * a brokerage or mailbox connection), whatever way the person signed in. Better Auth's twoFactor plugin
 * only challenges password sign-in, so a Google sign-in, or a stolen session cookie, would otherwise
 * reach these actions with no second factor at all.
 *
 * POST /api/security/step-up checks a code (rate-limited there: the plugin has no lockout for a
 * signed-in check) and sets `yb-stepup`, an httpOnly cookie holding the person's id and an expiry ten
 * minutes out, signed with HMAC-SHA256 under a key derived from BETTER_AUTH_SECRET. Gated routes call
 * requireRecentTwoFactor(user), which refuses with a 403 and `code: "two_factor_required"` unless 2FA is
 * on and that cookie is valid for this person.
 *
 * The cookie logic (sign, read, decide) is pure and takes the secret and the time, so
 * scripts/test-step-up.ts runs it without a database. Server only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "./user";

export const STEP_UP_COOKIE = "yb-stepup";
/** How long one code unlocks risky actions for. */
export const STEP_UP_TTL_MS = 10 * 60_000;
/** Codes tried per person per window on the step-up endpoint (6 digits: 8 tries in 15 minutes). */
export const STEP_UP_ATTEMPTS = 8;
export const STEP_UP_WINDOW_MS = 15 * 60_000;

export const TWO_FACTOR_REQUIRED = "two_factor_required";
export const NOT_ENABLED_MESSAGE = "Turn on two-factor authentication in Settings → Security first.";
export const NEEDS_CODE_MESSAGE = "Enter your authenticator code to continue.";

/** The signing key: derived from the auth secret, so it is never the secret itself. Pure. */
const keyFor = (secret: string) => createHmac("sha256", secret).update("youbank:step-up:v1").digest();
const mac = (payload: string, secret: string) => createHmac("sha256", keyFor(secret)).update(payload).digest("base64url");

/** The cookie's value for `userId`, good until `now + STEP_UP_TTL_MS`. Pure. */
export function signStepUp(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, x: now + STEP_UP_TTL_MS })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/**
 * When the cookie stops counting, or null when it does not count for `userId` now: missing, altered,
 * signed under another secret, for someone else, or expired. Pure.
 */
export function readStepUp(value: string | null | undefined, userId: string, secret: string, now = Date.now()): number | null {
  if (!value || !secret) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const want = Buffer.from(mac(payload, secret)), got = Buffer.from(value.slice(dot + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; x?: unknown };
    if (v.u !== userId || typeof v.x !== "number" || !Number.isFinite(v.x)) return null;
    // Never longer than one window from now (a minute's slack for clocks between instances).
    return v.x > now && v.x <= now + STEP_UP_TTL_MS + 60_000 ? v.x : null;
  } catch {
    return null;
  }
}

export type StepUpVerdict = { ok: true } | { ok: false; reason: "not_enabled" | "needs_code"; message: string };

/** Whether a risky action may go ahead, given whether 2FA is on and whether a code was entered recently. Pure. */
export function stepUpVerdict(enabled: boolean, recent: boolean): StepUpVerdict {
  if (!enabled) return { ok: false, reason: "not_enabled", message: NOT_ENABLED_MESSAGE };
  if (!recent) return { ok: false, reason: "needs_code", message: NEEDS_CODE_MESSAGE };
  return { ok: true };
}

/** The refusal requireRecentTwoFactor throws: a 403 that guarded() answers with `{ error, code }`. */
export const twoFactorRequired = (message: string) => Object.assign(new Error(message), { status: 403, code: TWO_FACTOR_REQUIRED });

/** The cookie's attributes: this site only, never readable by scripts, secure wherever the site is HTTPS. */
export function stepUpCookieOptions(https: boolean) {
  return { httpOnly: true, secure: https, sameSite: "lax" as const, path: "/", maxAge: STEP_UP_TTL_MS / 1000 };
}

const secret = () => process.env.BETTER_AUTH_SECRET?.trim() ?? "";

/** The development sign-in (YOUBANK_DEV_USER, never in production builds) has no auth row to enrol. */
const devUser = (user: Pick<CurrentUser, "id">) => process.env.NODE_ENV !== "production" && !!process.env.YOUBANK_DEV_USER && user.id.startsWith("dev-");

/** Whether the person has finished turning on two-factor (one indexed read). */
export async function twoFactorEnabled(userId: string): Promise<boolean> {
  const [row] = await requireDb().select({ on: schema.authUsers.twoFactorEnabled }).from(schema.authUsers).where(eq(schema.authUsers.id, userId)).limit(1);
  return row?.on === true;
}

/** Whether 2FA is on, and whether this browser entered a code for this person in the last ten minutes. */
export async function stepUpState(user: Pick<CurrentUser, "id">): Promise<{ enabled: boolean; recent: boolean }> {
  if (devUser(user)) return { enabled: true, recent: true };
  const enabled = await twoFactorEnabled(user.id);
  const jar = await cookies();
  return { enabled, recent: enabled && readStepUp(jar.get(STEP_UP_COOKIE)?.value, user.id, secret()) !== null };
}

/** Throw a 403 (`code: "two_factor_required"`) unless 2FA is on and a code was entered in the last ten minutes. */
export async function requireRecentTwoFactor(user: Pick<CurrentUser, "id">): Promise<void> {
  const { enabled, recent } = await stepUpState(user);
  const v = stepUpVerdict(enabled, recent);
  if (!v.ok) throw twoFactorRequired(v.message);
}

/** Remember a verified code on this browser for STEP_UP_TTL_MS. Route handlers only (it sets a cookie). */
export async function grantStepUp(user: Pick<CurrentUser, "id">, https: boolean): Promise<number> {
  const value = signStepUp(user.id, secret());
  (await cookies()).set(STEP_UP_COOKIE, value, stepUpCookieOptions(https));
  return Date.now() + STEP_UP_TTL_MS;
}
