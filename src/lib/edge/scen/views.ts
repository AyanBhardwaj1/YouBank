/**
 * From a narrative to a scenario, the views chain:
 * 1. a small model writes a view per factor it touches: the median move, a 10-90% range, how likely it is,
 *    the horizon, and the historical episode it resembles (drivers.ts);
 * 2. analog episodes are found in the factors' own daily history since 2000, and severity is anchored to
 *    them, because models write mild scenarios (Soleimani 2025: expected shortfall only 1.13-1.35 times the
 *    base case for LLM scenarios, against 4.45 times in 2008);
 * 3. plausibility is the views' Mahalanobis radius under the covariance of stressed days;
 * 4. factors the narrative leaves out get their conditional mean given the others, Σ_uc Σ_cc⁻¹ s;
 * 5. entropy pooling (Meucci 2008) reweights many simulated factor paths so they agree with the views while
 *    adding as little information as possible, solved through its dual; when the weight piles onto a
 *    handful of paths (the effective number of scenarios collapses) the result is refused. The scenario's
 *    own paths are then drawn from the reweighted factor paths.
 * Moves are fractions for prices (-0.3 is down 30%) and percentage points for the 10-year yield. Pure.
 */
import { FACTORS, type Factor, type FactorRow } from "./data";
import { chi2Cdf, mean, rng, solveSpd } from "./stats";

export type Analog = { name: string; from: string; to: string };
export type View = { factor: Factor; median: number; low: number; high: number; probability: number; horizon: number; analog: Analog | null };
export type Narrative = { text: string; reasoning: string; views: View[]; tickers: Record<string, number> };
export type Episode = { from: string; to: string; days: number; moves: Record<Factor, number>; severity: number };
export type Fill = { factor: Factor; value: number; low: number; high: number };

/** A move into the factors' own units (log returns for prices, points for the yield), and back. */
export const toLog = (f: Factor, v: number) => (f === "rates" ? v : Math.log(Math.max(0.02, 1 + v)));
export const fromLog = (f: Factor, x: number) => (f === "rates" ? x : Math.exp(x) - 1);

/** A view's numbers in range and around its median (the median is kept as written; the range widens to hold it), its horizon in trading days. */
export function cleanView(v: View): View {
  const lim = (x: number) => (v.factor === "rates" ? Math.max(-5, Math.min(5, x)) : Math.max(-0.95, Math.min(3, x)));
  const median = lim(v.median), [low, high] = [lim(v.low), lim(v.high)].sort((a, b) => a - b);
  const pad = v.factor === "rates" ? 0.05 : 0.01;
  return { ...v, low: Math.min(low, median - pad), median, high: Math.max(high, median + pad), probability: Math.max(0.01, Math.min(1, v.probability || 0.1)), horizon: Math.max(5, Math.min(252, Math.round(v.horizon || 60))) };
}

/** Days whose trailing 20-day market volatility is in history's top fifth: the stressed days. */
export function stressedDays(rows: FactorRow[], window = 20, share = 0.2): boolean[] {
  const vol = rows.map((_, t) => { if (t < window) return NaN; let s = 0, s2 = 0; for (let i = t - window + 1; i <= t; i++) { s += rows[i].market; s2 += rows[i].market ** 2; } return Math.sqrt(Math.max(0, s2 / window - (s / window) ** 2)); });
  const known = vol.filter(Number.isFinite).sort((a, b) => a - b), cut = known[Math.floor((1 - share) * known.length)] ?? Infinity;
  return vol.map((v) => Number.isFinite(v) && v >= cut);
}

/** The daily covariance of the factors on the days given. */
export function covarianceOf(rows: FactorRow[], keep: boolean[]): number[][] {
  const X = rows.filter((_, t) => keep[t]).map((r) => FACTORS.map((f) => r[f]));
  const m = FACTORS.map((_, k) => mean(X.map((x) => x[k])));
  return FACTORS.map((_, i) => FACTORS.map((__, j) => X.reduce((s, x) => s + (x[i] - m[i]) * (x[j] - m[j]), 0) / Math.max(1, X.length - 1)));
}

