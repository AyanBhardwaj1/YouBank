/**
 * How synthetic market paths are made, each a generator of daily log returns for a set of assets:
 * - a stationary block bootstrap of history (keeps cross-asset moves and volatility clusters as they were);
 * - GARCH(1,1) per asset joined by a Gaussian copula with fat-tailed shocks (volatility that reacts);
 * - a two-regime hidden Markov model (calm and stressed markets, and the switches between them);
 * - factor paths: a replay of history's factor moves (2008, 2020) or a shock spread over the horizon,
 *   passed to each asset through its estimated betas plus its own noise.
 * The summariser turns many paths into fans, loss statistics, drawdowns and a histogram. Pure.
 */
import { cholesky, correlation, mean, normals, quantileSorted, rng, std, studentT } from "./stats";

export type Gen = (u: () => number, n: () => number) => (day: number) => number[];

/** Stationary block bootstrap (Politis and Romano): resample days in runs of average length `block`. */
export function bootstrapGen(H: number[][], block = 10): Gen {
  return (u) => {
    let at = Math.floor(u() * H.length);
    return (day) => {
      if (day > 0) at = u() < 1 / block ? Math.floor(u() * H.length) : (at + 1) % H.length;
      return H[at];
    };
  };
}

export type Garch = { mu: number; omega: number; alpha: number; beta: number; lastVar: number; lastEps: number; nll: number };

function garchNll(r: number[], mu: number, omega: number, alpha: number, beta: number): { nll: number; v: number; e: number } {
  let v = r.reduce((s, x) => s + (x - mu) ** 2, 0) / r.length, e = 0, nll = 0;
  for (let t = 0; t < r.length; t++) {
    if (t > 0) v = omega + alpha * e * e + beta * v;
    e = r[t] - mu;
    nll += 0.5 * (Math.log(Math.max(v, 1e-12)) + (e * e) / Math.max(v, 1e-12));
  }
  return { nll, v: omega + alpha * e * e + beta * v, e };
}

/** Nelder-Mead minimisation (small problems). */
export function nelderMead(f: (x: number[]) => number, x0: number[], iters = 300, step = 0.5): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    const c = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const at = (t: number) => c.map((v, j) => v + t * (worst.x[j] - v));
    const r = at(-1), fr = f(r);
    if (fr < best.f) { const e = at(-2), fe = f(e); simplex[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }; }
    else if (fr < second.f) simplex[n] = { x: r, f: fr };
    else { const k = at(0.5), fk = f(k); if (fk < worst.f) simplex[n] = { x: k, f: fk }; else simplex = simplex.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])), f: f(p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]))) })); }
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-10) break;
  }
  return simplex.sort((a, b) => a.f - b.f)[0].x;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));

/** GARCH(1,1) by maximum likelihood: variance tomorrow = omega + alpha·(today's shock)² + beta·(today's variance). */
export function fitGarch(r: number[]): Garch {
  const mu = mean(r), v0 = std(r) ** 2 || 1e-6;
  const unpack = (p: number[]) => { const alpha = 0.3 * sig(p[0]), beta = (0.998 - alpha) * sig(p[1]); return { alpha, beta, omega: v0 * (1 - alpha - beta) * Math.exp(p[2]) }; };
  const best = nelderMead((p) => { const q = unpack(p); return garchNll(r, mu, q.omega, q.alpha, q.beta).nll; }, [-1.2, 2.5, 0], 250);
  const q = unpack(best), end = garchNll(r, mu, q.omega, q.alpha, q.beta);
  return { mu, ...q, lastVar: end.v, lastEps: end.e, nll: end.nll };
}

/** GARCH per asset with shocks joined by the assets' correlation (a Gaussian copula) and Student-t tails. */
export function garchGen(H: number[][], df = 6): { gen: Gen; fits: Garch[] } {
  const N = H[0]?.length ?? 0;
  const fits = Array.from({ length: N }, (_, j) => fitGarch(H.map((r) => r[j])));
  // Standardised residuals give the dependence the copula keeps.
  const Z = H.map(() => new Array(N).fill(0));
  for (let j = 0; j < N; j++) {
    const g = fits[j];
    let v = std(H.map((r) => r[j])) ** 2, e = 0;
    for (let t = 0; t < H.length; t++) { if (t > 0) v = g.omega + g.alpha * e * e + g.beta * v; e = H[t][j] - g.mu; Z[t][j] = e / Math.sqrt(Math.max(v, 1e-12)); }
  }
  const L = cholesky(correlation(Z));
  const gen: Gen = (_u, n) => {
    const v = fits.map((g) => g.lastVar), e = fits.map((g) => g.lastEps);
    return () => {
      const z = Array.from({ length: N }, () => studentT(n, df));
      const cz = L.map((row) => row.reduce((s, l, k) => s + l * z[k], 0));
      return fits.map((g, j) => {
        v[j] = g.omega + g.alpha * e[j] * e[j] + g.beta * v[j];
        e[j] = Math.sqrt(v[j]) * cz[j];
        return g.mu + e[j];
      });
    };
  };
  return { gen, fits };
}

