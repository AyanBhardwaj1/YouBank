/**
 * Syncing with a real workbook. The Excel add-in reads the open file into a snapshot; diffWorkbook turns
 * the snapshot into the smallest set of patches that makes the Studio document match it, so the sync
 * is one undoable change and the history shows what changed in Excel. Sheets are matched by name.
 */
import { parseAddr } from "./address";
import { applyPatch, type Patch } from "./ops";
import { emptyDeck, newId, type CellData, type CellStyle, type Scalar, type StudioDocData, type Workbook } from "./types";

export type SnapshotSheet = {
  name: string;
  cells: Record<string, CellData>;
  cols?: Record<string, number>;
  freeze?: { rows: number; cols: number } | null;
  /** False when the sheet was too large to read formats; existing formats are then kept. */
  styles: boolean;
  /** Rows below this were not read (a very large sheet); Studio's cells there are left alone. */
  lastRow?: number;
  /** Only the sheet's name and position were sent; its cells are left alone. */
  skip?: boolean;
};
/** `partial`: only some sheets were read, so sheets missing from the snapshot are kept and the order is left alone. */
export type Snapshot = { sheets: SnapshotSheet[]; names?: Record<string, string>; partial?: boolean };

/** Excel's standard column width (8.43 characters of Calibri 11), in pixels. */
const EXCEL_DEFAULT_PX = 64;

/** Formats that mean "nothing set", as Excel reports them. */
function normStyle(s?: CellStyle): CellStyle {
  const out: CellStyle = {};
  if (!s) return out;
  if (s.b) out.b = true;
  if (s.i) out.i = true;
  if (s.u) out.u = true;
  if (s.color && !/^#0{6}$/i.test(s.color)) out.color = s.color.toUpperCase();
  if (s.fill && !/^#F{6}$/i.test(s.fill)) out.fill = s.fill.toUpperCase();
  if (s.nf && s.nf !== "General") out.nf = s.nf;
  if (s.al && s.al !== "left") out.al = s.al;
  if (s.indent) out.indent = s.indent;
  if (s.bt) out.bt = s.bt;
  if (s.bb) out.bb = s.bb;
  if (s.size && s.size !== 11 && s.size !== 10) out.size = s.size;
  if (s.wrap) out.wrap = true;
  return out;
}

const sameStyle = (a?: CellStyle, b?: CellStyle) => JSON.stringify(normStyle(a)) === JSON.stringify(normStyle(b));

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
  const blank = (x: unknown) => (x === "" || x === undefined ? null : x);
  return blank(a) === blank(b);
}

const normFormula = (f?: string) => (f === undefined ? undefined : f.replace(/^=/, "").replace(/_xl(?:fn|ws)\./gi, ""));

/** Formula text as Excel compares it: case does not matter outside quoted strings. */
function canonFormula(f?: string): string | undefined {
  const n = normFormula(f);
  if (n === undefined) return undefined;
  return n.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.toUpperCase())).join("");
}

function sameContent(a?: CellData, b?: CellData): boolean {
  const fa = canonFormula(a?.f), fb = canonFormula(b?.f);
  if (fa !== undefined || fb !== undefined) return fa === fb;
  return sameValue(a?.v ?? null, b?.v ?? null);
}

const hasContent = (c?: CellData) => !!c && (c.f !== undefined || (c.v !== undefined && c.v !== null && c.v !== ""));

/**
 * The cell the Studio document should hold, given what Excel has and what Studio had. Excel's computed
 * value rides along as `cv` (shown where YouBank does not support a function), but a changed result on
 * its own is not an edit: Studio recalculates for itself.
 */
function merged(snap: CellData, cur: CellData | undefined, styles: boolean): CellData | null {
  const out: CellData = {};
  if (snap.f !== undefined) {
    out.f = cur?.f !== undefined && canonFormula(cur.f) === canonFormula(snap.f) ? cur.f : normFormula(snap.f);
    if (snap.cv !== undefined && snap.cv !== null) out.cv = snap.cv;
  } else if (snap.v !== undefined && snap.v !== null && snap.v !== "") out.v = snap.v;
  const s = styles ? normStyle(snap.s) : cur?.s;
  if (s && Object.keys(s).length) out.s = s;
  if (cur?.src && sameContent(cur, snap)) out.src = cur.src;
  return out.f !== undefined || out.v !== undefined || out.s ? out : null;
}

