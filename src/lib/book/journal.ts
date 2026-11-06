/**
 * The Book's track record: every closed position kept with its exit, why it was closed and what its thesis
 * was doing, so a fund can show process, not just P&L. "We exit within N days of a thesis breaking", "our
 * kill criteria would have saved X points", the hit rate and the payoff ratio by reason for closing.
 *
 * A position closes with an exit price (the price then, unless the person gives one), a reason and a note.
 * The thesis's history gives the first day it broke and, from Nov 2026 on, the price that day. That is
 * enough to compare the exit taken with "out on the break". Nothing is traded. Pure (safe on the client);
 * tested in scripts/test-book.ts. Stored in profiles.extra.bookClosed by ./store.ts.
 */
import type { BookAlert, BookHistory, HistoryPoint } from "./alerts";
import { breakAfter, calibration, isSample, normalizeConviction, PAST_FORECASTS_MAX, resolveForecast, type Calibration, type Conviction, type ForecastItem } from "./forecast";
import { normalizeLog, withEntries, type LogEntry } from "./decisions";
import { normalizePosition, type Criterion, type Direction, type Position, type Verdict } from "./position";

export const CLOSE_REASONS = { thesis_broke: "The thesis broke", target: "Target reached", risk: "Risk or sizing", better_idea: "A better idea", other: "Other" } as const;
export type CloseReason = keyof typeof CLOSE_REASONS;
export const JOURNAL_MAX = 300;

export type ClosedPosition = {
  id: string; ticker: string; direction: Direction; weight: number | null;
  entry: number | null; exit: number | null;
  openedAt: string; closedAt: string;
  reason: CloseReason; note: string;
  thesis: string; criteria: Criterion[];
  /** The verdict when it was closed, and the first day its thesis read broken (with that day's price, when kept). */
  verdictAtClose: Verdict; brokeOn: string | null; priceAtBreak: number | null;
  /** When the thesis was broken at the close: the first day of that unbroken run of broken days. */
  brokenSince?: string | null;
  /** The forecast, and the first break after it was made (null when it held to the close). */
  conviction?: Conviction; convictionBrokeOn?: string | null;
  /** The AI committee's forecast, kept the same way, so its calibration survives the close. */
  aiConviction?: Conviction; aiConvictionBrokeOn?: string | null;
  /** The decision journal, ending with the close. */
  log?: LogEntry[];
  /** The AI committee's last call before the close, if it sat: to see whether its calls tracked outcomes. */
  aiDecision?: "add" | "hold" | "trim" | "exit";
  /** Earlier forecasts that were replaced while it was open, each with its first break after it was made. */
  pastForecasts?: { f: Conviction; brokeOn: string | null }[];
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e7 ? v : null);
const day = (iso: string) => iso.slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / 86_400_000);
const isReason = (v: unknown): v is CloseReason => typeof v === "string" && v in CLOSE_REASONS;

/** A closed record from the position, its latest verdict and its history. */
export function closedFrom(p: Position, verdict: Verdict, history: HistoryPoint[], exit: number | null, reason: CloseReason, note: string, now = new Date()): ClosedPosition {
  const brokeAt = history.find((h) => h.v === "broken") ?? null;
  return {
    id: p.id, ticker: p.ticker, direction: p.direction, weight: p.weight, entry: p.entry, exit: num(exit),
    openedAt: p.createdAt, closedAt: now.toISOString(), reason, note: clip(note, 280),
    thesis: p.thesis, criteria: p.criteria,
    verdictAtClose: verdict, brokeOn: brokeAt?.d ?? null, priceAtBreak: num(brokeAt?.p ?? null),
    // A break the daily history has not recorded yet (seen only at the close) starts on the close day.
    brokenSince: verdict === "broken" ? (() => { let since: string | null = null; for (let i = history.length - 1; i >= 0 && history[i].v === "broken"; i--) since = history[i].d; return since ?? now.toISOString().slice(0, 10); })() : null,
    ...(p.conviction ? { conviction: p.conviction, convictionBrokeOn: breakAfter(p.conviction, history) } : {}),
    ...(p.committee?.forecast ? { aiConviction: p.committee.forecast, aiConvictionBrokeOn: breakAfter(p.committee.forecast, history) } : {}),
    ...(p.pastForecasts?.length ? { pastForecasts: p.pastForecasts.map((f) => ({ f, brokeOn: breakAfter(f, history) })) } : {}),
    ...(p.committee ? { aiDecision: p.committee.decision } : {}),
    log: withEntries(p.log, [`Closed: ${CLOSE_REASONS[reason].toLowerCase()}${num(exit) ? ` at $${num(exit)}` : ""}.`], now.toISOString(), note),
  };
}

