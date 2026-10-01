import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { r2Ready, signedUrl } from "@/lib/edge/infra/r2";
import { deleteScenario, getScenario } from "@/lib/edge/scen/store";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/**
 * A saved scenario with its full result (and a download link for practice data). With ?status=1, only its
 * status: what a page checks every few seconds while a refinement runs, without the result each time.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (new URL(req.url).searchParams.has("status")) {
      const t = schema.edgeScenarios;
      const [, [row]] = await Promise.all([requireEdge(user.id), requireDb().select({ status: t.status, ownerId: t.ownerId, teamId: t.teamId }).from(t).where(eq(t.id, id))]);
      if (!row || (row.ownerId !== user.id && !(row.teamId && (await myTeamIds(user.id)).includes(row.teamId)))) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ id, status: row.status });
    }
    await requireEdge(user.id);
    const s = await getScenario(user.id, id, true);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let download: string | null = null;
    const fileId = (s.result as { fileId?: number }).fileId;
    if (fileId && r2Ready()) { const [f] = await requireDb().select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, fileId)); if (f && f.ownerId === user.id) download = await signedUrl(f.r2Key, 3600, { filename: f.name }); }
    return NextResponse.json({ id: s.id, kind: s.kind, status: s.status, title: s.title, spec: s.spec, result: s.result, updatedAt: s.updatedAt.toISOString(), download });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    if (!(await deleteScenario(user.id, Number((await ctx.params).id)))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
