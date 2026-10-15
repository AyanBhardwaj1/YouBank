/**
 * Q14 on the server: question sets (answers withheld until the set is submitted), scoring, saved sessions,
 * people's own calls, and the private team leaderboard (Deal Team, quant.drills-teams).
 * Run-time questions come from YouBank's own data (BLS unemployment from the public API; SEC company facts),
 * best effort: when a source does not answer, the set uses the fixed bank.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { blsSeries } from "@/lib/market/bls";
import { trackRecord } from "@/lib/edge/forecasts/ledger";
import { listMembers, myTeamIds } from "@/lib/teams/db";
import { saveRun, runsOf } from "../runs";
import { DISCLOSURES, T } from "../words";
import { blsQuestion, INTERVALS, pickSet, TRUE_FALSE, type IntervalQ, type TrueFalseQ } from "./bank";
import { summariseIntervals, summariseProbabilities } from "./score";

export const DRILLS_VERSION = "q14-2026-10-15.1";

/** Run-time questions from BLS (unemployment in a recent month). */
async function liveQuestions(seed: number): Promise<IntervalQ[]> {
  const s = await blsSeries().catch(() => null);
  const u = s?.LNS14000000 ?? [];
  if (u.length < 24) return [];
  const pick = u[(seed % (u.length - 12)) + 6];
  return pick ? [blsQuestion({ id: "unemp", label: "US unemployment rate", date: pick.date.slice(0, 7), value: pick.value, unit: "%", seriesId: "LNS14000000" })] : [];
}

export type DrillSet = { seed: number; intervals: Omit<IntervalQ, "answer" | "source">[]; truefalse: Omit<TrueFalseQ, "answer" | "explanation" | "source">[] };

async function fullSet(seed: number): Promise<{ intervals: IntervalQ[]; truefalse: TrueFalseQ[] }> {
  const live = await liveQuestions(seed);
  return { intervals: pickSet([...live, ...INTERVALS], 6, seed), truefalse: pickSet(TRUE_FALSE, 5, seed + 1) };
}

export async function drillSet(seed = Math.floor(Math.random() * 1e9)): Promise<DrillSet> {
  const s = await fullSet(seed);
  return { seed, intervals: s.intervals.map(({ id, kind, question, unit, note }) => ({ id, kind, question, unit, note })), truefalse: s.truefalse.map(({ id, kind, statement }) => ({ id, kind, statement })) };
}

export type DrillAnswers = { seed: number; intervals: Record<string, { lo: number; hi: number }>; truefalse: Record<string, { answer: boolean; confidence: number }> };

export async function scoreSet(ownerId: string | null, a: DrillAnswers) {
  const s = await fullSet(a.seed);
  const iv = s.intervals.filter((q) => a.intervals[q.id] && Number.isFinite(a.intervals[q.id].lo) && Number.isFinite(a.intervals[q.id].hi)).map((q) => ({ q, lo: a.intervals[q.id].lo, hi: a.intervals[q.id].hi }));
  const tf = s.truefalse.filter((q) => a.truefalse[q.id] && typeof a.truefalse[q.id].answer === "boolean").map((q) => ({ q, ...a.truefalse[q.id], confidence: Math.min(1, Math.max(0.5, Number(a.truefalse[q.id].confidence) || 0.5)) }));
  const intervals = summariseIntervals(iv.map((x) => ({ lo: x.lo, hi: x.hi, answer: x.q.answer })));
  const probabilities = summariseProbabilities(tf.map((x) => ({ confidence: x.confidence, correct: x.answer === x.q.answer })));
  const out = {
    intervals, probabilities,
    answers: [
      ...iv.map((x) => ({ id: x.q.id, question: x.q.question, answer: x.q.answer, unit: x.q.unit, yours: `${x.lo} to ${x.hi}`, hit: x.q.answer >= Math.min(x.lo, x.hi) && x.q.answer <= Math.max(x.lo, x.hi), source: x.q.source })),
      ...tf.map((x) => ({ id: x.q.id, question: x.q.statement, answer: x.q.answer ? "True" : "False", unit: "", yours: `${x.answer ? "True" : "False"} at ${Math.round(x.confidence * 100)}%`, hit: x.answer === x.q.answer, source: x.q.source, explanation: x.q.explanation })),
    ],
    disclosure: "Virtual and educational: no money, no prizes.",
  };
  if (ownerId) await saveRun(ownerId, "drill_session", { seed: a.seed, n: iv.length + tf.length }, { hitRate: intervals.hitRate, intervalN: intervals.n, brier: probabilities.brier, overconfidence: probabilities.overconfidence, probN: probabilities.n }, [], DRILLS_VERSION).catch(() => null);
  return out;
}

