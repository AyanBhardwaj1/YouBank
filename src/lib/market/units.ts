/**
 * Units and display for market figures. Internally a percent change is a fraction (0.0123 is 1.23%);
 * providers' percent fields are converted once, at their boundary (canonical.ts `pctToFraction`). This
 * is the one place a change is formatted for people, and the one place "missing" is written. Pure, so
 * server code and the browser share it.
 */
export { pctToFraction } from "./canonical";

/** What a missing figure reads as on screen. */
export const NA = "n/a";

/** A fractional change for display: 0.0123 -> "+1.23%", with `arrow` "▲ 1.23%"; missing -> "n/a". */
export function fmtChange(v: number | null | undefined, digits = 2, arrow = false): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return NA;
  const pct = (Math.abs(v) * 100).toFixed(digits);
  if (arrow) return `${v >= 0 ? "▲" : "▼"} ${pct}%`;
  return `${v >= 0 ? "+" : "-"}${pct}%`;
}

/** An instant as New York clock time, "10:42 ET" (badges: "Stale · as of 10:42 ET"); "" for a bad date. */
export function etClock(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "";
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${f.format(t)} ET`;
}

/** The tone class for a change: up, down, or nothing to say. */
export const changeTone = (v: number | null | undefined) => (typeof v !== "number" || !Number.isFinite(v) ? "text-muted" : v >= 0 ? "text-pos" : "text-neg");

/**
 * Surprise of an actual against an estimate, as a fraction of the estimate's size: (actual - estimate) /
 * |estimate|. Beating a loss estimate (-0.05 against -0.10) is +50%, not -50%. With an estimate of zero
 * (or none) the ratio has no meaning, so it is null; whether it was a beat is still actual > estimate.
 */
export function epsSurprise(actual: number, estimate: number | null): number | null {
  if (estimate === null || estimate === 0 || !Number.isFinite(estimate) || !Number.isFinite(actual)) return null;
  return (actual - estimate) / Math.abs(estimate);
}

/** The sum of the last four quarters' EPS, or null unless all four are reported. */
export function trailingEps(eps: (number | null)[]): number | null {
  const q = eps.slice(0, 4);
  return q.length === 4 && q.every((e): e is number => e !== null && Number.isFinite(e)) ? q.reduce((a, e) => a + e, 0) : null;
}
