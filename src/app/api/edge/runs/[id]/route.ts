import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { runView } from "@/lib/edge/canvas/engine";

export const dynamic = "force-dynamic";

/** A run as the canvas shows it: each block's status, step, summary, preview and outputs. ?lite=1 skips outputs while it runs. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const lite = new URL(req.url).searchParams.get("lite") === "1";
    return NextResponse.json(await runView(user, id, !lite), { headers: { "cache-control": "private, no-store" } });
  });
}
