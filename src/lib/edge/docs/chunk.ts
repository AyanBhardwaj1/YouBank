/**
 * Cutting documents into passages that retrieval can find and citations can point at. A document is
 * read as parts (headings, paragraphs, tables) and cut into passages of about 500 tokens: a heading
 * starts a new passage, a table stays whole with the sentence that leads into it (a big one is split
 * between rows, its header rows and units repeated in every piece), and prose passages overlap by about
 * a tenth so a fact split across a boundary still lands whole in one. Pages keep their numbers (so a
 * citation opens the right page), filings keep the section they are in (Risk Factors, MD&A), and
 * transcripts become speaker turns with their start and end times. Documents read before keep the
 * thousand-character passages splitText made. Pure, for tests.
 */

/** A passage; `heading` (the subheading it falls under) goes into its embedding header and is not stored. */
export type Passage = { ord: number; page: number; section: string; text: string; tStart?: number; tEnd?: number; speaker?: string; heading?: string };
export type ParsedPage = { n: number; text: string; tables?: string[][][]; parts?: Part[] };

const TARGET = 1000, MAX = 1400, OVERLAP = 120;

/** An overlap that starts at a word, not partway through one ("he informal" for "the informal"). */
const fromWord = (tail: string) => { const i = tail.search(/\s/); return i >= 0 ? tail.slice(i + 1) : ""; };

/** Split text into passages near TARGET characters, on paragraph then sentence boundaries. */
export function splitText(text: string): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 1);
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    if (p.length > MAX) {
      push();
      const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
      let s = "";
      for (const x of sentences) {
        if ((s + x).length > TARGET && s) { out.push(s.trim()); s = fromWord(s.slice(-OVERLAP)); }
        s += x;
        while (s.length > MAX) {
          // A run-on with no sentence breaks: cut at the last space before MAX, carry the overlap from a word start.
          const cut = Math.max(s.lastIndexOf(" ", MAX), MAX - OVERLAP);
          out.push(s.slice(0, cut).trim());
          s = fromWord(s.slice(Math.max(0, cut - OVERLAP)));
        }
      }
      if (s.trim()) out.push(s.trim());
      continue;
    }
    if ((cur + "\n" + p).length > TARGET && cur) { const tail = fromWord(cur.slice(-OVERLAP)); push(); cur = tail; }
    cur += (cur ? "\n" : "") + p;
  }
  push();
  return out.filter((t) => t.length >= 20 || out.length === 1);
}

/** A table as text rows ("a | b | c"), which retrieval can still match numbers in. */
export function tableText(rows: string[][]): string {
  return rows.map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()).join(" | ")).filter((l) => l.replace(/[|\s]/g, "")).join("\n");
}

/** Pages (a PDF, slides, sheets) into passages that keep their page number: each page's text, then its tables. */
export function passagesFromPages(pages: ParsedPage[]): Passage[] {
  const out: Passage[] = [];
  for (const p of pages) {
    const parts = [...(p.parts ?? partsFromText(p.text, { page: p.n || undefined })), ...(p.tables ?? []).flatMap((t) => tableParts(t))];
    out.push(...passagesFromParts(parts, p.n, out.length));
  }
  return out;
}

