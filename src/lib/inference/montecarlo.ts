/**
 * Monte Carlo: seeded samplers for the distributions analysts use for assumptions (normal, lognormal,
 * triangular, uniform, PERT), a runner that returns percentiles and a histogram, and a one-at-a-time
 * tornado for which input moves the answer most.
 */
import { normCdf, normInv, normalSampler, quantile, rng } from "./stats";

export type Dist =
  | { kind: "normal"; mean: number; sd: number; min?: number; max?: number }
  | { kind: "lognormal"; median: number; sigma: number }
  | { kind: "triangular"; low: number; mode: number; high: number }
  | { kind: "uniform"; low: number; high: number }
  | { kind: "pert"; low: number; mode: number; high: number };

export function sampler(d: Dist, u: () => number, z: () => number): () => number {
  switch (d.kind) {
    case "normal": return () => Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, d.mean + d.sd * z()));
    case "lognormal": return () => d.median * Math.exp(d.sigma * z());
    case "uniform": return () => d.low + (d.high - d.low) * u();
    case "triangular": {
      const c = (d.mode - d.low) / (d.high - d.low || 1);
      return () => { const x = u(); return x < c ? d.low + Math.sqrt(x * (d.high - d.low) * (d.mode - d.low)) : d.high - Math.sqrt((1 - x) * (d.high - d.low) * (d.high - d.mode)); };
    }
    case "pert": {
      // Beta(a, b) on [low, high] with lambda 4, sampled from two gammas (Marsaglia and Tsang).
      const range = d.high - d.low || 1;
      const a = 1 + (4 * (d.mode - d.low)) / range, b = 1 + (4 * (d.high - d.mode)) / range;
      const gamma = (k: number): number => {
        if (k < 1) return gamma(k + 1) * Math.pow(u(), 1 / k);
        const dd = k - 1 / 3, c = 1 / Math.sqrt(9 * dd);
        for (;;) { let x = z(), v = 1 + c * x; if (v <= 0) continue; v = v * v * v; const uu = u(); x = x * x; if (uu < 1 - 0.0331 * x * x || Math.log(uu) < 0.5 * x + dd * (1 - v + Math.log(v))) return dd * v; }
      };
      return () => { const g1 = gamma(a), g2 = gamma(b); return d.low + range * (g1 / (g1 + g2)); };
    }
  }
}

export type SimResult = { n: number; p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; mean: number; histogram: { lo: number; hi: number; count: number }[]; samples: number[] };

export function summarize(values: number[], bins = 24): SimResult {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const lo = quantile(v, 0.005), hi = quantile(v, 0.995);
  const width = (hi - lo) / bins || 1;
  const histogram = Array.from({ length: bins }, (_, i) => ({ lo: lo + i * width, hi: lo + (i + 1) * width, count: 0 }));
  for (const x of v) { const i = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / width))); histogram[i].count++; }
  return {
    n: v.length, mean: v.reduce((a, b) => a + b, 0) / Math.max(1, v.length),
    p5: quantile(v, 0.05), p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9), p95: quantile(v, 0.95),
    histogram, samples: v,
  };
}

/** Run `model` over `n` draws of the named inputs. The model receives one draw per input. */
export function simulate<K extends string>(inputs: Record<K, Dist>, model: (x: Record<K, number>) => number, n = 2000, seed = 7): SimResult {
  const u = rng(seed), z = normalSampler(u);
  const draw = Object.fromEntries(Object.entries(inputs).map(([k, d]) => [k, sampler(d as Dist, u, z)])) as Record<K, () => number>;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Object.fromEntries(Object.entries(draw).map(([k, f]) => [k, (f as () => number)()])) as Record<K, number>;
    out.push(model(x));
  }
  return summarize(out);
}

/** Central value of a distribution, used as the base case in the tornado. */
export function center(d: Dist): number {
  switch (d.kind) {
    case "normal": return d.mean;
    case "lognormal": return d.median;
    case "uniform": return (d.low + d.high) / 2;
    case "triangular": case "pert": return d.mode;
  }
}

