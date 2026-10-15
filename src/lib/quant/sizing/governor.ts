/**
 * Q4, the Sizing and Drawdown Governor: Kelly with the uncertainty left in, drawdown odds, volatility
 * targeting, risk parity and pod-style drawdown rules, simulated on the person's own returns, ending in a
 * RiskBudget the algo engine may adopt or tighten (never loosen). Pure. Every output is for the inputs entered:
 * the calculator never takes a size from an account balance.
 */
import type { RiskBudget } from "../contracts";
import { stationaryIndices } from "../stats/bootstrap";
import { maxDrawdown, mean, quantile, rng, std, wealth } from "../stats/core";
import { continuousGrowth, discreteGrowth, drawdownProb, growthShare, kellyDiscrete, uncertainKelly } from "../stats/kelly";
import { matvec, type Mat } from "../stats/linalg";
import { DISCLOSURES, T } from "../words";

export const SIZING_VERSION = "q4-2026-10-15.1";

/* ---------------- Kelly ---------------- */

export type BetInput = { kind: "bet"; pLow: number; pHigh: number; odds: number; current?: number };
export type AssetInput = { kind: "asset"; sharpeLow: number; sharpeHigh: number; vol: number; current?: number };

export type KellyResult = {
  kind: "bet" | "asset"; central: number; lowEnd: number; robust: number; quarter: number; recommendedView: number;
  curve: { fraction: number; growthCentral: number; growthLow: number }[]; current: number | null;
  drawdownTable: { label: string; fraction: number; ofKelly: number; growthShare: number; pHalf: number; pThird: number }[];
  notes: string[]; sentence: string; disclosure: string;
};

/**
 * Kelly for a bet (win probability as a range, odds b to 1) or an asset (annual Sharpe ratio as a range and its
 * volatility). Ranges are read as 90% intervals of a normal belief. The view leads with the smaller of the
 * uncertainty-adjusted fraction and quarter Kelly, never with full Kelly.
 */
export function kelly(input: BetInput | AssetInput): KellyResult {
  const notes: string[] = [];
  let central: number, lowEnd: number, robust: number;
  const curve: KellyResult["curve"] = [];
  if (input.kind === "bet") {
    const pl = Math.min(input.pLow, input.pHigh), ph = Math.max(input.pLow, input.pHigh), b = input.odds;
    const pm = (pl + ph) / 2;
    central = Math.max(0, kellyDiscrete(pm, b));
    lowEnd = Math.max(0, kellyDiscrete(pl, b));
    // Expected log growth is linear in p, so averaging it over a belief about p gives the same optimum as the
    // mean p: for one bet the uncertainty-adjusted fraction equals full Kelly at the midpoint. The low end of the
    // range is what shows the cost of being wrong about p.
    robust = central;
    const top = Math.min(0.99, Math.max(central * 2, 0.05));
    for (let i = 0; i <= 200; i++) { const f = (top * i) / 200; curve.push({ fraction: f, growthCentral: discreteGrowth(f, pm, b), growthLow: discreteGrowth(f, pl, b) }); }
    if (ph > pl) notes.push("For a single bet, uncertainty about the win rate averages out of the expected growth; the low end of your range shows what overbetting would cost if the edge is smaller.");
  } else {
    const sl = Math.min(input.sharpeLow, input.sharpeHigh), sh = Math.max(input.sharpeLow, input.sharpeHigh), vol = input.vol;
    const muMid = ((sl + sh) / 2) * vol, sdMu = ((sh - sl) / (2 * 1.645)) * vol;
    const uk = uncertainKelly(muMid, sdMu, vol);
    central = Math.max(0, uk.central); lowEnd = uk.lowEnd; robust = Math.max(0, uk.robust);
    const maxF = Math.max(0.05, 2 * central);
    for (let i = 0; i <= 100; i++) { const f = (maxF * i) / 100; curve.push({ fraction: f, growthCentral: continuousGrowth(f, muMid, vol), growthLow: continuousGrowth(f, sl * vol, vol) }); }
    notes.push("Volatility is taken as known; its own uncertainty would shrink the fraction further.");
  }
  const quarter = central / 4;
  const recommendedView = quarter > 0 ? Math.min(robust, quarter) : robust;
  const cur = input.current ?? null;
  const row = (label: string, f: number) => { const c = central > 0 ? f / central : 0; return { label, fraction: f, ofKelly: c, growthShare: growthShare(Math.min(c, 2)), pHalf: drawdownProb(c, 0.5), pThird: drawdownProb(c, 2 / 3) }; };
  const drawdownTable = [row("Full Kelly", central), row("Half Kelly", central / 2), row("Quarter Kelly", quarter), ...(cur !== null ? [row("Your size", cur)] : [])];
  if (lowEnd < central / 2) notes.push("At the low end of your range, full Kelly is more than twice the growth-optimal size: overbetting grows wealth more slowly than betting less, and past twice the optimum it shrinks it.");
  notes.push(T.halfKelly());
  return { kind: input.kind, central, lowEnd, robust, quarter, recommendedView, curve, current: cur, drawdownTable, notes, sentence: T.kellyFor(central), disclosure: DISCLOSURES.calculator };
}

