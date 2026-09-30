/**
 * Market scenarios for a set of tickers: fit the tickers to the factors (betas on three years of daily
 * returns), pick the generator by driver and method, run the paths, and check the synthetic days
 * against the real ones. Every result carries its recipe and seed.
 */
import { REPLAYS, describeShock, type Shock } from "./drivers";
import { FACTORS, factorHistory, tickerReturns, type Factor, type FactorRow } from "./data";
import { bootstrapGen, factorGen, fitRegimes, garchGen, regimeGen, simulate, type Exposure, type Gen, type Summary } from "./models";
import { mean, ols, realism, type Realism } from "./stats";

export type Driver = "none" | "replay" | "shock" | "event" | "tail";
export type Method = "auto" | "bootstrap" | "garch" | "regimes" | "diffusion";
export type MarketSpec = { tickers: string[]; weights?: number[]; driver: Driver; replay?: string; shock?: Shock; horizon: number; method: Method; paths: number; seed: number; title?: string };
export type MarketResult = {
  kind: "market"; synthetic: true; title: string; driver: Driver; method: string; recipe: string; seed: number; paths: number; horizon: number;
  names: string[]; weights: number[]; missing: string[];
  exposures: { ticker: string; betas: Record<Factor, number>; r2: number; residVol: number }[];
  shock?: { text: string; described: string; reasoning?: string; sources?: { label: string; url: string }[] };
  replay?: { key: string; label: string; from: string; to: string; note: string; factorMoves: Record<Factor, number> };
  regimes?: { stressedShare: number; now: string; calmVol: number; stressedVol: number };
  summary: Omit<Summary, "sampleDaily">; realism: Realism; history: { from: string; to: string; days: number };
};

const ANN = Math.sqrt(252);

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
  let gen: Gen, days = horizon, recipe = "", method = spec.method;
  const out: Partial<MarketResult> = {};
  const calmFactor = (u: () => number) => { const r = recent[Math.floor(u() * recent.length)]; return FACTORS.map((f) => r[f]); };

  if (spec.driver === "replay") {
    const key = spec.replay && REPLAYS[spec.replay] ? spec.replay : "2022";
    const w = REPLAYS[key];
    const path = factors.filter((f) => f.date >= w.from && f.date <= w.to);
    days = Math.min(420, path.length);
    gen = factorGen(exposures, (_u, d) => FACTORS.map((f) => path[Math.min(d, path.length - 1)][f]), residual);
    method = "auto";
    recipe = `A replay of ${w.label} (${w.from} to ${w.to}): the factors' actual daily moves (the U.S. market and oil and gas stocks from Kenneth French's CRSP data, WTI and Henry Hub from EIA, the 10-year yield from the Treasury), passed to each ticker through its betas from the last three years, plus its own day-to-day moves (real residual days, resampled).`;
    out.replay = { key, ...w, factorMoves: Object.fromEntries(FACTORS.map((f) => [f, f === "rates" ? path.reduce((s, r) => s + r.rates, 0) : Math.exp(path.reduce((s, r) => s + r[f], 0)) - 1])) as Record<Factor, number> };
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
    if (method === "auto" || method === "diffusion") method = horizon <= 126 ? "garch" : "bootstrap";
    if (method === "garch") {
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
  const summary = simulate(gen, names, weights, days, Math.max(100, Math.min(20_000, spec.paths)), spec.seed);
  // Realism is judged on ordinary days: the same machinery without the scenario's drift, against the real last three years.
  // (Generated windows are only as long as the horizon, so they are sampled whole, several of them.)
  const calm = external?.paths.length && spec.driver === "none" ? simulate(gen, names, weights, days, Math.ceil(756 / days), spec.seed + 1) : simulate(spec.driver === "none" ? gen : factorGen(exposures, calmFactor, residual), names, weights, 252, 3, spec.seed + 1);
  const { sampleDaily: _drop, ...keep } = summary;
  void _drop;
  return {
    kind: "market", synthetic: true, title: spec.title || defaultTitle(spec, names), driver: spec.driver, method, recipe, seed: spec.seed, paths: summary.paths, horizon: days,
    names, weights, missing: rets.missing,
    exposures: names.map((t, j) => ({ ticker: t, betas: Object.fromEntries(FACTORS.map((f, k) => [f, Math.round(exposures[j].betas[k] * 1000) / 1000])) as Record<Factor, number>, r2: Math.round(exposures[j].r2 * 100) / 100, residVol: Math.round(exposures[j].residSd * ANN * 1000) / 1000 })),
    ...out, summary: keep, realism: realism(names, rets.rows.slice(-750), calm.sampleDaily), history: { from: rets.dates[0], to: rets.dates[rets.dates.length - 1], days: rets.rows.length },
  };
}

function defaultTitle(spec: MarketSpec, names: string[]): string {
  const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  if (spec.driver === "replay") return `${who} through ${REPLAYS[spec.replay ?? "2022"]?.label ?? "history"}`;
  if (spec.driver === "shock") return `${who}: ${spec.shock ? describeShock(spec.shock) : "a shock"}`;
  if (spec.driver === "event" || spec.driver === "tail") return `${who}: ${spec.shock?.text || "a scenario"}`;
  return `${who}, the next ${spec.horizon} trading days`;
}

