import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { restorePatches, semanticDiff, summarizeDiff } from "@/lib/studio/checkpoints";
import { commit, deleteCheckpoint, docData, getCheckpoint, requireDoc } from "@/lib/studio/db";
import { Engine } from "@/lib/studio/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; cid: string }> };
const ids = async (ctx: Ctx) => { const p = await ctx.params; const id = Number(p.id), cid = Number(p.cid); return Number.isInteger(id) && id > 0 && Number.isInteger(cid) && cid > 0 ? { id, cid } : null; };

/** What changed since a checkpoint (or between two, with against=<checkpoint id>): inputs, formulas, key outputs, slides. */
export async function GET(req: Request, ctx: Ctx) {
  return guardedFor(req, async (user) => {
    const p = await ids(ctx);
    if (!p) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const row = await requireDoc(user, p.id);
    const now = docData(row);
    const cp = await getCheckpoint(p.id, p.cid);
    const against = Number(new URL(req.url).searchParams.get("against")) || 0;
    const other = against ? await getCheckpoint(p.id, against) : null;
    const before = { ...now, workbook: cp.workbook, deck: cp.deck };
    const after = other ? { ...now, workbook: other.workbook, deck: other.deck } : now;
    const diff = semanticDiff(before, after);
    return NextResponse.json({
      checkpoint: { id: cp.id, name: cp.name, createdByName: cp.createdByName, createdAt: cp.createdAt },
      against: other ? { id: other.id, name: other.name } : null, diff, summary: summarizeDiff(diff),
    });
  });
}

/** Go back to a checkpoint, as one change that can itself be undone. */
export async function POST(req: Request, ctx: Ctx) {
  return guardedFor(req, async (user) => {
    const p = await ids(ctx);
    if (!p) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const row = await requireDoc(user, p.id, "edit");
    const doc = docData(row);
    const cp = await getCheckpoint(p.id, p.cid);
    const patches = restorePatches(doc, { ...doc, workbook: cp.workbook, deck: cp.deck });
    if (!patches.length) return NextResponse.json({ event: null });
    const ev = await commit(p.id, doc, patches, { actor: user.id, actorName: user.name || user.email, label: `Restored checkpoint "${cp.name}"` }, new Engine(doc.workbook));
    return NextResponse.json({ event: { id: ev.id, patches: ev.patches, label: ev.label } });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return guardedFor(req, async (user) => {
    const p = await ids(ctx);
    if (!p) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireDoc(user, p.id, "edit");
    await deleteCheckpoint(p.id, p.cid);
    return NextResponse.json({ ok: true });
  });
}
