import { NextResponse } from "next/server";
import { auth } from "./server";

export type CurrentUser = { id: string; email: string; name: string };

export async function currentUser(): Promise<CurrentUser | null> {
  // Development-only bypass for local API testing. Never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) {
    return { id: `dev-${process.env.YOUBANK_DEV_USER}`, email: `${process.env.YOUBANK_DEV_USER}@localhost`, name: process.env.YOUBANK_DEV_USER };
  }
  const { data } = await auth.getSession();
  const u = data?.user;
  return u ? { id: u.id, email: u.email ?? "", name: u.name ?? "" } : null;
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

/** Wrap a handler so an Unauthorized error becomes a 401 and other errors a 500. */
export function guarded(fn: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  return requireUser().then(fn).catch((e) => {
    if (e instanceof Unauthorized) return unauthorized();
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  });
}
