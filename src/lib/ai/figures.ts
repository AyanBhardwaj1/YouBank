/**
 * Which figures in an answer match a number in the source they cite (sleep-research/EXPERIMENT_PLAN.md, B2).
 *
 * Every tool call is recorded with its raw output and the source ids it issued (agent.ts). After the answer,
 * each figure in it ("$5.4 billion", "67.3%", "2.5x") is checked only against the values of the source it
 * cites, typed by unit from the payload's own field names: money against money at its stated scale (a
 * `*_usd_mm` field is millions of dollars), percentages against percentages (a `*_margin` fraction is a
 * percentage), multiples against multiples. There is no free arithmetic between payload numbers: a derived
 * figure counts only when the run's `calc` tool produced it. The pilot (sleep-research/runs/probe-verify*.json)
 * showed pairwise derivations and cross-company pools are what let wrong figures through.
 *
 * A match says the figure appears in the cited source, with the field and period it matched, so a reader
 * can see a wrong-field choice ("prior LTM revenue" under the words "LTM revenue"). It does not say the
 * figure is the right one to quote: that stays the model's choice, and the UI says "matches the source",
 * never "correct". Figures that cite only text (a filing excerpt, the web) are "cited, not checked". Pure.
 */
import { extractNumbers, type Num, type Unit } from "@/lib/edge/claims/numbers";
import type { Source } from "./tools";

/** One tool call: what it returned and the source ids it issued while running. */
export type ToolRecord = { tool: string; input: unknown; output: string; isError: boolean; sourceIds: string[] };

/** A number in a structured tool result, with its unit, the sources it belongs to, and where it sits. */
export type Leaf = { value: number; unit: Unit; path: string; label: string; period: string | null; sources: string[] };

export type FigureStatus = "matched" | "computed" | "no_match" | "text_only" | "uncited";
export type FigureCheck = { raw: string; index: number; unit: Unit; cites: string[]; status: FigureStatus; field?: string; period?: string | null };
export type FigureReport = { figures: FigureCheck[]; checkable: number; matched: number; computed: number; noMatch: number; textOnly: number; uncited: number };

/** Keys that hold numbers which are not figures (identifiers, codes, dates, counts of rows). */
const SKIP_KEY = /^(sic|cik|fye|id|accession|form|year|period(_end)?|as_of|ltm_end|date|filed|zip|phone|total_matches|text_length|offset|peer_count|line|step|seq|rank)$/i;
const PERIOD_KEY = /^(period_end|ltm_end|as_of|date|filed)$/i;

/** The unit and multiplier a bare number has, read from its field name and the names above it. */
function unitOf(path: string[], value: number): { unit: Unit; scale: number } | null {
  const key = path[path.length - 1] ?? "";
  const all = path.join(".");
  if (SKIP_KEY.test(key)) return null;
  if (/(^|_)(margin|growth|rate|yield|pct|percent|change|cagr|return)(_|$)/i.test(key) && Math.abs(value) <= 5) return { unit: "pct", scale: 100 };
  if (/^(ev_to_|pe_|pe$|price_to_)|(_to_)|(^|_)(multiple|ev_rev|ev_ebitda|ev_fcf)(_|$)/i.test(key)) return { unit: "x", scale: 1 };
  if (/shares/i.test(key)) return { unit: "count", scale: /_mm$/i.test(key) || /_mm(\.|$)/i.test(all) ? 1e6 : 1 };
  if (/_usd_mm$/i.test(key) || /(^|\.)[a-z_]*usd_mm(\.|$)/i.test(all)) return { unit: "usd", scale: 1e6 };
  if (/(^|_)(price|usd|value|amount|raised|cost)$/i.test(key)) return { unit: "usd", scale: 1 };
  return { unit: "count", scale: 1 };
}

/** A value written as text in a payload ("2.5x", "34%", "1.2B", "$450M"), or null. */
function parseText(s: string): { value: number; unit: Unit } | null {
  const t = s.trim().replace(/,/g, "");
  let m = /^(-?\d+(?:\.\d+)?)\s*x$/i.exec(t);
  if (m) return { value: Number(m[1]), unit: "x" };
  m = /^([+-]?\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) return { value: Number(m[1]), unit: "pct" };
  m = /^\$?(-?\d+(?:\.\d+)?)\s*([KMBT])$/i.exec(t);
  if (m) return { value: Number(m[1]) * { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase() as "K"], unit: "usd" };
  m = /^\$(-?\d+(?:\.\d+)?)$/.exec(t);
  if (m) return { value: Number(m[1]), unit: "usd" };
  return null;
}

