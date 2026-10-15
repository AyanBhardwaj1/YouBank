import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { runNow } from "@/lib/algo/live";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST {} — decide now: paper fills, approval proposes a batch, autonomous sends (through the risk engine). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`algo-run:${user.id}`, 6, 60_000, "Too many runs at once. Wait a moment.");
    return NextResponse.json(await runNow(user, Number((await ctx.params).id) || 0, requestMeta(req)));
  });
}
