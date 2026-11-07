import { and, eq } from "drizzle-orm";
import { getSessionCookie } from "better-auth/cookies";
import { requireDb, schema } from "@/db";
import { auth } from "@/lib/auth/server";
import { STEP_UP_ATTEMPTS, STEP_UP_WINDOW_MS, stepUpState, stepUpVerdict, twoFactorEnabled, TWO_FACTOR_REQUIRED } from "@/lib/auth/step-up";
import { withinRate } from "@/lib/locks";
import { currentUser, noteSessionChange, type SessionChange } from "@/lib/auth/user";
import { errorResponse } from "@/lib/errors";

/**
 * Sign-in's own endpoints (Google redirect and callback, session, sign-out). The handler is built on the
 * first request, not at import, so a missing auth setting fails the request (logged, see
 * instrumentation) rather than the module's import.
 */
const handle = (req: Request) => auth.handler(req);

/** The endpoints that end sessions or change who the person is, by their path under /api/auth. */
const CHANGES = new Set(["sign-out", "revoke-session", "revoke-sessions", "revoke-other-sessions", "change-password", "delete-user", "update-user", "change-email"]);

/**
 * Two-factor endpoints that swap this browser's session for a new one (turning 2FA off, and the first
 * code that finishes turning it on): the old session is deleted, and is refused here at once.
 */
const ROTATES = new Set(["two-factor/disable", "two-factor/verify-totp"]);

/**
 * Two-factor changes that need a fresh authenticator code while 2FA is on. Without this, anyone holding
 * a Google-only account's session (no password to ask for) could turn 2FA off, read the secret, mint
 * new backup codes or re-enrol their own authenticator, and then pass every step-up check.
 */
const NEEDS_STEP_UP = new Set(["two-factor/enable", "two-factor/disable", "two-factor/get-totp-uri", "two-factor/generate-backup-codes"]);

/**
 * Code checks made with a session (finishing enrolment, or a guess with a stolen cookie). The plugin
 * counts no attempts for these, so with 2FA already on they share the step-up route's budget per person;
 * otherwise a stolen session could find a valid code here and then pass /api/security/step-up with it.
 */
const SIGNED_IN_VERIFY = new Set(["two-factor/verify-totp", "two-factor/verify-backup-code"]);

/** Turning 2FA on without a password needs a sign-in this recent, so an old stolen cookie cannot enrol its own authenticator. */
const FRESH_SIGN_IN_MS = 15 * 60_000;

/**
 * The session this request's cookie names, read before Better Auth changes it: the token from the cookie
 * and its owner from the database. Deliberately not auth.api.getSession, which may refresh the session
 * and set cookies on this same response (a sign-out could then hand the browser a fresh session cookie).
 */
async function sessionOf(req: Request): Promise<{ token: string; userId: string | null } | null> {
  const raw = getSessionCookie(req);
  if (!raw) return null;
  let token = "";
  try { token = decodeURIComponent(raw).split(".")[0] ?? ""; } catch { return null; }
  if (!token) return null;
  const [row] = await requireDb().select({ userId: schema.authSessions.userId }).from(schema.authSessions)
    .where(eq(schema.authSessions.token, token)).catch(() => []);
  return { token, userId: row?.userId ?? null };
}

/** Whether a response set a new session cookie for a token other than `token`. Pure. */
function setsOtherSession(setCookies: string[], token: string): boolean {
  return setCookies.some((c) => {
    const m = /^(?:__Secure-)?better-auth\.session_token=([^;]*)/.exec(c);
    if (!m?.[1]) return false;
    let v = m[1];
    try { v = decodeURIComponent(v); } catch { /* kept as sent */ }
    return v.split(".")[0] !== token;
  });
}

/** With 2FA already on, a signed-in code check counts against the person's step-up budget; a 429 once it is spent. */
async function verifyBudget(req: Request): Promise<Response | null> {
  const s = await sessionOf(req);
  if (!s?.userId || !(await twoFactorEnabled(s.userId))) return null;
  if (await withinRate(`step-up:${s.userId}`, STEP_UP_ATTEMPTS, STEP_UP_WINDOW_MS)) return null;
  return Response.json({ error: "Too many codes tried. Wait 15 minutes and try again." }, { status: 429 });
}

