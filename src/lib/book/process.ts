/**
 * Process health: the habits that separate a process from a run of results, on one panel. Each item is read
 * from records YouBank already keeps (the decision journal, the daily checks, the track record, the forecasts),
 * so none of it is self-reported:
 *
 * - reasons: the PM's changes in the last 90 days that carry a note on why (within a week of the change);
 * - broken: theses broken now that were acted on (a resize or a change of side) since the break;
 * - goalposts: kill criteria loosened while the thesis read broken or on watch, in the last 180 days;
 * - disposition: losers held much longer than winners (Shefrin and Statman 1985; Odean 1998);
 * - stale: positions with no note or change from the PM in 90 days;
 * - calibration: the Brier score of resolved forecasts (0.25 is what always saying 50% scores).
 *
 * Pure; tested in scripts/test-book.ts; shown on the IC report, the week and over MCP.
 */
import type { BookHistory } from "./alerts";
import { isGoalposts, isPmChange, type LogEntry } from "./decisions";
import { brokenNow, staleTheses } from "./discipline";
import type { Calibration } from "./forecast";
import { scorecard, type ClosedPosition } from "./journal";
import type { Position } from "./position";

export type HealthStatus = "good" | "watch" | "fix" | "none";
export type HealthItem = { key: "reasons" | "broken" | "goalposts" | "disposition" | "stale" | "calibration"; label: string; status: HealthStatus; value: string; detail: string };

const DAY = 86_400_000;
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

/** The PM's changes since `since` (not the opening: the thesis is its reason) and how many carry a note within a week. */
function reasons(logs: LogEntry[][], since: string): { total: number; explained: number } {
  let total = 0, explained = 0;
  for (const log of logs) {
    const notes = log.filter((e) => !e.auto).map((e) => Date.parse(e.at));
    for (const e of log) {
      if (!isPmChange(e) || e.text.startsWith("Opened") || e.at < since) continue;
      total++;
      const t = Date.parse(e.at);
      if (notes.some((n) => n >= t && n - t <= 7 * DAY)) explained++;
    }
  }
  return { total, explained };
}

export function processHealth(i: { open: Position[]; closed: ClosedPosition[]; history: BookHistory; calibration: Calibration | null; now?: Date }): HealthItem[] {
  const now = i.now ?? new Date();
  const logs = [...i.open.map((p) => p.log ?? []), ...i.closed.map((c) => c.log ?? [])];
  const items: HealthItem[] = [];

  const r = reasons(logs, new Date(now.getTime() - 90 * DAY).toISOString());
  items.push(r.total
    ? { key: "reasons", label: "Reasons recorded", value: `${r.explained} of ${r.total}`, status: r.explained / r.total >= 0.8 ? "good" : r.explained / r.total >= 0.5 ? "watch" : "fix", detail: `${pct(r.explained, r.total)} of your changes in the last 90 days carry a note on why, written within a week.` }
    : { key: "reasons", label: "Reasons recorded", value: "—", status: "none", detail: "No changes to positions in the last 90 days." });

  const b = brokenNow(i.open, i.history, now);
  const idle = b.filter((x) => x.actedAfter === null);
  items.push(b.length
    ? { key: "broken", label: "Broken theses acted on", value: `${b.length - idle.length} of ${b.length}`, status: idle.some((x) => x.days > 5) ? "fix" : idle.length ? "watch" : "good", detail: idle.length ? `Nothing done since the break on ${idle.map((x) => `${x.ticker} (${x.days} day${x.days === 1 ? "" : "s"})`).join(", ")}.` : "Every broken thesis has been resized or flipped since it broke." }
    : { key: "broken", label: "Broken theses acted on", value: "—", status: "none", detail: "No thesis reads broken now." });

  const g = logs.flat().filter((e) => isGoalposts(e) && Date.parse(e.at) >= now.getTime() - 180 * DAY).length;
  items.push({ key: "goalposts", label: "Goalposts moved", value: String(g), status: g === 0 ? "good" : g === 1 ? "watch" : "fix", detail: g ? `Kill criteria were loosened while the thesis read broken or on watch ${g === 1 ? "once" : `${g} times`} in the last 180 days.` : "No kill criterion was loosened while its thesis was failing in the last 180 days." });

  const h = scorecard(i.closed).holding;
  items.push(h
    ? { key: "disposition", label: "Losers held longer than winners", value: `${h.losers} vs ${h.winners} days`, status: h.disposition ? "fix" : "good", detail: `Median days held: ${h.losers} for losers, ${h.winners} for winners, over ${h.n} closes.${h.disposition ? " Cutting gains early and waiting on losses is the disposition effect." : ""}` }
    : { key: "disposition", label: "Losers held longer than winners", value: "—", status: "none", detail: "Needs at least two winners and two losers closed." });

  const s = staleTheses(i.open, now);
  items.push(i.open.length
    ? { key: "stale", label: "Theses not reviewed in 90 days", value: String(s.length), status: s.length === 0 ? "good" : s.length / i.open.length <= 0.25 ? "watch" : "fix", detail: s.length ? `No note or change from you on ${s.map((x) => x.ticker).join(", ")}.` : "Every position has a note or a change from you in the last 90 days." }
    : { key: "stale", label: "Theses not reviewed in 90 days", value: "—", status: "none", detail: "The book is empty." });

  const c = i.calibration;
  items.push(c && c.n >= 5 && c.brier !== null
    ? { key: "calibration", label: "Forecast calibration", value: `Brier ${c.brier.toFixed(2)}`, status: c.brier <= 0.2 ? "good" : c.brier <= 0.25 ? "watch" : "fix", detail: `Over ${c.n} resolved forecasts; 0 is perfect and 0.25 is what always saying 50% scores.` }
    : { key: "calibration", label: "Forecast calibration", value: "—", status: "none", detail: `Needs five resolved forecasts${c ? ` (${c.n} so far)` : ""}.` });

  return items;
}

/** One line: how many items are good, to watch and to fix. */
export function healthLine(xs: HealthItem[]): string {
  const n = (s: HealthStatus) => xs.filter((x) => x.status === s).length;
  const judged = xs.length - n("none");
  if (!judged) return "Process health: not enough history yet.";
  return `Process health: ${n("good")} good, ${n("watch")} to watch, ${n("fix")} to fix${n("none") ? ` (${n("none")} not enough history yet)` : ""}.`;
}
