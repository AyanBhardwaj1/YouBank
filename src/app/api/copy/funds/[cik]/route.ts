import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { fundView } from "@/lib/copytrade/analytics";
import { padCik } from "@/lib/copytrade/funds";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — a fund's latest 13F holdings, changes, statistics, filings and mapping coverage (reads new filings from EDGAR first). Free. */
export async function GET(_req: Request, ctx: { params: Promise<{ cik: string }> }) {
  return guarded(async (user) => {
    const cik = padCik((await ctx.params).cik);
    if (!cik) return NextResponse.json({ error: "That is not a CIK." }, { status: 400 });
    await rateLimit(`copy-fund:${user.id}`, 30, 60_000, "Too many fund pages at once. Wait a moment and try again.");
    const [view, follow] = await Promise.all([
      fundView(cik),
      requireDb().select().from(schema.copyFollows).where(and(eq(schema.copyFollows.userId, user.id), eq(schema.copyFollows.cik, cik))),
    ]);
    return NextResponse.json({ ...view, following: follow.length > 0 });
  });
}
