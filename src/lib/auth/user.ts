import { cache } from "react";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth, SESSION_DATA_TTL } from "./server";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "./admin";
import { errorResponse, isMissingTable } from "@/lib/errors";
import { db, notConfigured } from "@/db";
import { sharedMap } from "@/lib/shared";

export type CurrentUser = { id: string; email: string; name: string };

/**
 * Better Auth's session cookie. Without it there cannot be a session, so we can answer "signed out"
 * without a database read. Matched on the suffix because the library prefixes the name with
 * `__Secure-` only where the browser will accept it.
 */
const SESSION_COOKIE_SUFFIX = "better-auth.session_token";

/**
 * The signed-in user, or null.
 *
 * Wrapped in `cache()` so the layout, the page and any route handler in one request share a single
 * lookup instead of each making its own call.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  // Development-only bypass for local API testing. Never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) {
    // A dotted domain so locally-created users pass the same email validation as real ones.
    return { id: `dev-${process.env.YOUBANK_DEV_USER}`, email: `${process.env.YOUBANK_DEV_USER}@dev.local`, name: process.env.YOUBANK_DEV_USER };
  }
  // Without a database or the auth secret nobody can be signed in (pages show "being set up").
  if (!db || !process.env.BETTER_AUTH_SECRET?.trim()) return null;
  // Anonymous visitors carry no session cookie; skip the lookup entirely.
  const jar = await cookies().catch(() => null);
  if (jar && !jar.getAll().some((c) => c.name.endsWith(SESSION_COOKIE_SUFFIX))) return null;
  // The same signed cookies seen moments ago on this instance: the same person (see VERIFIED_TTL_MS).
  const key = jar ? sessionKey(jar.getAll()) : "";
  const now = Date.now();
  const seen = key ? verified.get(key) : undefined;
  if (seen && seen.until > now) return seen.user;
  if (seen) verified.delete(key);
  // Answered from the signed cookie cache while it is fresh (SESSION_DATA_TTL), else from the database.
  const session = await auth.api.getSession({ headers: await headers() });
  const u = session?.user;
  if (!u) return null;
  const s = session.session;
  // Revoked on this instance (signed out, revoked, password changed with other sessions signed out):
  // refused at once, even though the signed cookie itself is still within SESSION_DATA_TTL.
  if (revokedHere(u.id, s.token, new Date(s.createdAt).getTime())) return null;
  const user = { id: u.id, email: u.email ?? "", name: u.name ?? "" };
  if (key) {
    // Never past the session's own end, nor past the signed cookie's (both may fall inside the window).
    const until = Math.min(now + VERIFIED_TTL_MS, new Date(s.expiresAt).getTime(), cookieCacheExpiry(jar!.getAll()) ?? Infinity);
    if (until > now) {
      if (verified.size >= MAX_VERIFIED) prune(verified, now, (v) => v.until);
      verified.set(key, { user, token: s.token, until });
    }
  }
  return user;
});

/**
 * Sessions verified on this instance in the last few seconds, by their exact cookies (the full signed
 * values, every Better Auth session cookie). Every API request otherwise re-parses and re-verifies the
 * same signed cookie (an HMAC, a JSON parse and a schema check); a person's page polls several routes a
 * minute. Only a successful check is kept, for at most VERIFIED_TTL_MS and never past the session's or
 * the signed cookie's expiry, so it never extends a session: a changed or removed cookie is a different
 * key, and signing out clears the cookies.
 *
 * Revocation: the auth route (src/app/api/auth/[...path]) calls noteSessionChange for sign-out, session
 * revokes, a password change that signs other sessions out, and account changes, which drops the person's
 * entries here and refuses the revoked sessions on THIS instance at once, even for a copied cookie. Other
 * instances do not hear of it: there a revoked cookie keeps working for up to VERIFIED_TTL_MS from this
 * cache, and, as before this cache, for up to SESSION_DATA_TTL (src/lib/auth/server.ts) from Better
 * Auth's own signed cookie cache, which never asks the database while fresh.
 */
const VERIFIED_TTL_MS = 30_000;
const MAX_VERIFIED = 5_000;
const verified = sharedMap<string, { user: CurrentUser; token: string; until: number }>("auth:verified");
/** Session tokens revoked on this instance, until their signed cookie could no longer be trusted anyway. */
const revokedTokens = sharedMap<string, number>("auth:revoked-tokens");
/** Per person: sessions created before `before` are revoked (all of them, or all but `keep`), until `until`. */
const revokedUsers = sharedMap<string, { before: number; keep: string | null; until: number }>("auth:revoked-users");

