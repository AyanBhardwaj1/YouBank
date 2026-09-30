import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { deployMonitor, stopMonitor } from "@/lib/edge/monitors";
import "@/lib/edge/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Deploy the canvas as a monitor: { schedule: daily|weekly, alert: immediate|digest }. It runs once now. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { schedule?: string; alert?: string };
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const r = await deployMonitor(user, id, body);
    return NextResponse.json({ monitor: r.monitor, runId: r.runId, hasSignal: r.hasSignal });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await stopMonitor(user, id);
    return NextResponse.json({ ok: true });
  });
}
