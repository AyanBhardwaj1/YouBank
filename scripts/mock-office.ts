/**
 * A small in-memory stand-in for the parts of the Excel and PowerPoint JavaScript APIs the YouBank
 * add-in uses, so the adapters can be tested without Office. It follows Excel's behaviour where it
 * matters to the adapter: typed text becomes numbers, dates and booleans unless it starts with an
 * apostrophe; formats persist until cleared; the used range covers formatted cells; frozen panes
 * report whole rows or columns; names that look like cell addresses are rejected; a function Excel
 * does not know (NOSUCHFN) is rejected when written.
 */
/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/no-explicit-any -- a test double shaped like Office.js's proxy objects */
import { colName, parseAddr, parseRange, MAX_COL, MAX_ROW } from "@/lib/studio/address";
import { parseNumberText } from "@/lib/studio/values";

type Border = { style: string; weight?: string };
type Fmt = { bold: boolean; italic: boolean; underline: string; color: string; size: number; fill: string | null; hAlign: string; indent: number; wrap: boolean; top: Border; bottom: Border };
const defFmt = (): Fmt => ({ bold: false, italic: false, underline: "None", color: "#000000", size: 11, fill: null, hAlign: "General", indent: 0, wrap: false, top: { style: "None" }, bottom: { style: "None" } });
const isDefault = (f: Fmt) => JSON.stringify(f) === JSON.stringify(defFmt());
type MCell = { formula?: string; input: string | number | boolean | null; nf: string; fmt: Fmt };

const DATEISH = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s\-/]+\d{1,4}|\d{1,4}[/\-.]\d{1,2}(?:[/\-.]\d{1,4})?)$/i;

