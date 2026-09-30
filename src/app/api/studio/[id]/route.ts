import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { myTeams } from "@/lib/teams/db";
import { commitRaw, deleteDoc, docData, lastEventId, listRuns, recentEvents, requireDoc, requireDocAccess, shareDoc } from "@/lib/studio/db";
import { describePatches } from "@/lib/studio/ops";
import { validPatches } from "@/lib/studio/validate";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/**
 * The document, where to resume its event stream, its recent history and runs. With ?meta=1, only the
 * runs, history and team: what the page refreshes when someone else changes the document.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    if (new URL(req.url).searchParams.get("meta") === "1") {
      const doc = await requireDocAccess(user, id);
      const [runs, history] = await Promise.all([listRuns(id), recentEvents(id)]);
      return NextResponse.json({ runs, history, teamId: doc.teamId });
    }
    // The cursor is read before the document, so an edit landing in between is replayed rather than lost.
    const cursor = await lastEventId(id);
    const row = await requireDoc(user, id);
    const [runs, history, teams] = await Promise.all([listRuns(id), recentEvents(id), myTeams(user.id)]);
    return NextResponse.json({
      id: row.id, doc: docData(row), kind: row.kind, ticker: row.ticker, intake: row.intake, teamId: row.teamId, mine: row.ownerId === user.id,
      cursor, runs, history, teams: teams.map((t) => ({ id: t.id, name: t.name })), me: { id: user.id, name: user.name || user.email },
    });
  });
}

/** A person's edit: patches the browser already applied, with their undo. Or share with a team. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { patches?: unknown; undo?: unknown; label?: string; share?: number | null } | null;
    if (body && "share" in body) { await shareDoc(user, id, body.share ?? null); return NextResponse.json({ ok: true }); }
    // Every keystroke lands here: check access on two columns, and read the document only to name an unlabelled edit.
    await requireDocAccess(user, id, "edit");
    const patches = validPatches(body?.patches);
    if (!patches) return NextResponse.json({ error: "Send patches" }, { status: 400 });
    const undo = validPatches(body?.undo) ?? [];
    const label = (typeof body?.label === "string" ? body.label.slice(0, 200) : "") || describePatches(docData(await requireDoc(user, id, "edit")), patches);
    const eventId = await commitRaw(id, patches, undo, { actor: user.id, actorName: user.name || user.email, label });
    return NextResponse.json({ eventId });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await deleteDoc(user, id);
    return NextResponse.json({ ok: true });
  });
}
