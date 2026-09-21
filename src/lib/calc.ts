/**
 * Safe arithmetic evaluator for the AI "calc" tool and calculators. Supports numbers (with k/m/b/% suffixes),
 * + - * / ^, parentheses, unary minus, named variables via "x = expr" lines, and functions:
 * sqrt ln log exp abs min max round pow npv irr pmt. No property access, no globals.
 */
type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length) {
        if (/[0-9._]/.test(src[j])) { j++; continue; }
        // A comma is a thousands separator only inside a number: ",123" not followed by a fourth digit.
        if (src[j] === "," && /^,\d{3}(?!\d)/.test(src.slice(j))) { j += 4; continue; }
        break;
      }
      let v = Number(src.slice(i, j).replace(/[,_]/g, ""));
      if (Number.isNaN(v)) throw new Error(`Bad number near "${src.slice(i, j)}"`);
      const suf = src[j]?.toLowerCase();
      if (suf === "k" && !/[a-z]/i.test(src[j + 1] ?? "")) { v *= 1e3; j++; }
      else if (suf === "m" && !/[a-z]/i.test(src[j + 1] ?? "")) { v *= 1e6; j++; }
      else if (suf === "b" && !/[a-z]/i.test(src[j + 1] ?? "")) { v *= 1e9; j++; }
      else if (suf === "%") { v /= 100; j++; }
      out.push({ t: "num", v }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) { let j = i; while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++; out.push({ t: "id", v: src.slice(i, j) }); i = j; continue; }
    if ("+-*/^(),".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

const FN: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, ln: Math.log, log: Math.log10, log10: Math.log10, exp: Math.exp, abs: Math.abs, min: Math.min, max: Math.max,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, pow: Math.pow,
  npv: (rate, ...cfs) => cfs.reduce((a, cf, i) => a + cf / (1 + rate) ** (i + 1), 0),
  irr: (...cfs) => { let lo = -0.99, hi = 10; for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; const v = cfs.reduce((a, cf, i) => a + cf / (1 + mid) ** i, 0); if (v > 0) lo = mid; else hi = mid; } return (lo + hi) / 2; },
  pmt: (rate, n, pv) => (rate === 0 ? pv / n : (pv * rate) / (1 - (1 + rate) ** -n)),
};

export function evaluate(src: string, vars: Record<string, number> = {}): number {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v: string) => { const t = next(); if (!t || t.t !== "op" || t.v !== v) throw new Error(`Expected "${v}"`); };
  function primary(): number {
    const t = next();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") { const v = expr(); expect(")"); return v; }
    if (t.t === "op" && t.v === "-") return -unary();
    if (t.t === "op" && t.v === "+") return unary();
    if (t.t === "id") {
      if (peek()?.t === "op" && (peek() as { v: string }).v === "(") {
        next(); const args: number[] = [];
        if (!(peek()?.t === "op" && (peek() as { v: string }).v === ")")) { args.push(expr()); while (peek()?.t === "op" && (peek() as { v: string }).v === ",") { next(); args.push(expr()); } }
        expect(")");
        const f = FN[t.v.toLowerCase()]; if (!f) throw new Error(`Unknown function ${t.v}`);
        return f(...args);
      }
      if (t.v in vars) return vars[t.v];
      if (t.v.toLowerCase() === "pi") return Math.PI; if (t.v.toLowerCase() === "e") return Math.E;
      throw new Error(`Unknown variable ${t.v}`);
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }
  function unary(): number { return power(); }
  function power(): number { const b = primary(); if (peek()?.t === "op" && (peek() as { v: string }).v === "^") { next(); return b ** unaryRhs(); } return b; }
  function unaryRhs(): number { if (peek()?.t === "op" && (peek() as { v: string }).v === "-") { next(); return -unaryRhs(); } return power(); }
  function term(): number { let v = unary(); while (peek()?.t === "op" && "*/".includes((peek() as { v: string }).v)) { const op = (next() as { v: string }).v; const r = unary(); v = op === "*" ? v * r : v / r; } return v; }
  function expr(): number { let v = term(); while (peek()?.t === "op" && "+-".includes((peek() as { v: string }).v)) { const op = (next() as { v: string }).v; const r = term(); v = op === "+" ? v + r : v - r; } return v; }
  const v = expr();
  if (p < toks.length) throw new Error("Unexpected trailing input");
  return v;
}

/** Evaluate a script of lines: "name = expr" assigns; a bare expression is a result. Returns every result and the variables. */
export function evaluateScript(script: string): { results: { line: string; value: number }[]; vars: Record<string, number> } {
  const vars: Record<string, number> = {};
  const results: { line: string; value: number }[] = [];
  for (const raw of script.split(/[\n;]/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (m) { vars[m[1]] = evaluate(m[2], vars); results.push({ line, value: vars[m[1]] }); }
    else results.push({ line, value: evaluate(line, vars) });
  }
  return { results, vars };
}
