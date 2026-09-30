/**
 * Cutting documents into passages that retrieval can find and citations can point at: about a
 * thousand characters each, on paragraph and sentence boundaries, overlapping a little so a fact split
 * across a boundary still lands whole in one passage. Pages keep their numbers (so a citation opens
 * the right page), filings keep the section they are in (Risk Factors, MD&A), tables become rows of
 * cells, and transcripts become speaker turns with their start and end times. Pure, for tests.
 */

export type Passage = { ord: number; page: number; section: string; text: string; tStart?: number; tEnd?: number; speaker?: string };
export type ParsedPage = { n: number; text: string; tables?: string[][][] };

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

/** Pages (a PDF, slides, sheets) into passages that keep their page number. */
export function passagesFromPages(pages: ParsedPage[]): Passage[] {
  const out: Passage[] = [];
  for (const p of pages) {
    const body = [p.text, ...(p.tables ?? []).map(tableText)].filter(Boolean).join("\n\n");
    for (const t of splitText(body)) out.push({ ord: out.length, page: p.n, section: "", text: t });
  }
  return out;
}

const HEADINGS: [RegExp, string][] = [
  [/^item\s*1a\.?\s*[-:—]?\s*risk\s+factors/i, "Risk factors"],
  [/^item\s*1b\.?/i, "Unresolved staff comments"],
  [/^item\s*1\.?\s*[-:—]?\s*business\b/i, "Business"],
  [/^item\s*2\.?\s*[-:—]?\s*(properties|management)/i, "Item 2"],
  [/^item\s*3\.?\s*[-:—]?\s*(legal|quantitative)/i, "Item 3"],
  [/^item\s*7a\.?/i, "Market risk"],
  [/^item\s*7\.?\s*[-:—]?\s*management/i, "MD&A"],
  [/^item\s*2\.?\s*[-:—]?\s*management.s\s+discussion/i, "MD&A"],
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

/** A filing's text into passages that know which section they are in. */
export function passagesFromFiling(text: string): Passage[] {
  const out: Passage[] = [];
  let section = "", buf = "";
  const flush = () => { for (const t of splitText(buf)) out.push({ ord: out.length, page: 0, section, text: t }); buf = ""; };
  for (const line of text.split("\n")) {
    const h = headingOf(line);
    if (h) { flush(); section = h; }
    buf += `${line}\n`;
    if (!h && line.trim() === "") buf += "\n";
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