export function diffWorkbook(current: Workbook, snap: Snapshot): Patch[] {
  const patches: Patch[] = [];
  const byName = new Map(current.order.map((id) => [current.sheets[id].name.toLowerCase(), id]));
  const seen = new Set<string>();
  const finalOrder: string[] = [];
  for (const ss of snap.sheets) {
    const id = byName.get(ss.name.toLowerCase());
    if (!id) {
      const cells = Object.fromEntries(Object.entries(ss.skip ? {} : ss.cells).map(([a, c]) => [a, merged(c, undefined, ss.styles)]).filter(([, c]) => c)) as Record<string, CellData>;
      const sheet = { id: newId("sh"), name: ss.name, cells, cols: ss.cols ?? {}, ...(ss.freeze && (ss.freeze.rows || ss.freeze.cols) ? { freeze: ss.freeze } : {}) };
      patches.push({ op: "sheet_add", sheet });
      finalOrder.push(sheet.id);
      continue;
    }
    seen.add(id);
    finalOrder.push(id);
    const sheet = current.sheets[id];
    if (sheet.name !== ss.name) patches.push({ op: "sheet_rename", sheet: id, name: ss.name });
    if (ss.skip) continue;
    const cells: Record<string, CellData | null> = {};
    for (const a of new Set([...Object.keys(sheet.cells), ...Object.keys(ss.cells)])) {
      const cur = sheet.cells[a], sc = ss.cells[a];
      if (ss.lastRow !== undefined && (parseAddr(a)?.r ?? 0) > ss.lastRow) continue;
      if (!sc) {
        if (!cur) continue;
        if (hasContent(cur)) cells[a] = !ss.styles && cur.s ? { s: cur.s } : null;
        else if (ss.styles && cur.s && Object.keys(normStyle(cur.s)).length) cells[a] = null;
        continue;
      }
      const next = merged(sc, cur, ss.styles);
      if (!next) { if (cur) cells[a] = null; continue; }
      if (!cur || !sameContent(cur, next) || !sameStyle(cur.s, next.s)) cells[a] = next;
    }
    if (Object.keys(cells).length) patches.push({ op: "cells", sheet: id, cells });
    const meta: Extract<Patch, { op: "sheet_meta" }> = { op: "sheet_meta", sheet: id };
    if (ss.cols) {
      const cols: Record<string, number> = {};
      // A column Studio never sized, at Excel's default width (64 px), is not an edit.
      for (const [c, w] of Object.entries(ss.cols)) if (Math.abs((sheet.cols?.[c] ?? 88) - w) > 2 && !(sheet.cols?.[c] === undefined && Math.abs(w - EXCEL_DEFAULT_PX) <= 1)) cols[c] = Math.round(w);
      if (Object.keys(cols).length) meta.cols = cols;
    }
    if (ss.freeze !== undefined) {
      const a = sheet.freeze && (sheet.freeze.rows || sheet.freeze.cols) ? sheet.freeze : null;
      const b = ss.freeze && (ss.freeze.rows || ss.freeze.cols) ? ss.freeze : null;
      // Field by field: a document read back from Postgres has its keys in jsonb's order, not ours.
      if (a?.rows !== b?.rows || a?.cols !== b?.cols) meta.freeze = b;
    }
    if (meta.cols || meta.freeze !== undefined) patches.push(meta);
  }
  if (!snap.partial) {
    for (const id of current.order) if (!seen.has(id)) patches.push({ op: "sheet_delete", sheet: id });
    const kept = current.order.filter((id) => seen.has(id));
    const keptInSnapOrder = finalOrder.filter((id) => seen.has(id));
    if (JSON.stringify(kept) !== JSON.stringify(keptInSnapOrder) || finalOrder.some((id) => !seen.has(id))) patches.push({ op: "sheet_order", order: finalOrder });
    if (snap.names) {
      const names: Record<string, string | null> = {};
      const norm = (r?: string) => r?.replace(/^=/, "").replace(/\$/g, "").toUpperCase();
      for (const [k, v] of Object.entries(snap.names)) if (norm(current.names?.[k]) !== norm(v)) names[k] = v.replace(/^=/, "");
      for (const k of Object.keys(current.names ?? {})) if (!(k in snap.names)) names[k] = null;
      if (Object.keys(names).length) patches.push({ op: "names", names });
    }
  }
  return patches;
}

