import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { setStatus, tickAgent } from "@/lib/edge/agent/store";
import { sendJob } from "@/lib/edge/infra/jobs";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Resume a paused thesis (owner only): its next tick runs now (a premium thesis resumes as free if the plan no longer includes it). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Name a thesis." }, { status: 400 });
    const status = await setStatus(user.id, id, "running");
    const sent = await sendJob("edge/agent.tick", { id }, { id: `edge-agent-tick-${id}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
    if (!sent.sent) after(() => tickAgent(id, Date.now() + 250_000).then(() => undefined).catch((e) => logError(e, { where: "edge-agent-tick-inline" })));
    return NextResponse.json({ status });
  });
}
