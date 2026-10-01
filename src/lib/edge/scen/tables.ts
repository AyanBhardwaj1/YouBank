/**
 * Synthetic tables and filled gaps.
 * - The default synthetic copy, sequential trees (synthpop-style CART): each column modelled by a
 *   regression or classification tree on the columns before it, each value drawn from the real values in
 *   its leaf (leaves of at least five rows; numbers smoothed by a small kernel).
 * - A quick statistical preview (a Gaussian copula): each numeric column keeps its own distribution,
 *   the columns keep their rank correlations, and each synthetic row takes its categories from a near
 *   real row.
 * - A deep generative copy (CTGAN, the repository's own code) on the ML service, for comparison.
 * - Privacy checks against a 20% holdout: distance to the closest record, nearest-neighbour distance
 *   ratio, exact copies, and a membership-inference attack's AUC.
 * - Gap filling: each missing cell estimated from the most similar complete rows, with a range, and
 *   marked as an estimate.
 * Columns that identify rows (names, IDs) are replaced, never copied. Every synthetic table carries its
 * recipe and seed, and a realism check against the original. Pure, except the CTGAN call.
 */
import { mlRun, mlReady } from "../infra/ml";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { cholesky, correlation, mean, normals, normCdf, normInv, quantileSorted, realism, rng, std, type Realism } from "./stats";

export type Col = { name: string; type: "num" | "cat" | "text" };
export type Cell = string | number | null;
export type TableIn = { columns: Col[]; rows: Cell[][]; title?: string; synthetic?: { recipe: string; seed: number; realism?: number } };

const isNum = (v: Cell): v is number => typeof v === "number" && Number.isFinite(v);
const missing = (v: Cell) => v === null || v === "" || (typeof v === "number" && !Number.isFinite(v));

/** Columns whose values are nearly all distinct text (names, IDs): identifiers, never copied into synthetic rows. Pure. */
export function identifiers(t: TableIn): Set<number> {
  const out = new Set<number>();
  t.columns.forEach((c, j) => {
    if (c.type === "num") return;
    const vals = t.rows.map((r) => r[j]).filter((v) => !missing(v));
    if (vals.length >= 10 && new Set(vals.map(String)).size >= 0.8 * vals.length) out.add(j);
  });
  return out;
}

/** A synthetic copy by Gaussian copula. Pure. */
export function copulaSynth(t: TableIn, n: number, seed: number): TableIn {
  const u = rng(seed), z = normals(u);
  const numCols = t.columns.map((c, j) => (c.type === "num" ? j : -1)).filter((j) => j >= 0);
  const ids = identifiers(t);
  const complete = t.rows.filter((r) => numCols.every((j) => isNum(r[j])));
  const sorted = numCols.map((j) => t.rows.map((r) => r[j]).filter(isNum).sort((a, b) => a - b));
  // Normal scores of the complete rows (ranks through the inverse normal), and their correlation.
  const scores = complete.map((r) => numCols.map((j, k) => { const s = sorted[k]; let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < (r[j] as number)) lo = m + 1; else hi = m; } return normInv((lo + 0.5) / s.length); }));
  const L = numCols.length > 1 && scores.length > 3 ? cholesky(correlation(scores)) : numCols.map((_, i) => numCols.map((__, k) => (i === k ? 1 : 0)));
  const rows: Cell[][] = [];
  for (let i = 0; i < n; i++) {
    const e = numCols.map(() => z());
    const x = L.map((row) => row.reduce((s, l, k) => s + l * e[k], 0));
    const row: Cell[] = new Array(t.columns.length).fill(null);
    numCols.forEach((j, k) => { row[j] = sorted[k].length ? quantileSorted(sorted[k], normCdf(x[k])) : null; if (isNum(row[j]) && Number.isInteger(t.rows.find((r) => isNum(r[j]))?.[j])) row[j] = Math.round(row[j] as number); });
    // Categories from a real row that sits nearby in normal-score space (one of the five nearest, at random).
    if (t.columns.some((c, j) => c.type !== "num" && !ids.has(j))) {
      const near = scores.map((s, r) => ({ r, d: s.reduce((a, v, k) => a + (v - x[k]) ** 2, 0) })).sort((a, b) => a.d - b.d).slice(0, 5);
      const src = complete.length ? complete[near[Math.floor(u() * near.length)]?.r ?? Math.floor(u() * complete.length)] : t.rows[Math.floor(u() * t.rows.length)];
      t.columns.forEach((c, j) => { if (c.type !== "num" && !ids.has(j)) row[j] = src?.[j] ?? null; });
    }
    t.columns.forEach((c, j) => { if (ids.has(j)) row[j] = `Synthetic ${String(i + 1).padStart(4, "0")}`; });
    rows.push(row);
  }
  return { columns: t.columns, rows, title: `${t.title ?? "Table"} (synthetic)`, synthetic: { recipe: `Gaussian copula: each numeric column's own distribution with the columns' rank correlations kept; categories from nearby real rows; identifying columns (${[...ids].map((j) => t.columns[j].name).join(", ") || "none"}) replaced.`, seed } };
}

