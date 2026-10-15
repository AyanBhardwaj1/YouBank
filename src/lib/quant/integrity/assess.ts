/**
 * Q3, the Backtest Integrity Checker: is this backtest real? Pure: every number comes from the inputs, so the
 * same inputs always give the same report (bootstraps are seeded). The server side (check.ts) gathers the
 * trials from quant_trials; "check a claim" (claim.ts) feeds typed numbers.
 *
 * Four groups of checks (docs/quant-edge.md, Q3):
 * 1. Statistics: annualised Sharpe with a stationary-bootstrap 90% interval; PSR against zero; DSR with N from
 *    the trial log (raw and effective); MinTRL; PBO by CSCV when there are at least two trials and enough rows;
 *    the BHY haircut and the t-above-3 rule; White's Reality Check (Pro).
 * 2. Data hygiene: look-ahead reads, same-bar execution, survivorship, restatements, LLM inputs.
 * 3. Implementation: Sharpe at 0, 10, 25 and 50 bp round trip and the breakeven cost, turnover, capacity, borrow.
 * 4. Robustness: year-by-year Sharpe, a placebo (the returns with random signs in blocks), neighbourhood
 *    stability on a parameter grid, the factor-adjusted alpha.
 *
 * The grade (A-F) follows explicit rules, and the rule that set it is returned with it. Reconstructed signals
 * cap the grade at B. "An A means fewer reasons to doubt it, not a promise."
 */
import type { IntegrityReport } from "../contracts";
import { bootstrapCi, politisWhite, realityCheck, stationaryIndices } from "../stats/bootstrap";
import { annualise, mean, moments, quantile, rng, sharpe as srOf } from "../stats/core";
import { dsrFromStats, effectiveTrials, haircutSharpe, minTrlFromStats, passesT3, psrFromStats } from "../stats/integrity";
import { blocksFor, pbo as pboOf } from "../stats/pbo";
import { ols } from "../stats/regress";
import type { TrialHygiene } from "../trials";
import { DISCLOSURES } from "../words";

export const INTEGRITY_VERSION = "q3-2026-10-15.1";

export type Status = "pass" | "warn" | "fail" | "na";
export type Check = { id: string; group: "statistics" | "hygiene" | "implementation" | "robustness"; label: string; status: Status; detail: string };

export type IntegrityInput = {
  returns: number[];
  periodsPerYear: number;
  dates?: string[];
  /** Per-period Sharpe ratios of every trial in the family, the assessed one included. */
  trialSharpes: number[];
  /** Trials' returns on common rows (T x N), for effective trials, PBO and the Reality Check. */
  matrix?: number[][];
  /** Index of the assessed trial in the matrix's columns. */
  matrixColumn?: number;
  /** Trials' parameters, aligned with trialSharpes, for neighbourhood stability. */
  trialParams?: Record<string, unknown>[];
  assessedIndex?: number;
  hygiene: TrialHygiene;
  /** Trials declared by the person (uploads, "check a claim"), used when larger than the counted ones. */
  declaredTrials?: number;
  /** Factor returns aligned with `returns` (rows) for the factor-adjusted alpha. */
  factors?: { names: string[]; rows: number[][]; source: string };
  pro: boolean;
  seed?: number;
};

export type Assessment = {
  report: IntegrityReport;
  rule: string;
  checks: Check[];
  stats: {
    n: number; years: number; sharpe: number; sharpeLow: number; sharpeHigh: number; psr: number; dsrRaw: number | null; dsrEffective: number | null;
    srStarAnnual: number; trials: number; trialsCounted: number; trialsDeclared: number | null; effectiveTrials: number; silhouette: number | null;
    minTrlYears: number | null; skew: number; kurt: number; haircut: { sharpe: number; share: number } | null; t3: boolean; block: number;
    pbo: { pbo: number; slope: number; probOosLoss: number; splits: number; blocks: number } | null; realityCheckP: number | null;
  };
  costs: { bps: number; sharpe: number }[] | null;
  breakevenBps: number | null;
  years: { year: string; sharpe: number; n: number }[];
  placebo: { p: number; draws: number; samples: number[] } | null;
  neighbourhood: { lonePeak: boolean; best: number; neighbours: number; median: number | null; grid: { x: string; y: string | null; cells: { x: number; y: number | null; sharpe: number }[] } | null } | null;
  factorAlpha: { alphaAnnual: number; t: number; r2: number; betas: Record<string, number>; source: string } | null;
  whatWouldChange: string[];
  disclosures: string[];
};

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Per-period cost drag of a round-trip cost in bp at `turnover` round trips a year. */
const drag = (bps: number, turnover: number, ppy: number) => (bps / 1e4) * turnover / ppy;

