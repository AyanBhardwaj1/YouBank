/**
 * Call Desk's (E5) commitments ledger, the pure part: quantified forward statements read from earnings
 * releases and calls (guidance ranges for revenue, EPS, EBITDA, capital spending and production), each turned
 * into a machine-checkable question for the forecast ledger (F3, kind `guidance`): the stated range is the
 * "forecast", and the rule names the XBRL concept, the fiscal period's end and the comparison. Reading is
 * deterministic (no model): a sentence needs a forward cue, a metric and numbers, and the value is re-parsed
 * from the sentence itself, which is kept as the verbatim quote. Concepts are mapped by rule (revenue to
 * Revenues or RevenueFromContractWithCustomer..., the filer's own concept chosen at logging time); EBITDA is
 * derived as operating income plus depreciation and amortisation; production has no standard XBRL concept, so
 * it is listed as unmapped and never guessed. "Mid-single-digit growth" has no number and is unmapped too.
 *
 * Pure, tested in scripts/test-edge-next.ts.
 */
import type { ForecastRule } from "@/db/schema";

export type Metric = "revenue" | "eps" | "ebitda" | "capex" | "production";
export type Unit = "usd" | "usd_per_share" | "pct_growth" | "per_day";
export type Period = { fy: number; q?: number };
export type Commitment = {
  metric: Metric; label: string; low: number | null; high: number | null; unit: Unit; op: "between" | ">=" | "<="; period: Period | null;
  quote: string; mapped: boolean; why: string;
};

export const METRIC_LABEL: Record<Metric, string> = { revenue: "Revenue", eps: "Diluted EPS", ebitda: "EBITDA", capex: "Capital spending", production: "Production" };

const FORWARD = /\b(expect|expects|expected|expecting|guidance|guide|guiding|outlook|anticipate|anticipates|project|projects|projected|forecast|target|targets|reaffirm|reaffirms|reaffirmed|raise|raises|raised|lower|lowers|lowered|narrow|narrows|now see|now sees|range of|plan to|plans to|on track)\b/i;
const METRICS: [Metric, RegExp][] = [
  ["eps", /\b(?:(?:adjusted |diluted |GAAP )*EPS|(?:diluted |adjusted )?earnings per (?:diluted )?share)\b/i],
  ["ebitda", /\b(?:adjusted )?EBITDA\b/i],
  ["capex", /\b(?:capital expenditures|capex|capital spending|capital budget|capital program)\b/i],
  ["production", /\b(?:production|volumes?)\b(?=[^.]{0,120}?(?:boe\/?d|bbl\/?d|mcfe?\/?d|bcfe?\/?d|barrels|per day))/i],
  ["revenue", /\b(?:total |net )?(?:revenues?|net sales|sales)\b/i],
];

const SCALE: Record<string, number> = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
const n = (s: string) => Number(s.replace(/,/g, ""));
const scaleOf = (s: string | undefined) => (s ? SCALE[s.toLowerCase()] ?? 1 : 1);

/** Sentences of a release or transcript: split after a full stop, question or exclamation mark followed by a capital (decimals stay whole). Pure. */
export function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 700);
}

