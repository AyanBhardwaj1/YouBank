/**
 * How synthetic market paths are made, each a generator of daily log returns for a set of assets:
 * - a stationary block bootstrap of history (keeps cross-asset moves and volatility clusters as they were);
 * - GJR-GARCH(1,1) per asset with Student-t shocks, fitted by maximum likelihood (volatility that reacts,
 *   more to falls than to rises), joined by a t-copula (assets can crash together) or by filtered historical
 *   simulation (whole real days of standardised shocks);
 * - the older GARCH(1,1) joined by a Gaussian copula, kept for comparison;
 * - a two-regime hidden Markov model (calm and stressed markets, and the switches between them);
 * - factor paths: a replay of history's factor moves (2008, 2020) or a shock spread over the horizon,
 *   passed to each asset through its estimated betas plus its own noise.
 * The summariser turns many paths into fans, loss statistics, drawdowns and a histogram, optionally with
 * the paths reweighted (entropy pooling's posterior). Pure.
 */
import { cholesky, correlation, gammaDraw, kendall, lgamma, mean, nearPd, normals, normInv, pseudoObs, quantileSorted, rng, std, studentT, tCdf, tInv, tLogPdf } from "./stats";

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
    // lastVar is already tomorrow's variance, so each day draws first, then updates.
    const v = fits.map((g) => g.lastVar);
    return () => {
      const z = Array.from({ length: N }, () => studentT(n, df));
      const cz = L.map((row) => row.reduce((s, l, k) => s + l * z[k], 0));
      return fits.map((g, j) => {
        const e = Math.sqrt(v[j]) * cz[j];
        v[j] = g.omega + g.alpha * e * e + g.beta * v[j];
        return g.mu + e;
      });
    };
  };
  return { gen, fits };
}

export type Gjr = { mu: number; omega: number; alpha: number; gamma: number; beta: number; nu: number; v0: number; lastVar: number; lastEps: number; nll: number; persistence: number };
type GjrParams = Pick<Gjr, "mu" | "omega" | "alpha" | "gamma" | "beta" | "nu" | "v0">;

/** The GJR recursion's Student-t negative log-likelihood, and tomorrow's variance and today's shock. */
function gjrNll(r: number[], g: GjrParams): { nll: number; v: number; e: number } {
  const c = lgamma((g.nu + 1) / 2) - lgamma(g.nu / 2) - 0.5 * Math.log(Math.PI * (g.nu - 2)), k = (g.nu + 1) / 2;
  let v = g.v0, e = 0, nll = 0;
  for (let t = 0; t < r.length; t++) {
    if (t > 0) v = g.omega + (g.alpha + (e < 0 ? g.gamma : 0)) * e * e + g.beta * v;
    e = r[t] - g.mu;
    const vv = Math.max(v, 1e-12);
    nll -= c - 0.5 * Math.log(vv) - k * Math.log(1 + (e * e) / (vv * (g.nu - 2)));
  }
  return { nll, v: g.omega + (g.alpha + (e < 0 ? g.gamma : 0)) * e * e + g.beta * v, e };
}

/**
 * GJR-GARCH(1,1) with Student-t shocks by maximum likelihood: variance tomorrow = omega + (alpha, plus gamma
 * when today fell)·(today's shock)² + beta·(today's variance). gamma is the leverage effect (falls raise
 * volatility more than rises); nu sets how fat the tails are. The mean is the sample mean.
 */
export function fitGjr(r: number[]): Gjr {
  const mu = mean(r), v0 = std(r) ** 2 || 1e-6;
  const unpack = (p: number[]): GjrParams => {
    const alpha = 0.3 * sig(p[0]), gamma = 0.5 * sig(p[1]), beta = (0.999 - alpha - gamma / 2) * sig(p[2]);
    return { mu, v0, alpha, gamma, beta, omega: v0 * (1 - alpha - gamma / 2 - beta) * Math.exp(p[3]), nu: 2.5 + 57.5 * sig(p[4]) };
  };
  const f = (p: number[]) => gjrNll(r, unpack(p)).nll;
  // Start near typical daily equity values (alpha 0.05, gamma 0.08, beta 0.88, nu 7), and restart once from the best point: a simplex can stall.
  const g = unpack(nelderMead(f, nelderMead(f, [-1.61, -1.66, 3.41, 0, -2.47], 600, 0.6), 400, 0.2)), end = gjrNll(r, g);
  return { ...g, lastVar: end.v, lastEps: end.e, nll: end.nll, persistence: g.alpha + g.gamma / 2 + g.beta };
}

