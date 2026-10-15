import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { cancelAlgoOrder } from "@/lib/algo/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** DELETE — cancel one open order at the broker, or a TWAP slice that has not been sent. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await cancelAlgoOrder(user, Number((await ctx.params).id) || 0, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