export type Regimes = { p: number[][]; means: number[][]; covs: number[][][]; share: number[]; last: number; label: string[] };

/**
 * Two market regimes from the portfolio's daily returns (a Gaussian hidden Markov model fitted by
 * Baum-Welch), then each regime's own mean and covariance for every asset. The stressed regime is the
 * more volatile one.
 */
export function fitRegimes(H: number[][], iterations = 40): Regimes {
  const T = H.length, N = H[0]?.length ?? 0;
  const x = H.map((r) => mean(r));
  const s = std(x) || 1e-4, m = mean(x);
  let mu = [m + 0.2 * s, m - 0.5 * s], sd = [s * 0.7, s * 1.8], A = [[0.97, 0.03], [0.08, 0.92]], pi = [0.8, 0.2];
  const dens = (v: number, k: number) => Math.exp(-0.5 * ((v - mu[k]) / sd[k]) ** 2) / (sd[k] * Math.sqrt(2 * Math.PI)) + 1e-300;
  let gamma: number[][] = [];
  for (let it = 0; it < iterations; it++) {
    const alpha: number[][] = [], c: number[] = [];
    for (let t = 0; t < T; t++) {
      const a = [0, 1].map((k) => (t === 0 ? pi[k] : alpha[t - 1][0] * A[0][k] + alpha[t - 1][1] * A[1][k]) * dens(x[t], k));
      const sum = a[0] + a[1] || 1e-300; c.push(sum); alpha.push([a[0] / sum, a[1] / sum]);
    }
    const beta: number[][] = new Array(T);
    beta[T - 1] = [1, 1];
    for (let t = T - 2; t >= 0; t--) beta[t] = [0, 1].map((i) => (A[i][0] * dens(x[t + 1], 0) * beta[t + 1][0] + A[i][1] * dens(x[t + 1], 1) * beta[t + 1][1]) / c[t + 1]);
    gamma = alpha.map((a, t) => { const g = [a[0] * beta[t][0], a[1] * beta[t][1]]; const z = g[0] + g[1] || 1; return [g[0] / z, g[1] / z]; });
    const xi = [[0, 0], [0, 0]];
    for (let t = 0; t < T - 1; t++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) xi[i][j] += (alpha[t][i] * A[i][j] * dens(x[t + 1], j) * beta[t + 1][j]) / c[t + 1];
    A = xi.map((row) => { const z = row[0] + row[1] || 1; return [Math.max(1e-4, row[0] / z), Math.max(1e-4, row[1] / z)]; });
    pi = gamma[0];
    for (let k = 0; k < 2; k++) {
      const w = gamma.map((g) => g[k]), W = w.reduce((a, b) => a + b, 0) || 1e-12;
      mu[k] = w.reduce((a, wt, t) => a + wt * x[t], 0) / W;
      sd[k] = Math.max(1e-6, Math.sqrt(w.reduce((a, wt, t) => a + wt * (x[t] - mu[k]) ** 2, 0) / W));
    }
  }
  // Keep regime 1 as the stressed (more volatile) one.
  if (sd[0] > sd[1]) { mu = [mu[1], mu[0]]; sd = [sd[1], sd[0]]; A = [[A[1][1], A[1][0]], [A[0][1], A[0][0]]]; gamma = gamma.map((g) => [g[1], g[0]]); }
  const means: number[][] = [], covs: number[][][] = [], share: number[] = [];
  for (let k = 0; k < 2; k++) {
    const w = gamma.map((g) => g[k]), W = w.reduce((a, b) => a + b, 0) || 1e-12;
    const m2 = Array.from({ length: N }, (_, j) => w.reduce((a, wt, t) => a + wt * H[t][j], 0) / W);
    const cov = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => w.reduce((a, wt, t) => a + wt * (H[t][i] - m2[i]) * (H[t][j] - m2[j]), 0) / W));
    means.push(m2); covs.push(cov); share.push(W / T);
  }
  const lastG = gamma[T - 1] ?? [1, 0];
  return { p: A, means, covs, share, last: lastG[1] > 0.5 ? 1 : 0, label: ["calm", "stressed"] };
}

/** Paths that switch between the two regimes, starting from today's. */
export function regimeGen(R: Regimes, start?: number): Gen {
  const L = R.covs.map(cholesky);
  return (u, n) => {
    let s = start ?? R.last;
    return (day) => {
      if (day > 0) s = u() < R.p[s][s] ? s : 1 - s;
      const z = R.means[s].map(() => n());
      return R.means[s].map((m, i) => m + L[s][i].reduce((a, l, k) => a + l * z[k], 0));
    };
  };
}

export type Exposure = { alpha: number; betas: number[]; residSd: number; r2: number };

/**
 * Factor-driven paths: every day the factors move by `factor(day)` (history's own moves in a replay, a
 * drift plus resampled noise in a shock), and each asset follows through its betas plus its own noise:
 * a whole day of real residuals when `residual` is given (fat tails, and the assets' shared quirks
 * beyond the factors), else normal noise at each asset's residual volatility.
 */
