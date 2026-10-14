import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, requireBroker, sameSiteJson } from "@/lib/copytrade/access";
import { approve, cancelBatch, refreshBatch } from "@/lib/copytrade/live";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => Number((await ctx.params).id) || 0;

/** GET — the batch's orders, with fresh statuses from the broker. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireBroker(user);
    return NextResponse.json({ orders: await refreshBatch(user.id, await idOf(ctx)) });
  });
}

/**
 * POST { idempotencyKey, confirmation } — approve the batch and send its orders, once. A repeat with the
 * same key returns the batch as it stands and sends nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { idempotencyKey?: unknown; confirmation?: unknown };
    return NextResponse.json(await approve(user, await idOf(ctx), body, requestMeta(req)));
  });
}

/** DELETE — cancel a batch that has not been approved. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await cancelBatch(user, await idOf(ctx), requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
