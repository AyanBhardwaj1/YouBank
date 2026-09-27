/**
 * Model checks a reviewer would run by hand: errors, numbers typed into formulas, a hardcode in a row
 * of formulas, a formula that breaks its row's pattern, circular references, references to empty
 * cells, inputs nothing uses, and balance checks that do not tie. Plus banker formatting.
 */
import { addr as A1, colName, parseAddr } from "./address";
import type { Engine } from "./engine";
import { refsOf, translateFormula, type Node } from "./formula";
import { isErr } from "./values";
import type { CellData, CellStyle, Workbook } from "./types";
import { BLACK, BLUE, GREEN } from "./templates";

export type Issue = {
  severity: "error" | "warning" | "info";
  kind: "error_value" | "hardcoded_number" | "hardcode_in_formula_row" | "inconsistent_formula" | "circular" | "empty_reference" | "unused_input" | "check_failed";
  sheet: string; cell: string; message: string;
};

/** Numbers that are conventions, not assumptions, inside a formula. */
const HARMLESS = new Set([0, 1, 2, 3, 4, 5, 10, 12, 52, 100, 360, 365, 1000, 1e6, 0.5]);

function numbersIn(n: Node, out: number[] = [], parentFn?: string): number[] {
  switch (n.k) {
    case "num": out.push(n.v); break;
    case "fn": {
      // Positional arguments of lookups, rounding and period counts are not assumptions.
      const skipAfterFirst = ["INDEX", "ROUND", "ROUNDUP", "ROUNDDOWN", "OFFSET", "CHOOSE", "VLOOKUP", "HLOOKUP", "MATCH", "XLOOKUP", "QUARTILE", "PERCENTILE", "LARGE", "SMALL", "TEXT", "LEFT", "RIGHT", "MID", "IRR", "DATE", "EDATE", "EOMONTH", "YEARFRAC"];
      n.args.forEach((a, i) => { if (!(skipAfterFirst.includes(n.name) && i > 0)) numbersIn(a, out, n.name); });
      break;
    }
    case "neg": case "pos": case "pct": numbersIn(n.a, out, parentFn); break;
    case "bin": numbersIn(n.a, out, parentFn); numbersIn(n.b, out, parentFn); break;
  }
  return out;
}