export function normalizeJournal(raw: unknown): ClosedPosition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ClosedPosition[] = [];
  for (const x of raw) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    // The position's own fields are cleaned as a position (ticker, thesis, criteria); the rest here.
    const p = normalizePosition({ ...r, catalysts: [], pillars: [] });
    if (!p || seen.has(p.id) || typeof r.closedAt !== "string") continue;
    seen.add(p.id);
    const v = r.verdictAtClose;
    out.push({
      id: p.id, ticker: p.ticker, direction: p.direction, weight: p.weight, entry: p.entry, exit: num(r.exit),
      openedAt: typeof r.openedAt === "string" ? r.openedAt : p.createdAt, closedAt: r.closedAt,
      reason: isReason(r.reason) ? r.reason : "other", note: clip(r.note, 280), thesis: p.thesis, criteria: p.criteria,
      verdictAtClose: v === "intact" || v === "watch" || v === "broken" ? v : "unknown",
      brokeOn: typeof r.brokeOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.brokeOn) ? r.brokeOn : null, priceAtBreak: num(r.priceAtBreak),
      ...(() => { const l = normalizeLog(r.log); return l.length ? { log: l } : {}; })(),
      ...(r.aiDecision === "add" || r.aiDecision === "hold" || r.aiDecision === "trim" || r.aiDecision === "exit" ? { aiDecision: r.aiDecision } : {}),
      ...(typeof r.brokenSince === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.brokenSince) ? { brokenSince: r.brokenSince } : {}),
      ...(p.conviction ? { conviction: p.conviction, convictionBrokeOn: typeof r.convictionBrokeOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.convictionBrokeOn) ? r.convictionBrokeOn : null } : {}),
      ...(() => { const a = normalizeConviction({ ...(r.aiConviction && typeof r.aiConviction === "object" ? r.aiConviction : {}), source: "AI committee" }); return a && r.aiConviction ? { aiConviction: a, aiConvictionBrokeOn: typeof r.aiConvictionBrokeOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.aiConvictionBrokeOn) ? r.aiConvictionBrokeOn : null } : {}; })(),
      ...(() => {
        const xs = (Array.isArray(r.pastForecasts) ? r.pastForecasts : []).flatMap((x) => {
          const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
          const f = normalizeConviction(o.f);
          return f ? [{ f, brokeOn: typeof o.brokeOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.brokeOn) ? o.brokeOn : null }] : [];
        }).slice(-PAST_FORECASTS_MAX);
        return xs.length ? { pastForecasts: xs } : {};
      })(),
    });
  }
  return out.slice(0, JOURNAL_MAX);
}

/** Return on a closed position in its favour (a short gains when the price falls), as a fraction. */
export const closedReturn = (c: Pick<ClosedPosition, "entry" | "exit" | "direction">) =>
  c.entry && c.exit ? (c.exit / c.entry - 1) * (c.direction === "short" ? -1 : 1) : null;

