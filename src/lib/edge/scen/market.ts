/**
 * Market scenarios for a set of tickers: fit the tickers to the factors (betas on three years of daily
 * returns), pick the generator by driver and method, run the paths, and check the synthetic days
 * against the real ones. A narrative runs the views chain (views.ts): history's factor paths reweighted
 * by entropy pooling to agree with the views. Every result carries its recipe and seed.
 */
import { REPLAYS, describeShock, describeViews, type Shock } from "./drivers";
import { FACTORS, factorHistory, tickerReturns, type Factor, type FactorRow } from "./data";
import { bootstrapGen, factorGen, fitRegimes, garchGen, gjrGen, regimeGen, runPaths, samplePaths, summarise, weightedRisk, type Exposure, type Gen, type Paths, type Summary } from "./models";
import { stylisedRealism } from "./realism";
import { mean, ols, realism, rng, type Realism } from "./stats";
import { anchorViews, cleanView, conditionalFill, covarianceOf, effectiveScenarios, entropyPool, factorScenarios, namedEpisode, pathSeed, plausibility, resample, retrieveAnalogs, stressedDays, toLog, viewConstraints, viewPrior, type Analog, type Episode, type Fill, type Narrative, type View } from "./views";

export type Driver = "none" | "replay" | "shock" | "event" | "tail";
export type Method = "auto" | "bootstrap" | "garch" | "gjr-fhs" | "gjr-t" | "regimes" | "diffusion";
/**
 * What "auto" runs: GJR-GARCH-t with filtered historical simulation scored best on realism v2 across the
 * module's real data (tickers and factors, 11 samples, 2 seeds: 98.6 on average against 97.5 for the
 * older GARCH with a Gaussian copula, 97.6 with a t-copula, 96.7 for two regimes and 86.6 for the
 * bootstrap, which replays history), and sat closest to the real values inside the bands.
 */
export const DEFAULT_METHOD: Method = "gjr-fhs";
export type MarketSpec = { tickers: string[]; weights?: number[]; driver: Driver; replay?: string; shock?: Shock; narrative?: Narrative; horizon: number; method: Method; paths: number; seed: number; title?: string };
export type NarrativeResult = {
  text: string; reasoning: string; probability: number;
  views: (View & { written: { median: number; low: number; high: number }; anchored: boolean })[];
  filled: Fill[]; named: (Episode & { name: string }) | null; analogs: Episode[]; anchor: { name: string; from: string; to: string } | null;
  plausibility: { radius: number; percentile: number; verdict: "plausible" | "severe" | "extreme"; written: number };
  ens: { effective: number; paths: number; share: number; prior: number };
  severity: { baseEs: number; cvarMultiple: number; analogLoss: number | null; analogMultiple: number | null; blended: { var95: number; cvar95: number } };
};
export type MarketResult = {
  kind: "market"; synthetic: true; title: string; driver: Driver; method: string; recipe: string; seed: number; paths: number; horizon: number;
  names: string[]; weights: number[]; missing: string[];
  exposures: { ticker: string; betas: Record<Factor, number>; r2: number; residVol: number }[];
  shock?: { text: string; described: string; reasoning?: string; sources?: { label: string; url: string }[] };
  replay?: { key: string; label: string; from: string; to: string; note: string; factorMoves: Record<Factor, number> };
  regimes?: { stressedShare: number; now: string; calmVol: number; stressedVol: number };
  gjr?: { dependence: "t" | "fhs"; fits: { ticker: string; alpha: number; gamma: number; beta: number; nu: number; persistence: number }[]; copula: { nu: number; tailDependence: number } | null };
  narrative?: NarrativeResult;
  summary: Omit<Summary, "sampleDaily">; realism: Realism; history: { from: string; to: string; days: number };
};

const ANN = Math.sqrt(252);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const refuse = (message: string) => Object.assign(new Error(message), { status: 422 });
/** Below this many effective scenarios (or 1% of the paths) a narrative's worst 5% rests on a handful of paths, so it is refused. */
export const MIN_SCENARIOS = 100;
/** Factor-only paths entropy pooling weighs for a narrative (cheap: five numbers a day). */
const FACTOR_PATHS = 20_000;

/**
 * Each ticker's betas to the factors, residual volatility and fit, on the days both are known, plus the
 * residuals day by day (all tickers' on the same day together, so their shared moves survive). Pure.
 */
