/**
 * The deck brand check: what gets a book sent back before anyone reads the analysis. A stale cover
 * date, a page of numbers without a source line, text in off-brand colours, elements off the page or
 * on top of each other, text that will not fit its box, tables too long for their space, empty pages.
 * Most come with a one-click fix.
 */
import { parseRange } from "./address";
import { monthYear } from "./deck";
import type { Patch } from "./ops";
import { SLIDE_W, type Slide, type SlideEl, type StudioDocData } from "./types";

export type LintIssue = {
  /** Stable for a given deck, so a fix can be asked for by key. */
  key: string;
  slide: string; slideTitle: string; element?: string;
  severity: "error" | "warning" | "info"; rule: string; message: string;
  fix?: Patch[]; fixLabel?: string;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_YEAR = new RegExp(`\\b(${MONTHS.join("|")})\\s+(20\\d\\d)\\b`, "i");

/** Where a slide's body may go: below the title rule, above the footer. */
const BODY = { x: 0.3, y: 1.1, r: SLIDE_W - 0.3, b: 6.85 };

function overlap(a: SlideEl, b: SlideEl): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/** Rough capacity of a text box: characters per line from the width, lines from the height. */
function overflows(e: Extract<SlideEl, { type: "text" }>): boolean {
  const size = e.size ?? 14;
  const perLine = Math.max(8, Math.floor((e.w * 72) / (size * 0.52)));
  const lines = e.text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  const capacity = Math.floor((e.h * 72) / (size * 1.32));
  return lines > capacity;
}

export function lintDeck(doc: StudioDocData, now = new Date()): LintIssue[] {
  const issues: LintIssue[] = [];
  const deck = doc.deck;
  const palette = new Set([deck.theme.primary, deck.theme.accent, "#1F1F1F", "#000000", "#FFFFFF", "#595959", "#7F7F7F", "#6B7280"].map((c) => c.toUpperCase()));
  const upsert = (slide: Slide): Patch[] => [{ op: "slide_upsert", slide }];
  const withElement = (s: Slide, e: SlideEl): Patch[] => upsert({ ...s, elements: s.elements.map((x) => (x.id === e.id ? e : x)) });
  const current = monthYear(now);
  const seen = new Map<string, number>();
  for (const id of deck.order) {
    const s = deck.slides[id];
    if (!s) continue;
    const at = (x: Omit<LintIssue, "slide" | "slideTitle" | "key">) => {
      const base = `${x.rule}:${id}:${x.element ?? ""}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      issues.push({ key: n ? `${base}:${n}` : base, slide: id, slideTitle: s.title, ...x });
    };

    if (s.layout === "title") {
      const m = MONTH_YEAR.exec(s.subtitle ?? "");
      if (m) {
        const stated = Date.UTC(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase()), 1);
        if (stated < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) {
          at({ severity: "error", rule: "stale-cover-date", message: `The cover says ${m[0]}; it is ${current}.`, fix: upsert({ ...s, subtitle: (s.subtitle ?? "").replace(MONTH_YEAR, current) }), fixLabel: `Change to ${current}` });
        }
      }
      continue;
    }
    if (!s.elements.length) at({ severity: "warning", rule: "empty-slide", message: "The slide has no content." });
    if (s.title.length > 70) at({ severity: "warning", rule: "long-title", message: `The title is ${s.title.length} characters; keep titles to one line (about 70).` });
    const numeric = s.elements.some((e) => e.type === "table" || e.type === "chart" || e.type === "metric");
    if (numeric && !s.sources?.trim()) {
      const sheets = [...new Set(s.elements.flatMap((e) => ("link" in e && e.link ? [doc.workbook.sheets[e.link.sheet]?.name] : "series" in e && e.series ? e.series.map((q) => doc.workbook.sheets[q.link.sheet]?.name) : [])).filter(Boolean))];
      const line = `Source: YouBank model${sheets.length ? ` (${sheets.join(", ")})` : ""}; SEC EDGAR filings. USD in millions except per share.`;
      at({ severity: "error", rule: "missing-source", message: "A page of figures without a source line.", fix: upsert({ ...s, sources: line }), fixLabel: "Add a source line" });
    }
    s.elements.forEach((e, i) => {
      const off = e.x < BODY.x - 0.05 || e.y < BODY.y - 0.05 || e.x + e.w > BODY.r + 0.05 || e.y + e.h > BODY.b + 0.05;
      if (off) {
        const w = Math.min(e.w, BODY.r - BODY.x), h = Math.min(e.h, BODY.b - BODY.y);
        const fixed = { ...e, w, h, x: Math.min(Math.max(e.x, BODY.x), BODY.r - w), y: Math.min(Math.max(e.y, BODY.y), BODY.b - h) } as SlideEl;
        at({ element: e.id, severity: "warning", rule: "off-page", message: `A ${e.type} runs outside the page body${e.y + e.h > BODY.b + 0.05 ? " into the footer" : ""}.`, fix: withElement(s, fixed), fixLabel: "Move it inside" });
      }
      for (const other of s.elements.slice(i + 1)) {
        if (overlap(e, other) > 0.15) at({ element: e.id, severity: "warning", rule: "overlap", message: `A ${e.type} overlaps a ${other.type}.` });
      }
      if (e.type === "text") {
        if (overflows(e)) at({ element: e.id, severity: "warning", rule: "overflow", message: "The text will likely not fit its box.", fix: withElement(s, { ...e, size: Math.max(10, (e.size ?? 14) - 2) }), fixLabel: "Reduce the font size" });
        if (e.color && !palette.has(e.color.toUpperCase())) at({ element: e.id, severity: "info", rule: "off-palette", message: `Text colour ${e.color} is not in the deck's palette.`, fix: withElement(s, { ...e, color: undefined }), fixLabel: "Use the theme colour" });
        if ((e.size ?? 14) < 9) at({ element: e.id, severity: "warning", rule: "small-text", message: `Text at ${e.size}pt is below 9pt, too small to read when printed.` });
      }
      if (e.type === "table" && e.link) {
        const r = parseRange(e.link.range);
        const rows = r ? r.r2 - r.r1 + 1 : 0;
        if (rows * 0.2 > e.h * 1.15) at({ element: e.id, severity: "warning", rule: "crowded-table", message: `The table has ${rows} rows in ${e.h.toFixed(1)} inches; it will print cramped. Split it or link fewer rows.` });
      }
      if (e.type === "metric" && !e.label.trim()) at({ element: e.id, severity: "warning", rule: "unlabelled-metric", message: "A headline figure has no caption." });
    });
  }
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * The chosen fixes as one set of patches. Fixes to the same slide stack: each carries only what it
 * changed (a subtitle, the source line, an element's properties), applied on top of the ones before.
 */
export function fixAll(doc: StudioDocData, issues: LintIssue[]): Patch[] {
  const slides = new Map<string, Slide>();
  for (const i of issues) {
    for (const p of i.fix ?? []) {
      if (p.op !== "slide_upsert") continue;
      const prev = doc.deck.slides[p.slide.id];
      if (!prev) continue;
      const base = slides.get(p.slide.id) ?? prev;
      const next: Slide = { ...base };
      if (p.slide.subtitle !== prev.subtitle) next.subtitle = p.slide.subtitle;
      if (p.slide.sources !== prev.sources) next.sources = p.slide.sources;
      next.elements = base.elements.map((e) => {
        const changed = p.slide.elements.find((x) => x.id === e.id) as Record<string, unknown> | undefined;
        const orig = prev.elements.find((x) => x.id === e.id) as Record<string, unknown> | undefined;
        if (!changed || !orig) return e;
        const delta: Record<string, unknown> = {};
        for (const k of new Set([...Object.keys(changed), ...Object.keys(orig)])) if (JSON.stringify(changed[k]) !== JSON.stringify(orig[k])) delta[k] = changed[k];
        return Object.keys(delta).length ? ({ ...e, ...delta } as SlideEl) : e;
      });
      slides.set(p.slide.id, next);
    }
  }
  return [...slides.values()].map((slide) => ({ op: "slide_upsert" as const, slide }));
}
