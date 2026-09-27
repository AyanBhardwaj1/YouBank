/**
 * The function library: the Excel functions finance models actually use, with Excel's semantics for
 * ranges (text and blanks skipped), direct arguments (coerced), errors (propagated) and lookups.
 */
import type { Node } from "./formula";
import { formatValue } from "./format";
import {
  CalcError, ERR, compare, dateFromSerial, isArr, isErr, isRange, parseNumberText, roundHalfAway, serialFromDate, toBool, toNumber, toText,
  type Arr, type Prim, type RangeVal, type Val,
} from "./values";

export interface FnCtx {
  ev(n: Node): Val;
  /** A range or array as a grid of values; a scalar as a 1×1 grid. */
  grid(v: Val): Arr;
  /** One value from a range, by implicit intersection with the formula's row or column. */
  scalar(v: Val): Prim;
  here: { sheet: string; r: number; c: number };
  markVolatile(): void;
  refFromText(text: string): RangeVal | null;
}

type Fn = (ctx: FnCtx, args: Node[]) => Val;

/* ---------------- Argument helpers ---------------- */

const given = (args: Node[], i: number) => args[i] !== undefined && args[i].k !== "miss";

function prim(ctx: FnCtx, n: Node): Prim {
  if (n.k === "miss") return null;
  const v = ctx.scalar(ctx.ev(n));
  if (isErr(v)) throw v;
  return v;
}
const num = (ctx: FnCtx, n: Node) => toNumber(prim(ctx, n));
const text = (ctx: FnCtx, n: Node) => toText(prim(ctx, n));
const bool = (ctx: FnCtx, n: Node) => toBool(prim(ctx, n));
const optNum = (ctx: FnCtx, args: Node[], i: number, d: number) => (given(args, i) ? num(ctx, args[i]) : d);

const multi = (v: Val) => isRange(v) || isArr(v);

/** Numbers across arguments: ranges contribute their numbers only; direct arguments are coerced. */
function numbers(ctx: FnCtx, args: Node[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a.k === "miss") continue;
    const v = ctx.ev(a);
    if (multi(v)) {
      for (const row of ctx.grid(v)) for (const x of row) { if (isErr(x)) throw x; if (typeof x === "number") out.push(x); }
    } else {
      const p = ctx.scalar(v);
      if (isErr(p)) throw p;
      if (p !== null) out.push(toNumber(p));
    }
  }
  return out;
}

/** Every value across arguments, flattened, errors kept. */
function values(ctx: FnCtx, args: Node[]): Prim[] {
  const out: Prim[] = [];
  for (const a of args) {
    if (a.k === "miss") continue;
    const v = ctx.ev(a);
    if (multi(v)) for (const row of ctx.grid(v)) out.push(...row);
    else out.push(ctx.scalar(v));
  }
  return out;
}

function flat(ctx: FnCtx, n: Node): Prim[] {
  return ctx.grid(ctx.ev(n)).flat();
}

/** A one-dimensional list from a row or column range, and its orientation. */
function vector(ctx: FnCtx, n: Node): Prim[] {
  const g = ctx.grid(ctx.ev(n));
  if (g.length === 1) return g[0];
  return g.map((r) => r[0]);
}

/* ---------------- Criteria (SUMIF and friends) ---------------- */

function wildcard(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

export function criterion(c: Prim): (v: Prim) => boolean {
  if (isErr(c)) return (v) => isErr(v) && v.code === c.code;
  if (typeof c === "number") return (v) => (typeof v === "number" ? v === c : typeof v === "string" ? parseNumberText(v) === c : false);
  if (typeof c === "boolean") return (v) => v === c;
  if (c === null) return (v) => v === null || v === "";
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? "=";
  const rhs = m[2];
  const n = rhs === "" ? null : parseNumberText(rhs);
  if (n !== null) {
    return (v) => {
      const x = typeof v === "number" ? v : typeof v === "string" ? parseNumberText(v) : null;
      if (x === null) return op === "<>";
      switch (op) { case "=": return x === n; case "<>": return x !== n; case "<": return x < n; case "<=": return x <= n; case ">": return x > n; default: return x >= n; }
    };
  }
  const low = rhs.toUpperCase();
  if (low === "TRUE" || low === "FALSE") { const b = low === "TRUE"; return (v) => (op === "<>" ? v !== b : v === b); }
  if (op === "=" || op === "<>") {
    if (rhs === "") return op === "=" ? (v) => v === null || v === "" : (v) => v !== null && v !== "";
    const re = wildcard(rhs);
    return (v) => {
      const hit = typeof v === "string" && re.test(v);
      return op === "=" ? hit : !hit;
    };
  }
  return (v) => {
    if (typeof v !== "string") return false;
    const k = compare(v, rhs);
    return op === "<" ? k < 0 : op === "<=" ? k <= 0 : op === ">" ? k > 0 : k >= 0;
  };
}

/** Positions where every (range, criterion) pair matches. Ranges must have the same shape. */
function matchingCells(ctx: FnCtx, pairs: Node[]): boolean[][] | CalcError {
  let mask: boolean[][] | null = null;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const g = ctx.grid(ctx.ev(pairs[i]));
    const test = criterion(prim(ctx, pairs[i + 1]));
    if (mask && (g.length !== mask.length || g[0]?.length !== mask[0]?.length)) return ERR.value;
    const m = g.map((row) => row.map((v) => test(v)));
    mask = mask ? mask.map((row, r) => row.map((x, c) => x && m[r][c])) : m;
  }
  return mask ?? ERR.value;
}

