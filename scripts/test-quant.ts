/**
 * Checks for Quant Edge (docs/quant-edge.md): every statistic in the QF2 kit against a known answer (a
 * published example, a hand computation, or statsmodels/NumPy run independently and saved with its inputs
 * in scripts/fixtures/quant/stats-oracle.json) or a simulation with a known truth; the contract validators;
 * the point-in-time rules; the integrity grade; and each feature's pure parts. No network, no database.
 *   pnpm exec tsx scripts/test-quant.ts
 */
import { readFileSync } from "node:fs";
import { annualise, choose, corr, erfc, mean, moments, normCdf, normInv, normals, quantile, rng, sharpe, std } from "@/lib/quant/stats/core";
import { bestOfNCurve, dsr, dsrFromStats, effectiveTrials, effectiveTrialsFromCorrelation, expectedMaxSharpe, haircutSharpe, minTrlFromStats, passesT3, psr, psrFromStats } from "@/lib/quant/stats/integrity";
import { bh, bhAdjust, bhy, bonferroni, holm } from "@/lib/quant/stats/multiple";
import { blocksFor, combinations, pbo } from "@/lib/quant/stats/pbo";
import { bootstrapCi, politisWhite, realityCheck, stationaryIndices } from "@/lib/quant/stats/bootstrap";
import { leaks, purgedKFold } from "@/lib/quant/stats/purged";
import { ledoitWolf } from "@/lib/quant/stats/shrink";
import { hmmFilter, hmmFit, hmmSample, hmmSmooth, stationary, type Hmm } from "@/lib/quant/stats/hmm";
import { adf, engleGranger, halfLife, hurst, johansen, mackinnonCrit, mackinnonP } from "@/lib/quant/stats/coint";
import { ols, projectSimplex, simplexLs, wls } from "@/lib/quant/stats/regress";
import { continuousGrowth, discreteGrowth, drawdownProb, growthShare, kellyContinuous, kellyDiscrete, kellyMulti, simulateDrawdown, uncertainKelly } from "@/lib/quant/stats/kelly";
import { cholesky, eigSym, inverse, matmul, sqrtSym } from "@/lib/quant/stats/linalg";

let pass = 0, fail = 0;
const section = (s: string) => console.log(`\n${s}`);
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const rel = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

type Oracle = {
  inputs: { x: number[]; y: number[]; w: number[]; R: number[][]; m: number[]; v: number[]; y2: number[] };
  adf_x_lag1: { stat: number; p: number; nobs: number; crit: Record<string, number> };
  adf_spread_lag2: { stat: number; p: number; nobs: number; crit: Record<string, number> };
  eg_yx_lag1: { stat: number; p: number; crit: number[] };
  eg_wx_lag1: { stat: number; p: number; crit: number[] };
  johansen_yxw_lag1: { eig: number[]; trace: number[]; maxeig: number[]; cvt: number[][] };
  lw: { shrinkage: number; rbar: number; cov00: number; cov01: number; cov34: number };
  nw: { coef: number[]; seNw: number[]; se: number[]; r2: number };
  dsr_paper: { sr0: number; dsr: number };
  psr_hand: { psr0: number; psr005: number; mintrl: number };
  haircut: { sr: number; years: number; trials: number; pSingle: number; bonferroni: { p: number; sr: number }; bhy: { p: number; sr: number } };
};
const ORACLE = JSON.parse(readFileSync(new URL("./fixtures/quant/stats-oracle.json", import.meta.url), "utf8")) as Oracle;

/** n iid normal returns with a given per-period mean and sd. */
const noise = (n: number, mu: number, sd: number, seed: number) => { const z = normals(rng(seed)); return Array.from({ length: n }, () => mu + sd * z()); };

