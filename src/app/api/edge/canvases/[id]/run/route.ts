import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { startRun } from "@/lib/edge/canvas/engine";
import "@/lib/edge/runtime";

export const dynamic = "force-dynamic";
/** Without Inngest the run happens after the response, inside this function's time. */
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json({ runId: await startRun(user, id, "manual") });
  });
}
