/**
 * .xlsx in and out. Import keeps values, formulas (shared ones expanded), number formats, fonts,
 * fills, borders, column widths, frozen panes, merges and defined names, and reports anything it could
 * not keep. Export writes formulas with their computed results and asks Excel to recalculate on open.
 */
import ExcelJS from "exceljs";
import { colIndex, colName, parseAddr } from "./address";
import { functionsOf, parse, tokenize, translateFormula } from "./formula";
import { FUNCTIONS } from "./functions";
import type { Engine } from "./engine";
import { isErr } from "./values";
import type { CellData, CellStyle, Scalar, SheetData, StudioDocData, Workbook } from "./types";
import { newId } from "./types";

export type Intake = {
  file: string;
  sheets: { name: string; cells: number; formulas: number; hidden: boolean }[];
  unsupported: { fn: string; count: number }[];
  externalLinks: number;
  dropped: string[];
  truncated: boolean;
  warnings: string[];
};

const MAX_CELLS = 250_000;
const EPOCH = Date.UTC(1899, 11, 30);

const hex = (argb?: string) => (argb && /^[0-9A-Fa-f]{8}$/.test(argb) ? `#${argb.slice(2).toUpperCase()}` : argb && /^[0-9A-Fa-f]{6}$/.test(argb) ? `#${argb.toUpperCase()}` : undefined);
const border = (b?: Partial<ExcelJS.Border>): CellStyle["bb"] => (!b?.style ? undefined : b.style === "double" ? "double" : b.style === "medium" || b.style === "thick" ? "medium" : "thin");

function styleOf(c: ExcelJS.Cell): CellStyle | undefined {
  const s: CellStyle = {};
  const f = c.font;
  if (f?.bold) s.b = true;
  if (f?.italic) s.i = true;
  if (f?.underline) s.u = true;
  if (f?.size && f.size !== 11 && f.size !== 10) s.size = f.size;
  const fc = hex(f?.color?.argb);
  if (fc) s.color = fc;
  const fill = c.fill as ExcelJS.FillPattern | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid") { const x = hex(fill.fgColor?.argb); if (x) s.fill = x; }
  if (c.numFmt && c.numFmt !== "General") s.nf = c.numFmt;
  const al = c.alignment;
  if (al?.horizontal === "left" || al?.horizontal === "center" || al?.horizontal === "right") s.al = al.horizontal;
  if (al?.indent) s.indent = al.indent;
  if (al?.wrapText) s.wrap = true;
  const bt = border(c.border?.top), bb = border(c.border?.bottom);
  if (bt) s.bt = bt;
  if (bb) s.bb = bb;
  return Object.keys(s).length ? s : undefined;
}

function scalarOf(v: unknown): Scalar | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return (v.getTime() - EPOCH) / 86_400_000;
  const o = v as { error?: string; text?: string; richText?: { text: string }[]; result?: unknown };
  if (o.error) return o.error;
  if (o.richText) return o.richText.map((r) => r.text).join("");
  if (o.text !== undefined) return String(o.text);
  if ("result" in o) return scalarOf(o.result);
  return undefined;
}