/** Bootstrapped one- and three-year maximum drawdowns of a return series scaled by `fraction`. Pure. */
export function bootstrapDrawdowns(r: number[], fraction: number, years: 1 | 3, draws = 1_000, seed = 13): { median: number; p95: number } {
  const u = rng(seed), out: number[] = [], n = 252 * years;
  for (let d = 0; d < draws; d++) {
    const idx = stationaryIndices(r.length, 10, u);
    let w = 1, peak = 1, worst = 0;
    for (let t = 0; t < n; t++) { w *= 1 + fraction * r[idx[t % idx.length]]; peak = Math.max(peak, w); worst = Math.max(worst, 1 - w / peak); }
    out.push(worst);
  }
  return { median: quantile(out, 0.5), p95: quantile(out, 0.95) };
}

/* ---------------- Volatility targeting and risk parity ---------------- */

/** Scale = target / forecast volatility (EWMA, λ 0.94), capped at `cap`. Pure. */
export function volTarget(r: number[], target: number, cap = 1.5): { forecast: number; scale: number; note: string } {
  let v = r.slice(0, 20).reduce((s, x) => s + x * x, 0) / Math.max(1, Math.min(20, r.length));
  for (const x of r) v = 0.94 * v + 0.06 * x * x;
  const forecast = Math.sqrt(v * 252);
  return { forecast, scale: forecast > 0 ? Math.min(cap, target / forecast) : cap, note: T.volTargetNote() };
}

/** Inverse-volatility weights. Pure. */
export const inverseVol = (vols: number[]) => { const inv = vols.map((v) => (v > 0 ? 1 / v : 0)); const s = inv.reduce((a, b) => a + b, 0) || 1; return inv.map((x) => x / s); };

/**
 * Equal risk contribution weights (Maillard, Roncalli and Teiletche 2010) by the cyclical coordinate method
 * (Griveau-Billion, Richard and Roncalli): each weight solves its own quadratic in turn until contributions
 * w_i(Σw)_i are equal. Long-only, summing to 1. Pure.
 */
export function riskParity(cov: Mat, iters = 500, tol = 1e-12): { weights: number[]; contributions: number[] } {
  const n = cov.length;
  let x = inverseVol(cov.map((r, i) => Math.sqrt(Math.max(r[i], 1e-16))));
  const b = 1 / n;
  for (let it = 0; it < iters; it++) {
    const prev = [...x];
    for (let i = 0; i < n; i++) {
      const s = cov[i].reduce((acc, c, j) => acc + (j === i ? 0 : c * x[j]), 0);
      const sx = matvec(cov, x);
      const sig = Math.sqrt(Math.max(x.reduce((acc, xi, k) => acc + xi * sx[k], 0), 1e-30));
      const a = cov[i][i];
      x[i] = (-s + Math.sqrt(s * s + 4 * a * b * sig)) / (2 * a);
    }
    if (x.every((v, i) => Math.abs(v - prev[i]) < tol)) break;
  }
  const tot = x.reduce((a, c) => a + c, 0);
  x = x.map((v) => v / tot);
  const sx = matvec(cov, x), vp = x.reduce((a, xi, i) => a + xi * sx[i], 0);
  return { weights: x, contributions: x.map((xi, i) => (xi * sx[i]) / vp) };
}

