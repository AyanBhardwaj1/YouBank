/**
 * QF3: fundamentals as known on a date. For each company and concept, every reported value with when it became
 * public (knownAt), so `asOf(rows, at)` returns the latest value whose knownAt <= at and never a later
 * restatement of the same period.
 *
 * Source: SEC company facts (edgar/facts.ts), public domain. They carry each value's filing date (`filed`),
 * not EDGAR's acceptance time, so knownAt is conservative: the next session's open after the filing date, plus
 * one more session for 10-K and 10-Q figures (the spec's "acceptance plus one trading day"). The SEC Financial
 * Statement Data Sets, whose sub.txt carries the acceptance time, would tighten this; they are bulk files the
 * backfill can add (scripts/quant-backfill.ts), not used in the beta.
 */
import type { CompanyFacts, RawFact } from "@/lib/edgar/facts";
import { addSessions, nextSession, sessionOpen } from "./calendar";

export type PitFact = { end: string; start?: string; val: number; filed: string; form: string; accn: string; knownAt: string; days: number | null };

/** knownAt for a fact filed on `filed` by `form`. */
export function factKnownAt(filed: string, form: string): string {
  const periodic = /^10-[KQ]/.test(form) || /^20-F|^40-F/.test(form);
  return sessionOpen(addSessions(nextSession(filed, false), periodic ? 1 : 0));
}

const dayCount = (start?: string, end?: string) => (start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : null);

/** Every fact of one concept and unit, with knownAt, oldest filing first. Pure. */
export function pitFacts(cf: CompanyFacts, concept: string, unit = "USD", taxonomy = "us-gaap"): PitFact[] {
  const raw: RawFact[] = cf.facts?.[taxonomy]?.[concept]?.units?.[unit] ?? [];
  return raw.filter((r) => Number.isFinite(r.val) && r.filed && r.end)
    .map((r) => ({ end: r.end, start: r.start, val: r.val, filed: r.filed, form: r.form, accn: r.accn, knownAt: factKnownAt(r.filed, r.form), days: dayCount(r.start, r.end) }))
    .sort((a, b) => (a.filed === b.filed ? a.end.localeCompare(b.end) : a.filed.localeCompare(b.filed)));
}

/**
 * The value known at `at`: among facts with knownAt <= at (optionally of a duration near `days`, e.g. 365 for
 * annual flows, 90 for quarters, null for instants), the one for the latest period end, as first known by then
 * (a later restatement of that period is ignored until it is known). Pure.
 */
export function asOf(facts: PitFact[], at: string, opts: { days?: number | null; tolerance?: number } = {}): PitFact | null {
  const tol = opts.tolerance ?? 25;
  const wanted = (f: PitFact) => opts.days === undefined || (opts.days === null ? f.days === null || f.days <= 1 : f.days !== null && Math.abs(f.days - opts.days) <= tol);
  let best: PitFact | null = null;
  for (const f of facts) {
    if (f.knownAt > at || !wanted(f)) continue;
    if (!best || f.end > best.end || (f.end === best.end && f.knownAt > best.knownAt)) best = f;
  }
  return best;
}

/** Trailing twelve months of a flow concept as known at `at`: the latest annual figure, or four quarters. Pure. */
export function ttmAsOf(facts: PitFact[], at: string): { value: number; end: string; knownAt: string } | null {
  const annual = asOf(facts, at, { days: 365 });
  const qs = facts.filter((f) => f.knownAt <= at && f.days !== null && Math.abs(f.days - 91) <= 20);
  // Four distinct quarter ends, the latest version of each known by `at`.
  const byEnd = new Map<string, PitFact>();
  for (const f of qs) { const cur = byEnd.get(f.end); if (!cur || f.knownAt > cur.knownAt) byEnd.set(f.end, f); }
  const ends = [...byEnd.keys()].sort().slice(-4);
  const four = ends.length === 4 && Date.parse(ends[3]) - Date.parse(ends[0]) < 300 * 86_400_000 ? ends.map((e) => byEnd.get(e)!) : null;
  if (four && (!annual || four[3].end > annual.end)) return { value: four.reduce((s, f) => s + f.val, 0), end: four[3].end, knownAt: four.map((f) => f.knownAt).sort().at(-1)! };
  return annual ? { value: annual.val, end: annual.end, knownAt: annual.knownAt } : null;
}

/** The concepts the factor engine reads, with fallbacks in order. */
export const CONCEPTS = {
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  assets: ["Assets"],
  grossProfit: ["GrossProfit"],
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  netIncome: ["NetIncomeLoss"],
} as const;

/** The first concept with facts, for a list of fallbacks. Pure. */
export function firstFacts(cf: CompanyFacts, names: readonly string[], unit = "USD"): PitFact[] {
  for (const n of names) { const f = pitFacts(cf, n, unit); if (f.length) return f; }
  return [];
}

/** Shares outstanding from the cover page (dei), with its own knownAt, for point-in-time market value. */
export const sharesFacts = (cf: CompanyFacts) => pitFacts(cf, "EntityCommonStockSharesOutstanding", "shares", "dei");
