/**
 * Kill criteria that cannot fail. A thesis is only falsifiable if its kill criteria could plausibly fire: "revenue
 * growth at least -50%" with growth at 25% has 75 points of room and tests nothing. From each check's headroom:
 * more than 25 points for a growth or margin, more than 30 for the rule of 40, or more than double the line for a
 * level (revenue, net debt, a multiple). Price lines and stops are left to the price base rate (./baserate.ts),
 * and a winning position's stop is meant to be far away. Pure; tested in scripts/test-book.ts.
 */
import { METRICS, type CheckResult } from "./position";

export function toothless(checks: CheckResult[]): { label: string; room: string }[] {
  return checks.flatMap((c) => {
    const m = c.criterion.metric;
    if (!c.headroom || c.state !== "pass" || m === "price" || m === "return_since_entry" || m === "insider_selling") return [];
    const unit = METRICS[m].unit;
    const limit = unit === "pct" ? 25 : m === "rule_of_40" ? 30 : 100;
    return c.headroom.value > limit ? [{ label: c.label, room: c.headroom.shown }] : [];
  });
}
