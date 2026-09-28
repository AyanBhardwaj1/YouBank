/**
 * Survival analysis for waiting times that are often never observed: how long until someone replies,
 * when many never do. The Kaplan-Meier estimator uses every email, including those still waiting
 * (censored), and its plateau is the share that never replies. From it: the chance of a reply in the
 * next few days given none so far, which says when a nudge is due. Also the Poisson-binomial
 * distribution, for "how many of these deals close" when each has its own probability.
 */

export type KmPoint = { t: number; s: number; atRisk: number; events: number };

/**
 * Kaplan-Meier: S(t) = product over event times t_i <= t of (1 - d_i / n_i). `times` are durations,
 * `events` true where the event happened (false: still waiting when observed). Greenwood's variance
 * gives a standard error at each step.
 */
export function kaplanMeier(times: number[], events: boolean[]): (KmPoint & { se: number })[] {
  const rows = times.map((t, i) => ({ t, e: events[i] })).filter((r) => Number.isFinite(r.t) && r.t >= 0).sort((a, b) => a.t - b.t);
  const out: (KmPoint & { se: number })[] = [];
  let s = 1, green = 0, i = 0;
  const n = rows.length;
  while (i < n) {
    const t = rows[i].t;
    let d = 0, c = 0;
    while (i < n && rows[i].t === t) { if (rows[i].e) d++; else c++; i++; }
    const atRisk = n - (i - d - c);
    if (d > 0) {
      s *= 1 - d / atRisk;
      if (atRisk > d) green += d / (atRisk * (atRisk - d));
      out.push({ t, s, atRisk, events: d, se: s * Math.sqrt(green) });
    }
  }
  return out;
}

/** S(t) read off a Kaplan-Meier curve (a step function). */
export function survivalAt(km: KmPoint[], t: number): number {
  let s = 1;
  for (const p of km) { if (p.t > t) break; s = p.s; }
  return s;
}

/** P(event in (t, t + dt] | no event by t) = (S(t) - S(t + dt)) / S(t). */
export function conditionalHazard(km: KmPoint[], t: number, dt: number): number {
  const a = survivalAt(km, t), b = survivalAt(km, t + dt);
  return a > 0 ? (a - b) / a : 0;
}

/**
 * The first day on which the chance of an unprompted reply in the next `window` days falls below
 * `threshold`: after that, waiting longer mostly wastes time, so a nudge is due.
 */
export function nudgeDay(km: KmPoint[], window = 3, threshold = 0.05, maxDay = 30): number | null {
  if (!km.length) return null;
  for (let t = 1; t <= maxDay; t++) if (conditionalHazard(km, t, window) < threshold) return t;
  return null;
}

/** The exact distribution of the number of successes among independent trials with different probabilities. */
export function poissonBinomial(ps: number[]): number[] {
  let dist = [1];
  for (const p of ps) {
    const next = Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) { next[k] += dist[k] * (1 - p); next[k + 1] += dist[k] * p; }
    dist = next;
  }
  return dist;
}
