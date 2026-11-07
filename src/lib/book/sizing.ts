/**
 * Does the book's sizing match its conviction? A fund that puts the most capital behind the theses it is least
 * sure of is taking risk it does not mean to. From each open position's weight and forecast (the chance no
 * kill criterion fails), this gives the rank correlation between the two and plain notes where they disagree.
 * Pure; tested in scripts/test-book.ts; shown under the Book's exposure strip.
 */
export type SizingRow = { ticker: string; weight: number | null; p: number | null };
export type Sizing = { n: number; corr: number | null; notes: string[] };

/** Ranks with ties averaged (1 is the smallest). */
const ranks = (xs: number[]) => {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  for (let k = 0; k < order.length;) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    for (let m = k; m <= j; m++) out[order[m].i] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return out;
};

/** Spearman's rank correlation, or null when either side has no spread. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ra = ranks(a), rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? Math.round((num / Math.sqrt(da * db)) * 100) / 100 : null;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function sizingCheck(rows: SizingRow[]): Sizing | null {
  const xs = rows.filter((r): r is { ticker: string; weight: number; p: number } => r.weight !== null && r.weight > 0 && r.p !== null);
  if (xs.length < 2) return null;
  const corr = spearman(xs.map((x) => x.weight), xs.map((x) => x.p));
  const notes: string[] = [];
  const maxW = Math.max(...xs.map((x) => x.weight)), minP = Math.min(...xs.map((x) => x.p));
  const biggest = xs.filter((x) => x.weight === maxW);
  if (xs.length >= 3 && biggest.length === 1 && biggest[0].p === minP && xs.filter((x) => x.p === minP).length === 1) {
    notes.push(`Your largest position, ${biggest[0].ticker} at ${biggest[0].weight}% of NAV, carries your lowest conviction (${pct(biggest[0].p)}).`);
  }
  const sorted = [...xs.map((x) => x.weight)].sort((a, b) => a - b);
  const medianW = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  for (const x of xs) {
    if (x.p < 0.5 && x.weight >= medianW && !notes.some((n) => n.includes(` ${x.ticker} `))) notes.push(`${x.ticker} is ${x.weight}% of NAV at ${pct(x.p)} conviction: sized at or above the median on a thesis you think more likely to break than not.`);
  }
  if (corr !== null && corr <= 0) notes.push(`Across ${xs.length} positions with a forecast, bigger positions do not carry higher conviction (rank correlation ${corr.toFixed(2)}).`);
  return { n: xs.length, corr, notes: notes.slice(0, 4) };
}