function aggregateIfs(ctx: FnCtx, target: Node | null, pairs: Node[]): number[] {
  const mask = matchingCells(ctx, pairs);
  if (isErr(mask)) throw mask;
  const g = target ? ctx.grid(ctx.ev(target)) : null;
  const out: number[] = [];
  mask.forEach((row, r) => row.forEach((ok, c) => {
    if (!ok) return;
    const v = g ? g[r]?.[c] ?? null : 1;
    if (isErr(v)) throw v;
    if (typeof v === "number") out.push(v);
  }));
  return out;
}

/* ---------------- Lookup ---------------- */

/** Position of a value in a list (0-based), or -1. type 0 exact, 1 largest ≤, -1 smallest ≥, 2 wildcard. */
export function matchIndex(lookup: Prim, list: Prim[], type: number, fromEnd = false): number {
  if (type === 0 || type === 2) {
    const re = typeof lookup === "string" && (type === 2 || /[*?~]/.test(lookup)) ? wildcard(lookup) : null;
    const idx = [...list.keys()];
    if (fromEnd) idx.reverse();
    for (const i of idx) {
      const v = list[i];
      if (re ? typeof v === "string" && re.test(v) : v !== null && !isErr(v) && typeof v === typeof lookup && compare(v, lookup) === 0) return i;
    }
    return -1;
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || isErr(v) || typeof v !== typeof lookup) continue;
    const k = compare(v, lookup);
    if (type === 1) { if (k <= 0) best = i; else break; }
    else { if (k >= 0) best = i; else break; }
  }
  return best;
}

/** XLOOKUP's match: exact, or the nearest smaller (-1) or larger (1) when there is no exact hit. */
function nearest(lookup: Prim, list: Prim[], mode: number, fromEnd: boolean): number {
  const exact = matchIndex(lookup, list, mode === 2 ? 2 : 0, fromEnd);
  if (exact >= 0 || mode === 0 || mode === 2) return exact;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || isErr(v) || typeof v !== typeof lookup) continue;
    const k = compare(v, lookup);
    if (mode === -1 && k < 0 && (best < 0 || compare(v, list[best]) > 0)) best = i;
    if (mode === 1 && k > 0 && (best < 0 || compare(v, list[best]) < 0)) best = i;
  }
  return best;
}

const refCell = (base: RangeVal, r: number, c: number): RangeVal => ({ kind: "range", sheet: base.sheet, r1: r, c1: c, r2: r, c2: c });