const human = (key: string) => key.replace(/_usd_mm$|_mm$/i, "").replace(/_/g, " ").replace(/\bltm\b/i, "LTM").replace(/\bev\b/gi, "EV").replace(/\bfcf\b/gi, "FCF").replace(/\bpe\b/gi, "P/E").trim();

/**
 * Every typed number in a tool result. A leaf belongs to the source named by the nearest object above it
 * that has `source`; a `valuation*` block answers to its object's `price_source` too.
 */
export function leavesOf(rec: ToolRecord): Leaf[] {
  if (rec.isError) return [];
  let data: unknown;
  try { data = JSON.parse(rec.output); } catch { return []; }
  const out: Leaf[] = [];
  const walk = (v: unknown, path: string[], sources: string[], period: string | null) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, String(i)], sources, period)); return; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const id = (x: unknown) => (typeof x === "string" && /^S\d+$/.test(x) ? x : null);
      const here = id(o.source) ? [id(o.source)!] : sources;
      const p = (Object.entries(o).find(([k, x]) => PERIOD_KEY.test(k) && typeof x === "string")?.[1] as string | undefined) ?? period;
      for (const [k, x] of Object.entries(o)) {
        if (k === "source" || k === "price_source") continue;
        // The valuation block mixes the feed's price with filed figures (EV adds debt, less cash), so it
        // answers to the price source and the facts source alike.
        const scoped = k.startsWith("valuation") && id(o.price_source) ? [id(o.price_source)!, ...here] : here;
        walk(x, [...path, k], scoped, p);
      }
      return;
    }
    const key = path[path.length - 1] ?? "";
    if (/^\d+$/.test(key) || SKIP_KEY.test(key)) return;
    let leaf: { value: number; unit: Unit } | null = null;
    if (typeof v === "number" && Number.isFinite(v)) {
      const u = unitOf(path.filter((s) => !/^\d+$/.test(s)), v);
      if (u) leaf = { value: v * u.scale, unit: u.unit };
    } else if (typeof v === "string") leaf = parseText(v);
    if (leaf) out.push({ ...leaf, path: path.join("."), label: human(key), period, sources });
  };
  // Values outside any object with its own source (a comps grid's peer median) belong to the call's source
  // only when it issued exactly one; otherwise they are nobody's single figure.
  walk(data, [], rec.sourceIds.length === 1 ? rec.sourceIds : [], null);
  return out;
}

/**
 * The value at `S3.ltm_usd_mm.revenue`: the field path under the object that carries source S3 (or, for a
 * `valuation*` path, its price_source), as the tool returned it. Numbers only, in the payload's own units
 * (USD millions stay millions); "2.5x" reads as 2.5 and "34%" as 0.34. Null when there is no such value.
 */
export function resolveRef(records: ToolRecord[], ref: string): number | null {
  const m = /^(S\d+)\.([A-Za-z0-9_.]+)$/.exec(ref.trim());
  if (!m) return null;
  const [, id, path] = m;
  const keys = path.split(".");
  const follow = (o: unknown): number | null => {
    let v: unknown = o;
    for (const k of keys) { if (!v || typeof v !== "object") return null; v = (v as Record<string, unknown>)[k]; }
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const x = /^(-?\d+(?:\.\d+)?)\s*x$/i.exec(v.trim()); if (x) return Number(x[1]);
      const p = /^([+-]?\d+(?:\.\d+)?)\s*%$/.exec(v.trim()); if (p) return Number(p[1]) / 100;
    }
    return null;
  };
  for (const r of records) {
    if (r.isError || !r.sourceIds.includes(id)) continue;
    let data: unknown;
    try { data = JSON.parse(r.output); } catch { continue; }
    if (r.sourceIds.length === 1) { const v = follow(data); if (v !== null) return v; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const o = stack.pop();
      if (Array.isArray(o)) { stack.push(...o); continue; }
      if (!o || typeof o !== "object") continue;
      const rec = o as Record<string, unknown>;
      if (rec.source === id || (rec.price_source === id && keys[0].startsWith("valuation"))) { const v = follow(rec); if (v !== null) return v; }
      stack.push(...Object.values(rec));
    }
  }
  return null;
}

