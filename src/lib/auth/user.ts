import { cache } from "react";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "./server";
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
  const key = jar ? jar.getAll().filter((c) => c.name.includes("better-auth.session")).map((c) => `${c.name}=${c.value}`).sort().join(";") : "";
  const seen = key ? verified.get(key) : undefined;
  if (seen && seen.until > Date.now()) return seen.user;
  // Answered from the signed cookie cache while it is fresh (SESSION_DATA_TTL), else from the database.
  const session = await auth.api.getSession({ headers: await headers() });
  const u = session?.user;
  const user = u ? { id: u.id, email: u.email ?? "", name: u.name ?? "" } : null;
  if (user && key) {
    if (verified.size >= 5_000) verified.clear();
    verified.set(key, { user, until: Date.now() + VERIFIED_TTL_MS });
  }
  return user;
});

/**
 * Sessions verified on this instance in the last few seconds, by their exact cookies. Every API request
 * otherwise re-parses and re-verifies the same signed cookie (an HMAC, a JSON parse and a schema check);
 * a person's page polls several routes a minute. Only a successful check is kept, for less time than the
 * signed cookie itself is trusted (SESSION_DATA_TTL), so it never extends a session: a changed or
 * removed cookie is a different key, and signing out clears the cookies.
 */
const VERIFIED_TTL_MS = 30_000;
const verified = sharedMap<string, { user: CurrentUser; until: number }>("auth:verified");

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
