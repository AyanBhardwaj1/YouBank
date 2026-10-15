import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { liquidate } from "@/lib/algo/live";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { confirmation } — sell everything this strategy holds (only its own holdings). Live needs "CLOSE <NAME>". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { confirmation?: unknown };
    return NextResponse.json(await liquidate(user, Number((await ctx.params).id) || 0, body, requestMeta(req)));
  });
}