/** Each day's shock over its fitted volatility (standardised residuals). */
export function gjrResiduals(r: number[], g: Gjr): number[] {
  let v = g.v0, e = 0;
  return r.map((x, t) => { if (t > 0) v = g.omega + (g.alpha + (e < 0 ? g.gamma : 0)) * e * e + g.beta * v; e = x - g.mu; return e / Math.sqrt(Math.max(v, 1e-12)); });
}

export type TCopula = { R: number[][]; L: number[][]; nu: number; loglik: number; gaussian: number; tailDependence: number };

/**
 * A Student-t copula for the assets' standardised residuals, on their ranks (so it describes dependence
 * alone, whatever the margins): correlations from Kendall's tau (sin(πτ/2), exact for any elliptical
 * copula), degrees of freedom by maximum likelihood over a grid. Few degrees of freedom mean assets crash
 * together; at 50 it is nearly a Gaussian copula, where joint crashes are rare. Pure.
 */
export function fitTCopula(Z: number[][], grid = [3, 4, 5, 6, 8, 10, 14, 20, 30, 50]): TCopula {
  const T = Z.length, N = Z[0]?.length ?? 0;
  const cols = Array.from({ length: N }, (_, j) => Z.map((z) => z[j]));
  // Kendall's tau is quadratic in days: past 1,500 days, an evenly thinned sample estimates it as well.
  const thin = (x: number[]) => (T > 1500 ? x.filter((_, t) => t % Math.ceil(T / 1500) === 0) : x);
  const R0 = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (__, j): number => (i === j ? 1 : 0)));
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) R0[i][j] = R0[j][i] = Math.sin((Math.PI / 2) * kendall(thin(cols[i]), thin(cols[j])));
  const { R, L } = nearPd(R0);
  const logDet = 2 * L.reduce((s, row, i) => s + Math.log(row[i]), 0);
  // Every column's pseudo-observations are the ranks 1..T over T + 1, so each rank's quantile is computed once per degree of freedom.
  const rank = cols.map((c) => pseudoObs(c).map((u) => Math.round(u * (T + 1)) - 1));
  // x'R⁻¹x for each day, through the Cholesky factor (forward substitution into a reused buffer).
  const y = new Array<number>(N).fill(0);
  const qform = (x: (t: number, j: number) => number) => Array.from({ length: T }, (_, t) => { let s = 0; for (let i = 0; i < N; i++) { let v = x(t, i); for (let k = 0; k < i; k++) v -= L[i][k] * y[k]; y[i] = v / L[i][i]; s += y[i] * y[i]; } return s; });
  let best = { nu: grid[grid.length - 1], ll: -Infinity };
  for (const nu of grid) {
    const xr = Array.from({ length: T }, (_, r) => tInv((r + 1) / (T + 1), nu));
    const q = qform((t, j) => xr[rank[j][t]]);
    const margins = N * xr.reduce((s, x) => s + tLogPdf(x, nu), 0);
    const c0 = lgamma((nu + N) / 2) - lgamma(nu / 2) - (N / 2) * Math.log(nu * Math.PI) - 0.5 * logDet;
    const ll = q.reduce((s, v) => s + c0 - ((nu + N) / 2) * Math.log(1 + v / nu), 0) - margins;
    if (ll > best.ll) best = { nu, ll };
  }
  // The Gaussian copula's likelihood with the same correlations, for comparison.
  const zr = Array.from({ length: T }, (_, r) => normInv((r + 1) / (T + 1)));
  const qg = qform((t, j) => zr[rank[j][t]]);
  const sq = zr.reduce((s, z) => s + z * z, 0) * N;
  const gaussian = -0.5 * T * logDet - 0.5 * (qg.reduce((s, v) => s + v, 0) - sq);
  // Lower tail dependence of the average pair: the chance one asset has its worst day given another does, in the limit.
  let rho = 0, pairs = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { rho += R[i][j]; pairs++; }
  rho = pairs ? rho / pairs : 0;
  const tailDependence = pairs ? 2 * tCdf(-Math.sqrt(((best.nu + 1) * (1 - rho)) / (1 + rho)), best.nu + 1) : 0;
  return { R, L, nu: best.nu, loglik: best.ll, gaussian, tailDependence };
}

