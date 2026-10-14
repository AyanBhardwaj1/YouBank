/**
 * The LBO Stress Lab (E6): a buyout run over thousands of labelled synthetic macro and operating paths, not
 * one base case. Pure: the data (factor history, the company's filings, the deal database's exit multiples,
 * the rate history) is loaded by lab.ts and passed in as parameters, so the same simulation runs here for the
 * 1,000-path preview and in ml/lbo_core.py for the 20,000-path refine.
 *
 * Each path, month by month:
 * - Macro: GJR-GARCH(1,1) per factor (the market, the 10-year yield and, for energy companies, oil and gas
 *   stocks) fitted on monthly history, joined by filtered historical simulation: whole real months of
 *   standardised shocks resampled and scaled to the simulated volatility (the factor engine of Scenarios, on
 *   monthly steps).
 * - Rates: the two-regime AR(1) short rate (rates.ts), its shock correlated with the 10-year factor's.
 * - Refinancing spread: there is no free high-yield spread history that may feed a model, so the spread new
 *   revolver money costs is an assumption tied to the equity drawdown, from published historical ranges; it is
 *   labelled and editable.
 * Each quarter, operating results respond: revenue grows at the company's own median pace plus its beta to the
 * market (and sector) plus resampled idiosyncratic quarters; costs are 30% fixed (as Scenarios' company model);
 * margins carry a mean-reverting shock. The exit multiple per path starts from the deal database's sponsor
 * multiples and moves with the market over the hold (an elasticity, labelled as an assumption).
 *
 * Outputs: the IRR and MOIC distributions, P(IRR < 0), P(MOIC < 1x), P(covenant breach) by year and covenant,
 * P(equity under half of entry), liquidity defaults, the attribution as distributions, the most a sponsor can
 * pay for a 20% IRR with at least 60% probability, and the gentlest scenario that breaks the deal (reverse.ts).
 * Every result is SYNTHETIC and carries its recipe and seed.
 */
import { lboSchedule, q, steadyPath, type Path, type Structure } from "./lbo";
import { rateStep, type RateModel } from "./rates";
import { reverseStress, type ReverseResult } from "./reverse";
import { normals, rng } from "./stats";
import { pathSeed } from "./views";

export type FactorFit = { mu: number; omega: number; alpha: number; gamma: number; beta: number; lastVar: number };
export type MacroParams = { names: string[]; fits: FactorFit[]; Z: number[][]; market: number; rates: number; sector: number; months: number; from: string; to: string };
export type OperatingParams = {
  revenue0: number; ebitda0: number; growthQ: number; betaMarket: number; betaSector: number; residSd: number; residuals: number[];
  fixedShare: number; costInflQ: number; marginKappa: number; marginSd: number; source: string;
};
export type ExitParams = { base: number; sigma: number; elasticity: number; n: number; source: string };
export type SpreadParams = { baseBps: number; slopeBpsPerPct: number; capBps: number; source: string };
export type StressSpec = {
  structure: Structure; macro: MacroParams; rates: RateModel; op: OperatingParams; exit: ExitParams; spread: SpreadParams;
  paths: number; seed: number; hurdle: number; confidence: number; breakYear: number;
};

export type PathSet = {
  paths: Path[];
  /** Per path, for the reverse stress test and the fan: SOFR change to the break year (bp), EBITDA change to it (fraction), the exit multiple, the market's cumulative log return by year, and the exit's own noise. */
  rateChange: Float64Array; ebitdaChange: Float64Array; exitMultiple: Float64Array; marketByYear: Float64Array[]; exitNoise: Float64Array;
  /** Monthly factor returns of the first paths, for the realism check. */
  sample: number[][][];
};

/** The quarterly assumed refinancing spread from the equity drawdown (fraction below the running peak). Pure. */
export const spreadAt = (s: SpreadParams, drawdown: number) => Math.min(s.capBps, s.baseBps + s.slopeBpsPerPct * Math.max(0, drawdown) * 100);

