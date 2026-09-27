/**
 * YouBank for Excel: the bridge between a Studio document and the workbook open in Excel. It reads the
 * workbook into a snapshot Studio can diff, and applies Studio patches to the workbook as they stream
 * in, so the agent's edits appear in Excel cell by cell. Needs ExcelApi 1.9 (cell properties); every
 * function takes the request context of an Excel.run batch.
 */
/// <reference types="office-js" />
import { colName, parseAddr, MAX_COL, MAX_ROW } from "@/lib/studio/address";
import { applyPatch, type Patch } from "@/lib/studio/ops";
import type { Snapshot, SnapshotSheet } from "@/lib/studio/sync";
import type { CellData, CellStyle, SheetData, StudioDocData } from "@/lib/studio/types";
import { parseNumberText } from "@/lib/studio/values";

type Ctx = Excel.RequestContext;

export const EXCEL_API = "1.9";
/** Studio measures columns in pixels, Excel in points. */
const PT_PER_PX = 0.75;
const DEFAULT_PX = 88;
/** Cells read per sheet, and cells whose formats are read; beyond these a sheet is read in part. */
const MAX_VALUES = 150_000;
const MAX_STYLED = 25_000;

/* ---------------- Values ---------------- */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_TEXT = new RegExp(`^(?:(?:${MONTHS})[a-z]*\\.?[\\s\\-/]+\\d{1,4}|\\d{1,2}[\\s\\-/]+(?:${MONTHS})[a-z]*\\.?(?:[\\s\\-/]+\\d{2,4})?|\\d{1,4}[/\\-.]\\d{1,2}(?:[/\\-.]\\d{1,4})?|\\d{1,2}:\\d{2}.*)$`, "i");
const ERROR_TEXT = /^#(?:N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!)$/i;

/**
 * What to type into Excel for a Studio cell: a formula, a constant, or text protected with a leading
 * apostrophe where Excel would otherwise turn it into something else (a number, a date, a formula).
 */
