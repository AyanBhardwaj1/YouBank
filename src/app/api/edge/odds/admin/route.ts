import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { requireEdge } from "@/lib/edge/access";
import { sendJob } from "@/lib/edge/infra/jobs";
import { mlReady } from "@/lib/edge/infra/ml";
import { loadUniverse } from "@/lib/edge/odds/data";
import { universeMode } from "@/lib/edge/odds/labels";
import { currentModel, getPipeline, pipelineStep, startPipeline } from "@/lib/edge/odds/train";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Deal Radar's pipeline for administrators (E4). GET: the stage, the universe's size and mode, the
 * current model and whether training runs on the ML service. POST { action: "train" } starts a monthly run
 * now (on Inngest when set up, else one step in this request; call again to continue); { action: "score" }
 * re-scores the universe.
 */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators manage the Deal Radar." }, { status: 403 });
    const [p, u, m] = await Promise.all([getPipeline(), loadUniverse(), currentModel()]);
    const entries = Object.values(u.entries);
    return NextResponse.json({ pipeline: p, universe: { mode: universeMode(), known: entries.length, inScope: entries.filter((e) => e.scope).length, listed: entries.filter((e) => e.scope && e.listed).length, cursor: u.cursor }, model: m ? { version: m.version, engine: m.engine, trainedAt: m.trainedAt, scorecard: m.metrics.scorecard?.text ?? null } : null, ml: mlReady() });
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators manage the Deal Radar." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "train") {
      const sent = await sendJob("edge/odds.refresh", { by: user.email }).catch(() => ({ sent: false as const, reason: "" }));
      if (sent.sent) return NextResponse.json({ ran: "queued" });
      const p = await getPipeline();
      if (p.stage === "idle") await startPipeline();
      return NextResponse.json({ ran: "inline", pipeline: await pipelineStep(Date.now() + 270_000) });
    }
    if (body.action === "score") {
      const sent = await sendJob("edge/odds.score", { by: user.email }).catch(() => ({ sent: false as const, reason: "" }));
      return NextResponse.json(sent.sent ? { ran: "queued" } : { error: "Background jobs are not set up; the daily pass scores watched companies." }, { status: sent.sent ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  });
}
