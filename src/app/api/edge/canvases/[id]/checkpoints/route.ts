import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { checkpoint, checkpoints, restore } from "@/lib/edge/canvas/store";

export const dynamic = "force-dynamic";

/** { label } names a checkpoint of the canvas as it is; { restore: checkpointId } brings one back as a new version. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => null)) as { label?: string; restore?: number } | null;
    if (!Number.isInteger(id) || !body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    if (typeof body.restore === "number") {
      const c = await restore(user, id, body.restore);
      return NextResponse.json({ restored: true, version: c.version, graph: c.graph });
    }
    await checkpoint(user, id, body.label ?? "");
    return NextResponse.json({ checkpoints: await checkpoints(id) });
  });
}
