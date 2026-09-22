import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "./server";

export type CurrentUser = { id: string; email: string; name: string };

/**
 * Neon Auth's session cookie. Without it there cannot be a session, so we can answer "signed out"
 * locally instead of paying an upstream round-trip. Matched on the suffix because the SDK prefixes
 * the name with `__Secure-` only where the browser will accept it.
 */
const SESSION_COOKIE_SUFFIX = "neon-auth.session_token";

/**
 * The signed-in user, or null.
 *
 * Wrapped in `cache()` so the layout, the page and any route handler in one request share a single
 * lookup instead of each making its own call.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  // Development-only bypass for local API testing. Never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) {
    return { id: `dev-${process.env.YOUBANK_DEV_USER}`, email: `${process.env.YOUBANK_DEV_USER}@localhost`, name: process.env.YOUBANK_DEV_USER };
  }
  // Anonymous visitors carry no session cookie; skip the upstream call entirely.
  const jar = await cookies().catch(() => null);
  if (jar && !jar.getAll().some((c) => c.name.endsWith(SESSION_COOKIE_SUFFIX))) return null;
  const { data } = await auth.getSession();
  const u = data?.user;
  return u ? { id: u.id, email: u.email ?? "", name: u.name ?? "" } : null;
});

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
 * use 403 this way), which keeps this module free of an import cycle with the team layer.
 */
export function guarded(fn: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  return requireUser().then(fn).catch((e) => {
    if (e instanceof Unauthorized) return unauthorized();
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  });
}
