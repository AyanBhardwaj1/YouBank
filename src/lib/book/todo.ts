/**
 * What the Book needs from the PM now, ranked: a broken thesis with nothing done since, a passed catalyst to
 * review, a recent change with no reason, a thesis nobody has reviewed in 90 days. Each comes from a check that
 * already exists (discipline.ts, decisions.ts); this puts them in one list at the top of the Book, so the
 * habits are a short to-do list rather than six panels to read. Pure; tested in scripts/test-book.ts.
 */
import type { BookHistory } from "./alerts";
import { isPmChange } from "./decisions";
import { brokenNow, catalystsDue, staleTheses } from "./discipline";
import type { Position } from "./position";

export type Todo = { positionId: string; ticker: string; kind: "broken" | "catalyst" | "reason" | "stale"; text: string };

const RANK: Record<Todo["kind"], number> = { broken: 0, catalyst: 1, reason: 2, stale: 3 };
const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function bookTodos(open: Position[], history: BookHistory, now = new Date()): Todo[] {
  const out: Todo[] = [];
  for (const b of brokenNow(open, history, now)) if (b.actedAfter === null) out.push({ positionId: b.positionId, ticker: b.ticker, kind: "broken", text: b.days ? `Broken for ${dd(b.days)}, nothing done since` : "Broke today: decide what to do" });
  for (const p of open) {
    for (const c of catalystsDue(p, now)) out.push({ positionId: p.id, ticker: p.ticker, kind: "catalyst", text: `Did ${c.label} (${c.date}) play out?` });
    // The latest change of the PM's own in the last 30 days, with no note at or after it.
    const log = p.log ?? [];
    const last = log.filter((e) => isPmChange(e) && !e.text.startsWith("Opened") && Date.parse(e.at) >= now.getTime() - 30 * 86_400_000).sort((a, b) => a.at.localeCompare(b.at)).pop();
    if (last && !log.some((e) => !e.auto && e.at >= last.at)) out.push({ positionId: p.id, ticker: p.ticker, kind: "reason", text: `The ${last.at.slice(0, 10)} change has no reason: ${last.text.replace(/\.$/, "")}` });
  }
  for (const s of staleTheses(open, now)) out.push({ positionId: s.positionId, ticker: s.ticker, kind: "stale", text: `Not reviewed in ${dd(s.days)}` });
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.ticker.localeCompare(b.ticker));
}
