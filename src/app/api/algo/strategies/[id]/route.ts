import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/algo/access";
import { archiveStrategy, getStrategy, updateStrategy } from "@/lib/algo/store";
import { strategyView } from "@/lib/algo/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => Number((await ctx.params).id) || 0;

/** GET — one strategy's dashboard: equity, positions, orders, decisions, risk usage and the live checklist. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => NextResponse.json(await strategyView(user, await getStrategy(user.id, await idOf(ctx)))));
}

/** PATCH { spec?, riskConfirmed?, connection?, accountId?, status? } — edit; risk limits must be saved explicitly before live use. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { spec?: unknown; riskConfirmed?: unknown; connection?: unknown; accountId?: unknown; status?: unknown };
    await updateStrategy(user, await idOf(ctx), { spec: body.spec, riskConfirmed: body.riskConfirmed === true, connection: typeof body.connection === "string" ? body.connection : undefined, accountId: typeof body.accountId === "string" ? body.accountId : body.accountId === null ? null : undefined, status: typeof body.status === "string" ? body.status : undefined }, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}

/** DELETE — archive the strategy (its history stays in the audit log). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await archiveStrategy(user, await idOf(ctx), requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
