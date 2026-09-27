/**
 * Excel formula language: tokenizer, parser and reference rewriting (for inserting rows, filling
 * formulas across, and renaming sheets). Precedence follows Excel, where negation binds tighter than
 * exponentiation (-2^2 is 4) and ^ is left-associative.
 */
import { MAX_COL, MAX_ROW, colIndex, colName, quoteSheet } from "./address";

export type RefTok = {
  /** Sheet name as written, unquoted. Absent means the formula's own sheet. */
  sheet?: string;
  kind: "cell" | "range" | "cols" | "rows";
  r1: number; c1: number; r2: number; c2: number;
  ar1: boolean; ac1: boolean; ar2: boolean; ac2: boolean;
};

export type Tok =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "str"; v: string; s: number; e: number }
  | { t: "err"; v: string; s: number; e: number }
  | { t: "ref"; ref: RefTok; s: number; e: number }
  | { t: "name"; v: string; s: number; e: number }
  | { t: "op"; v: string; s: number; e: number }
  | { t: "(" | ")" | ","; s: number; e: number };

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: string }
  | { k: "ref"; ref: RefTok }
  | { k: "name"; v: string }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "neg"; a: Node }
  | { k: "pos"; a: Node }
  | { k: "pct"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "miss" };

export class FormulaSyntaxError extends Error {}

const ERR_RE = /#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CYCLE!|SPILL!|CALC!|ERROR!)/y;
const STR_RE = /"((?:[^"]|"")*)"/y;
const SHEET_RE = /(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/y;
const CELL_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?(?![\w(.!])/y;
const COLS_RE = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(.!])/y;
const ROWS_RE = /(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w(.!])/y;
const NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME_RE = /[A-Za-z_\\][\w.]*/y;
const OP_RE = /<>|<=|>=|[-+*/^&=<>%]/y;

function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

function refFrom(m: RegExpExecArray, kind: "cell" | "cols" | "rows", sheet?: string): RefTok | null {
  if (kind === "cell") {
    const r1 = Number(m[4]), c1 = colIndex(m[2]);
    const two = m[6] !== undefined;
    const r2 = two ? Number(m[8]) : r1, c2 = two ? colIndex(m[6]) : c1;
    if (r1 < 1 || r2 < 1 || r1 > MAX_ROW || r2 > MAX_ROW || c1 > MAX_COL || c2 > MAX_COL) return null;
    return { sheet, kind: two ? "range" : "cell", r1, c1, r2, c2, ac1: m[1] === "$", ar1: m[3] === "$", ac2: two ? m[5] === "$" : m[1] === "$", ar2: two ? m[7] === "$" : m[3] === "$" };
  }
  if (kind === "cols") {
    const c1 = colIndex(m[2]), c2 = colIndex(m[4]);
    if (c1 > MAX_COL || c2 > MAX_COL) return null;
    return { sheet, kind, r1: 1, r2: MAX_ROW, c1, c2, ac1: m[1] === "$", ac2: m[3] === "$", ar1: true, ar2: true };
  }
  const r1 = Number(m[2]), r2 = Number(m[4]);
  if (r1 < 1 || r2 < 1 || r1 > MAX_ROW || r2 > MAX_ROW) return null;
  return { sheet, kind, r1, r2, c1: 1, c2: MAX_COL, ar1: m[1] === "$", ar2: m[3] === "$", ac1: true, ac2: true };
}

/** Try to read a reference (optionally sheet-qualified) at position i. */
function readRef(src: string, i: number): { ref: RefTok; end: number } | null {
  let sheet: string | undefined;
  let j = i;
  const sm = at(SHEET_RE, src, i);
  if (sm) { sheet = sm[1] !== undefined ? sm[1].replace(/''/g, "'") : sm[2]; j = SHEET_RE.lastIndex; }
  for (const [re, kind] of [[CELL_RE, "cell"], [COLS_RE, "cols"], [ROWS_RE, "rows"]] as const) {
    const m = at(re, src, j);
    if (m) { const ref = refFrom(m, kind, sheet); if (ref) return { ref, end: re.lastIndex }; }
  }
  return null;
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  // A number can follow only an operator, "(", "," or the start; after a value, "-" and "+" are binary.
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(" || ch === ")" || ch === ",") { out.push({ t: ch, s: i, e: i + 1 }); i++; continue; }
    if (ch === "\"") {
      const m = at(STR_RE, src, i);
      if (!m) throw new FormulaSyntaxError("Unterminated string");
      out.push({ t: "str", v: m[1].replace(/""/g, "\""), s: i, e: STR_RE.lastIndex }); i = STR_RE.lastIndex; continue;
    }
    if (ch === "#") {
      const m = at(ERR_RE, src, i);
      if (!m) throw new FormulaSyntaxError(`Unknown error literal at ${i}`);
      out.push({ t: "err", v: m[0], s: i, e: ERR_RE.lastIndex }); i = ERR_RE.lastIndex; continue;
    }
    if (ch === "'" || /[A-Za-z_$\d]/.test(ch)) {
      const r = readRef(src, i);
      if (r) { out.push({ t: "ref", ref: r.ref, s: i, e: r.end }); i = r.end; continue; }
    }
    if (/[\d.]/.test(ch)) {
      const m = at(NUM_RE, src, i);
      if (m) { out.push({ t: "num", v: Number(m[0]), s: i, e: NUM_RE.lastIndex }); i = NUM_RE.lastIndex; continue; }
    }
    if (/[A-Za-z_\\]/.test(ch)) {
      const m = at(NAME_RE, src, i)!;
      out.push({ t: "name", v: m[0], s: i, e: NAME_RE.lastIndex }); i = NAME_RE.lastIndex; continue;
    }
    const m = at(OP_RE, src, i);
    if (m) { out.push({ t: "op", v: m[0], s: i, e: OP_RE.lastIndex }); i = OP_RE.lastIndex; continue; }
    throw new FormulaSyntaxError(`Unexpected "${ch}" at ${i}`);
  }
  return out;
}