const HEADINGS: [RegExp, string][] = [
  [/^item\s*1a\.?\s*[-:—]?\s*risk\s+factors/i, "Risk factors"],
  [/^item\s*1b\.?/i, "Unresolved staff comments"],
  [/^item\s*1\.?\s*[-:—]?\s*business\b/i, "Business"],
  // A 10-Q's Item 2 is its MD&A (before this came first, it was read as "Item 2").
  [/^item\s*2\.?\s*[-:—]?\s*management.s\s+discussion/i, "MD&A"],
  [/^item\s*2\.?\s*[-:—]?\s*(properties|management)/i, "Item 2"],
  // A 10-Q's Item 3 is its market risk; a 10-K's is its legal proceedings.
  [/^item\s*3\.?\s*[-:—]?\s*quantitative/i, "Market risk"],
  [/^item\s*3\.?\s*[-:—]?\s*legal/i, "Item 3"],
  [/^item\s*4\.?\s*[-:—]?\s*controls/i, "Controls"],
  [/^item\s*7a\.?/i, "Market risk"],
  [/^item\s*7\.?\s*[-:—]?\s*management/i, "MD&A"],
  [/^item\s*1\.?\s*[-:—]?\s*financial\s+statements/i, "Financial statements"],
  [/^item\s*8\.?\s*[-:—]?\s*financial\s+statements/i, "Financial statements"],
  [/^item\s*9a\.?/i, "Controls"],
  [/^item\s*[1-9][0-9]?\.[0-9]{2}\b/i, "8-K item"],
  [/^exhibit\s+99/i, "Exhibit 99"],
  // Any other numbered item ("Item 2. Unregistered Sales of Equity Securities") still ends the section before it.
  [/^(item|ITEM|Item)\s*\d{1,2}[A-Ca-c]?\s*[.:—–-]\s*[A-Z(]/, "Other item"],
];

/** The section a line starts, if it is a heading. */
export function headingOf(line: string): string | null {
  const l = line.trim().replace(/\s+/g, " ");
  if (l.length > 140) return null;
  for (const [re, name] of HEADINGS) if (re.test(l)) return name;
  return null;
}

/** A filing's text into passages that know which section they are in (filings read from their HTML use partsFromHtml). */
export function passagesFromFiling(text: string): Passage[] {
  return passagesFromParts(partsFromText(text, { filing: true }));
}

/**
 * A filing's item heading at the start of a line, and any text after it on the same line ("ITEM 10.
 * DIRECTORS, EXECUTIVE OFFICERS AND CORPORATE GOVERNANCE Board of Directors Our general partner…").
 * Contents entries, which end in a page number, are not headings. Pure.
 */
export function filingHeading(line: string): { section: string; heading: string; rest: string } | null {
  const l = line.replace(/\s+/g, " ").trim();
  if (l.length < 160 && /\s\d{1,3}$/.test(l)) return null;
  // A heading in capitals with its first paragraph after it on the same line.
  const m = /^((?:ITEM|Item)\s+\d{1,2}[A-C]?\.?\s+[A-Z][A-Z0-9 ,;&'’()/-]{2,140}?)\s+(?=[A-Z][a-z])/.exec(l);
  const split = m ? headingOf(m[1]) : null;
  if (m && split) return { section: split, heading: m[1].trim(), rest: l.slice(m[0].length).trim() };
  const whole = headingOf(l);
  return whole ? { section: whole, heading: l, rest: "" } : null;
}

/* ---------------- Passages of about 500 tokens: headings, paragraphs and whole tables ---------------- */

/**
 * About 500 tokens a passage (roughly 2,000 characters of English), the size element-based chunking did
 * best at on FinanceBench; up to 2,600 before a cut is forced; about a tenth carried between prose passages.
 */
export const P_TARGET = 2000, P_MAX = 2600, P_OVERLAP = 200;
/** A heading starts a new passage once the current one holds this much; smaller sections (a slide's "Employees / 450") are kept together. */
export const P_MIN_SECTION = 400;

/**
 * A piece of a document as read: a heading (a filing's item heading names the section it starts), a
 * paragraph, or a table whose first `head` rows are its header and `units` a line such as "(in millions)".
 */
export type Part = { kind: "heading"; text: string; section?: string } | { kind: "text"; text: string } | { kind: "table"; rows: string[][]; head: number; units?: string };

/** Page furniture in words: running headers such as "Table of Contents". Dropped wherever they stand. */
export const FURNITURE = /^(table of contents|index to (consolidated )?financial statements)$/i;
/** A bare page number ("41", "Page 41"): dropped only where page numbers sit, never from the middle of a page (a slide's "450"). */
export const PAGE_NO = /^(page\s+)?\d{1,3}$/i;
/** A parenthetical naming the units of a table's figures: "(in millions, except per unit data)", "(Dollars in thousands)". */
export const UNITS = /\([^()]*\b(millions|thousands|billions)\b[^()]*\)/i;

/** A short line that reads as a heading: title case or capitals, no closing punctuation, some letters. Pure. */
export function looksLikeHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 3 || l.length > 90 || /[.!?,;:]$/.test(l) || !/^[\p{Lu}0-9(]/u.test(l) || !/\p{L}{3}/u.test(l) || /^[•·▪-]/.test(l)) return false;
  const words = l.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return false;
  if (l === l.toUpperCase()) return true;
  const small = /^(a|an|and|as|at|by|for|from|in|of|on|or|the|to|with|its|our|per|vs\.?)$/i;
  return words.filter((w) => /^[\p{Lu}(]/u.test(w) || small.test(w)).length === words.length && words.some((w) => /^\p{Lu}/u.test(w));
}

/** A table cell as read: its text, and how many columns it spans (an HTML colspan). */
export type Cell = string | { text: string; span?: number };

const YEARISH = /^\(?((19|20)\d{2}|Q[1-4]\s*(19|20)\d{2}|(19|20)\d{2}\s*Q[1-4])\)?$/i;
/** A cell that only carries a symbol for the figure beside it, as filings set them: "$", "(", ")", "%". */
const SYMBOL = /^([$€£¥]|\(|[$€£¥]\(|\)|%|\)%|%\))$/;
const OPENS = /^([$€£¥]|\(|[$€£¥]\()$/;
/** "( 934 )" and "$ 1,213", as a filing's spans leave them, read "(934)" and "$1,213". */
const tidyCell = (c: string) => c.replace(/\s+/g, " ").trim().replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/([$€£¥])\s+(?=[\d(])/g, "$1").replace(/(\d)\s+%/g, "$1%");
/** A row with a label and figures beside it (years aside): the rows a table's columns are read from. */
const isBodyRow = (r: string[]) => !!r[0] && r.slice(1).some((c) => /\d/.test(c) && !YEARISH.test(c));

/**
 * A table's rows on one grid, its columns kept in place. Each cell covers the columns it spans; "$" and an
 * opening "(" join the figure after them (and its columns) and a closing ")" or "%" the one before. The
 * table's columns are the ranges the rows of labels and figures cover, overlapping ranges joined (Workiva
 * spans a plain figure over the "$" column that a dollar figure fills); every cell goes to the first of
 * them it overlaps, so a header spanning several sits over the first, and a cell overlapping none gets a
 * column of its own. Columns that only ever held spacing or symbols are gone. A blank figure stays a blank
 * cell, so the figures after it stay under their headers. Pure.
 */
export function gridRows(raw: Cell[][]): string[][] {
  type Placed = { text: string; at: number; end: number };
  const rows: Placed[][] = raw.map((r) => {
    let at = 0;
    const cells = r.map((c): Placed => {
      const text = tidyCell(String(typeof c === "string" ? c : c?.text ?? ""));
      const span = typeof c === "string" ? 1 : Math.max(1, Math.min(60, Math.floor(Number(c?.span) || 1)));
      const cell = { text, at, end: at + span - 1 };
      at += span;
      return cell;
    });
    cells.forEach((c, i) => {
      if (!SYMBOL.test(c.text)) return;
      const opens = OPENS.test(c.text);
      const near = opens ? cells.slice(i + 1, i + 3).find((x) => x.text) : cells.slice(Math.max(0, i - 2), i).reverse().find((x) => x.text);
      if (!near || SYMBOL.test(near.text)) return;
      if (opens) { near.text = `${c.text}${near.text}`; near.at = Math.min(near.at, c.at); } else near.text = `${near.text}${c.text}`;
      c.text = "";
    });
    return cells.filter((c) => c.text && !SYMBOL.test(c.text));
  });
  const used = rows.filter((r) => r.length);
  if (!used.length) return raw.map(() => []);
  const labelAt = Math.min(...used.map((r) => r[0].at));
  const body = used.filter((r) => r[0].at === labelAt && isBodyRow(r.map((c) => c.text)));
  const cols: [number, number][] = [];
  for (const [a, b] of (body.length ? body : used).flatMap((r) => r.filter((c) => c.end - c.at < 4).map((c) => [c.at, c.end] as [number, number])).sort((x, y) => x[0] - y[0])) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else cols.push([a, b]);
  }
  const colOf = (c: Placed) => cols.findIndex(([a, b]) => c.at <= b && c.end >= a);
  for (const r of used) for (const c of r) if (colOf(c) < 0) { cols.push([c.at, c.at]); cols.sort((x, y) => x[0] - y[0]); }
  return rows.map((r) => {
    const out = new Array<string>(cols.length).fill("");
    for (const c of r) { const i = colOf(c); out[i] = out[i] ? `${out[i]} ${c.text}` : c.text; }
    return out;
  });
}

/** One row tidied on its own: its symbols joined to their figures and its empty cells dropped (gridRows does whole tables). Pure. */
export const cleanRow = (cells: string[]): string[] => gridRows([cells])[0].filter(Boolean);

/**
 * A table (cells as they came, with any column spans) as parts: laid on one grid (see gridRows), empty
 * rows dropped, its header rows found (the rows before the first with a label, whether beside figures or
 * alone as in "Revenues:"; at most four). A layout table (one or two long cells a row, as filings use for
 * bullets and notes) comes back as paragraphs. Pure.
 */
export function tableParts(raw: Cell[][], units?: string): Part[] {
  const rows = gridRows(raw).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const filled = rows.map((r) => r.filter(Boolean));
  const long = filled.reduce((s, r) => s + r.join(" ").length, 0) / filled.length;
  if (filled.every((r) => r.length <= 2) && long > 80) return filled.map((r) => ({ kind: "text" as const, text: r.join(" ") }));
  let head = 0;
  for (const r of rows.slice(0, Math.min(4, rows.length - 1))) {
    if (r[0] && !UNITS.test(r[0]) && (isBodyRow(r) || r.slice(1).every((c) => !c))) break;
    head++;
  }
  const headCells = rows.slice(0, head).flat();
  const inHead = units ?? headCells.find((c) => UNITS.test(c) && c.length <= 120);
  return [{ kind: "table", rows, head: Math.min(head, rows.length - 1), ...(inHead && !headCells.includes(inHead) ? { units: inHead } : {}) }];
}

/**
 * A page's text with its page number taken off: a bare number (or "Page 41") as the first or last line,
 * and, when the page's own number is known, only if it is within 3 of it (printed and physical numbers
 * differ a little), so a slide ending in "12" countries keeps it. Pure.
 */
export function dropPageNumber(text: string, page?: number): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const isNo = (l: string) => { const t = l.replace(/\s+/g, " ").trim(); if (!PAGE_NO.test(t)) return false; const v = Number(t.replace(/\D+/g, "")); return !page || Math.abs(v - page) <= 3; };
  const first = lines.findIndex((l) => l.trim()), last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim());
  if (first < 0) return text;
  if (isNo(lines[last])) lines[last] = "";
  if (last !== first && isNo(lines[first])) lines[first] = "";
  return lines.join("\n");
}

/**
 * Plain text as parts: blank lines end paragraphs; Markdown headings, pipe tables and short title-like
 * lines on their own are recognized; with `filing`, item headings (not contents entries) start sections.
 * Running headers ("Table of Contents") are dropped, and a page number when it is the page's first or
 * last line (see dropPageNumber; `page` is the page's own number when known). Pure.
 */
export function partsFromText(text: string, opts: { filing?: boolean; page?: number } = {}): Part[] {
  const out: Part[] = [];
  for (const block of dropPageNumber(text, opts.page).split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !FURNITURE.test(l));
    let para: string[] = [], table: string[][] = [], sep = false;
    const endPara = () => { if (para.length) out.push({ kind: "text", text: para.join(" ") }); para = []; };
    const endTable = () => {
      if (table.length) { const t = tableParts(table); if (sep && t[0]?.kind === "table") t[0].head = Math.min(1, t[0].rows.length - 1); out.push(...t); }
      table = []; sep = false;
    };
    for (const l of lines) {
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(l)) { sep = true; continue; }
      if (l.includes("|") && l.split("|").filter((c) => c.trim()).length >= 2) { endPara(); table.push(l.replace(/^\||\|$/g, "").split("|")); continue; }
      endTable();
      const f = opts.filing ? filingHeading(l) : null;
      if (f) { endPara(); out.push({ kind: "heading", text: f.heading, section: f.section }); if (f.rest) para.push(f.rest); continue; }
      const md = /^#{1,6}\s+(.+)$/.exec(l);
      if (md) { endPara(); out.push({ kind: "heading", text: md[1].trim() }); continue; }
      if (lines.length === 1 && looksLikeHeading(l)) { out.push({ kind: "heading", text: l }); continue; }
      para.push(l);
    }
    endTable(); endPara();
  }
  return out;
}

