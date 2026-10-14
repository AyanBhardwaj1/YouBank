import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse, PremiumRequiredError, requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { activeCount, createThesis, LIMITS, listTheses } from "@/lib/edge/agent/store";
import { rateLimit } from "@/lib/locks";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** The person's theses and their teams' (E7). */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const [plus, team, deep] = await Promise.all([canUse(user, "edge.thesis-plus"), canUse(user, "edge.thesis-team"), canUse(user, "edge.thesis-deep")]);
    return NextResponse.json({ theses: await listTheses(user.id), limits: plus ? LIMITS.plus : LIMITS.free, plan: { plus, team, deep }, teams: team ? await myTeamIds(user.id) : [] });
  });
}

/**
 * Start a thesis (E7): POST { thesis, tickers?, horizonDays?, cadence?, teamId?, deep?, budgetUsd? }. The agent
 * turns it into claims, priors, evidence plans and kill criteria (a small-model call on the person's AI
 * allowance) and returns the plan to approve; nothing runs until it is approved. Free: one active thesis, 14
 * days, daily. More, longer or twice-daily theses need edge.thesis-plus; a team thesis edge.thesis-team; the
 * weekly deep synthesis edge.thesis-deep.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const thesis = typeof b.thesis === "string" ? b.thesis.trim() : "";
    if (thesis.length < 12) return NextResponse.json({ error: "State the thesis in a sentence or two." }, { status: 400 });
    const tickers = [...new Set((Array.isArray(b.tickers) ? b.tickers : []).map((t) => String(t).trim().toUpperCase()).filter((t) => TICKER.test(t)))].slice(0, 8);
    const plus = await canUse(user, "edge.thesis-plus");
    const lim = plus ? LIMITS.plus : LIMITS.free;
    const horizonDays = Math.round(Math.max(3, Math.min(LIMITS.plus.horizonDays, Number(b.horizonDays) || lim.horizonDays)));
    const cadence = b.cadence === "twice-daily" ? "twice-daily" as const : "daily" as const;
    if (!plus && (horizonDays > LIMITS.free.horizonDays || cadence === "twice-daily")) await requireFeature(user, "edge.thesis-plus");
    if ((await activeCount(user.id)) >= lim.active) {
      if (!plus) throw new PremiumRequiredError("edge.thesis-plus", "pro");
      return NextResponse.json({ error: `You have ${lim.active} active theses; stop one to start another.` }, { status: 409 });
    }
    let teamId: number | null = null;
    if (b.teamId !== undefined && b.teamId !== null) {
      await requireFeature(user, "edge.thesis-team");
      teamId = Number(b.teamId);
      if (!(await myTeamIds(user.id)).includes(teamId)) return NextResponse.json({ error: "You are not in that team." }, { status: 403 });
    }
    const deep = b.deep === true;
    if (deep) await requireFeature(user, "edge.thesis-deep");
    const maxBudget = deep ? lim.maxBudget + 15 : lim.maxBudget;
    const budgetUsd = Math.max(0.1, Math.min(maxBudget, Number(b.budgetUsd) || (deep ? lim.budget + 12 : lim.budget)));
    await rateLimit(`edge-agent-create:${user.id}`, 10, 3_600_000, "Ten theses planned this hour. Try again later.");
    const r = await createThesis(user.id, { thesis, tickers, horizonDays, cadence, tier: plus ? "plus" : "free", teamId, deep, budgetUsd });
    return NextResponse.json(r);
  });
}