/** Simulate every path's drivers and operating results. Pure; reproducible from the seed. */
export function simulatePaths(spec: StressSpec): PathSet {
  const { macro, op, exit, structure: st } = spec;
  const Q = st.years * 4, M = Q * 3, P = spec.paths, by = Math.min(spec.breakYear, st.years);
  const F = macro.fits.length;
  const mktMeanQ = macro.market >= 0 ? 3 * macro.fits[macro.market].mu : 0, secMeanQ = macro.sector >= 0 ? 3 * macro.fits[macro.sector].mu : 0;
  const cost0 = op.revenue0 - op.ebitda0;
  const out: PathSet = { paths: [], rateChange: new Float64Array(P), ebitdaChange: new Float64Array(P), exitMultiple: new Float64Array(P), marketByYear: Array.from({ length: st.years }, () => new Float64Array(P)), exitNoise: new Float64Array(P), sample: [] };
  for (let i = 0; i < P; i++) {
    const u = rng(pathSeed(spec.seed, i)), n = normals(u);
    const v = macro.fits.map((g) => g.lastVar);
    const rate = rateStep(spec.rates);
    const ebitda = new Float64Array(Q), sofr = new Float64Array(Q), spread = new Float64Array(Q);
    const sofrStart = spec.rates.start + spec.rates.basis;
    let R = op.revenue0, nu = 0, cum = 0, peak = 0, mq = 0, sq = 0, rq = 0, sofrBy = sofrStart;
    const monthly: number[][] = [];
    for (let m = 0; m < M; m++) {
      const z = macro.Z[Math.floor(u() * macro.Z.length)];
      const ret = new Array<number>(F);
      for (let j = 0; j < F; j++) { const g = macro.fits[j]; const e = Math.sqrt(v[j]) * z[j]; v[j] = g.omega + (g.alpha + (e < 0 ? g.gamma : 0)) * e * e + g.beta * v[j]; ret[j] = g.mu + e; }
      if (i < 200) monthly.push(ret);
      const r = rate(macro.rates >= 0 ? z[macro.rates] : 0, u, n);
      const mk = macro.market >= 0 ? ret[macro.market] : 0;
      mq += mk; sq += macro.sector >= 0 ? ret[macro.sector] : 0; rq += r + spec.rates.basis;
      cum += mk; peak = Math.max(peak, cum);
      if ((m + 1) % 3 === 0) {
        const t = (m + 1) / 3 - 1;
        const resid = op.residuals.length >= 8 ? op.residuals[Math.floor(u() * op.residuals.length)] : op.residSd * n();
        const g = op.growthQ + op.betaMarket * (mq - mktMeanQ) + op.betaSector * (sq - secMeanQ) + resid;
        R *= Math.exp(Math.max(-0.5, Math.min(0.5, g)));
        nu = (1 - op.marginKappa) * nu + op.marginSd * n();
        const costs = op.fixedShare * cost0 * Math.exp(op.costInflQ * (t + 1)) + (1 - op.fixedShare) * cost0 * (R / op.revenue0);
        ebitda[t] = R - costs + nu * R;
        sofr[t] = rq / 3;
        spread[t] = spreadAt(spec.spread, 1 - Math.exp(cum - peak));
        if ((t + 1) % 4 === 0) out.marketByYear[(t + 1) / 4 - 1][i] = cum;
        if (t + 1 === by * 4) { sofrBy = sofr[t]; out.ebitdaChange[i] = ebitda[t] / op.ebitda0 - 1; }
        mq = 0; sq = 0; rq = 0;
      }
    }
    if (i < 200) out.sample.push(monthly);
    const noise = n();
    const expected = mktMeanQ * Q;
    const x = Math.max(exit.base * 0.3, Math.min(exit.base * 3, exit.base * Math.exp(exit.elasticity * (cum - expected) + exit.sigma * noise)));
    out.paths.push({ ebitda, sofr, exitMultiple: x, revolverSpreadBps: spread });
    out.rateChange[i] = (sofrBy - sofrStart) * 100; out.exitMultiple[i] = x; out.exitNoise[i] = noise;
  }
  return out;
}

export type Dist = { p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; mean: number };
const dist = (xs: ArrayLike<number>): Dist => {
  const s = Float64Array.from(xs).filter(Number.isFinite).sort();
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { p5: q(s, 0.05), p10: q(s, 0.1), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p90: q(s, 0.9), p95: q(s, 0.95), mean };
};