/** The table's rows shuffled by a seed and split: the last `share` held out (never seen by a generator) to check privacy. Pure. */
export function splitHoldout(t: TableIn, share: number, seed: number): { train: TableIn; holdout: TableIn } {
  const u = rng(seed + 31), order = t.rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const cut = order.length - Math.round(order.length * share);
  return { train: { ...t, rows: order.slice(0, cut).map((i) => t.rows[i]) }, holdout: { ...t, rows: order.slice(cut).map((i) => t.rows[i]) } };
}

type Tree = { leaf: number[] } | { col: number; cut: number; set: Set<string> | null; nanLeft: boolean; l: Tree; r: Tree };
const NA = "∅";
const keyOf = (v: Cell) => (missing(v) ? NA : String(v));

/**
 * One column's tree on the columns before it (CART: regression trees by squared error, classification
 * trees by Gini impurity; categorical predictors split by ordering their categories; missing predictor
 * values sent to whichever side fits better). Leaves keep their training rows, at least `minLeaf` each.
 */
function growTree(rows: Cell[][], idx: number[], target: number, preds: number[], numeric: boolean[], minLeaf: number, sorted: Map<number, number[]>): Tree {
  const n = rows.length, inNode = new Uint8Array(n);
  const y = rows.map((r) => r[target]), ynum = numeric[target] ? y.map((v) => (isNum(v) ? v : NaN)) : [];
  const classes = numeric[target] ? new Map<string, number>() : new Map([...new Set(y.map(keyOf))].map((k, i) => [k, i]));
  const cls = numeric[target] ? [] : y.map((v) => classes.get(keyOf(v))!);
  const K = classes.size;
  // A node's impurity: squared error about the mean (numbers, missing targets aside), or n·Gini (categories, missing a class of its own).
  const impurity = (ids: number[]) => {
    if (numeric[target]) { let c = 0, s1 = 0, s2 = 0; for (const i of ids) { const v = ynum[i]; if (v === v) { c++; s1 += v; s2 += v * v; } } return c ? s2 - (s1 * s1) / c : 0; }
    const cnt = new Float64Array(K); for (const i of ids) cnt[cls[i]]++; let sq = 0; for (const c of cnt) sq += c * c; return ids.length ? ids.length - sq / ids.length : 0;
  };
  const root = impurity(idx);
  const grow = (ids: number[], depth: number): Tree => {
    const here = impurity(ids);
    if (ids.length < 2 * minLeaf || depth >= 20 || here <= 1e-12 * Math.max(1, root)) return { leaf: ids };
    for (const i of ids) inNode[i] = 1;
    let best = { gain: 1e-6 * root, col: -1, cut: 0, set: null as Set<string> | null, nanLeft: false };
    for (const c of preds) {
      // The node's rows in the predictor's order (numbers: the column sorted once; categories: by each category's mean target or majority-class share here).
      let order: number[], boundary: (a: number, b: number) => boolean, nan: number[] = [];
      let groups: string[] = [];
      if (numeric[c]) {
        order = sorted.get(c)!.filter((i) => inNode[i]); nan = ids.filter((i) => !isNum(rows[i][c]));
        boundary = (a, b) => (rows[a][c] as number) !== (rows[b][c] as number);
      } else {
        const by = new Map<string, number[]>();
        for (const i of ids) { const k = keyOf(rows[i][c]); let g = by.get(k); if (!g) by.set(k, (g = [])); g.push(i); }
        if (by.size < 2) continue;
        const major = numeric[target] ? 0 : (() => { const cnt = new Float64Array(K); for (const i of ids) cnt[cls[i]]++; return cnt.indexOf(Math.max(...cnt)); })();
        const score = (g: number[]) => { if (numeric[target]) { let c2 = 0, s1 = 0; for (const i of g) { const v = ynum[i]; if (v === v) { c2++; s1 += v; } } return c2 ? s1 / c2 : 0; } return g.filter((i) => cls[i] === major).length / g.length; };
        groups = [...by.keys()].sort((a, b) => score(by.get(a)!) - score(by.get(b)!));
        order = groups.flatMap((k) => by.get(k)!);
        boundary = (a, b) => keyOf(rows[a][c]) !== keyOf(rows[b][c]);
      }
      // Sweep left to right keeping running sums, so each cut costs O(1); missing predictor values try both sides.
      const m = order.length, tot = { c: 0, s1: 0, s2: 0, cnt: new Float64Array(K), sq: 0 }, miss = { c: 0, s1: 0, s2: 0, cnt: new Float64Array(K), sq: 0 };
      const add = (acc: typeof tot, i: number, sign: number) => {
        if (numeric[target]) { const v = ynum[i]; if (v === v) { acc.c += sign; acc.s1 += sign * v; acc.s2 += sign * v * v; } }
        else { const k = cls[i]; acc.sq += sign > 0 ? 2 * acc.cnt[k] + 1 : -2 * acc.cnt[k] + 1; acc.cnt[k] += sign; acc.c += sign; }
      };
      for (const i of order) add(tot, i, 1);
      for (const i of nan) add(miss, i, 1);
      const left = { c: 0, s1: 0, s2: 0, cnt: new Float64Array(K), sq: 0 }, right = { ...tot, cnt: Float64Array.from(tot.cnt) };
      let crossL = 0, crossR = 0;
      if (!numeric[target]) for (let k = 0; k < K; k++) crossR += right.cnt[k] * miss.cnt[k];
      const imp = (a: typeof tot, withMiss: boolean, cross: number) => {
        if (numeric[target]) { const c2 = a.c + (withMiss ? miss.c : 0), s1 = a.s1 + (withMiss ? miss.s1 : 0), s2 = a.s2 + (withMiss ? miss.s2 : 0); return c2 ? s2 - (s1 * s1) / c2 : 0; }
        const c2 = a.c + (withMiss ? miss.c : 0), sq = a.sq + (withMiss ? 2 * cross + miss.sq : 0); return c2 ? c2 - sq / c2 : 0;
      };
      for (let p = 0; p < m - 1; p++) {
        const i = order[p];
        add(left, i, 1); add(right, i, -1);
        if (!numeric[target]) { crossL += miss.cnt[cls[i]]; crossR -= miss.cnt[cls[i]]; }
        if (!boundary(order[p], order[p + 1])) continue;
        for (const nanLeft of nan.length ? [true, false] : [false]) {
          const nl = p + 1 + (nanLeft ? nan.length : 0), nr = m - p - 1 + (nanLeft ? 0 : nan.length);
          if (nl < minLeaf || nr < minLeaf) continue;
          const gain = here - imp(left, nanLeft, crossL) - imp(right, !nanLeft, crossR);
          if (gain > best.gain) best = { gain, col: c, cut: numeric[c] ? ((rows[order[p]][c] as number) + (rows[order[p + 1]][c] as number)) / 2 : 0, set: numeric[c] ? null : new Set(groups.slice(0, groups.indexOf(keyOf(rows[order[p]][c])) + 1)), nanLeft };
        }
      }
    }
    for (const i of ids) inNode[i] = 0;
    if (best.col < 0) return { leaf: ids };
    const goesLeft = (i: number) => { const v = rows[i][best.col]; return best.set ? best.set.has(keyOf(v)) : isNum(v) ? v <= best.cut : best.nanLeft; };
    const l = ids.filter(goesLeft), r = ids.filter((i) => !goesLeft(i));
    return { col: best.col, cut: best.cut, set: best.set, nanLeft: best.nanLeft, l: grow(l, depth + 1), r: grow(r, depth + 1) };
  };
  return grow(idx, 0);
}