/** The covariance of cumulative moves to different horizons, for independent days: min(h_i, h_j)·Σ_ij. */
const covAt = (cov: number[][], a: { k: number; h: number }[], b: { k: number; h: number }[]) => a.map((x) => b.map((y) => Math.min(x.h, y.h) * cov[x.k][y.k]));

/**
 * How unusual the views are even for stressed markets: their Mahalanobis radius under the stressed
 * covariance (in the factors' own units, each at its horizon), and where that falls in a chi-squared with
 * as many degrees of freedom as views.
 */
export function plausibility(views: View[], cov: number[][]): { radius: number; percentile: number; verdict: "plausible" | "severe" | "extreme" } {
  if (!views.length) return { radius: 0, percentile: 0, verdict: "plausible" };
  const c = views.map((v) => ({ k: FACTORS.indexOf(v.factor), h: v.horizon })), s = views.map((v) => toLog(v.factor, v.median));
  const x = solveSpd(covAt(cov, c, c), s), d2 = Math.max(0, s.reduce((a, v, i) => a + v * x[i], 0)), percentile = chi2Cdf(d2, views.length);
  return { radius: Math.sqrt(d2), percentile, verdict: percentile < 0.95 ? "plausible" : percentile < 0.999 ? "severe" : "extreme" };
}

/**
 * The factors the narrative leaves out, filled with their conditional mean given the views (Σ_uc Σ_cc⁻¹ s
 * under the stressed covariance) at the scenario's horizon, with a 10-90% range from the conditional variance.
 */
export function conditionalFill(views: View[], cov: number[][], horizon: number): Fill[] {
  const c = views.map((v) => ({ k: FACTORS.indexOf(v.factor), h: v.horizon })), s = views.map((v) => toLog(v.factor, v.median));
  const free = FACTORS.filter((f) => !views.some((v) => v.factor === f)).map((f) => ({ f, k: FACTORS.indexOf(f), h: horizon }));
  if (!free.length) return [];
  const Ccc = covAt(cov, c, c), Cuc = covAt(cov, free, c);
  const w = c.length ? solveSpd(Ccc, s) : [];
  return free.map((u, i) => {
    const m = Cuc[i].reduce((a, v, j) => a + v * w[j], 0);
    const z = c.length ? solveSpd(Ccc, Cuc[i]) : [];
    const sd = Math.sqrt(Math.max(0, u.h * cov[u.k][u.k] - Cuc[i].reduce((a, v, j) => a + v * z[j], 0)));
    return { factor: u.f, value: fromLog(u.f, m), low: fromLog(u.f, m - 1.2816 * sd), high: fromLog(u.f, m + 1.2816 * sd) };
  });
}

/** Prefix sums of the factors' daily moves, so any window's cumulative move is one subtraction. */
function prefix(rows: FactorRow[]): Float64Array[] {
  return FACTORS.map((f) => { const p = new Float64Array(rows.length + 1); rows.forEach((r, t) => { p[t + 1] = p[t] + r[f]; }); return p; });
}

/** The views as a standardised direction: each view's move over its horizon in units of that factor's usual move over the horizon. */
function direction(rows: FactorRow[], views: View[]) {
  const sd = FACTORS.map((f) => Math.sqrt(mean(rows.map((r) => r[f] ** 2))) || 1e-6);
  const z = views.map((v) => toLog(v.factor, v.median) / (sd[FACTORS.indexOf(v.factor)] * Math.sqrt(v.horizon)));
  const norm = Math.sqrt(z.reduce((a, v) => a + v * v, 0)) || 1;
  return { sd, z, norm };
}