export type StressResult = {
  paths: number; seed: number; years: number;
  irr: Dist; moic: Dist; histogram: { lo: number; hi: number; n: number }[];
  odds: { irrBelowZero: number; moicBelowOne: number; equityBelowHalf: number; breachAny: number; defaulted: number; irrAboveHurdle: number };
  breachByYear: number[]; heatmap: { year: number; leverage: number; cover: number }[];
  fan: { year: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  attribution: { label: string; p10: number; p50: number; p90: number }[];
  maxPrice: { multiple: number | null; tev: number | null; hurdle: number; confidence: number; curve: { multiple: number; prob: number }[] };
  reverse: ReverseResult;
  base: { irr: number; moic: number; firstBreach: number; note: string };
};

/** Probability that the IRR clears the hurdle at a given entry multiple, over the same paths. Pure. */
export function probAbove(st: Structure, paths: Path[], multiple: number, hurdle: number): number {
  let ok = 0, n = 0;
  for (const p of paths) {
    try { const r = lboSchedule({ ...st, entryMultiple: multiple }, p, false); n++; if (r.irr >= hurdle && r.defaulted < 0) ok++; }
    catch { n++; }
  }
  return n ? ok / n : 0;
}

/** The largest entry multiple whose P(IRR >= hurdle) is at least `confidence` (bisection), with the curve. Pure. */
export function maxEntry(st: Structure, paths: Path[], hurdle: number, confidence: number): StressResult["maxPrice"] {
  const centre = st.entryMultiple;
  const grid = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5].map((k) => Math.round(centre * k * 10) / 10);
  const curve = grid.map((m) => ({ multiple: m, prob: probAbove(st, paths, m, hurdle) }));
  // P(IRR >= hurdle) falls as the price rises; find where it crosses the confidence line.
  // The lowest price the debt leaves any equity at (below it sources exceed uses), then a little above.
  const debt = st.tranches.filter((t) => t.kind !== "revolver").reduce((a, t) => a + t.turns, 0) * st.ebitda0;
  const floor = (debt * (1 - st.financeFeePct / 100) - st.minCash) / (st.ebitda0 * (1 + st.txnFeePct / 100));
  let lo = Math.max(1, floor + 0.25), hi = Math.max(lo + 1, centre * 2);
  if (probAbove(st, paths, lo, hurdle) < confidence) return { multiple: null, tev: null, hurdle, confidence, curve };
  for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (probAbove(st, paths, mid, hurdle) >= confidence) lo = mid; else hi = mid; }
  return { multiple: lo, tev: lo * st.ebitda0, hurdle, confidence, curve };
}

/**
 * What each path came to: the per-path numbers every summary is made from. The preview computes them here; the
 * 20,000-path refine computes the same arrays on the ML service (ml/lbo_core.py) and the same summary follows.
 */
export type Outcomes = {
  irr: number[]; moic: number[]; equity: number; exitEquity: number[]; firstBreach: number[]; defaulted: number[];
  lev: number[][]; cov: number[][]; ltmE: number[][]; netDebt: number[][];
  growth: number[]; multiple: number[]; paydown: number[]; fees: number;
  rateChange: number[]; ebitdaChange: number[]; exitNoise: number[]; marketByYear: number[][];
};

/** Run the buyout down every path. Pure. */
export function outcomesOf(spec: StressSpec, set: PathSet): Outcomes {
  const st = spec.structure;
  const rs = set.paths.map((p) => lboSchedule(st, p, false));
  const Y = st.years;
  return {
    irr: rs.map((r) => r.irr), moic: rs.map((r) => r.moic), equity: rs[0]?.equity ?? 0, exitEquity: rs.map((r) => r.exitEquity), firstBreach: rs.map((r) => r.firstBreach), defaulted: rs.map((r) => r.defaulted),
    lev: Array.from({ length: Y }, (_, y) => rs.map((r) => (r.yearly[y]?.lev ? 1 : 0))), cov: Array.from({ length: Y }, (_, y) => rs.map((r) => (r.yearly[y]?.cov ? 1 : 0))),
    ltmE: Array.from({ length: Y }, (_, y) => rs.map((r) => r.yearly[y]?.ltmE ?? NaN)), netDebt: Array.from({ length: Y }, (_, y) => rs.map((r) => r.yearly[y]?.netDebt ?? NaN)),
    growth: rs.map((r) => r.attribution.growth), multiple: rs.map((r) => r.attribution.multiple), paydown: rs.map((r) => r.attribution.paydown), fees: rs[0]?.attribution.fees ?? 0,
    rateChange: Array.from(set.rateChange), ebitdaChange: Array.from(set.ebitdaChange), exitNoise: Array.from(set.exitNoise), marketByYear: set.marketByYear.map((m) => Array.from(m)),
  };
}

/** Run the buyout over every path and summarise (the preview). Pure. */
export function runStress(spec: StressSpec, set: PathSet = simulatePaths(spec)): StressResult {
  return summarise(spec, outcomesOf(spec, set), maxEntry(spec.structure, set.paths, spec.hurdle, spec.confidence));
}

