import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { commit, docData, markRun, requireDoc, undoForRun } from "@/lib/studio/db";
import { Engine } from "@/lib/studio/engine";
import type { Patch } from "@/lib/studio/ops";

export const dynamic = "force-dynamic";

/** Undo a whole agent run, or one event, as a new event (which can itself be undone). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { runId?: string; eventId?: number } | null;
    const row = await requireDoc(user, id, "edit");
    let undo: Patch[] = [];
    let label = "Undo";
    if (body?.runId) { undo = await undoForRun(id, body.runId); label = "Undid an agent run"; }
    else if (body?.eventId) {
      const [ev] = await requireDb().select().from(schema.studioEvents).where(eq(schema.studioEvents.id, body.eventId));
      if (!ev || ev.docId !== id) return NextResponse.json({ error: "No such change" }, { status: 404 });
      undo = (ev.undo ?? []) as Patch[];
      label = `Undid: ${ev.label}`;
    }
    if (!undo.length) return NextResponse.json({ error: "Nothing to undo" }, { status: 400 });
    const doc = docData(row);
    const ev = await commit(id, doc, undo, { actor: user.id, actorName: user.name || user.email, label }, new Engine(doc.workbook));
    if (body?.runId) await markRun(body.runId, "undone");
    return NextResponse.json({ event: ev });
  });
}