/* ---------------- Maths and statistics ---------------- */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => { if (!xs.length) throw ERR.div0; return sum(xs) / xs.length; };
function variance(xs: number[], sample: boolean) {
  if (xs.length < (sample ? 2 : 1)) throw ERR.div0;
  const m = sum(xs) / xs.length;
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0));
}
function percentile(xs: number[], k: number) {
  if (!xs.length || k < 0 || k > 1) throw ERR.num;
  const s = [...xs].sort((a, b) => a - b);
  const rank = k * (s.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}
function pairs(ctx: FnCtx, a: Node, b: Node): [number[], number[]] {
  const xa = flat(ctx, a), xb = flat(ctx, b);
  if (xa.length !== xb.length) throw ERR.na;
  const x: number[] = [], y: number[] = [];
  xa.forEach((v, i) => { const w = xb[i]; if (isErr(v)) throw v; if (isErr(w)) throw w; if (typeof v === "number" && typeof w === "number") { x.push(v); y.push(w); } });
  return [x, y];
}

/* ---------------- Time value of money ---------------- */

export function pmt(r: number, n: number, pv: number, fv = 0, type = 0) {
  if (n === 0) throw ERR.num;
  if (r === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + r, n);
  return -(r * (fv + pv * f)) / ((1 + r * type) * (f - 1));
}
export function fv(r: number, n: number, p: number, pv = 0, type = 0) {
  if (r === 0) return -(pv + p * n);
  const f = Math.pow(1 + r, n);
  return -(pv * f + (p * (1 + r * type) * (f - 1)) / r);
}
export function pv(r: number, n: number, p: number, fvv = 0, type = 0) {
  if (r === 0) return -(fvv + p * n);
  const f = Math.pow(1 + r, n);
  return -(fvv + (p * (1 + r * type) * (f - 1)) / r) / f;
}
function ipmt(r: number, per: number, n: number, pvv: number, fvv = 0, type = 0) {
  if (per < 1 || per > n) throw ERR.num;
  const p = pmt(r, n, pvv, fvv, type);
  let ip: number;
  if (per === 1) ip = type === 1 ? 0 : -pvv;
  else ip = type === 1 ? fv(r, per - 2, p, pvv, 1) - p : fv(r, per - 1, p, pvv, 0);
  return ip * r;
}

/** Newton's method with a bracketing fallback, for IRR, XIRR and RATE. */
function solve(f: (r: number) => number, guess: number): number {
  let r = guess;
  for (let i = 0; i < 60; i++) {
    const y = f(r);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-10) return r;
    const h = Math.max(1e-7, Math.abs(r) * 1e-6);
    const d = (f(r + h) - f(r - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - y / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  // Bisection over a wide bracket.
  let lo = -0.999999, hi = 10;
  let flo = f(lo), fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) {
    for (const h of [1, 3, 30, 100]) { hi = h; fhi = f(hi); if (Number.isFinite(fhi) && flo * fhi <= 0) break; }
    if (!(flo * fhi <= 0)) throw ERR.num;
  }
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.abs(fm) < 1e-10 || hi - lo < 1e-14) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

function cashflows(ctx: FnCtx, n: Node): number[] {
  const out: number[] = [];
  for (const v of flat(ctx, n)) { if (isErr(v)) throw v; if (typeof v === "number") out.push(v); }
  return out;
}

function datedFlows(ctx: FnCtx, vNode: Node, dNode: Node): { v: number[]; d: number[] } {
  const vs = flat(ctx, vNode), ds = flat(ctx, dNode);
  if (vs.length !== ds.length) throw ERR.num;
  const v: number[] = [], d: number[] = [];
  vs.forEach((x, i) => {
    const y = ds[i];
    if (isErr(x)) throw x;
    if (isErr(y)) throw y;
    if (typeof x !== "number" || typeof y !== "number") throw ERR.value;
    v.push(x); d.push(Math.floor(y));
  });
  if (!v.length) throw ERR.num;
  return { v, d };
}

const xnpv = (r: number, v: number[], d: number[]) => v.reduce((acc, x, i) => acc + x / Math.pow(1 + r, (d[i] - d[0]) / 365), 0);

/* ---------------- Dates ---------------- */

function ymd(serial: number) { const d = dateFromSerial(serial); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
function addMonths(serial: number, months: number, endOfMonth: boolean) {
  const { y, m, d } = ymd(serial);
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return serialFromDate(ny, nm, endOfMonth ? last : Math.min(d, last));
}
function yearfrac(a: number, b: number, basis: number) {
  if (a > b) [a, b] = [b, a];
  const s = ymd(a), e = ymd(b);
  switch (basis) {
    case 0: {
      let d1 = s.d, d2 = e.d;
      const lastFeb = (x: { y: number; m: number; d: number }) => x.m === 2 && x.d === new Date(Date.UTC(x.y, 2, 0)).getUTCDate();
      if (lastFeb(s) && lastFeb(e)) d2 = 30;
      if (lastFeb(s)) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
      if (d1 === 31) d1 = 30;
      return ((e.y - s.y) * 360 + (e.m - s.m) * 30 + (d2 - d1)) / 360;
    }
    case 1: {
      if (s.y === e.y) { const days = (Date.UTC(s.y + 1, 0, 1) - Date.UTC(s.y, 0, 1)) / 86_400_000; return (b - a) / days; }
      const years = e.y - s.y + 1;
      const total = (Date.UTC(e.y + 1, 0, 1) - Date.UTC(s.y, 0, 1)) / 86_400_000;
      return (b - a) / (total / years);
    }
    case 2: return (b - a) / 360;
    case 3: return (b - a) / 365;
    case 4: return ((e.y - s.y) * 360 + (e.m - s.m) * 30 + (Math.min(e.d, 30) - Math.min(s.d, 30))) / 360;
    default: throw ERR.num;
  }
}

/* ---------------- The library ---------------- */

const unary = (f: (x: number) => number): Fn => (ctx, a) => { const r = f(num(ctx, a[0])); if (!Number.isFinite(r)) throw ERR.num; return r; };
const roundTo = (x: number, d: number, mode: "half" | "up" | "down") => {
  const f = Math.pow(10, d);
  if (mode === "half") return roundHalfAway(x, d);
  const y = Math.abs(x) * f;
  const z = mode === "up" ? Math.ceil(Number(y.toPrecision(15))) : Math.floor(Number(y.toPrecision(15)));
  return (Math.sign(x) * z) / f;
};

export const FUNCTIONS: Record<string, Fn> = {
  /* Maths */
  SUM: (ctx, a) => sum(numbers(ctx, a)),
  PRODUCT: (ctx, a) => numbers(ctx, a).reduce((x, y) => x * y, 1),
  SUMSQ: (ctx, a) => sum(numbers(ctx, a).map((x) => x * x)),
  ABS: unary(Math.abs),
  SQRT: (ctx, a) => { const x = num(ctx, a[0]); if (x < 0) throw ERR.num; return Math.sqrt(x); },
  EXP: unary(Math.exp),
  LN: (ctx, a) => { const x = num(ctx, a[0]); if (x <= 0) throw ERR.num; return Math.log(x); },
  LOG: (ctx, a) => { const x = num(ctx, a[0]), b = optNum(ctx, a, 1, 10); if (x <= 0 || b <= 0 || b === 1) throw ERR.num; return Math.log(x) / Math.log(b); },
  LOG10: (ctx, a) => { const x = num(ctx, a[0]); if (x <= 0) throw ERR.num; return Math.log10(x); },
  POWER: (ctx, a) => { const r = Math.pow(num(ctx, a[0]), num(ctx, a[1])); if (!Number.isFinite(r)) throw ERR.num; return r; },
  SIGN: unary(Math.sign),
  INT: unary(Math.floor),
  TRUNC: (ctx, a) => { const x = num(ctx, a[0]), d = optNum(ctx, a, 1, 0); const f = Math.pow(10, d); return Math.trunc(x * f) / f; },
  MOD: (ctx, a) => { const x = num(ctx, a[0]), d = num(ctx, a[1]); if (d === 0) throw ERR.div0; return x - d * Math.floor(x / d); },
  ROUND: (ctx, a) => roundTo(num(ctx, a[0]), optNum(ctx, a, 1, 0), "half"),
  ROUNDUP: (ctx, a) => roundTo(num(ctx, a[0]), optNum(ctx, a, 1, 0), "up"),
  ROUNDDOWN: (ctx, a) => roundTo(num(ctx, a[0]), optNum(ctx, a, 1, 0), "down"),
  MROUND: (ctx, a) => { const x = num(ctx, a[0]), m = num(ctx, a[1]); if (m === 0) return 0; if (Math.sign(x) * Math.sign(m) < 0) throw ERR.num; return roundHalfAway(x / m, 0) * m; },
  CEILING: (ctx, a) => { const x = num(ctx, a[0]), s = optNum(ctx, a, 1, 1); if (s === 0) return 0; return Math.ceil(x / s) * s; },
  "CEILING.MATH": (ctx, a) => { const x = num(ctx, a[0]), s = Math.abs(optNum(ctx, a, 1, 1)); if (s === 0) return 0; return Math.ceil(x / s) * s; },
  FLOOR: (ctx, a) => { const x = num(ctx, a[0]), s = optNum(ctx, a, 1, 1); if (s === 0) throw ERR.div0; return Math.floor(x / s) * s; },
  "FLOOR.MATH": (ctx, a) => { const x = num(ctx, a[0]), s = Math.abs(optNum(ctx, a, 1, 1)); if (s === 0) return 0; return Math.floor(x / s) * s; },
  PI: () => Math.PI,
  RAND: (ctx) => { ctx.markVolatile(); return Math.random(); },
  RANDBETWEEN: (ctx, a) => { ctx.markVolatile(); const lo = Math.ceil(num(ctx, a[0])), hi = Math.floor(num(ctx, a[1])); return lo + Math.floor(Math.random() * (hi - lo + 1)); },
  SUMPRODUCT: (ctx, a) => {
    const grids = a.map((n) => ctx.grid(ctx.ev(n)));
    if (!grids.length) throw ERR.value;
    const rows = grids[0].length, cols = grids[0][0]?.length ?? 0;
    if (grids.some((g) => g.length !== rows || (g[0]?.length ?? 0) !== cols)) throw ERR.value;
    let total = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let p = 1;
      for (const g of grids) { const v = g[r][c]; if (isErr(v)) throw v; p *= typeof v === "number" ? v : 0; }
      total += p;
    }
    return total;
  },
  SUMIF: (ctx, a) => sum(aggregateIfs(ctx, given(a, 2) ? a[2] : a[0], [a[0], a[1]])),
  SUMIFS: (ctx, a) => sum(aggregateIfs(ctx, a[0], a.slice(1))),
  COUNTIF: (ctx, a) => { const m = matchingCells(ctx, [a[0], a[1]]); if (isErr(m)) throw m; return m.flat().filter(Boolean).length; },
  COUNTIFS: (ctx, a) => { const m = matchingCells(ctx, a); if (isErr(m)) throw m; return m.flat().filter(Boolean).length; },
  AVERAGEIF: (ctx, a) => mean(aggregateIfs(ctx, given(a, 2) ? a[2] : a[0], [a[0], a[1]])),
  AVERAGEIFS: (ctx, a) => mean(aggregateIfs(ctx, a[0], a.slice(1))),
  MAXIFS: (ctx, a) => { const xs = aggregateIfs(ctx, a[0], a.slice(1)); return xs.length ? Math.max(...xs) : 0; },
  MINIFS: (ctx, a) => { const xs = aggregateIfs(ctx, a[0], a.slice(1)); return xs.length ? Math.min(...xs) : 0; },

  /* Statistics */
  AVERAGE: (ctx, a) => mean(numbers(ctx, a)),
  MEDIAN: (ctx, a) => percentile(numbers(ctx, a), 0.5),
  MIN: (ctx, a) => { const xs = numbers(ctx, a); return xs.length ? Math.min(...xs) : 0; },
  MAX: (ctx, a) => { const xs = numbers(ctx, a); return xs.length ? Math.max(...xs) : 0; },
  LARGE: (ctx, a) => { const xs = numbers(ctx, [a[0]]).sort((x, y) => y - x); const k = Math.ceil(num(ctx, a[1])); if (k < 1 || k > xs.length) throw ERR.num; return xs[k - 1]; },
  SMALL: (ctx, a) => { const xs = numbers(ctx, [a[0]]).sort((x, y) => x - y); const k = Math.ceil(num(ctx, a[1])); if (k < 1 || k > xs.length) throw ERR.num; return xs[k - 1]; },
  COUNT: (ctx, a) => values(ctx, a).filter((v) => typeof v === "number").length,
  COUNTA: (ctx, a) => values(ctx, a).filter((v) => v !== null && v !== "").length,
  COUNTBLANK: (ctx, a) => values(ctx, a).filter((v) => v === null || v === "").length,
  STDEV: (ctx, a) => Math.sqrt(variance(numbers(ctx, a), true)),
  "STDEV.S": (ctx, a) => Math.sqrt(variance(numbers(ctx, a), true)),
  "STDEV.P": (ctx, a) => Math.sqrt(variance(numbers(ctx, a), false)),
  STDEVP: (ctx, a) => Math.sqrt(variance(numbers(ctx, a), false)),
  VAR: (ctx, a) => variance(numbers(ctx, a), true),
  "VAR.S": (ctx, a) => variance(numbers(ctx, a), true),
  "VAR.P": (ctx, a) => variance(numbers(ctx, a), false),
  PERCENTILE: (ctx, a) => percentile(numbers(ctx, [a[0]]), num(ctx, a[1])),
  "PERCENTILE.INC": (ctx, a) => percentile(numbers(ctx, [a[0]]), num(ctx, a[1])),
  QUARTILE: (ctx, a) => { const q = Math.trunc(num(ctx, a[1])); if (q < 0 || q > 4) throw ERR.num; return percentile(numbers(ctx, [a[0]]), q / 4); },
  "QUARTILE.INC": (ctx, a) => { const q = Math.trunc(num(ctx, a[1])); if (q < 0 || q > 4) throw ERR.num; return percentile(numbers(ctx, [a[0]]), q / 4); },
  RANK: (ctx, a) => FUNCTIONS["RANK.EQ"](ctx, a),
  "RANK.EQ": (ctx, a) => {
    const x = num(ctx, a[0]), xs = numbers(ctx, [a[1]]), asc = optNum(ctx, a, 2, 0) !== 0;
    if (!xs.includes(x)) throw ERR.na;
    return 1 + xs.filter((y) => (asc ? y < x : y > x)).length;
  },
  GEOMEAN: (ctx, a) => { const xs = numbers(ctx, a); if (!xs.length || xs.some((x) => x <= 0)) throw ERR.num; return Math.exp(sum(xs.map(Math.log)) / xs.length); },
  CORREL: (ctx, a) => {
    const [x, y] = pairs(ctx, a[0], a[1]);
    const mx = mean(x), my = mean(y);
    const cov = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
    const d = Math.sqrt(sum(x.map((v) => (v - mx) ** 2)) * sum(y.map((v) => (v - my) ** 2)));
    if (d === 0) throw ERR.div0;
    return cov / d;
  },
  SLOPE: (ctx, a) => {
    const [y, x] = pairs(ctx, a[0], a[1]);
    const mx = mean(x), my = mean(y);
    const d = sum(x.map((v) => (v - mx) ** 2));
    if (d === 0) throw ERR.div0;
    return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / d;
  },
  INTERCEPT: (ctx, a) => {
    const [y, x] = pairs(ctx, a[0], a[1]);
    const mx = mean(x), my = mean(y);
    const d = sum(x.map((v) => (v - mx) ** 2));
    if (d === 0) throw ERR.div0;
    return my - (sum(x.map((v, i) => (v - mx) * (y[i] - my))) / d) * mx;
  },

  /* Logic */
  TRUE: () => true,
  FALSE: () => false,
  IF: (ctx, a) => {
    const cond = ctx.ev(a[0]);
    if (multi(cond)) {
      const g = ctx.grid(cond);
      const t = given(a, 1) ? ctx.grid(ctx.ev(a[1])) : [[true]];
      const f = given(a, 2) ? ctx.grid(ctx.ev(a[2])) : [[false]];
      const pick = (m: Arr, r: number, c: number): Prim => m[m.length === 1 ? 0 : r]?.[m[0].length === 1 ? 0 : c] ?? ERR.na;
      return g.map((row, r) => row.map((v, c) => (isErr(v) ? v : toBool(v) ? pick(t, r, c) : pick(f, r, c))));
    }
    const p = ctx.scalar(cond);
    if (isErr(p)) throw p;
    if (toBool(p)) return given(a, 1) ? ctx.ev(a[1]) : 0;
    return a.length > 2 ? (given(a, 2) ? ctx.ev(a[2]) : 0) : false;
  },
  IFS: (ctx, a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (bool(ctx, a[i])) return ctx.ev(a[i + 1]);
    throw ERR.na;
  },
  IFERROR: (ctx, a) => {
    try {
      const v = ctx.ev(a[0]);
      if (multi(v)) return ctx.grid(v).map((row) => row.map((x) => (isErr(x) ? prim(ctx, a[1]) : x)));
      const p = ctx.scalar(v);
      return isErr(p) ? ctx.ev(a[1]) : v;
    } catch (e) {
      if (e instanceof CalcError) return ctx.ev(a[1]);
      throw e;
    }
  },
  IFNA: (ctx, a) => {
    try {
      const v = ctx.ev(a[0]);
      const p = multi(v) ? null : ctx.scalar(v);
      return isErr(p) && p.code === "#N/A" ? ctx.ev(a[1]) : v;
    } catch (e) {
      if (e instanceof CalcError && e.code === "#N/A") return ctx.ev(a[1]);
      throw e;
    }
  },
  AND: (ctx, a) => { const bs = logicals(ctx, a); if (!bs.length) throw ERR.value; return bs.every(Boolean); },
  OR: (ctx, a) => { const bs = logicals(ctx, a); if (!bs.length) throw ERR.value; return bs.some(Boolean); },
  XOR: (ctx, a) => { const bs = logicals(ctx, a); if (!bs.length) throw ERR.value; return bs.filter(Boolean).length % 2 === 1; },
  NOT: (ctx, a) => !bool(ctx, a[0]),
  SWITCH: (ctx, a) => {
    const x = prim(ctx, a[0]);
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (compare(x, prim(ctx, a[i])) === 0) return ctx.ev(a[i + 1]);
    if (i < a.length) return ctx.ev(a[i]);
    throw ERR.na;
  },
  CHOOSE: (ctx, a) => { const i = Math.trunc(num(ctx, a[0])); if (i < 1 || i >= a.length) throw ERR.value; return ctx.ev(a[i]); },

  /* Lookup and reference */
  MATCH: (ctx, a) => {
    const type = Math.sign(optNum(ctx, a, 2, 1));
    const i = matchIndex(prim(ctx, a[0]), vector(ctx, a[1]), type);
    if (i < 0) throw ERR.na;
    return i + 1;
  },
  XMATCH: (ctx, a) => {
    const mode = optNum(ctx, a, 2, 0), search = optNum(ctx, a, 3, 1);
    const i = nearest(prim(ctx, a[0]), vector(ctx, a[1]), mode, search < 0);
    if (i < 0) throw ERR.na;
    return i + 1;
  },
  INDEX: (ctx, a) => {
    const base = ctx.ev(a[0]);
    const row = Math.trunc(optNum(ctx, a, 1, 0)), col = Math.trunc(optNum(ctx, a, 2, 0));
    if (isRange(base)) {
      const h = base.r2 - base.r1 + 1, w = base.c2 - base.c1 + 1;
      let r = row, c = col;
      if (!given(a, 2) && h === 1 && w > 1) { c = row; r = 1; }
      if (r < 0 || c < 0 || r > h || c > w) throw ERR.ref;
      if (r === 0 && c === 0) return base;
      if (r === 0) return { ...base, c1: base.c1 + c - 1, c2: base.c1 + c - 1 };
      if (c === 0) { if (w === 1) return refCell(base, base.r1 + r - 1, base.c1); return { ...base, r1: base.r1 + r - 1, r2: base.r1 + r - 1 }; }
      return refCell(base, base.r1 + r - 1, base.c1 + c - 1);
    }
    const g = ctx.grid(base);
    let r = row, c = col;
    if (!given(a, 2) && g.length === 1) { c = row; r = 1; }
    const v = g[(r || 1) - 1]?.[(c || 1) - 1];
    if (v === undefined) throw ERR.ref;
    return v;
  },
  VLOOKUP: (ctx, a) => {
    const g = ctx.grid(ctx.ev(a[1]));
    const col = Math.trunc(num(ctx, a[2]));
    if (col < 1 || col > (g[0]?.length ?? 0)) throw ERR.ref;
    const approx = given(a, 3) ? bool(ctx, a[3]) : true;
    const i = matchIndex(prim(ctx, a[0]), g.map((r) => r[0]), approx ? 1 : 0);
    if (i < 0) throw ERR.na;
    return g[i][col - 1];
  },
  HLOOKUP: (ctx, a) => {
    const g = ctx.grid(ctx.ev(a[1]));
    const row = Math.trunc(num(ctx, a[2]));
    if (row < 1 || row > g.length) throw ERR.ref;
    const approx = given(a, 3) ? bool(ctx, a[3]) : true;
    const i = matchIndex(prim(ctx, a[0]), g[0], approx ? 1 : 0);
    if (i < 0) throw ERR.na;
    return g[row - 1][i];
  },
  XLOOKUP: (ctx, a) => {
    const lookup = prim(ctx, a[0]);
    const lv = vector(ctx, a[1]);
    const retV = ctx.ev(a[2]);
    const mode = optNum(ctx, a, 4, 0), search = optNum(ctx, a, 5, 1);
    const i = nearest(lookup, lv, mode, search < 0);
    if (i < 0) { if (given(a, 3)) return ctx.ev(a[3]); throw ERR.na; }
    const lg = ctx.grid(ctx.ev(a[1]));
    const vertical = lg.length > 1 || lg[0]?.length === 1;
    if (isRange(retV)) {
      if (vertical) { const r = retV.r1 + i; return retV.c1 === retV.c2 ? refCell(retV, r, retV.c1) : { ...retV, r1: r, r2: r }; }
      const c = retV.c1 + i; return retV.r1 === retV.r2 ? refCell(retV, retV.r1, c) : { ...retV, c1: c, c2: c };
    }
    const g = ctx.grid(retV);
    return vertical ? (g[i]?.length === 1 ? g[i][0] : [g[i] ?? [ERR.na]]) : g.length === 1 ? g[0][i] ?? ERR.na : g.map((r) => [r[i]]);
  },
  LOOKUP: (ctx, a) => {
    const lv = vector(ctx, a[1]);
    const i = matchIndex(prim(ctx, a[0]), lv, 1);
    if (i < 0) throw ERR.na;
    return given(a, 2) ? vector(ctx, a[2])[i] ?? ERR.na : lv[i];
  },
  ROW: (ctx, a) => { if (!a.length) return ctx.here.r; const v = ctx.ev(a[0]); if (!isRange(v)) throw ERR.value; return v.r1; },
  COLUMN: (ctx, a) => { if (!a.length) return ctx.here.c; const v = ctx.ev(a[0]); if (!isRange(v)) throw ERR.value; return v.c1; },
  ROWS: (ctx, a) => { const v = ctx.ev(a[0]); return isRange(v) ? v.r2 - v.r1 + 1 : ctx.grid(v).length; },
  COLUMNS: (ctx, a) => { const v = ctx.ev(a[0]); return isRange(v) ? v.c2 - v.c1 + 1 : ctx.grid(v)[0]?.length ?? 0; },
  OFFSET: (ctx, a) => {
    ctx.markVolatile();
    const base = ctx.ev(a[0]);
    if (!isRange(base)) throw ERR.value;
    const dr = Math.trunc(num(ctx, a[1])), dc = Math.trunc(num(ctx, a[2]));
    const h = given(a, 3) ? Math.trunc(num(ctx, a[3])) : base.r2 - base.r1 + 1;
    const w = given(a, 4) ? Math.trunc(num(ctx, a[4])) : base.c2 - base.c1 + 1;
    const r1 = base.r1 + dr, c1 = base.c1 + dc;
    if (r1 < 1 || c1 < 1 || h < 1 || w < 1) throw ERR.ref;
    return { kind: "range", sheet: base.sheet, r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 };
  },
  INDIRECT: (ctx, a) => {
    ctx.markVolatile();
    const ref = ctx.refFromText(text(ctx, a[0]));
    if (!ref) throw ERR.ref;
    return ref;
  },

  /* Finance */
  NPV: (ctx, a) => {
    const r = num(ctx, a[0]);
    return numbers(ctx, a.slice(1)).reduce((acc, x, i) => acc + x / Math.pow(1 + r, i + 1), 0);
  },
  XNPV: (ctx, a) => { const r = num(ctx, a[0]); const { v, d } = datedFlows(ctx, a[1], a[2]); return xnpv(r, v, d); },
  IRR: (ctx, a) => {
    const v = cashflows(ctx, a[0]);
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) throw ERR.num;
    return solve((r) => v.reduce((acc, x, i) => acc + x / Math.pow(1 + r, i), 0), optNum(ctx, a, 1, 0.1));
  },
  XIRR: (ctx, a) => {
    const { v, d } = datedFlows(ctx, a[0], a[1]);
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) throw ERR.num;
    return solve((r) => xnpv(r, v, d), optNum(ctx, a, 2, 0.1));
  },
  MIRR: (ctx, a) => {
    const v = cashflows(ctx, a[0]), fr = num(ctx, a[1]), rr = num(ctx, a[2]);
    const n = v.length;
    const negPv = v.reduce((acc, x, i) => acc + (x < 0 ? x / Math.pow(1 + fr, i) : 0), 0);
    const posFv = v.reduce((acc, x, i) => acc + (x > 0 ? x * Math.pow(1 + rr, n - 1 - i) : 0), 0);
    if (negPv === 0 || posFv === 0) throw ERR.div0;
    return Math.pow(posFv / -negPv, 1 / (n - 1)) - 1;
  },
  PMT: (ctx, a) => pmt(num(ctx, a[0]), num(ctx, a[1]), num(ctx, a[2]), optNum(ctx, a, 3, 0), optNum(ctx, a, 4, 0)),
  FV: (ctx, a) => fv(num(ctx, a[0]), num(ctx, a[1]), num(ctx, a[2]), optNum(ctx, a, 3, 0), optNum(ctx, a, 4, 0)),
  PV: (ctx, a) => pv(num(ctx, a[0]), num(ctx, a[1]), num(ctx, a[2]), optNum(ctx, a, 3, 0), optNum(ctx, a, 4, 0)),
  IPMT: (ctx, a) => ipmt(num(ctx, a[0]), num(ctx, a[1]), num(ctx, a[2]), num(ctx, a[3]), optNum(ctx, a, 4, 0), optNum(ctx, a, 5, 0)),
  PPMT: (ctx, a) => {
    const r = num(ctx, a[0]), per = num(ctx, a[1]), n = num(ctx, a[2]), p = num(ctx, a[3]), f = optNum(ctx, a, 4, 0), t = optNum(ctx, a, 5, 0);
    return pmt(r, n, p, f, t) - ipmt(r, per, n, p, f, t);
  },
  NPER: (ctx, a) => {
    const r = num(ctx, a[0]), p = num(ctx, a[1]), pvv = num(ctx, a[2]), f = optNum(ctx, a, 3, 0), t = optNum(ctx, a, 4, 0);
    if (r === 0) { if (p === 0) throw ERR.num; return -(pvv + f) / p; }
    const x = (p * (1 + r * t) - f * r) / (p * (1 + r * t) + pvv * r);
    if (x <= 0) throw ERR.num;
    return Math.log(x) / Math.log(1 + r);
  },
  RATE: (ctx, a) => {
    const n = num(ctx, a[0]), p = num(ctx, a[1]), pvv = num(ctx, a[2]), f = optNum(ctx, a, 3, 0), t = optNum(ctx, a, 4, 0);
    return solve((r) => (Math.abs(r) < 1e-12 ? pvv + p * n + f : pvv * Math.pow(1 + r, n) + (p * (1 + r * t) * (Math.pow(1 + r, n) - 1)) / r + f), optNum(ctx, a, 5, 0.1));
  },
  EFFECT: (ctx, a) => { const r = num(ctx, a[0]), n = Math.trunc(num(ctx, a[1])); if (r <= 0 || n < 1) throw ERR.num; return Math.pow(1 + r / n, n) - 1; },
  NOMINAL: (ctx, a) => { const r = num(ctx, a[0]), n = Math.trunc(num(ctx, a[1])); if (r <= 0 || n < 1) throw ERR.num; return n * (Math.pow(1 + r, 1 / n) - 1); },
  RRI: (ctx, a) => { const n = num(ctx, a[0]), p = num(ctx, a[1]), f = num(ctx, a[2]); if (n <= 0 || p === 0) throw ERR.num; return Math.pow(f / p, 1 / n) - 1; },
  SLN: (ctx, a) => { const life = num(ctx, a[2]); if (life === 0) throw ERR.div0; return (num(ctx, a[0]) - num(ctx, a[1])) / life; },

  /* Dates */
  DATE: (ctx, a) => { const y = Math.trunc(num(ctx, a[0])), m = Math.trunc(num(ctx, a[1])), d = Math.trunc(num(ctx, a[2])); return serialFromDate(y < 1900 ? y + 1900 : y, m, d); },
  YEAR: (ctx, a) => ymd(num(ctx, a[0])).y,
  MONTH: (ctx, a) => ymd(num(ctx, a[0])).m,
  DAY: (ctx, a) => ymd(num(ctx, a[0])).d,
  EDATE: (ctx, a) => addMonths(num(ctx, a[0]), num(ctx, a[1]), false),
  EOMONTH: (ctx, a) => addMonths(num(ctx, a[0]), num(ctx, a[1]), true),
  TODAY: (ctx) => { ctx.markVolatile(); const n = new Date(); return serialFromDate(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()); },
  NOW: (ctx) => { ctx.markVolatile(); return (Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000; },
  DAYS: (ctx, a) => Math.floor(num(ctx, a[0])) - Math.floor(num(ctx, a[1])),
  YEARFRAC: (ctx, a) => yearfrac(Math.floor(num(ctx, a[0])), Math.floor(num(ctx, a[1])), Math.trunc(optNum(ctx, a, 2, 0))),
  DATEDIF: (ctx, a) => {
    const s = Math.floor(num(ctx, a[0])), e = Math.floor(num(ctx, a[1])), unit = text(ctx, a[2]).toUpperCase();
    if (s > e) throw ERR.num;
    const x = ymd(s), y = ymd(e);
    const months = (y.y - x.y) * 12 + (y.m - x.m) - (y.d < x.d ? 1 : 0);
    if (unit === "D") return e - s;
    if (unit === "M") return months;
    if (unit === "Y") return Math.floor(months / 12);
    throw ERR.num;
  },
  WEEKDAY: (ctx, a) => { const d = dateFromSerial(num(ctx, a[0])).getUTCDay(); const t = optNum(ctx, a, 1, 1); return t === 2 ? ((d + 6) % 7) + 1 : t === 3 ? (d + 6) % 7 : d + 1; },

  /* Text */
  CONCAT: (ctx, a) => values(ctx, a).map((v) => { if (isErr(v)) throw v; return toText(v); }).join(""),
  CONCATENATE: (ctx, a) => a.map((n) => text(ctx, n)).join(""),
  TEXTJOIN: (ctx, a) => {
    const delim = text(ctx, a[0]), skip = bool(ctx, a[1]);
    return values(ctx, a.slice(2)).map((v) => { if (isErr(v)) throw v; return toText(v); }).filter((s) => !skip || s !== "").join(delim);
  },
  TEXT: (ctx, a) => formatValue(prim(ctx, a[0]), text(ctx, a[1])).text,
  LEFT: (ctx, a) => text(ctx, a[0]).slice(0, Math.max(0, optNum(ctx, a, 1, 1))),
  RIGHT: (ctx, a) => { const s = text(ctx, a[0]), n = Math.max(0, optNum(ctx, a, 1, 1)); return n ? s.slice(-n) : ""; },
  MID: (ctx, a) => { const s = text(ctx, a[0]), st = Math.trunc(num(ctx, a[1])), n = Math.trunc(num(ctx, a[2])); if (st < 1 || n < 0) throw ERR.value; return s.substr(st - 1, n); },
  LEN: (ctx, a) => text(ctx, a[0]).length,
  UPPER: (ctx, a) => text(ctx, a[0]).toUpperCase(),
  LOWER: (ctx, a) => text(ctx, a[0]).toLowerCase(),
  PROPER: (ctx, a) => text(ctx, a[0]).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase()),
  TRIM: (ctx, a) => text(ctx, a[0]).trim().replace(/ {2,}/g, " "),
  SUBSTITUTE: (ctx, a) => {
    const s = text(ctx, a[0]), from = text(ctx, a[1]), to = text(ctx, a[2]);
    if (!from) return s;
    if (!given(a, 3)) return s.split(from).join(to);
    const k = Math.trunc(num(ctx, a[3]));
    let idx = -1;
    for (let i = 0; i < k; i++) { idx = s.indexOf(from, idx + 1); if (idx < 0) return s; }
    return s.slice(0, idx) + to + s.slice(idx + from.length);
  },
  FIND: (ctx, a) => { const i = text(ctx, a[1]).indexOf(text(ctx, a[0]), optNum(ctx, a, 2, 1) - 1); if (i < 0) throw ERR.value; return i + 1; },
  SEARCH: (ctx, a) => {
    const needle = text(ctx, a[0]), hay = text(ctx, a[1]), start = optNum(ctx, a, 2, 1) - 1;
    const re = new RegExp(wildcard(needle).source.slice(1, -1), "is");
    const m = re.exec(hay.slice(start));
    if (!m) throw ERR.value;
    return start + m.index + 1;
  },
  REPT: (ctx, a) => text(ctx, a[0]).repeat(Math.max(0, Math.trunc(num(ctx, a[1])))),
  EXACT: (ctx, a) => text(ctx, a[0]) === text(ctx, a[1]),
  VALUE: (ctx, a) => { const v = prim(ctx, a[0]); if (typeof v === "number") return v; const n = parseNumberText(toText(v)); if (n === null) throw ERR.value; return n; },
  N: (ctx, a) => { const v = prim(ctx, a[0]); return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0; },
  T: (ctx, a) => { const v = prim(ctx, a[0]); return typeof v === "string" ? v : ""; },

  /* Information */
  ISNUMBER: (ctx, a) => typeof safe(ctx, a[0]) === "number",
  ISTEXT: (ctx, a) => typeof safe(ctx, a[0]) === "string",
  ISNONTEXT: (ctx, a) => typeof safe(ctx, a[0]) !== "string",
  ISLOGICAL: (ctx, a) => typeof safe(ctx, a[0]) === "boolean",
  ISBLANK: (ctx, a) => safe(ctx, a[0]) === null,
  ISERROR: (ctx, a) => isErr(safe(ctx, a[0])),
  ISERR: (ctx, a) => { const v = safe(ctx, a[0]); return isErr(v) && v.code !== "#N/A"; },
  ISNA: (ctx, a) => { const v = safe(ctx, a[0]); return isErr(v) && v.code === "#N/A"; },
  NA: () => { throw ERR.na; },
};

/** A value for the IS functions: errors are values here, not failures. */
function safe(ctx: FnCtx, n: Node): Prim {
  try { return ctx.scalar(ctx.ev(n)); } catch (e) { if (e instanceof CalcError) return e; throw e; }
}

function logicals(ctx: FnCtx, args: Node[]): boolean[] {
  const out: boolean[] = [];
  for (const a of args) {
    if (a.k === "miss") continue;
    const v = ctx.ev(a);
    if (multi(v)) {
      for (const row of ctx.grid(v)) for (const x of row) {
        if (isErr(x)) throw x;
        if (typeof x === "boolean") out.push(x);
        else if (typeof x === "number") out.push(x !== 0);
      }
    } else out.push(bool(ctx, a));
  }
  return out;
}

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCTIONS).sort();
