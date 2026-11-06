/**
 * The Book's alerts: what changed since the last check, worth telling a person about. The book is checked
 * every weekday after the US close (src/app/api/cron/book); each position's verdict is compared with the one
 * it had last time (profiles.extra.bookState), and a change becomes an alert:
 *
 * - broken: a kill criterion failed. Urgent: it goes out even in quiet hours.
 * - watch: an intact thesis came close to a kill criterion.
 * - recovered: a broken or watched thesis holds again.
 * - catalyst: a dated catalyst is today or tomorrow (once per catalyst and date).
 *
 * Each alert's key is unique per position, verdict and day (or catalyst and date), so a re-run never sends
 * the same alert twice. A position seen for the first time sets its baseline and only alerts when it is
 * already broken. Pure; tested in scripts/test-book.ts.
 */
import type { Evaluation, Verdict } from "./position";

export type BookState = { verdicts: Record<string, Verdict>; checkedAt: string | null };
export type BookAlert = { key: string; positionId: string; kind: "broken" | "watch" | "recovered" | "catalyst"; title: string; body: string; url: string; urgent: boolean; reasons: string[] };

export function normalizeBookState(raw: unknown): BookState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v = (r.verdicts && typeof r.verdicts === "object" ? r.verdicts : {}) as Record<string, unknown>;
  const verdicts: Record<string, Verdict> = {};
  for (const [k, x] of Object.entries(v)) if (x === "intact" || x === "watch" || x === "broken" || x === "unknown") verdicts[k] = x;
  return { verdicts, checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : null };
}

export function alertsFor(state: BookState, evals: Evaluation[], now: Date): { alerts: BookAlert[]; next: BookState } {
  const day = now.toISOString().slice(0, 10);
  const alerts: BookAlert[] = [];
  const verdicts: Record<string, Verdict> = {};
  for (const e of evals) {
    const was = state.verdicts[e.positionId];
    // No data this time (a feed was down): keep what we knew, say nothing.
    if (e.verdict === "unknown") { if (was) verdicts[e.positionId] = was; continue; }
    verdicts[e.positionId] = e.verdict;
    const side = `${e.direction === "long" ? "Long" : "Short"} ${e.ticker}`;
    const url = `/app/book?position=${encodeURIComponent(e.positionId)}`;
    const failed = e.checks.find((c) => c.state === "fail");
    const near = e.checks.find((c) => c.state === "near");
    if (e.verdict === "broken" && was !== "broken") {
      alerts.push({ key: `book:${e.positionId}:broken:${day}`, positionId: e.positionId, kind: "broken", urgent: true, url,
        title: `${side}: thesis broken`, body: e.summary, reasons: [failed ? `${failed.label} ${failed.shown} vs ${failed.target}` : "A kill criterion failed", e.weight ? `${e.weight}% of NAV` : ""].filter(Boolean) });
    } else if (e.verdict === "watch" && was === "intact") {
      alerts.push({ key: `book:${e.positionId}:watch:${day}`, positionId: e.positionId, kind: "watch", urgent: false, url,
        title: `${side}: close to a kill criterion`, body: e.summary, reasons: [near ? `${near.label} ${near.shown} vs ${near.target}` : "Close to a kill criterion"] });
    } else if (e.verdict === "intact" && (was === "broken" || was === "watch")) {
      alerts.push({ key: `book:${e.positionId}:recovered:${day}`, positionId: e.positionId, kind: "recovered", urgent: false, url,
        title: `${side}: thesis holds again`, body: e.summary, reasons: [`Was ${was === "broken" ? "broken" : "on watch"}`] });
    }
    for (const c of e.catalysts) {
      if (c.inDays !== 0 && c.inDays !== 1) continue;
      alerts.push({ key: `book:${e.positionId}:catalyst:${c.id}:${c.date}`, positionId: e.positionId, kind: "catalyst", urgent: false, url,
        title: `${e.ticker}: ${c.label} ${c.inDays === 0 ? "today" : "tomorrow"}`, body: `${side}. The thesis is ${e.verdict === "intact" ? "intact" : e.verdict === "watch" ? "on watch" : "broken"}: ${e.summary}`, reasons: [`Catalyst on ${c.date}`] });
    }
  }
  return { alerts, next: { verdicts, checkedAt: now.toISOString() } };
}
