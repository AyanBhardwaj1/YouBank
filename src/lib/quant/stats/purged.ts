/**
 * QF2: purged k-fold cross-validation (López de Prado, Advances in Financial Machine Learning, ch. 7). When a
 * label spans time (a 20-day forward return), an observation in the training set whose label window overlaps
 * the test fold leaks the test outcome into training. Purging drops those; an embargo also drops training
 * observations that start just after the test fold, where serial correlation would leak. Pure.
 */

/** One observation's label window, as indices or timestamps (start <= end). */
export type Span = { start: number; end: number };

export type Fold = { train: number[]; test: number[]; purged: number; embargoed: number };

/**
 * k contiguous test folds over observations sorted by start. For each, the training set is every observation
 * whose span does not overlap [min test start, max test end], minus those starting within `embargo` (in the
 * same units as the spans) after the test fold's end.
 */
export function purgedKFold(spans: Span[], k: number, embargo = 0): Fold[] {
  const n = spans.length;
  if (k < 2 || k > n) throw new Error("k must be between 2 and the number of observations");
  const order = spans.map((s, i) => [s, i] as const).sort((a, b) => a[0].start - b[0].start).map(([, i]) => i);
  const folds: Fold[] = [];
  for (let f = 0; f < k; f++) {
    const lo = Math.floor((f * n) / k), hi = Math.floor(((f + 1) * n) / k);
    const test = order.slice(lo, hi);
    const t0 = Math.min(...test.map((i) => spans[i].start)), t1 = Math.max(...test.map((i) => spans[i].end));
    const testSet = new Set(test);
    let purged = 0, embargoed = 0;
    const train: number[] = [];
    for (const i of order) {
      if (testSet.has(i)) continue;
      const s = spans[i];
      if (s.start <= t1 && s.end >= t0) { purged++; continue; }
      if (embargo > 0 && s.start > t1 && s.start <= t1 + embargo) { embargoed++; continue; }
      train.push(i);
    }
    folds.push({ train, test, purged, embargoed });
  }
  return folds;
}

/** Whether any training span overlaps its fold's test window (used by the tests; should always be false). */
export function leaks(spans: Span[], folds: Fold[]): boolean {
  return folds.some((f) => {
    const t0 = Math.min(...f.test.map((i) => spans[i].start)), t1 = Math.max(...f.test.map((i) => spans[i].end));
    return f.train.some((i) => spans[i].start <= t1 && spans[i].end >= t0);
  });
}
