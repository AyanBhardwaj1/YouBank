/**
 * Edits as patches. Every change to a Studio document, by a person or by the agent, is a patch: it is
 * applied in memory, stored, and streamed to everyone watching, in that order. The operations here
 * turn an intent ("insert two rows", "fill C5 across to G5") into the exact cell changes.
 */
import { addr as A1, cellsIn, colIndex, colName, parseAddr, parseRange, MAX_ROW, MAX_COL, type Rect } from "./address";
import { bankerFormat } from "./audit";
import type { Engine } from "./engine";
import { literal } from "./engine";
import { renameSheetInFormula, rewriteRefs, shiftFormula, translateFormula } from "./formula";
import type { CellData, CellStyle, Deck, DeckTheme, Scalar, Sensitivity, SheetData, Slide, StudioComment, StudioDocData } from "./types";
import { newId } from "./types";
import { isErr } from "./values";

export type Patch =
  | { op: "cells"; sheet: string; cells: Record<string, CellData | null> }
  | { op: "sheet_add"; sheet: SheetData; index?: number }
  | { op: "sheet_rename"; sheet: string; name: string }
  | { op: "sheet_delete"; sheet: string }
  | { op: "sheet_meta"; sheet: string; cols?: Record<string, number>; freeze?: { rows: number; cols: number } | null; sens?: Sensitivity[] }
  | { op: "slide_upsert"; slide: Slide; index?: number }
  | { op: "slide_delete"; id: string }
  | { op: "deck_order"; order: string[] }
  | { op: "deck_theme"; theme: DeckTheme }
  | { op: "comments"; comments: StudioComment[] }
  | { op: "title"; title: string }
  /** Defined names, merged; a null removes one. */
  | { op: "names"; names: Record<string, string | null> };

/** Apply a patch to a document in memory, keeping an engine (if given) in step. */
export function applyPatch(doc: StudioDocData, p: Patch, engine?: Engine): void {
  const wb = doc.workbook;
  switch (p.op) {
    case "cells": {
      const sheet = wb.sheets[p.sheet];
      if (!sheet) return;
      for (const [a, cell] of Object.entries(p.cells)) {
        if (engine) engine.setCell(p.sheet, a, cell);
        else if (cell) sheet.cells[a] = cell;
        else delete sheet.cells[a];
      }
      return;
    }
    case "sheet_add": {
      if (wb.sheets[p.sheet.id]) return;
      wb.sheets[p.sheet.id] = p.sheet;
      const i = p.index === undefined ? wb.order.length : Math.max(0, Math.min(wb.order.length, p.index));
      wb.order.splice(i, 0, p.sheet.id);
      engine?.rebuild();
      return;
    }
    case "sheet_rename": if (wb.sheets[p.sheet]) { wb.sheets[p.sheet].name = p.name; engine?.rebuild(); } return;
    case "sheet_delete": delete wb.sheets[p.sheet]; wb.order = wb.order.filter((x) => x !== p.sheet); engine?.rebuild(); return;
    case "sheet_meta": {
      const s = wb.sheets[p.sheet];
      if (!s) return;
      if (p.cols) s.cols = { ...s.cols, ...p.cols };
      if (p.freeze !== undefined) { if (p.freeze) s.freeze = p.freeze; else delete s.freeze; }
      if (p.sens) s.sens = p.sens;
      return;
    }
    case "slide_upsert": {
      const exists = !!doc.deck.slides[p.slide.id];
      doc.deck.slides[p.slide.id] = p.slide;
      if (!exists) {
        const i = p.index === undefined ? doc.deck.order.length : Math.max(0, Math.min(doc.deck.order.length, p.index));
        doc.deck.order.splice(i, 0, p.slide.id);
      }
      return;
    }
    case "slide_delete": delete doc.deck.slides[p.id]; doc.deck.order = doc.deck.order.filter((x) => x !== p.id); return;
    case "deck_order": doc.deck.order = p.order.filter((x) => doc.deck.slides[x]); return;
    case "deck_theme": doc.deck.theme = p.theme; return;
    case "comments": doc.comments = p.comments; return;
    case "title": doc.title = p.title; return;
    case "names": {
      const names = { ...(wb.names ?? {}) };
      for (const [k, v] of Object.entries(p.names)) { if (v === null) delete names[k]; else names[k] = v; }
      wb.names = names;
      engine?.rebuild();
      return;
    }
  }
}