/** A game result (Kelly coin, market making, EV) saved to the person's record. */
export async function saveGame(ownerId: string, game: "kelly_coin" | "market_making" | "ev", result: Record<string, unknown>) {
  return saveRun(ownerId, "drill", { game }, result, [], DRILLS_VERSION);
}

/** The person's record: sessions, calibration over time, own calls and their scored skill. */
export async function myDrills(ownerId: string) {
  const sessions = await runsOf(ownerId, "drill_session", 100);
  const games = await runsOf(ownerId, "drill", 50);
  const calls = await trackRecord("user_call", { ownerId }).catch(() => []);
  const open = await requireDb().select({ id: schema.edgeForecasts.id, question: schema.edgeForecasts.question, probability: schema.edgeForecasts.probability, closesAt: schema.edgeForecasts.closesAt, outcome: schema.edgeForecasts.outcome, resolvedAt: schema.edgeForecasts.resolvedAt })
    .from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.kind, "user_call"), eq(schema.edgeForecasts.ownerId, ownerId))).orderBy(desc(schema.edgeForecasts.createdAt)).limit(100);
  const panel = calls[0];
  return {
    sessions: sessions.map((r) => ({ at: r.createdAt.toISOString(), ...r.output })), games: games.map((r) => ({ at: r.createdAt.toISOString(), game: (r.input as { game?: string }).game, ...r.output })),
    calls: open.map((c) => ({ ...c, closesAt: c.closesAt.toISOString(), resolvedAt: c.resolvedAt?.toISOString() ?? null })),
    skill: panel ? { n: panel.n, skill: panel.skill, ci: panel.skillCi, verdict: panel.n >= 20 && panel.skill !== null && panel.skillCi ? T.skillSoFar(panel.n, panel.skill, panel.skillCi[0], panel.skillCi[1]) : panel.verdict } : null,
    disclosures: [DISCLOSURES.not_advice],
  };
}

/** The private leaderboard of the person's team(s): each member's latest 20 sessions' calibration. */
export async function teamLeaderboard(userId: string): Promise<{ team: number; rows: { name: string; email: string; sessions: number; hitRate: number | null; brier: number | null }[] }[]> {
  const out = [];
  for (const team of (await myTeamIds(userId)).slice(0, 3)) {
    const members = await listMembers(team);
    const ids = members.map((m) => m.userId).slice(0, 100);
    const runs = ids.length ? await requireDb().select().from(schema.quantRuns).where(and(inArray(schema.quantRuns.ownerId, ids), eq(schema.quantRuns.kind, "drill_session"))).orderBy(desc(schema.quantRuns.createdAt)).limit(2_000) : [];
    out.push({
      team, rows: members.map((m) => {
        const mine = runs.filter((r) => r.ownerId === m.userId).slice(0, 20).map((r) => r.output as { hitRate?: number; brier?: number; probN?: number });
        const hr = mine.filter((x) => typeof x.hitRate === "number"), br = mine.filter((x) => typeof x.brier === "number" && (x.probN ?? 0) > 0);
        return { name: m.name ?? "", email: m.email ?? "", sessions: mine.length, hitRate: hr.length ? hr.reduce((s, x) => s + (x.hitRate ?? 0), 0) / hr.length : null, brier: br.length ? br.reduce((s, x) => s + (x.brier ?? 0), 0) / br.length : null };
      }).sort((a, b) => (a.brier ?? 9) - (b.brier ?? 9)),
    });
  }
  return out;
}