/** Results of `calc` calls in the run: derived figures count only when they were computed there. */
function calcValues(records: ToolRecord[]): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.tool !== "calc" || r.isError) continue;
    try {
      for (const x of (JSON.parse(r.output) as { results?: { value: unknown }[] }).results ?? []) if (typeof x.value === "number") out.push(x.value);
    } catch { /* not JSON: nothing computed */ }
  }
  return out;
}

const SCALE_WORD = /(thousand|million|billion|trillion|\bmm\b|\bmn\b|\bbn\b|\btn\b|\bk\b|\bm\b|\bb\b)/i;
const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, mm: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12 };

/** Within half a unit of the figure's last written digit, at the scale it was written in. */
export function close(claim: Num, value: number): boolean {
  const w = SCALE_WORD.exec(claim.raw);
  const scale = w ? SCALE[w[1].toLowerCase()] ?? 1 : 1;
  const tol = Math.max(0.5 * Math.pow(10, -claim.dp) * scale, Math.abs(claim.value) * 1e-4, 1e-9);
  return Math.abs(claim.value - value) <= tol || (claim.unit === "pct" && Math.abs(Math.abs(claim.value) - Math.abs(value)) <= tol);
}

/** The [S1] / [S1, S3] citations in a stretch of text. */
const citesIn = (s: string) => [...new Set([...s.matchAll(/\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g)].flatMap((m) => m[1].split(/\s*[,;]\s*/)))];

/** Check every figure in `text` against the records of the run. */
export function checkFigures(text: string, records: ToolRecord[], sources: Pick<Source, "id">[] = []): FigureReport {
  const leaves = records.flatMap(leavesOf);
  const structured = new Set(leaves.flatMap((l) => l.sources));
  const known = new Set(sources.map((s) => s.id));
  const computed = calcValues(records);
  const figures: FigureCheck[] = [];
  // A figure's citations are those in its sentence (or line), the way the system prompt asks for them.
  // A sentence ends at . ! or ? followed by a space (not the point in "5.4"), or at a line break.
  const sentences: { s: string; at: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/(?<=[.!?])\s+|\n+/g)) { sentences.push({ s: text.slice(start, m.index), at: start }); start = (m.index ?? 0) + m[0].length; }
  sentences.push({ s: text.slice(start), at: start });
  for (const { s, at } of sentences) {
    const cites = citesIn(s).filter((c) => !known.size || known.has(c));
    // Citation markers themselves ("S1") are not figures.
    for (const n of extractNumbers(s.replace(/\[S\d+(?:\s*[,;]\s*S\d+)*\]/g, (m) => " ".repeat(m.length)))) {
      if (n.unit === "count" && !cites.length) continue; // a bare count with no citation is not a claim to check
      const base = { raw: n.raw, index: at + n.index, unit: n.unit, cites };
      if (!cites.length) { figures.push({ ...base, status: "uncited" }); continue; }
      const pool = leaves.filter((l) => l.unit === n.unit && l.sources.some((src) => cites.includes(src)));
      const hit = pool.find((l) => close(n, l.value));
      if (hit) { figures.push({ ...base, status: "matched", field: hit.label, period: hit.period }); continue; }
      const viaCalc = computed.some((v) => n.unit === "usd" ? close(n, v) || close(n, v * 1e6) : n.unit === "pct" ? close(n, v) || close(n, v * 100) : close(n, v));
      if (viaCalc) { figures.push({ ...base, status: "computed" }); continue; }
      figures.push({ ...base, status: cites.some((c) => structured.has(c)) ? "no_match" : "text_only" });
    }
  }
  const count = (st: FigureStatus) => figures.filter((f) => f.status === st).length;
  const matched = count("matched"), comp = count("computed"), noMatch = count("no_match");
  return { figures, checkable: matched + comp + noMatch, matched, computed: comp, noMatch, textOnly: count("text_only"), uncited: count("uncited") };
}