/** The summary of per-path outcomes: distributions, odds, breach by year and covenant, the fan, attribution, reverse stress. Pure. */
export function summarise(spec: StressSpec, o: Outcomes, maxPrice: StressResult["maxPrice"]): StressResult {
  const st = spec.structure, P = o.irr.length, Y = st.years;
  const by = Math.min(spec.breakYear, Y);
  const breachBy = (y: number) => o.firstBreach.filter((t) => t > 0 && t <= y * 4).length / P;
  const heatmap = Array.from({ length: Y }, (_, y) => ({ year: y + 1, leverage: (o.lev[y] ?? []).reduce((a, b) => a + b, 0) / P, cover: (o.cov[y] ?? []).reduce((a, b) => a + b, 0) / P }));
  const fan = Array.from({ length: Y }, (_, y) => {
    const m = o.marketByYear[y] ?? [];
    const mean = m.reduce((a, b) => a + b, 0) / Math.max(1, m.length);
    const vals = o.irr.map((_, i) => {
      const x = Math.max(spec.exit.base * 0.3, Math.min(spec.exit.base * 3, spec.exit.base * Math.exp(spec.exit.elasticity * ((m[i] ?? mean) - mean) + spec.exit.sigma * (o.exitNoise[i] ?? 0))));
      return ((o.ltmE[y]?.[i] ?? NaN) * x - (o.netDebt[y]?.[i] ?? NaN)) / o.equity;
    });
    const d = dist(vals);
    return { year: y + 1, p5: d.p5, p25: d.p25, p50: d.p50, p75: d.p75, p95: d.p95 };
  });
  const sorted = Float64Array.from(o.irr).sort();
  const lo = Math.max(-1, q(sorted, 0.01)), hi = Math.min(2, q(sorted, 0.99));
  const bins = 24, w = (hi - lo) / bins || 0.01;
  const histogram = Array.from({ length: bins }, (_, k) => ({ lo: lo + k * w, hi: lo + (k + 1) * w, n: o.irr.filter((v) => v >= lo + k * w && (v < lo + (k + 1) * w || (k === bins - 1 && v <= hi))).length }));
  const attribution = [
    { label: "EBITDA growth", ...pick(dist(o.growth)) }, { label: "Multiple change", ...pick(dist(o.multiple)) },
    { label: "Debt paydown and cash build", ...pick(dist(o.paydown)) }, { label: "Fees at entry", p10: o.fees, p50: o.fees, p90: o.fees },
  ];
  const event = Uint8Array.from(o.firstBreach, (t) => (t > 0 && t <= by * 4 ? 1 : 0));
  const reverse = reverseStress({ rates: Float64Array.from(o.rateChange), ebitda: Float64Array.from(o.ebitdaChange) }, event, { target: 0.5, firstBreach: Float64Array.from(o.firstBreach), covenant: covenantWords(st), year: by });
  const steadyGrowth = Math.exp(spec.op.growthQ * 4) - 1;
  const base = lboSchedule({ ...st }, steadyPath(st.ebitda0, steadyGrowth, spec.rates.start + spec.rates.basis, spec.exit.base, Y, 4), false);
  return {
    paths: P, seed: spec.seed, years: Y, irr: dist(o.irr), moic: dist(o.moic), histogram,
    odds: {
      irrBelowZero: o.irr.filter((v) => v < 0).length / P, moicBelowOne: o.moic.filter((v) => v < 1).length / P, equityBelowHalf: o.exitEquity.filter((v) => v < 0.5 * o.equity).length / P,
      breachAny: o.firstBreach.filter((t) => t > 0).length / P, defaulted: o.defaulted.filter((t) => t > 0).length / P, irrAboveHurdle: o.irr.filter((v) => v >= spec.hurdle).length / P,
    },
    breachByYear: Array.from({ length: Y }, (_, y) => breachBy(y + 1)), heatmap, fan, attribution, maxPrice, reverse,
    base: { irr: base.irr, moic: base.moic, firstBreach: base.firstBreach, note: `A single steady path (EBITDA growing ${(steadyGrowth * 100).toFixed(1)}% a year, SOFR flat at ${(spec.rates.start + spec.rates.basis).toFixed(2)}%, exit at ${spec.exit.base.toFixed(1)}x): the one case a spreadsheet would show.` },
  };
}

const pick = (d: Dist) => ({ p10: d.p10, p50: d.p50, p90: d.p90 });

/** The covenants in words, for the breach sentence. Pure. */
export function covenantWords(st: Structure): string {
  const c = st.covenants;
  const parts = [c.maxNetLeverage !== null ? `the ${c.maxNetLeverage.toFixed(1)}x net leverage test` : "", c.minInterestCover !== null ? `the ${c.minInterestCover.toFixed(1)}x interest cover test` : ""].filter(Boolean);
  return `${parts.join(" or ") || "its covenant"}${c.springing ? " (springing, while the revolver is drawn)" : ""}`;
}