/** The leaf a (synthetic) row falls in. */
function leafOf(t: Tree, row: Cell[]): number[] {
  let node = t;
  while (!("leaf" in node)) { const v = row[node.col]; node = (node.set ? node.set.has(keyOf(v)) : isNum(v) ? v <= node.cut : node.nanLeft) ? node.l : node.r; }
  return node.leaf;
}

/**
 * A synthetic copy by sequential trees (synthpop's CART method): the first column drawn from its own
 * values, each later column from the real values in the leaf its tree puts the synthetic row in. Numbers
 * get a little kernel noise (Silverman's bandwidth within the leaf, shrunk toward the leaf's mean so its
 * spread is kept), inside the column's range and rounded when the column is whole numbers, so values are
 * not copied verbatim; common values (a point mass such as zero) stay exact. Pure.
 */
export function cartSynth(t: TableIn, n: number, seed: number, minLeaf = 5): TableIn {
  const u = rng(seed), z = normals(u), ids = identifiers(t);
  const rows = t.rows.length > 5000 ? Array.from({ length: 5000 }, (_, i) => t.rows[Math.floor((i * t.rows.length) / 5000)]) : t.rows;
  const numeric = t.columns.map((c) => c.type === "num");
  const visit = t.columns.map((_, j) => j).filter((j) => !ids.has(j));
  const sorted = new Map(visit.filter((j) => numeric[j]).map((j) => [j, rows.map((_, i) => i).filter((i) => isNum(rows[i][j])).sort((a, b) => (rows[a][j] as number) - (rows[b][j] as number))]));
  // Each numeric column's range, whether it is whole numbers, and its common values (a point mass like zero, kept exact: it identifies no one).
  const range = new Map(visit.filter((j) => numeric[j]).map((j) => {
    const v = rows.map((r) => r[j]).filter(isNum), freq = new Map<number, number>();
    for (const x of v) freq.set(x, (freq.get(x) ?? 0) + 1);
    return [j, { lo: Math.min(...v), hi: Math.max(...v), whole: v.every(Number.isInteger), common: new Set([...freq].filter(([, c]) => c >= Math.max(10, 0.02 * v.length)).map(([x]) => x)) }];
  }));
  const all = rows.map((_, i) => i);
  const trees = visit.map((j, k) => (k === 0 ? null : growTree(rows, all, j, visit.slice(0, k), numeric, minLeaf, sorted)));
  // Silverman's smoothed bootstrap within the leaf, shrunk back toward the leaf's mean so its mean and variance stay as they were.
  const kernel = new Map<number[], { h: number; m: number; s: number }>();
  const smooth = (leaf: number[], j: number, v: Cell): Cell => {
    const r = range.get(j)!;
    if (!isNum(v) || r.common.has(v)) return v;
    let k = kernel.get(leaf);
    if (!k) { const xs = leaf.map((i) => rows[i][j]).filter(isNum).sort((a, b) => a - b), sd = std(xs), iqr = (quantileSorted(xs, 0.75) - quantileSorted(xs, 0.25)) / 1.34; k = { h: xs.length > 1 ? 0.9 * Math.min(sd, iqr > 0 ? iqr : sd) * Math.pow(xs.length, -0.2) : 0, m: mean(xs), s: sd }; kernel.set(leaf, k); }
    if (!(k.h > 0 && k.s > 0)) return v;
    const x = Math.max(r.lo, Math.min(r.hi, k.m + (v - k.m + k.h * z()) / Math.sqrt(1 + (k.h * k.h) / (k.s * k.s))));
    return r.whole ? Math.round(x) : x;
  };
  const out: Cell[][] = [];
  for (let s = 0; s < n; s++) {
    const row: Cell[] = new Array(t.columns.length).fill(null);
    visit.forEach((j, k) => { const leaf = k === 0 ? all : leafOf(trees[k]!, row); const src = leaf[Math.floor(u() * leaf.length)]; row[j] = numeric[j] ? smooth(leaf, j, rows[src][j]) : rows[src][j]; });
    for (const j of ids) row[j] = `Synthetic ${String(s + 1).padStart(4, "0")}`;
    out.push(row);
  }
  return { columns: t.columns, rows: out, title: `${t.title ?? "Table"} (synthetic)`, synthetic: { recipe: `Sequential trees (synthpop-style CART): each column modelled by a regression or classification tree on the columns before it (leaves of at least ${minLeaf} real rows), each synthetic value drawn from the real values in its leaf, numbers with a little kernel noise that keeps the leaf's mean and spread (common values such as zero kept exact)${rows.length < t.rows.length ? ` (trees grown on ${rows.length.toLocaleString("en-US")} evenly spaced rows)` : ""}; identifying columns (${[...ids].map((j) => t.columns[j].name).join(", ") || "none"}) replaced.`, seed } };
}

