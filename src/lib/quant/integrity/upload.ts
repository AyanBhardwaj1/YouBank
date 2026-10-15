/**
 * Q3 uploads: a return series (and optionally a matrix of every variant tried) pasted or uploaded as CSV.
 * Accepts "date,return" rows, one return per line, percentages ("0.42%") or decimals, a header row, and a
 * matrix with one column per variant. Pure.
 */
export type ParsedReturns = { dates?: string[]; returns: number[]; matrix?: number[][]; columns?: string[]; percent: boolean; skipped: number };

const toNum = (s: string): number | null => {
  const t = s.trim().replace(/^"|"$/g, "").replace(/,/g, "");
  if (!t) return null;
  const pct = /%$/.test(t);
  const v = Number(t.replace(/%$/, ""));
  return Number.isFinite(v) ? (pct ? v / 100 : v) : null;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s.trim()) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s.trim());
const isoDate = (s: string) => { const t = s.trim(); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); const [m, d, y] = t.split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };

/**
 * Parse CSV text. Columns after an optional date column are variants; the first is the assessed series. Values
 * that all look like percentages (any |v| > 1 without a % sign, in a column of small numbers) are read as
 * percent when `assumePercent` is set; otherwise decimals.
 */
export function parseReturnsCsv(text: string, opts: { assumePercent?: boolean; maxRows?: number; maxColumns?: number } = {}): ParsedReturns {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, (opts.maxRows ?? 20_000) + 1);
  const rows = lines.map((l) => l.split(/[,;\t]/));
  const header = rows[0] && rows[0].slice(1).some((c) => toNum(c) === null) && toNum(rows[0][rows[0].length - 1]) === null ? rows.shift() : undefined;
  const hasDate = rows.length > 0 && rows.every((r) => isDate(r[0] ?? ""));
  const width = Math.min(opts.maxColumns ?? 500, Math.max(0, ...rows.map((r) => r.length - (hasDate ? 1 : 0))));
  const dates: string[] = [], matrix: number[][] = [];
  let skipped = 0;
  for (const r of rows) {
    const cells = (hasDate ? r.slice(1) : r).slice(0, width).map(toNum);
    if (!cells.length || cells.some((c) => c === null)) { skipped++; continue; }
    if (hasDate) dates.push(isoDate(r[0]));
    matrix.push(cells as number[]);
  }
  const percent = !!opts.assumePercent || /%/.test(text);
  const scale = opts.assumePercent && !/%/.test(text) ? 0.01 : 1;
  const M = matrix.map((row) => row.map((v) => v * scale));
  const columns = header ? header.slice(hasDate ? 1 : 0, (hasDate ? 1 : 0) + width).map((h) => h.trim()) : undefined;
  return { dates: hasDate ? dates : undefined, returns: M.map((row) => row[0]), matrix: width > 1 ? M : undefined, columns, percent, skipped };
}