/* ---------------- The drawdown governor ---------------- */

export type Rule = { fromPeakPct: number; action: "halve" | "flatten" | "pause_new" | "notify" };
export type Template = { kind: "pod" } | { kind: "floor"; floorPct: number; multiplier: number } | { kind: "custom"; rules: Rule[]; pauseSessions: number };
export const POD: Template = { kind: "pod" };
export const POD_RULES: Rule[] = [{ fromPeakPct: 0.05, action: "halve" }, { fromPeakPct: 0.075, action: "flatten" }];

export type GovernorRun = {
  template: Template; rules: Rule[];
  base: { totalReturn: number; maxDrawdown: number; vol: number };
  governed: { totalReturn: number; maxDrawdown: number; vol: number };
  returnGivenUp: number; drawdownAvoided: number; triggers: { index: number; date?: string; action: string; drawdown: number }[];
  soldNearBottom: { index: number; date?: string; recovery: number }[]; exposure: number[]; sentence: string;
};

/**
 * Simulate a governor on a return series (`r` daily, at full exposure). Exposure is 1 normally.
 * - pod: a fall of 5% from the governed peak halves exposure until the fall is back under 2.5%; 7.5% flattens
 *   and pauses for 10 sessions, then restarts at half with the peak reset (a new allocation, as pods do).
 * - floor (CPPI, Grossman and Zhou): exposure = min(1.5, m·(W - F)/W), F = floorPct of the running peak.
 * - custom: the person's levels and actions (halve, flatten with a pause, notify only).
 * Flags each de-risking that the series recovered from by more than 10% within 60 sessions. Pure.
 */
export function governor(r: number[], template: Template, dates?: string[]): GovernorRun {
  const rules = template.kind === "pod" ? POD_RULES : template.kind === "custom" ? [...template.rules].sort((a, b) => a.fromPeakPct - b.fromPeakPct) : [];
  const pause = template.kind === "custom" ? template.pauseSessions : 10;
  let W = 1, peak = 1, exposure = 1, paused = 0, state: "full" | "half" | "flat" = "full";
  const exp: number[] = [], triggers: GovernorRun["triggers"] = [], gr: number[] = [];
  for (let t = 0; t < r.length; t++) {
    exp.push(exposure);
    const ret = exposure * r[t];
    gr.push(ret);
    W *= 1 + ret;
    if (W > peak) peak = W;
    const dd = 1 - W / peak;
    if (template.kind === "floor") {
      const F = template.floorPct * peak;
      exposure = Math.max(0, Math.min(1.5, (template.multiplier * (W - F)) / W));
      continue;
    }
    if (paused > 0) { paused--; if (!paused) { exposure = 0.5; state = "half"; peak = W; } continue; }
    let acted = false;
    for (const rule of [...rules].reverse()) {
      if (dd < rule.fromPeakPct) continue;
      if (rule.action === "flatten" && state !== "flat") { exposure = 0; state = "flat"; paused = pause; triggers.push({ index: t, date: dates?.[t], action: "flatten", drawdown: dd }); acted = true; }
      else if (rule.action === "halve" && state === "full") { exposure = 0.5; state = "half"; triggers.push({ index: t, date: dates?.[t], action: "halve", drawdown: dd }); acted = true; }
      else if ((rule.action === "notify" || rule.action === "pause_new") && !triggers.some((x) => x.action === rule.action && t - x.index < 20)) { triggers.push({ index: t, date: dates?.[t], action: rule.action, drawdown: dd }); acted = true; }
      if (acted) break;
    }
    if (!acted && state === "half" && dd < (rules[0]?.fromPeakPct ?? 0.05) / 2) { exposure = 1; state = "full"; }
  }
  const stats = (x: number[]) => ({ totalReturn: wealth(x)[x.length] - 1, maxDrawdown: maxDrawdown(wealth(x)), vol: std(x) * Math.sqrt(252) });
  const base = stats(r), governed = stats(gr);
  const soldNearBottom = triggers.filter((x) => x.action === "halve" || x.action === "flatten").map((x) => {
    const w = wealth(r.slice(x.index + 1, x.index + 61));
    return { index: x.index, date: x.date, recovery: Math.max(...w) - 1 };
  }).filter((x) => x.recovery > 0.1);
  const sentence = `On this history the rules ${governed.totalReturn < base.totalReturn ? `gave up ${((base.totalReturn - governed.totalReturn) * 100).toFixed(1)} points of return` : `added ${((governed.totalReturn - base.totalReturn) * 100).toFixed(1)} points of return`} and changed the worst drawdown from ${(base.maxDrawdown * 100).toFixed(1)}% to ${(governed.maxDrawdown * 100).toFixed(1)}%${soldNearBottom.length ? `; ${soldNearBottom.length} de-risking${soldNearBottom.length === 1 ? " was" : "s were"} followed by a recovery of more than 10% within 60 sessions, which stop rules often miss` : ""}.`;
  return { template, rules, base, governed, returnGivenUp: base.totalReturn - governed.totalReturn, drawdownAvoided: base.maxDrawdown - governed.maxDrawdown, triggers, soldNearBottom, exposure: exp, sentence };
}

