import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { runsOf } from "@/lib/edge/canvas/engine";
import { canvasAccess, checkpoints, cleanGraph, deleteCanvas, family, saveCanvas, type CanvasRow } from "@/lib/edge/canvas/store";
import { monitorOf } from "@/lib/edge/monitors";
import { availableTypes } from "@/lib/edge/runtime";
import { myTeams } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

const view = (c: CanvasRow) => ({ id: c.id, title: c.title, description: c.description, graph: c.graph, version: c.version, teamId: c.teamId, template: c.template, parentId: c.parentId, branch: c.branch, updatedAt: c.updatedAt.toISOString(), ownerId: c.ownerId });

async function idOf(ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("bad id"), { status: 400 });
  return id;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = await idOf(ctx);
    const { row, role } = await canvasAccess(user, id, "view");
    const [runs, monitor, branches, cps, teams] = await Promise.all([runsOf(id), monitorOf(id), family(id), checkpoints(id), myTeams(user.id)]);
    return NextResponse.json({
      canvas: view(row), role, runs, monitor, branches, checkpoints: cps, available: [...availableTypes()],
      teams: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })),
    });
  });
}

/** Save: { graph?, title?, description?, teamId?, version } — a 409 carries the newer canvas when someone else saved first. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = await idOf(ctx);
    const body = (await req.json().catch(() => null)) as { graph?: unknown; title?: string; description?: string; teamId?: number | null; version?: number } | null;
    if (!body || typeof body.version !== "number") return NextResponse.json({ error: "bad request" }, { status: 400 });
    try {
      const saved = await saveCanvas(user, id, { graph: body.graph ? cleanGraph(body.graph) : undefined, title: body.title, description: body.description, teamId: body.teamId }, body.version);
      return NextResponse.json({ canvas: view(saved) });
    } catch (e) {
      const err = e as { status?: number; latest?: CanvasRow; message?: string };
      if (err.status === 409 && err.latest) return NextResponse.json({ error: err.message, canvas: view(err.latest) }, { status: 409 });
      throw e;
    }
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await deleteCanvas(user, await idOf(ctx));
    return NextResponse.json({ ok: true });
  });
}