/** The fiscal period a sentence speaks of, given when it was said. Pure. */
export function periodOf(s: string, said: string): Period | null {
  const year = Number(said.slice(0, 4));
  const yy = (v: string) => (v.length === 2 ? 2000 + Number(v) : Number(v));
  const q = /\b(?:(first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter|q([1-4]))(?:\s+(?:of\s+)?(?:fiscal\s+(?:year\s+)?)?'?((?:20)?\d{2}))?\b/i.exec(s);
  const fy = /\b(?:full[- ]year|fiscal(?:[- ]year)?|fy)\s*'?((?:20)?\d{2})\b|\b((?:20)\d{2})\s+(?:full[- ]year|guidance|outlook|targets?)\b|\bfor (?:the (?:full |fiscal )?year )?((?:20)\d{2})\b/i.exec(s);
  if (q && !/full[- ]year/i.test(s.slice(0, q.index))) {
    const word = (q[1] ?? q[2]).toLowerCase();
    const qn = ({ first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 } as Record<string, number>)[word] ?? Number(word);
    const y = q[3] ? yy(q[3]) : fy ? yy(fy[1] ?? fy[2] ?? fy[3]) : year;
    return { fy: y, q: qn };
  }
  if (fy) return { fy: yy(fy[1] ?? fy[2] ?? fy[3]) };
  if (/\bnext (?:fiscal )?year\b/i.test(s)) return { fy: year + 1 };
  if (/\b(?:this|the|full|current) (?:fiscal )?year\b|\bfull[- ]year\b|\bannual\b/i.test(s)) return { fy: year };
  return null;
}

/** The comparison words put on a value. Pure. */
function opOf(s: string): Commitment["op"] {
  if (/\b(?:at least|no less than|in excess of|more than|exceed|above|minimum of)\b/i.test(s)) return ">=";
  if (/\b(?:up to|no more than|not to exceed|less than|below|at most|maximum of|cap(?:ped)? at)\b/i.test(s)) return "<=";
  return "between";
}

/** The tolerance a single "approximately" figure is read with: plus or minus 2%. */
export const POINT_TOLERANCE = 0.02;

/** The values after the metric's mention: a range, a percentage-growth range, a production rate, or one figure. Pure. */
export function valuesOf(s: string, metric: Metric): { low: number; high: number; unit: Unit; point: boolean } | null {
  const range = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|mn|[bmk])?\s*(?:to|-|–|—|and)\s*\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|mn|[bmk])?\b/i.exec(s);
  if (metric === "production") {
    const p = /(\d[\d,]*(?:\.\d+)?)\s*(?:(?:to|-|–|—|and)\s*(\d[\d,]*(?:\.\d+)?)\s*)?(thousand |million )?(m{1,2}boe\/?d|mboe\/?d|boe\/?d|mbbl\/?d|bbl\/?d|mmcfe?\/?d|bcfe?\/?d|barrels(?: of oil equivalent)? per day)/i.exec(s);
    if (!p) return null;
    const unitWord = p[4].toLowerCase();
    const mult = (p[3] ? scaleOf(p[3].trim()) : 1) * (/^mm/.test(unitWord) ? 1e6 : /^m(?!m)/.test(unitWord) ? 1e3 : /^b(?:cf)/.test(unitWord) ? 1e9 : 1);
    const lo = n(p[1]) * mult, hi = n(p[2] ?? p[1]) * mult;
    return { low: Math.min(lo, hi), high: Math.max(lo, hi), unit: "per_day", point: !p[2] };
  }
  if (range) {
    const s2 = range[4] ?? range[2];
    const s1 = range[2] ?? range[4];
    let lo = n(range[1]) * scaleOf(s1), hi = n(range[3]) * scaleOf(s2);
    if (metric === "eps") { lo = n(range[1]); hi = n(range[3]); }
    if (!(lo > 0 && hi > 0)) return null;
    return { low: Math.min(lo, hi), high: Math.max(lo, hi), unit: metric === "eps" ? "usd_per_share" : "usd", point: false };
  }
  const growth = /(?:growth|grow|increase|up)\s+(?:of\s+)?(?:approximately |about |around |roughly )?(-?\d+(?:\.\d+)?)\s*%?\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)\s*%/i.exec(s) ?? /(-?\d+(?:\.\d+)?)\s*%?\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)\s*%\s*(?:growth|increase)/i.exec(s);
  if (growth) { const a = Number(growth[1]) / 100, b = Number(growth[2]) / 100; return { low: Math.min(a, b), high: Math.max(a, b), unit: "pct_growth", point: false }; }
  const one = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|mn|[bmk])?\b/i.exec(s);
  if (one) {
    const v = metric === "eps" ? n(one[1]) : n(one[1]) * scaleOf(one[2]);
    if (!(v > 0)) return null;
    // A dollar figure under $1,000 for a company's revenue or capex is a per-share or partial figure: not trusted.
    if (metric !== "eps" && v < 1e5) return null;
    return { low: v, high: v, unit: metric === "eps" ? "usd_per_share" : "usd", point: true };
  }
  return null;
}

