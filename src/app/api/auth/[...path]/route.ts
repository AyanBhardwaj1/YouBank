import { eq } from "drizzle-orm";
import { getSessionCookie } from "better-auth/cookies";
import { requireDb, schema } from "@/db";
import { auth } from "@/lib/auth/server";
import { noteSessionChange, type SessionChange } from "@/lib/auth/user";

/**
 * Sign-in's own endpoints (Google redirect and callback, session, sign-out). The handler is built on the
 * first request, not at import, so a missing auth setting fails the request (logged, see
 * instrumentation) rather than the module's import.
 */
const handle = (req: Request) => auth.handler(req);

/** The endpoints that end sessions or change who the person is, by their path under /api/auth. */
const CHANGES = new Set(["sign-out", "revoke-session", "revoke-sessions", "revoke-other-sessions", "change-password", "delete-user", "update-user", "change-email"]);

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

/**
 * POST: as above, and for an endpoint that ends sessions or changes the account, the change is noted on
 * this instance once Better Auth has made it (src/lib/auth/user: noteSessionChange), so a revoked
 * session stops working here at once instead of being reused from the per-instance check cache.
 */
async function post(req: Request): Promise<Response> {
  const name = new URL(req.url).pathname.replace(/^\/api\/auth\//, "").replace(/\/+$/, "");
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
