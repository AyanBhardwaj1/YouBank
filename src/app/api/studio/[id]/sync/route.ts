import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { jsonBody } from "@/lib/office/body";
import { commit, docData, lastEventId, requireDoc } from "@/lib/studio/db";
import { describeSync, diffWorkbook, validSnapshot } from "@/lib/studio/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Excel sends what the open workbook holds; the difference from the Studio document is stored as one
 * change, which the browser, the agent and the history all see as "Synced from Excel". Tagged with
 * runId "excel" so a browser open on the same account applies it rather than taking it for its own edit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = await jsonBody<{ snapshot?: unknown; base?: unknown }>(req);
    const snap = validSnapshot(body?.snapshot);
    if (!snap) return NextResponse.json({ error: "That workbook could not be read. Very large workbooks (over 400,000 cells) are not supported yet." }, { status: 400 });
    const row = await requireDoc(user, id, "edit");
    // A sync makes Studio match the workbook, so a workbook that has not yet received newer changes
    // would undo them. The add-in says which change it last applied; if there are newer ones, it catches up first.
    const latest = await lastEventId(id);
    if (typeof body?.base === "number" && latest > body.base) return NextResponse.json({ error: "behind", cursor: latest }, { status: 409 });
    const doc = docData(row);
    const patches = diffWorkbook(doc.workbook, snap);
    if (!patches.length) return NextResponse.json({ event: null, cursor: latest });
    const ev = await commit(id, doc, patches, { actor: user.id, actorName: user.name || user.email || "Someone", runId: "excel", label: describeSync(patches) });
    const cells = patches.reduce((n, p) => n + (p.op === "cells" ? Object.keys(p.cells).length : 0), 0);
    return NextResponse.json({ event: { id: ev.id, label: ev.label, cells, patches }, cursor: ev.id });
  });
}
