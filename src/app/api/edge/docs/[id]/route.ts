import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { deleteDoc } from "@/lib/edge/docs/store";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function ownDoc(userId: string, id: number) {
  const [d] = await requireDb().select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, id));
  return d && d.ownerId === userId ? d : null;
}

/** Delete a document: its passages, transcript and file go with it. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!(await deleteDoc(user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}

/** Share an upload with one of the person's teams, or make it private again: { teamId: number | null }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const d = await ownDoc(user.id, Number((await ctx.params).id));
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { teamId?: number | null } | null;
    const teamId = body?.teamId == null ? null : Number(body.teamId);
    if (teamId !== null && !(await myTeamIds(user.id)).includes(teamId)) return NextResponse.json({ error: "You are not in that team." }, { status: 403 });
    const db = requireDb();
    await db.update(schema.edgeDocs).set({ teamId }).where(eq(schema.edgeDocs.id, d.id));
    if (d.fileId) await db.update(schema.edgeFiles).set({ teamId }).where(eq(schema.edgeFiles.id, d.fileId));
    return NextResponse.json({ ok: true, teamId });
  });
}

/** Read a failed upload again. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const d = await ownDoc(user.id, Number((await ctx.params).id));
    if (!d?.fileId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ status: await ingest(d.id) });
  });
}
