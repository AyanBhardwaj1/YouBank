import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { approveThesis, tickAgent } from "@/lib/edge/agent/store";
import { sendJob } from "@/lib/edge/infra/jobs";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Approve a thesis's plan (E7, owner only): its claims are logged at their priors, its kill criteria set, and the first tick runs now. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Name a thesis." }, { status: 400 });
    const state = await approveThesis(user.id, id);
    const sent = await sendJob("edge/agent.tick", { id }, { id: `edge-agent-tick-${id}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
    if (!sent.sent) after(() => tickAgent(id, Date.now() + 250_000).then(() => undefined).catch((e) => logError(e, { where: "edge-agent-tick-inline" })));
    return NextResponse.json({ ok: true, state });
  });
}