const BINARY: Record<string, number> = { "=": 10, "<>": 10, "<": 10, ">": 10, "<=": 10, ">=": 10, "&": 20, "+": 30, "-": 30, "*": 40, "/": 40, "^": 50 };
const PREFIX_BP = 60;
const PERCENT_BP = 70;

export function parse(src: string): Node {
  const toks = tokenize(src.startsWith("=") ? src.slice(1) : src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  const expr = (minBp: number): Node => {
    let lhs = prefix();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op") break;
      if (t.v === "%") { if (PERCENT_BP < minBp) break; next(); lhs = { k: "pct", a: lhs }; continue; }
      const bp = BINARY[t.v];
      if (bp === undefined || bp < minBp) break;
      next();
      lhs = { k: "bin", op: t.v, a: lhs, b: expr(bp + 1) };
    }
    return lhs;
  };

  const prefix = (): Node => {
    const t = next();
    if (!t) throw new FormulaSyntaxError("Unexpected end of formula");
    switch (t.t) {
      case "num": return { k: "num", v: t.v };
      case "str": return { k: "str", v: t.v };
      case "err": return { k: "err", v: t.v };
      case "ref": return { k: "ref", ref: t.ref };
      case "(": { const e = expr(0); if (next()?.t !== ")") throw new FormulaSyntaxError("Missing )"); return e; }
      case "op":
        if (t.v === "-") return { k: "neg", a: expr(PREFIX_BP) };
        if (t.v === "+") return { k: "pos", a: expr(PREFIX_BP) };
        throw new FormulaSyntaxError(`Unexpected ${t.v}`);
      case "name": {
        const name = t.v.replace(/^_xl(?:fn|ws)\./i, "").toUpperCase();
        if (peek()?.t === "(") {
          next();
          const args: Node[] = [];
          if (peek()?.t === ")") { next(); return { k: "fn", name, args }; }
          for (;;) {
            const q = peek();
            if (q?.t === "," || q?.t === ")") args.push({ k: "miss" }); else args.push(expr(0));
            const sep = next();
            if (sep?.t === ")") break;
            if (sep?.t !== ",") throw new FormulaSyntaxError("Expected , or )");
          }
          return { k: "fn", name, args };
        }
        if (name === "TRUE" || name === "FALSE") return { k: "bool", v: name === "TRUE" };
        return { k: "name", v: t.v };
      }
      default: throw new FormulaSyntaxError(`Unexpected ${t.t}`);
    }
  };

  const node = expr(0);
  if (p < toks.length) throw new FormulaSyntaxError("Unexpected text after the formula");
  return node;
}

/* ---------------- Reference rewriting ---------------- */

export function refText(r: RefTok): string {
  const sheet = r.sheet !== undefined ? `${quoteSheet(r.sheet)}!` : "";
  const cell = (c: number, r0: number, ac: boolean, ar: boolean) => `${ac ? "$" : ""}${colName(c)}${ar ? "$" : ""}${r0}`;
  if (r.kind === "cell") return sheet + cell(r.c1, r.r1, r.ac1, r.ar1);
  if (r.kind === "range") return `${sheet}${cell(r.c1, r.r1, r.ac1, r.ar1)}:${cell(r.c2, r.r2, r.ac2, r.ar2)}`;
  if (r.kind === "cols") return `${sheet}${r.ac1 ? "$" : ""}${colName(r.c1)}:${r.ac2 ? "$" : ""}${colName(r.c2)}`;
  return `${sheet}${r.ar1 ? "$" : ""}${r.r1}:${r.ar2 ? "$" : ""}${r.r2}`;
}