export type Scorecard = {
  closed: number; withReturn: number;
  hitRate: number | null; avgReturn: number | null; avgWin: number | null; avgLoss: number | null; payoff: number | null;
  byReason: { reason: CloseReason; label: string; n: number; avgReturn: number | null }[];
  /** Theses still broken at the close; how many were closed within five days of that break; median days from it to the close. */
  broke: number; exitedOnBreak: number; medianDaysToExit: number | null;
  /** Where the price on the break day is known: the average return had each been closed then, against the return taken. */
  counterfactual: { n: number; onBreak: number; taken: number } | null;
  /**
   * Process against outcome, so a lucky win is not read as skill: the process was sound unless the thesis was
   * still broken at the close and had been for more than five days. Over closes with a return; tickers in each box.
   */
  process: { earned: string[]; unlucky: string[]; lucky: string[]; deserved: string[] } | null;
  /** Returns grouped by the AI committee's last call before the close (closes with a return and a sitting). */
  byCommittee: { decision: "add" | "hold" | "trim" | "exit"; n: number; avgReturn: number | null }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10_000) / 10_000);

export function scorecard(list: ClosedPosition[]): Scorecard {
  const rets = list.map((c) => ({ c, r: closedReturn(c) })).filter((x): x is { c: ClosedPosition; r: number } => x.r !== null);
  const wins = rets.filter((x) => x.r > 0).map((x) => x.r), losses = rets.filter((x) => x.r < 0).map((x) => x.r);
  const avgWin = mean(wins), avgLoss = mean(losses);
  const byReason = (Object.keys(CLOSE_REASONS) as CloseReason[]).map((reason) => {
    const xs = rets.filter((x) => x.c.reason === reason).map((x) => x.r);
    return { reason, label: CLOSE_REASONS[reason], n: list.filter((c) => c.reason === reason).length, avgReturn: r4(mean(xs)) };
  }).filter((x) => x.n > 0);
  // A thesis still broken when it was closed, timed from the start of that broken run (one that broke and
  // recovered before the close was not "exited on the break"); older records fall back to the first break.
  const broke = list.filter((c) => c.verdictAtClose === "broken" && (c.brokenSince ?? c.brokeOn));
  const lags = broke.map((c) => days((c.brokenSince ?? c.brokeOn)!, c.closedAt)).filter((d) => d >= 0);
  const cf = rets.filter((x) => x.c.brokeOn && x.c.priceAtBreak && x.c.entry).map((x) => ({ taken: x.r, onBreak: (x.c.priceAtBreak! / x.c.entry! - 1) * (x.c.direction === "short" ? -1 : 1) }));
  return {
    closed: list.length, withReturn: rets.length,
    hitRate: rets.length ? r4(wins.length / rets.length) : null, avgReturn: r4(mean(rets.map((x) => x.r))),
    avgWin: r4(avgWin), avgLoss: r4(avgLoss), payoff: avgWin !== null && avgLoss ? r4(avgWin / Math.abs(avgLoss)) : null,
    byReason,
    broke: broke.length, exitedOnBreak: lags.filter((d) => d <= 5).length, medianDaysToExit: median(lags),
    counterfactual: cf.length ? { n: cf.length, onBreak: r4(mean(cf.map((x) => x.onBreak)))!, taken: r4(mean(cf.map((x) => x.taken)))! } : null,
    byCommittee: (["add", "hold", "trim", "exit"] as const).map((decision) => {
      const xs = rets.filter((x) => x.c.aiDecision === decision).map((x) => x.r);
      return { decision, n: xs.length, avgReturn: r4(mean(xs)) };
    }).filter((x) => x.n > 0),
    process: rets.length ? (() => {
      const box = { earned: [] as string[], unlucky: [] as string[], lucky: [] as string[], deserved: [] as string[] };
      for (const { c, r } of rets) {
        if (r === 0) continue;
        // Held past a break: still broken at the close, and broken for more than five days by then (a break that
        // recovered before the close does not count). Older records without the run fall back to the first break.
        const since = c.verdictAtClose === "broken" ? (c.brokenSince ?? c.brokeOn) : null;
        const sound = !since || days(since, c.closedAt) <= 5;
        box[sound ? (r > 0 ? "earned" : "unlucky") : (r > 0 ? "lucky" : "deserved")].push(c.ticker);
      }
      return box;
    })() : null,
  };
}