/** Every quantified commitment in a text said or filed on `said` (YYYY-MM-DD). Pure. */
export function extractCommitments(text: string, said: string): Commitment[] {
  const out: Commitment[] = [];
  for (const s of sentencesOf(text)) {
    if (!FORWARD.test(s)) continue;
    if (/\b(?:compared (?:to|with)|versus|vs\.?|last year|prior year|a year ago) (?:was|were|of)\b/i.test(s) && !/\bguidance|outlook|expect/i.test(s)) continue;
    // Every metric the sentence names, each read from its own stretch (up to the next metric named).
    const hits = METRICS.flatMap(([m, re]) => { const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`); return [...s.matchAll(g)].slice(0, 1).map((x) => ({ m, at: x.index ?? 0 })); }).sort((a, b) => a.at - b.at);
    const period = periodOf(s, said);
    const quote = s.slice(0, 400);
    hits.forEach((hit, i) => {
      const tail = s.slice(hit.at, hits[i + 1]?.at ?? s.length);
      const v = valuesOf(tail, hit.m);
      if (!v) {
        if (/\b(?:low|mid|high)[- ]single[- ]digit|double[- ]digit|\bflat\b|modest/i.test(i === 0 ? s.slice(0, hits[1]?.at ?? s.length) : tail)) out.push({ metric: hit.m, label: METRIC_LABEL[hit.m], low: null, high: null, unit: "pct_growth", op: "between", period, quote, mapped: false, why: "no number stated (a qualitative range such as mid-single-digit growth)" });
        return;
      }
      const op = v.point ? opOf(tail) : "between";
      const tol = v.point && op === "between" ? POINT_TOLERANCE : 0;
      const c: Commitment = {
        metric: hit.m, label: METRIC_LABEL[hit.m], low: op === "<=" ? null : v.low * (1 - tol), high: op === ">=" ? null : v.high * (1 + tol), unit: v.unit, op, period, quote,
        mapped: hit.m !== "production" && !!period, why: hit.m === "production" ? "production has no standard XBRL concept; listed, not scored" : !period ? "the period is not stated" : v.unit === "pct_growth" ? "a growth range: scored against the prior period's reported value" : "mapped to XBRL",
      };
      if (!out.some((x) => x.metric === c.metric && x.low === c.low && x.high === c.high && x.period?.fy === c.period?.fy && x.period?.q === c.period?.q)) out.push(c);
    });
  }
  return out.slice(0, 40);
}

/** The XBRL concepts tried for a metric, in order, and their unit; EBITDA is derived. Pure. */
export const CONCEPTS: Record<Exclude<Metric, "production">, { concepts: string[]; unit: string }> = {
  revenue: { concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"], unit: "USD" },
  eps: { concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"], unit: "USD/shares" },
  ebitda: { concepts: ["derived:ebitda"], unit: "USD" },
  capex: { concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOilAndGasPropertyAndEquipment"], unit: "USD" },
};

/** The fiscal period's end date from the company's fiscal year end (MMDD, as SEC submissions give it). Pure. */
export function periodEnd(p: Period, fye = "1231"): string {
  const mm = Number(fye.slice(0, 2)) || 12, dd = Number(fye.slice(2, 4)) || 31;
  const months = p.q ? (p.q - 4) * 3 : 0;
  const end = new Date(Date.UTC(p.fy, mm - 1 + months + 1, 0));
  // Keep the fiscal year's day when it is not the month's last (a 52/53-week year still lands within a week).
  if (!p.q && dd < end.getUTCDate()) end.setUTCDate(dd);
  return end.toISOString().slice(0, 10);
}

/** The window a reported period's length must fall in: a year or a quarter. Pure. */
export const daysWindow = (p: Period): [number, number] => (p.q ? [80, 100] : [350, 380]);

/** The ledger rule for a mapped commitment (values already absolute, in the concept's unit). Pure. */
export function guidanceRule(c: Commitment & { low: number | null; high: number | null }, cik: string, concept: string, unit: string, fye: string): Extract<ForecastRule, { type: "xbrl" }> | null {
  if (!c.mapped || !c.period) return null;
  const period = periodEnd(c.period, fye);
  const base = { type: "xbrl" as const, cik, concept, period, unit, days: daysWindow(c.period), endWithinDays: 10 };
  if (c.op === ">=" && c.low !== null) return { ...base, op: ">=", value: c.low };
  if (c.op === "<=" && c.high !== null) return { ...base, op: "<=", value: c.high };
  if (c.low !== null && c.high !== null) return { ...base, op: "between", value: c.low, high: c.high };
  return null;
}

/** How a resolved commitment turned out against the reported value, and how far outside the range. Pure. */
export function outcomeOf(rule: Pick<Extract<ForecastRule, { type: "xbrl" }>, "op" | "value" | "high">, reported: number): { status: "hit" | "missed_low" | "missed_high"; missPct: number } {
  const lo = rule.op === "<=" ? -Infinity : rule.value, hi = rule.op === ">=" ? Infinity : rule.op === "<=" ? rule.value : rule.high ?? rule.value;
  if (reported < lo) return { status: "missed_low", missPct: Math.abs(lo) > 0 ? (lo - reported) / Math.abs(lo) : 0 };
  if (reported > hi) return { status: "missed_high", missPct: Math.abs(hi) > 0 ? (reported - hi) / Math.abs(hi) : 0 };
  return { status: "hit", missPct: 0 };
}

/** The probability a company hits a stated range, from its own resolved record and a Beta(6, 4) prior (60%). Pure. */
export function hitProbability(hits: number, misses: number, prior = { a: 6, b: 4 }): { p: number; low: number; high: number; base: number } {
  const a = prior.a + hits, b = prior.b + misses;
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  const p = a / (a + b);
  return { p, low: Math.max(0, p - 1.2816 * sd), high: Math.min(1, p + 1.2816 * sd), base: prior.a / (prior.a + prior.b) };
}

/** The ledger question in words: "Acme (ACME) reports FY2026 revenue between $4.2bn and $4.4bn". Pure. */
export function guidanceQuestion(name: string, ticker: string, c: Commitment): string {
  const per = c.period ? (c.period.q ? `Q${c.period.q} FY${c.period.fy}` : `FY${c.period.fy}`) : "the period";
  const fmt = (v: number | null) => (v === null ? "" : c.unit === "usd_per_share" ? `$${v.toFixed(2)}` : c.unit === "pct_growth" ? `${(v * 100).toFixed(1)}%` : c.unit === "per_day" ? `${Math.round(v).toLocaleString("en-US")}/d` : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}bn` : `$${(v / 1e6).toFixed(0)}m`);
  const range = c.op === ">=" ? `at least ${fmt(c.low)}` : c.op === "<=" ? `at most ${fmt(c.high)}` : `between ${fmt(c.low)} and ${fmt(c.high)}`;
  return `${name}${ticker ? ` (${ticker})` : ""} reports ${per} ${c.label.toLowerCase()}${c.unit === "pct_growth" ? " growth" : ""} ${range}`;
}

/** Whether a text withdraws guidance ("withdrawing its full-year guidance"). Pure. */
export const withdrawsGuidance = (text: string) => /\b(?:withdraw(?:s|n|ing)?|suspend(?:s|ed|ing)?|no longer (?:provid|expect)\w*)\b[^.]{0,60}\b(?:guidance|outlook)\b/i.test(text);
