import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { twoFactorEnabled } from "@/lib/auth/step-up";

export const dynamic = "force-dynamic";

/**
 * GET: `{ enabled, hasPassword }` for Settings → Security. Turning two-factor on or off asks for the
 * password only when the account has one (a "credential" sign-in); a Google-only account has none.
 */
export async function GET() {
  return guarded(async (user) => {
    const [enabled, [cred]] = await Promise.all([
      twoFactorEnabled(user.id),
      requireDb().select({ id: schema.authAccounts.id }).from(schema.authAccounts)
        .where(and(eq(schema.authAccounts.userId, user.id), eq(schema.authAccounts.providerId, "credential"))).limit(1),
    ]);
    return NextResponse.json({ enabled, hasPassword: !!cred });
  });
}
