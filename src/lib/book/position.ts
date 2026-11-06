/**
 * The Book: a fund's positions, each with its thesis written so it can be proved wrong, and the check that
 * says, from filed numbers and the market, whether it still holds.
 *
 * A position is a ticker, long or short, an optional weight (% of NAV) and entry price, a one-line thesis,
 * its pillars (why), kill criteria (falsifiable checks: "revenue growth at least 20%", "gross margin at
 * least 70%", "price at least $150" as a stop) and dated catalysts. The evaluation reads the company's SEC
 * XBRL record and price (src/lib/company.ts) and says, for every criterion, the actual value, its period and
 * source, and whether it passes, is close to failing, or has failed; the thesis is intact, on watch, or
 * broken. The book adds exposure (gross, net, long, short) and P&L since entry.
 *
 * Agent-run, multi-day investigations of a thesis live in Edge (view=theses); this is the fund's own book,
 * checked on every read at no AI cost. Pure, tested in scripts/test-book.ts.
 */
import type { CompanyData } from "@/lib/types";
import type { Derived } from "@/lib/metrics";
import type { InsiderFact } from "./insiders";

export type Direction = "long" | "short";
export type Op = ">=" | "<=";

/** What a kill criterion can watch, with how to read it from a company and how to show it. */
export const METRICS = {
  revenue_growth: { label: "Revenue growth (LTM, y/y)", unit: "pct", read: (_c: CompanyData, d: Derived) => d.revenueGrowth },
  gross_margin: { label: "Gross margin (LTM)", unit: "pct", read: (_c: CompanyData, d: Derived) => d.grossMargin },
  operating_margin: { label: "Operating margin (LTM)", unit: "pct", read: (_c: CompanyData, d: Derived) => d.opMargin },
  fcf_margin: { label: "Free cash flow margin (LTM)", unit: "pct", read: (_c: CompanyData, d: Derived) => d.fcfMargin },
  rule_of_40: { label: "Rule of 40", unit: "pts", read: (_c: CompanyData, d: Derived) => d.ruleOf40 },
  revenue: { label: "Revenue (LTM, $M)", unit: "usdmm", read: (c: CompanyData) => c.ltm.revenue },
  net_debt: { label: "Net debt ($M)", unit: "usdmm", read: (_c: CompanyData, d: Derived) => d.netDebt },
  ev_revenue: { label: "EV / LTM revenue", unit: "x", read: (_c: CompanyData, d: Derived) => d.evRevLtm },
  pe: { label: "P/E (LTM)", unit: "x", read: (_c: CompanyData, d: Derived) => d.peLtm },
  price: { label: "Share price", unit: "usd", read: (c: CompanyData) => c.price?.last ?? null },
  /** From Form 4 filings, not the company record: checkCriterion reads it from the insider fact it is given. */
  insider_selling: { label: "Insider net selling, 90 days ($M)", unit: "usdmm", read: (): number | null => null },
} as const;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
const isMetric = (v: unknown): v is MetricKey => typeof v === "string" && v in METRICS;

/** Percentages are entered and shown as percent (20 means 20%); the data holds fractions. */
export const isPct = (m: MetricKey) => METRICS[m].unit === "pct";

export type Criterion = { id: string; metric: MetricKey; op: Op; value: number; note?: string };
export type Catalyst = { id: string; label: string; date: string };
export type RedTeam = { at: string; text: string; sources: { id: string; label: string; url: string }[] };
export type Position = {
  id: string; ticker: string; direction: Direction;
  /** % of NAV, positive; the direction gives its sign in exposure. */
  weight: number | null;
  /** Price paid (or shorted at), for P&L since entry. */
  entry: number | null;
  thesis: string; pillars: string[];
  criteria: Criterion[]; catalysts: Catalyst[]; createdAt: string; updatedAt: string; redTeam?: RedTeam;
};

export const POSITIONS_MAX = 25;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const idOk = (v: unknown) => typeof v === "string" && /^[a-z0-9-]{4,40}$/.test(v);
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const tickerOf = (v: unknown) => { const t = clip(v, 12).toUpperCase().replace(/^\$/, ""); return /^[A-Z][A-Z0-9]{0,9}([.-][A-Z0-9]{1,3})?$/.test(t) ? t : null; };
const dateOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
const numOf = (v: unknown, max: number) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n > 0 && n <= max ? n : null; };

