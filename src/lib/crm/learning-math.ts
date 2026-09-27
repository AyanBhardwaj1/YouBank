/**
 * The mathematics of the adaptive engine: Beta posteriors, their exact credible bounds, Thompson
 * sampling, empirical-Bayes priors, and how much a person changed a draft.
 *
 * Pure functions, no dependencies, deterministic when given a seeded random source, so every rule the
 * engine acts on can be tested.
 */

/* ---------------- Special functions ---------------- */

/** ln Γ(x), Lanczos approximation (g = 7, n = 9). Accurate to ~1e-15 for x > 0. */
export function logGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300, EPS = 1e-14;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b): the Beta(a, b) CDF at x. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  // Use the symmetry relation where the continued fraction converges fastest.
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** The p-quantile of Beta(a, b), by bisection on the CDF (monotone, so this always converges). */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------------- Random draws ---------------- */

export type Rng = () => number;

/** A small seeded generator (mulberry32) so simulations and tests are reproducible. */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: Rng): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) by Marsaglia–Tsang, with the shape < 1 boost. */
export function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(rng() || Number.MIN_VALUE, 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng), y = sampleGamma(b, rng);
  return x / (x + y);
}

/* ---------------- Posteriors ---------------- */

export type Posterior = { alpha: number; beta: number };

export const mean = (p: Posterior) => p.alpha / (p.alpha + p.beta);
/** Observations beyond the prior. */
export const evidence = (p: Posterior, prior: Posterior) => p.alpha + p.beta - prior.alpha - prior.beta;
/** The equal-tailed credible interval. */
export const interval = (p: Posterior, mass = 0.9): [number, number] => {
  const tail = (1 - mass) / 2;
  return [betaQuantile(tail, p.alpha, p.beta), betaQuantile(1 - tail, p.alpha, p.beta)];
};

/**
 * Empirical-Bayes prior: centre a new user's Beta prior on what everyone else's data says (the
 * population rate `rate`), with the weight of `strength` pseudo-observations. A newcomer starts from
 * the crowd's experience and moves to their own as their evidence outweighs it.
 */
export function populationPrior(rate: number | null, strength = 4, fallback: Posterior = { alpha: 1, beta: 1 }): Posterior {
  if (rate == null || !Number.isFinite(rate)) return fallback;
  const r = Math.min(0.98, Math.max(0.02, rate));
  return { alpha: 1 + strength * r, beta: 1 + strength * (1 - r) };
}

/**
 * Thompson sampling: draw once from each arm's posterior and play the best draw. It explores an
 * arm exactly as often as that arm could plausibly be the best, and no more.
 */
export function thompson<T extends string>(arms: Record<T, Posterior>, rng: Rng = Math.random): { arm: T; draws: Record<T, number> } {
  const draws = {} as Record<T, number>;
  let best: T | null = null;
  for (const k of Object.keys(arms) as T[]) {
    draws[k] = sampleBeta(arms[k].alpha, arms[k].beta, rng);
    if (best === null || draws[k] > draws[best]) best = k;
  }
  return { arm: best as T, draws };
}

/** Monte Carlo estimate of the probability that each arm is the best one. */
export function probabilityBest<T extends string>(arms: Record<T, Posterior>, samples = 4000, rng: Rng = Math.random): Record<T, number> {
  const wins = Object.fromEntries(Object.keys(arms).map((k) => [k, 0])) as Record<T, number>;
  for (let i = 0; i < samples; i++) wins[thompson(arms, rng).arm]++;
  for (const k of Object.keys(wins) as T[]) wins[k] /= samples;
  return wins;
}

/* ---------------- How much a person changed a draft ---------------- */

const tokens = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/**
 * Word-level edit distance divided by the longer text's length: 0 means sent exactly as drafted,
 * 1 means rewritten. Trailing signatures and whitespace do not count.
 */
export function editRatio(original: string, final: string, signature = ""): number {
  const strip = (s: string) => (signature.trim() && s.trimEnd().endsWith(signature.trim()) ? s.trimEnd().slice(0, -signature.trim().length) : s);
  const a = tokens(strip(original)), b = tokens(strip(final));
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

/** Similarity of two short texts by shared content words, used to merge near-duplicate lessons. */
export function jaccard(x: string, y: string): number {
  const w = (s: string) => new Set(tokens(s).map((t) => t.replace(/[^a-z0-9$%]/g, "")).filter((t) => t.length > 2));
  const a = w(x), b = w(y);
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
