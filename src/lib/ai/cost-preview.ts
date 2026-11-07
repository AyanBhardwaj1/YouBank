/**
 * What a run usually costs, said before it starts (research item D5): the median of recent runs of the
 * same kind, against the person's monthly AI allowance. Pure, tested in scripts/test-cost-preview.ts.
 */
export type Estimate = { typicalUsd: number | null; runs: number; monthlyUsd: number | null; monthUsd: number; leftUsd: number };

/** The median of positive costs, or null with fewer than `min` runs to go on. */
export function typicalCost(costs: number[], min = 5): number | null {
  const xs = costs.filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => a - b);
  if (xs.length < min) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

const share = (x: number) => (x < 0.01 ? "under 1%" : `about ${Math.round(x * 100)}%`);

/**
 * One line for a person about to start a run, or null when there is nothing honest to say (no history
 * yet). `leftUsd` is bought credit still unused, on top of what is left of the monthly allowance.
 */
export function costLine(e: Estimate, what = "A run like this"): string | null {
  if (e.typicalUsd === null) return null;
  if (e.monthlyUsd === null || e.monthlyUsd <= 0) return `${what} usually costs about $${e.typicalUsd < 0.1 ? e.typicalUsd.toFixed(3) : e.typicalUsd.toFixed(2)} in AI.`;
  // No count of runs that "fit": the daily cap and the model chosen change that, and this figure knows neither.
  const left = Math.max(0, e.monthlyUsd - e.monthUsd) + Math.max(0, e.leftUsd);
  const tail = left < e.typicalUsd ? ", and less than that is left this month" : "";
  return `${what} typically uses ${share(e.typicalUsd / e.monthlyUsd)} of your monthly AI allowance (recent runs, all models)${tail}.`;
}