export function excelInput(c: CellData | null | undefined): string | number | boolean {
  if (!c) return "";
  if (c.f !== undefined) return `=${c.f}`;
  const v = c.v;
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return v;
  const t = v.trim();
  return /^[=+\-@']/.test(v) || parseNumberText(v) !== null || /^(?:true|false)$/i.test(t) || DATE_TEXT.test(t) || ERROR_TEXT.test(t) ? `'${v}` : v;
}

/* ---------------- Formats ---------------- */

const BORDER = { thin: { style: "Continuous", weight: "Thin" }, medium: { style: "Continuous", weight: "Medium" }, double: { style: "Double" } } as const;

/** A Studio style as Excel cell properties. Everything Studio can set is stated, so an old format never lingers. */
export function excelFormat(s?: CellStyle): Excel.CellPropertiesFormat {
  const indent = s?.indent ?? 0;
  const al = s?.al ?? (indent ? "left" : undefined);
  return {
    font: { bold: !!s?.b, italic: !!s?.i, underline: s?.u ? "Single" : "None", color: s?.color ?? "#000000", ...(s?.size ? { size: s.size } : {}) },
    horizontalAlignment: al === "left" ? "Left" : al === "center" ? "Center" : al === "right" ? "Right" : "General",
    indentLevel: indent,
    wrapText: !!s?.wrap,
    ...(s?.fill ? { fill: { color: s.fill } } : {}),
    ...(s?.bt || s?.bb ? { borders: { ...(s.bt ? { top: { ...BORDER[s.bt] } } : {}), ...(s.bb ? { bottom: { ...BORDER[s.bb] } } : {}) } } : {}),
  };
}

function borderOf(b?: Excel.CellBorder): CellStyle["bt"] {
  if (!b?.style || b.style === "None") return undefined;
  if (b.style === "Double") return "double";
  return b.weight === "Medium" || b.weight === "Thick" ? "medium" : "thin";
}

/** Excel's formats for one cell as a Studio style. */
export function styleFromExcel(p: Excel.CellProperties | undefined, nf: string | undefined): CellStyle | undefined {
  const s: CellStyle = {};
  const f = p?.format;
  if (f?.font?.bold) s.b = true;
  if (f?.font?.italic) s.i = true;
  if (f?.font?.underline && f.font.underline !== "None") s.u = true;
  if (f?.font?.color && /^#[0-9A-F]{6}$/i.test(f.font.color) && !/^#0{6}$/.test(f.font.color)) s.color = f.font.color.toUpperCase();
  if (f?.font?.size && f.font.size !== 11 && f.font.size !== 10) s.size = f.font.size;
  if (f?.fill?.color && /^#[0-9A-F]{6}$/i.test(f.fill.color) && !/^#F{6}$/i.test(f.fill.color) && f.fill.pattern !== "None") s.fill = f.fill.color.toUpperCase();
  const al = f?.horizontalAlignment;
  if (al === "Center" || al === "Right") s.al = al === "Center" ? "center" : "right";
  if (f?.indentLevel) s.indent = f.indentLevel;
  if (f?.wrapText) s.wrap = true;
  const bt = borderOf(f?.borders?.top), bb = borderOf(f?.borders?.bottom);
  if (bt) s.bt = bt;
  if (bb) s.bb = bb;
  if (nf && nf !== "General") s.nf = nf;
  return Object.keys(s).length ? s : undefined;
}

const CELL_LOAD: Excel.CellPropertiesLoadOptions = {
  format: {
    font: { bold: true, italic: true, underline: true, color: true, size: true },
    fill: { color: true, pattern: true },
    horizontalAlignment: true, indentLevel: true, wrapText: true,
    borders: { style: true, weight: true },
  },
};

/* ---------------- Writing ---------------- */

type Run = { r: number; c: number; cells: (CellData | null)[] };

/** Cells grouped into runs along a row: one Excel range per run instead of one per cell. */
export function runsOf(cells: Record<string, CellData | null>): Run[] {
  const list = Object.entries(cells).flatMap(([a, c]) => { const p = parseAddr(a); return p ? [{ p, c }] : []; }).sort((x, y) => x.p.r - y.p.r || x.p.c - y.p.c);
  const out: Run[] = [];
  for (const { p, c } of list) {
    const last = out[out.length - 1];
    if (last && last.r === p.r && last.c + last.cells.length === p.c && (last.cells[0] === null) === (c === null)) last.cells.push(c);
    else out.push({ r: p.r, c: p.c, cells: [c] });
  }
  return out;
}

function writeRun(ws: Excel.Worksheet, run: Run) {
  const rg = ws.getRangeByIndexes(run.r - 1, run.c - 1, 1, run.cells.length);
  if (run.cells[0] === null) { rg.clear("All"); return; }
  const cs = run.cells as CellData[];
  rg.numberFormat = [cs.map((c) => c.s?.nf ?? "General")];
  rg.formulas = [cs.map(excelInput)];
  rg.format.fill.clear();
  rg.format.borders.getItem("EdgeTop").style = "None";
  rg.format.borders.getItem("EdgeBottom").style = "None";
  rg.setCellProperties([cs.map((c) => ({ format: excelFormat(c.s) }))]);
}

function setWidths(ws: Excel.Worksheet, cols: Record<string, number>) {
  for (const [c, px] of Object.entries(cols)) ws.getRange(`${c}:${c}`).format.columnWidth = Math.max(1, px) * PT_PER_PX;
}

function setFreeze(ws: Excel.Worksheet, f: { rows: number; cols: number } | null | undefined) {
  ws.freezePanes.unfreeze();
  if (!f || (!f.rows && !f.cols)) return;
  if (f.rows && f.cols) ws.freezePanes.freezeAt(ws.getRangeByIndexes(0, 0, f.rows, f.cols));
  else if (f.rows) ws.freezePanes.freezeRows(f.rows);
  else ws.freezePanes.freezeColumns(f.cols);
}

/** Every column up to the last one the sheet uses, at Studio's width, so reading the sheet back gives the same widths. */
function widthsFor(sheet: SheetData): Record<string, number> {
  let last = 0;
  for (const a of Object.keys(sheet.cells)) last = Math.max(last, parseAddr(a)?.c ?? 0);
  const out: Record<string, number> = {};
  for (let c = 1; c <= last; c++) out[colName(c)] = sheet.cols?.[colName(c)] ?? DEFAULT_PX;
  for (const [c, w] of Object.entries(sheet.cols ?? {})) out[c] = w;
  return out;
}

function writeSheet(ws: Excel.Worksheet, sheet: SheetData, clear: boolean) {
  if (clear) ws.getRange().clear("All");
  for (const run of runsOf(sheet.cells)) writeRun(ws, run);
  setWidths(ws, widthsFor(sheet));
  setFreeze(ws, sheet.freeze);
  if (sheet.tab) ws.tabColor = sheet.tab;
}

async function sheetMap(ctx: Ctx): Promise<Map<string, Excel.Worksheet>> {
  const wss = ctx.workbook.worksheets;
  wss.load("items/name");
  await ctx.sync();
  return new Map(wss.items.map((w) => [w.name.toLowerCase(), w]));
}

async function setNames(ctx: Ctx, names: Record<string, string | null>, failed: string[]) {
  const col = ctx.workbook.names;
  col.load("items/name");
  await ctx.sync();
  const have = new Map(col.items.map((n) => [n.name.toLowerCase(), n]));
  for (const [k, v] of Object.entries(names)) {
    try {
      have.get(k.toLowerCase())?.delete();
      if (v) col.add(k, `=${v.replace(/^=/, "")}`);
      await ctx.sync();
    } catch { failed.push(`name ${k}`); }
  }
}

export type ApplyResult = { failed: string[]; cells: number };

/**
 * Apply Studio patches to the workbook. `mirror` is the Studio document as Excel last saw it; it is kept
 * in step (it is how sheet ids map to Excel's sheet names), whether or not Excel accepts every write.
 * One round trip per patch, so a formula Excel rejects costs that patch a slower retry, not the batch.
 */
export async function applyPatches(ctx: Ctx, mirror: StudioDocData, patches: Patch[]): Promise<ApplyResult> {
  const failed: string[] = [];
  let cells = 0;
  const sheets = await sheetMap(ctx);
  const ws = (id: string) => { const n = mirror.workbook.sheets[id]?.name; return n ? sheets.get(n.toLowerCase()) : undefined; };
  // New sheets first, so a formula that points at a sheet added in the same change finds it.
  const fresh = new Set<string>();
  for (const p of patches) {
    if (p.op !== "sheet_add") continue;
    const key = p.sheet.name.toLowerCase();
    if (!sheets.has(key)) { sheets.set(key, ctx.workbook.worksheets.add(p.sheet.name)); fresh.add(key); }
  }
  for (const p of patches) {
    try {
      switch (p.op) {
        case "cells": { const w = ws(p.sheet); if (w) { for (const run of runsOf(p.cells)) writeRun(w, run); cells += Object.keys(p.cells).length; } break; }
        case "sheet_add": {
          const w = sheets.get(p.sheet.name.toLowerCase())!;
          writeSheet(w, p.sheet, !fresh.has(p.sheet.name.toLowerCase()));
          if (p.index !== undefined) w.position = p.index;
          cells += Object.keys(p.sheet.cells).length;
          break;
        }
        case "sheet_rename": {
          const w = ws(p.sheet);
          if (w) { sheets.delete(mirror.workbook.sheets[p.sheet].name.toLowerCase()); w.name = p.name; sheets.set(p.name.toLowerCase(), w); }
          break;
        }
        case "sheet_delete": {
          const w = ws(p.sheet);
          if (w) { w.delete(); sheets.delete(mirror.workbook.sheets[p.sheet].name.toLowerCase()); }
          break;
        }
        case "sheet_order": p.order.forEach((id, i) => { const w = ws(id); if (w) w.position = i; }); break;
        case "sheet_meta": { const w = ws(p.sheet); if (w) { if (p.cols) setWidths(w, p.cols); if (p.freeze !== undefined) setFreeze(w, p.freeze); } break; }
        case "names": await setNames(ctx, p.names, failed); break;
        default: break; // the deck, comments and the title live in Studio and PowerPoint
      }
      await ctx.sync();
    } catch {
      if (p.op === "cells") await retryCells(ctx, ws(p.sheet), p.cells, failed, mirror.workbook.sheets[p.sheet]?.name ?? "");
      else failed.push(p.op === "sheet_add" ? `sheet ${p.sheet.name}` : p.op);
    }
    applyPatch(mirror, structuredClone(p));
  }
  return { failed, cells };
}

/** After a rejected batch: run by run, then cell by cell, so one bad formula costs one cell. */
async function retryCells(ctx: Ctx, w: Excel.Worksheet | undefined, cells: Record<string, CellData | null>, failed: string[], sheet: string) {
  if (!w) return;
  for (const run of runsOf(cells)) {
    try { writeRun(w, run); await ctx.sync(); continue; } catch { /* narrow down */ }
    for (let i = 0; i < run.cells.length; i++) {
      try { writeRun(w, { r: run.r, c: run.c + i, cells: [run.cells[i]] }); await ctx.sync(); }
      catch { failed.push(`${sheet}!${colName(run.c + i)}${run.r}`); }
    }
  }
}

/**
 * Put a whole Studio document into the workbook: its sheets (replacing same-named ones), names and
 * order. Empty sheets the model does not have (the new workbook's Sheet1) are removed.
 */
export async function writeWorkbook(ctx: Ctx, doc: StudioDocData): Promise<ApplyResult> {
  const mirror: StudioDocData = { ...doc, workbook: { order: [], sheets: {} } };
  const result = await applyPatches(ctx, mirror, doc.workbook.order.map((id) => ({ op: "sheet_add" as const, sheet: doc.workbook.sheets[id] })));
  const wss = ctx.workbook.worksheets;
  wss.load("items/name");
  await ctx.sync();
  const keep = new Set(doc.workbook.order.map((id) => doc.workbook.sheets[id].name.toLowerCase()));
  const extra = wss.items.filter((w) => !keep.has(w.name.toLowerCase())).map((w) => ({ w, used: w.getUsedRangeOrNullObject(false) }));
  extra.forEach((x) => x.used.load("address"));
  await ctx.sync();
  for (const x of extra) if (x.used.isNullObject) x.w.delete();
  const order = doc.workbook.order.map((id) => doc.workbook.sheets[id].name.toLowerCase());
  const byName = new Map(wss.items.map((w) => [w.name.toLowerCase(), w]));
  order.forEach((n, i) => { const w = byName.get(n); if (w) w.position = i; });
  await ctx.sync().catch(() => result.failed.push("sheet order"));
  if (doc.workbook.names && Object.keys(doc.workbook.names).length) await setNames(ctx, doc.workbook.names, result.failed);
  return result;
}

/* ---------------- Reading ---------------- */

const scalar = (v: unknown): CellData["v"] => (typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null);

/**
 * The workbook as a snapshot for Studio: values, formulas (with Excel's results), formats, column
 * widths, frozen panes and names. `only` limits it to some worksheets (by id) for a quick sync after
 * an edit; a very large sheet is read in part and says where it stopped.
 */
export async function readSnapshot(ctx: Ctx, only?: Set<string>): Promise<{ snapshot: Snapshot; warnings: string[] }> {
  const wss = ctx.workbook.worksheets;
  wss.load("items/name,items/id");
  const names = ctx.workbook.names;
  names.load("items/name,items/type,items/formula,items/visible");
  await ctx.sync();
  const list = wss.items.filter((w) => !only || only.has(w.id));
  const probes = list.map((w) => {
    const used = w.getUsedRangeOrNullObject(false);
    used.load("rowIndex,columnIndex,rowCount,columnCount");
    const frozen = w.freezePanes.getLocationOrNullObject();
    frozen.load("rowCount,columnCount");
    return { w, used, frozen };
  });
  await ctx.sync();
  const warnings: string[] = [];
  const reads = probes.map(({ w, used, frozen }) => {
    if (used.isNullObject) return { w, frozen, rng: null, props: null, cols: null, lastRow: undefined as number | undefined };
    const rows = Math.min(used.rowCount, Math.max(1, Math.floor(MAX_VALUES / Math.max(1, used.columnCount))));
    const rng = w.getRangeByIndexes(used.rowIndex, used.columnIndex, rows, used.columnCount);
    rng.load("formulas,values,numberFormat,rowIndex,columnIndex,rowCount,columnCount");
    const props = rows * used.columnCount <= MAX_STYLED ? rng.getCellProperties(CELL_LOAD) : null;
    const cols = rng.getColumnProperties({ columnIndex: true, format: { columnWidth: true } });
    if (rows < used.rowCount) warnings.push(`${w.name}: read the first ${used.rowIndex + rows} rows of ${used.rowIndex + used.rowCount}`);
    if (!props) warnings.push(`${w.name}: too large to read formats; Studio keeps its own`);
    return { w, frozen, rng, props, cols, lastRow: rows < used.rowCount ? used.rowIndex + rows : undefined };
  });
  await ctx.sync();
  const sheets: SnapshotSheet[] = reads.map(({ w, frozen, rng, props, cols, lastRow }) => {
    const freeze = frozen.isNullObject ? null : { rows: frozen.rowCount >= MAX_ROW ? 0 : frozen.rowCount, cols: frozen.columnCount >= MAX_COL ? 0 : frozen.columnCount };
    if (!rng) return { name: w.name, cells: {}, styles: true, freeze };
    const cells: Record<string, CellData> = {};
    for (let r = 0; r < rng.rowCount; r++) {
      for (let c = 0; c < rng.columnCount; c++) {
        const f = rng.formulas[r][c], v = rng.values[r][c];
        const cell: CellData = {};
        if (typeof f === "string" && f.startsWith("=") && f !== v) { cell.f = f.slice(1); const cv = scalar(v); if (cv !== null && cv !== "") cell.cv = cv; }
        else if (v !== "" && v !== null && v !== undefined) cell.v = scalar(v);
        const s = styleFromExcel(props?.value[r]?.[c], rng.numberFormat[r]?.[c]);
        if (s) cell.s = s;
        if (cell.f !== undefined || (cell.v !== undefined && cell.v !== null) || cell.s) cells[`${colName(rng.columnIndex + c + 1)}${rng.rowIndex + r + 1}`] = cell;
      }
    }
    const widths: Record<string, number> = {};
    for (const col of cols?.value ?? []) if (col.columnIndex !== undefined && col.format?.columnWidth !== undefined) widths[colName(col.columnIndex + 1)] = Math.round(col.format.columnWidth / PT_PER_PX);
    return { name: w.name, cells, cols: widths, freeze, styles: !!props, ...(lastRow ? { lastRow } : {}) };
  });
  const nameMap: Record<string, string> = {};
  for (const n of names.items) if (n.type === "Range" && n.visible && typeof n.formula === "string") nameMap[n.name] = n.formula.replace(/^=/, "");
  return { snapshot: { sheets, ...(only ? { partial: true } : { names: nameMap }) }, warnings };
}

/* ---------------- Selection and focus ---------------- */

/** Show where the agent is writing: activate the sheet and select the range. */
export async function focusRange(ctx: Ctx, sheet: string, range: string) {
  const w = ctx.workbook.worksheets.getItemOrNullObject(sheet);
  await ctx.sync();
  if (w.isNullObject) return;
  w.activate();
  w.getRange(range.split(":").map((x) => x.replace(/\$/g, "")).join(":")).select();
  await ctx.sync();
}

/** The person's selection, as a sheet name and an A1 range. */
export async function currentSelection(ctx: Ctx): Promise<{ sheet: string; range: string } | null> {
  const r = ctx.workbook.getSelectedRange();
  r.load("address");
  const w = r.worksheet;
  w.load("name");
  await ctx.sync();
  const range = r.address.includes("!") ? r.address.slice(r.address.lastIndexOf("!") + 1) : r.address;
  return { sheet: w.name, range: range.replace(/\$/g, "") };
}

/** Worksheet ids to names, for turning change events into a partial snapshot. */
export async function sheetIds(ctx: Ctx): Promise<Map<string, string>> {
  const wss = ctx.workbook.worksheets;
  wss.load("items/name,items/id");
  await ctx.sync();
  return new Map(wss.items.map((w) => [w.id, w.name]));
}
