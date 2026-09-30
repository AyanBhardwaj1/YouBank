/**
 * Synthetic tables and filled gaps.
 * - A statistical synthetic copy (a Gaussian copula): each numeric column keeps its own distribution,
 *   the columns keep their rank correlations, and each synthetic row takes its categories from a near
 *   real row. Columns that identify rows (names, IDs) are replaced, never copied.
 * - A deep generative copy (CTGAN) on the ML service, for tables with complex joint structure.
 * - Gap filling: each missing cell estimated from the most similar complete rows, with a range, and
 *   marked as an estimate.
 * Every synthetic table carries its recipe and seed, and a realism check against the original. Pure,
 * except the CTGAN call.
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
  const stats = new Map(numCols.map((j) => { const v = t.rows.map((r) => r[j]).filter(isNum); return [j, { m: mean(v), s: std(v) || 1 }]; }));
  const rows = t.rows.map((r) => r.slice());
  const filled: Filled[] = [];
  t.rows.forEach((row, i) => {
    t.columns.forEach((c, j) => {
      if (!missing(row[j]) || c.type === "text") return;
      const cands = t.rows.map((other, o) => {
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