export async function importXlsx(buf: ArrayBuffer | Buffer, file: string): Promise<{ workbook: Workbook; intake: Intake }> {
  const xl = new ExcelJS.Workbook();
  await xl.xlsx.load(buf as ArrayBuffer);
  const intake: Intake = { file, sheets: [], unsupported: [], externalLinks: 0, dropped: [], truncated: false, warnings: [] };
  const unsupported = new Map<string, number>();
  const wb: Workbook = { order: [], sheets: {} };
  let total = 0, images = 0, cf = 0, dv = 0;
  for (const ws of xl.worksheets) {
    const sheet: SheetData = { id: newId("sh"), name: ws.name.slice(0, 31), cells: {}, cols: {} };
    let cells = 0, formulas = 0;
    const hidden = ws.state === "hidden" || ws.state === "veryHidden";
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        if (total >= MAX_CELLS) { intake.truncated = true; return; }
        if (c.type === ExcelJS.ValueType.Merge) return;
        const a = c.address;
        const data: CellData = {};
        if (c.type === ExcelJS.ValueType.Formula) {
          const fv = c.value as { formula?: string; sharedFormula?: string; result?: unknown };
          let f = c.formula || fv.formula;
          if (!f && fv.sharedFormula) {
            const master = ws.getCell(fv.sharedFormula);
            const mp = parseAddr(master.address), cp = parseAddr(a);
            if (master.formula && mp && cp) f = translateFormula(master.formula, cp.r - mp.r, cp.c - mp.c);
          }
          const cached = scalarOf(fv.result);
          if (f && /\[[^\]]*\]/.test(f)) {
            intake.externalLinks++;
            if (cached !== undefined) data.v = cached;
            data.src = `External link (value kept, formula not): =${f.slice(0, 180)}`;
          } else if (f) {
            data.f = f.replace(/^=/, "");
            if (cached !== undefined) data.cv = cached;
            formulas++;
            try { for (const fn of functionsOf(parse(data.f))) if (!FUNCTIONS[fn]) unsupported.set(fn, (unsupported.get(fn) ?? 0) + 1); }
            catch { intake.warnings.push(`${ws.name}!${a}: formula could not be read, cached value kept`); if (cached !== undefined) { delete data.f; data.v = cached; } }
          }
        } else {
          const v = scalarOf(c.value);
          if (v !== undefined) data.v = v;
        }
        const s = styleOf(c);
        if (s) data.s = s;
        if (c.note) data.src = typeof c.note === "string" ? c.note.slice(0, 300) : undefined;
        if (data.v === undefined && data.f === undefined && !data.s) return;
        sheet.cells[a] = data;
        cells++; total++;
      });
    });
    const used = ws.columnCount || 0;
    for (let i = 1; i <= Math.min(used, 200); i++) {
      const w = ws.getColumn(i).width;
      if (w && Math.abs(w - 8.43) > 0.2) sheet.cols![colName(i)] = Math.round(w * 7 + 5);
    }
    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    if (view?.state === "frozen" && ((view.ySplit ?? 0) > 0 || (view.xSplit ?? 0) > 0)) sheet.freeze = { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 };
    const merges = (ws.model as { merges?: string[] }).merges;
    if (merges?.length) sheet.merges = merges.slice(0, 500);
    images += ws.getImages().length;
    cf += ((ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []).length;
    dv += Object.keys((ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model ?? {}).length;
    wb.sheets[sheet.id] = sheet;
    wb.order.push(sheet.id);
    intake.sheets.push({ name: sheet.name, cells, formulas, hidden });
    if (hidden) intake.warnings.push(`Sheet "${ws.name}" was hidden in the file; it is visible here so nothing it feeds is out of sight.`);
  }
  const names: Record<string, string> = {};
  for (const n of ((xl.definedNames as unknown as { model?: { name: string; ranges: string[] }[] }).model ?? [])) if (n.ranges?.[0] && !n.name.startsWith("_xlnm")) names[n.name] = n.ranges[0];
  if (Object.keys(names).length) wb.names = names;
  intake.unsupported = [...unsupported.entries()].map(([fn, count]) => ({ fn, count })).sort((a, b) => b.count - a.count);
  if (/\.xlsm$/i.test(file)) intake.dropped.push("macros (VBA)");
  if (images) intake.dropped.push(`${images} image${images === 1 ? "" : "s"}`);
  if (cf) intake.dropped.push(`${cf} conditional format${cf === 1 ? "" : "s"}`);
  if (dv) intake.dropped.push(`${dv} data validation rule${dv === 1 ? "" : "s"}`);
  intake.dropped.push("charts and pivot tables, if any (rebuild them as linked slides)");
  if (intake.truncated) intake.warnings.push(`Only the first ${MAX_CELLS.toLocaleString()} cells were imported.`);
  if (!wb.order.length) { const s: SheetData = { id: newId("sh"), name: "Sheet1", cells: {} }; wb.sheets[s.id] = s; wb.order.push(s.id); }
  return { workbook: wb, intake };
}

/** A .csv file as a one-sheet workbook. */
export function importCsv(text: string, file: string): { workbook: Workbook; intake: Intake } {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === "\"" && text[i + 1] === "\"") { cur += "\""; i++; } else if (ch === "\"") q = false; else cur += ch; continue; }
    if (ch === "\"") q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const sheet: SheetData = { id: newId("sh"), name: file.replace(/\.[^.]+$/, "").slice(0, 31) || "Sheet1", cells: {} };
  rows.slice(0, 20_000).forEach((r, i) => r.slice(0, 200).forEach((v, j) => {
    const t = v.trim();
    if (!t) return;
    const n = /^[-+]?[$]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?%?$/.test(t) ? Number(t.replace(/[$,%]/g, "")) / (t.endsWith("%") ? 100 : 1) : NaN;
    sheet.cells[`${colName(j + 1)}${i + 1}`] = t.startsWith("=") ? { f: t.slice(1) } : { v: Number.isFinite(n) ? n : t };
  }));
  return { workbook: { order: [sheet.id], sheets: { [sheet.id]: sheet } }, intake: { file, sheets: [{ name: sheet.name, cells: Object.keys(sheet.cells).length, formulas: 0, hidden: false }], unsupported: [], externalLinks: 0, dropped: [], truncated: rows.length > 20_000, warnings: [] } };
}

