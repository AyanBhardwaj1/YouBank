/** Calculation values, errors and Excel's coercion rules. */

export class CalcError {
  constructor(readonly code: string, readonly detail?: string) {}
  toString() { return this.code; }
}

export const ERR = {
  div0: new CalcError("#DIV/0!"),
  na: new CalcError("#N/A"),
  name: new CalcError("#NAME?"),
  /** A function YouBank does not implement: an imported file's cached value is shown instead. */
  unsupported: new CalcError("#NAME?", "unsupported function"),
  num: new CalcError("#NUM!"),
  ref: new CalcError("#REF!"),
  value: new CalcError("#VALUE!"),
  cycle: new CalcError("#CYCLE!"),
  syntax: new CalcError("#ERROR!"),
  null: new CalcError("#NULL!"),
};

export function errorFromCode(code: string): CalcError {
  return Object.values(ERR).find((e) => e.code === code && !e.detail) ?? new CalcError(code);
}

export type Prim = number | string | boolean | null | CalcError;
/** A reference to cells, kept lazy so lookups and aggregates can walk it without copying. */
export type RangeVal = { kind: "range"; sheet: string; r1: number; c1: number; r2: number; c2: number };
export type Arr = Prim[][];
export type Val = Prim | RangeVal | Arr;

export const isErr = (v: unknown): v is CalcError => v instanceof CalcError;
export const isRange = (v: unknown): v is RangeVal => typeof v === "object" && v !== null && (v as RangeVal).kind === "range";
export const isArr = (v: unknown): v is Arr => Array.isArray(v);

/** Excel's serial dates: day 0 is 1899-12-30. */
const EPOCH = Date.UTC(1899, 11, 30);
export const DAY_MS = 86_400_000;
export const serialFromDate = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
export const dateFromSerial = (s: number) => new Date(EPOCH + Math.floor(s) * DAY_MS);

/** Round half away from zero, as Excel does, without binary-fraction surprises (1.005 → 1.01). */
export function roundHalfAway(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, digits);
  // 15 significant digits is Excel's precision; it also turns 100.49999999999999 back into 100.5.
  const y = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.round(y)) / f;
}

const NUMERIC_TEXT = /^\s*[-+]?(?:\$\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?\s*%?\s*$/;

/** A number from typed-in text the way Excel reads it: "1,200", "$15", "12%", "1e3". */
export function parseNumberText(s: string): number | null {
  const t = s.trim();
  if (!t || !NUMERIC_TEXT.test(t) || !/\d/.test(t)) return null;
  const pct = t.endsWith("%");
  const n = Number(t.replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

export function toNumber(v: Prim): number {
  if (typeof v === "number") return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isErr(v)) throw v;
  const n = parseNumberText(v);
  if (n === null) throw ERR.value;
  return n;
}

export function toText(v: Prim): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return generalNumber(v);
  if (isErr(v)) throw v;
  return v;
}

export function toBool(v: Prim): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null) return false;
  if (isErr(v)) throw v;
  const u = v.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  throw ERR.value;
}

/** Excel's General format: up to 11 significant characters, scientific beyond. */
export function generalNumber(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (Number.isInteger(n) && abs < 1e11) return String(n);
  if (abs >= 1e11 || abs < 1e-9) {
    const [m, e] = n.toExponential(5).split("e");
    const mant = m.replace(/\.?0+$/, "");
    const exp = Number(e);
    return `${mant}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
  const decimals = Math.max(0, 10 - intDigits);
  return String(Number(roundHalfAway(n, decimals).toFixed(decimals)));
}

/** Comparison with Excel's type order: numbers < text < logicals; text compares case-insensitively. */
export function compare(a: Prim, b: Prim): number {
  if (isErr(a)) throw a;
  if (isErr(b)) throw b;
  const rank = (v: Prim) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : -1);
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return a === b ? 0 : a ? 1 : -1;
}