/**
 * Rewrite every reference in a formula. `fn` returns the new reference, or null for one that no longer
 * exists (it becomes #REF!). Everything else in the text is kept exactly as written.
 */
export function rewriteRefs(formula: string, fn: (r: RefTok) => RefTok | null): string {
  let toks: Tok[];
  try { toks = tokenize(formula); } catch { return formula; }
  let out = "", last = 0;
  for (const t of toks) {
    if (t.t !== "ref") continue;
    const next = fn(t.ref);
    out += formula.slice(last, t.s) + (next ? refText(next) : "#REF!");
    last = t.e;
  }
  return out + formula.slice(last);
}

/** The formula as it would read if copied dr rows down and dc columns right (relative parts move). */
export function translateFormula(formula: string, dr: number, dc: number): string {
  return rewriteRefs(formula, (r) => {
    const n = { ...r };
    if (r.kind !== "cols") { if (!r.ar1) n.r1 += dr; if (!r.ar2) n.r2 += dr; }
    if (r.kind !== "rows") { if (!r.ac1) n.c1 += dc; if (!r.ac2) n.c2 += dc; }
    if (n.r1 < 1 || n.r2 < 1 || n.c1 < 1 || n.c2 < 1 || n.r2 > MAX_ROW || n.c2 > MAX_COL) return null;
    return n;
  });
}

/**
 * Shift references after rows (axis "r") or columns (axis "c") are inserted (count > 0) or deleted
 * (count < 0) at index `at` on the named sheet. `own` is the name of the sheet the formula lives on.
 */
export function shiftFormula(formula: string, own: string, target: string, axis: "r" | "c", at: number, count: number): string {
  const same = (r: RefTok) => (r.sheet ?? own).toLowerCase() === target.toLowerCase();
  return rewriteRefs(formula, (r) => {
    if (!same(r)) return r;
    if (axis === "r" && r.kind === "cols") return r;
    if (axis === "c" && r.kind === "rows") return r;
    const [a, b] = axis === "r" ? [r.r1, r.r2] : [r.c1, r.c2];
    let na = a, nb = b;
    if (count > 0) {
      if (a >= at) na = a + count;
      if (b >= at) nb = b + count;
    } else {
      const del = -count, end = at + del - 1;
      const move = (x: number) => (x > end ? x - del : x);
      if (a >= at && b <= end) return null; // the whole reference was deleted
      na = a >= at && a <= end ? at : move(a);
      nb = b >= at && b <= end ? at - 1 : move(b);
      if (nb < na) return null;
    }
    return axis === "r" ? { ...r, r1: na, r2: nb } : { ...r, c1: na, c2: nb };
  });
}

/** Point references to a renamed sheet at its new name. */
export function renameSheetInFormula(formula: string, from: string, to: string): string {
  return rewriteRefs(formula, (r) => (r.sheet !== undefined && r.sheet.toLowerCase() === from.toLowerCase() ? { ...r, sheet: to } : r));
}

/** Every reference in a formula, for dependency tracking and auditing. */
export function refsOf(node: Node, out: RefTok[] = []): RefTok[] {
  switch (node.k) {
    case "ref": out.push(node.ref); break;
    case "fn": for (const a of node.args) refsOf(a, out); break;
    case "neg": case "pos": case "pct": refsOf(node.a, out); break;
    case "bin": refsOf(node.a, out); refsOf(node.b, out); break;
  }
  return out;
}

export function namesOf(node: Node, out: string[] = []): string[] {
  switch (node.k) {
    case "name": out.push(node.v); break;
    case "fn": for (const a of node.args) namesOf(a, out); break;
    case "neg": case "pos": case "pct": namesOf(node.a, out); break;
    case "bin": namesOf(node.a, out); namesOf(node.b, out); break;
  }
  return out;
}

export function functionsOf(node: Node, out: Set<string> = new Set()): Set<string> {
  switch (node.k) {
    case "fn": out.add(node.name); for (const a of node.args) functionsOf(a, out); break;
    case "neg": case "pos": case "pct": functionsOf(node.a, out); break;
    case "bin": functionsOf(node.a, out); functionsOf(node.b, out); break;
  }
  return out;
}