/** From the copula's t scale to an asset's unit-variance t shocks through their shared probability: a table even in asinh, mirrored (both are symmetric). */
function tMap(nuC: number, nuJ: number): (x: number) => number {
  const K = 1024, S = Math.asinh(1e4), h = S / (K - 1), scale = Math.sqrt((nuJ - 2) / nuJ), ys = new Float64Array(K);
  for (let i = 0; i < K; i++) ys[i] = i === K - 1 ? 0 : tInv(tCdf(-Math.sinh(S - i * h), nuC), nuJ) * scale;
  return (x) => { const s = (S - Math.asinh(Math.abs(x))) / h, i = Math.max(0, Math.min(K - 2, Math.floor(s))), f = Math.min(1, Math.max(0, s - i)), y = ys[i] + (ys[i + 1] - ys[i]) * f; return x < 0 ? y : -y; };
}

export type GjrModel = { gen: Gen; fits: Gjr[]; copula: TCopula | null; dependence: "t" | "fhs" };

/**
 * GJR-GARCH(1,1)-t per asset, started from today's volatility, the assets' shocks joined either by a
 * t-copula (new joint extremes possible) or by filtered historical simulation (whole real days of
 * standardised shocks, resampled: the assets' joint moves as they were, scaled to the simulated volatility).
 */
export function gjrGen(H: number[][], dependence: "t" | "fhs" = "t"): GjrModel {
  const N = H[0]?.length ?? 0;
  const fits = Array.from({ length: N }, (_, j) => fitGjr(H.map((r) => r[j])));
  const raw = fits.map((g, j) => gjrResiduals(H.map((r) => r[j]), g));
  // Standardised exactly, so a resampled day has unit variance.
  const ms = raw.map((z) => ({ m: mean(z), s: std(z) || 1 }));
  const Z = H.map((_, t) => raw.map((z, j) => (z[t] - ms[j].m) / ms[j].s));
  // lastVar is already tomorrow's variance (the fit applied the last real shock), so each day draws first, then updates.
  const step = (v: number[], z: number[]) => fits.map((g, j) => { const e = Math.sqrt(v[j]) * z[j]; v[j] = g.omega + (g.alpha + (e < 0 ? g.gamma : 0)) * e * e + g.beta * v[j]; return g.mu + e; });
  const start = () => ({ v: fits.map((g) => g.lastVar) });
  if (dependence === "fhs") return { fits, copula: null, dependence, gen: (u) => { const s = start(); return () => step(s.v, Z[Math.floor(u() * Z.length)]); } };
  const copula = N > 1 ? fitTCopula(Z) : null;
  const nuC = copula?.nu ?? fits[0]?.nu ?? 8, L = copula?.L ?? [[1]];
  const maps = fits.map((g) => tMap(nuC, g.nu));
  return {
    fits, copula, dependence,
    gen: (u, n) => {
      const s = start();
      return () => {
        // A multivariate t draw: correlated normals over one shared chi-squared scale, so a bad day is bad for every asset at once.
        const z = Array.from({ length: N }, () => n()), w = Math.sqrt((2 * gammaDraw(u, n, nuC / 2)) / nuC);
        return step(s.v, L.map((row, i) => { let x = 0; for (let k = 0; k <= i; k++) x += row[k] * z[k]; return maps[i](x / w); }));
      };
    },
  };
}

/** Daily returns of `paths` generated paths of `days` days each, from a seed (for checking realism). */
export function samplePaths(gen: Gen, days: number, paths: number, seed: number): number[][][] {
  const u = rng(seed), n = normals(u);
  return Array.from({ length: paths }, () => { const step = gen(u, n); return Array.from({ length: days }, (_, d) => step(d).slice()); });
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

/** Simulated paths before they are summarised: each series' value at every checkpoint, each path's worst drawdown, and a few paths day by day. */
export type Paths = { names: string[]; days: number; paths: number; checkpoints: number[]; store: Float64Array[][]; dd: Float64Array; samples: number[][]; sampleDaily: number[][] };

/** Run `paths` paths of `days` days for assets named `names` (portfolio weighted by `weights`, rebalanced daily). */
export function runPaths(gen: Gen, names: string[], weights: number[], days: number, paths: number, seed: number): Paths {
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
  return { names, days, paths, checkpoints: cps, store, dd, samples, sampleDaily };
}

/** Weighted quantiles and the lower tail's mean of one series. */
function weightedOf(values: Float64Array, probs: Float64Array) {
  const idx = Uint32Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  const cum = new Float64Array(idx.length);
  let c = 0;
  for (let k = 0; k < idx.length; k++) { c += probs[idx[k]]; cum[k] = c; }
  const total = c || 1;
  const q = (x: number) => { const target = x * total; let lo = 0, hi = idx.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; } return values[idx[lo]]; };
  // The mean of the worst `share` of the probability, the last path counted in part.
  const tailMean = (share: number) => { const lim = share * total; let m = 0, t = 0; for (let k = 0; k < idx.length && m < lim; k++) { const p = Math.min(probs[idx[k]], lim - m); t += p * values[idx[k]]; m += p; } return m > 0 ? t / m : q(share); };
  return { q, tailMean, total };
}