/**
 * Turning 2FA on for an account with no password: the session must come from a sign-in in the last 15
 * minutes (an account with a password proves itself with it instead). A 403 `reauth_required` otherwise.
 */
async function staleEnrolment(req: Request): Promise<Response | null> {
  const s = await sessionOf(req);
  if (!s?.userId) return null;
  const db = requireDb();
  const [cred] = await db.select({ id: schema.authAccounts.id }).from(schema.authAccounts)
    .where(and(eq(schema.authAccounts.userId, s.userId), eq(schema.authAccounts.providerId, "credential"))).limit(1);
  if (cred) return null;
  const [row] = await db.select({ createdAt: schema.authSessions.createdAt }).from(schema.authSessions).where(eq(schema.authSessions.token, s.token)).limit(1);
  if (row && Date.now() - row.createdAt.getTime() <= FRESH_SIGN_IN_MS) return null;
  return Response.json({ error: "For your security, sign out and sign in again, then turn on two-factor within 15 minutes.", code: "reauth_required" }, { status: 403 });
}

/** A 403 the settings page reads like any gated route's (`code: "two_factor_required"`), or null to go ahead. */
async function stepUpRefusal(): Promise<Response | null> {
  const user = await currentUser();
  // Signed out: Better Auth answers that itself.
  if (!user) return null;
  const { enabled, recent } = await stepUpState(user);
  // With 2FA off there is nothing to protect yet (turning it on is how it starts).
  if (!enabled) return null;
  const v = stepUpVerdict(enabled, recent);
  return v.ok ? null : Response.json({ error: v.message, code: TWO_FACTOR_REQUIRED }, { status: 403 });
}

/**
 * POST: as above, and for an endpoint that ends sessions or changes the account, the change is noted on
 * this instance once Better Auth has made it (src/lib/auth/user: noteSessionChange), so a revoked
 * session stops working here at once instead of being reused from the per-instance check cache.
 */
async function post(req: Request): Promise<Response> {
  const name = new URL(req.url).pathname.replace(/^\/api\/auth\//, "").replace(/\/+$/, "");
  if (NEEDS_STEP_UP.has(name)) {
    // A check that fails (the database not answering) refuses: it never waves the change through.
    const refusal = await stepUpRefusal().catch((e: unknown) => errorResponse(e));
    if (refusal) return refusal;
    if (name === "two-factor/enable") {
      const stale = await staleEnrolment(req).catch((e: unknown) => errorResponse(e));
      if (stale) return stale;
    }
  }
  if (SIGNED_IN_VERIFY.has(name)) {
    const limited = await verifyBudget(req).catch((e: unknown) => errorResponse(e));
    if (limited) return limited;
  }
  if (ROTATES.has(name)) {
    const session = await sessionOf(req);
    const res = await handle(req);
    if (res.ok && session && setsOtherSession(res.headers.getSetCookie(), session.token)) noteSessionChange(session.userId, { kind: "revoke-token", token: session.token });
    return res;
  }
  if (!CHANGES.has(name)) return handle(req);
  const before = Date.now();
  const [session, body] = await Promise.all([
    sessionOf(req),
    req.clone().json().catch(() => null) as Promise<{ token?: unknown; revokeOtherSessions?: unknown } | null>,
  ]);
  const res = await handle(req);
  if (!res.ok || !session) return res;
  const { token, userId } = session;
  const change: SessionChange | null =
    name === "sign-out" ? { kind: "revoke-token", token }
      : name === "revoke-session" ? (typeof body?.token === "string" ? { kind: "revoke-token", token: body.token } : null)
        : name === "revoke-sessions" || name === "delete-user" ? { kind: "revoke-all", before, keep: null }
          : name === "revoke-other-sessions" ? { kind: "revoke-all", before, keep: token }
            // With revokeOtherSessions every session goes and a new one is made for this browser.
            : name === "change-password" ? (body?.revokeOtherSessions === true ? { kind: "revoke-all", before, keep: null } : { kind: "refresh" })
              : { kind: "refresh" };
  if (change) noteSessionChange(userId, change);
  return res;
}

export const GET = handle;
export const POST = post;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