/* ---------------- Helpers ---------------- */

export function sheetByName(doc: StudioDocData, name: string): SheetData | null {
  const wb = doc.workbook;
  const id = wb.order.find((x) => wb.sheets[x].name.toLowerCase() === name.trim().replace(/^'|'$/g, "").toLowerCase());
  return id ? wb.sheets[id] : wb.sheets[name] ?? null;
}

export function requireSheet(doc: StudioDocData, name: string): SheetData {
  const s = sheetByName(doc, name);
  if (!s) throw new Error(`There is no sheet named "${name}". Sheets: ${doc.workbook.order.map((x) => doc.workbook.sheets[x].name).join(", ")}`);
  return s;
}

export function uniqueSheetName(doc: StudioDocData, base: string): string {
  const taken = new Set(doc.workbook.order.map((x) => doc.workbook.sheets[x].name.toLowerCase()));
  const clean = base.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let i = 2; ; i++) { const n = `${clean.slice(0, 28)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
}

function boundedRect(range: string, sheet: SheetData): Rect {
  const r = parseRange(range);
  if (!r) throw new Error(`"${range}" is not a range like B4:G20`);
  let { r2, c2 } = r;
  if (r2 === MAX_ROW || c2 === MAX_COL) {
    let mr = 0, mc = 0;
    for (const a of Object.keys(sheet.cells)) { const p = parseAddr(a); if (p) { mr = Math.max(mr, p.r); mc = Math.max(mc, p.c); } }
    if (r2 === MAX_ROW) r2 = Math.max(r.r1, mr);
    if (c2 === MAX_COL) c2 = Math.max(r.c1, mc);
  }
  if ((r2 - r.r1 + 1) * (c2 - r.c1 + 1) > 50_000) throw new Error("That range is too large to edit at once (50,000 cells).");
  return { ...r, r2, c2 };
}

/** A value typed or written into a cell: "=…" is a formula, anything else a literal. */
export function cellFromInput(input: Scalar, prev?: CellData): CellData | null {
  const s = prev?.s;
  if (input === null || input === "") return s ? { s } : null;
  if (typeof input === "string" && input.startsWith("=") && input.length > 1) return { f: input.slice(1), ...(s ? { s } : {}) };
  const v = typeof input === "string" ? literal(input) : input;
  return { v, ...(s ? { s } : {}) };
}

/* ---------------- Cell operations ---------------- */

export function writeRange(doc: StudioDocData, sheetName: string, start: string, values: Scalar[][], style?: CellStyle): Patch {
  const sheet = requireSheet(doc, sheetName);
  const p = parseAddr(start.replace(/\$/g, ""));
  if (!p) throw new Error(`"${start}" is not a cell like B5`);
  const cells: Record<string, CellData | null> = {};
  values.forEach((row, i) => (Array.isArray(row) ? row : [row]).forEach((v, j) => {
    const a = A1(p.r + i, p.c + j);
    const next = cellFromInput(v === undefined ? null : v, sheet.cells[a]);
    cells[a] = next && style ? { ...next, s: { ...next.s, ...style } } : next;
  }));
  return { op: "cells", sheet: sheet.id, cells };
}

export function formatRange(doc: StudioDocData, sheetName: string, range: string, style: CellStyle): Patch {
  const sheet = requireSheet(doc, sheetName);
  const rect = boundedRect(range, sheet);
  const cells: Record<string, CellData | null> = {};
  for (const a of cellsIn(rect)) {
    const prev = sheet.cells[a] ?? {};
    const s = { ...prev.s, ...style };
    for (const k of Object.keys(s) as (keyof CellStyle)[]) if (s[k] === undefined || s[k] === null) delete s[k];
    cells[a] = { ...prev, s };
  }
  return { op: "cells", sheet: sheet.id, cells };
}

export function clearRange(doc: StudioDocData, sheetName: string, range: string, what: "all" | "contents" | "formats" = "contents"): Patch {
  const sheet = requireSheet(doc, sheetName);
  const rect = boundedRect(range, sheet);
  const cells: Record<string, CellData | null> = {};
  for (const a of cellsIn(rect)) {
    const prev = sheet.cells[a];
    if (!prev) continue;
    if (what === "all") cells[a] = null;
    else if (what === "formats") cells[a] = prev.f !== undefined || prev.v !== undefined ? { ...(prev.f !== undefined ? { f: prev.f } : { v: prev.v }) } : null;
    else cells[a] = prev.s ? { s: prev.s } : null;
  }
  return { op: "cells", sheet: sheet.id, cells };
}

/** Copy one cell's formula (or value) and format across a range, adjusting relative references. */
export function fillRange(doc: StudioDocData, sheetName: string, from: string, to: string): Patch {
  const sheet = requireSheet(doc, sheetName);
  const src = parseAddr(from.replace(/\$/g, ""));
  if (!src) throw new Error(`"${from}" is not a cell`);
  const cell = sheet.cells[A1(src.r, src.c)];
  if (!cell) throw new Error(`${from} is empty`);
  const rect = boundedRect(to, sheet);
  const cells: Record<string, CellData | null> = {};
  for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) {
    if (r === src.r && c === src.c) continue;
    const a = A1(r, c);
    cells[a] = cell.f !== undefined ? { f: translateFormula(cell.f, r - src.r, c - src.c), ...(cell.s ? { s: cell.s } : {}) } : { ...cell };
  }
  return { op: "cells", sheet: sheet.id, cells };
}

/** Insert (count > 0) or delete (count < 0) rows or columns, moving cells and fixing every formula that points at them. */
export function shiftCells(doc: StudioDocData, sheetName: string, axis: "r" | "c", at: number, count: number): Patch[] {
  const sheet = requireSheet(doc, sheetName);
  const moved: Record<string, CellData | null> = {};
  const next: Record<string, CellData> = {};
  const del = count < 0 ? -count : 0;
  for (const [a, cell] of Object.entries(sheet.cells)) {
    const p = parseAddr(a)!;
    const k = axis === "r" ? p.r : p.c;
    let nk = k;
    if (count > 0 && k >= at) nk = k + count;
    if (count < 0) { if (k >= at && k < at + del) nk = -1; else if (k >= at + del) nk = k - del; }
    const f = cell.f !== undefined ? shiftFormula(cell.f, sheet.name, sheet.name, axis, at, count) : undefined;
    if (nk === -1) { moved[a] = null; continue; }
    const na = axis === "r" ? A1(nk, p.c) : A1(p.r, nk);
    const nc = f !== undefined ? { ...cell, f } : cell;
    if (na !== a) moved[a] = null;
    next[na] = nc;
  }
  for (const [a, c] of Object.entries(next)) if (moved[a] === null || sheet.cells[a] !== c) moved[a] = c;
  const patches: Patch[] = [{ op: "cells", sheet: sheet.id, cells: moved }];
  for (const id of doc.workbook.order) {
    if (id === sheet.id) continue;
    const other = doc.workbook.sheets[id];
    const cells: Record<string, CellData | null> = {};
    for (const [a, cell] of Object.entries(other.cells)) {
      if (cell.f === undefined) continue;
      const f = shiftFormula(cell.f, other.name, sheet.name, axis, at, count);
      if (f !== cell.f) cells[a] = { ...cell, f };
    }
    if (Object.keys(cells).length) patches.push({ op: "cells", sheet: id, cells });
  }
  return patches;
}

export function addSheet(doc: StudioDocData, name: string, index?: number): { patch: Patch; sheet: SheetData } {
  const sheet: SheetData = { id: newId("sh"), name: uniqueSheetName(doc, name), cells: {}, cols: { A: 220 } };
  return { patch: { op: "sheet_add", sheet, index }, sheet };
}

export function renameSheet(doc: StudioDocData, from: string, to: string): Patch[] {
  const sheet = requireSheet(doc, from);
  const name = uniqueSheetName(doc, to);
  const patches: Patch[] = [];
  for (const id of doc.workbook.order) {
    const s = doc.workbook.sheets[id];
    const cells: Record<string, CellData | null> = {};
    for (const [a, cell] of Object.entries(s.cells)) {
      if (cell.f === undefined) continue;
      const f = renameSheetInFormula(cell.f, sheet.name, name);
      if (f !== cell.f) cells[a] = { ...cell, f };
    }
    if (Object.keys(cells).length) patches.push({ op: "cells", sheet: id, cells });
  }
  patches.unshift({ op: "sheet_rename", sheet: sheet.id, name });
  return patches;
}

export function deleteSheet(doc: StudioDocData, name: string): Patch[] {
  const sheet = requireSheet(doc, name);
  if (doc.workbook.order.length <= 1) throw new Error("A workbook needs at least one sheet.");
  const patches: Patch[] = [{ op: "sheet_delete", sheet: sheet.id }];
  for (const id of doc.workbook.order) {
    if (id === sheet.id) continue;
    const s = doc.workbook.sheets[id];
    const cells: Record<string, CellData | null> = {};
    for (const [a, cell] of Object.entries(s.cells)) {
      if (cell.f === undefined) continue;
      const f = rewriteRefs(cell.f, (r) => (r.sheet?.toLowerCase() === sheet.name.toLowerCase() ? null : r));
      if (f !== cell.f) cells[a] = { ...cell, f };
    }
    if (Object.keys(cells).length) patches.push({ op: "cells", sheet: id, cells });
  }
  return patches;
}

/* ---------------- Sensitivity tables ---------------- */

const SENS_FILL = "#F2F2F2";

/** Recompute every data table on a sheet (or all sheets) and write the results. */
export function refreshSensitivities(doc: StudioDocData, engine: Engine, only?: string): Patch[] {
  const patches: Patch[] = [];
  for (const id of doc.workbook.order) {
    if (only && id !== only) continue;
    const sheet = doc.workbook.sheets[id];
    for (const t of sheet.sens ?? []) {
      const at = parseAddr(t.at);
      if (!at) continue;
      const grid = engine.table(id, t.output, t.rowInput, t.colInput, t.rowValues, t.colValues);
      const cells: Record<string, CellData | null> = {};
      const rowNf = headerFormat(sheet, t.rowInput), colNf = headerFormat(sheet, t.colInput);
      cells[A1(at.r, at.c)] = { v: t.title ?? "Output", s: { b: true, i: true, al: "right", color: "#595959" } };
      t.colValues.forEach((v, j) => { cells[A1(at.r, at.c + 1 + j)] = { v, s: { b: true, nf: colNf, al: "right", bb: "thin", color: "#000000" } }; });
      t.rowValues.forEach((v, i) => {
        cells[A1(at.r + 1 + i, at.c)] = { v, s: { b: true, nf: rowNf, color: "#000000" } };
        grid[i].forEach((x, j) => { cells[A1(at.r + 1 + i, at.c + 1 + j)] = { v: isErr(x) ? x.code : x, s: { nf: t.nf, fill: SENS_FILL, color: "#000000" } }; });
      });
      patches.push({ op: "cells", sheet: id, cells });
    }
  }
  return patches;
}

function headerFormat(sheet: SheetData, ref: string): string | undefined {
  const a = ref.includes("!") ? ref.slice(ref.lastIndexOf("!") + 1) : ref;
  return sheet.cells[a.replace(/\$/g, "")]?.s?.nf;
}

export function addSensitivity(doc: StudioDocData, sheetName: string, t: Omit<Sensitivity, "id">): Patch {
  const sheet = requireSheet(doc, sheetName);
  return { op: "sheet_meta", sheet: sheet.id, sens: [...(sheet.sens ?? []).filter((x) => x.at !== t.at), { ...t, id: newId("sens") }] };
}

export function bankerFormatPatches(doc: StudioDocData, sheetName?: string): Patch[] {
  const only = sheetName ? requireSheet(doc, sheetName).id : undefined;
  return bankerFormat(doc.workbook, only).map((x) => ({ op: "cells" as const, sheet: x.sheet, cells: x.cells }));
}

/* ---------------- Deck operations ---------------- */

export function deckPatches(deck: Deck): Patch[] {
  return [{ op: "deck_theme", theme: deck.theme }, ...deck.order.map((id) => ({ op: "slide_upsert" as const, slide: deck.slides[id] }))];
}

/** A workbook's size in cells, for limits and summaries. */
export function cellCount(doc: StudioDocData) {
  return doc.workbook.order.reduce((n, id) => n + Object.keys(doc.workbook.sheets[id]?.cells ?? {}).length, 0);
}

export { colIndex, colName };

/* ---------------- Undo ---------------- */

const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** The patch that puts back what `p` is about to change. Compute it before applying `p`. */
export function inverseOf(doc: StudioDocData, p: Patch): Patch[] {
  const wb = doc.workbook;
  switch (p.op) {
    case "cells": {
      const s = wb.sheets[p.sheet];
      if (!s) return [];
      const cells: Record<string, CellData | null> = {};
      for (const a of Object.keys(p.cells)) cells[a] = s.cells[a] ? clone(s.cells[a]) : null;
      return [{ op: "cells", sheet: p.sheet, cells }];
    }
    case "sheet_add": return [{ op: "sheet_delete", sheet: p.sheet.id }];
    case "sheet_rename": return wb.sheets[p.sheet] ? [{ op: "sheet_rename", sheet: p.sheet, name: wb.sheets[p.sheet].name }] : [];
    case "sheet_delete": return wb.sheets[p.sheet] ? [{ op: "sheet_add", sheet: clone(wb.sheets[p.sheet]), index: wb.order.indexOf(p.sheet) }] : [];
    case "sheet_meta": {
      const s = wb.sheets[p.sheet];
      if (!s) return [];
      return [{
        op: "sheet_meta", sheet: p.sheet,
        ...(p.cols ? { cols: Object.fromEntries(Object.keys(p.cols).map((k) => [k, s.cols?.[k] ?? 64])) } : {}),
        ...(p.freeze !== undefined ? { freeze: s.freeze ?? null } : {}),
        ...(p.sens ? { sens: clone(s.sens ?? []) } : {}),
      }];
    }
    case "slide_upsert": { const prev = doc.deck.slides[p.slide.id]; return prev ? [{ op: "slide_upsert", slide: clone(prev) }] : [{ op: "slide_delete", id: p.slide.id }]; }
    case "slide_delete": { const prev = doc.deck.slides[p.id]; return prev ? [{ op: "slide_upsert", slide: clone(prev), index: doc.deck.order.indexOf(p.id) }] : []; }
    case "deck_order": return [{ op: "deck_order", order: [...doc.deck.order] }];
    case "deck_theme": return [{ op: "deck_theme", theme: { ...doc.deck.theme } }];
    case "comments": return [{ op: "comments", comments: clone(doc.comments) }];
    case "title": return [{ op: "title", title: doc.title }];
    case "names": return [{ op: "names", names: Object.fromEntries(Object.keys(p.names).map((k) => [k, wb.names?.[k] ?? null])) }];
  }
}

/**
 * Apply patches in order, collecting what undoes them (in the order to apply them). The document,
 * and the engine if given, are updated.
 */
export function applyWithUndo(doc: StudioDocData, patches: Patch[], engine?: Engine): Patch[] {
  const undo: Patch[][] = [];
  for (const p of patches) { undo.push(inverseOf(doc, p)); applyPatch(doc, p, engine); }
  return undo.reverse().flat();
}

/** A short description of what a set of patches did, for the history list. */
export function describePatches(doc: StudioDocData, patches: Patch[]): string {
  const parts: string[] = [];
  const cells = new Map<string, number>();
  for (const p of patches) {
    if (p.op === "cells") { const n = doc.workbook.sheets[p.sheet]?.name ?? "sheet"; cells.set(n, (cells.get(n) ?? 0) + Object.keys(p.cells).length); }
    else if (p.op === "sheet_add") parts.push(`added sheet ${p.sheet.name}`);
    else if (p.op === "sheet_rename") parts.push(`renamed a sheet to ${p.name}`);
    else if (p.op === "sheet_delete") parts.push("deleted a sheet");
    else if (p.op === "slide_upsert") parts.push(`slide "${p.slide.title}"`);
    else if (p.op === "slide_delete") parts.push("deleted a slide");
    else if (p.op === "comments") parts.push("comments");
    else if (p.op === "title") parts.push(`renamed to "${p.title}"`);
  }
  for (const [n, k] of cells) parts.unshift(`${k} cell${k === 1 ? "" : "s"} on ${n}`);
  return parts.slice(0, 4).join(", ") + (parts.length > 4 ? ` and ${parts.length - 4} more` : "");
}
