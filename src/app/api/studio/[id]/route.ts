import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { myTeams } from "@/lib/teams/db";
import { commitRaw, deleteDoc, docData, lastEventId, listRuns, recentEvents, requireDoc, shareDoc } from "@/lib/studio/db";
import { describePatches } from "@/lib/studio/ops";
import { validPatches } from "@/lib/studio/validate";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** The document, where to resume its event stream, its recent history and runs. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const row = await requireDoc(user, id);
    const [cursor, runs, history, teams] = await Promise.all([lastEventId(id), listRuns(id), recentEvents(id), myTeams(user.id)]);
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
    const row = await requireDoc(user, id, "edit");
    const patches = validPatches(body?.patches);
    if (!patches) return NextResponse.json({ error: "Send patches" }, { status: 400 });
    const undo = validPatches(body?.undo) ?? [];
    const label = body?.label?.slice(0, 200) || describePatches(docData(row), patches);
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
