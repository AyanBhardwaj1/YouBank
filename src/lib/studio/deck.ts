/**
 * The deck: slides whose tables, charts and figures are links into the model, so a changed
 * assumption flows to every page. Also the builders for standard decks and the tie-out check.
 */
import { parseRange, MAX_ROW, MAX_COL, addr as A1 } from "./address";
import type { Engine } from "./engine";
import { formatValue } from "./format";
import { isErr, type Prim } from "./values";
import type { Anchors, Fin } from "./templates";
import { DEFAULT_THEME, SLIDE_W, newId, type ChartData, type Deck, type RangeLink, type Slide, type SlideEl, type Workbook } from "./types";

/* ---------------- Resolving links ---------------- */

export type TableCell = { text: string; bold?: boolean; align?: "left" | "center" | "right"; fill?: string; value: Prim };

export function linkRect(link: RangeLink, engine: Engine) {
  const rect = parseRange(link.range);
  if (!rect || !engine.wb.sheets[link.sheet]) return null;
  const u = engine.usedRange(link.sheet);
  return { ...rect, r2: rect.r2 === MAX_ROW ? u.rows : rect.r2, c2: rect.c2 === MAX_COL ? u.cols : rect.c2 };
}

/** A linked range as display text, with each cell's own number format and emphasis. */
export function resolveTable(link: RangeLink, engine: Engine): TableCell[][] | null {
  const rect = linkRect(link, engine);
  if (!rect) return null;
  const sheet = engine.wb.sheets[link.sheet];
  const out: TableCell[][] = [];
  for (let r = rect.r1; r <= rect.r2 && out.length < 60; r++) {
    const row: TableCell[] = [];
    for (let c = rect.c1; c <= rect.c2 && row.length < 16; c++) {
      const a = A1(r, c);
      const cell = sheet.cells[a];
      const value = engine.get(link.sheet, a);
      row.push({ text: formatValue(value, cell?.s?.nf).text.trim(), bold: cell?.s?.b, align: typeof value === "number" ? "right" : cell?.s?.al, fill: cell?.s?.fill, value });
    }
    if (row.some((x) => x.text !== "")) out.push(row);
  }
  return out;
}

export function resolveValue(link: RangeLink, engine: Engine, nf?: string): { text: string; value: Prim } | null {
  const rect = linkRect(link, engine);
  if (!rect) return null;
  const a = A1(rect.r1, rect.c1);
  const value = engine.get(link.sheet, a);
  return { text: formatValue(value, nf ?? engine.wb.sheets[link.sheet].cells[a]?.s?.nf).text.trim(), value };
}

const numOf = (v: Prim) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const textOf = (v: Prim) => (v === null ? "" : isErr(v) ? v.code : String(v));

/** Chart data from its links, or its stored data. */
export function resolveChart(el: Extract<SlideEl, { type: "chart" }>, engine: Engine): ChartData | null {
  if (el.series?.length) {
    const labels = el.labels ? engine.read(el.labels.sheet, el.labels.range).flat().map(textOf) : [];
    const series = el.series.map((s) => ({ name: s.name, values: engine.wb.sheets[s.link.sheet] ? engine.read(s.link.sheet, s.link.range).flat().map(numOf) : [] }));
    const n = Math.max(labels.length, ...series.map((s) => s.values.length));
    return { labels: labels.length ? labels : Array.from({ length: n }, (_, i) => String(i + 1)), series };
  }
  if (el.link && engine.wb.sheets[el.link.sheet]) {
    const g = engine.read(el.link.sheet, el.link.range);
    if (el.kind === "football") {
      const rows = g.filter((r) => textOf(r[0]).trim() !== "");
      return { labels: rows.map((r) => textOf(r[0])), series: [{ name: "Low", values: rows.map((r) => numOf(r[1])) }, { name: "High", values: rows.map((r) => numOf(r[2])) }] };
    }
    if (el.kind === "waterfall" || el.kind === "pie" || (g[0] && g[0].length === 2 && g.length > 2)) {
      const rows = g.filter((r) => textOf(r[0]).trim() !== "");
      return { labels: rows.map((r) => textOf(r[0])), series: [{ name: el.title ?? "Value", values: rows.map((r) => numOf(r[1])) }] };
    }
    const [head, ...rest] = g;
    return { labels: (head ?? []).slice(1).map(textOf), series: rest.filter((r) => textOf(r[0]) !== "").map((r) => ({ name: textOf(r[0]), values: r.slice(1).map(numOf) })) };
  }
  return el.data ?? null;
}

