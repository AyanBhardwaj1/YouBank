/**
 * The live book's response to its broken theses: for each position whose thesis is broken now, what the PM
 * has done since the break (cut it, added to it or flipped its side, from the decision journal) and how
 * quickly, or how long it has sat with nothing done. Closed positions are timed by the scorecard (median days
 * from a break to the exit); this covers what is still held. Holding a broken position can be the right call;
 * this shows it was looked at, not whether the action was right. Pure; tested in scripts/test-book.ts.
 */
import type { BookHistory } from "./alerts";
import { isPmChange, type LogEntry } from "./decisions";
import type { Position } from "./position";

export type BrokenAction = "cut" | "added to" | "flipped" | "resized";
export type BrokenNow = {
  positionId: string; ticker: string; since: string;
  /** Days from the break to the first action, or null when nothing was done. */
  actedAfter: number | null; action: BrokenAction | null;
  days: number;
};

/** The daily check skips a day without data, so a broken reading older than this is not called "broken now". */
const STALE_DAYS = 5;

const day = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / 86_400_000));

/** What a journal entry did to the size or side, or null when it is not such a decision (a note, a thesis edit, a forecast). */
function actionOf(e: LogEntry): BrokenAction | null {
  if (!e.auto) return null;
  if (e.text.startsWith("Side changed")) return "flipped";
  const w = /^Weight (none|[\d.]+%) → (none|[\d.]+%)/.exec(e.text);
  if (!w) return null;
  const n = (x: string) => (x === "none" ? 0 : parseFloat(x));
  return n(w[2]) < n(w[1]) ? "cut" : n(w[2]) > n(w[1]) ? "added to" : "resized";
}

export function brokenNow(open: Position[], history: BookHistory, now = new Date()): BrokenNow[] {
  const today = day(now.toISOString());
  const out: BrokenNow[] = [];
  for (const p of open) {
    const pts = history[p.id] ?? [];
    const last = pts[pts.length - 1];
    if (last?.v !== "broken" || daysBetween(last.d, today) > STALE_DAYS) continue;
    // The start of the broken run (the history keeps 180 days, so a longer run starts at its first kept day).
    let since = last.d;
    for (let i = pts.length - 1; i >= 0 && pts[i].v === "broken"; i--) since = pts[i].d;
    const first = (p.log ?? []).filter((e) => actionOf(e) && day(e.at) >= since).sort((a, b) => a.at.localeCompare(b.at))[0];
    out.push({ positionId: p.id, ticker: p.ticker, since, actedAfter: first ? daysBetween(since, first.at) : null, action: first ? actionOf(first) : null, days: daysBetween(since, today) });
  }
  // Nothing done first, longest first.
  return out.sort((a, b) => Number(a.actedAfter !== null) - Number(b.actedAfter !== null) || b.days - a.days || a.ticker.localeCompare(b.ticker));
}

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const VERB: Record<BrokenAction, string> = { cut: "cut", "added to": "added to", flipped: "side flipped", resized: "resized" };
/** "cut 3 days after the break" / "added to the day of the break". */
export const actedText = (b: BrokenNow) => (b.action === null || b.actedAfter === null ? "" : `${VERB[b.action]} ${b.actedAfter ? `${dd(b.actedAfter)} after` : "the day of"} the break`);

/** One sentence for a report, or "" when no thesis is broken. */
export function brokenNowLine(xs: BrokenNow[]): string {
  if (!xs.length) return "";
  const idle = xs.filter((x) => x.actedAfter === null), acted = xs.filter((x) => x.actedAfter !== null);
  const parts: string[] = [];
  if (idle.length) parts.push(`nothing done since the break on ${idle.map((x) => `${x.ticker} (${x.days ? dd(x.days) : "broke today"})`).join(", ")}`);
  if (acted.length) parts.push(acted.map((x) => `${x.ticker} ${actedText(x)}`).join(", "));
  return `Broken now: ${parts.join("; ")}.`;
}

/** A thesis left alone this long without a note or a change from the PM is due for a review. */
export const STALE_DAYS_REVIEW = 90;

export type Stale = { positionId: string; ticker: string; since: string; days: number };

/**
 * Positions the PM has not looked at for STALE_DAYS_REVIEW days: no note and no change of their own (the AI
 * committee's sittings and YouBank's checks do not count) since then, or since it was opened. A thesis that
 * was right a quarter ago may not be now; the check is whether someone still owns it. Oldest first.
 */
export function staleTheses(open: Position[], now = new Date(), after = STALE_DAYS_REVIEW): Stale[] {
  const today = day(now.toISOString());
  return open.flatMap((p) => {
    const touched = (p.log ?? []).filter((e) => !e.auto || isPmChange(e)).map((e) => e.at);
    const last = [p.createdAt, ...touched].filter(Boolean).sort().pop();
    // Nothing to date it by (a teammate's position seen without its history): no judgement.
    if (!last) return [];
    const days = daysBetween(last, today);
    return days >= after ? [{ positionId: p.id, ticker: p.ticker, since: day(last), days }] : [];
  }).sort((a, b) => b.days - a.days || a.ticker.localeCompare(b.ticker));
}