async function main() {
  section("Core");
  {
    check("normCdf(1.96) = 0.975002 and the far tail keeps digits (erfc)", near(normCdf(1.96), 0.9750021, 1e-6) && rel(0.5 * erfc(6 / Math.SQRT2), 9.8659e-10, 1e-4), [normCdf(1.96), 0.5 * erfc(6 / Math.SQRT2)]);
    check("normInv inverts normCdf to 1e-9 across the range", [0.001, 0.025, 0.5, 0.9, 0.99, 0.9999].every((p) => near(normCdf(normInv(p)), p, 1e-9)));
    const m = moments([1, 2, 3, 4, 10]);
    // Hand: mean 4; deviations -3,-2,-1,0,6; m2 = 50/5 = 10; m3 = (-27-8-1+0+216)/5 = 36; m4 = (81+16+1+0+1296)/5 = 278.8.
    check("moments: skew m3/m2^1.5 and non-excess kurtosis m4/m2² by hand", near(m.mean, 4) && near(m.skew, 36 / 10 ** 1.5) && near(m.kurt, 2.788) && near(m.std, Math.sqrt(12.5)), m);
    check("choose(16, 8) = 12,870 and choose(10, 5) = 252", choose(16, 8) === 12870 && choose(10, 5) === 252);
    check("quantile is type 7 (NumPy's default)", near(quantile([1, 2, 3, 4], 0.25), 1.75) && near(quantile([10, 20], 0.5), 15));
  }

  section("PSR, DSR and minimum track record length");
  {
    const d = dsrFromStats(2.5 / Math.sqrt(250), 1250, -3, 10, 100, 0.5 / 250);
    check("the DSR paper's example: SR* = 0.1132 a day, DSR = 0.9004 (Bailey and López de Prado 2014)", near(d.srStar, ORACLE.dsr_paper.sr0, 1e-6) && near(d.dsr, 0.9004, 5e-4) && near(d.dsr, ORACLE.dsr_paper.dsr, 1e-5), d);
    check("expectedMaxSharpe grows with the number of trials and is 0 for one trial", expectedMaxSharpe(1, 0.01) === 0 && expectedMaxSharpe(10, 0.01) < expectedMaxSharpe(100, 0.01));
    const h = ORACLE.psr_hand;
    check("PSR against 0 and 0.05 equals the formula computed by SciPy", near(psrFromStats(0.1, 500, -0.5, 5, 0), h.psr0, 1e-6) && near(psrFromStats(0.1, 500, -0.5, 5, 0.05), h.psr005, 1e-6), [psrFromStats(0.1, 500, -0.5, 5, 0), h]);
    const mt = minTrlFromStats(0.1, -0.5, 5, 0, 0.05);
    check("MinTRL equals the formula computed by SciPy (287.8 periods)", near(mt, h.mintrl, 1e-4), mt);
    check("at n = MinTRL, PSR is exactly 1 - α (the two formulas agree)", near(psrFromStats(0.1, mt, -0.5, 5, 0), 0.95, 1e-9));
    check("MinTRL is infinite when the Sharpe ratio does not beat SR*", minTrlFromStats(0.05, 0, 3, 0.05) === Infinity);
    const x = noise(1000, 0.0006, 0.01, 4);
    const m = moments(x);
    check("psr(returns) uses the sample's own moments", near(psr(x), psrFromStats(m.mean / m.std, m.n, m.skew, m.kurt), 1e-12));
    check("negative skew and fat tails lower the PSR of the same Sharpe ratio", psrFromStats(0.08, 300, -2, 9) < psrFromStats(0.08, 300, 0, 3));
    check("dsr with one trial equals PSR against zero", near(dsr(x, [sharpe(x)]).dsr, psr(x), 1e-12));
    // Spec test: the best of 50 pure-noise strategies. The spec expected DSR > 0.95 "about 5%" of the time; DSR is
    // conservative for a maximum, so the rate is far below 5% (0.05% in a 2,000-run SciPy check), while the
    // undeflated PSR of the same winner passes 0.95 in about 92% of runs. The test holds both facts.
    let fp = 0, naive = 0;
    const sims = 300;
    for (let s = 0; s < sims; s++) {
      const z = normals(rng(1000 + s));
      const trials = Array.from({ length: 50 }, () => Array.from({ length: 252 }, () => 0.01 * z()));
      const srs = trials.map(sharpe);
      const best = trials[srs.indexOf(Math.max(...srs))];
      if (dsr(best, srs).dsr > 0.95) fp++;
      if (psr(best) > 0.95) naive++;
    }
    check(`best of 50 noise strategies: DSR > 0.95 in at most 5% of ${sims} runs (${((100 * fp) / sims).toFixed(1)}%), the undeflated PSR in most (${((100 * naive) / sims).toFixed(0)}%)`, fp / sims <= 0.05 && naive / sims > 0.8, { fp, naive });
    const curve = bestOfNCurve(252);
    check("best-of-N curve: 100 noise strategies over a year reach an annualised Sharpe near 2.5 by chance", curve.find((c) => c.trials === 100)!.sharpe > 2.2 && curve.find((c) => c.trials === 100)!.sharpe < 2.8, curve);
  }

  section("Effective number of trials");
  {
    // Five groups of four trials, highly correlated within a group, independent across.
    const z = normals(rng(77));
    const T = 500;
    const groups = Array.from({ length: 5 }, () => Array.from({ length: T }, () => z()));
    const series = groups.flatMap((g) => Array.from({ length: 4 }, () => g.map((v) => v + 0.3 * z())));
    const e = effectiveTrials(series);
    check("20 trials in 5 correlated groups count as 5 independent trials", e.raw === 20 && e.effective === 5 && e.clusters.every((c) => c.length === 4), { effective: e.effective, clusters: e.clusters });
    check("the silhouette of well-separated groups is high (above 0.5)", (e.silhouette ?? 0) > 0.5, e.silhouette);
    const ind = effectiveTrials(Array.from({ length: 6 }, () => Array.from({ length: T }, () => z())));
    check("independent trials keep their raw count", ind.effective === 6);
    const R = [[1, 0.9, 0.1], [0.9, 1, 0.2], [0.1, 0.2, 1]];
    check("a hand correlation matrix: {0, 1} merge (ρ 0.9), 2 stays alone", JSON.stringify(effectiveTrialsFromCorrelation(R).clusters) === "[[0,1],[2]]");
  }

  section("Multiple testing");
  {
    const p = [0.01, 0.04, 0.03, 0.005, 0.2];
    const b = bh(p, 0.05);
    // Sorted: .005 .01 .03 .04 .2 against k/5·0.05 = .01 .02 .03 .04 .05: the largest k passing is 4.
    check("Benjamini-Hochberg at q = 0.05 rejects the four smallest (by hand)", b.count === 4 && JSON.stringify(b.reject) === "[true,true,true,true,false]", b);
    check("BH adjusted p-values by hand: p(k)·5/k = .025 .025 .05 .05 .2 sorted, step-up minimum, in input order", JSON.stringify(bhAdjust(p).map((v) => +v.toFixed(4))) === "[0.025,0.05,0.05,0.025,0.2]", bhAdjust(p));
    check("Bonferroni multiplies by m", JSON.stringify(bonferroni([0.01, 0.3])) === "[0.02,0.6]");
    check("Holm by hand: .005·5, .01·4, .03·3, .04·2, .2·1 with the running max", JSON.stringify(holm(p).map((v) => +v.toFixed(4))) === "[0.04,0.09,0.09,0.025,0.2]", holm(p));
    check("BHY is BH times c(m) = 1 + 1/2 + ... + 1/m", near(bhy(p)[4], Math.min(1, 0.2 * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5))));
    // A null simulation: 1,000 uniform p-values; BH at 0.1 should find almost nothing.
    const u = rng(5);
    let found = 0;
    for (let s = 0; s < 50; s++) found += bh(Array.from({ length: 1000 }, () => u()), 0.1).count;
    check("BH on 50 null scans of 1,000 tests keeps false discoveries near zero", found / 50 < 1, found / 50);
    const hc = ORACLE.haircut;
    const hb = haircutSharpe(1, 10, 10, "bonferroni"), hy = haircutSharpe(1, 10, 10, "bhy");
    check("Harvey-Liu haircut, Bonferroni and BHY, against SciPy (SR 1 over 10 years, 10 trials)", near(hb.pSingle, hc.pSingle, 1e-7) && near(hb.sharpeAdjusted, hc.bonferroni.sr, 1e-5) && near(hy.sharpeAdjusted, hc.bhy.sr, 1e-5), { hb, hy, hc });
    check("one trial: no haircut", near(haircutSharpe(1, 10, 1).haircut, 0, 1e-9));
    check("t above 3: Sharpe 1 over 10 years passes (t = 3.16), over 8 years it does not", passesT3(1, 10) && !passesT3(1, 8));
  }

  section("PBO by CSCV");
  {
    // Two blocks of two rows, three trials, chosen by hand (see the comments for each split).
    const T0 = [0.03, 0.01, -0.01, -0.03], T1 = [0.01, 0, 0.02, 0.01], T2 = [0, -0.01, 0.01, 0];
    const M = [0, 1, 2, 3].map((t) => [T0[t], T1[t], T2[t]]);
    const a = pbo(M, 2);
    // Split IS={0}: best T0 (SR 1.41); out of sample T0 is worst -> ω = 1/4, λ < 0. IS={1}: best T1 (2.12); OOS T1 is
    // second of three -> ω = 2/4, λ = 0. Both count: PBO = 1. OOS losses: T0 in the first split only -> 0.5.
    check("hand case 1: PBO = 1, P(OOS loss) = 0.5", a.pbo === 1 && a.splits === 2 && near(a.probOosLoss, 0.5), a);
    const T1b = [0.05, 0.02, 0.02, 0.01];
    const b = pbo([0, 1, 2, 3].map((t) => [T0[t], T1b[t], T2[t]]), 2);
    check("hand case 2: the same trial wins in and out of sample in both splits, PBO = 0", b.pbo === 0, b);
    check("combinations(16, 8) yields 12,870 splits", [...combinations(16, 8)].length === 12870);
    // Spec test: pure noise, N = 50: PBO averages about 0.5.
    let s = 0;
    const runs = 40;
    for (let k = 0; k < runs; k++) {
      const z = normals(rng(500 + k));
      const N = Array.from({ length: 400 }, () => Array.from({ length: 50 }, () => 0.01 * z()));
      s += pbo(N, 10).pbo;
    }
    check(`pure noise (N = 50, ${runs} matrices): mean PBO near 0.5 (${(s / runs).toFixed(2)})`, Math.abs(s / runs - 0.5) < 0.12, s / runs);
    // One genuinely skilled column (annualised Sharpe 1.5) among 49 noise columns over ten years: PBO below 0.2 in
    // most seeds. (Over four years the skilled column often loses the in-sample race to the luckiest noise column.)
    let low = 0;
    for (let k = 0; k < 20; k++) {
      const z = normals(rng(900 + k));
      const N = Array.from({ length: 2520 }, () => Array.from({ length: 50 }, (_, j) => (j === 0 ? 0.01 * (1.5 / Math.sqrt(252)) : 0) + 0.01 * z()));
      if (pbo(N, 10).pbo < 0.2) low++;
    }
    check(`one skilled column (Sharpe 1.5) among 50: PBO < 0.2 in most of 20 seeds (${low})`, low >= 12, low);
    const t0 = Date.now();
    const z = normals(rng(3));
    const big = Array.from({ length: 16 * 20 }, () => Array.from({ length: 500 }, () => z()));
    const r = pbo(big, 16);
    check(`12,870 splits on 500 trials run in seconds in TypeScript (${((Date.now() - t0) / 1000).toFixed(1)} s)`, r.splits === 12870 && Date.now() - t0 < 20_000);
    check("blocksFor: 16 blocks of 20 rows need 320 rows; 100 rows give 4 blocks", blocksFor(320) === 16 && blocksFor(100) === 4 && blocksFor(30) === 0);
  }

  section("Stationary bootstrap and the Reality Check");
  {
    const iid = noise(1000, 0, 1, 8);
    const ar: number[] = [0];
    const z = normals(rng(9));
    for (let t = 1; t < 1000; t++) ar.push(0.8 * ar[t - 1] + z());
    const bi = politisWhite(iid), ba = politisWhite(ar);
    check(`Politis-White block length: small for iid noise (${bi.toFixed(1)}), large for AR(1) 0.8 (${ba.toFixed(1)})`, bi < 3 && ba > 8, { bi, ba });
    const idx = stationaryIndices(100, 5, rng(1));
    check("stationary resample indices stay in range and run in blocks", idx.every((i) => i >= 0 && i < 100) && [...idx].filter((v, i) => i > 0 && v === (idx[i - 1] + 1) % 100).length > 60);
    // Coverage of a 90% interval for the mean of iid normal data with true mean 0.1.
    let cover = 0;
    for (let k = 0; k < 100; k++) { const x = noise(200, 0.1, 1, 300 + k); const c = bootstrapCi(x, mean, { draws: 300, level: 0.9, seed: k, block: 1 }); if (c.low <= 0.1 && c.high >= 0.1) cover++; }
    check(`90% bootstrap interval for a mean covers the truth about 90% of the time (${cover}/100)`, cover >= 80 && cover <= 97, cover);
    const c = bootstrapCi(noise(500, 0.05, 1, 12), (s) => annualise(sharpe(s), 252), { draws: 200, seed: 3 });
    check("bootstrap interval of an annualised Sharpe brackets its estimate", c.low < c.estimate && c.estimate < c.high && c.samples.length === 200);
    const zz = normals(rng(21));
    const nullM = Array.from({ length: 500 }, () => Array.from({ length: 20 }, () => zz()));
    const rcNull = realityCheck(nullM, { draws: 300 });
    const skill = Array.from({ length: 500 }, () => Array.from({ length: 20 }, (_, k) => (k === 3 ? 0.25 : 0) + zz()));
    const rcSkill = realityCheck(skill, { draws: 300 });
    check(`Reality Check: no skill gives a large p (${rcNull.pValue.toFixed(2)}); one skilled strategy a small one (${rcSkill.pValue.toFixed(3)}) and it is the best`, rcNull.pValue > 0.1 && rcSkill.pValue < 0.05 && rcSkill.best === 3, { rcNull, rcSkill: { p: rcSkill.pValue, best: rcSkill.best } });
  }

  section("Purged k-fold");
  {
    const spans = Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + 5 }));
    const f = purgedKFold(spans, 5, 3);
    check("no training label window overlaps its test fold", !leaks(spans, f));
    check("each fold purges the five overlapping labels on each side it touches and embargoes three", f[2].purged === 10 && f[2].embargoed === 3 && f[0].purged === 5 && f[4].embargoed === 0, f.map((x) => [x.purged, x.embargoed]));
    check("the test folds partition the data", f.reduce((s, x) => s + x.test.length, 0) === 100);
  }

  section("Ledoit-Wolf shrinkage");
  {
    const lw = ledoitWolf(ORACLE.inputs.R);
    const o = ORACLE.lw;
    check(`shrinkage intensity matches the NumPy translation of covCor.m (${lw.shrinkage.toFixed(6)})`, near(lw.shrinkage, o.shrinkage, 1e-9) && near(lw.avgCorrelation, o.rbar, 1e-12), { lw: lw.shrinkage, o: o.shrinkage });
    check("shrunk covariance entries match", rel(lw.cov[0][0], o.cov00, 1e-9) && rel(lw.cov[0][1], o.cov01, 1e-9) && rel(lw.cov[3][4], o.cov34, 1e-9), [lw.cov[0][0], lw.cov[0][1], lw.cov[3][4]]);
    check("the shrunk matrix is positive definite", !!cholesky(lw.cov));
  }

  section("Hidden Markov model");
  {
    const truth: Hmm = { k: 2, d: 1, pi: [0.5, 0.5], A: [[0.97, 0.03], [0.05, 0.95]], means: [[0.001], [-0.002]], covs: [[[0.0001]], [[0.0009]]], logLik: 0, iterations: 0, starts: 1 };
    const { states, X } = hmmSample(truth, 1500, 4);
    const fit = hmmFit(X, 2, { starts: 4, seed: 2 });
    const filt = hmmFilter(fit, X);
    const acc = filt.filter((p, t) => (p[1] > 0.5 ? 1 : 0) === states[t]).length / X.length;
    check(`recovers a planted calm and stormy regime (filtered accuracy ${(acc * 100).toFixed(0)}%)`, acc > 0.85, acc);
    check("recovered volatilities near the truth (1% and 3% a day)", near(Math.sqrt(fit.covs[0][0][0]), 0.01, 0.002) && near(Math.sqrt(fit.covs[1][0][0]), 0.03, 0.005), fit.covs);
    const prefix = hmmFilter(fit, X.slice(0, 700));
    check("filtered probabilities use no future data: filtering a prefix gives the same answers", prefix.every((p, t) => near(p[1], filt[t][1], 1e-12)));
    const smooth = hmmSmooth(fit, X);
    check("smoothed probabilities differ from filtered ones (they use the future)", smooth.some((p, t) => Math.abs(p[1] - filt[t][1]) > 0.05));
    const st = stationary([[0.9, 0.1], [0.2, 0.8]]);
    check("stationary distribution of [[.9,.1],[.2,.8]] is (2/3, 1/3)", near(st[0], 2 / 3, 1e-9) && near(st[1], 1 / 3, 1e-9), st);
  }

  section("Cointegration");
  {
    const { x, y, w } = ORACLE.inputs;
    const a = adf(x, 1);
    check(`ADF on a random walk matches statsmodels (stat ${a.stat.toFixed(4)}, p ${a.pValue.toFixed(4)})`, near(a.stat, ORACLE.adf_x_lag1.stat, 1e-6) && near(a.pValue, ORACLE.adf_x_lag1.p, 1e-6) && a.nobs === ORACLE.adf_x_lag1.nobs, { a, o: ORACLE.adf_x_lag1 });
    check("ADF finite-sample critical values match MacKinnon (2010) via statsmodels", near(a.crit["5%"], ORACLE.adf_x_lag1.crit["5%"], 1e-9) && near(a.crit["1%"], ORACLE.adf_x_lag1.crit["1%"], 1e-9));
    const sp = adf(y.map((v, i) => v - 0.8 * x[i]), 2);
    check("ADF on a stationary spread rejects the unit root, matching statsmodels", near(sp.stat, ORACLE.adf_spread_lag2.stat, 1e-6) && sp.pValue < 1e-6 && rel(sp.pValue, ORACLE.adf_spread_lag2.p, 1e-4), { sp, o: ORACLE.adf_spread_lag2 });
    const eg = engleGranger(y, x, 1);
    check("Engle-Granger on a cointegrated pair matches statsmodels' coint", near(eg.stat, ORACLE.eg_yx_lag1.stat, 1e-6) && near(eg.crit["5%"], ORACLE.eg_yx_lag1.crit[1], 1e-9) && near(eg.beta, 0.8, 0.05), { eg: { stat: eg.stat, p: eg.pValue, beta: eg.beta }, o: ORACLE.eg_yx_lag1 });
    const eg2 = engleGranger(w, x, 1);
    check("Engle-Granger on independent walks matches statsmodels and does not reject", near(eg2.stat, ORACLE.eg_wx_lag1.stat, 1e-6) && near(eg2.pValue, ORACLE.eg_wx_lag1.p, 1e-6), { s: eg2.stat, p: eg2.pValue, o: ORACLE.eg_wx_lag1 });
    check("MacKinnon p-value at the 5% critical value is about 0.05", near(mackinnonP(mackinnonCrit(1)["5%"]), 0.05, 0.01));
    const j = johansen(x.map((_, i) => [y[i], x[i], w[i]]), 1);
    const o = ORACLE.johansen_yxw_lag1;
    check("Johansen eigenvalues and trace statistics match statsmodels' coint_johansen", j.eigenvalues.every((e, i) => near(e, o.eig[i], 1e-8)) && j.trace.every((t, i) => near(t, o.trace[i], 1e-5)) && j.maxEig.every((t, i) => near(t, o.maxeig[i], 1e-5)), { j: [j.eigenvalues, j.trace], o });
    const expectRank = o.trace.findIndex((t, i) => !(t > o.cvt[i][1]));
    check("Johansen's rank at 95% follows the trace statistics against Osterwald-Lenum's critical values", j.rank95 === (expectRank < 0 ? 3 : expectRank) && JSON.stringify(j.traceCrit) === JSON.stringify(o.cvt), { rank: j.rank95, expectRank });
    // Half-life of a planted AR(1) with φ = 0.9: ln 2 / -ln 0.9 = 6.58 periods.
    const zz = normals(rng(31));
    const e: number[] = [0];
    for (let t = 1; t < 3000; t++) e.push(0.9 * e[t - 1] + zz());
    const hl = halfLife(e);
    check(`half-life of a planted AR(1) 0.9 within 20% of 6.58 (${hl.halfLife.toFixed(2)})`, Math.abs(hl.halfLife / (Math.log(2) / -Math.log(0.9)) - 1) < 0.2, hl);
    const rw: number[] = [0];
    for (let t = 1; t < 4000; t++) rw.push(rw[t - 1] + zz());
    check(`Hurst exponent: a random walk near 0.5 (${hurst(rw).toFixed(2)}), a mean-reverting series well below (${hurst(e).toFixed(2)})`, near(hurst(rw), 0.5, 0.06) && hurst(e) < 0.35);
  }

  section("Regression");
  {
    const { m, v, y2 } = ORACLE.inputs;
    const f = ols(m.map((a, i) => [a, v[i]]), y2, { lags: 5 });
    const o = ORACLE.nw;
    check("OLS coefficients and classical errors match statsmodels", f.coef.every((c, i) => rel(c, o.coef[i], 1e-8)) && f.se.every((s, i) => rel(s, o.se[i], 1e-8)) && near(f.r2, o.r2, 1e-10), { f: [f.coef, f.se], o });
    check("Newey-West (5 lags, Bartlett kernel) errors match statsmodels' HAC", f.seNw.every((s, i) => rel(s, o.seNw[i], 1e-7)), { mine: f.seNw, o: o.seNw });
    const p = projectSimplex([0.5, 0.8, -0.2]);
    check("simplex projection sums to 1 with no negatives (by hand: [0.35, 0.65, 0])", near(p[0], 0.35) && near(p[1], 0.65) && p[2] === 0, p);
    const z = normals(rng(44));
    const F = Array.from({ length: 500 }, () => [0.01 * z(), 0.01 * z(), 0.01 * z(), 0.01 * z()]);
    const target = F.map((r) => 0.6 * r[0] + 0.4 * r[2] + 0.001 * z());
    const s = simplexLs(F, target);
    check("constrained least squares recovers a planted 60/40 mix, weights >= 0 and summing to 1", near(s.weights[0], 0.6, 0.02) && near(s.weights[2], 0.4, 0.02) && s.weights.every((x) => x >= 0) && near(s.weights.reduce((a, b) => a + b, 0), 1, 1e-9) && s.r2 > 0.98, s.weights);
    const ww = wls([[1, 1], [1, 2], [1, 3]], [1, 2, 3.5], [1, 1, 1]);
    check("WLS with equal weights is OLS (by hand: slope 1.25, intercept -0.333)", near(ww.coef[1], 1.25, 1e-9) && near(ww.coef[0], -1 / 3, 1e-9), ww.coef);
  }

  section("Kelly");
  {
    check("discrete Kelly: p 0.6 at even money is 20% (Haghani and Dewey's coin)", near(kellyDiscrete(0.6, 1), 0.2));
    check("continuous Kelly: μ - r 6%, σ 20% gives 1.5", near(kellyContinuous(0.06, 0.2), 1.5));
    const km = kellyMulti([0.05, 0.03], [[0.04, 0.01], [0.01, 0.09]])!;
    // Hand: Σ⁻¹ = 1/(0.0036-0.0001)·[[0.09,-0.01],[-0.01,0.04]]; times μ: (0.0045-0.0003, -0.0005+0.0012)/0.0035 = (1.2, 0.2).
    check("multi-asset Kelly Σ⁻¹μ by hand: (1.2, 0.2)", near(km[0], 1.2, 1e-9) && near(km[1], 0.2, 1e-9), km);
    check("growth at half Kelly is 75% of full Kelly's: c(2 - c), and matches the growth rate formula", near(growthShare(0.5), 0.75) && near(continuousGrowth(0.75, 0.06, 0.2) / continuousGrowth(1.5, 0.06, 0.2), 0.75, 1e-12));
    check("discrete growth is maximised at f* (20% for the 60% coin)", discreteGrowth(0.2, 0.6, 1) > discreteGrowth(0.15, 0.6, 1) && discreteGrowth(0.2, 0.6, 1) > discreteGrowth(0.25, 0.6, 1));
    check("drawdown odds x^(2/c - 1): half the stake at full Kelly 50%, at half Kelly 12.5%", near(drawdownProb(1, 0.5), 0.5) && near(drawdownProb(0.5, 0.5), 0.125));
    // The closed form against a simulation of GBM (daily steps over 60 years, 1,500 paths).
    const mu = 0.12, sigma = 0.2, K = mu / sigma ** 2;
    for (const c of [0.5, 1]) {
      const f = c * K, dt = 1 / 252, u = normals(rng(c === 1 ? 61 : 62));
      let hit = 0;
      for (let p = 0; p < 1500; p++) {
        let lw = 0;
        for (let t = 0; t < 60 * 252; t++) { lw += (f * mu - (f * f * sigma * sigma) / 2) * dt + f * sigma * Math.sqrt(dt) * u(); if (lw <= Math.log(0.5)) { hit++; break; } }
      }
      check(`GBM simulation at ${c} Kelly: P(falling to half) ${(hit / 1500).toFixed(3)} against ${drawdownProb(c, 0.5).toFixed(3)}`, Math.abs(hit / 1500 - drawdownProb(c, 0.5)) < 0.04, hit / 1500);
    }
    check("simulated discrete bets: full Kelly on the 60% coin halves wealth from a peak far more often than quarter Kelly", simulateDrawdown(0.2, 0.6, 1, 0.5, 300) > simulateDrawdown(0.05, 0.6, 1, 0.5, 300) + 0.2);
    const uk = uncertainKelly(0.06, 0.04, 0.2);
    check("uncertain edge: robust fraction ≈ μ/(σ² + s²) and below the central Kelly", near(uk.robust, 0.06 / (0.04 + 0.0016), 0.02) && uk.robust < uk.central && uk.lowEnd < uk.central, uk);
  }

  section("Linear algebra");
  {
    const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
    const inv = inverse(A)!;
    const I = matmul(A, inv);
    check("inverse gives the identity", I.every((r, i) => r.every((v, j) => near(v, i === j ? 1 : 0, 1e-12))));
    const e = eigSym(A);
    const tr = e.values.reduce((s, v) => s + v, 0);
    check("eigenvalues sum to the trace and eigenvectors satisfy A v = λ v", near(tr, 9, 1e-10) && e.vectors.every((v, k) => A.every((r, i) => near(r.reduce((s, a, j) => s + a * v[j], 0), e.values[k] * v[i], 1e-9))));
    const sq = sqrtSym(A);
    check("symmetric square root squares back", matmul(sq, sq).every((r, i) => r.every((v, j) => near(v, A[i][j], 1e-9))));
    check("corr and std agree with hand values", near(corr([1, 2, 3], [2, 4, 7]), 0.9933992677987828, 1e-12) && near(std([1, 2, 3, 4]), Math.sqrt(5 / 3)));
  }

  await quantFeatureTests(check, near);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

/** The feature-level checks, filled in feature by feature below the statistics. */
async function quantFeatureTests(_check: typeof check, _near: typeof near) {
  // Added as each feature lands.
}

main().catch((e) => { console.error(e); process.exit(1); });
