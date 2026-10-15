import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { setStrategyKill } from "@/lib/algo/store";

export const dynamic = "force-dynamic";

/** POST { on, reason? } — this strategy's kill switch. On cancels its unsent batches. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { on?: unknown; reason?: unknown };
    await setStrategyKill(user, Number((await ctx.params).id) || 0, body.on === true, typeof body.reason === "string" ? body.reason.slice(0, 200) : null, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