/** Text cut at sentences into pieces near `target` characters (a run-on is cut between words). Pure. */
function sentencePieces(t: string, target: number, max: number): string[] {
  const out: string[] = [];
  let s = "";
  for (const x of t.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [t]) {
    if (s && (s + x).length > target) { out.push(s.trim()); s = ""; }
    s += x;
    while (s.length > max) {
      const cut = Math.max(s.lastIndexOf(" ", target), Math.floor(target / 2));
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut);
    }
  }
  if (s.trim()) out.push(s.trim());
  return out;
}

/** A table row as text ("a |  | c": a blank keeps its place; blanks at the end are left off). */
const rowText = (r: string[]) => { let n = r.length; while (n > 1 && !r[n - 1]) n--; return r.slice(0, n).join(" | "); };

/** A row's text as lines of at most `limit` characters, broken between cells (or words, in a very long cell). Pure. */
export function rowLines(line: string, limit: number): string[] {
  if (line.length <= limit) return [line];
  const out: string[] = [];
  let cur = "";
  for (const piece of line.split(" | ")) {
    const bits = piece.length > limit ? sentencePieces(piece, Math.floor(limit * 0.8), limit) : [piece];
    for (const b of bits) {
      if (cur && cur.length + 3 + b.length > limit) { out.push(cur); cur = ""; }
      cur = cur ? `${cur} | ${b}` : b;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Parts into passages of about `target` characters. A heading starts a new passage once the current one
 * holds a section's worth (P_MIN_SECTION; smaller sections stay together), headings in a row stay
 * together, and a passage carries the heading it starts under; paragraphs fill a passage, a long
 * one is cut at sentences, and a prose passage that runs over starts the next with its last ~10%; a
 * table stays whole when it fits, starting a fresh passage (with the short paragraph that leads into
 * it) when the current one is already well filled, and a table too big for one passage is split between
 * rows with its header rows and units repeated in every piece. Pure.
 */
export function chunkParts(parts: Part[], o: { target?: number; max?: number; overlap?: number } = {}): { text: string; heading: string }[] {
  const target = o.target ?? P_TARGET, max = o.max ?? P_MAX, overlap = o.overlap ?? P_OVERLAP;
  const out: { text: string; heading: string }[] = [];
  let heads: string[] = [], lines: string[] = [], len = 0, body = 0, lastProse = "", heading = "", own = "";
  const add = (s: string, prose: boolean) => { lines.push(s); len += s.length + 1; body += s.length; lastProse = prose ? s : ""; };
  const flush = () => {
    // A passage of headings alone is kept too: a slide or page made only of short lines, or "Item 1B" and "None".
    if (body || heads.length) out.push({ text: [...heads, ...lines].join("\n").trim(), heading: own || heading });
    heads = []; lines = []; len = 0; body = 0; lastProse = ""; own = "";
  };
  // End the passage; when it ended in prose, the next one starts with its last words.
  const roll = () => {
    const tail = lastProse ? fromWord([...heads, ...lines].join("\n").slice(-overlap)) : "";
    flush();
    if (tail) { lines = [tail]; len = tail.length + 1; }
  };
  for (const p of parts) {
    if (p.kind === "heading") {
      const h = p.text.replace(/\s+/g, " ").trim();
      if (!h) continue;
      if (body && body < P_MIN_SECTION) { add(h, false); heading = h; continue; }
      if (body) flush();
      else { lines = []; len = heads.reduce((s, x) => s + x.length + 1, 0); }
      heads.push(h); len += h.length + 1; own = h; heading = h;
      continue;
    }
    if (p.kind === "text") {
      const t = p.text.replace(/\s+/g, " ").trim();
      if (!t) continue;
      for (const piece of t.length > max ? sentencePieces(t, target, max) : [t]) {
        if (body && len + piece.length > target) roll();
        add(piece, true);
      }
      continue;
    }
    const headLines = [...(p.units ? [p.units] : []), ...p.rows.slice(0, p.head).map(rowText)];
    const room = Math.max(400, max - headLines.join("\n").length - 2);
    const bodyLines = p.rows.slice(p.head).flatMap((r) => rowLines(rowText(r), room));
    const whole = [...headLines, ...bodyLines].join("\n");
    if (len + whole.length + 1 > max && body && len > 600) {
      const lead = lastProse.length <= 400 ? lastProse : "";
      flush();
      if (lead) add(lead, false);
    }
    if (len + whole.length + 1 <= max) { add(whole, false); continue; }
    for (let i = 0; i < bodyLines.length || (i === 0 && headLines.length);) {
      if (i > 0) flush();
      if (headLines.length) add(headLines.join("\n"), false);
      let taken = 0;
      while (i < bodyLines.length && (taken === 0 || len + bodyLines[i].length + 1 <= target)) { add(bodyLines[i], false); i++; taken++; }
      if (!bodyLines.length) break;
    }
  }
  flush();
  return out;
}

/** Parts into passages; a heading that names a section (a filing's item) starts it. Pure. */
export function passagesFromParts(parts: Part[], page = 0, firstOrd = 0): Passage[] {
  const out: Passage[] = [];
  let section = "", buf: Part[] = [];
  const flush = () => { for (const c of chunkParts(buf)) out.push({ ord: firstOrd + out.length, page, section, text: c.text, ...(c.heading ? { heading: c.heading } : {}) }); buf = []; };
  for (const p of parts) {
    if (p.kind === "heading" && p.section) {
      // "PART I" just before "ITEM 1. BUSINESS" goes into Business's first passage, not one of its own.
      const carry = buf.length && buf.every((x) => x.kind === "heading" && !x.section) ? buf : [];
      if (!carry.length) flush();
      section = p.section;
      buf = [...carry];
    }
    buf.push(p);
  }
  flush();
  return out;
}

/** The text of one section of a filing: the occurrence with the most text after it (past the table of contents). */
export function sectionText(text: string, section: string): string {
  const lines = text.split("\n");
  let best = "", cur: string[] | null = null;
  const close = () => { if (cur) { const t = cur.join("\n").trim(); if (t.length > best.length) best = t; } cur = null; };
  for (const line of lines) {
    const h = headingOf(line);
    if (h) { close(); if (h === section) cur = []; continue; }
    if (cur) cur.push(line);
  }
  close();
  return best;
}

export type Segment = { start: number; end: number; text: string; speaker?: string };

/** Transcript segments into passages of one speaker's turn at a time, with start and end times. */
export function passagesFromTranscript(segments: Segment[]): Passage[] {
  const out: Passage[] = [];
  let cur: { text: string; start: number; end: number; speaker: string } | null = null;
  const push = () => { if (cur && cur.text.trim()) out.push({ ord: out.length, page: 0, section: "", text: cur.text.trim(), tStart: cur.start, tEnd: cur.end, speaker: cur.speaker }); cur = null; };
  for (const s of segments) {
    const speaker = s.speaker ?? "";
    if (cur && (cur.speaker !== speaker || (cur.text + " " + s.text).length > TARGET)) push();
    if (!cur) cur = { text: "", start: s.start, end: s.end, speaker };
    cur.text += (cur.text ? " " : "") + s.text.trim();
    cur.end = s.end;
  }
  push();
  return out;
}

/** "12:05" for 725 seconds. */
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/* ---------------- Headers: what a passage is from ---------------- */

/** What retrieval needs to know about a document to describe it. */
export type DocInfo = { title: string; source: string; meta?: { ticker?: string | null; form?: string | null; period?: string | null; filed?: string | null; company?: string | null } | null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "June 30, 2026" for "2026-06-30"; anything else comes back as it was. Pure. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso.trim();
}

/**
 * A document in words, the way a question names it: "Energy Transfer LP (ET) · 10-Q · quarter ended
 * June 30, 2026" for a filing (the company from the title when it was not stored), the title (and
 * ticker) for anything else. Pure.
 */
export function docLabel(d: DocInfo): string {
  const m = d.meta ?? {};
  const ticker = (m.ticker ?? "").trim(), form = (m.form ?? "").trim();
  if (d.source === "sec") {
    const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const company = (m.company ?? "").trim() || (form ? d.title.replace(new RegExp(`\\s+${esc}\\s*\\(\\d{4}-\\d{2}-\\d{2}\\)\\s*$`), "") : d.title).trim();
    const period = m.period && /^\d{4}-\d{2}-\d{2}$/.test(m.period) && /^10-[KQ]/.test(form) ? `${form.startsWith("10-K") ? "year" : "quarter"} ended ${longDate(m.period)}` : m.filed ? `filed ${longDate(m.filed)}` : "";
    return [`${company}${ticker ? ` (${ticker})` : ""}`, form, period].filter(Boolean).join(" · ");
  }
  return `${d.title.trim()}${ticker && !d.title.includes(ticker) ? ` (${ticker})` : ""}`;
}

/**
 * The line set before a passage's text when it is embedded and searched by keyword ("Company (TICKER) ·
 * form · period · section", then any heading and speaker), so a passage that never names its company or
 * period can still be found by them. The stored text, which quotes are checked against, is not changed. Pure.
 */
export function passageHeader(d: DocInfo, p: { section?: string | null; heading?: string | null; speaker?: string | null }): string {
  const parts = [docLabel(d), p.section, p.heading, p.speaker].map((x) => (x ?? "").trim()).filter(Boolean);
  return [...new Set(parts)].join(" · ").slice(0, 400);
}
