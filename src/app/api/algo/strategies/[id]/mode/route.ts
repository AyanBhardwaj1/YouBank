import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { setMode } from "@/lib/algo/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { mode, typed?, gradeOverride? } — switch between backtest, paper, live with approval and live
 * autonomous. Live modes are checked by the live gate with fresh state; what is unmet comes back as a list.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { mode?: unknown; typed?: unknown; gradeOverride?: unknown };
    const r = await setMode(user, Number((await ctx.params).id) || 0, body, requestMeta(req));
    return NextResponse.json(r, { status: r.unmet.length ? 409 : 200 });
  });
}
