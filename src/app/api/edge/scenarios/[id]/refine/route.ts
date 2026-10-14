import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { sendJob } from "@/lib/edge/infra/jobs";
import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { startRefine } from "@/lib/edge/scen/run";
import { startLabRefine } from "@/lib/edge/scen/lab";
import { requireFeature } from "@/lib/billing/entitlements";
import { getScenario, updateScenario } from "@/lib/edge/scen/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refine a scenario in the background: a market scenario (ten thousand paths, or the diffusion model's), or an
 * LBO stress test (20,000 paths over up to seven years; premium edge.lbo-refine, about $0.005 of Modal CPU, at most 25 a day).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const s = await getScenario(user.id, id);
    if (!s || (s.kind !== "market" && s.kind !== "lbo")) return NextResponse.json({ error: "Only market scenarios and LBO stress tests can be refined." }, { status: 400 });
    if (s.status === "refining") return NextResponse.json({ status: "refining" });
    if (s.kind === "lbo") {
      await requireFeature(user, "edge.lbo-refine");
      await rateLimit(`edge-lbo-refine:${user.id}`, 20, 3_600_000, "Twenty refines this hour; try again later.");
      // Modal time is paid outside the AI ledger, so a daily cap bounds it (docs/pricing.md).
      await rateLimit(`edge-lbo-refine-day:${user.id}`, 25, 86_400_000, "25 refines today; the 1,000-path preview still runs. Try again tomorrow.");
      const sent = await sendJob("edge/lbo.refine", { id, userId: user.id }, { id: `edge-lbo-refine-${id}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
      if (!sent.sent) {
        await updateScenario(id, { status: "refining" });
        after(() => startLabRefine(user.id, id, { inline: true }).then(() => undefined).catch(async (e) => { logError(e, { where: "edge-lbo-refine-inline" }); await updateScenario(id, { status: "preview" }); }));
      }
      return NextResponse.json({ status: "refining" });
    }
    await rateLimit(`edge-scen-refine:${user.id}`, 20, 3_600_000, "Several refinements this hour; try again later.");
    const sent = await sendJob("edge/scenario.refine", { id, userId: user.id }, { id: `edge-scen-refine-${id}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
    if (!sent.sent) {
      await updateScenario(id, { status: "refining" });
      after(() => startRefine(user.id, id).then(() => undefined).catch(async (e) => { logError(e, { where: "edge-scen-refine-inline" }); await updateScenario(id, { status: "preview" }); }));
    }
    return NextResponse.json({ status: "refining" });
  });
}