/** One line for a person (or an LP letter): the record so far. */
export function scorecardLine(s: Scorecard): string {
  if (!s.closed) return "No closed positions yet.";
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const parts = [`${s.closed} closed`];
  if (s.hitRate !== null) parts.push(`${Math.round(s.hitRate * 100)}% winners`);
  if (s.avgReturn !== null) parts.push(`average ${pct(s.avgReturn)}`);
  if (s.payoff !== null) parts.push(`payoff ${s.payoff.toFixed(2)}x`);
  if (s.broke) parts.push(`${s.exitedOnBreak} of ${s.broke} broken theses exited within 5 days${s.medianDaysToExit !== null ? ` (median ${s.medianDaysToExit} days)` : ""}`);
  return `${parts.join("; ")}.`;
}

/** Every forecast, open positions' and closed ones', resolved as of now; and the calibration over them. */
export function forecastItems(open: Position[], history: BookHistory, closed: ClosedPosition[], now = new Date()): ForecastItem[] {
  const items: ForecastItem[] = [];
  for (const p of open) {
    for (const f of [p.conviction, p.committee?.forecast ?? undefined, ...(p.pastForecasts ?? [])]) {
      if (!f || isSample(f)) continue;
      items.push({ ticker: p.ticker, p: f.p, by: f.by, source: f.source, ...resolveForecast(f, history[p.id] ?? [], now) });
    }
  }
  for (const c of closed) {
    for (const [f, broke] of [[c.conviction, c.convictionBrokeOn], [c.aiConviction, c.aiConvictionBrokeOn], ...(c.pastForecasts ?? []).map((x) => [x.f, x.brokeOn] as const)] as const) {
      if (!f || isSample(f)) continue;
      const r = resolveForecast(f, [], now, c.closedAt, broke ?? null);
      items.push({ ticker: c.ticker, p: f.p, by: f.by, source: f.source, ...r, ...(r.outcome === null && c.closedAt.slice(0, 10) < f.by ? { closedEarly: true } : {}) });
    }
  }
  return items;
}

export const calibrationOf = (open: Position[], history: BookHistory, closed: ClosedPosition[], now = new Date()): Calibration => calibration(forecastItems(open, history, closed, now));

/**
 * The daily check's note when a forecast resolves today: a break after it was made (and before its date),
 * or its date reached with the thesis intact. One alert per forecast (keyed by position and date).
 */
export function forecastAlerts(open: Position[], history: BookHistory, now: Date, origin = ""): BookAlert[] {
  const today = now.toISOString().slice(0, 10);
  const out: BookAlert[] = [];
  for (const p of open) {
    if (!p.conviction) continue;
    const r = resolveForecast(p.conviction, history[p.id] ?? [], now);
    if (r.outcome === null || r.resolvedOn !== today) continue;
    const pct = Math.round(p.conviction.p * 100);
    out.push({
      key: `book:${p.id}:forecast:${p.conviction.at}:${p.conviction.by}`, positionId: p.id, kind: r.outcome ? "recovered" : "watch", urgent: false,
      url: `${origin}/app/book?position=${encodeURIComponent(p.id)}`,
      title: `${p.ticker}: your ${pct}% forecast ${r.outcome ? "held" : "missed"}`,
      body: r.outcome ? `No kill criterion failed between ${p.conviction.at} and ${p.conviction.by}. It counts toward your calibration in the track record.` : `A kill criterion failed on ${today}, before ${p.conviction.by}. At ${pct}% that was a ${(p.conviction.p ** 2).toFixed(2)} Brier miss; the track record shows your calibration.`,
      reasons: [`Forecast ${pct}% to ${p.conviction.by}`],
    });
  }
  return out;
}
