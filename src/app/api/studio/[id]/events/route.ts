import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { eventsSince, requireDoc } from "@/lib/studio/db";

export const dynamic = "force-dynamic";

const PAGE = 300;

/**
 * Changes after a cursor, oldest first: how Excel and PowerPoint catch up with edits made elsewhere.
 * With undo=1 each change carries its undo, so a workbook reopened days later can rebuild the state
 * it last saw and replay what happened since.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const url = new URL(req.url);
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const withUndo = url.searchParams.get("undo") === "1";
    await requireDoc(user, id);
    const rows = await eventsSince(id, since, PAGE);
    return NextResponse.json({
      events: rows.map((e) => ({ id: e.id, patches: e.patches, actor: e.actor, actorName: e.actorName, runId: e.runId, label: e.label, ...(withUndo ? { undo: e.undo } : {}) })),
      more: rows.length === PAGE,
    });
  });
}
