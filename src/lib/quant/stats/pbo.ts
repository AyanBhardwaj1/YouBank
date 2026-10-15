/**
 * QF2: the probability of backtest overfitting by combinatorially symmetric cross-validation (CSCV; Bailey,
 * Borwein, López de Prado and Zhu 2017). Pure.
 *
 * The T x N matrix holds every trial's returns (columns) on common dates (rows). It is cut into S equal
 * blocks of rows; for each of the C(S, S/2) ways to pick half the blocks as in-sample (the rest out of
 * sample), the trial with the best in-sample Sharpe ratio is found and its out-of-sample relative rank ω
 * (rank / (N + 1), 1 the worst) gives the logit λ = ln(ω / (1 - ω)). PBO is the share of splits with λ <= 0:
 * how often the in-sample winner is at or below the median out of sample.
 *
 * Also returned: the performance degradation slope (out-of-sample Sharpe regressed on in-sample Sharpe of the
 * chosen trial across splits) and the probability of an out-of-sample loss. Block sums and sums of squares
 * are computed once, so each split costs O(N·S): 12,870 splits on 500 trials take a second or two.
 */

export type Pbo = {
  pbo: number; splits: number; blocks: number; trials: number; rowsUsed: number;
  logits: number[]; slope: number; intercept: number; probOosLoss: number; meanOosRank: number;
};

/** Every k-subset of 0..n-1, in lexicographic order. */
export function* combinations(n: number, k: number): Generator<number[]> {
  const c = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield [...c];
    let i = k - 1;
    while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}

/** Ranks with ties averaged, 1 = smallest. */
function ranks(x: number[]): number[] {
  const o = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < o.length;) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
    for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/**
 * PBO of a matrix `M` (rows = periods, columns = trials). `S` must be even and at least 2; rows beyond a
 * multiple of S are dropped from the start (the oldest), so blocks are equal.
 */
export function pbo(M: number[][], S = 16): Pbo {
  if (S < 2 || S % 2) throw new Error("S must be an even number of blocks, at least 2");
  const N = M[0]?.length ?? 0;
  const per = Math.floor(M.length / S);
  if (N < 2 || per < 2) throw new Error("PBO needs at least two trials and two rows per block");
  const start = M.length - per * S;
  // Block sums, sums of squares and counts per trial.
  const s1 = Array.from({ length: S }, () => new Float64Array(N)), s2 = Array.from({ length: S }, () => new Float64Array(N));
  for (let b = 0; b < S; b++) for (let t = start + b * per; t < start + (b + 1) * per; t++) {
    const row = M[t];
    for (let j = 0; j < N; j++) { const v = row[j]; s1[b][j] += v; s2[b][j] += v * v; }
  }
  const sharpeOf = (blocks: number[], j: number) => {
    let a = 0, q = 0;
    for (const b of blocks) { a += s1[b][j]; q += s2[b][j]; }
    const n = blocks.length * per, m = a / n, v = (q - n * m * m) / (n - 1);
    return v > 0 ? m / Math.sqrt(v) : m > 0 ? Infinity : m < 0 ? -Infinity : 0;
  };
  const logits: number[] = [], isBest: number[] = [], oosOfBest: number[] = [];
  let losses = 0, rankSum = 0;
  const all = Array.from({ length: S }, (_, i) => i);
  for (const train of combinations(S, S / 2)) {
    const inTrain = new Set(train);
    const test = all.filter((b) => !inTrain.has(b));
    let best = -Infinity, star = 0;
    for (let j = 0; j < N; j++) { const v = sharpeOf(train, j); if (v > best) { best = v; star = j; } }
    const oos = Array.from({ length: N }, (_, j) => sharpeOf(test, j));
    const w = ranks(oos)[star] / (N + 1);
    logits.push(Math.log(w / (1 - w)));
    isBest.push(best); oosOfBest.push(oos[star]);
    if (oos[star] < 0) losses++;
    rankSum += w;
  }
  const k = logits.length;
  const finite = isBest.map((x, i) => [x, oosOfBest[i]] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const mx = finite.reduce((s, [x]) => s + x, 0) / Math.max(1, finite.length), my = finite.reduce((s, [, y]) => s + y, 0) / Math.max(1, finite.length);
  let sxy = 0, sxx = 0;
  for (const [x, y] of finite) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return {
    pbo: logits.filter((l) => l <= 0).length / k, splits: k, blocks: S, trials: N, rowsUsed: per * S,
    logits, slope, intercept: my - slope * mx, probOosLoss: losses / k, meanOosRank: rankSum / k,
  };
}

/** The largest even S (at most `max`) that leaves at least `minRows` rows per block; 0 when even S = 2 does not fit. */
export function blocksFor(rows: number, max = 16, minRows = 20): number {
  for (let s = max; s >= 2; s -= 2) if (Math.floor(rows / s) >= minRows) return s;
  return 0;
}