/** One window's episode: every factor's move to the scenario's horizon (in view units), and its severity along the views' direction relative to the views themselves. */
function episodeAt(rows: FactorRow[], P: Float64Array[], start: number, horizon: number, views: View[], dir: ReturnType<typeof direction>): Episode {
  const end = Math.min(rows.length, start + horizon);
  const at = (k: number, h: number) => P[k][Math.min(rows.length, start + h)] - P[k][start];
  const moves = Object.fromEntries(FACTORS.map((f, k) => { const v = views.find((x) => x.factor === f); return [f, fromLog(f, at(k, v?.horizon ?? horizon))]; })) as Record<Factor, number>;
  const proj = views.reduce((a, v, i) => { const k = FACTORS.indexOf(v.factor); return a + (at(k, v.horizon) / (dir.sd[k] * Math.sqrt(v.horizon))) * dir.z[i]; }, 0) / dir.norm;
  return { from: rows[start].date, to: rows[end - 1].date, days: end - start, moves, severity: proj / dir.norm };
}

/**
 * Episodes in the factors' history most like the views: windows of the scenario's horizon nearest the
 * views (standardised), at most one per stretch of history. Severity above 1 means the episode went
 * further in the views' direction than the views do.
 */
export function retrieveAnalogs(rows: FactorRow[], views: View[], k = 3): Episode[] {
  if (!views.length || rows.length < 300) return [];
  const H = Math.max(...views.map((v) => v.horizon)), P = prefix(rows), dir = direction(rows, views);
  const cand: { t: number; d: number }[] = [];
  for (let t = 0; t + H <= rows.length; t++) {
    let d = 0;
    views.forEach((v, i) => { const j = FACTORS.indexOf(v.factor); d += ((P[j][t + v.horizon] - P[j][t]) / (dir.sd[j] * Math.sqrt(v.horizon)) - dir.z[i]) ** 2; });
    cand.push({ t, d });
  }
  cand.sort((a, b) => a.d - b.d);
  const out: number[] = [];
  for (const c of cand) { if (out.every((t) => Math.abs(t - c.t) >= H)) out.push(c.t); if (out.length >= k) break; }
  return out.map((t) => episodeAt(rows, P, t, H, views, dir));
}

/** The model's named episode, read from history: its worst stretch of the scenario's horizon in the views' direction (or the whole episode, run to the horizon, when shorter). */
export function namedEpisode(rows: FactorRow[], views: View[], analog: Analog | null): Episode | null {
  if (!analog || !views.length || !/^\d{4}-\d{2}-\d{2}$/.test(analog.from) || !/^\d{4}-\d{2}-\d{2}$/.test(analog.to)) return null;
  const H = Math.max(...views.map((v) => v.horizon)), P = prefix(rows), dir = direction(rows, views);
  const first = rows.findIndex((r) => r.date >= analog.from);
  if (first < 0) return null;
  let last = rows.length - 1;
  while (last > first && rows[last].date > analog.to) last--;
  if (last - first + 1 < 5) return null;
  let best: Episode | null = null;
  for (let t = first; t <= Math.max(first, last - H + 1) && t + 5 <= rows.length; t++) { const e = episodeAt(rows, P, t, H, views, dir); if (!best || e.severity > best.severity) best = e; }
  return best;
}

/**
 * Severity anchored to an episode that went further than the views: each view's median moves halfway to
 * the episode's move, and its range stretches to take the episode in. Views already more severe stay.
 */
export function anchorViews(views: View[], ep: Episode | null): { views: View[]; changed: Factor[] } {
  if (!ep) return { views, changed: [] };
  const changed: Factor[] = [];
  const out = views.map((v) => {
    const a = ep.moves[v.factor];
    if (!Number.isFinite(a) || Math.sign(a) !== Math.sign(v.median) || Math.abs(a) <= Math.abs(v.median)) return v;
    changed.push(v.factor);
    const median = v.median + 0.5 * (a - v.median);
    return { ...v, median, low: Math.min(v.low, median, a), high: Math.max(v.high, median, a) };
  });
  return { views: out, changed };
}

