import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { runAction } from "@/lib/studio/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Deterministic Studio actions (audit, tie-out, banker formatting, refresh data tables, add a template). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { action?: string; args?: Record<string, unknown> } | null;
    if (!body?.action) return NextResponse.json({ error: "Name an action" }, { status: 400 });
    return NextResponse.json(await runAction(user, id, body.action, body.args ?? {}));
  });
}