export function resolveMarker(el: Extract<SlideEl, { type: "chart" }>, engine: Engine): { label: string; value: number } | null {
  if (!el.marker) return null;
  if (el.marker.link) { const v = resolveValue(el.marker.link, engine); const n = v ? numOf(v.value) : null; return n === null ? null : { label: el.marker.label, value: n }; }
  return el.marker.value !== undefined ? { label: el.marker.label, value: el.marker.value } : null;
}

/* ---------------- Building decks ---------------- */

const M = 0.5; // side margin, inches
const BODY_W = SLIDE_W - 2 * M;

/** "DCF!C47" → a link, with the sheet named as in the workbook. */
export function anchorLink(anchor: string, wb: Workbook): RangeLink {
  const i = anchor.lastIndexOf("!");
  const name = anchor.slice(0, i).replace(/^'|'$/g, "");
  const id = wb.order.find((x) => wb.sheets[x].name.toLowerCase() === name.toLowerCase()) ?? name;
  return { sheet: id, range: anchor.slice(i + 1).replace(/\$/g, "") };
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export const el = (e: DistOmit<SlideEl, "id">): SlideEl => ({ ...e, id: newId("el") }) as SlideEl;

export function titleSlide(title: string, subtitle: string): Slide {
  return { id: newId("sl"), layout: "title", title, subtitle, elements: [] };
}

function metricRow(items: { label: string; link: RangeLink; nf?: string }[], y: number): SlideEl[] {
  const gap = 0.25, w = (BODY_W - gap * (items.length - 1)) / items.length;
  return items.map((m, i) => el({ type: "metric", x: M + i * (w + gap), y, w, h: 1.15, label: m.label, link: m.link, nf: m.nf }));
}

export function monthYear(d = new Date()) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The valuation discussion deck: overview, comps, DCF, football field, sensitivity. */
export function buildValuationDeck(f: Fin, wb: Workbook, a: { dcf?: Anchors; comps?: Anchors; summary?: Anchors }): Deck {
  const L = (x: string) => anchorLink(x, wb);
  const slides: Slide[] = [titleSlide(f.name, `Valuation perspectives · Discussion materials · ${monthYear()}`)];
  const src = f.illustrative ? "Illustrative inputs." : `Source: SEC EDGAR XBRL company facts (LTM to ${f.periodEnd})${f.priceAsOf ? `; market data as of ${f.priceAsOf.slice(0, 10)}` : ""}. USD in millions except per share.`;
  if (a.dcf) {
    slides.push({
      id: newId("sl"), layout: "content", title: `${f.name} at a glance`, sources: src,
      elements: [
        ...metricRow([
          { label: "LTM revenue ($mm)", link: L(a.dcf.revenueLtm) }, { label: "Revenue growth", link: L(a.dcf.growthLtm) },
          { label: "EBITDA margin", link: L(a.dcf.marginLtm) }, { label: "Share price", link: L(a.dcf.price) },
        ], 1.35),
        el({ type: "text", x: M, y: 2.8, w: BODY_W, h: 3.6, text: f.description.slice(0, 900) || "Company description.", size: 13 }),
      ],
    });
  }
  if (a.comps) {
    slides.push({
      id: newId("sl"), layout: "content", title: "Trading comparables", sources: `${src} EBITDA is reported (operating income + D&A). NM = not meaningful.`,
      elements: [el({ type: "table", x: M, y: 1.3, w: BODY_W, h: 5.4, link: L(a.comps.table), header: true, size: 9 })],
    });
  }
  if (a.dcf) {
    slides.push({
      id: newId("sl"), layout: "content", title: "Discounted cash flow analysis", sources: `${src} Mid-year convention; terminal value by perpetuity growth.`,
      elements: [
        el({ type: "table", x: M, y: 1.3, w: 7.6, h: 5.3, link: L(a.dcf.fcfTable), header: true, size: 9 }),
        el({ type: "metric", x: 8.45, y: 1.3, w: 4.35, h: 1.2, label: "Enterprise value ($mm)", link: L(a.dcf.ev) }),
        el({ type: "metric", x: 8.45, y: 2.65, w: 4.35, h: 1.2, label: "Implied share price", link: L(a.dcf.implied) }),
        el({ type: "chart", x: 8.45, y: 4.0, w: 4.35, h: 2.6, kind: "column", title: "Unlevered free cash flow ($mm)", labels: L(a.dcf.yearLabels), series: [{ name: "UFCF", link: L(a.dcf.fcfRow) }] }),
      ],
    });
  }
  if (a.summary) {
    slides.push({
      id: newId("sl"), layout: "content", title: "Valuation summary", sources: `${src} Implied value per share. Bars show the low-to-high range for each method; the line is the current share price.`,
      elements: [el({ type: "chart", x: M, y: 1.3, w: BODY_W, h: 5.3, kind: "football", link: L(a.summary.football), title: "Implied share price ($)", nf: "$#,##0.00", marker: { label: "Current", link: L(a.summary.current) } })],
    });
  }
  if (a.dcf) {
    slides.push({
      id: newId("sl"), layout: "content", title: "DCF sensitivity", sources: "Implied share price across WACC (rows) and terminal growth (columns).",
      elements: [
        el({ type: "table", x: 2.2, y: 1.6, w: 8.9, h: 3.4, link: L(a.dcf.sensitivity), header: true, size: 12 }),
        el({ type: "metric", x: 2.2, y: 5.3, w: 4.3, h: 1.2, label: "WACC", link: L(a.dcf.wacc) }),
        el({ type: "metric", x: 6.8, y: 5.3, w: 4.3, h: 1.2, label: "Terminal value as % of EV", link: L(a.dcf.tvPct) }),
      ],
    });
  }
  return { order: slides.map((s) => s.id), slides: Object.fromEntries(slides.map((s) => [s.id, s])), theme: { ...DEFAULT_THEME, footer: f.name } };
}

/** An investment committee deck for the LBO. */
export function buildLboDeck(f: Fin, wb: Workbook, a: Anchors): Deck {
  const L = (x: string) => anchorLink(x, wb);
  const slides: Slide[] = [
    titleSlide(`Project ${f.name.split(/\s+/)[0]}`, `Investment committee discussion · ${monthYear()}`),
    {
      id: newId("sl"), layout: "content", title: "Transaction overview", sources: "USD in millions. Illustrative capital structure; see the model for all assumptions.",
      elements: [
        el({ type: "table", x: M, y: 1.3, w: 6.4, h: 3.6, link: L(a.sourcesUses), header: true, size: 11 }),
        el({ type: "metric", x: 7.4, y: 1.3, w: 5.4, h: 1.2, label: "Purchase enterprise value ($mm)", link: L(a.entryEv) }),
        el({ type: "metric", x: 7.4, y: 2.65, w: 2.6, h: 1.2, label: "IRR", link: L(a.irr) }),
        el({ type: "metric", x: 10.2, y: 2.65, w: 2.6, h: 1.2, label: "MOIC", link: L(a.moic) }),
        el({ type: "text", x: 7.4, y: 4.05, w: 5.4, h: 2.6, text: "- Investment thesis\n- Value creation levers\n- Key risks and mitigants", size: 13, bullets: true }),
      ],
    },
    {
      id: newId("sl"), layout: "content", title: "Operating model", sources: "USD in millions.",
      elements: [el({ type: "table", x: M, y: 1.3, w: BODY_W, h: 5.4, link: L(a.operating), header: true, size: 9 })],
    },
    {
      id: newId("sl"), layout: "content", title: "Returns sensitivity", sources: "IRR across entry multiple (rows) and exit multiple (columns).",
      elements: [el({ type: "table", x: 2.2, y: 1.6, w: 8.9, h: 3.6, link: L(a.sensitivity), header: true, size: 12 })],
    },
  ];
  return { order: slides.map((s) => s.id), slides: Object.fromEntries(slides.map((s) => [s.id, s])), theme: { ...DEFAULT_THEME, footer: `Project ${f.name.split(/\s+/)[0]}` } };
}

/* ---------------- Tie-out ---------------- */

export type TieIssue = { slide: string; slideTitle: string; element?: string; severity: "error" | "warning"; message: string };

const NUM_TOKEN = /\(?\$?-?\d[\d,]*(?:\.\d+)?\)?\s*(?:%|x|bn|billion|mm|million|m)?/gi;

/** Every number a slide's own text states, parsed to a value and the tolerance its rounding implies. */
function statedNumbers(text: string): { raw: string; value: number; tol: number; pct: boolean }[] {
  const out: { raw: string; value: number; tol: number; pct: boolean }[] = [];
  for (const m of text.matchAll(NUM_TOKEN)) {
    const raw = m[0].trim();
    const digits = raw.replace(/[^\d.]/g, "");
    if (!/\d/.test(digits) || /^(19|20)\d\d$/.test(digits)) continue; // years are not figures
    const neg = /^\(|-/.test(raw);
    let v = Number(digits.replace(/,/g, ""));
    const dec = (digits.split(".")[1] ?? "").length;
    let tol = 0.5 * Math.pow(10, -dec);
    const pct = /%$/.test(raw);
    if (pct) { v /= 100; tol /= 100; }
    if (/bn|billion/i.test(raw)) { v *= 1000; tol *= 1000; }
    if (neg) v = -v;
    if (Math.abs(v) < 2 && !pct && !/x$/i.test(raw) && !raw.includes("$")) continue; // list numbering and small counts
    out.push({ raw, value: v, tol: tol + 1e-9, pct });
  }
  return out;
}

/**
 * Check a deck against its model: every linked element resolves without errors, and every number a
 * slide states in its own text or in an unlinked table can be found in the model at the precision shown.
 */
export function tieOut(deck: Deck, engine: Engine): TieIssue[] {
  const issues: TieIssue[] = [];
  const modelValues: number[] = [];
  for (const id of engine.wb.order) for (const a of Object.keys(engine.wb.sheets[id].cells)) { const v = engine.get(id, a); if (typeof v === "number" && Number.isFinite(v)) modelValues.push(v); }
  const found = (x: { value: number; tol: number }) => modelValues.some((v) => Math.abs(v - x.value) <= x.tol || Math.abs(v * 1000 - x.value) <= x.tol * 1000);
  for (const sid of deck.order) {
    const s = deck.slides[sid];
    if (!s) continue;
    const at = (message: string, severity: TieIssue["severity"], element?: string) => issues.push({ slide: sid, slideTitle: s.title, element, severity, message });
    for (const e of s.elements) {
      if (e.type === "table" && e.link) {
        const t = resolveTable(e.link, engine);
        if (!t) at("Linked table points at a sheet or range that no longer exists.", "error", e.id);
        else if (t.some((r) => r.some((c) => isErr(c.value)))) at("Linked table shows an error value from the model.", "error", e.id);
      }
      if (e.type === "metric" && e.link) {
        const v = resolveValue(e.link, engine, e.nf);
        if (!v) at(`"${e.label}" points at a cell that no longer exists.`, "error", e.id);
        else if (isErr(v.value)) at(`"${e.label}" shows ${v.text}.`, "error", e.id);
      }
      if (e.type === "chart" && (e.link || e.series)) {
        const d = resolveChart(e, engine);
        if (!d || !d.series.length) at(`Chart "${e.title ?? e.kind}" has no data from its link.`, "error", e.id);
      }
      const statedText = e.type === "text" ? e.text : e.type === "metric" && !e.link ? e.value ?? "" : e.type === "table" && !e.link ? (e.rows ?? []).flat().join("  ") : "";
      if (e.type === "table" && !e.link && e.rows?.length) at("Table is typed in, not linked to the model, so it will not update.", "warning", e.id);
      for (const n of statedNumbers(statedText)) if (!found(n)) at(`"${n.raw}" is not in the model at the precision shown.`, "warning", e.id);
    }
    for (const n of statedNumbers(`${s.title} ${s.subtitle ?? ""}`)) if (!found(n)) at(`Title figure "${n.raw}" is not in the model.`, "warning");
  }
  return issues;
}

export function slideCount(deck: Deck) { return deck.order.length; }
