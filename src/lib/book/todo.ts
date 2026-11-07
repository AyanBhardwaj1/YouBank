/**
 * What the Book needs from the PM now, ranked: a broken thesis with nothing done since, a passed catalyst to
 * review, a thesis that recovered from a break with its forecast still the one the break resolved, a recent
 * change with no reason, a thesis nobody has reviewed in 90 days. (While the thesis reads broken it takes no new
 * forecast, see forecast.ts freshForecast; once it recovers, it is asked for one.) Each comes from a check that
 * already exists (discipline.ts, decisions.ts); this puts them in one list at the top of the Book, so the
 * habits are a short to-do list rather than six panels to read. Pure; tested in scripts/test-book.ts.
 */
import type { BookHistory } from "./alerts";
import { breakAfter } from "./forecast";
import { isPmChange, recentVerdict } from "./decisions";
import { brokenNow, catalystsDue, staleTheses } from "./discipline";
import type { Position } from "./position";

export type Todo = { positionId: string; ticker: string; kind: "broken" | "catalyst" | "forecast" | "reason" | "stale"; text: string };

const RANK: Record<Todo["kind"], number> = { broken: 0, catalyst: 1, forecast: 2, reason: 3, stale: 4 };
const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function bookTodos(open: Position[], history: BookHistory, now = new Date()): Todo[] {
  const out: Todo[] = [];
  for (const b of brokenNow(open, history, now)) {
    if (b.actedAfter === null) out.push({ positionId: b.positionId, ticker: b.ticker, kind: "broken", text: b.days ? `Broken for ${dd(b.days)}, nothing done since` : "Broke today: decide what to do" });
  }
  const today = now.toISOString().slice(0, 10);
  for (const p of open) {
    // Recovered from a break in the last two weeks, with a forecast made before it: the break resolved that one,
    // and a new forecast could not be set while it lasted. Only for positions that carried one: forecasting is optional.
    const pts = history[p.id] ?? [], v = recentVerdict(pts, now);
    const lastBroken = pts.map((x) => x.v).lastIndexOf("broken");
    if (p.conviction && v && v !== "broken" && v !== "unknown" && lastBroken >= 0 && lastBroken < pts.length - 1) {
      const back = pts[lastBroken + 1].d;
      // Only a forecast the break actually resolved (a break after it was made, by its date): not one made on the
      // last broken day, which is still open, nor one that had already run its course before the break.
      const hit = breakAfter(p.conviction, pts);
      if (hit && hit <= p.conviction.by && hit < back && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${back}T00:00:00Z`) <= 14 * 86_400_000) out.push({ positionId: p.id, ticker: p.ticker, kind: "forecast", text: `Recovered from the break on ${back}: set a new forecast` });
    }
    for (const c of catalystsDue(p, now)) out.push({ positionId: p.id, ticker: p.ticker, kind: "catalyst", text: `Did ${c.label} (${c.date}) play out?` });
    // The latest change of the PM's own in the last 30 days, with no note at or after it.
    const log = p.log ?? [];
    const last = log.filter((e) => isPmChange(e) && !e.text.startsWith("Opened") && Date.parse(e.at) >= now.getTime() - 30 * 86_400_000).sort((a, b) => a.at.localeCompare(b.at)).pop();
    if (last && !log.some((e) => !e.auto && e.at >= last.at)) out.push({ positionId: p.id, ticker: p.ticker, kind: "reason", text: `The ${last.at.slice(0, 10)} change has no reason: ${last.text.replace(/\.$/, "")}` });
  }
  for (const s of staleTheses(open, now)) out.push({ positionId: s.positionId, ticker: s.ticker, kind: "stale", text: `Not reviewed in ${dd(s.days)}` });
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.ticker.localeCompare(b.ticker));
}
