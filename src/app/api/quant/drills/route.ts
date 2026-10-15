import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { drillSet, myDrills, saveGame, scoreSet, teamLeaderboard, type DrillAnswers } from "@/lib/quant/drills/run";
import { evProblems } from "@/lib/quant/drills/games";
import { logUserCall } from "@/lib/quant/forecast";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — a new question set (answers withheld); ?me=1 the person's record and calls; ?team=1 the team leaderboard (Deal Team). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    if (q.get("team") === "1") { await requireFeature(user, "quant.drills-teams"); return NextResponse.json({ teams: await teamLeaderboard(user.id) }); }
    if (q.get("me") === "1") { await requireQuantConsent(user.id); return NextResponse.json(await myDrills(user.id)); }
    const seed = Number(q.get("seed")) || undefined;
    return NextResponse.json({ set: await drillSet(seed), ev: evProblems().map(({ id, question, unit }) => ({ id, question, unit })) });
  });
}

/**
 * POST { action: "submit", seed, intervals, truefalse } scores a set (and saves it with consent);
 * POST { action: "ev", answers } checks expected-value answers; POST { action: "game", game, result } saves a
 * game; POST { action: "call", symbol, benchmark?, months, probability, direction } logs the person's own call.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const b = await jsonBody(req);
    if (b.action === "submit") {
      const a = { seed: Number(b.seed), intervals: (b.intervals ?? {}) as DrillAnswers["intervals"], truefalse: (b.truefalse ?? {}) as DrillAnswers["truefalse"] };
      if (!Number.isFinite(a.seed)) throw refuse("Missing the set's seed.");
      return NextResponse.json(await scoreSet(user.id, a));
    }
    if (b.action === "ev") {
      const answers = (b.answers ?? {}) as Record<string, number>;
      return NextResponse.json({ results: evProblems().filter((p) => p.id in answers).map((p) => ({ id: p.id, yours: Number(answers[p.id]), answer: p.answer, unit: p.unit, close: Math.abs(Number(answers[p.id]) - p.answer) <= Math.max(0.01, Math.abs(p.answer) * 0.02), worked: p.worked })) });
    }
    await requireQuantConsent(user.id);
    if (b.action === "game") {
      const game = b.game === "market_making" ? "market_making" : b.game === "ev" ? "ev" : "kelly_coin";
      const result = (b.result && typeof b.result === "object" ? b.result : {}) as Record<string, unknown>;
      return NextResponse.json({ id: await saveGame(user.id, game, Object.fromEntries(Object.entries(result).slice(0, 30))) }, { status: 201 });
    }
    if (b.action === "call") {
      const r = await logUserCall(user.id, { symbol: String(b.symbol ?? ""), benchmark: typeof b.benchmark === "string" ? b.benchmark : undefined, months: Number(b.months) || 3, probability: Number(b.probability), direction: b.direction === "trails" ? "trails" : "beats" });
      return NextResponse.json(r, { status: 201 });
    }
    throw refuse("action must be submit, ev, game or call.");
  });
}
