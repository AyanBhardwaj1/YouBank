/**
 * The Thesis Agent's (E7) stated rules, pure and tested:
 * - the likelihood-ratio ladder: each verified evidence item moves its claim by a fixed likelihood ratio in
 *   log-odds space (weak 1.5, moderate 3, strong 8), for or against, capped per tick so no single day can
 *   swing a claim from doubt to certainty. The ladder is a rule, not a hidden model judgement, and its
 *   calibration is tracked in the forecast ledger (kind thesis_claim) so it can be refitted;
 * - parents combine their children by declared logic: all (every child, as independent events), any (at
 *   least one), weighted (a weighted mean);
 * - the budget: a step whose estimated cost would take the spend past the budget is refused before it runs;
 * - the cadence: when the next tick is due.
 */
import type { ClaimState, EvidenceItem } from "./types";

export const LADDER = { weak: 1.5, moderate: 3, strong: 8 } as const;
export const LADDER_VERSION = "ladder v1 (weak 1.5, moderate 3, strong 8; cap ln 8 a tick)";
export const TICK_CAP = Math.log(8);

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));

/** A claim's probability after this tick's kept evidence: the ladder in log-odds space, capped. Pure. */
export function applyLadder(p: number, items: Pick<EvidenceItem, "direction" | "strength" | "kept">[], cap = TICK_CAP): { p: number; moved: number; raw: number } {
  const kept = items.filter((e) => e.kept);
  const raw = kept.reduce((s, e) => s + (e.direction === "for" ? 1 : -1) * Math.log(LADDER[e.strength]), 0);
  const step = Math.max(-cap, Math.min(cap, raw));
  const next = clampP(sigmoid(logit(clampP(p)) + step));
  return { p: next, moved: next - p, raw };
}

/** A parent's probability from its children's by its declared logic. Pure. */
export function combine(children: { p: number; weight?: number }[], logic: "all" | "any" | "weighted" = "all"): number {
  if (!children.length) return NaN;
  if (logic === "any") return clampP(1 - children.reduce((s, c) => s * (1 - c.p), 1));
  if (logic === "weighted") { const w = children.reduce((s, c) => s + (c.weight ?? 1), 0) || 1; return clampP(children.reduce((s, c) => s + c.p * (c.weight ?? 1), 0) / w); }
  return clampP(children.reduce((s, c) => s * c.p, 1));
}

/** Every parent recomputed from its children, deepest first (leaves keep their own probability). Pure. */
export function recomputeTree<T extends Pick<ClaimState, "n" | "parent" | "p" | "logic" | "weight">>(claims: T[]): T[] {
  const out = claims.map((c) => ({ ...c }));
  const depth = (c: T, seen = new Set<number>()): number => { if (c.parent === null || seen.has(c.n)) return 0; seen.add(c.n); const p = out.find((x) => x.n === c.parent); return p ? 1 + depth(p, seen) : 0; };
  const parents = out.filter((c) => out.some((k) => k.parent === c.n)).sort((a, b) => depth(b) - depth(a));
  for (const par of parents) {
    const kids = out.filter((k) => k.parent === par.n);
    const v = combine(kids.map((k) => ({ p: k.p, weight: k.weight })), par.logic ?? "all");
    if (Number.isFinite(v)) par.p = v;
  }
  return out;
}

/** Whether a step may run: its estimated cost fits what is left of the budget. Pure. */
export function canSpend(budget: number, spent: number, estimate: number): boolean {
  return estimate <= 0 || spent + estimate <= budget + 1e-9;
}

/** The thesis's overall probability: the root claims combined as "all" (the thesis holds when its roots do). Pure. */
export function overall(claims: Pick<ClaimState, "parent" | "p">[]): number | null {
  const roots = claims.filter((c) => c.parent === null);
  return roots.length ? combine(roots.map((r) => ({ p: r.p })), "all") : null;
}

/** When the next tick is due: the next 13:00 UTC (daily) or the next of 13:00 and 21:00 UTC (twice daily, after US filings). Pure. */
export function nextTick(now: Date, cadence: "daily" | "twice-daily"): Date {
  const slots = cadence === "twice-daily" ? [13, 21] : [13];
  for (let d = 0; d < 3; d++) for (const h of slots) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, 0, 0));
    if (t.getTime() > now.getTime() + 60_000) return t;
  }
  return new Date(now.getTime() + 86_400_000);
}

/** The key of the tick due at a time: the agent and the slot, so a tick re-run with the same key repeats nothing. Pure. */
export const tickKeyOf = (agentId: number, due: Date) => `${agentId}:${due.toISOString().slice(0, 13)}`;