export function exposuresOf(names: string[], dates: string[], rows: number[][], factors: FactorRow[]): { fits: (Exposure & { r2: number })[]; residuals: number[][] } {
  const byDate = new Map(factors.map((f) => [f.date, f]));
  const idx = dates.map((d, i) => (byDate.has(d) ? i : -1)).filter((i) => i >= 0);
  const X = idx.map((i) => FACTORS.map((f) => byDate.get(dates[i])![f]));
  if (X.length < 120) return { fits: names.map(() => ({ alpha: 0, betas: FACTORS.map((f) => (f === "market" ? 1 : 0)), residSd: 0.02, r2: 0 })), residuals: [] };
  const fits = names.map((_, j) => {
    const fit = ols(idx.map((i) => rows[i][j]), X, 1e-4);
    const sd = Math.sqrt(fit.resid.reduce((s, v) => s + v * v, 0) / Math.max(1, fit.resid.length - FACTORS.length - 1));
    return { alpha: fit.beta[0], betas: fit.beta.slice(1), residSd: sd, r2: fit.r2, resid: fit.resid };
  });
  return { fits: fits.map((f) => ({ alpha: f.alpha, betas: f.betas, residSd: f.residSd, r2: f.r2 })), residuals: idx.map((_, t) => fits.map((f) => f.resid[t])) };
}

/** Daily factor moves that add up to a shock over the horizon, on top of the factors' usual day-to-day noise. */
export function shockFactor(shock: Shock, horizon: number, recent: FactorRow[]): (u: () => number, day: number) => number[] {
  const drift = FACTORS.map((f) => { const v = shock.factors[f]; return v === undefined ? 0 : f === "rates" ? v / horizon : Math.log(Math.max(0.02, 1 + v)) / horizon; });
  const means = FACTORS.map((f) => mean(recent.map((r) => r[f])));
  return (u) => { const r = recent[Math.floor(u() * recent.length)]; return FACTORS.map((f, k) => drift[k] + r[f] - means[k]); };
}

/** A generator that adds each ticker's own shock, spread evenly, to another generator. */
function withTickerDrift(gen: Gen, names: string[], shock: Shock | undefined, horizon: number): Gen {
  const d = names.map((t) => (shock?.tickers[t] !== undefined ? Math.log(Math.max(0.02, 1 + shock.tickers[t])) / horizon : 0));
  if (d.every((x) => x === 0)) return gen;
  return (u, n) => { const step = gen(u, n); return (day) => step(day).map((v, i) => v + d[i]); };
}

