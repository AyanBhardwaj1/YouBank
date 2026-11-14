import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { auth } from "@/lib/auth/server";
import { issueRecoveryKey, recoveryStatus } from "@/lib/auth/recovery";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** GET: whether this account has a recovery key, and since when (never the key itself). */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await recoveryStatus(user.id), { headers: { "Cache-Control": "private, no-store" } }));
}

/** A new account's first key needs nothing more; after that, proof that this is really the owner. */
const NEW_ACCOUNT_MS = 30 * 60_000, FRESH_SIGN_IN_MS = 15 * 60_000;

/**
 * POST { password? }: make a new recovery key (replacing any old one) and return it, once. A key is a way to
 * set a new password, so a stolen session alone must not be able to mint one: it needs the current password,
 * or, for an account with no password (Google only), a sign-in in the last fifteen minutes. The first key of
 * an account made in the last half hour (the one shown at sign-up) needs neither.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`recovery-issue:${user.id}`, 10, 60 * 60_000, "That is many new recovery keys for one hour. Try again later.");
    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const ctx = await auth.$context;
    const [me] = await requireDb().select({ createdAt: schema.authUsers.createdAt }).from(schema.authUsers).where(eq(schema.authUsers.id, user.id)).limit(1);
    const status = await recoveryStatus(user.id);
    const accounts = await ctx.internalAdapter.findAccounts(user.id);
    const credential = accounts.find((a) => a.providerId === "credential" && a.password);
    let allowed = !status.has && !!me && Date.now() - new Date(me.createdAt).getTime() < NEW_ACCOUNT_MS;
    if (!allowed && credential && password) allowed = await ctx.password.verify({ hash: credential.password!, password });
    if (!allowed && !credential) {
      const s = await auth.api.getSession({ headers: await headers() }).catch(() => null);
      allowed = !!s && Date.now() - new Date(s.session.createdAt).getTime() < FRESH_SIGN_IN_MS;
    }
    if (!allowed) {
      return NextResponse.json({ error: credential ? (password ? "That password is not right." : "Enter your password to make a new recovery key.") : "Sign out and sign in again, then make a new recovery key within fifteen minutes.", needsPassword: !!credential }, { status: 403 });
    }
    const key = await issueRecoveryKey(user.id);
    return NextResponse.json({ key }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