export type PriorPath = { next: (day: number) => FactorRow; logRatio: () => number };

/**
 * The paths entropy pooling tilts: factor days drawn from all history since 2000 in runs (a stationary
 * bootstrap of average run `block`), switching between calm and stressed spells at history's own rates,
 * starting in today's. A share of the paths lean toward the views (each run's start drawn with odds rising
 * exponentially with how far the run moves the views' way; for severe views, more time in stressed
 * spells), so a crisis-sized narrative has history's own crisis days to rest on. `weight` turns a path's
 * log likelihood ratio into its weight at history's own odds (a defensive mixture: no weight passes
 * 1 / (1 - share) of the average), for the base case.
 */
export function viewPrior(rows: FactorRow[], stressed: boolean[], views: View[], horizon: number, block: [number, number] = [10, 10], share = 0.5, stressLean = true): { start: (u: () => number) => PriorPath; weight: (logRatio: number) => number } {
  const T = rows.length, K = FACTORS.length, P = prefix(rows);
  const sd = FACTORS.map((f) => Math.sqrt(mean(rows.map((r) => r[f] ** 2))) || 1e-6);
  const raw = FACTORS.map((f, k) => { const v = views.find((x) => x.factor === f); return v ? toLog(f, v.median) / (sd[k] * Math.sqrt(v.horizon)) : 0; });
  const norm = Math.hypot(...raw), d = raw.map((x) => (norm ? x / norm : 0));
  const pools = [0, 1].map((s) => rows.map((_, t) => t).filter((t) => (stressed[t] ? 1 : 0) === s));
  // The lean per pool: the smallest exponent (up to 4) whose leaning runs average the views' pace, so the leaning paths arrive near the views.
  const lean = pools.map((pool, st) => {
    // Each day's run-ahead move in the views' direction, in standard units, over the spell's average run.
    const b = block[st], target = norm * Math.sqrt(b / Math.max(b, horizon));
    const y = new Map(pool.map((t) => { const e = Math.min(T, t + b); let s = 0; for (let k = 0; k < K; k++) s += (d[k] * (P[k][e] - P[k][t])) / (sd[k] * Math.sqrt(Math.max(1, e - t))); return [t, s] as const; }));
    const avg = (th: number) => { let z = 0, m = 0; for (const t of pool) { const v = y.get(t)!, w = Math.exp(th * v); z += w; m += w * v; } return z ? m / z : 0; };
    let lo = 0, hi = 4;
    if (avg(hi) < target) lo = hi; else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (avg(mid) < target) lo = mid; else hi = mid; }
    const w = Float64Array.from(pool, (t) => Math.exp(lo * y.get(t)!)), z = w.reduce((a, c) => a + c, 0) || 1, cum = new Float64Array(w.length);
    let c = 0;
    w.forEach((v, i) => { c += v / z; cum[i] = c; });
    return { th: lo, logMean: Math.log(z / Math.max(1, pool.length)), cum, y: Float64Array.from(pool, (t) => y.get(t)!) };
  });
  const stay = [0, 0], from = [0, 0];
  for (let t = 1; t < T; t++) { const s = stressed[t - 1] ? 1 : 0; from[s]++; if ((stressed[t] ? 1 : 0) === s) stay[s]++; }
  const keep = [from[0] ? stay[0] / from[0] : 0.99, from[1] ? stay[1] / from[1] : 0.95], today = stressed[T - 1] ? 1 : 0;
  // For views beyond ordinary times (over one and a half usual moves), leaning paths also spend longer in stressed spells: into one within about two weeks, and staying.
  const keepLean = stressLean && norm > 1.5 ? [Math.min(keep[0], 0.93), Math.max(keep[1], 0.995)] : keep;
  return {
    start: (u) => {
      const leaning = u() < share;
      let s = today, at = 0, L = 0;
      // A run's first day: uniform in the spell's pool, or leaning; either way the log likelihood ratio (leaning over plain) adds up.
      const jump = (st: number) => {
        const pool = pools[st], ln = lean[st];
        let i: number;
        if (leaning) { const r = u(); let lo = 0, hi = pool.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (ln.cum[m] < r) lo = m + 1; else hi = m; } i = lo; } else i = Math.floor(u() * pool.length);
        L += ln.th * ln.y[i] - ln.logMean;
        return pool[i];
      };
      return {
        next: (day) => {
          if (day === 0) at = jump(s);
          else {
            const next = u() < (leaning ? keepLean : keep)[s] ? s : 1 - s;
            L += next === s ? Math.log(keepLean[s] / keep[s]) : Math.log((1 - keepLean[s]) / (1 - keep[s]));
            at = next === s && u() >= 1 / block[s] && at + 1 < T && (stressed[at + 1] ? 1 : 0) === s ? at + 1 : jump(next);
            s = next;
          }
          return rows[at];
        },
        logRatio: () => L,
      };
    },
    weight: (l) => 1 / (1 - share + share * Math.exp(Math.min(60, l))),
  };
}