/** One position as stored, cleaned; null when it has no valid ticker or thesis. */
export function normalizePosition(raw: unknown, now = new Date().toISOString()): Position | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ticker = tickerOf(r.ticker);
  const thesis = clip(r.thesis, 280);
  if (!ticker || !thesis) return null;
  const criteria = (Array.isArray(r.criteria) ? r.criteria : []).flatMap((x): Criterion[] => {
    const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const value = typeof c.value === "number" ? c.value : Number(c.value);
    if (!isMetric(c.metric) || (c.op !== ">=" && c.op !== "<=") || !Number.isFinite(value) || (typeof c.value === "string" && !c.value.trim())) return [];
    return [{ id: idOk(c.id) ? (c.id as string) : newId(), metric: c.metric, op: c.op, value, ...(clip(c.note, 140) ? { note: clip(c.note, 140) } : {}) }];
  }).slice(0, 8);
  const catalysts = (Array.isArray(r.catalysts) ? r.catalysts : []).flatMap((x): Catalyst[] => {
    const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const label = clip(c.label, 120), date = dateOf(c.date);
    return label && date ? [{ id: idOk(c.id) ? (c.id as string) : newId(), label, date }] : [];
  }).slice(0, 8);
  const rt = r.redTeam && typeof r.redTeam === "object" ? (r.redTeam as Record<string, unknown>) : null;
  const redTeam: RedTeam | undefined = rt && typeof rt.text === "string" && typeof rt.at === "string"
    ? { at: rt.at, text: rt.text.slice(0, 8000), sources: (Array.isArray(rt.sources) ? rt.sources : []).flatMap((s) => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return typeof o.id === "string" && typeof o.label === "string" && typeof o.url === "string" && /^https:\/\//.test(o.url) ? [{ id: o.id.slice(0, 8), label: o.label.slice(0, 200), url: o.url.slice(0, 500) }] : [];
    }).slice(0, 30) }
    : undefined;
  return {
    id: idOk(r.id) ? (r.id as string) : newId(), ticker, direction: r.direction === "short" ? "short" : "long",
    weight: numOf(r.weight, 100), entry: numOf(r.entry, 1_000_000),
    thesis, pillars: (Array.isArray(r.pillars) ? r.pillars : []).map((p) => clip(p, 200)).filter(Boolean).slice(0, 6),
    criteria, catalysts,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now,
    ...(redTeam ? { redTeam } : {}),
  };
}

/** Stored positions, cleaned: valid ones, one per id, at most POSITIONS_MAX. */
export function normalizeBook(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map((t) => normalizePosition(t)).filter((t): t is Position => !!t && !seen.has(t.id) && !!seen.add(t.id)).slice(0, POSITIONS_MAX);
}

/* ---------------- Checking a position's thesis ---------------- */

export type CheckState = "pass" | "near" | "fail" | "unknown";
export type CheckResult = {
  criterion: Criterion; label: string; state: CheckState;
  actual: number | null; shown: string; target: string;
  /** How far the figure is from breaking the criterion, in the criterion's units (positive: room left; negative: past it). */
  headroom: { value: number; shown: string } | null;
  /** Where the number comes from: period and a link a person can open. */
  evidence: { period: string; source: string; url: string } | null;
  /** Why there is no figure, when that is worth saying (insider selling not worked out yet, or incomplete). */
  note?: string;
};
export type Verdict = "intact" | "watch" | "broken" | "unknown";
export type PositionNews = { id: number; headline: string; at: string };
export type Evaluation = {
  positionId: string; ticker: string; name: string; direction: Direction; weight: number | null;
  /** The company's industry (its data provider's, else its SEC SIC description), for concentration. */
  industry: string;
  verdict: Verdict; score: number | null; price: number | null;
  /** Return since entry in the position's favour (a short gains when the price falls), as a fraction. */
  pnl: number | null;
  checks: CheckResult[]; catalysts: (Catalyst & { inDays: number })[]; news: PositionNews[];
  /** The company's next earnings date from the exchange's calendar (estimated until the company confirms it). */
  earnings: { date: string; estimated: boolean; inDays: number } | null;
  /** One plain sentence for the list and Home. */
  summary: string; checkedAt: string;
};

