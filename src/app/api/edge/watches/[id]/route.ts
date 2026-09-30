import { after, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { checkWatch, removeWatch, type WatchKind } from "@/lib/edge/watches";
import { rateLimit } from "@/lib/locks";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    if (!(await removeWatch(user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}

/** Look at a watch's sites now (your own or your team's), a few times an hour at most. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const teams = await myTeamIds(user.id);
    const mine = eq(schema.edgeWatches.userId, user.id);
    const [w] = await requireDb().select().from(schema.edgeWatches)
      .where(and(eq(schema.edgeWatches.id, id), teams.length ? or(mine, inArray(schema.edgeWatches.teamId, teams)) : mine));
    if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await rateLimit(`edge-check:${user.id}`, 6, 3_600_000, "Edge has looked several times this hour. It also checks every day on its own, so try again later.");
    const deadline = Date.now() + 50_000;
    after(() => checkWatch({ id: w.id, kind: w.kind as WatchKind, target: w.target }, deadline, 3));
    return NextResponse.json({ ok: true, started: true });
  });
}
