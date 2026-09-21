import { HOUR, edgarJson } from "./client";

/**
 * XBRL "company facts" parsing. Every reported value arrives as a (start, end, value) triple.
 * Income and cash-flow items are durations; 10-Qs report year-to-date, and often the quarter.
 * Balance-sheet items are instants. This module derives LTM, prior LTM, quarterly series, and
 * point-in-time balances, deduplicating restated values by keeping the latest filing.
 */

export type RawFact = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string; frame?: string };
export type Fact = RawFact & { days: number };
export type CompanyFacts = { cik: number; entityName: string; facts: Record<string, Record<string, { units: Record<string, RawFact[]> }>> };

export function factsUrl(cik: string) {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
}

export function getCompanyFacts(cik: string): Promise<CompanyFacts> {
  return edgarJson<CompanyFacts>(factsUrl(cik), `facts-${cik}.json`, 12 * HOUR);
}

const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F"]);

const toDate = (s: string) => new Date(s + "T00:00:00Z");
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
export const addDays = (s: string, n: number) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMonths = (s: string, n: number) => { const d = toDate(s); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const near = (a: string, b: string, tol: number) => Math.abs(daysBetween(a, b)) <= tol;

/**
 * Rows for the best candidate concept: the one with the most reported periods in the last three years
 * (companies switch tags over time; a concept with only stale rows must lose to one that is current).
 * Ties keep candidate order.
 */
export function pickConcept(cf: CompanyFacts, candidates: string[], unit = "USD", taxonomy = "us-gaap"): { concept: string; rows: Fact[] } | null {
  const cutoff = addMonths(new Date().toISOString().slice(0, 10), -36);
  let best: { concept: string; rows: Fact[]; score: number; latest: string } | null = null;
  for (const concept of candidates) {
    const units = cf.facts[taxonomy]?.[concept]?.units;
    const raw = units?.[unit] ?? (unit === "USD" ? undefined : units?.["shares"]);
    if (!raw?.length) continue;
    const rows = normalize(raw);
    if (!rows.length) continue;
    const latest = rows.reduce((m, r) => (r.end > m ? r.end : m), "");
    const score = rows.filter((r) => r.end >= cutoff).length;
    if (!best || score > best.score || (score === best.score && latest > best.latest)) best = { concept, rows, score, latest };
  }
  return best ? { concept: best.concept, rows: best.rows } : null;
}

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F"]);

/**
 * Trust score for a row, used to break ties on the same period. Filers sometimes tag a quarterly figure
 * with an annual context in a 10-Q (Comfort Systems tagged Q1 revenue as full-year 2025), which would
 * otherwise win on "latest filing" and poison every derivation built on it.
 */
function trust(r: RawFact, days: number): number {
  const annualPeriod = days >= 350 && days <= 380;
  const annualForm = ANNUAL_FORMS.has(r.form);
  const fy = (r.fp ?? "").toUpperCase() === "FY";
  if (annualPeriod) return annualForm ? (fy ? 3 : 2) : fy ? 1 : 0; // an annual duration reported in a 10-Q is suspect
  return annualForm ? 1 : 2; // quarterly and year-to-date figures belong in a 10-Q
}

/** Keep 10-K/10-Q rows; dedupe identical periods, preferring the form that should carry the period, then the latest filing. */
export function normalize(raw: RawFact[]): Fact[] {
  const byPeriod = new Map<string, { row: Fact; trust: number }>();
  for (const r of raw) {
    if (!FORMS.has(r.form)) continue;
    const days = r.start ? daysBetween(r.start, r.end) : 0;
    const key = `${r.start ?? ""}|${r.end}`;
    const t = trust(r, days);
    const prev = byPeriod.get(key);
    const better = !prev || t > prev.trust || (t === prev.trust && (r.filed > prev.row.filed || (r.filed === prev.row.filed && r.accn > prev.row.accn)));
    if (better) byPeriod.set(key, { row: { ...r, days }, trust: t });
  }
  return [...byPeriod.values()].map((x) => x.row).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.days - b.days));
}

/**
 * An annual row must be at least as large as any year-to-date row inside the same period, for concepts that
 * accumulate (revenue, cash flow). Filer tagging errors show up exactly here, so the caller can discard the row.
 */
function annualLooksWrong(rows: Fact[], fy: Fact): boolean {
  if (!fy.start || fy.val <= 0) return false;
  for (const r of rows) {
    if (!r.start || r.days < 150 || r.days >= fy.days - 20) continue;
    if (r.start >= fy.start && r.end <= addDays(fy.end, 3) && r.val > fy.val * 1.02) return true;
  }
  return false;
}

function findDuration(rows: Fact[], end: string, minDays: number, maxDays: number, tol: number): Fact | null {
  let best: Fact | null = null;
  for (const r of rows) {
    if (!r.start || r.days < minDays || r.days > maxDays || !near(r.end, end, tol)) continue;
    if (!best || Math.abs(daysBetween(r.end, end)) < Math.abs(daysBetween(best.end, end)) || r.filed > best.filed) best = r;
  }
  return best;
}

/** Longest duration row ending at `end` (the year-to-date row, or the annual row). */
function longestEndingAt(rows: Fact[], end: string, tol: number, maxDays = 380): Fact | null {
  let best: Fact | null = null;
  for (const r of rows) {
    if (!r.start || r.days < 60 || r.days > maxDays || !near(r.end, end, tol)) continue;
    if (!best || r.days > best.days) best = r;
  }
  return best;
}