export function factorGen(exposures: Exposure[], factor: (u: () => number, day: number) => number[], residual?: (u: () => number) => number[], keepAlpha = false): Gen {
  return (u, n) => (day) => {
    const f = factor(u, day);
    const e = residual?.(u);
    return exposures.map((x, i) => (keepAlpha ? x.alpha : 0) + x.betas.reduce((s, b, k) => s + b * (f[k] ?? 0), 0) + (e ? e[i] : x.residSd * n()));
  };
}

export type Fan = { series: string; p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
export type Final = { series: string; mean: number; p1: number; p5: number; p50: number; p95: number; p99: number; probLoss: number; var95: number; cvar95: number };
export type Summary = {
  days: number; paths: number; checkpoints: number[]; fans: Fan[]; finals: Final[];
  drawdown: { p50: number; p95: number; worst: number };
  histogram: { edges: number[]; counts: number[] };
  samples: number[][];
  sampleDaily: number[][];
};

/**
 * Run `paths` paths of `days` days for assets named `names` (portfolio weighted by `weights`, rebalanced
 * daily) and summarise: return fans at checkpoints (simple returns), the final distribution with
 * value at risk and expected shortfall, the portfolio's drawdowns, a histogram, and a few sample paths.
 */
export function simulate(gen: Gen, names: string[], weights: number[], days: number, paths: number, seed: number): Summary {
  const u = rng(seed), n = normals(u);
  const N = names.length, S = N + 1;
  const cps = [...new Set(Array.from({ length: Math.min(days, 40) }, (_, i) => Math.round(((i + 1) * days) / Math.min(days, 40))))];
  const at = new Map(cps.map((d, i) => [d, i]));
  const store = cps.map(() => Array.from({ length: S }, () => new Float64Array(paths)));
  const dd = new Float64Array(paths);
  const samples: number[][] = [], sampleDaily: number[][] = [];
  const w = weights.map((x) => x / (weights.reduce((a, b) => a + b, 0) || 1));
  for (let p = 0; p < paths; p++) {
    const step = gen(u, n);
    const cum = new Array(N).fill(0);
    let port = 0, peak = 0, worst = 0;
    const sample: number[] = [];
    for (let d = 0; d < days; d++) {
      const r = step(d);
      if (sampleDaily.length < 756) sampleDaily.push(r.slice());
      let pr = 0;
      for (let i = 0; i < N; i++) { cum[i] += r[i]; pr += w[i] * (Math.exp(r[i]) - 1); }
      port += Math.log(Math.max(1e-9, 1 + pr));
      peak = Math.max(peak, port); worst = Math.min(worst, port - peak);
      if (p < 20) sample.push(Math.exp(port) - 1);
      const k = at.get(d + 1);
      if (k !== undefined) { for (let i = 0; i < N; i++) store[k][i][p] = Math.exp(cum[i]) - 1; store[k][N][p] = Math.exp(port) - 1; }
    }
    dd[p] = Math.exp(worst) - 1;
    if (p < 20) samples.push(sample);
  }
  const series = [...names, "Portfolio"];
  const sorted = store.map((cp) => cp.map((arr) => Float64Array.from(arr).sort()));
  const q = (arr: Float64Array, x: number) => quantileSorted(arr as unknown as number[], x);
  const fans: Fan[] = series.map((s, i) => ({ series: s, p5: sorted.map((cp) => q(cp[i], 0.05)), p25: sorted.map((cp) => q(cp[i], 0.25)), p50: sorted.map((cp) => q(cp[i], 0.5)), p75: sorted.map((cp) => q(cp[i], 0.75)), p95: sorted.map((cp) => q(cp[i], 0.95)) }));
  const last = sorted[sorted.length - 1];
  const finals: Final[] = series.map((s, i) => {
    const arr = last[i], len = arr.length;
    const var95 = -q(arr, 0.05);
    let tail = 0, cnt = 0;
    for (let k = 0; k < len && arr[k] <= -var95; k++) { tail += arr[k]; cnt++; }
    let loss = 0;
    for (let k = 0; k < len; k++) if (arr[k] < 0) loss++;
    return { series: s, mean: store[store.length - 1][i].reduce((a, b) => a + b, 0) / len, p1: q(arr, 0.01), p5: q(arr, 0.05), p50: q(arr, 0.5), p95: q(arr, 0.95), p99: q(arr, 0.99), probLoss: loss / len, var95, cvar95: cnt ? -tail / cnt : var95 };
  });
  const ddSorted = Float64Array.from(dd).sort();
  const pf = last[N];
  const lo = q(pf, 0.005), hi = q(pf, 0.995), bins = 30, width = (hi - lo) / bins || 1e-6;
  const counts = new Array(bins).fill(0);
  for (const v of pf) counts[Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / width)))]++;
  return {
    days, paths, checkpoints: cps, fans, finals,
    drawdown: { p50: q(ddSorted, 0.5), p95: q(ddSorted, 0.05), worst: ddSorted[0] },
    histogram: { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width), counts },
    samples, sampleDaily,
  };
}