/** Workbook-level summary of a sync, for the history line. */
export function describeSync(patches: Patch[]): string {
  const cells = patches.reduce((n, p) => n + (p.op === "cells" ? Object.keys(p.cells).length : 0), 0);
  const added = patches.filter((p) => p.op === "sheet_add").length, deleted = patches.filter((p) => p.op === "sheet_delete").length;
  const renamed = patches.filter((p) => p.op === "sheet_rename").length;
  const parts = [
    cells ? `${cells} cell${cells === 1 ? "" : "s"}` : "", added ? `${added} new sheet${added === 1 ? "" : "s"}` : "",
    renamed ? `${renamed} renamed sheet${renamed === 1 ? "" : "s"}` : "", deleted ? `${deleted} removed sheet${deleted === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? `Synced from Excel: ${parts.join(", ")}` : "Synced from Excel: layout";
}

/** A new Studio workbook holding exactly what the snapshot holds (linking an Excel file for the first time). */
export function workbookFromSnapshot(snap: Snapshot): Workbook {
  const doc: StudioDocData = { title: "", workbook: { order: [], sheets: {} }, deck: emptyDeck(), comments: [] };
  for (const p of diffWorkbook(doc.workbook, { ...snap, partial: false })) applyPatch(doc, p);
  if (!doc.workbook.order.length) for (const p of diffWorkbook(doc.workbook, { sheets: [{ name: "Sheet1", cells: {}, styles: true }] })) applyPatch(doc, p);
  return doc.workbook;
}

/* ---------------- Checking what an add-in sends ---------------- */

const MAX_CELLS = 400_000;

function scalar(v: unknown): Scalar | undefined {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return v.slice(0, 32_767);
  return undefined;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
function cleanStyle(x: unknown): CellStyle | undefined {
  if (!x || typeof x !== "object") return undefined;
  const s = x as Record<string, unknown>, out: CellStyle = {};
  for (const k of ["b", "i", "u", "wrap"] as const) if (s[k] === true) out[k] = true;
  if (typeof s.color === "string" && HEX.test(s.color)) out.color = s.color;
  if (typeof s.fill === "string" && HEX.test(s.fill)) out.fill = s.fill;
  if (typeof s.nf === "string" && s.nf.length <= 255) out.nf = s.nf;
  if (s.al === "left" || s.al === "center" || s.al === "right") out.al = s.al;
  if (typeof s.indent === "number" && s.indent > 0 && s.indent <= 15) out.indent = Math.round(s.indent);
  for (const k of ["bt", "bb"] as const) if (s[k] === "thin" || s[k] === "medium" || s[k] === "double") out[k] = s[k];
  if (typeof s.size === "number" && s.size >= 1 && s.size <= 409) out.size = s.size;
  return Object.keys(out).length ? out : undefined;
}

function cleanCell(x: unknown): CellData | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Record<string, unknown>, out: CellData = {};
  if (typeof c.f === "string" && c.f.length > 0 && c.f.length <= 8192) {
    out.f = c.f.replace(/^=/, "");
    const cv = scalar(c.cv);
    if (cv !== undefined) out.cv = cv;
  } else {
    const v = scalar(c.v);
    if (v !== undefined && v !== null) out.v = v;
  }
  const s = cleanStyle(c.s);
  if (s) out.s = s;
  return out.f !== undefined || out.v !== undefined || out.s ? out : null;
}

/** Shape checks for a snapshot an add-in sends, before it is compared with anything. */
export function validSnapshot(x: unknown): Snapshot | null {
  if (!x || typeof x !== "object") return null;
  const raw = x as { sheets?: unknown; names?: unknown; partial?: unknown };
  if (!Array.isArray(raw.sheets) || raw.sheets.length > 200) return null;
  let total = 0;
  const sheets: SnapshotSheet[] = [];
  const names = new Set<string>();
  for (const r of raw.sheets as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.name !== "string") return null;
    const name = r.name.trim();
    if (!name || name.length > 31 || /[\][:*?/\\]/.test(name) || names.has(name.toLowerCase())) return null;
    names.add(name.toLowerCase());
    const cells: Record<string, CellData> = {};
    if (r.cells !== undefined) {
      if (!r.cells || typeof r.cells !== "object" || Array.isArray(r.cells)) return null;
      for (const [a, c] of Object.entries(r.cells as Record<string, unknown>)) {
        if (!parseAddr(a)) return null;
        if (++total > MAX_CELLS) return null;
        const cell = cleanCell(c);
        if (cell) cells[a] = cell;
      }
    }
    const cols: Record<string, number> = {};
    if (r.cols && typeof r.cols === "object") for (const [k, v] of Object.entries(r.cols as Record<string, unknown>)) if (/^[A-Z]{1,3}$/.test(k) && typeof v === "number" && v >= 0 && v <= 2000) cols[k] = v;
    const fz = r.freeze as { rows?: unknown; cols?: unknown } | null | undefined;
    const freeze = fz === null ? null : fz && typeof fz.rows === "number" && typeof fz.cols === "number" ? { rows: Math.max(0, Math.min(1000, Math.round(fz.rows))), cols: Math.max(0, Math.min(100, Math.round(fz.cols))) } : undefined;
    sheets.push({
      name, cells, styles: r.styles !== false, ...(Object.keys(cols).length ? { cols } : {}), ...(freeze !== undefined ? { freeze } : {}),
      ...(typeof r.lastRow === "number" && r.lastRow > 0 ? { lastRow: Math.round(r.lastRow) } : {}), ...(r.skip === true ? { skip: true } : {}),
    });
  }
  let nameMap: Record<string, string> | undefined;
  if (raw.names && typeof raw.names === "object") {
    nameMap = {};
    for (const [k, v] of Object.entries(raw.names as Record<string, unknown>)) if (/^[A-Za-z_\\][\w.]{0,254}$/.test(k) && typeof v === "string" && v.length <= 1000) nameMap[k] = v;
  }
  return { sheets, ...(nameMap ? { names: nameMap } : {}), partial: raw.partial === true };
}
