/**
 * QF2: multiple-testing corrections. Scanning many signals at 5% finds 5% of them by chance; these keep the
 * error rate stated. Each returns adjusted p-values in the input order (capped at 1). Pure.
 */

const order = (p: number[]) => p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);

/** Bonferroni: p·m. Controls the family-wise error rate under any dependence. */
export const bonferroni = (p: number[]) => p.map((v) => Math.min(1, v * p.length));

/** Holm's step-down: controls the family-wise error rate, uniformly more powerful than Bonferroni. */
export function holm(p: number[]): number[] {
  const m = p.length, out = new Array<number>(m);
  let running = 0;
  order(p).forEach(([v, i], k) => { running = Math.max(running, Math.min(1, (m - k) * v)); out[i] = running; });
  return out;
}

/** Benjamini-Hochberg adjusted p-values (step-up), controlling the false discovery rate under independence or positive dependence. */
export function bhAdjust(p: number[]): number[] {
  const m = p.length, o = order(p), out = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) { const [v, i] = o[k]; running = Math.min(running, (v * m) / (k + 1)); out[i] = Math.min(1, running); }
  return out;
}

/** Benjamini-Hochberg-Yekutieli: BH times c(m) = Σ 1/i, valid under any dependence. */
export function bhy(p: number[]): number[] {
  const c = p.reduce((s, _, i) => s + 1 / (i + 1), 0);
  return bhAdjust(p).map((v) => Math.min(1, v * c));
}

/**
 * Benjamini-Hochberg at level q: which hypotheses are rejected (discoveries), in input order, and how many.
 * Rejects the k smallest p-values, k the largest index with p(k) <= k/m·q.
 */
export function bh(p: number[], q = 0.1): { reject: boolean[]; count: number; threshold: number } {
  const m = p.length, o = order(p);
  let k = 0;
  o.forEach(([v], j) => { if (v <= ((j + 1) / m) * q) k = j + 1; });
  const reject = new Array<boolean>(m).fill(false);
  for (let j = 0; j < k; j++) reject[o[j][1]] = true;
  return { reject, count: k, threshold: k ? o[k - 1][0] : 0 };
}