export class MSheet {
  cells = new Map<string, MCell>();
  widths = new Map<number, number>();
  freeze: { rows: number; cols: number } | null = null;
  tabColor = "";
  visibility = "Visible";
  constructor(public book: MBook, public id: string, private _name: string) {}
  get name() { return this._name; }
  set name(n: string) {
    if (this.book.sheets.some((s) => s !== this && s.name.toLowerCase() === n.toLowerCase())) throw new Error("A sheet with that name already exists");
    for (const nm of this.book.namesList) nm.formula = nm.formula.replace(new RegExp(`(^=|[^A-Za-z0-9_])'?${this._name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?!`, "g"), (_m, p) => `${p}${/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n}'`}!`);
    this._name = n;
  }
  get position() { return this.book.sheets.indexOf(this); }
  set position(i: number) { const s = this.book.sheets; s.splice(s.indexOf(this), 1); s.splice(Math.min(i, s.length), 0, this); }
  load() { return this; }
  delete() {
    if (this.book.sheets.length === 1) throw new Error("A workbook must contain at least one visible worksheet");
    this.book.sheets.splice(this.book.sheets.indexOf(this), 1);
  }
  activate() { this.book.active = this; }
  key(r: number, c: number) { return `${r},${c}`; }
  cell(r: number, c: number): MCell {
    let x = this.cells.get(this.key(r, c));
    if (!x) { x = { input: null, nf: "General", fmt: defFmt() }; this.cells.set(this.key(r, c), x); }
    return x;
  }
  prune(r: number, c: number) {
    const x = this.cells.get(this.key(r, c));
    if (x && x.formula === undefined && (x.input === null || x.input === "") && x.nf === "General" && isDefault(x.fmt)) this.cells.delete(this.key(r, c));
  }
  /** What Excel does with typed input. */
  setInput(r: number, c: number, x: unknown) {
    const cell = this.cell(r, c);
    cell.formula = undefined;
    if (x === "" || x === null || x === undefined) cell.input = null;
    else if (typeof x === "number" || typeof x === "boolean") cell.input = x;
    else if (typeof x === "string") {
      if (x.startsWith("'")) cell.input = x.slice(1);
      else if (x.startsWith("=")) { if (/NOSUCHFN\(/i.test(x)) throw new Error("InvalidArgument: the formula is not valid"); cell.formula = x; cell.input = null; }
      else if (parseNumberText(x) !== null) cell.input = parseNumberText(x);
      else if (/^(true|false)$/i.test(x.trim())) cell.input = /^true$/i.test(x.trim());
      else if (DATEISH.test(x.trim())) cell.input = 45000;
      else cell.input = x;
    }
    this.prune(r, c);
  }
  getRange(address?: string) {
    if (!address) return new MRange(this, 0, 0, MAX_ROW, MAX_COL);
    const col = /^\$?([A-Z]+):\$?([A-Z]+)$/i.exec(address);
    if (col) { const a = parseAddr(`${col[1]}1`)!.c, b = parseAddr(`${col[2]}1`)!.c; return new MRange(this, 0, a - 1, MAX_ROW, b - a + 1); }
    const r = parseRange(address.replace(/\$/g, ""));
    if (!r) throw new Error(`Bad address ${address}`);
    return new MRange(this, r.r1 - 1, r.c1 - 1, r.r2 - r.r1 + 1, r.c2 - r.c1 + 1);
  }
  getRangeByIndexes(r: number, c: number, rows: number, cols: number) { return new MRange(this, r, c, rows, cols); }
  getUsedRangeOrNullObject(valuesOnly = false) {
    let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
    for (const [k, x] of this.cells) {
      if (valuesOnly && x.formula === undefined && (x.input === null || x.input === "")) continue;
      const [r, c] = k.split(",").map(Number);
      r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c);
    }
    if (r2 < 0) return { isNullObject: true, load() { return this; } } as unknown as MRange;
    return new MRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }
  freezePanes = {
    unfreeze: () => { this.freeze = null; },
    freezeAt: (rg: MRange) => { this.freeze = { rows: rg.rowCount, cols: rg.columnCount }; },
    freezeRows: (n: number) => { this.freeze = { rows: n, cols: 0 }; },
    freezeColumns: (n: number) => { this.freeze = { rows: 0, cols: n }; },
    getLocationOrNullObject: () => {
      const f = this.freeze;
      if (!f) return { isNullObject: true, load() { return this; } };
      return { isNullObject: false, load() { return this; }, rowCount: f.rows || MAX_ROW, columnCount: f.cols || MAX_COL };
    },
  };
  names = { items: [] as unknown[], load() { return this; } };
}

export class MRange {
  isNullObject = false;
  constructor(public ws: MSheet, public rowIndex: number, public columnIndex: number, public rowCount: number, public columnCount: number) {}
  load() { return this; }
  get worksheet() { return this.ws; }
  get address() { return `${this.ws.name}!${colName(this.columnIndex + 1)}${this.rowIndex + 1}:${colName(this.columnIndex + this.columnCount)}${this.rowIndex + this.rowCount}`; }
  private each(fn: (r: number, c: number, i: number, j: number) => void) {
    if (this.rowCount * this.columnCount > 5_000_000) {
      // Whole sheet or whole columns: visit only existing cells.
      for (const k of [...this.ws.cells.keys()]) {
        const [r, c] = k.split(",").map(Number);
        if (r >= this.rowIndex && r < this.rowIndex + this.rowCount && c >= this.columnIndex && c < this.columnIndex + this.columnCount) fn(r, c, r - this.rowIndex, c - this.columnIndex);
      }
      return;
    }
    for (let i = 0; i < this.rowCount; i++) for (let j = 0; j < this.columnCount; j++) fn(this.rowIndex + i, this.columnIndex + j, i, j);
  }
  private grid<T>(fn: (x: MCell | undefined) => T): T[][] {
    const out: T[][] = Array.from({ length: this.rowCount }, () => Array(this.columnCount));
    this.each((r, c, i, j) => { out[i][j] = fn(this.ws.cells.get(this.ws.key(r, c))); });
    return out;
  }
  get formulas() { return this.grid((x) => (x ? x.formula ?? x.input ?? "" : "")); }
  set formulas(v: unknown[][]) { this.each((r, c, i, j) => { if (v[i]?.[j] !== null && v[i]?.[j] !== undefined) this.ws.setInput(r, c, v[i][j]); }); }
  get values() { return this.grid((x) => (x ? (x.formula !== undefined ? 0 : x.input ?? "") : "")); }
  get numberFormat() { return this.grid((x) => x?.nf ?? "General"); }
  set numberFormat(v: string[][]) { this.each((r, c, i, j) => { if (v[i]?.[j] != null) { this.ws.cell(r, c).nf = v[i][j]; this.ws.prune(r, c); } }); }
  get format() {
    const self = this;
    return {
      fill: { clear: () => self.each((r, c) => { const x = self.ws.cells.get(self.ws.key(r, c)); if (x) { x.fmt.fill = null; self.ws.prune(r, c); } }) },
      borders: {
        getItem: (side: string) => ({
          set style(s: string) {
            self.each((r, c, i) => {
              const edge = side === "EdgeTop" ? i === 0 : side === "EdgeBottom" ? i === self.rowCount - 1 : false;
              if (!edge) return;
              const x = self.ws.cells.get(self.ws.key(r, c));
              if (!x && s === "None") return;
              const cell = self.ws.cell(r, c);
              if (side === "EdgeTop") cell.fmt.top = { style: s }; else cell.fmt.bottom = { style: s };
              self.ws.prune(r, c);
            });
          },
        }),
      },
      set columnWidth(w: number) { for (let j = 0; j < self.columnCount; j++) self.ws.widths.set(self.columnIndex + j, w); },
    };
  }
  setCellProperties(props: { format?: Record<string, unknown> }[][]) {
    this.each((r, c, i, j) => {
      const f = props[i]?.[j]?.format as Record<string, any> | undefined;
      if (!f) return;
      const cell = this.ws.cell(r, c);
      if (f.font) for (const k of ["bold", "italic", "underline", "color", "size"]) if (f.font[k] !== undefined) (cell.fmt as any)[k] = k === "color" ? String(f.font[k]).toUpperCase() : f.font[k];
      if (f.fill?.color) cell.fmt.fill = String(f.fill.color).toUpperCase();
      if (f.horizontalAlignment) cell.fmt.hAlign = f.horizontalAlignment;
      if (f.indentLevel !== undefined) cell.fmt.indent = f.indentLevel;
      if (f.wrapText !== undefined) cell.fmt.wrap = f.wrapText;
      if (f.borders?.top) cell.fmt.top = { ...f.borders.top };
      if (f.borders?.bottom) cell.fmt.bottom = { ...f.borders.bottom };
      this.ws.prune(r, c);
    });
  }
  getCellProperties() {
    return {
      value: this.grid((x) => {
        const f = x?.fmt ?? defFmt();
        return { format: { font: { bold: f.bold, italic: f.italic, underline: f.underline, color: f.color, size: f.size }, fill: { color: f.fill ?? "#FFFFFF", pattern: f.fill ? "Solid" : "None" }, horizontalAlignment: f.hAlign, indentLevel: f.indent, wrapText: f.wrap, borders: { top: { ...f.top, weight: f.top.weight ?? "Thin" }, bottom: { ...f.bottom, weight: f.bottom.weight ?? "Thin" } } } };
      }),
    };
  }
  getColumnProperties() {
    return { value: Array.from({ length: this.columnCount }, (_, j) => ({ columnIndex: this.columnIndex + j, format: { columnWidth: this.ws.widths.get(this.columnIndex + j) ?? 48 } })) };
  }
  clear() { this.each((r, c) => { this.ws.cells.delete(this.ws.key(r, c)); }); }
  select() { this.ws.book.selection = this; }
}

type MName = { name: string; type: string; formula: string; visible: boolean; delete: () => void };

export class MBook {
  sheets: MSheet[] = [];
  namesList: MName[] = [];
  active: MSheet | null = null;
  selection: MRange | null = null;
  syncs = 0;
  private seq = 1;
  constructor(first = "Sheet1") { this.sheets.push(new MSheet(this, `{ws-${this.seq++}}`, first)); }
  get worksheets() {
    const book = this;
    return {
      get items() { return book.sheets; },
      load() { return this; },
      add(name: string) {
        if (book.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error("A sheet with that name already exists");
        const s = new MSheet(book, `{ws-${book.seq++}}`, name);
        book.sheets.push(s);
        return s;
      },
      getItemOrNullObject(name: string) { return book.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? ({ isNullObject: true } as unknown as MSheet); },
      getItem(key: string) { const s = book.sheets.find((x) => x.id === key || x.name === key); if (!s) throw new Error("ItemNotFound"); return s; },
    };
  }
  get names() {
    const book = this;
    return {
      get items() { return book.namesList; },
      load() { return this; },
      add(name: string, ref: string) {
        if (/^[A-Za-z]{1,3}\d+$/.test(name) || book.namesList.some((n) => n.name.toLowerCase() === name.toLowerCase())) throw new Error("InvalidArgument: the name is not valid");
        const item: MName = { name, type: "Range", formula: ref, visible: true, delete: () => { book.namesList = book.namesList.filter((n) => n !== item); } };
        book.namesList.push(item);
        return item;
      },
    };
  }
  getSelectedRange() { return this.selection ?? this.sheets[0].getRange("A1"); }
  /** Something the agent never did: a person typing into the workbook. */
  type(sheet: string, address: string, input: unknown) { const s = this.sheets.find((x) => x.name === sheet)!; const p = parseAddr(address)!; s.setInput(p.r - 1, p.c - 1, input); }
  context() { return { workbook: this, sync: async () => { this.syncs++; } } as unknown as Excel.RequestContext; }
}

/* ---------------- PowerPoint ---------------- */

type MSlide = { id: string; source: string; tags: Map<string, string> };

export class MPresentation {
  slides: MSlide[] = [];
  selected: string[] = [];
  private seq = 300;
  constructor(own = 2) { for (let i = 0; i < own; i++) this.slides.push({ id: `${this.seq++}#`, source: `own-${i}`, tags: new Map() }); }
  /** A deck file here is just its slides' names; slide i of the file has id 256 + i. */
  static file(names: string[]) { return Buffer.from(JSON.stringify(names)).toString("base64"); }
  context() {
    const pres = this;
    const slideObj = (s: MSlide) => ({
      id: s.id,
      tags: {
        get items() { return [...s.tags].map(([key, value]) => ({ key, value })); },
        load() { return this; },
        add(k: string, v: string) { s.tags.set(k.toUpperCase(), v); },
        delete(k: string) { s.tags.delete(k.toUpperCase()); },
      },
      delete() { pres.slides = pres.slides.filter((x) => x !== s); },
    });
    const collection = { get items() { return pres.slides.map(slideObj); }, load() { return this; }, getItem(id: string) { const s = pres.slides.find((x) => x.id === id); if (!s) throw new Error("SlideNotFound"); return slideObj(s); } };
    return {
      presentation: {
        slides: collection,
        insertSlidesFromBase64(b64: string, o: { targetSlideId?: string; sourceSlideIds?: string[] } = {}) {
          const names = JSON.parse(Buffer.from(b64, "base64").toString()) as string[];
          const pick = o.sourceSlideIds ? o.sourceSlideIds.map((id) => { const i = Number(id.replace("#", "")) - 256; if (!names[i]) throw new Error("SlideNotFound"); return names[i]; }) : names;
          const at = o.targetSlideId ? pres.slides.findIndex((x) => x.id === o.targetSlideId) + 1 : 0;
          if (o.targetSlideId && at === 0) throw new Error("SlideNotFound");
          pres.slides.splice(at, 0, ...pick.map((source) => ({ id: `${pres.seq++}#`, source, tags: new Map<string, string>() })));
        },
        getSelectedSlides() { return { get items() { return pres.slides.filter((x) => pres.selected.includes(x.id)).map(slideObj); }, load() { return this; } }; },
      },
      sync: async () => undefined,
    } as unknown as PowerPoint.RequestContext;
  }
}