export type Privacy = {
  train: number; holdout: number; compared: number;
  dcrShare: number; nndr: { synthetic: number; holdout: number }; exact: { synthetic: number; holdout: number }; mia: number;
  warnings: string[];
};

/**
 * Privacy against a holdout the generator never saw (Gower distance over the columns that are not
 * identifiers: numbers by range, categories by match, missing by missing):
 * - DCR share: how often a synthetic row is closer to a training row than to a holdout row, the training
 *   side cut to the holdout's size (about 50% means it learned the population, not the rows);
 * - NNDR: nearest over second-nearest training row, median (near 0 means rows sit on single real records),
 *   beside the holdout's own;
 * - exact copies of training rows, beside the holdout's own rate;
 * - a membership-inference attack: guess whether a row was trained on from its distance to the nearest
 *   synthetic row; AUC 0.5 is guessing. Pure.
 */
export function privacyChecks(train: TableIn, holdout: TableIn, synth: TableIn, seed: number, cap = 1000): Privacy {
  const u = rng(seed + 77), ids = identifiers(train);
  const cols = train.columns.map((c, j) => ({ c, j })).filter(({ j }) => !ids.has(j));
  const span = new Map(cols.filter(({ c }) => c.type === "num").map(({ j }) => { const v = [...train.rows, ...holdout.rows].map((r) => r[j]).filter(isNum); return [j, Math.max(...v) - Math.min(...v) || 1]; }));
  const enc = (r: Cell[]) => cols.map(({ c, j }) => (missing(r[j]) ? NaN : c.type === "num" ? (isNum(r[j]) ? (r[j] as number) / span.get(j)! : NaN) : String(r[j])));
  const pick = <T,>(xs: T[], k: number) => { if (xs.length <= k) return xs; const a = [...xs]; for (let i = 0; i < k; i++) { const j = i + Math.floor(u() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
  // Copies and near-copies are looked for among all training rows (up to 5,000); the DCR share compares equal-sized training and holdout sets.
  const H = pick(holdout.rows, cap).map(enc), T = pick(train.rows, Math.max(H.length, Math.min(5000, train.rows.length))).map(enc), Tsame = T.slice(0, H.length), S = pick(synth.rows, cap).map(enc);
  const gower = (a: (number | string)[], b: (number | string)[]) => { let d = 0; for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; if (typeof x === "number" && typeof y === "number") d += x !== x || y !== y ? (x !== x && y !== y ? 0 : 1) : Math.min(1, Math.abs(x - y)); else d += x === y ? 0 : 1; } return d / Math.max(1, a.length); };
  const nearest2 = (a: (number | string)[], set: (number | string)[][]) => { let d1 = Infinity, d2 = Infinity; for (const b of set) { const d = gower(a, b); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return [d1, d2]; };
  const median = (xs: number[]) => quantileSorted([...xs].sort((a, b) => a - b), 0.5);
  let closer = 0, exactS = 0;
  const nndrS: number[] = [];
  for (const a of S) { const [dt] = nearest2(a, Tsame), [dh] = nearest2(a, H); closer += dt < dh ? 1 : dt === dh ? 0.5 : 0; const [t1, t2] = nearest2(a, T); if (t1 === 0) exactS++; nndrS.push(t2 > 0 ? t1 / t2 : 1); }
  let exactH = 0;
  const nndrH = H.map((a) => { const [t1, t2] = nearest2(a, T); if (t1 === 0) exactH++; return t2 > 0 ? t1 / t2 : 1; });
  // Membership inference: training rows (members) against holdout rows, scored by closeness to the synthetic rows.
  const score = (a: (number | string)[]) => -nearest2(a, S)[0];
  const mem = Tsame.map(score), non = H.map(score);
  let wins = 0;
  for (const m of mem) for (const x of non) wins += m > x ? 1 : m === x ? 0.5 : 0;
  const mia = mem.length && non.length ? wins / (mem.length * non.length) : 0.5;
  const dcrShare = S.length ? closer / S.length : 0.5, p: Privacy = { train: train.rows.length, holdout: holdout.rows.length, compared: S.length, dcrShare, nndr: { synthetic: median(nndrS), holdout: median(nndrH) }, exact: { synthetic: S.length ? exactS / S.length : 0, holdout: H.length ? exactH / H.length : 0 }, mia, warnings: [] };
  if (dcrShare > 0.6) p.warnings.push(`${Math.round(dcrShare * 100)}% of synthetic rows sit closer to a training row than to any held-out row (about 50% is ideal): the copy leans on the rows it learned from.`);
  if (p.exact.synthetic > p.exact.holdout + 0.01) p.warnings.push(`${(p.exact.synthetic * 100).toFixed(1)}% of synthetic rows copy a training row exactly (held-out rows: ${(p.exact.holdout * 100).toFixed(1)}%).`);
  if (p.nndr.synthetic < 0.7 * p.nndr.holdout) p.warnings.push(`Synthetic rows sit unusually close to single real rows (nearest-neighbour ratio ${p.nndr.synthetic.toFixed(2)} against the holdout's ${p.nndr.holdout.toFixed(2)}).`);
  if (mia > 0.6) p.warnings.push(`A membership-inference attack tells training rows from held-out ones better than chance (AUC ${mia.toFixed(2)}).`);
  return p;
}

/** How close a synthetic table is to the real one: numeric columns by moments and distance, categories by total variation. Pure. */
export function tableRealism(real: TableIn, synth: TableIn): Realism {
  const numCols = real.columns.map((c, j) => (c.type === "num" ? j : -1)).filter((j) => j >= 0);
  const r = realism(numCols.map((j) => real.columns[j].name), real.rows.filter((row) => numCols.every((j) => isNum(row[j]))).map((row) => numCols.map((j) => row[j] as number)), synth.rows.filter((row) => numCols.every((j) => isNum(row[j]))).map((row) => numCols.map((j) => row[j] as number)));
  const ids = identifiers(real);
  let tvSum = 0, cats = 0;
  real.columns.forEach((c, j) => {
    if (c.type === "num" || ids.has(j)) return;
    const freq = (rows: Cell[][]) => { const m = new Map<string, number>(); for (const row of rows) m.set(String(row[j]), (m.get(String(row[j])) ?? 0) + 1 / rows.length); return m; };
    const a = freq(real.rows), b = freq(synth.rows);
    const tv = 0.5 * [...new Set([...a.keys(), ...b.keys()])].reduce((s, k) => s + Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)), 0);
    tvSum += tv; cats++;
    if (tv > 0.15) r.warnings.push(`${c.name}: category shares differ by ${Math.round(tv * 100)}%.`);
  });
  if (cats) r.score = Math.max(0, Math.round(r.score - (tvSum / cats) * 60));
  return r;
}

export type Filled = { row: number; col: number; value: Cell; low: number | null; high: number | null; from: number };

/**
 * Fill missing cells from the most similar rows (distance over the numeric columns both have, in
 * standard units): a number becomes the neighbours' weighted mean with their range, a category their
 * most common value. Pure.
 */
export function fillGaps(t: TableIn, k = 5): { table: TableIn; filled: Filled[] } {
  const numCols = t.columns.map((c, j) => (c.type === "num" ? j : -1)).filter((j) => j >= 0);
  // Neighbours are looked for among at most 2,000 rows spread through the table, so a big table fills in seconds, not minutes.
  const stride = Math.max(1, Math.ceil(t.rows.length / 2000)), pool = t.rows.map((_, o) => o).filter((o) => o % stride === 0);
  const stats = new Map(numCols.map((j) => { const v = t.rows.map((r) => r[j]).filter(isNum); return [j, { m: mean(v), s: std(v) || 1 }]; }));
  const rows = t.rows.map((r) => r.slice());
  const filled: Filled[] = [];
  t.rows.forEach((row, i) => {
    t.columns.forEach((c, j) => {
      if (!missing(row[j]) || c.type === "text") return;
      const cands = pool.map((o) => {
        const other = t.rows[o];
        if (o === i || missing(other[j])) return null;
        let d = 0, shared = 0;
        for (const q of numCols) if (q !== j && isNum(row[q]) && isNum(other[q])) { const st = stats.get(q)!; d += ((row[q] - other[q]) / st.s) ** 2; shared++; }
        for (let q = 0; q < t.columns.length; q++) if (q !== j && t.columns[q].type === "cat" && !missing(row[q]) && !missing(other[q])) { d += row[q] === other[q] ? 0 : 1; shared++; }
        return shared ? { o, d: Math.sqrt(d / shared) } : { o, d: 10 };
      }).filter((x): x is { o: number; d: number } => !!x).sort((a, b) => a.d - b.d).slice(0, k);
      if (!cands.length) return;
      if (c.type === "num") {
        const vals = cands.map((x) => t.rows[x.o][j] as number), w = cands.map((x) => 1 / (0.1 + x.d));
        const est = vals.reduce((s, v, q) => s + v * w[q], 0) / w.reduce((a, b) => a + b, 0);
        rows[i][j] = est;
        filled.push({ row: i, col: j, value: est, low: Math.min(...vals), high: Math.max(...vals), from: cands.length });
      } else {
        const count = new Map<string, number>();
        for (const x of cands) count.set(String(t.rows[x.o][j]), (count.get(String(t.rows[x.o][j])) ?? 0) + 1);
        const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
        rows[i][j] = best;
        filled.push({ row: i, col: j, value: best, low: null, high: null, from: cands.length });
      }
    });
  });
  return { table: { columns: t.columns, rows, title: `${t.title ?? "Table"} (gaps filled)`, synthetic: { recipe: `${filled.length} missing cells estimated from the ${k} most similar rows (numeric columns in standard units, categories matched): numbers as their weighted mean with the neighbours' range, categories as their most common value. Estimates, not data.`, seed: 0 } }, filled };
}

/** Why a table is too wide to copy or fill (the trees grow with every earlier column, so past about 40 columns a copy takes minutes), or null. Pure. */
export function tableTooWide(t: { columns: unknown[] }, maxColumns = 40): string | null {
  return t.columns.length > maxColumns ? `This table has ${t.columns.length} columns; Scenarios copies and fills tables of up to ${maxColumns}. Keep the columns that matter and try again.` : null;
}

/** A synthetic copy by CTGAN on the ML service; falls back to the copula when the service is not set up. */
export async function ctganSynth(t: TableIn, n: number, seed: number): Promise<TableIn> {
  if (!mlReady() || !r2Ready()) return copulaSynth(t, n, seed);
  const ids = identifiers(t);
  const cols = t.columns.map((c, j) => ({ c, j })).filter(({ c, j }) => !ids.has(j) && c.type !== "text");
  const key = `scen/tables/${seed}-${Date.now()}.json`;
  await putJson(key, { rows: t.rows.map((r) => Object.fromEntries(cols.map(({ c, j }) => [c.name, r[j]]))) });
  const res = await mlRun<{ key: string; epochsRun?: number }>("synth.tabular", { dataKey: key, columns: cols.map(({ c }) => ({ name: c.name, type: c.type === "num" ? "num" : "cat" })), n, seed, epochs: 300 }, 240_000);
  const out = await getJson<{ rows: Record<string, Cell>[]; recipe?: string }>(res.key);
  const rows = (out?.rows ?? []).map((r, i) => t.columns.map((c, j) => (ids.has(j) ? `Synthetic ${String(i + 1).padStart(4, "0")}` : c.type === "text" ? null : r[c.name] ?? null)));
  return { columns: t.columns, rows, title: `${t.title ?? "Table"} (synthetic)`, synthetic: { recipe: `CTGAN on the ML service (mode-specific normalisation, a conditional generator and a WGAN-GP critic${res.epochsRun ? `, ${res.epochsRun} epochs` : ""}); identifying columns replaced.`, seed } };
}

/** Numeric summaries for a quick side-by-side (real against synthetic). Pure. */
export function columnSummary(t: TableIn, j: number): { mean: number; std: number; min: number; max: number } | null {
  const v = t.rows.map((r) => r[j]).filter(isNum);
  return v.length ? { mean: mean(v), std: std(v), min: Math.min(...v), max: Math.max(...v) } : null;
}

