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
import { filingLine } from "./filings";

/** muted: keys of alerts that came up while the person's Book alerts were off, so they are not sent once alerts are back on. */
export type BookState = { verdicts: Record<string, Verdict>; checkedAt: string | null; history: BookHistory; muted: string[] };
export type BookAlert = { key: string; positionId: string; kind: "broken" | "watch" | "recovered" | "catalyst"; title: string; body: string; url: string; urgent: boolean; reasons: string[] };

export function normalizeBookState(raw: unknown): BookState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v = (r.verdicts && typeof r.verdicts === "object" ? r.verdicts : {}) as Record<string, unknown>;
  const verdicts: Record<string, Verdict> = {};
  for (const [k, x] of Object.entries(v)) if (x === "intact" || x === "watch" || x === "broken" || x === "unknown") verdicts[k] = x;
  const muted = Array.isArray(r.muted) ? r.muted.filter((k): k is string => typeof k === "string").slice(0, MUTED_MAX) : [];
  return { verdicts, checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : null, history: normalizeHistory(r.history), muted };
}

const MUTED_MAX = 300;

/**
 * The alerts to send, given the person's switch. Off: nothing is sent and every key that came up is remembered,
 * so a filing, earnings date or catalyst seen while alerts were off is not sent late once they are back on
 * (verdict changes need no such note: the verdicts move on either way). On: remembered keys are left out.
 */
export function gateAlerts(alerts: BookAlert[], muted: string[], off: boolean): { send: BookAlert[]; muted: string[] } {
  if (off) return { send: [], muted: [...new Set([...alerts.map((a) => a.key), ...muted])].slice(0, MUTED_MAX) };
  const m = new Set(muted);
  return { send: alerts.filter((a) => !m.has(a.key)), muted };
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
    if (e.filing) {
      alerts.push({ key: `book:${e.positionId}:filing:${e.filing.form}:${e.filing.filed}`, positionId: e.positionId, kind: "catalyst", urgent: false, url,
        title: `${e.ticker} filed its ${e.filing.form}`, body: `${filingLine(e.filing)} ${side}: ${e.summary}`, reasons: [`${e.filing.form} filed ${e.filing.filed}`] });
    }
    if (e.earnings && (e.earnings.inDays === 0 || e.earnings.inDays === 1)) {
      alerts.push({ key: `book:${e.positionId}:earnings:${e.earnings.date}`, positionId: e.positionId, kind: "catalyst", urgent: false, url,
        title: `${e.ticker} reports ${e.earnings.inDays === 0 ? "today" : "tomorrow"}${e.earnings.estimated ? " (estimated)" : ""}`, body: `${side}. The thesis is ${e.verdict === "intact" ? "intact" : e.verdict === "watch" ? "on watch" : "broken"}: ${e.summary}`, reasons: [`Earnings on ${e.earnings.date}`] });
    }
    for (const c of e.catalysts) {
      if (c.inDays !== 0 && c.inDays !== 1) continue;
      alerts.push({ key: `book:${e.positionId}:catalyst:${c.id}:${c.date}`, positionId: e.positionId, kind: "catalyst", urgent: false, url,
        title: `${e.ticker}: ${c.label} ${c.inDays === 0 ? "today" : "tomorrow"}`, body: `${side}. The thesis is ${e.verdict === "intact" ? "intact" : e.verdict === "watch" ? "on watch" : "broken"}: ${e.summary}`, reasons: [`Catalyst on ${c.date}`] });
    }
  }
  return { alerts, next: { verdicts, checkedAt: now.toISOString(), history: recordHistory(state.history, evals, now), muted: state.muted } };
}

/* ---------------- History: one point a day per position ---------------- */

export type HistoryPoint = { d: string; v: Verdict; s: number | null };
export type BookHistory = Record<string, HistoryPoint[]>;
export const HISTORY_DAYS = 180;

export function normalizeHistory(raw: unknown): BookHistory {
  const out: BookHistory = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, pts] of Object.entries(raw as Record<string, unknown>).slice(0, 50)) {
    if (!/^[a-z0-9-]{4,40}$/.test(id) || !Array.isArray(pts)) continue;
    out[id] = pts.flatMap((p): HistoryPoint[] => {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return typeof o.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.d) && (o.v === "intact" || o.v === "watch" || o.v === "broken")
        ? [{ d: o.d, v: o.v, s: typeof o.s === "number" ? o.s : null }] : [];
    }).slice(-HISTORY_DAYS);
  }
  return out;
}

/**
 * Today's point for every position checked (a day without data adds none; a second check the same day
 * replaces the first), the last HISTORY_DAYS kept, positions no longer in the book dropped.
 */
export function recordHistory(history: BookHistory, evals: Evaluation[], now: Date): BookHistory {
  const d = now.toISOString().slice(0, 10);
  const out: BookHistory = {};
  for (const e of evals) {
    const pts = (history[e.positionId] ?? []).filter((p) => p.d !== d);
    if (e.verdict !== "unknown") pts.push({ d, v: e.verdict, s: e.score });
    out[e.positionId] = pts.sort((a, b) => a.d.localeCompare(b.d)).slice(-HISTORY_DAYS);
  }
  return out;
}

/** Whether today's point is missing for any position checked (so a read should record it). */
export const needsPoint = (history: BookHistory, evals: Evaluation[], now: Date) => {
  const d = now.toISOString().slice(0, 10);
  return evals.some((e) => e.verdict !== "unknown" && !(history[e.positionId] ?? []).some((p) => p.d === d));
};

/** How long the current verdict has held: the first day of the run it is in, and its length in days. */
export function streakOf(points: HistoryPoint[], now: Date): { since: string; days: number; verdict: Verdict } | null {
  if (!points.length) return null;
  const last = points[points.length - 1];
  let i = points.length - 1;
  while (i > 0 && points[i - 1].v === last.v) i--;
  const since = points[i].d;
  return { since, verdict: last.v, days: Math.max(0, Math.round((Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000)) };
}
