/**
 * The week in the Book, for a Monday-morning read: which theses changed verdict, which forecasts resolved,
 * what the AI committee said, what closed, what is coming in the next two weeks, and what AI apps proposed.
 * Everything here is already in YouBank; this puts the last seven days of it on one page, so the PM has a
 * reason to look each week even when no alert fired. Pure; tested in scripts/test-book.ts; the page is
 * src/app/report/week.
 */
import type { BookAlert, BookHistory } from "./alerts";
import { closedReturn, CLOSE_REASONS, forecastItems, type ClosedPosition } from "./journal";
import type { Evaluation, Position, Verdict } from "./position";
import type { Proposal } from "./proposals";
import { DECISIONS, type Decision } from "./committee";

export type WeekInput = { now: Date; days?: number; book: Position[]; evals: Evaluation[]; history: BookHistory; closed: ClosedPosition[]; proposals: Proposal[] };
export type WeekBrief = {
  from: string; to: string;
  /** path: each verdict in turn after `from` (more than one when it moved and came back within the week). */
  changes: { positionId: string; ticker: string; from: Verdict; to: Verdict; on: string; path: Verdict[]; summary: string }[];
  resolved: { ticker: string; p: number; by: string; source: string; held: boolean; on: string }[];
  committees: { positionId: string; ticker: string; decision: Decision; on: string; p: number | null }[];
  closed: { ticker: string; reason: string; ret: number | null; on: string }[];
  coming: { positionId: string; ticker: string; label: string; date: string; inDays: number }[];
  proposals: { ticker: string; from: string }[];
  headline: string;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const WORD: Record<Verdict, string> = { intact: "intact", watch: "on watch", broken: "broken", unknown: "no data" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function weekBrief(i: WeekInput): WeekBrief {
  const days = i.days ?? 7;
  const to = day(i.now), from = day(new Date(i.now.getTime() - days * 86_400_000));
  const inWeek = (d: string) => d > from && d <= to;
  const byId = new Map(i.evals.map((e) => [e.positionId, e]));

  // Every change of verdict in the week, from where it stood before (or, for a position new this week, its
  // first check): "intact → broken" and also "intact → broken → intact" (broke and recovered).
  const changes: WeekBrief["changes"] = [];
  for (const p of i.book) {
    const pts = i.history[p.id] ?? [];
    const before = [...pts].reverse().find((h) => h.d <= from);
    const inside = pts.filter((h) => inWeek(h.d));
    if (!inside.length) continue;
    let prev = (before ?? inside[0]).v;
    const path: { v: Verdict; d: string }[] = [];
    for (const h of before ? inside : inside.slice(1)) if (h.v !== prev) { path.push({ v: h.v, d: h.d }); prev = h.v; }
    if (!path.length) continue;
    const start = (before ?? inside[0]).v, last = path[path.length - 1];
    changes.push({ positionId: p.id, ticker: p.ticker, from: start, to: last.v, on: last.d, path: path.map((x) => x.v), summary: byId.get(p.id)?.summary ?? "" });
  }
  const rank: Record<Verdict, number> = { broken: 0, watch: 1, unknown: 2, intact: 3 };
  changes.sort((a, b) => rank[a.to] - rank[b.to] || a.ticker.localeCompare(b.ticker));

  const resolved = forecastItems(i.book, i.history, i.closed, i.now)
    .filter((x): x is typeof x & { outcome: 0 | 1; resolvedOn: string } => x.outcome !== null && !!x.resolvedOn && inWeek(x.resolvedOn))
    .map((x) => ({ ticker: x.ticker, p: x.p, by: x.by, source: x.source, held: x.outcome === 1, on: x.resolvedOn }));

  const committees = i.book.filter((p) => p.committee && inWeek(p.committee.at.slice(0, 10)))
    .map((p) => ({ positionId: p.id, ticker: p.ticker, decision: p.committee!.decision, on: p.committee!.at.slice(0, 10), p: p.committee!.forecast?.p ?? null }));

  const closed = i.closed.filter((c) => inWeek(c.closedAt.slice(0, 10)))
    .map((c) => ({ ticker: c.ticker, reason: CLOSE_REASONS[c.reason], ret: closedReturn(c), on: c.closedAt.slice(0, 10) }));

  const coming: WeekBrief["coming"] = [];
  for (const e of i.evals) {
    if (e.earnings && e.earnings.inDays >= 0 && e.earnings.inDays <= 14) coming.push({ positionId: e.positionId, ticker: e.ticker, label: `Earnings${e.earnings.estimated ? " (estimated)" : ""}`, date: e.earnings.date, inDays: e.earnings.inDays });
    for (const c of e.catalysts) if (c.inDays >= 0 && c.inDays <= 14) coming.push({ positionId: e.positionId, ticker: e.ticker, label: c.label, date: c.date, inDays: c.inDays });
  }
  coming.sort((a, b) => a.inDays - b.inDays || a.ticker.localeCompare(b.ticker));

  const proposals = i.proposals.map((p) => ({ ticker: p.position.ticker, from: p.from }));

  const parts: string[] = [];
  const roundTrip = changes.filter((c) => c.to === c.from && c.path.includes("broken"));
  const moved = changes.filter((c) => c.to !== c.from);
  const broke = moved.filter((c) => c.to === "broken"), recovered = moved.filter((c) => c.to === "intact"), watch = moved.filter((c) => c.to === "watch");
  if (broke.length) parts.push(`${plural(broke.length, "thesis", "theses")} broke (${list(broke.map((c) => c.ticker))})`);
  if (watch.length) parts.push(`${watch.length} moved on watch (${list(watch.map((c) => c.ticker))})`);
  if (recovered.length) parts.push(`${recovered.length} recovered (${list(recovered.map((c) => c.ticker))})`);
  if (roundTrip.length) parts.push(`${roundTrip.length} broke and recovered within the week (${list(roundTrip.map((c) => c.ticker))})`);
  if (resolved.length) parts.push(`${plural(resolved.length, "forecast")} resolved, ${resolved.filter((r) => r.held).length} held`);
  if (committees.length) parts.push(`the AI committee sat on ${list(committees.map((c) => `${c.ticker} (${DECISIONS[c.decision].toLowerCase()})`))}`);
  if (closed.length) parts.push(`${closed.length} closed`);
  if (coming.length) parts.push(`${plural(coming.length, "date")} in the next two weeks`);
  if (proposals.length) parts.push(`${plural(proposals.length, "proposal")} waiting for review`);
  const headline = parts.length ? `This week: ${parts.join("; ")}.` : "A quiet week: no thesis changed verdict.";
  return { from, to, changes, resolved, committees, closed, coming, proposals, headline };
}

export const verdictWord = (v: Verdict) => WORD[v];

/**
 * After Friday's close: the week's headline in the bell, linking to the page, so there is a weekly reason to
 * look even when no alert fired. Once per week per person (the key), and only when the book is not empty.
 */
export function weekAlert(i: WeekInput, origin: string): BookAlert | null {
  if (i.now.getUTCDay() !== 5 || !i.book.length) return null;
  const w = weekBrief(i);
  return {
    key: `book:week:${w.to}`, positionId: "", kind: "week", urgent: false, url: `${origin}/report/week`,
    title: "The week in your book", body: w.headline, reasons: [`${w.from} to ${w.to}`],
  };
}