export function assess(input: IntegrityInput): Assessment {
  const { returns: r, periodsPerYear: ppy, hygiene: h } = input;
  if (r.length < 20) throw Object.assign(new Error("An integrity check needs at least 20 returns."), { status: 400 });
  const seed = input.seed ?? 17;
  const m = moments(r);
  const sr = m.std > 0 ? m.mean / m.std : 0;
  const years = r.length / ppy;
  const checks: Check[] = [];

  /* ---------- 1. Statistics ---------- */
  const block = politisWhite(r);
  const ci = bootstrapCi(r, (s) => annualise(srOf(s), ppy), { draws: input.pro ? 2_000 : 600, seed, block });
  const psr = psrFromStats(sr, m.n, m.skew, m.kurt, 0);
  const counted = input.trialSharpes.filter(Number.isFinite).length || 1;
  const declared = input.declaredTrials && input.declaredTrials > counted ? Math.round(input.declaredTrials) : null;
  const trials = declared ?? counted;
  const xs = input.trialSharpes.filter(Number.isFinite);
  const mu = xs.length ? mean(xs) : sr;
  // Variance of the trials' Sharpe ratios; with too few trials, the variance of a zero-skill Sharpe over n periods.
  const vTrials = xs.length > 2 ? xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1) : 1 / Math.max(1, m.n - 1);
  let eff = { effective: trials, silhouette: null as number | null };
  if (input.matrix && input.matrix.length >= 20 && (input.matrix[0]?.length ?? 0) >= 2) {
    const cols = input.matrix[0].length;
    const series = Array.from({ length: Math.min(cols, 500) }, (_, j) => input.matrix!.map((row) => row[j]));
    const e = effectiveTrials(series);
    eff = { effective: Math.max(1, Math.min(trials, declared ? Math.max(e.effective, Math.round((e.effective * declared) / cols)) : e.effective)), silhouette: e.silhouette };
  }
  const dRaw = dsrFromStats(sr, m.n, m.skew, m.kurt, trials, vTrials);
  const dEff = dsrFromStats(sr, m.n, m.skew, m.kurt, eff.effective, vTrials);
  const dsr = trials > 1 ? dEff.dsr : psr;
  const mt = minTrlFromStats(sr, m.skew, m.kurt, 0, 0.05);
  const minTrlYears = Number.isFinite(mt) ? mt / ppy : null;
  const hc = trials > 1 ? haircutSharpe(annualise(sr, ppy), years, trials, "bhy") : null;
  const t3 = passesT3(annualise(sr, ppy), years);
  checks.push({ id: "sharpe", group: "statistics", label: "Sharpe ratio and its interval", status: ci.low > 0 ? "pass" : "warn", detail: `Annualised Sharpe ${fmt(annualise(sr, ppy))}, 90% interval ${fmt(ci.low)} to ${fmt(ci.high)} (stationary bootstrap, mean block ${fmt(block, 1)} periods${ci.low <= 0 ? "; the interval includes zero" : ""}).` });
  checks.push({ id: "psr", group: "statistics", label: "Probabilistic Sharpe ratio", status: psr >= 0.95 ? "pass" : psr >= 0.8 ? "warn" : "fail", detail: `P(true Sharpe > 0) = ${fmt(psr, 3)}, allowing for skew ${fmt(m.skew)} and kurtosis ${fmt(m.kurt)}.` });
  checks.push({ id: "dsr", group: "statistics", label: "Deflated Sharpe ratio", status: dsr >= 0.95 ? "pass" : dsr >= 0.7 ? "warn" : "fail", detail: trials > 1 ? `DSR ${fmt(dsr, 3)} after ${trials.toLocaleString("en-US")} trials${declared ? " (as declared; counted: " + counted + ")" : ""}, ${eff.effective} effectively independent. The best of ${trials} random strategies would show an annualised Sharpe of about ${fmt(annualise(dEff.srStar, ppy))} by chance.` : "One trial: nothing to deflate, so DSR equals PSR. Every further variant you test is counted." });
  checks.push({ id: "mintrl", group: "statistics", label: "Minimum track record", status: minTrlYears === null ? "fail" : years >= minTrlYears ? "pass" : years >= minTrlYears / 2 ? "warn" : "fail", detail: minTrlYears === null ? "The Sharpe ratio is not above zero, so no track record length would be enough." : `${fmt(years, 1)} years of data against a minimum of ${fmt(minTrlYears, 1)} years for 95% confidence that the Sharpe ratio is above zero.` });
  if (hc) checks.push({ id: "haircut", group: "statistics", label: "Multiple-testing haircut", status: hc.haircut < 0.5 ? "pass" : "warn", detail: `After a BHY adjustment for ${trials} tests, the Sharpe ratio of ${fmt(annualise(sr, ppy))} is worth about ${fmt(hc.sharpeAdjusted)} (a ${pct(hc.haircut)} haircut). ${t3 ? "Its t statistic is above 3." : "Its t statistic is below 3, the hurdle Harvey, Liu and Zhu propose for a new factor."}` });

  let pboRes: Assessment["stats"]["pbo"] = null;
  let rcP: number | null = null;
  if (input.matrix && (input.matrix[0]?.length ?? 0) >= 2) {
    const S = blocksFor(input.matrix.length, 16, 20);
    if (S >= 4) {
      const p = pboOf(input.matrix, S);
      pboRes = { pbo: p.pbo, slope: p.slope, probOosLoss: p.probOosLoss, splits: p.splits, blocks: p.blocks };
      checks.push({ id: "pbo", group: "statistics", label: "Probability of backtest overfitting", status: p.pbo <= 0.2 ? "pass" : p.pbo <= 0.5 ? "warn" : "fail", detail: `PBO ${fmt(p.pbo)} over ${p.splits.toLocaleString("en-US")} splits of ${p.blocks} blocks: how often the in-sample winner landed at or below the median out of sample. Out-of-sample loss in ${pct(p.probOosLoss)} of splits; degradation slope ${fmt(p.slope)}.` });
    } else checks.push({ id: "pbo", group: "statistics", label: "Probability of backtest overfitting", status: "na", detail: "Needs at least 16 blocks of 20 rows (or 4 of 20 at minimum) of every trial's returns." });
    if (input.pro) {
      const rc = realityCheck(input.matrix, { draws: 400, seed });
      rcP = rc.pValue;
      checks.push({ id: "reality", group: "statistics", label: "White's Reality Check", status: rc.pValue < 0.05 ? "pass" : rc.pValue < 0.2 ? "warn" : "fail", detail: `p = ${fmt(rc.pValue, 3)} that the best of ${input.matrix[0].length} trials beat zero by data snooping alone.` });
    }
  } else if (trials > 1) checks.push({ id: "pbo", group: "statistics", label: "Probability of backtest overfitting", status: "na", detail: "PBO needs every trial's returns on common dates; only the trial count was available." });

  /* ---------- 2. Data hygiene ---------- */
  const early = (h.reads ?? []).filter((x) => Date.parse(x.usedAt) < Date.parse(x.knownAt));
  const lookAhead = early.length > 0;
  const sameBar = h.executionLagBars === 0;
  const llmExposed = !!h.llmInputs && (!h.llmCutoff || !input.dates?.length || input.dates[0] < h.llmCutoff);
  const restated = h.fundamentals === "latest";
  const pitKnown = (h.reads?.length ?? 0) > 0 || h.fundamentals === "asof";
  const pointInTime = !lookAhead && !restated && pitKnown;
  checks.push({ id: "lookahead", group: "hygiene", label: "Look-ahead", status: lookAhead ? "fail" : (h.reads?.length ?? 0) ? "pass" : "na", detail: lookAhead ? `${early.length} read${early.length === 1 ? " was" : "s were"} used before the data was public, first: ${early[0].key} known ${early[0].knownAt}, used ${early[0].usedAt}.` : (h.reads?.length ?? 0) ? `${h.reads!.length.toLocaleString("en-US")} logged reads, each used after it was public.` : "No read log: the backtest cannot prove its inputs were point in time." });
  checks.push({ id: "samebar", group: "hygiene", label: "Same-bar execution", status: sameBar ? "fail" : h.executionLagBars === undefined ? "na" : "pass", detail: sameBar ? "Signals computed from a day's close are traded at that same close, which nobody can do: the most common retail backtest error." : h.executionLagBars === undefined ? "The execution lag was not stated." : `Trades ${h.executionLagBars} bar${h.executionLagBars === 1 ? "" : "s"} after the signal.` });
  checks.push({ id: "survivorship", group: "hygiene", label: "Survivorship", status: h.survivorshipSafe ? "pass" : "warn", detail: h.survivorshipSafe ? `The universe (${h.universe ?? "stated"}) included securities that later delisted.` : `The universe ${h.universe ? `(${h.universe}) ` : ""}did not include delisted securities, or did not say: results are flattered.` });
  checks.push({ id: "restatements", group: "hygiene", label: "Restatements", status: restated ? "fail" : h.fundamentals === "asof" ? "pass" : "na", detail: restated ? "Fundamentals were read as latest restated values, not as known on each date." : h.fundamentals === "asof" ? "Fundamentals were read as known on each date." : "No fundamentals, or not stated." });
  checks.push({ id: "llm", group: "hygiene", label: "Language-model inputs", status: llmExposed ? "fail" : h.llmInputs ? "pass" : "na", detail: llmExposed ? `A language model's output is an input${h.llmCutoff ? `, and the backtest starts before its training cutoff (${h.llmCutoff})` : " and its training cutoff was not given"}: it may know what happened next (Glasserman and Lin).` : h.llmInputs ? `LLM inputs only after the model's cutoff (${h.llmCutoff}).` : "No language-model inputs." });
  if (h.reconstructed) checks.push({ id: "reconstructed", group: "hygiene", label: "Reconstructed signals", status: "warn", detail: "Some signals were backfilled from archives rather than computed at the time: the grade is capped at B until a live record exists." });
  const hygieneFailure = lookAhead || sameBar || restated || llmExposed;

  /* ---------- 3. Implementation ---------- */
  const assumed = h.costBpsAssumed ?? 0;
  const turnover = h.turnover;
  let costs: Assessment["costs"] = null, breakevenBps: number | null = null;
  if (turnover !== undefined && turnover > 0) {
    const gross = r.map((x) => x + drag(assumed, turnover, ppy));
    const g = moments(gross);
    costs = [0, 10, 25, 50].map((bps) => ({ bps, sharpe: g.std > 0 ? annualise((g.mean - drag(bps, turnover, ppy)) / g.std, ppy) : 0 }));
    breakevenBps = g.mean > 0 ? (g.mean * ppy * 1e4) / turnover : 0;
    const ref = Math.max(assumed, 10);
    checks.push({ id: "costs", group: "implementation", label: "Cost sensitivity", status: breakevenBps >= 3 * ref ? "pass" : breakevenBps >= 2 * ref ? "warn" : "fail", detail: `Turnover ${fmt(turnover, 1)}x a year. Sharpe ${costs.map((c) => `${fmt(c.sharpe)} at ${c.bps} bp`).join(", ")}; breakeven at about ${Math.round(breakevenBps)} bp round trip (assumed: ${assumed} bp).` });
  } else checks.push({ id: "costs", group: "implementation", label: "Cost sensitivity", status: "warn", detail: "Turnover was not given, so costs cannot be tested: every trade pays a spread, commission and impact." });
  if (h.maxAdvShare !== undefined) checks.push({ id: "capacity", group: "implementation", label: "Capacity", status: h.maxAdvShare > 0.05 ? "warn" : "pass", detail: `The largest position is ${pct(h.maxAdvShare)} of its average daily volume${h.accountUsd ? ` at $${h.accountUsd.toLocaleString("en-US")}` : ""}${h.maxAdvShare > 0.05 ? ": above 5%, trading it would move the price" : ""}.` });
  if (h.borrowBpsYear !== undefined) checks.push({ id: "borrow", group: "implementation", label: "Borrow for shorts", status: "pass", detail: `Assumed borrow fee ${h.borrowBpsYear} bp a year.` });

  /* ---------- 4. Robustness ---------- */
  const yearsTable: Assessment["years"] = [];
  if (input.dates && input.dates.length === r.length) {
    const by = new Map<string, number[]>();
    input.dates.forEach((d, i) => { const y = d.slice(0, 4); by.set(y, [...(by.get(y) ?? []), r[i]]); });
    for (const [year, xs2] of by) if (xs2.length >= Math.min(20, ppy / 4)) yearsTable.push({ year, sharpe: annualise(srOf(xs2), ppy), n: xs2.length });
    const neg = yearsTable.filter((y) => y.sharpe < 0).length;
    if (yearsTable.length >= 2) checks.push({ id: "years", group: "robustness", label: "Year by year", status: neg / yearsTable.length > 0.4 ? "warn" : "pass", detail: `${neg} of ${yearsTable.length} calendar years had a negative Sharpe ratio.` });
  }
  let oosSharpe: number | null = null, isSharpe: number | null = null;
  if (h.oosFrom && input.dates?.length === r.length) {
    const k = input.dates.findIndex((d) => d >= h.oosFrom!);
    if (k > 20 && r.length - k >= 20) {
      isSharpe = annualise(srOf(r.slice(0, k)), ppy);
      oosSharpe = annualise(srOf(r.slice(k)), ppy);
      checks.push({ id: "oos", group: "robustness", label: "Out of sample", status: oosSharpe >= isSharpe / 2 && oosSharpe > 0 ? "pass" : oosSharpe > 0 ? "warn" : "fail", detail: `In-sample Sharpe ${fmt(isSharpe)}; out of sample from ${h.oosFrom}: ${fmt(oosSharpe)}.` });
    }
  }
  let placebo: Assessment["placebo"] = null;
  if (input.pro) {
    const u = rng(seed + 1), draws = 500, samples: number[] = [];
    const buf = new Float64Array(r.length);
    for (let d = 0; d < draws; d++) {
      const idx = stationaryIndices(r.length, block, u);
      let sign = u() < 0.5 ? -1 : 1;
      for (let t = 0; t < r.length; t++) { if (t > 0 && idx[t] !== (idx[t - 1] + 1) % r.length) sign = u() < 0.5 ? -1 : 1; buf[t] = sign * r[idx[t]]; }
      samples.push(annualise(srOf(buf), ppy));
    }
    const obs = annualise(sr, ppy);
    const p = samples.filter((s) => s >= obs).length / draws;
    placebo = { p, draws, samples: samples.map((s) => Math.round(s * 1000) / 1000) };
    checks.push({ id: "placebo", group: "robustness", label: "Placebo", status: p < 0.05 ? "pass" : p < 0.2 ? "warn" : "fail", detail: `The same returns with random signs in blocks (volatility kept, edge removed) beat the observed Sharpe in ${pct(p)} of ${draws} runs.` });
  }
  const neighbourhood = neighbours(input);
  if (neighbourhood) checks.push({ id: "neighbourhood", group: "robustness", label: "Parameter neighbourhood", status: neighbourhood.lonePeak ? "fail" : "pass", detail: neighbourhood.lonePeak ? `The chosen parameters sit on a lone peak: their ${neighbourhood.neighbours} neighbours' median Sharpe is ${fmt(neighbourhood.median ?? NaN)}, against ${fmt(neighbourhood.best)}. That is the picture of overfitting.` : `The ${neighbourhood.neighbours} neighbouring parameter sets do about as well (median ${fmt(neighbourhood.median ?? NaN)}).` });
  let factorAlpha: Assessment["factorAlpha"] = null;
  if (input.factors && input.factors.rows.length === r.length && r.length > input.factors.names.length + 30) {
    try {
      const f = ols(input.factors.rows, r);
      factorAlpha = { alphaAnnual: f.coef[0] * ppy, t: f.tNw[0], r2: f.r2, betas: Object.fromEntries(input.factors.names.map((n, i) => [n, f.coef[i + 1]])), source: input.factors.source };
      const big = Object.entries(factorAlpha.betas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      checks.push({ id: "alpha", group: "robustness", label: "Factor-adjusted alpha", status: factorAlpha.t >= 2 ? "pass" : "warn", detail: `${big ? `${fmt(big[1])} beta to ${big[0]}; ` : ""}alpha ${pct(factorAlpha.alphaAnnual)} a year with t = ${fmt(factorAlpha.t, 1)}${factorAlpha.t < 2 ? ": indistinguishable from luck" : ""} (factors: ${input.factors.source}).` });
    } catch { /* collinear factors: skip */ }
  }

  /* ---------- Grade ---------- */
  const pboV = pboRes?.pbo ?? null;
  const oneTrial = trials <= 1;
  const ref = Math.max(assumed, 10);
  const grade = (): [IntegrityReport["grade"], string] => {
    if (lookAhead) return ["F", "F: at least one input was used before it was public (look-ahead)."];
    if (sameBar) return ["F", "F: trades at the same bar's close the signal was computed from (same-bar execution)."];
    if (minTrlYears === null || years < minTrlYears / 2) return ["F", minTrlYears === null ? "F: the Sharpe ratio is not above zero." : `F: ${fmt(years, 1)} years is less than half the minimum track record (${fmt(minTrlYears, 1)} years).`];
    const a = pointInTime && !!h.survivorshipSafe && dsr >= 0.95 && (oneTrial || (pboV !== null && pboV <= 0.2)) && breakevenBps !== null && breakevenBps >= 3 * ref && oosSharpe !== null && isSharpe !== null && oosSharpe >= isSharpe / 2 && years >= minTrlYears && !hygieneFailure;
    if (a) return ["A", "A: point in time and survivorship-safe, DSR at least 0.95, PBO at most 0.2 (or one trial), breakeven cost at least 3x the assumed, out-of-sample Sharpe at least half of in-sample, and enough years."];
    if (!hygieneFailure && dsr >= 0.9 && (pboV === null || pboV <= 0.35) && breakevenBps !== null && breakevenBps >= 2 * ref) return ["B", `B: DSR ${fmt(dsr)} (at least 0.90), PBO ${pboV === null ? "not computed" : fmt(pboV)} (at most 0.35), breakeven cost at least 2x the assumed, no hygiene failure.`];
    if (!hygieneFailure && dsr >= 0.7 && (pboV === null || pboV <= 0.5)) return ["C", `C: DSR ${fmt(dsr)} (at least 0.70), PBO ${pboV === null ? "not computed" : fmt(pboV)} (at most 0.5), no hygiene failure${breakevenBps === null ? "; costs could not be tested" : ""}.`];
    if (hygieneFailure) return ["D", `D: a data hygiene check failed (${[restated && "restated fundamentals", llmExposed && "language-model inputs before the model's cutoff"].filter(Boolean).join(", ")}).`];
    return ["D", `D: ${dsr < 0.7 ? `DSR ${fmt(dsr)} is below 0.70` : `PBO ${fmt(pboV ?? NaN)} is above 0.5`}.`];
  };
  let [g, rule] = grade();
  if (h.reconstructed && g === "A") { g = "B"; rule = "B (capped): the inputs include reconstructed signals, which cap the grade at B until there is a live record."; }

  const warnings = checks.filter((c) => c.status === "fail" || c.status === "warn").sort((a, b) => (a.status === b.status ? 0 : a.status === "fail" ? -1 : 1)).map((c) => `${c.label}: ${c.detail}`);
  const whatWouldChange: string[] = [];
  if (minTrlYears !== null && years < minTrlYears) whatWouldChange.push(`About ${fmt(minTrlYears - years, 1)} more years of record at this Sharpe ratio would meet the minimum track record.`);
  if (breakevenBps !== null && breakevenBps < 3 * ref) whatWouldChange.push(`Costs below about ${Math.max(0, Math.floor(breakevenBps / 3))} bp round trip would make the breakeven three times the cost.`);
  if (turnover === undefined) whatWouldChange.push("Stating the turnover lets costs be tested (needed for A and B).");
  if (!pointInTime) whatWouldChange.push("A read log with each input's public time would prove the backtest is point in time (needed for A).");
  if (!h.survivorshipSafe) whatWouldChange.push("A universe that includes delisted securities removes the survivorship flag (needed for A).");
  if (oosSharpe === null) whatWouldChange.push("A walk-forward out-of-sample period (needed for A).");
  if (dsr < 0.95 && trials > 1) whatWouldChange.push(`With ${trials} trials, the DSR is ${fmt(dsr)}; fewer variants tried, or a longer record, raises it.`);

  const report: IntegrityReport = {
    pointInTime, survivorshipSafe: !!h.survivorshipSafe, trials, effectiveTrials: eff.effective,
    sharpe: annualise(sr, ppy), psr, dsr: trials > 1 ? dsr : psr, pbo: pboV, minTrlYears,
    oosSharpe, costBpsAssumed: assumed, llmInputs: !!h.llmInputs, grade: g, warnings: warnings.slice(0, 12), checkedAt: new Date().toISOString(), version: INTEGRITY_VERSION,
  };
  return {
    report, rule, checks,
    stats: {
      n: m.n, years, sharpe: annualise(sr, ppy), sharpeLow: ci.low, sharpeHigh: ci.high, psr, dsrRaw: trials > 1 ? dRaw.dsr : null, dsrEffective: trials > 1 ? dEff.dsr : null,
      srStarAnnual: annualise(dEff.srStar, ppy), trials, trialsCounted: counted, trialsDeclared: declared, effectiveTrials: eff.effective, silhouette: eff.silhouette,
      minTrlYears, skew: m.skew, kurt: m.kurt, haircut: hc ? { sharpe: hc.sharpeAdjusted, share: hc.haircut } : null, t3, block, pbo: pboRes, realityCheckP: rcP,
    },
    costs, breakevenBps, years: yearsTable, placebo, neighbourhood, factorAlpha, whatWouldChange,
    disclosures: [DISCLOSURES.hypothetical, DISCLOSURES.a_grade],
  };
}