/* ---------------- The risk budget ---------------- */

/**
 * A RiskBudget from the person's choices: the Kelly fraction they settled on (a fraction of full Kelly, after
 * the uncertainty haircut), the governor's rules, a volatility target and position limits. Pure.
 */
export function buildRiskBudget(o: { ownerId: string; accountRef: string | null; kelly: KellyResult | null; ofKelly?: number; rules: Rule[]; volTarget: number | null; maxPositionWeight: number; maxGross: number; maxDailyLossPct: number; returns?: number[] }): RiskBudget {
  const kf = Math.min(1, Math.max(0, o.ofKelly ?? (o.kelly && o.kelly.central > 0 ? Math.min(o.kelly.recommendedView / o.kelly.central, 0.5) : 0.25)));
  const rules = [...o.rules].sort((a, b) => a.fromPeakPct - b.fromPeakPct);
  const vol = o.returns && o.returns.length > 20 ? std(o.returns) * Math.sqrt(252) : null;
  return {
    ownerId: o.ownerId, accountRef: o.accountRef, asOf: new Date().toISOString(),
    maxPositionWeight: Math.min(1, Math.max(0.005, o.maxPositionWeight)), maxGross: Math.min(4, Math.max(0.05, o.maxGross)), maxDailyLossPct: Math.min(1, Math.max(0.001, o.maxDailyLossPct)),
    volTarget: o.volTarget && o.volTarget > 0 ? Math.min(2, o.volTarget) : null, kellyFraction: kf, drawdownRules: rules,
    basis: `For the inputs entered: ${(kf * 100).toFixed(0)}% of full Kelly${o.kelly ? ` (full Kelly ${(o.kelly.central * 100).toFixed(1)}%, uncertainty-adjusted ${(o.kelly.robust * 100).toFixed(1)}%)` : ""}; drawdown rules ${rules.map((r) => `${(r.fromPeakPct * 100).toFixed(1)}% ${r.action}`).join(", ") || "none"}${o.volTarget ? `; volatility target ${(o.volTarget * 100).toFixed(0)}%` : ""}${vol !== null ? `; the entered returns' volatility ${(vol * 100).toFixed(1)}%` : ""}. A budget the algo engine may adopt or tighten, never loosen.`,
  };
}

export { mean };