/**
 * Entropy pooling (Meucci 2008): the probabilities q closest to the prior p in relative entropy whose
 * expectations of each feature row of A equal b. Through the dual: q ∝ p·exp(λ·A), with λ found by
 * Newton's method, damped (Levenberg-Marquardt) when the features' covariance is nearly singular, as
 * percentile views make it, and a backtracking line search. `ok` is false when the views cannot be met
 * (no path reaches them, or they contradict each other).
 */
export function entropyPool(prior: Float64Array, A: Float64Array[], b: number[], tol = 1e-7): { q: Float64Array; ok: boolean; error: number; iterations: number } {
  const J = prior.length, K = A.length, logp = Float64Array.from(prior, (p) => Math.log(Math.max(p, 1e-300)));
  const q = new Float64Array(J), lam = new Array<number>(K).fill(0);
  const evalAt = (l: number[]) => {
    let m = -Infinity;
    const lw = new Float64Array(J);
    for (let i = 0; i < J; i++) { let v = logp[i]; for (let k = 0; k < K; k++) v += l[k] * A[k][i]; lw[i] = v; if (v > m) m = v; }
    let z = 0;
    for (let i = 0; i < J; i++) { lw[i] = Math.exp(lw[i] - m); z += lw[i]; }
    // The dual objective λ·b - log Σ p·exp(λ·A), to maximise.
    return { w: lw, z, dual: l.reduce((s, v, k) => s + v * b[k], 0) - (m + Math.log(z)) };
  };
  let cur = evalAt(lam), error = Infinity, it = 0;
  for (; it < 200; it++) {
    for (let i = 0; i < J; i++) q[i] = cur.w[i] / cur.z;
    const E = A.map((a) => { let s = 0; for (let i = 0; i < J; i++) s += q[i] * a[i]; return s; });
    const g = b.map((v, k) => v - E[k]);
    error = Math.max(...g.map(Math.abs));
    if (error < tol) break;
    const C = Array.from({ length: K }, (_, k) => Array.from({ length: K }, (__, l) => { if (l < k) return 0; let s = 0; for (let i = 0; i < J; i++) s += q[i] * (A[k][i] - E[k]) * (A[l][i] - E[l]); return s; }));
    for (let k = 0; k < K; k++) for (let l = 0; l < k; l++) C[k][l] = C[l][k];
    const scale = C.reduce((s, row, k) => s + row[k], 0) / K + 1e-12;
    // The smallest damping whose step climbs the dual: plain Newton when the covariance is well conditioned, nearer gradient ascent when not.
    let moved = false;
    for (let mu = 1e-9 * scale; mu <= 1e4 * scale && !moved; mu *= 100) {
      const step = solveSpd(C.map((row, k) => row.map((v, l) => (k === l ? v + mu : v))), g), slope = g.reduce((s, v, k) => s + v * step[k], 0);
      if (!(slope > 0)) continue;
      for (let t = 1; t > 1e-6; t /= 2) {
        const next = evalAt(lam.map((v, k) => v + t * step[k]));
        if (next.dual >= cur.dual + 1e-4 * t * slope) { for (let k = 0; k < K; k++) lam[k] += t * step[k]; cur = next; moved = true; break; }
      }
    }
    if (!moved) break;
  }
  for (let i = 0; i < J; i++) q[i] = cur.w[i] / cur.z;
  return { q, ok: error < 1e-5, error, iterations: it };
}

