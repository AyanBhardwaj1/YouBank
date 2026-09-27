/** A1-style addresses: columns are letters (A…XFD), rows start at 1. Internally rows and columns are 1-based. */

export const MAX_ROW = 1_048_576;
export const MAX_COL = 16_384;

export function colName(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export type Pos = { r: number; c: number };
export type Rect = { r1: number; c1: number; r2: number; c2: number };

export const addr = (r: number, c: number) => `${colName(c)}${r}`;

export function parseAddr(a: string): Pos | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
  if (!m) return null;
  const r = Number(m[2]), c = colIndex(m[1]);
  return r >= 1 && r <= MAX_ROW && c >= 1 && c <= MAX_COL ? { r, c } : null;
}

/** "B3:D9", "B3", "C:C" or "4:4" as a normalised rectangle. */
export function parseRange(ref: string): Rect | null {
  const t = ref.trim().replace(/\$/g, "");
  const [a, b] = t.split(":");
  if (b === undefined) { const p = parseAddr(a); return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null; }
  if (/^[A-Za-z]{1,3}$/.test(a) && /^[A-Za-z]{1,3}$/.test(b)) {
    const c1 = colIndex(a), c2 = colIndex(b);
    return { r1: 1, c1: Math.min(c1, c2), r2: MAX_ROW, c2: Math.max(c1, c2) };
  }
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const r1 = Number(a), r2 = Number(b);
    return { r1: Math.min(r1, r2), c1: 1, r2: Math.max(r1, r2), c2: MAX_COL };
  }
  const p = parseAddr(a), q = parseAddr(b);
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}

export const rangeName = (x: Rect) => (x.r1 === x.r2 && x.c1 === x.c2 ? addr(x.r1, x.c1) : `${addr(x.r1, x.c1)}:${addr(x.r2, x.c2)}`);

export const contains = (x: Rect, r: number, c: number) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2;

/** Every address in a rectangle, row by row. Callers bound the size. */
export function* cellsIn(x: Rect): Generator<string> {
  for (let r = x.r1; r <= x.r2; r++) for (let c = x.c1; c <= x.c2; c++) yield addr(r, c);
}

/** Sheet names that need quoting in a formula: anything but letters, digits, underscores and dots, or a leading digit. */
export const quoteSheet = (name: string) => (/^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
