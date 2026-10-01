/**
 * A filing's HTML as parts for the passage cutter (see chunk.ts): paragraphs and headings in reading
 * order, and tables as rows of cells. htmlToText flattens a table into a run of words and numbers, losing
 * which figure sits under which column; here a table keeps its rows ("Midstream | $3,164 | $2,910") and
 * its header, so a passage can repeat the header when a big table is split. Item headings name the
 * section they start (contents entries do not), and a units line just above a table goes with it. Pure.
 */
import { filingHeading, FURNITURE, looksLikeHeading, PAGE_NO, tableParts, UNITS, type Cell, type Part } from "./chunk";

/** Where a page ends: filings mark it with a page-break rule, or say "Table of Contents" atop the next page. */
const BREAK = "\uE000";

const codePoint = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ");

/** HTML entities as characters. Pure. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, " ");
}

/**
 * The lines of an HTML fragment: block ends become line breaks, tags go, entities are decoded. Running
 * headers go, and a bare page number only where it sits at a page's end or start (next to a page break or a
 * "Table of Contents" line), so a figure standing alone mid-page stays.
 */
function linesOf(html: string): string[] {
  const lines = decodeEntities(html.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const edge = (l: string | undefined) => l === undefined || l === BREAK || FURNITURE.test(l);
  return lines.filter((l, i) => l !== BREAK && !FURNITURE.test(l) && !(PAGE_NO.test(l) && (lines.includes(BREAK) || lines.some((x) => FURNITURE.test(x))) && (edge(lines[i + 1]) || edge(lines[i - 1]))));
}

function textParts(html: string, out: Part[]) {
  for (const l of linesOf(html)) {
    const f = filingHeading(l);
    if (f) { out.push({ kind: "heading", text: f.heading, section: f.section }); if (f.rest) out.push({ kind: "text", text: f.rest }); continue; }
    out.push(looksLikeHeading(l) ? { kind: "heading", text: l } : { kind: "text", text: l });
  }
}

/**
 * A table's rows of cells with their column spans. Cells may close themselves (<td colspan="3" />, as
 * Workiva writes spacing cells) or leave out their end tags, as HTML allows. Pure.
 */
export function tableRows(html: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const row = tr.split(/<\/tr\s*>/i)[0];
    const tags = [...row.matchAll(/<t[dh]\b([^>]*?)(\/?)>/gi)];
    rows.push(tags.map((m, k) => {
      const end = k + 1 < tags.length ? tags[k + 1].index : row.length;
      const inner = m[2] ? "" : row.slice(m.index + m[0].length, end).replace(/<\/t[dh]\s*>[\s\S]*$/i, "");
      return { text: decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(), span: Number(/colspan\s*=\s*["']?(\d+)/i.exec(m[1])?.[1] ?? 1) || 1 };
    }));
  }
  return rows;
}

function tableToParts(html: string, out: Part[]) {
  // A table holding tables is layout: read it as text.
  if ((html.match(/<table\b/gi)?.length ?? 0) > 1) { textParts(html, out); return; }
  const rows = tableRows(html);
  const texts = rows.map((r) => r.map((c) => (typeof c === "string" ? c : c.text)).filter(Boolean)).filter((t) => t.length);
  // An item heading set out as a small table ("Item 1A." | "Risk Factors"), as some filing agents do.
  if (texts.length && texts.length <= 2 && texts.some((t) => filingHeading(t.join(" ")))) {
    for (const t of texts) {
      const f = filingHeading(t.join(" "));
      if (f) { out.push({ kind: "heading", text: f.heading, section: f.section }); if (f.rest) out.push({ kind: "text", text: f.rest }); } else out.push({ kind: "text", text: t.join(" ") });
    }
    return;
  }
  const prev = out[out.length - 1];
  let units: string | undefined;
  if (prev?.kind === "text" && prev.text.length <= 120 && UNITS.test(prev.text)) { units = prev.text; out.pop(); }
  const parts = texts.length ? tableParts(rows, units) : [];
  // The units line goes back when the table turns out to be layout; a table with no cells is read as text.
  if (units && !parts.some((p) => p.kind === "table")) out.push({ kind: "text", text: units });
  if (!parts.length) { textParts(html, out); return; }
  out.push(...parts);
}

/** A filing's (or any) HTML as parts in reading order. Pure. */
export function partsFromHtml(html: string): Part[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ").replace(/<head\b[\s\S]*?<\/head>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    // Page breaks become a marker line, so page numbers beside them can be told from figures.
    .replace(/<hr\b[^>]*>|<(div|p)\b[^>]*page-break-(before|after)\s*:\s*always[^>]*>/gi, `\n<p>${BREAK}</p>\n`);
  const out: Part[] = [];
  let depth = 0, start = 0, last = 0;
  for (const m of body.matchAll(/<(\/?)table\b[^>]*>/gi)) {
    if (!m[1]) {
      if (depth++ === 0) { textParts(body.slice(last, m.index), out); start = m.index; }
    } else if (depth > 0 && --depth === 0) {
      const end = m.index + m[0].length;
      tableToParts(body.slice(start, end), out);
      last = end;
    }
  }
  textParts(body.slice(depth > 0 ? start : last), out);
  return out;
}
