/**
 * A base rate for a forecast, from price alone: the chance the price stays on the right side of each price
 * line in the kill criteria (a price floor or ceiling, or a stop-loss from entry) until the forecast's date.
 * The price is treated as a driftless random walk in log terms with the stock's own one-year volatility,
 * and the chance it never touches a line in time T is 1 - 2·Φ(-ln(S/B) / (σ√T)) (the reflection principle),
 * with a continuity correction because the criteria are checked daily (checked against a simulation).
 *
 * Reference-class forecasting: people and models forecast better when they start from a base rate and
 * adjust, so the card shows it beside the PM's own number. It covers price criteria only (fundamentals
 * report quarterly and are not a random walk), and says so. Pure; tested in scripts/test-book.ts.
 */
import type { Position } from "./position";

/** The standard normal CDF (Abramowitz-Stegun 7.1.26, error under 1.5e-7). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** The chance a driftless log-price starting at S never crosses B within `years`, at annual volatility σ (fraction). */
export function noTouch(S: number, B: number, sigma: number, years: number, side: "floor" | "ceiling", daily = true): number {
  if (side === "floor" ? S <= B : S >= B) return 0;
  // The kill criteria are checked once a day, not continuously: the Broadie-Glasserman correction moves the
  // line away by exp(0.5826·σ·√(1/252)), so the chance matches a daily check.
  const shift = daily ? Math.exp(0.5826 * sigma * Math.sqrt(1 / 252)) : 1;
  const b = side === "floor" ? B / shift : B * shift;
  const gap = side === "floor" ? Math.log(S / b) : Math.log(b / S);
  if (gap <= 0) return 0;
  if (years <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - 2 * phi(-gap / (sigma * Math.sqrt(years)))));
}

/** The price lines in a position's kill criteria: a price floor or ceiling, or a stop from entry. */
export function priceLines(p: Pick<Position, "criteria" | "entry" | "direction">): { level: number; side: "floor" | "ceiling" }[] {
  const out: { level: number; side: "floor" | "ceiling" }[] = [];
  for (const c of p.criteria) {
    if (c.metric === "price" && c.value > 0) out.push({ level: c.value, side: c.op === ">=" ? "floor" : "ceiling" });
    if (c.metric === "return_since_entry" && p.entry && p.entry > 0) {
      // "At least -15% in the position's favour" is a stop: a long's floor below entry, a short's ceiling above
      // it. "At most +50%" is a profit-take: a long's ceiling, a short's floor.
      const level = p.direction === "long" ? p.entry * (1 + c.value / 100) : p.entry * (1 - c.value / 100);
      const floor = (c.op === ">=") === (p.direction === "long");
      if (level > 0) out.push({ level, side: floor ? "floor" : "ceiling" });
    }
  }
  return out;
}

/**
 * The base rate for "no price kill criterion fails before `by`" (the check on the `by` day included). The
 * binding floor (the highest) and the binding ceiling (the lowest) decide it; with both, the chance of
 * staying inside the band is bounded below by P(floor) + P(ceiling) - 1 (it matches a simulation closely).
 * Null without a price line, a price, a volatility or a future date.
 */
export function priceBaseRate(p: Pick<Position, "criteria" | "entry" | "direction">, price: number | null, volPct: number | null, by: string, now: Date): { p: number; lines: number } | null {
  const lines = priceLines(p);
  const years = (Date.parse(`${by}T00:00:00Z`) + 86_400_000 - now.getTime()) / (365.25 * 86_400_000);
  if (!lines.length || !price || price <= 0 || !volPct || volPct <= 0 || !(years > 0)) return null;
  const sigma = volPct / 100;
  const floors = lines.filter((l) => l.side === "floor").map((l) => l.level), ceilings = lines.filter((l) => l.side === "ceiling").map((l) => l.level);
  const pf = floors.length ? noTouch(price, Math.max(...floors), sigma, years, "floor") : 1;
  const pc = ceilings.length ? noTouch(price, Math.min(...ceilings), sigma, years, "ceiling") : 1;
  return { p: floors.length && ceilings.length ? Math.max(0, pf + pc - 1) : Math.min(pf, pc), lines: lines.length };
}

/**
 * A forecast above the volatility-only base rate needs a reason. The base rate is a model (a driftless random
 * walk at trailing volatility), not a fact, so a forecast above it can be right: the PM may expect drift in
 * their favour or calmer volatility. But with other kill criteria that must also hold, the chance none fails
 * is at most the chance the price lines hold under the same view (the conjunction rule; Tversky and Kahneman
 * 1983), so a number well above the base rate should say what it expects that the model does not. `stale`:
 * the forecast was set on an earlier day, when the base rate may have been higher. Returns the note, or null.
 */
export function conjunctionCheck(forecast: number, base: { p: number; lines: number } | null, criteria: number, stale = false): string | null {
  if (!base || forecast <= base.p + 0.02) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = `the ${pct(base.p)} volatility-only chance the price line${base.lines === 1 ? "" : "s"} hold${base.lines === 1 ? "s" : ""}`;
  const why = criteria > base.lines ? "With the other kill criteria also needing to hold, what do you expect that the model does not (drift in your favour, calmer volatility)?" : "What do you expect that the model does not (drift in your favour, calmer volatility)?";
  return stale ? `${pct(forecast)} is now above ${lines}; consider updating it. ${why}` : `${pct(forecast)} is above ${lines}. ${why}`;
}