/** Neighbourhood stability when the trials form a parameter grid (numeric parameters). */
function neighbours(input: IntegrityInput): Assessment["neighbourhood"] {
  const P = input.trialParams, S = input.trialSharpes, k = input.assessedIndex;
  if (!P || k === undefined || P.length !== S.length || P.length < 5) return null;
  const keys = Object.keys(P[k] ?? {}).filter((key) => P.every((p) => typeof p[key] === "number"));
  if (!keys.length) return null;
  const values = Object.fromEntries(keys.map((key) => [key, [...new Set(P.map((p) => p[key] as number))].sort((a, b) => a - b)]));
  const pos = (p: Record<string, unknown>, key: string) => values[key].indexOf(p[key] as number);
  const me = P[k];
  const nb: number[] = [];
  P.forEach((p, i) => {
    if (i === k) return;
    let diff = 0, adjacent = true;
    for (const key of keys) { const d = Math.abs(pos(p, key) - pos(me, key)); if (d > 0) { diff++; if (d > 1) adjacent = false; } }
    if (diff >= 1 && diff <= keys.length && adjacent) nb.push(S[i]);
  });
  if (nb.length < 2) return null;
  const med = quantile(nb, 0.5);
  const se = 1 / Math.sqrt(Math.max(1, input.returns.length - 1));
  const lonePeak = S[k] - med > 2 * se && S[k] > 0 && med < S[k] / 2;
  const [x, y] = keys;
  const grid = { x, y: y ?? null, cells: P.map((p, i) => ({ x: p[x] as number, y: y ? (p[y] as number) : null, sharpe: annualise(S[i], input.periodsPerYear) })) };
  return { lonePeak, best: annualise(S[k], input.periodsPerYear), neighbours: nb.length, median: annualise(med, input.periodsPerYear), grid };
}
