/**
 * The Thesis Agent's (E7) plan, checked before anyone can approve it: 3 to 8 claims, each falsifiable with a
 * resolution rule where possible (a deal announcement, a reported figure) or marked manual (its owner settles
 * it), each with a prior strictly between 0 and 1 and at least one evidence plan on the agent's fixed tools,
 * parents that exist and no cycles, closing dates inside the horizon; 2 to 4 kill criteria, each a typed
 * monitor. Priors come from a reference class where one exists (the Deal Radar's calibrated odds for a
 * "company is acquired" claim, scaled to the claim's window); otherwise the planner's prior is kept, clamped,
 * and marked subjective. Pure.
 */
import type { Kill, Monitor, Plan, PlannedClaim, ToolName } from "./types";

export const TOOLS: ToolName[] = ["crosswalk", "precedents", "pulse", "deal_odds", "series"];
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** What is wrong with a plan, in plain words; empty when it may be approved. Pure. */
export function validatePlan(p: Plan, opts: { horizonEnd: string; today: string }): string[] {
  const errs: string[] = [];
  if (p.claims.length < 3 || p.claims.length > 8) errs.push(`A plan has 3 to 8 claims; this one has ${p.claims.length}.`);
  if (p.kills.length < 2 || p.kills.length > 4) errs.push(`A plan has 2 to 4 kill criteria; this one has ${p.kills.length}.`);
  const ns = new Set(p.claims.map((c) => c.n));
  if (ns.size !== p.claims.length) errs.push("Claim numbers repeat.");
  for (const c of p.claims) {
    const label = `Claim ${c.n}`;
    if (!c.text.trim()) errs.push(`${label} has no text.`);
    if (!(c.prior > 0 && c.prior < 1)) errs.push(`${label} needs a prior strictly between 0 and 1.`);
    if (!c.evidence.length) errs.push(`${label} needs at least one evidence plan.`);
    if (c.evidence.some((e) => !TOOLS.includes(e.tool))) errs.push(`${label} plans a tool the agent does not have.`);
    if (!c.rule || !["deal", "xbrl", "manual"].includes(c.rule.type)) errs.push(`${label} needs a resolution rule or "manual".`);
    if (c.rule?.type !== "manual" && c.rule && !TICKER.test((c.rule as { ticker: string }).ticker ?? "")) errs.push(`${label}'s rule names no company ticker.`);
    if (c.parent !== null && !ns.has(c.parent)) errs.push(`${label}'s parent does not exist.`);
    if (c.parent === c.n) errs.push(`${label} is its own parent.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.closes) || c.closes > opts.horizonEnd || c.closes < opts.today) errs.push(`${label} must close inside the horizon (by ${opts.horizonEnd}).`);
  }
  // No cycles through parents.
  for (const c of p.claims) {
    const seen = new Set<number>();
    let at: PlannedClaim | undefined = c;
    while (at && at.parent !== null) { if (seen.has(at.n)) { errs.push(`Claims ${[...seen].join(", ")} form a cycle.`); break; } seen.add(at.n); at = p.claims.find((x) => x.n === at!.parent); }
  }
  for (const k of p.kills) if (!monitorOk(k.monitor)) errs.push(`Kill criterion ${k.n} is not a monitor the agent can check.`);
  return [...new Set(errs)];
}

/** Whether a monitor is one of the typed kinds with sane arguments. Pure. */
export function monitorOk(m: Monitor | undefined | null): boolean {
  if (!m || !TICKER.test(m.ticker ?? "")) return false;
  switch (m.tool) {
    case "deal_odds": return (m.op === ">=" || m.op === "<=") && m.value > 0 && m.value < 1;
    case "series": return !!m.metric && (m.op === "drop" || m.op === "rise") && m.value > 0 && m.value < 10 && m.weeks >= 2 && m.weeks <= 52;
    case "pulse": return !!m.kind;
    case "deal": return m.role === "target" || m.role === "acquirer";
    default: return false;
  }
}

/** A 12-month probability scaled to a window of `months` (constant hazard). Pure. */
export const scaleOdds = (p12: number, months: number) => 1 - Math.pow(1 - Math.min(0.999, Math.max(0, p12)), Math.max(0, months) / 12);

/**
 * Priors from reference classes: a target-deal claim takes the Deal Radar's odds for its company over the
 * claim's window (when the company is scored); everything else keeps the planner's prior, clamped to
 * [0.03, 0.97] and marked subjective. `odds` maps tickers to their 12-month odds. Pure.
 */
export function withPriors(p: Plan, odds: Record<string, { p: number; base: number } | undefined>, today: string): Plan {
  const months = (closes: string) => Math.max(0.5, (Date.parse(closes) - Date.parse(today)) / (30.44 * 86_400_000));
  return {
    ...p,
    claims: p.claims.map((c) => {
      if (c.rule.type === "deal" && c.rule.role === "target" && odds[c.rule.ticker]) {
        const o = odds[c.rule.ticker]!;
        const v = Math.min(0.97, Math.max(0.01, scaleOdds(o.p, months(c.closes))));
        return { ...c, prior: v, priorBasis: "reference" as const, priorNote: `Deal Radar: ${(o.p * 100).toFixed(1)}% over 12 months (sector base rate ${(o.base * 100).toFixed(1)}%), scaled to ${months(c.closes).toFixed(1)} months` };
      }
      return { ...c, prior: Math.min(0.97, Math.max(0.03, c.prior)), priorBasis: "subjective" as const, priorNote: c.priorNote || "the planner's stated prior (no reference class)" };
    }),
  };
}

/** Kill criteria with numbers, deduplicated and capped at four. Pure. */
export function cleanKills(kills: Kill[]): Kill[] {
  const seen = new Set<string>();
  return kills.filter((k) => { const key = JSON.stringify(k.monitor); if (seen.has(key)) return false; seen.add(key); return monitorOk(k.monitor); }).slice(0, 4).map((k, i) => ({ ...k, n: i + 1 }));
}