/** A value as a person reads it, in the criterion's unit. */
export function fmtMetric(m: MetricKey, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "n/a";
  const u = METRICS[m].unit;
  if (u === "pct") return `${(v * 100).toFixed(1)}%`;
  if (u === "pts") return v.toFixed(1);
  if (u === "x") return `${v.toFixed(1)}x`;
  if (u === "usd") return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString("en-US")}M`;
}

/** How close is "near": within 10% of the threshold (3 percentage points for percentages). */
function nearness(m: MetricKey, actual: number, threshold: number): boolean {
  const gap = Math.abs(actual - threshold);
  return isPct(m) ? gap <= 0.03 : gap <= Math.abs(threshold) * 0.1;
}

/**
 * The distance to a kill criterion: percentage points for percentages and Rule of 40, otherwise as a
 * share of the threshold ("12% above the stop"), or in the metric's own unit when the threshold is zero.
 */
export function headroomOf(c: Criterion, actual: number): { value: number; shown: string } {
  const threshold = isPct(c.metric) ? c.value / 100 : c.value;
  const room = c.op === ">=" ? actual - threshold : threshold - actual;
  const sign = (x: number) => (x >= 0 ? "+" : "−");
  const u = METRICS[c.metric].unit;
  if (u === "pct") return { value: room * 100, shown: `${sign(room)}${Math.abs(room * 100).toFixed(1)} pts` };
  if (u === "pts") return { value: room, shown: `${sign(room)}${Math.abs(room).toFixed(1)} pts` };
  if (threshold === 0) return { value: room, shown: `${sign(room)}${fmtMetric(c.metric, Math.abs(room))}` };
  const rel = room / Math.abs(threshold);
  return { value: rel * 100, shown: `${sign(rel)}${Math.abs(rel * 100).toFixed(1)}%` };
}

const targetOf = (c: Criterion) => `${c.op === ">=" ? "at least" : "at most"} ${fmtMetric(c.metric, isPct(c.metric) ? c.value / 100 : c.value)}`;

export function checkCriterion(c: Criterion, company: CompanyData, d: Derived, insider: InsiderFact | null = null): CheckResult {
  const m = METRICS[c.metric];
  const actual = c.metric === "insider_selling" ? (insider?.complete ? insider.value : null) : m.read(company, d);
  const threshold = isPct(c.metric) ? c.value / 100 : c.value;
  const target = targetOf(c);
  const evidence = actual === null ? null : c.metric === "insider_selling" && insider
    ? { period: `${insider.since} to ${insider.asOf.slice(0, 10)}`, source: `SEC Form 4 filings (${insider.filings} filed, ${insider.trades} open-market trade${insider.trades === 1 ? "" : "s"})`, url: insider.url }
    : c.metric === "price"
    ? (company.price ? { period: `as of ${company.price.asOf.slice(0, 16).replace("T", " ")} UTC`, source: `${company.price.source ?? "price feed"}${company.price.stale ? " (stale)" : ""}`, url: `https://www.nasdaq.com/market-activity/stocks/${company.ticker.toLowerCase()}` } : null)
    : { period: `LTM to ${company.ltm.periodEnd || "latest filing"}`, source: "SEC XBRL company facts", url: company.sources.factsUrl };
  if (actual === null || !Number.isFinite(actual)) return { criterion: c, label: m.label, state: "unknown", actual: null, shown: "n/a", target, evidence: null, headroom: null, ...(c.metric === "insider_selling" ? { note: insider ? `No complete figure: ${insider.note}.` : "Worked out from Form 4 filings after each US close." } : {}) };
  const pass = c.op === ">=" ? actual >= threshold : actual <= threshold;
  const state: CheckState = !pass ? "fail" : nearness(c.metric, actual, threshold) ? "near" : "pass";
  return { criterion: c, label: m.label, state, actual, shown: fmtMetric(c.metric, actual), target, evidence, headroom: headroomOf(c, actual) };
}

/**
 * The verdict: broken when any kill criterion has failed, on watch when one is close or nothing can be
 * checked yet, intact otherwise. The score is the share of checkable criteria passing with room (a close
 * one counts half).
 */
export type NextEarnings = { date: string | null; estimated: boolean } | null;

