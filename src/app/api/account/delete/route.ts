import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { guarded } from "@/lib/auth/user";
import { auth } from "@/lib/auth/server";
import { requireRecentTwoFactor, twoFactorEnabled } from "@/lib/auth/step-up";
import { sameSiteJson } from "@/lib/copytrade/access";
import { rateLimit } from "@/lib/locks";
import { accountFootprint, blockerMessage, deleteAccount, deletionBlockers } from "@/lib/account/delete";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_SIGN_IN_MS = 15 * 60_000;
const SESSION_COOKIES = ["better-auth.session_token", "better-auth.session_data", "__Secure-better-auth.session_token", "__Secure-better-auth.session_data"];

/** GET: what would be deleted (how many rows in how many places) and anything that must be done first. */
export async function GET() {
  return guarded(async (user) => {
    const [footprint, blockers] = await Promise.all([accountFootprint(user.id), deletionBlockers(user.id)]);
    return NextResponse.json({ items: footprint.reduce((t, f) => t + f.n, 0), places: footprint.length, blocked: blockerMessage(blockers) || null }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/**
 * POST { confirm, password? }: delete the account and everything in it, for good (src/lib/account/delete.ts).
 * `confirm` must be the account's email. The current password is asked for; an account with no password
 * (Google only) needs a sign-in in the last fifteen minutes instead; with two-factor on, a recent code too.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Delete your account from YouBank itself." }, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`account-delete:${user.id}`, 10, 60 * 60_000, "That is many tries for one hour. Try again later.");
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown; password?: unknown };
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json({ error: "Type your account's email exactly to confirm." }, { status: 400 });
    }
    const blockers = await deletionBlockers(user.id);
    if (blockers.length) return NextResponse.json({ error: blockerMessage(blockers) }, { status: 409 });
    const ctx = await auth.$context;
    const credential = (await ctx.internalAdapter.findAccounts(user.id)).find((a) => a.providerId === "credential" && a.password);
    const password = typeof body.password === "string" ? body.password : "";
    if (credential) {
      if (!password || !(await ctx.password.verify({ hash: credential.password!, password }))) {
        return NextResponse.json({ error: password ? "That password is not right." : "Enter your password to delete your account.", needsPassword: true }, { status: 403 });
      }
    } else {
      const s = await auth.api.getSession({ headers: await headers() }).catch(() => null);
      if (!s || Date.now() - new Date(s.session.createdAt).getTime() > FRESH_SIGN_IN_MS) {
        return NextResponse.json({ error: "Sign out and sign in again, then delete your account within fifteen minutes." }, { status: 403 });
      }
    }
    if (await twoFactorEnabled(user.id)) await requireRecentTwoFactor(user);
    const r = await deleteAccount(user.id);
    const res = NextResponse.json({ ok: true, removed: r.rows }, { headers: { "Cache-Control": "private, no-store" } });
    // The sessions are gone with the account; the browser's cookies go too.
    for (const name of SESSION_COOKIES) res.cookies.set(name, "", { path: "/", maxAge: 0, secure: name.startsWith("__Secure-"), httpOnly: true, sameSite: "lax" });
    return res;
  });
}