/** A seed for factor path `i` of a run seeded `seed`, so any one path can be drawn again on its own. */
export const pathSeed = (seed: number, i: number) => (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) >>> 0;

/**
 * Many factor-only paths from the prior, each from its own seed: every path's cumulative moves at the
 * horizons in `need` (factors' own units) and its log likelihood ratio, leaning over plain. Pure.
 */
export function factorScenarios(prior: { start: (u: () => number) => PriorPath }, paths: number, need: number[], seed: number): { moves: Map<number, Float64Array>[]; logRatio: Float64Array } {
  const H = Math.max(...need), moves = FACTORS.map(() => new Map(need.map((h) => [h, new Float64Array(paths)]))), logRatio = new Float64Array(paths);
  const at = Array.from({ length: H + 1 }, (_, d) => need.includes(d));
  for (let i = 0; i < paths; i++) {
    const path = prior.start(rng(pathSeed(seed, i))), cum = FACTORS.map(() => 0);
    for (let d = 0; d < H; d++) { const row = path.next(d); for (let k = 0; k < FACTORS.length; k++) { cum[k] += row[FACTORS[k]]; if (at[d + 1]) moves[k].get(d + 1)![i] = cum[k]; } }
    logRatio[i] = path.logRatio();
  }
  return { moves, logRatio };
}

/** `n` draws of path indices in proportion to their probabilities (systematic resampling: one uniform, evenly spaced). */
export function resample(q: Float64Array, n: number, u = 0.5): Uint32Array {
  const out = new Uint32Array(n), total = q.reduce((a, b) => a + b, 0);
  let c = q[0] ?? 0, i = 0;
  for (let j = 0; j < n; j++) { const target = ((j + u) / n) * total; while (c < target && i < q.length - 1) { i++; c += q[i]; } out[j] = i; }
  return out;
}

/** The effective number of scenarios: exp of the probabilities' entropy (equal weights on n paths give n). */
export function effectiveScenarios(q: Float64Array): number {
  let h = 0;
  for (const p of q) if (p > 0) h -= p * Math.log(p);
  return Math.exp(h);
}

/**
 * The constraints entropy pooling meets: each view's 10th, 50th and 90th percentiles (the share of paths
 * below each, on the factor's move to the view's horizon), and each filled factor's conditional mean.
 * `moves(factor, horizon)` gives every path's cumulative move in the factors' own units.
 */
export function viewConstraints(views: View[], fills: Fill[], horizon: number, moves: (f: Factor, h: number) => Float64Array): { A: Float64Array[]; b: number[] } {
  const A: Float64Array[] = [], b: number[] = [];
  for (const v of views) {
    const x = moves(v.factor, v.horizon);
    for (const [val, share] of [[v.low, 0.1], [v.median, 0.5], [v.high, 0.9]] as const) { const cut = toLog(v.factor, val); A.push(Float64Array.from(x, (m) => (m <= cut ? 1 : 0))); b.push(share); }
  }
  for (const f of fills) { A.push(moves(f.factor, horizon)); b.push(toLog(f.factor, f.value)); }
  return { A, b };
}
