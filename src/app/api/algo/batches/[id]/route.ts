import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { approveAlgoBatch, cancelAlgoBatch } from "@/lib/algo/live";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => Number((await ctx.params).id) || 0;

/** POST { idempotencyKey, confirmation } — approve a proposed live batch and send it once (the risk engine checks every order first). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { idempotencyKey?: unknown; confirmation?: unknown };
    return NextResponse.json(await approveAlgoBatch(user, await idOf(ctx), body, requestMeta(req)));
  });
}

/** DELETE — cancel a batch that has not been approved. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await cancelAlgoBatch(user, await idOf(ctx), requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
