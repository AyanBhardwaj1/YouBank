import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { requestMeta } from "@/lib/copytrade/access";
import { copyTargets } from "@/lib/copytrade/analytics";
import { batchesOf } from "@/lib/copytrade/live";
import { closeCopy, cleanCopy, getCopy, paperPerformance, updateCopy } from "@/lib/copytrade/portfolios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => Number((await ctx.params).id) || 0;

/** GET — a copy: its targets now, a paper copy's record, a live copy's recent batches and orders. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const row = await getCopy(user.id, await idOf(ctx));
    const c = cleanCopy({ ...row } as unknown as Record<string, unknown>);
    const [targets, performance, batches] = await Promise.all([
      copyTargets(c.funds, c.rules, false),
      row.mode === "paper" ? paperPerformance(row) : Promise.resolve(null),
      row.mode === "live" && (await canUse(user, "copytrade.broker")) ? batchesOf(user.id, row.id) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      copy: { id: row.id, name: row.name, mode: row.mode, status: row.status, funds: row.funds, rules: c.rules, sizing: c.sizing, trading: c.trading, accountId: row.accountId, managed: row.managed, createdAt: row.createdAt.toISOString() },
      targets, performance, batches,
    });
  });
}

/** PATCH — change settings, or { status: "paused" | "active" }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const row = await updateCopy(user, await idOf(ctx), (await req.json().catch(() => ({}))) as Record<string, unknown>, requestMeta(req));
    return NextResponse.json({ id: row.id, status: row.status });
  });
}

/** DELETE — close the copy (unsent proposals are canceled; shares already bought stay in the account). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await closeCopy(user, await idOf(ctx), requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