/** Run a market scenario. `external` supplies generated paths (the diffusion model's) when the method needs them. */
export async function runMarket(spec: MarketSpec, external?: { paths: number[][][]; recipe: string }): Promise<MarketResult> {
  const tickers = [...new Set(spec.tickers.map((t) => t.toUpperCase()))].slice(0, 12);
  const rets = await tickerReturns(tickers, 3);
  if (!rets.names.length) throw Object.assign(new Error(`No price history for ${tickers.join(", ")}.`), { status: 404 });
  const names = rets.names;
  const weights = names.map((t) => { const i = tickers.indexOf(t); return spec.weights?.[i] && spec.weights[i]! > 0 ? spec.weights[i]! : 1; });
  const factors = await factorHistory();
  const { fits: exposures, residuals } = exposuresOf(names, rets.dates, rets.rows, factors);
  const residual = residuals.length ? (u: () => number) => residuals[Math.floor(u() * residuals.length)] : undefined;
  const recent = factors.filter((f) => f.date >= rets.dates[0]);
  const horizon = Math.max(5, Math.min(252, Math.round(spec.horizon || 60)));
  let gen: Gen, days = horizon, recipe = "", method = spec.method, paths = Math.max(100, Math.min(20_000, spec.paths));
  // A narrative runs and weighs its own paths (entropy pooling's probabilities); everything else runs below with equal weights.
  let raw: Paths | null = null, probs: Float64Array | undefined;
  const out: Partial<MarketResult> = {};
  const calmFactor = (u: () => number) => { const r = recent[Math.floor(u() * recent.length)]; return FACTORS.map((f) => r[f]); };
  const narrative = (spec.driver === "shock" || spec.driver === "event" || spec.driver === "tail") && spec.narrative?.views.length ? spec.narrative : null;

  if (spec.driver === "replay") {
    const key = spec.replay && REPLAYS[spec.replay] ? spec.replay : "2022";
    const w = REPLAYS[key];
    const path = factors.filter((f) => f.date >= w.from && f.date <= w.to);
    days = Math.min(420, path.length);
    gen = factorGen(exposures, (_u, d) => FACTORS.map((f) => path[Math.min(d, path.length - 1)][f]), residual);
    method = "auto";
    recipe = `A replay of ${w.label} (${w.from} to ${w.to}): the factors' actual daily moves (the U.S. market and oil and gas stocks from Kenneth French's CRSP data, WTI and Henry Hub from EIA, the 10-year yield from the Treasury), passed to each ticker through its betas from the last three years, plus its own day-to-day moves (real residual days, resampled).`;
    out.replay = { key, ...w, factorMoves: Object.fromEntries(FACTORS.map((f) => [f, f === "rates" ? path.reduce((s, r) => s + r.rates, 0) : Math.exp(path.reduce((s, r) => s + r[f], 0)) - 1])) as Record<Factor, number> };
  } else if (narrative) {
    // The views chain: analogs and anchoring, plausibility, the conditional fill, then a prior of history's factor paths for entropy pooling.
    const stressed = stressedDays(factors), cov = covarianceOf(factors, stressed);
    const written = narrative.views.map(cleanView);
    const namedAnalog: Analog | null = written.find((v) => v.analog)?.analog ?? null;
    const named = namedEpisode(factors, written, namedAnalog), analogs = retrieveAnalogs(factors, written);
    const anchorEp = named ?? analogs.find((e) => e.severity >= 1) ?? null;
    const { views, changed } = anchorViews(written, anchorEp);
    days = Math.max(...views.map((v) => v.horizon));
    const fills = conditionalFill(views, cov, days), prior = viewPrior(factors, stressed, views, days);
    // Entropy pooling over many factor-only paths (cheap): the mix of history's paths and paths leaning toward the views, each counted
    // once, is the prior it tilts; the likelihood-ratio weights give history's own odds for the base case. The scenario's paths are then drawn by weight.
    const sc = factorScenarios(prior, FACTOR_PATHS, [...new Set([...views.map((v) => v.horizon), days])], spec.seed);
    const pw = Float64Array.from(sc.logRatio, prior.weight), tot = pw.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pw.length; i++) pw[i] /= tot;
    const { A, b } = viewConstraints(views, fills, days, (f, h) => sc.moves[FACTORS.indexOf(f)].get(h)!);
    const ep = entropyPool(new Float64Array(FACTOR_PATHS).fill(1 / FACTOR_PATHS), A, b), effective = effectiveScenarios(ep.q);
    // Refusals stay short (the error layer treats long messages as internal, the canvas cuts at 300): the factors by name, not every view in full.
    const factorNames = [...new Set(views.map((v) => v.factor))].join(", "), replay = anchorEp ? `, or replay ${anchorEp.from} to ${anchorEp.to}` : "";
    if (!ep.ok) throw refuse(`No simulated paths can carry these views together (${factorNames}): they ask for more than the factors' history since 2000 holds. Soften the narrative (smaller moves or a longer horizon)${replay}.`);
    if (effective < Math.max(MIN_SCENARIOS, 0.01 * FACTOR_PATHS)) throw refuse(`Only about ${Math.round(effective)} of ${FACTOR_PATHS.toLocaleString("en-US")} paths would carry this scenario (${factorNames}), too few for its worst 5%. Soften the narrative (smaller moves, wider ranges or a longer horizon)${replay}.`);
    // Each drawn path replays its factor days from its own seed, through the betas, plus the tickers' own moves (and the narrative's ticker shocks, except in the base case).
    const drawn = (pick: Uint32Array, shocked: boolean): Gen => { let p = -1; return withTickerDrift((u, n) => {
      const path = prior.start(rng(pathSeed(spec.seed, pick[++p % pick.length])));
      return (day) => { const row = path.next(day), f = FACTORS.map((k) => row[k]), e = residual?.(u); return exposures.map((x, i) => x.betas.reduce((s, bk, k) => s + bk * f[k], 0) + (e ? e[i] : x.residSd * n())); };
    }, names, shocked ? { factors: {}, tickers: narrative.tickers, text: narrative.text } : undefined, days); };
    paths = Math.max(5000, paths);
    gen = drawn(resample(ep.q, paths), true);
    raw = runPaths(gen, names, weights, days, paths, spec.seed);
    const baseRaw = runPaths(drawn(resample(pw, 2000), false), names, weights, days, 2000, spec.seed + 2);
    // Severity against the base case (history's odds, drawn the same way), the analog's own loss, and the scenario weighted by its probability.
    const final = raw.store[raw.store.length - 1][names.length], baseFinal = baseRaw.store[baseRaw.store.length - 1][names.length];
    const even = (n: number) => new Float64Array(n).fill(1 / n);
    const base = weightedRisk(baseFinal, even(baseFinal.length)), scen = weightedRisk(final, even(final.length)), probability = Math.min(...views.map((v) => v.probability));
    const both = new Float64Array(final.length + baseFinal.length); both.set(final); both.set(baseFinal, final.length);
    const blended = weightedRisk(both, Float64Array.from(both, (_, i) => (i < final.length ? probability / final.length : (1 - probability) / baseFinal.length)));
    const w = weights.map((x) => x / weights.reduce((s, c) => s + c, 0));
    const analogLoss = anchorEp ? -exposures.reduce((s, x, i) => s + w[i] * (Math.exp(x.betas.reduce((t, bk, k) => t + bk * toLog(FACTORS[k], anchorEp.moves[FACTORS[k]]), 0)) - 1), 0) : null;
    const anchorName = anchorEp ? (anchorEp === named && namedAnalog ? namedAnalog.name : "the closest episode at least as severe") : null;
    out.narrative = {
      text: narrative.text, reasoning: narrative.reasoning, probability,
      views: views.map((v, i) => ({ ...v, written: { median: written[i].median, low: written[i].low, high: written[i].high }, anchored: changed.includes(v.factor) })),
      filled: fills, named: named && namedAnalog ? { ...named, name: namedAnalog.name } : null, analogs,
      anchor: anchorEp && anchorName ? { name: anchorName, from: anchorEp.from, to: anchorEp.to } : null,
      plausibility: { ...plausibility(views, cov), written: plausibility(written, cov).radius },
      ens: { effective: Math.round(effective), paths: FACTOR_PATHS, share: effective / FACTOR_PATHS, prior: Math.round(effectiveScenarios(pw)) },
      severity: { baseEs: base.es, cvarMultiple: base.es > 0 ? scen.es / base.es : 0, analogLoss, analogMultiple: analogLoss !== null && base.es > 0 ? analogLoss / base.es : null, blended: { var95: blended.var, cvar95: blended.es } },
    };
    method = "auto";
    recipe = `A narrative turned into views by a small model (${describeViews(views)})${anchorEp ? `, severity anchored to ${anchorName} (${anchorEp.from} to ${anchorEp.to}): medians moved halfway to its moves where it went further` : ""}; factors it leaves out set to their conditional means under the covariance of stressed days. ${FACTOR_PATHS.toLocaleString("en-US")} paths of the factors' daily history since 2000 (in runs of about ten days, calm and stressed spells at history's own rates; half of them leaning toward the views), reweighted by entropy pooling to agree with the views (the 10th, 50th and 90th percentiles of each), leaving ${Math.round(effective).toLocaleString("en-US")} effective scenarios; ${paths.toLocaleString("en-US")} of them drawn by weight and passed to each ticker through its betas, plus its own moves (real residual days, resampled). The base case is the same paths at history's own odds.`;
    out.shock = { text: narrative.text, described: describeViews(views), reasoning: narrative.reasoning };
  } else if (spec.driver === "shock" || spec.driver === "event" || spec.driver === "tail") {
    const shock = spec.shock ?? { factors: {}, tickers: {}, text: "" };
    gen = withTickerDrift(factorGen(exposures, shockFactor(shock, horizon, recent), residual), names, shock, horizon);
    method = "auto";
    recipe = `${spec.driver === "tail" ? "An AI-imagined tail risk" : spec.driver === "event" ? "A scenario proposed from live events" : "A shock"} (${describeShock(shock)}) spread evenly over ${horizon} trading days on top of the factors' usual daily noise (resampled from the last three years), passed to each ticker through its betas, plus its own moves (real residual days, resampled).`;
    out.shock = { text: shock.text, described: describeShock(shock), reasoning: shock.reasoning, sources: shock.sources };
  } else if (external?.paths.length) {
    let i = 0;
    gen = () => { const p = external.paths[i++ % external.paths.length]; return (d) => p[Math.min(d, p.length - 1)]; };
    days = Math.min(horizon, external.paths[0].length);
    recipe = external.recipe;
    method = "diffusion";
  } else {
    if (method === "auto" || method === "diffusion") method = DEFAULT_METHOD;
    if (method === "gjr-fhs" || method === "gjr-t") {
      const m = gjrGen(rets.rows, method === "gjr-t" ? "t" : "fhs");
      gen = m.gen;
      out.gjr = { dependence: m.dependence, fits: m.fits.map((f, j) => ({ ticker: names[j], alpha: r3(f.alpha), gamma: r3(f.gamma), beta: r3(f.beta), nu: Math.round(f.nu * 10) / 10, persistence: r3(f.persistence) })), copula: m.copula ? { nu: m.copula.nu, tailDependence: r3(m.copula.tailDependence) } : null };
      recipe = `GJR-GARCH(1,1) for each ticker with Student-t shocks, fitted by maximum likelihood on ${rets.rows.length} trading days to ${rets.dates[rets.dates.length - 1]} and started from today's volatility (falls raise volatility more than rises), ${m.dependence === "t" ? `the tickers' shocks joined by a Student-t copula (${m.copula?.nu ?? "-"} degrees of freedom, fitted to the ranks of their standardised residuals), so they can crash together, beyond anything in the sample` : "the tickers' shocks drawn as whole real days of standardised residuals (filtered historical simulation), so they move, and crash, together as they have, scaled to the simulated volatility"}.`;
    } else if (method === "garch") {
      gen = garchGen(rets.rows).gen;
      recipe = `GARCH(1,1) for each ticker, fitted on ${rets.rows.length} trading days to ${rets.dates[rets.dates.length - 1]} and started from today's volatility, with Student-t shocks (6 degrees of freedom) joined by the tickers' correlation (a Gaussian copula).`;
    } else if (method === "regimes") {
      const R = fitRegimes(rets.rows);
      gen = regimeGen(R);
      const vol = (k: number) => Math.sqrt(R.covs[k].reduce((s, row, i) => s + row[i], 0) / names.length) * ANN;
      out.regimes = { stressedShare: R.share[1], now: R.label[R.last], calmVol: vol(0), stressedVol: vol(1) };
      recipe = `Two market regimes (calm and stressed) found in ${rets.rows.length} days of the tickers' returns by a Gaussian hidden Markov model; each regime has its own means and covariances, and paths switch between them at the fitted rates, starting from today's (${R.label[R.last]}).`;
    } else {
      gen = bootstrapGen(rets.rows, 10);
      recipe = `A stationary block bootstrap of ${rets.rows.length} trading days of the tickers' joint returns to ${rets.dates[rets.dates.length - 1]} (runs of about ten days, so volatility clusters and cross-ticker moves stay as they were).`;
    }
  }
  raw ??= runPaths(gen, names, weights, days, paths, spec.seed);
  const { sampleDaily: _drop, ...keep } = summarise(raw, probs);
  void _drop;
  // Realism is judged on ordinary days: the same machinery without the scenario's drift, against the real last three years,
  // in paths as long as the real sample (the diffusion model's shorter windows are joined end to end).
  const real = rets.rows.slice(-750);
  const sample = external?.paths.length && spec.driver === "none" ? samplePaths(gen, days, Math.ceil(6000 / days), spec.seed + 1) : samplePaths(spec.driver === "none" ? gen : factorGen(exposures, calmFactor, residual), real.length, 8, spec.seed + 1);
  const v1 = realism(names, real, sample.flat().slice(0, 756)), v2 = stylisedRealism(names, real, sample, { seed: spec.seed });
  return {
    kind: "market", synthetic: true, title: spec.title || defaultTitle(spec, names, out.shock?.described), driver: spec.driver, method, recipe, seed: spec.seed, paths: keep.paths, horizon: days,
    names, weights, missing: rets.missing,
    exposures: names.map((t, j) => ({ ticker: t, betas: Object.fromEntries(FACTORS.map((f, k) => [f, r3(exposures[j].betas[k])])) as Record<Factor, number>, r2: Math.round(exposures[j].r2 * 100) / 100, residVol: r3(exposures[j].residSd * ANN) })),
    ...out, summary: keep,
    // Realism v2 needs synthetic runs as long as a few weeks of history; with less shared history it falls back to v1.
    realism: v2.paths && Number.isFinite(v2.score)
      ? { ...v1, score: v2.score, warnings: [...v2.warnings, ...v1.warnings.filter((w) => /KS/.test(w))], version: 2, checks: v2.checks, bands: { resamples: v2.resamples, block: v2.block, days: v2.days, paths: v2.paths }, v1: v1.score }
      : v1,
    history: { from: rets.dates[0], to: rets.dates[rets.dates.length - 1], days: rets.rows.length },
  };
}

function defaultTitle(spec: MarketSpec, names: string[], described?: string): string {
  const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  if (spec.driver === "replay") return `${who} through ${REPLAYS[spec.replay ?? "2022"]?.label ?? "history"}`;
  if (spec.driver === "shock") return `${who}: ${spec.narrative ? spec.narrative.text.slice(0, 120) : spec.shock ? describeShock(spec.shock) : described ?? "a shock"}`;
  if (spec.driver === "event" || spec.driver === "tail") return `${who}: ${spec.shock?.text || "a scenario"}`;
  return `${who}, the next ${spec.horizon} trading days`;
}