export function auditWorkbook(engine: Engine, only?: string): Issue[] {
  const wb = engine.wb;
  const issues: Issue[] = [];
  const referenced = new Set<string>();
  const seenCycles = new Set<string>();
  for (const id of wb.order) {
    const sheet = wb.sheets[id];
    for (const [a, cell] of Object.entries(sheet.cells)) {
      if (!cell.f) continue;
      const p = engine.parsedFormula(id, a);
      if (!p?.node) continue;
      for (const k of engine.precedentsOf(`${id}!${a}`)) referenced.add(k);
    }
  }
  for (const id of wb.order) {
    if (only && id !== only) continue;
    const sheet = wb.sheets[id];
    const name = sheet.name;
    const rows = new Map<number, { c: number; a: string; cell: CellData }[]>();
    for (const [a, cell] of Object.entries(sheet.cells)) {
      const p = parseAddr(a);
      if (!p) continue;
      if (cell.f !== undefined || typeof cell.v === "number") {
        let list = rows.get(p.r);
        if (!list) rows.set(p.r, (list = []));
        list.push({ c: p.c, a, cell });
      }
      if (cell.f === undefined) continue;
      const v = engine.get(id, a);
      const cyc = engine.cycleInfo(id, a);
      if (cyc) {
        const key = `${cyc.size}:${cyc.iterations}:${cyc.converged}`;
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          issues.push(cyc.converged
            ? { severity: "info", kind: "circular", sheet: name, cell: a, message: `Circular reference across ${cyc.size} cells, solved by iterative calculation in ${cyc.iterations} iterations.` }
            : { severity: "error", kind: "circular", sheet: name, cell: a, message: `Circular reference across ${cyc.size} cells did not converge. Add a circuit breaker or break the loop.` });
        }
      } else if (engine.isCyclic(id, a)) issues.push({ severity: "error", kind: "circular", sheet: name, cell: a, message: "Circular reference: this cell depends on itself." });
      else if (isErr(v) && !(v.code === "#N/A" && /NA\(\)/i.test(cell.f))) issues.push({ severity: "error", kind: "error_value", sheet: name, cell: a, message: `Evaluates to ${v.code}.` });
      const parsed = engine.parsedFormula(id, a);
      if (parsed?.node) {
        const nums = numbersIn(parsed.node).filter((x) => !HARMLESS.has(Math.abs(x)));
        if (nums.length && refsOf(parsed.node).length) issues.push({ severity: "warning", kind: "hardcoded_number", sheet: name, cell: a, message: `Number typed into a formula (${nums.slice(0, 3).join(", ")}). Put assumptions in their own input cells.` });
        for (const k of parsed.cells) {
          const [ps, pa] = [k.slice(0, k.lastIndexOf("!")), k.slice(k.lastIndexOf("!") + 1)];
          if (!wb.sheets[ps]?.cells[pa]) {
            issues.push({ severity: "warning", kind: "empty_reference", sheet: name, cell: a, message: `Refers to ${ps === id ? pa : `${wb.sheets[ps]?.name}!${pa}`}, which is empty.` });
            break;
          }
        }
      }
      const label = String(sheet.cells[`A${parseAddr(a)!.r}`]?.v ?? "");
      if (/\bcheck\b|\bdifference\b|should (?:be|equal) zero|\btie[- ]?out\b/i.test(label) && typeof v === "number" && Math.abs(v) > 0.001) issues.push({ severity: "error", kind: "check_failed", sheet: name, cell: a, message: `"${label.trim()}" is ${v.toFixed(3)}, not zero.` });
    }
    // Row patterns: across a projection row, formulas should be the same formula moved one column.
    for (const [r, list] of rows) {
      const sorted = list.sort((x, y) => x.c - y.c);
      const formulas = sorted.filter((x) => x.cell.f !== undefined);
      if (formulas.length >= 3) {
        // A typed number where its neighbours say a formula belongs: the formula to its left, moved one
        // column right, is the formula to its right moved one column left (or the row's last two agree).
        const at = new Map(sorted.map((x) => [x.c, x]));
        const shape = (c: number, to: number) => { const x = at.get(c); return x?.cell.f !== undefined ? translateFormula(x.cell.f!, 0, to - c) : null; };
        for (const h of sorted.filter((x) => x.cell.f === undefined && typeof x.cell.v === "number")) {
          const left = shape(h.c - 1, h.c), right = shape(h.c + 1, h.c), left2 = shape(h.c - 2, h.c);
          const sandwiched = left !== null && left === right;
          const trailing = right === null && !at.has(h.c + 1) && left !== null && left === left2;
          if (sandwiched || trailing) issues.push({ severity: "error", kind: "hardcode_in_formula_row", sheet: name, cell: h.a, message: `A typed number where the row's formula belongs (expected =${left}): probably an overwritten formula.` });
        }
        const shapes = formulas.map((x) => ({ x, shape: translateFormula(x.cell.f!, 0, formulas[0].c - x.c) }));
        const counts = new Map<string, number>();
        for (const s of shapes) counts.set(s.shape, (counts.get(s.shape) ?? 0) + 1);
        const [common, n] = [...counts.entries()].sort((p, q) => q[1] - p[1])[0];
        if (n >= Math.max(3, Math.ceil(formulas.length * 0.6))) {
          for (const s of shapes) if (s.shape !== common && s.x.c > formulas[0].c) issues.push({ severity: "warning", kind: "inconsistent_formula", sheet: name, cell: s.x.a, message: `Differs from the rest of row ${r}: =${s.x.cell.f}` });
        }
      }
    }
    // Inputs nothing reads.
    for (const [a, cell] of Object.entries(sheet.cells)) {
      if (cell.f !== undefined || typeof cell.v !== "number" || cell.s?.color?.toUpperCase() !== BLUE) continue;
      if (!referenced.has(`${id}!${a}`)) issues.push({ severity: "info", kind: "unused_input", sheet: name, cell: a, message: "Input that no formula uses." });
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Banker formatting: inputs blue, formulas black, links to other sheets green; numbers get a number
 * format by what their row is about (percentages, multiples, per-share, or millions).
 */
export function bankerFormat(wb: Workbook, only?: string): { sheet: string; cells: Record<string, CellData> }[] {
  const out: { sheet: string; cells: Record<string, CellData> }[] = [];
  for (const id of wb.order) {
    if (only && id !== only) continue;
    const sheet = wb.sheets[id];
    const patch: Record<string, CellData> = {};
    for (const [a, cell] of Object.entries(sheet.cells)) {
      const p = parseAddr(a);
      if (!p) continue;
      const isNum = typeof cell.v === "number";
      if (cell.f === undefined && !isNum) continue;
      const color = cell.f !== undefined ? (/!/.test(cell.f) ? GREEN : BLACK) : BLUE;
      const label = String(sheet.cells[`A${p.r}`]?.v ?? "").toLowerCase();
      let nf = cell.s?.nf;
      if (!nf) {
        if (/%|margin|growth|rate|yield|wacc|return|irr|premium|weight|share of/.test(label)) nf = "0.0%_);(0.0%)";
        else if (/\bx\b|multiple|ev ?\/|\/ ?ebitda|moic|leverage/.test(label)) nf = "0.0\"x\"";
        else if (/price|per share|eps|dps/.test(label)) nf = "$#,##0.00_);($#,##0.00)";
        else if (/year|fy/.test(label) && isNum && Number.isInteger(cell.v) && (cell.v as number) > 1900 && (cell.v as number) < 2200) nf = "0";
        else nf = "#,##0.0_);(#,##0.0)";
      }
      const s: CellStyle = { ...cell.s, color, nf };
      if (s.color !== cell.s?.color || s.nf !== cell.s?.nf) patch[a] = { ...cell, s };
    }
    if (Object.keys(patch).length) out.push({ sheet: id, cells: patch });
  }
  return out;
}

export const describeIssue = (i: Issue) => `${i.severity.toUpperCase()} ${i.sheet}!${i.cell}: ${i.message}`;
export { colName, A1 };