export function evaluate(p: Position, company: CompanyData | null, d: Derived | null, news: PositionNews[], now: Date, next: NextEarnings = null, insider: InsiderFact | null = null): Evaluation {
  const checks = company && d ? p.criteria.map((c) => checkCriterion(c, company, d, insider)) : p.criteria.map((c): CheckResult => ({ criterion: c, label: METRICS[c.metric].label, state: "unknown", actual: null, shown: "n/a", target: targetOf(c), evidence: null, headroom: null }));
  const known = checks.filter((c) => c.state !== "unknown");
  const failed = known.filter((c) => c.state === "fail");
  const near = known.filter((c) => c.state === "near");
  const verdict: Verdict = !company ? "unknown" : failed.length ? "broken" : near.length || !known.length ? "watch" : "intact";
  const score = known.length ? Math.round((known.reduce((s, c) => s + (c.state === "pass" ? 1 : c.state === "near" ? 0.5 : 0), 0) / known.length) * 100) : null;
  const day = 86_400_000;
  const catalysts = p.catalysts.map((c) => ({ ...c, inDays: Math.round((Date.parse(`${c.date}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / day) }))
    .filter((c) => c.inDays >= -7).sort((a, b) => a.inDays - b.inDays);
  const daysTo = (iso: string) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / day);
  const earnings = next?.date && /^\d{4}-\d{2}-\d{2}/.test(next.date) && daysTo(next.date) >= -1 && daysTo(next.date) <= 120 ? { date: next.date.slice(0, 10), estimated: next.estimated, inDays: daysTo(next.date) } : null;
  const soon = catalysts.find((c) => c.inDays >= 0 && c.inDays <= 14) ?? (earnings && earnings.inDays >= 0 && earnings.inDays <= 14 ? { label: "earnings", inDays: earnings.inDays } : undefined);
  const price = company?.price?.last ?? null;
  const pnl = price !== null && p.entry ? (price / p.entry - 1) * (p.direction === "short" ? -1 : 1) : null;
  const summary = !company ? `${p.ticker}: the company's filings could not be read just now.`
    : failed.length ? `Kill criterion hit: ${failed[0].label} is ${failed[0].shown}, needed ${failed[0].target}.`
    : near.length ? `Close to a kill criterion: ${near[0].label} is ${near[0].shown}, needs ${near[0].target}.`
    : !known.length ? (p.criteria.length ? "No criterion can be checked from the data yet." : "Add a kill criterion so YouBank can tell you when this thesis breaks.")
    : `All ${known.length} criteria hold${soon ? `; ${soon.label} ${soon.inDays === 0 ? "today" : `in ${soon.inDays} day${soon.inDays === 1 ? "" : "s"}`}` : ""}.`;
  return { positionId: p.id, ticker: p.ticker, name: company?.name ?? p.ticker, direction: p.direction, weight: p.weight, industry: (company?.industry || company?.sicLabel || "").trim() || "Unclassified", verdict, score, price, pnl, checks, catalysts, news: news.slice(0, 5), earnings, summary, checkedAt: now.toISOString() };
}

/** Most urgent first: broken, then watch, then unknown, then intact; lower score first within each. */
export function byUrgency(a: Evaluation, b: Evaluation): number {
  const rank: Record<Verdict, number> = { broken: 0, watch: 1, unknown: 2, intact: 3 };
  return rank[a.verdict] - rank[b.verdict] || (a.score ?? 101) - (b.score ?? 101) || a.ticker.localeCompare(b.ticker);
}

export type BookSummary = {
  positions: number; long: number; short: number; gross: number; net: number;
  verdicts: Record<Verdict, number>;
  /** Weight in positions whose thesis is broken or on watch, % of NAV. */
  atRiskWeight: number;
  /** Weighted P&L since entry, in % of NAV, over positions with a weight and an entry. */
  pnlContribution: number | null;
  /** Exposure by industry, % of NAV, largest gross first. */
  byIndustry: { industry: string; positions: number; long: number; short: number; gross: number; net: number }[];
};

/** The book at a glance: exposure from weights (shorts net against longs) and how much of it is at risk. */
export function summarize(evals: Evaluation[]): BookSummary {
  const verdicts: Record<Verdict, number> = { intact: 0, watch: 0, broken: 0, unknown: 0 };
  let long = 0, short = 0, atRisk = 0, contrib = 0, priced = 0;
  for (const e of evals) {
    verdicts[e.verdict]++;
    const w = e.weight ?? 0;
    if (e.direction === "long") long += w; else short += w;
    if (e.verdict === "broken" || e.verdict === "watch") atRisk += w;
    if (e.weight && e.pnl !== null) { contrib += e.weight * e.pnl; priced++; }
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  const ind = new Map<string, { positions: number; long: number; short: number }>();
  for (const e of evals) {
    const k = e.industry || "Unclassified";
    const v = ind.get(k) ?? { positions: 0, long: 0, short: 0 };
    v.positions++;
    if (e.direction === "long") v.long += e.weight ?? 0; else v.short += e.weight ?? 0;
    ind.set(k, v);
  }
  const byIndustry = [...ind.entries()].map(([industry, v]) => ({ industry, positions: v.positions, long: r(v.long), short: r(v.short), gross: r(v.long + v.short), net: r(v.long - v.short) }))
    .sort((a, b) => b.gross - a.gross || b.positions - a.positions || a.industry.localeCompare(b.industry));
  return { positions: evals.length, long: r(long), short: r(short), gross: r(long + short), net: r(long - short), verdicts, atRiskWeight: r(atRisk), pnlContribution: priced ? r(contrib) : null, byIndustry };
}

/** The red team's brief: argue the other side of this position's thesis, with sources, and name what would prove it wrong. */
export function redTeamPrompt(p: Position, ev: Evaluation | null): string {
  const lines = [
    `Act as a sceptical, well-informed ${p.direction === "long" ? "short seller" : "long-only bull"} reviewing a ${p.direction} position in ${p.ticker}.`,
    `The thesis: "${p.thesis}"`,
    p.pillars.length ? `Its pillars:\n${p.pillars.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "",
    p.criteria.length ? `Its kill criteria:\n${p.criteria.map((c) => `- ${METRICS[c.metric].label} ${targetOf(c)}`).join("\n")}` : "",
    ev ? `Where the criteria stand now: ${ev.checks.map((c) => `${c.label} ${c.shown} (${c.state})`).join("; ")}.` : "",
    "Using the tools (filings, XBRL series, comps, filing changes, news on the web), make the strongest evidence-based case AGAINST this thesis.",
    "Rules: cite every figure and claim with its source id; do not invent numbers; if the evidence for a point is thin, say so instead of overstating it.",
    "Structure: 1) The three strongest counter-arguments, each with evidence. 2) Which pillar is weakest and why. 3) What would have to happen in the next two quarters to prove the thesis wrong, as checkable signals. 4) One question the holder should be able to answer and probably cannot.",
    "Keep it under 450 words.",
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** Starting points for a new position: kill criteria a desk commonly writes for each style. */
export const TEMPLATES: { id: string; label: string; direction: Direction; thesis: string; criteria: Omit<Criterion, "id">[] }[] = [
  { id: "growth", label: "High-growth software", direction: "long", thesis: "Durable 20%+ growth with best-in-class gross margins.", criteria: [{ metric: "revenue_growth", op: ">=", value: 20 }, { metric: "gross_margin", op: ">=", value: 70 }, { metric: "rule_of_40", op: ">=", value: 40 }] },
  { id: "compounder", label: "Quality compounder", direction: "long", thesis: "Steady growth, high margins and cash conversion compound value.", criteria: [{ metric: "revenue_growth", op: ">=", value: 8 }, { metric: "operating_margin", op: ">=", value: 20 }, { metric: "fcf_margin", op: ">=", value: 15 }] },
  { id: "value", label: "Value / re-rating", direction: "long", thesis: "Cheap on sales with a clean balance sheet; the multiple re-rates as margins recover.", criteria: [{ metric: "ev_revenue", op: "<=", value: 2 }, { metric: "net_debt", op: "<=", value: 0 }, { metric: "operating_margin", op: ">=", value: 5 }] },
  { id: "short", label: "Deteriorating short", direction: "short", thesis: "Growth is stalling while the valuation still prices in a recovery.", criteria: [{ metric: "revenue_growth", op: "<=", value: 5 }, { metric: "operating_margin", op: "<=", value: 10 }, { metric: "ev_revenue", op: ">=", value: 4 }] },
];

/* ---------------- Getting a book in ---------------- */

export type ImportRow = { ticker: string; direction: Direction; weight: number | null; entry: number | null; thesis: string };
export type ImportResult = { rows: ImportRow[]; problems: string[] };

const HEADER_WORDS = /^(ticker|symbol|name|side|direction|long|short|weight|entry|price|cost|thesis|notes?)$/i;

/**
 * Positions from text pasted out of a spreadsheet, an OMS export or typed by hand: one per line, cells
 * split by tabs, commas or semicolons (quoted cells keep their commas). Cells are recognised by what they
 * hold, so column order is free: a ticker; "long"/"short" (or L/S, or a negative weight for a short); the
 * first number is the weight in % of NAV ("4.5" or "4.5%"), the second the entry price ("$150"); the
 * longest text is the thesis. A header row is skipped. Lines that have no ticker are reported, not guessed.
 */
export function parseImport(text: string, max = POSITIONS_MAX): ImportResult {
  const rows: ImportRow[] = [], problems: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const sep = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ",";
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    if (i === 0 && cells.filter(Boolean).every((c) => HEADER_WORDS.test(c.replace(/[^a-z ]/gi, "").trim().split(" ")[0] ?? ""))) continue;
    let ticker: string | null = null, direction: Direction | null = null, thesis = "";
    const nums: number[] = [];
    for (const c of cells) {
      if (!c) continue;
      if (/^(long|buy|l)$/i.test(c)) { direction = "long"; continue; }
      if (/^(short|sell|s)$/i.test(c)) { direction = "short"; continue; }
      const n = Number(c.replace(/[$%,\s]/g, ""));
      if (/^[-+]?\$?[\d,]*\.?\d+%?$/.test(c.replace(/\s/g, "")) && Number.isFinite(n)) { nums.push(n); continue; }
      if (!ticker && /^\$?[A-Za-z][A-Za-z0-9]{0,9}([.-][A-Za-z0-9]{1,3})?$/.test(c) && c.length <= 11) { const t = tickerOf(c); if (t) { ticker = t; continue; } }
      if (c.length > thesis.length) thesis = c;
    }
    if (!ticker) { problems.push(`Line ${i + 1}: no ticker found in “${line.slice(0, 60)}”.`); continue; }
    const w = nums[0] ?? null;
    if (w !== null && w < 0 && !direction) direction = "short";
    if (rows.some((r) => r.ticker === ticker)) { problems.push(`Line ${i + 1}: ${ticker} appears twice; kept the first.`); continue; }
    if (rows.length >= max) { problems.push(`Only ${max} positions fit; ${ticker} and later lines were left out.`); break; }
    rows.push({ ticker, direction: direction ?? "long", weight: w === null ? null : Math.abs(w) || null, entry: nums[1] && nums[1] > 0 ? nums[1] : null, thesis: thesis.slice(0, 280) });
  }
  return { rows, problems };
}

/** The template a new position starts from when it has no criteria of its own: growth for a long, the short template for a short. */
export const defaultTemplate = (d: Direction) => TEMPLATES.find((t) => t.id === (d === "short" ? "short" : "growth"))!;

/**
 * A sample book for trying the Book (and for demos): five well-known names with theses and kill criteria
 * written the way a desk would. Marked as a sample in each thesis so it is never mistaken for advice;
 * prices and weights are illustrative.
 */
export const SAMPLE_BOOK: Omit<Position, "id" | "createdAt" | "updatedAt">[] = [
  { ticker: "NVDA", direction: "long", weight: 6, entry: null, thesis: "Sample: data-centre demand keeps growth far above 30% while gross margin holds in the 70s.", pillars: ["Hyperscaler capex keeps rising", "Software and networking deepen the moat"], criteria: [{ id: "smpl-nvda-1", metric: "revenue_growth", op: ">=", value: 30 }, { id: "smpl-nvda-2", metric: "gross_margin", op: ">=", value: 70 }], catalysts: [] },
  { ticker: "CRWD", direction: "long", weight: 4, entry: null, thesis: "Sample: platform consolidation keeps growth above 20% with expanding free cash flow.", pillars: ["Module attach rates rise", "Vendor consolidation favours platforms"], criteria: [{ id: "smpl-crwd-1", metric: "revenue_growth", op: ">=", value: 20 }, { id: "smpl-crwd-2", metric: "fcf_margin", op: ">=", value: 20 }, { id: "smpl-crwd-3", metric: "gross_margin", op: ">=", value: 72 }], catalysts: [] },
  { ticker: "COST", direction: "long", weight: 5, entry: null, thesis: "Sample: membership economics compound steadily; the premium multiple is earned by consistency.", pillars: ["Renewal rates above 90%", "Traffic-led comps"], criteria: [{ id: "smpl-cost-1", metric: "revenue_growth", op: ">=", value: 5 }, { id: "smpl-cost-2", metric: "operating_margin", op: ">=", value: 3 }], catalysts: [] },
  { ticker: "SNOW", direction: "long", weight: 3, entry: null, thesis: "Sample: consumption growth re-accelerates as AI workloads land; margins must follow.", pillars: ["AI data workloads", "Net retention bottoms"], criteria: [{ id: "smpl-snow-1", metric: "revenue_growth", op: ">=", value: 20 }, { id: "smpl-snow-2", metric: "gross_margin", op: ">=", value: 70 }], catalysts: [] },
  { ticker: "INTC", direction: "short", weight: 3, entry: null, thesis: "Sample: foundry capex burns cash while revenue shrinks; the turnaround is priced before it shows.", pillars: ["Share loss in data centre", "Negative free cash flow"], criteria: [{ id: "smpl-intc-1", metric: "revenue_growth", op: "<=", value: 0 }, { id: "smpl-intc-2", metric: "fcf_margin", op: "<=", value: 0 }], catalysts: [] },
];

/* ---------------- Drafting a position from plain words ---------------- */

/** What the model is asked for (src/app/api/book/draft): every field is checked again by normalizePosition. */
export const DRAFT_SYSTEM = [
  "You turn an investor's own description of a position into a structured position with kill criteria: the numbers that would prove the thesis wrong.",
  `Kill criteria use only these metrics: ${METRIC_KEYS.map((m) => `${m} (${METRICS[m].label}, ${METRICS[m].unit === "pct" ? "a percentage, given as percent: 20 means 20%" : METRICS[m].unit === "usdmm" ? "US$ millions" : METRICS[m].unit === "usd" ? "US$ per share" : METRICS[m].unit === "x" ? "a multiple" : "points"})`).join("; ")}.`,
  "Each criterion is a metric, an operator (>= or <=) and a threshold: the line past which the thesis is wrong. For a long, growth and margin criteria are usually >=; for a short, usually <=.",
  "Use the person's own numbers. Where they state a condition without a number, choose a reasonable threshold and say so in the note (\"suggested: …\"). Never invent facts about the company; do not state current figures.",
  "The ticker is the US listing of the company they name. The thesis is one line in their words. Pillars are the reasons they give, short. Catalysts only when they name a dated event (YYYY-MM-DD).",
].join("\n");

/** A model's draft as a position the editor can show: cleaned, unknown metrics dropped, nothing saved. */
export function draftToPosition(raw: unknown, now = new Date().toISOString()): Position | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return normalizePosition({ ...r, id: undefined, weight: null, entry: null, createdAt: undefined, updatedAt: undefined, redTeam: undefined }, now);
}

/* ---------------- Export ---------------- */

/** The unit headroomOf measures in, for a spreadsheet column: points, % of the threshold, or the metric's own. */
export const headroomUnit = (c: Criterion) => (isPct(c.metric) || METRICS[c.metric].unit === "pts" ? "pts" : c.value === 0 ? (METRICS[c.metric].unit === "usdmm" ? "$M" : METRICS[c.metric].unit === "usd" ? "$" : "x") : "% of threshold");

/** The book as CSV rows: one per kill criterion (a position without criteria gets one row), most urgent first. */
export function bookRows(evals: Evaluation[], positions: Position[]): unknown[][] {
  const header = ["ticker", "name", "side", "weight_pct_nav", "entry", "price", "pnl_since_entry_pct", "verdict", "score", "thesis", "criterion", "now", "needs", "headroom", "headroom_unit", "state", "source", "period", "source_url", "next_earnings"];
  const rows: unknown[][] = [header];
  for (const e of evals) {
    const p = positions.find((x) => x.id === e.positionId);
    const base = [e.ticker, e.name, e.direction, e.weight ?? "", p?.entry ?? "", e.price ?? "", e.pnl === null ? "" : Math.round(e.pnl * 1000) / 10, e.verdict, e.score ?? "", p?.thesis ?? ""];
    const tail = [e.earnings?.date ?? ""];
    if (!e.checks.length) rows.push([...base, "", "", "", "", "", "", "", "", "", ...tail]);
    for (const c of e.checks) rows.push([...base, c.label, c.shown, c.target, c.headroom ? Math.round(c.headroom.value * 10) / 10 : "", c.headroom ? headroomUnit(c.criterion) : "", c.state, c.evidence?.source ?? "", c.evidence?.period ?? "", c.evidence?.url ?? "", ...tail]);
  }
  return rows;
}
