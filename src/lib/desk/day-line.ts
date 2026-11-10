/**
 * Home's one-line summary of the day, under the greeting: what waits for a decision, the next meeting, and
 * the watchlist's biggest move. Built from what Home already loads; no model call. Pure, tested in
 * scripts/test-day-line.ts.
 */
export type DayFacts = {
  waiting: number | null;
  next: { title: string; start: string; ongoing?: boolean } | null;
  mover: { ticker: string; changePct: number } | null;
};

/** The parts, in reading order; empty when there is nothing worth saying yet. */
export function dayParts(f: DayFacts, now: number, timeOf: (iso: string) => string): string[] {
  const parts: string[] = [];
  if (f.waiting) parts.push(`${f.waiting} ${f.waiting === 1 ? "decision" : "decisions"} waiting`);
  if (f.next) {
    const start = Date.parse(f.next.start);
    const title = f.next.title.trim() || "a meeting";
    const short = title.length > 48 ? `${title.slice(0, 47)}…` : title;
    if (f.next.ongoing || (start <= now)) parts.push(`now: ${short}`);
    else if (start - now < 60 * 60_000) parts.push(`${short} in ${Math.max(1, Math.round((start - now) / 60_000))} min`);
    else parts.push(`next: ${short} at ${timeOf(f.next.start)}`);
  }
  // A move worth mentioning: at least 2% either way (changePct is a fraction).
  if (f.mover && Number.isFinite(f.mover.changePct) && Math.abs(f.mover.changePct) >= 0.02) {
    parts.push(`${f.mover.ticker} ${f.mover.changePct >= 0 ? "up" : "down"} ${(Math.abs(f.mover.changePct) * 100).toFixed(1)}%`);
  }
  return parts;
}

/** The biggest absolute move among the names with a price today. */
export function biggestMover(rows: { ticker: string; changePct: number | null | undefined }[]): DayFacts["mover"] {
  let best: DayFacts["mover"] = null;
  for (const r of rows) if (typeof r.changePct === "number" && Number.isFinite(r.changePct) && (!best || Math.abs(r.changePct) > Math.abs(best.changePct))) best = { ticker: r.ticker, changePct: r.changePct };
  return best;
}
