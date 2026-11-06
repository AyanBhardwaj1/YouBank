/**
 * The live book's response to its broken theses: for each position whose thesis is broken now, whether the
 * PM has acted since the break (a resize or a change of side, from the decision journal) and how quickly, or
 * how long it has sat with nothing done. Closed positions are timed by the scorecard (median days from a
 * break to the exit); this covers what is still held. Holding a broken position can be the right call; this
 * shows it was looked at, not whether the action was right. Pure; tested in scripts/test-book.ts.
 */
import type { BookHistory } from "./alerts";
import type { LogEntry } from "./decisions";
import type { Position } from "./position";

export type BrokenNow = { positionId: string; ticker: string; since: string; /** Days from the break to the first action, or null when nothing was done. */ actedAfter: number | null; days: number };

const day = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / 86_400_000));
/** The journal entries YouBank writes for a decision about the size or side (not a note, a thesis edit or a forecast). */
const isAction = (e: LogEntry) => !!e.auto && /^(Weight |Side changed)/.test(e.text);

export function brokenNow(open: Position[], history: BookHistory, now = new Date()): BrokenNow[] {
  const today = day(now.toISOString());
  const out: BrokenNow[] = [];
  for (const p of open) {
    const pts = history[p.id] ?? [];
    if (pts[pts.length - 1]?.v !== "broken") continue;
    let since = pts[pts.length - 1].d;
    for (let i = pts.length - 1; i >= 0 && pts[i].v === "broken"; i--) since = pts[i].d;
    const acted = (p.log ?? []).filter((e) => isAction(e) && day(e.at) >= since).map((e) => day(e.at)).sort()[0];
    out.push({ positionId: p.id, ticker: p.ticker, since, actedAfter: acted ? daysBetween(since, acted) : null, days: daysBetween(since, today) });
  }
  // Nothing done first, longest first.
  return out.sort((a, b) => Number(a.actedAfter !== null) - Number(b.actedAfter !== null) || b.days - a.days || a.ticker.localeCompare(b.ticker));
}

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** One sentence for a report, or "" when no thesis is broken. */
export function brokenNowLine(xs: BrokenNow[]): string {
  if (!xs.length) return "";
  const idle = xs.filter((x) => x.actedAfter === null), acted = xs.filter((x) => x.actedAfter !== null);
  const parts: string[] = [];
  if (idle.length) parts.push(`nothing done since the break on ${idle.map((x) => `${x.ticker} (${x.days ? dd(x.days) : "broke today"})`).join(", ")}`);
  if (acted.length) parts.push(`${acted.map((x) => `${x.ticker} resized ${x.actedAfter ? `${dd(x.actedAfter)} after` : "the day of"} its break`).join(", ")}`);
  return `Broken now: ${parts.join("; ")}.`;
}
