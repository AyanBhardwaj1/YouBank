import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { r2Ready, signedUrl } from "@/lib/edge/infra/r2";
import { deleteScenario, getScenario } from "@/lib/edge/scen/store";

export const dynamic = "force-dynamic";

/** A saved scenario with its full result (and a download link for practice data). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const s = await getScenario(user.id, Number((await ctx.params).id), true);
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