/** Value at risk and expected shortfall (as positive losses) of one series' outcomes under path probabilities. */
export function weightedRisk(values: Float64Array, probs: Float64Array, share = 0.05): { var: number; es: number } {
  const w = weightedOf(values, probs);
  return { var: -w.q(share), es: -w.tailMean(share) };
}

/**
 * Summarise simulated paths: return fans at checkpoints (simple returns), the final distribution with
 * value at risk and expected shortfall, the portfolio's drawdowns, a histogram, and a few sample paths.
 * `probs` reweights the paths (entropy pooling's posterior); without it every path counts the same.
 */
export function summarise(P: Paths, probs?: Float64Array): Summary {
  const { names, days, paths, checkpoints: cps, store, dd } = P;
  const N = names.length;
  const series = [...names, "Portfolio"];
  if (probs) {
    const W = store.map((cp) => cp.map((arr) => weightedOf(arr, probs)));
    const fans: Fan[] = series.map((s, i) => ({ series: s, p5: W.map((cp) => cp[i].q(0.05)), p25: W.map((cp) => cp[i].q(0.25)), p50: W.map((cp) => cp[i].q(0.5)), p75: W.map((cp) => cp[i].q(0.75)), p95: W.map((cp) => cp[i].q(0.95)) }));
    const lastStore = store[store.length - 1], lastW = W[W.length - 1];
    const finals: Final[] = series.map((s, i) => {
      const arr = lastStore[i], w = lastW[i];
      let m = 0, loss = 0;
      for (let p = 0; p < paths; p++) { m += probs[p] * arr[p]; if (arr[p] < 0) loss += probs[p]; }
      return { series: s, mean: m / w.total, p1: w.q(0.01), p5: w.q(0.05), p50: w.q(0.5), p95: w.q(0.95), p99: w.q(0.99), probLoss: loss / w.total, var95: -w.q(0.05), cvar95: -w.tailMean(0.05) };
    });
    const ddW = weightedOf(dd, probs), pf = lastStore[N], pw = lastW[N];
    const lo = pw.q(0.005), hi = pw.q(0.995), bins = 30, width = (hi - lo) / bins || 1e-6;
    const counts = new Array(bins).fill(0);
    for (let p = 0; p < paths; p++) counts[Math.max(0, Math.min(bins - 1, Math.floor((pf[p] - lo) / width)))] += (probs[p] / pw.total) * paths;
    // Sample paths drawn by their weight (systematic resampling), drawn day by day between checkpoints.
    const picks: number[] = [];
    let c = 0, k = 0;
    for (let j = 0; j < 20; j++) { const target = ((j + 0.5) / 20) * pw.total; while (k < paths - 1 && c + probs[k] < target) { c += probs[k]; k++; } picks.push(k); }
    const samples = picks.map((p) => Array.from({ length: days }, (_, d) => { const day = d + 1; const i = cps.findIndex((x) => x >= day); const d1 = cps[i], d0 = i > 0 ? cps[i - 1] : 0, v1 = store[i][N][p], v0 = i > 0 ? store[i - 1][N][p] : 0; return d1 === d0 ? v1 : v0 + ((v1 - v0) * (day - d0)) / (d1 - d0); }));
    return { days, paths, checkpoints: cps, fans, finals, drawdown: { p50: ddW.q(0.5), p95: ddW.q(0.05), worst: ddW.q(0.001) }, histogram: { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width), counts }, samples, sampleDaily: P.sampleDaily };
  }
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
    samples: P.samples, sampleDaily: P.sampleDaily,
  };
}

/**
 * Run `paths` paths of `days` days for assets named `names` (portfolio weighted by `weights`, rebalanced
 * daily) and summarise: return fans at checkpoints (simple returns), the final distribution with
 * value at risk and expected shortfall, the portfolio's drawdowns, a histogram, and a few sample paths.
 */
export function simulate(gen: Gen, names: string[], weights: number[], days: number, paths: number, seed: number): Summary {
  return summarise(runPaths(gen, names, weights, days, paths, seed));
}
