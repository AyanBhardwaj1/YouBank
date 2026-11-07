/**
 * The go/no-go check before autopilot certification is made to gate sends (sleep-research/EXPERIMENT_PLAN.md,
 * B3-0): do people give the engine enough labels, often enough, for a stratum (a person's kind of email) to
 * earn a certificate within 30 days at a stated error bound?
 *
 * Pre-registered, before looking at any data:
 * - α = 10%: the bad-send rate a certificate promises not to exceed (today's engine uses 10%).
 * - δ = 5%: the chance of certifying a stratum whose true bad rate is above α.
 * - A label is a reviewed draft: sent unchanged, or edited by at most 5% of its text, is good; edited more,
 *   or rewritten, is bad. A discarded draft is not a label.
 * - The test is an exact one-sided binomial at one look; an anytime-valid test needs more labels, so the
 *   counts here are lower bounds.
 * - Go when the median active stratum would reach its n within 30 days at its own weekly rate and with an
 *   observed bad rate below α, and at least 5 people have such a stratum.
 * Pure.
 */
export const ALPHA = 0.1;
export const DELTA = 0.05;
export const EDIT_BAD = 0.05;
export const HORIZON_DAYS = 30;
export const MIN_PEOPLE = 5;

export type LabelEvent = { userId: string; bucket: string; outcome: string; editRatio: number | null; at: Date };

/** Good, bad or not a label. */
export function labelOf(e: Pick<LabelEvent, "outcome" | "editRatio">): "good" | "bad" | null {
  if (e.outcome === "unchanged") return "good";
  if (e.outcome === "edited") return (e.editRatio ?? 1) <= EDIT_BAD ? "good" : "bad";
  if (e.outcome === "rewritten") return "bad";
  return null; // discarded, or not a trust event
}

function binomCdf(k: number, n: number, p: number): number {
  // Summed in log space so large n stays finite.
  let logC = 0, total = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    total += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log1p(-p));
  }
  return total;
}

/**
 * Labels a stratum needs before an exact one-sided binomial test can certify "bad rate below α" at level δ,
 * when it really runs at `badRate` (the bad count rounded up). Null when it never can (badRate ≥ α).
 */
export function labelsNeeded(badRate: number, alpha = ALPHA, delta = DELTA, cap = 5000): number | null {
  if (badRate >= alpha) return null;
  for (let n = 1; n <= cap; n++) {
    if (binomCdf(Math.ceil(badRate * n - 1e-9), n, alpha) <= delta) return n;
  }
  return null;
}

export type Stratum = { userId: string; bucket: string; good: number; bad: number; discarded: number; perWeek: number; badRate: number; needed: number | null; daysToCertify: number | null; reachable: boolean };

/** Strata from trust events in a window of `weeks` ending at `now`. */
export function strata(events: LabelEvent[], now: Date, weeks = 8): Stratum[] {
  const since = now.getTime() - weeks * 7 * 86_400_000;
  const by = new Map<string, { userId: string; bucket: string; good: number; bad: number; discarded: number }>();
  for (const e of events) {
    if (e.at.getTime() < since || e.at.getTime() > now.getTime()) continue;
    const k = `${e.userId}\u0000${e.bucket}`;
    const s = by.get(k) ?? { userId: e.userId, bucket: e.bucket, good: 0, bad: 0, discarded: 0 };
    const l = labelOf(e);
    if (l === "good") s.good++; else if (l === "bad") s.bad++; else if (e.outcome === "discarded") s.discarded++;
    by.set(k, s);
  }
  return [...by.values()].filter((s) => s.good + s.bad > 0).map((s) => {
    const labels = s.good + s.bad;
    const perWeek = labels / weeks;
    const badRate = s.bad / labels;
    const needed = labelsNeeded(badRate);
    const daysToCertify = needed === null ? null : Math.max(0, Math.ceil(((needed - labels) / perWeek) * 7));
    return { ...s, perWeek, badRate, needed, daysToCertify, reachable: daysToCertify !== null && daysToCertify <= HORIZON_DAYS };
  });
}

/** The go/no-go verdict, with the numbers behind it. */
export function verdict(rows: Stratum[]): { go: boolean; activeStrata: number; reachableStrata: number; medianReachable: boolean; peopleReachable: number; reasons: string[] } {
  const sorted = [...rows].sort((a, b) => (a.daysToCertify ?? Infinity) - (b.daysToCertify ?? Infinity));
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const medianReachable = !!median?.reachable;
  const peopleReachable = new Set(rows.filter((r) => r.reachable).map((r) => r.userId)).size;
  const reasons: string[] = [];
  if (!rows.length) reasons.push("No reviewed drafts in the window");
  if (rows.length && !medianReachable) reasons.push(`The median active stratum would not certify within ${HORIZON_DAYS} days`);
  if (peopleReachable < MIN_PEOPLE) reasons.push(`Only ${peopleReachable} ${peopleReachable === 1 ? "person has" : "people have"} a stratum that would certify within ${HORIZON_DAYS} days (need ${MIN_PEOPLE})`);
  return { go: reasons.length === 0, activeStrata: rows.length, reachableStrata: rows.filter((r) => r.reachable).length, medianReachable, peopleReachable, reasons };
}