/** Functions Excel stores with a "_xlfn." prefix; without it Excel shows #NAME? until the cell is re-entered. */
const FUTURE = new Set(["XLOOKUP", "XMATCH", "IFS", "SWITCH", "MAXIFS", "MINIFS", "CONCAT", "TEXTJOIN", "IFNA", "DAYS", "RRI", "XOR", "STDEV.S", "STDEV.P", "VAR.S", "VAR.P", "PERCENTILE.INC", "QUARTILE.INC", "RANK.EQ", "CEILING.MATH", "FLOOR.MATH"]);

export function excelFormula(f: string): string {
  let toks;
  try { toks = tokenize(f); } catch { return f; }
  let out = "", last = 0;
  toks.forEach((t, i) => {
    if (t.t === "name" && FUTURE.has(t.v.toUpperCase()) && toks[i + 1]?.t === "(") { out += f.slice(last, t.s) + `_xlfn.${t.v.toUpperCase()}`; last = t.e; }
  });
  return out + f.slice(last);
}

const argb = (h?: string) => (h ? `FF${h.replace("#", "").toUpperCase()}` : undefined);
const borderStyle = (b?: CellStyle["bb"]): Partial<ExcelJS.Border> | undefined => (b ? { style: b === "double" ? "double" : b === "medium" ? "medium" : "thin" } : undefined);

export async function exportXlsx(doc: StudioDocData, engine: Engine): Promise<Buffer> {
  const xl = new ExcelJS.Workbook();
  xl.creator = "YouBank Studio";
  xl.created = new Date();
  xl.calcProperties.fullCalcOnLoad = true;
  for (const id of doc.workbook.order) {
    const s = doc.workbook.sheets[id];
    const ws = xl.addWorksheet(s.name.slice(0, 31), { views: s.freeze ? [{ state: "frozen", xSplit: s.freeze.cols, ySplit: s.freeze.rows }] : [{}] });
    for (const [col, px] of Object.entries(s.cols ?? {})) ws.getColumn(colIndex(col)).width = Math.max(2, (px - 5) / 7);
    for (const [a, cell] of Object.entries(s.cells)) {
      const c = ws.getCell(a);
      if (cell.f !== undefined) {
        const r = engine.get(id, a);
        c.value = { formula: excelFormula(cell.f), result: isErr(r) ? { error: r.code as ExcelJS.CellErrorValue["error"] } : r === null ? undefined : r } as ExcelJS.CellFormulaValue;
      } else if (cell.v !== undefined && cell.v !== null) c.value = cell.v;
      const st = cell.s;
      if (st) {
        if (st.b || st.i || st.u || st.color || st.size) c.font = { bold: st.b, italic: st.i, underline: st.u, size: st.size, color: st.color ? { argb: argb(st.color) } : undefined };
        if (st.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(st.fill) } };
        if (st.nf) c.numFmt = st.nf;
        if (st.al || st.indent || st.wrap) c.alignment = { horizontal: st.al, indent: st.indent, wrapText: st.wrap };
        if (st.bt || st.bb) c.border = { top: borderStyle(st.bt), bottom: borderStyle(st.bb) };
      }
      if (cell.src) c.note = `Source: ${cell.src}`;
    }
    for (const m of s.merges ?? []) { try { ws.mergeCells(m); } catch { /* overlapping merge from an import */ } }
    for (const t of s.sens ?? []) {
      const at = parseAddr(t.at);
      if (at) ws.getCell(t.at).note = `Data table computed by YouBank: ${t.title ?? "output"} = ${t.output} for ${t.rowInput} (down) × ${t.colInput} (across). Values, not formulas; refresh in YouBank after changing the model.`;
    }
  }
  for (const [name, ref] of Object.entries(doc.workbook.names ?? {})) { try { xl.definedNames.add(ref, name); } catch { /* invalid name */ } }
  return Buffer.from(await xl.xlsx.writeBuffer());
}