/** Output at each input's 10th and 90th percentile with the others at their central values, widest swing first. */
export function tornado<K extends string>(inputs: Record<K, Dist>, model: (x: Record<K, number>) => number, seed = 11): { input: K; low: number; high: number; swing: number }[] {
  const u = rng(seed), z = normalSampler(u);
  const base = Object.fromEntries(Object.entries(inputs).map(([k, d]) => [k, center(d as Dist)])) as Record<K, number>;
  const rows = (Object.keys(inputs) as K[]).map((k) => {
    const f = sampler(inputs[k], u, z);
    const draws = Array.from({ length: 800 }, f);
    const lo = model({ ...base, [k]: quantile(draws, 0.1) }), hi = model({ ...base, [k]: quantile(draws, 0.9) });
    return { input: k, low: Math.min(lo, hi), high: Math.max(lo, hi), swing: Math.abs(hi - lo) };
  });
  return rows.sort((a, b) => b.swing - a.swing);
}

/* ---------------- Correlated inputs (Gaussian copula) ---------------- */

const pertTables = new WeakMap<object, number[]>();

/**
 * The p-quantile of a distribution (its inverse CDF), for correlated sampling: a correlated normal
 * draw is turned into a probability and then into this input's own distribution. PERT has no closed
 * form, so its quantiles come from a table of 20,000 sorted draws.
 */
export function quantileOf(d: Dist, p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  switch (d.kind) {
    case "normal": return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, d.mean + d.sd * normInv(q)));
    case "lognormal": return d.median * Math.exp(d.sigma * normInv(q));
    case "uniform": return d.low + (d.high - d.low) * q;
    case "triangular": {
      const c = (d.mode - d.low) / (d.high - d.low || 1);
      return q < c ? d.low + Math.sqrt(q * (d.high - d.low) * (d.mode - d.low)) : d.high - Math.sqrt((1 - q) * (d.high - d.low) * (d.high - d.mode));
    }
    case "pert": {
      let t = pertTables.get(d);
      if (!t) { const u = rng(99), z = normalSampler(u), f = sampler(d, u, z); t = Array.from({ length: 20_000 }, f).sort((a, b) => a - b); pertTables.set(d, t); }
      const x = q * (t.length - 1), i = Math.floor(x);
      return t[i] + (t[Math.min(t.length - 1, i + 1)] - t[i]) * (x - i);
    }
  }
}

/** Lower-triangular L with L L' = R, or null when R is not a valid correlation matrix. */
export function cholesky(R: number[][]): number[][] | null {
  const n = R.length, L = R.map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = R[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s <= 1e-12) return null; L[i][j] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/**
 * n draws of k inputs whose ranks move together as `corr` says (Gaussian copula): correlated normals
 * from the Cholesky factor, each mapped to a probability and then through its input's inverse CDF, so
 * every input keeps its own distribution. Pass null for independent inputs.
 */
export function drawInputs(dists: Dist[], corr: number[][] | null, n: number, seed = 7): number[][] {
  const u = rng(seed), z = normalSampler(u);
  const L = corr ? cholesky(corr) : null;
  if (corr && !L) throw new Error("Those correlations cannot all hold at once (the matrix is not positive definite)");
  const k = dists.length, out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const e = Array.from({ length: k }, () => z());
    const c = L ? L.map((row) => row.reduce((a, l, j) => a + l * e[j], 0)) : e;
    out.push(c.map((v, j) => quantileOf(dists[j], normCdf(v))));
  }
  return out;
}

/** Spearman's rank correlation (average ranks for ties): how monotonically y moves with x. */
export function spearman(x: number[], y: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
    const r = Array(v.length).fill(0);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].val === idx[i].val) j++;
      for (let k = i; k <= j; k++) r[idx[k].i] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = (n + 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