export type Derivation = { value: number; method: string; parts: Fact[] };

/** Last-twelve-months value ending at `end`: FY, or FY + YTD - prior-year YTD, or four quarters. */
export function ltmAt(rows: Fact[], end: string): Derivation | null {
  const fy = findDuration(rows, end, 350, 380, 6);
  if (fy && !annualLooksWrong(rows, fy)) return { value: fy.val, method: "FY", parts: [fy] };
  const ytd = longestEndingAt(rows, end, 6, 349);
  if (ytd?.start) {
    const fyPrev = findDuration(rows, addDays(ytd.start, -1), 350, 380, 6);
    const priorYtd = findDuration(rows, addMonths(ytd.end, -12), ytd.days - 12, ytd.days + 12, 8);
    if (fyPrev && priorYtd && !annualLooksWrong(rows, fyPrev)) {
      return { value: fyPrev.val + ytd.val - priorYtd.val, method: "FY + YTD - prior YTD", parts: [fyPrev, ytd, priorYtd] };
    }
  }
  // Fall back to summing four quarters, which survives a mis-tagged annual context.
  const quarters: Fact[] = [];
  let cursor = end;
  for (let i = 0; i < 4; i++) {
    const q = findDuration(rows, cursor, 80, 100, 8);
    if (!q?.start) break;
    quarters.push(q);
    cursor = addDays(q.start, -1);
  }
  if (quarters.length === 4) return { value: quarters.reduce((a, q) => a + q.val, 0), method: "sum of four quarters", parts: quarters };
  return null;
}

/** Single-quarter value ending at `end`: a reported 3-month row, or YTD minus the previous YTD. */
export function quarterAt(rows: Fact[], end: string): number | null {
  const direct = findDuration(rows, end, 80, 100, 6);
  if (direct) return direct.val;
  const ytd = longestEndingAt(rows, end, 6);
  if (!ytd?.start) return null;
  if (ytd.days <= 100) return ytd.val;
  const prev = rows.find((r) => r.start && near(r.start, ytd.start!, 6) && Math.abs(r.days - (ytd.days - 91)) <= 14);
  return prev ? ytd.val - prev.val : null;
}

/** Latest period end among duration rows (the "as of" date for LTM). */
export function latestEnd(rows: Fact[]): string | null {
  let latest: string | null = null;
  for (const r of rows) if (r.start && r.days >= 60 && (!latest || r.end > latest)) latest = r.end;
  return latest;
}

/** Distinct quarter-end dates up to `end`, most recent last. */
export function quarterEnds(rows: Fact[], end: string, count: number): string[] {
  const ends = [...new Set(rows.filter((r) => r.start && r.days >= 60 && r.end <= end).map((r) => r.end))].sort();
  // Keep dates roughly one quarter apart, walking backwards from the latest.
  const out: string[] = [];
  for (let i = ends.length - 1; i >= 0 && out.length < count; i--) {
    if (out.length === 0 || Math.abs(daysBetween(ends[i], out[out.length - 1])) >= 75) out.push(ends[i]);
  }
  return out.reverse();
}

/** Balance-sheet value at or before `end`. */
export function instantAt(rows: Fact[], end: string): Fact | null {
  let best: Fact | null = null;
  for (const r of rows) {
    if (r.start || r.end > addDays(end, 6)) continue;
    if (!best || r.end > best.end || (r.end === best.end && r.filed > best.filed)) best = r;
  }
  return best;
}

/** Fiscal quarter label for a period end, given the fiscal year-end month (1-12). */
export function fiscalLabel(end: string, fyeMonth: number): string {
  const d = toDate(end);
  const m = d.getUTCMonth() + 1;
  const monthsToFye = (fyeMonth - m + 12) % 12;
  const q = 4 - monthsToFye / 3;
  const fy = d.getUTCFullYear() + (m > fyeMonth ? 1 : 0);
  return `Q${Math.round(q)} FY${String(fy).slice(2)}`;
}

/** Normalized USD duration/instant rows for one concept in any taxonomy (company extensions included). */
export function rowsFor(cf: CompanyFacts, taxonomy: string, concept: string, unit = "USD"): Fact[] {
  const raw = cf.facts[taxonomy]?.[concept]?.units?.[unit];
  return raw?.length ? normalize(raw) : [];
}

/** Concepts across company-specific taxonomies (not us-gaap/dei/ifrs-full/srt) whose names match a pattern. */
export function extensionConcepts(cf: CompanyFacts, include: RegExp, exclude?: RegExp): { taxonomy: string; concept: string }[] {
  const out: { taxonomy: string; concept: string }[] = [];
  for (const [taxonomy, concepts] of Object.entries(cf.facts)) {
    if (["us-gaap", "dei", "ifrs-full", "srt", "invest"].includes(taxonomy)) continue;
    for (const concept of Object.keys(concepts)) if (include.test(concept) && !(exclude && exclude.test(concept))) out.push({ taxonomy, concept });
  }
  return out;
}

/** Score a row set by how many periods it reports in the last three years. */
export function recentCoverage(rows: Fact[]): number {
  const cutoff = addMonths(new Date().toISOString().slice(0, 10), -36);
  return rows.filter((r) => r.end >= cutoff).length;
}
