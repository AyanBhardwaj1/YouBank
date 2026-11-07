/**
 * Kill criteria that cannot fail. A thesis is only falsifiable if its kill criteria could plausibly fire: "revenue
 * growth at least -50%" with growth at 25% has 75 points of room and tests nothing. From each check's headroom:
 * more than 25 points for a growth or margin, more than 30 for the rule of 40, or a level (revenue, a multiple) more
 * than double an "at least" line or under half an "at most" one. Net debt and lines at zero are left alone. Price lines and stops are left to the price base rate (./baserate.ts),
 * and a winning position's stop is meant to be far away. Pure; tested in scripts/test-book.ts.
 */
import { METRICS, type CheckResult } from "./position";

export function toothless(checks: CheckResult[]): { label: string; room: string }[] {
  return checks.flatMap((c) => {
    const m = c.criterion.metric;
    if (!c.headroom || c.state !== "pass" || m === "price" || m === "return_since_entry" || m === "insider_selling") return [];
    const unit = METRICS[m].unit;
    if (unit === "pct") return c.headroom.value > 25 ? [{ label: c.label, room: c.headroom.shown }] : [];
    if (m === "rule_of_40") return c.headroom.value > 30 ? [{ label: c.label, room: c.headroom.shown }] : [];
    // A level (revenue, a multiple): more than double the line ("at least") or under half of it ("at most").
    // Net debt and lines at or below zero have no scale to judge by, so they are left alone.
    const line = c.criterion.value, actual = c.actual;
    if (m === "net_debt" || !(line > 0) || actual === null) return [];
    const loose = c.criterion.op === ">=" ? actual > 2 * line : actual < line / 2;
    return loose ? [{ label: c.label, room: c.headroom.shown }] : [];
  });
}

/** Kill criteria about the market's view rather than the business (the price, valuation, insiders). */
const MARKET_METRICS = new Set(["price", "return_since_entry", "ev_revenue", "pe", "insider_selling"]);

/**
 * What would make the thesis testable but is missing: a kill criterion on the business (revenue, margins, cash
 * flow, debt) rather than only on the price, and a dated catalyst ahead (when should the market see it?).
 * A thesis is a claim about a business; a book of stops is a claim about nothing. Pure.
 */
export function thesisGaps(p: { criteria: { metric: string }[]; catalysts: { date: string }[] }, now = new Date(), /** The next earnings date, when known: it is a dated catalyst too. */ nextEarnings?: string | null): string[] {
  const out: string[] = [];
  if (!p.criteria.length) out.push("No kill criterion: nothing would show the thesis is wrong.");
  else if (p.criteria.every((c) => MARKET_METRICS.has(c.metric))) out.push("Only market lines (price, valuation, insiders): nothing checks the business the thesis is about. Add one on revenue, margins or cash flow.");
  const today = now.toISOString().slice(0, 10);
  if (!p.catalysts.some((c) => c.date >= today) && !(nextEarnings && nextEarnings >= today)) out.push("No dated catalyst ahead: when should the market see the thesis play out?");
  return out;
}
