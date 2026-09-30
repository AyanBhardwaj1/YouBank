import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { sendJob } from "@/lib/edge/infra/jobs";
import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { startRefine } from "@/lib/edge/scen/run";
import { getScenario, updateScenario } from "@/lib/edge/scen/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Refine a market scenario in the background (ten thousand paths, or the diffusion model's). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const s = await getScenario(user.id, id);
    if (!s || s.kind !== "market") return NextResponse.json({ error: "Only market scenarios can be refined." }, { status: 400 });
    if (s.status === "refining") return NextResponse.json({ status: "refining" });
    await rateLimit(`edge-scen-refine:${user.id}`, 20, 3_600_000, "Several refinements this hour; try again later.");
    const sent = await sendJob("edge/scenario.refine", { id, userId: user.id }, { id: `edge-scen-refine-${id}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
    if (!sent.sent) {
      await updateScenario(id, { status: "refining" });
      after(() => startRefine(user.id, id).then(() => undefined).catch(async (e) => { logError(e, { where: "edge-scen-refine-inline" }); await updateScenario(id, { status: "preview" }); }));
    }
    return NextResponse.json({ status: "refining" });
  });
}