/** The cache key: every Better Auth session cookie, name and full signed value, in a fixed order. Pure. */
export function sessionKey(cookies: { name: string; value: string }[]): string {
  return cookies.filter((c) => c.name.includes("better-auth.session")).map((c) => `${c.name}=${c.value}`).sort().join(";");
}

/**
 * When Better Auth's signed session-data cookie stops being trusted (its `expiresAt`), read without
 * verifying: it only ever shortens how long a check is reused. Null when absent or not readable. Pure.
 */
export function cookieCacheExpiry(cookies: { name: string; value: string }[]): number | null {
  const c = cookies.find((x) => x.name.endsWith("better-auth.session_data"));
  if (!c) return null;
  try {
    const at = (JSON.parse(Buffer.from(c.value, "base64url").toString("utf8")) as { expiresAt?: unknown }).expiresAt;
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Keep a map bounded: drop what has expired, then the oldest entries (a Map keeps insertion order). */
function prune<V>(m: Map<string, V>, now: number, until: (v: V) => number) {
  for (const [k, v] of m) if (until(v) <= now) m.delete(k);
  for (const k of m.keys()) { if (m.size < MAX_VERIFIED) break; m.delete(k); }
}

export function revokedHere(userId: string, token: string, createdAt: number): boolean {
  const now = Date.now();
  const t = revokedTokens.get(token);
  if (t !== undefined && t > now) return true;
  const r = revokedUsers.get(userId);
  return !!r && r.until > now && r.keep !== token && createdAt < r.before;
}

export type SessionChange =
  | { kind: "revoke-token"; token: string }
  /** Every session of the person created before `before`, except `keep`. */
  | { kind: "revoke-all"; before: number; keep: string | null }
  /** Nothing revoked, but the cached name or email may be stale. */
  | { kind: "refresh" };

/**
 * A session change made on this instance (the auth route calls it after Better Auth accepted the change):
 * the person's reused checks are dropped, and revoked sessions are refused here from now on, for as long
 * as their signed cookie would otherwise still be trusted.
 */
export function noteSessionChange(userId: string | null, change: SessionChange) {
  const now = Date.now();
  const until = now + SESSION_DATA_TTL * 1000 + VERIFIED_TTL_MS;
  if (change.kind === "revoke-token") {
    if (revokedTokens.size >= MAX_VERIFIED) prune(revokedTokens, now, (v) => v);
    revokedTokens.set(change.token, until);
  } else if (change.kind === "revoke-all" && userId) {
    if (revokedUsers.size >= MAX_VERIFIED) prune(revokedUsers, now, (v) => v.until);
    revokedUsers.set(userId, { before: change.before, keep: change.keep, until });
  }
  // `userId` is null when the session's row was already gone (revoked elsewhere): its token still goes.
  const token = change.kind === "revoke-token" ? change.token : null;
  for (const [k, v] of verified) if ((userId && v.user.id === userId) || v.token === token) verified.delete(k);
}

export class Unauthorized extends Error {
  constructor() { super("Unauthorized"); }
}

/** Route handlers call this first; a missing session becomes a 401 via `unauthorized()`. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) throw new Unauthorized();
  return u;
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

/**
 * Wrap a handler so a missing session becomes a 401 and other errors a 500.
 *
 * An error may opt into a different code by carrying a numeric `status` (team permission failures
 * use 403 this way), which keeps this module free of an import cycle with the team layer. Internal
 * errors (a database or network failure) never reach the browser as written: they are logged and
 * answered with a reference (lib/errors).
 */
export function guarded(fn: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  // Not set up yet (no database, or no auth secret outside the development sign-in): a 503 that says
  // so, not "sign in".
  const devUser = process.env.NODE_ENV !== "production" && !!process.env.YOUBANK_DEV_USER;
  if (!db || (!devUser && !process.env.BETTER_AUTH_SECRET?.trim())) return Promise.resolve(errorResponse(notConfigured()));
  return requireUser().then((u) => runAsUser(u.id, () => fn(u), { admin: isAdmin(u) })).catch((e) => {
    if (e instanceof Unauthorized) return unauthorized();
    // A table the code needs is not there yet (a migration not applied): the same 503, logged.
    if (isMissingTable(e)) return errorResponse(Object.assign(notConfigured(), { cause: e }));
    return errorResponse(e);
  });
}
