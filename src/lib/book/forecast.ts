/**
 * Calibration: how good the fund's conviction is, scored like a forecasting tournament. Each position can
 * carry a forecast, "70% that no kill criterion fails before 2027-02-01". YouBank resolves it on its own
 * from the thesis's daily history:
 * - a break before the date resolves it 0;
 * - the date passing without a break resolves it 1;
 * - a position closed before the date without a break stays unresolved, never counted as a win.
 *
 * Over resolved forecasts it gives the Brier score (0 is perfect, 0.25 is a coin flip at 50%) and a
 * calibration table: "forecasts of 70-90%: 55% held". Forecasts made by AI apps (a proposal's
 * conviction) keep their source, so a person's calibration can be set beside an AI's. Pure; tested in
 * scripts/test-book.ts.
 */
import type { HistoryPoint } from "./alerts";

/** p: the chance; by: the date it resolves; at: the day it was made (only later breaks count); source: who made it. */
export type Conviction = { p: number; by: string; at: string; source: string };
export type ForecastItem = { ticker: string; p: number; by: string; source: string; outcome: 0 | 1 | null; resolvedOn: string | null; /** Closed before its date without a break: never scored, but counted. */ closedEarly?: boolean };

const dateOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** A stored or entered conviction, cleaned: a probability from 1% to 99% (given as 1-99 or 0.01-0.99) and a date. */
export function normalizeConviction(raw: unknown): Conviction | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let p = typeof r.p === "number" ? r.p : Number(r.p);
  if (!Number.isFinite(p)) return null;
  // 1 and up is a percent (1 means 1%); below 1 a fraction.
  if (p >= 1) p = p / 100;
  if (p < 0.01 || p > 0.99 || !dateOk(r.by)) return null;
  const source = typeof r.source === "string" && r.source.trim() ? r.source.trim().slice(0, 80) : "You";
  const at = dateOk(r.at) ? r.at : new Date().toISOString().slice(0, 10);
  if (r.by <= at) return null;
  return { p: Math.round(p * 100) / 100, by: r.by, at, source };
}

export const PAST_FORECASTS_MAX = 40;
export const BROKEN_FORECAST = "The thesis reads broken: a forecast made now would be scored on a break that has already happened. Keep the forecast as it is or clear it, and set a new one once the thesis recovers.";
/** The shortest forecast accepted: long enough that a forecast cannot be farmed day by day. */
export const MIN_HORIZON_DAYS = 30;
export const AI_COMMITTEE = "AI committee";
export const sameForecast = (a: Conviction, b: Conviction | null | undefined) => !!b && a.p === b.p && a.by === b.by && a.at === b.at && a.source === b.source;

/**
 * The earlier forecasts a position keeps when its forecast is changed or removed, so a forecast cannot be
 * withdrawn once it is going wrong: each stays scored at its own date. A change made the same day as the
 * forecast is a correction and is not kept. The newest {@link PAST_FORECASTS_MAX} are kept.
 */
export function supersede(past: Conviction[] | undefined, old: Conviction | null | undefined, next: Conviction | null | undefined, today: string): Conviction[] {
  const list = past ?? [];
  if (!old || isSample(old) || sameForecast(old, next) || old.at >= today || list.some((x) => sameForecast(old, x))) return list;
  return [...list, old].slice(-PAST_FORECASTS_MAX);
}

/**
 * A forecast as posted by a person or an app, made now: a new or changed one is dated today and must resolve
 * after today, so it cannot be backdated over a past that is already known. One left as it was keeps its date.
 */
export function freshForecast(posted: Conviction | undefined, prev: Conviction | undefined, today: string, broken = false): { conviction?: Conviction; error?: string } {
  if (!posted) return {};
  // The same chance and date is the same forecast, whoever it is posted as: it keeps its date and author.
  if (prev && posted.p === prev.p && posted.by === prev.by) return { conviction: prev };
  // While the thesis reads broken, the next daily check is a break after today, so a forecast made now would be
  // resolved by a break already known (a 1% would score near-perfect). A new one waits until the thesis recovers.
  if (broken) return { error: BROKEN_FORECAST };
  if (posted.by <= today) return { error: "A forecast must resolve after today." };
  const min = new Date(Date.parse(`${today}T00:00:00Z`) + MIN_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (posted.by < min) return { error: `A forecast must look at least ${MIN_HORIZON_DAYS} days ahead (to ${min} or later).` };
  // Only the server writes the committee's forecasts; a posted one is the person's own.
  return { conviction: { ...posted, at: today, ...(posted.source === AI_COMMITTEE ? { source: "You" } : {}) } };
}

/** Whether any of these forecasts was made before today: deleting it would erase a forecast already on the record. */
export const SAMPLE_SOURCE = "Sample";
/** Sample forecasts (the sample book's) are illustrative: never scored, never kept, never "on the record". */
export const isSample = (f: Conviction | null | undefined) => f?.source === SAMPLE_SOURCE;
export const standing = (today: string, ...fs: (Conviction | null | undefined)[]) => fs.some((f) => !!f && !isSample(f) && f.at < today);

/** The first day after the forecast was made that the thesis read broken. */
export const breakAfter = (c: Conviction, history: HistoryPoint[]) => history.find((h) => h.v === "broken" && h.d > c.at)?.d ?? null;

/**
 * Resolve a forecast from the thesis's history, as of `now`. A closed position passes its close date and the
 * first break after the forecast (kept when it closed), since its history is gone.
 */
export function resolveForecast(c: Conviction, history: HistoryPoint[], now: Date, closedAt: string | null = null, brokeOn: string | null = null): { outcome: 0 | 1 | null; resolvedOn: string | null } {
  const firstBreak = closedAt ? brokeOn : breakAfter(c, history);
  if (firstBreak && firstBreak <= c.by) return { outcome: 0, resolvedOn: firstBreak };
  const today = now.toISOString().slice(0, 10);
  const end = closedAt ? closedAt.slice(0, 10) : today;
  // Held to the date: resolved 1 only if the position was still open (or closed on or after) the date.
  if (end >= c.by) return { outcome: 1, resolvedOn: c.by };
  return { outcome: null, resolvedOn: null };
}

export type Calibration = {
  n: number; open: number;
  /** Of the open ones, those whose position closed before the date with no break: they can no longer resolve. */
  closedEarly: number;
  brier: number | null;
  /** Average stated probability against the share that held: positive is overconfident. */
  bias: number | null;
  buckets: { label: string; n: number; avgP: number; held: number }[];
  bySource: { source: string; n: number; brier: number; /** With 20 or more resolved: what this source's average stated chance has behaved like. */ meant?: { said: number; means: number } }[];
};

/** The fewest resolved forecasts a correction is fitted on. */
export const PLATT_MIN = 20;
const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));
const lg = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sig = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Platt scaling: outcome ≈ sigmoid(a·logit(p) + b), fitted by Newton's method on the forecasts' own record,
 * with a ridge that pulls toward "no correction" (a = 1, b = 0) so a small record cannot swing it far.
 * a < 1 means overconfident (stated chances too extreme), b shifts the whole scale. Null under PLATT_MIN
 * or when every outcome was the same.
 */
export function fitPlatt(xs: { p: number; outcome: 0 | 1 }[], ridge = 2): { a: number; b: number } | null {
  if (xs.length < PLATT_MIN || xs.every((x) => x.outcome === xs[0].outcome)) return null;
  const zs = xs.map((x) => lg(x.p));
  // The penalised log-loss; each Newton step is halved until it goes down, so the fit cannot run away.
  const loss = (a: number, b: number) => xs.reduce((s, x, k) => { const q = Math.min(1 - 1e-12, Math.max(1e-12, sig(a * zs[k] + b))); return s - (x.outcome ? Math.log(q) : Math.log(1 - q)); }, 0) + (ridge / 2) * ((a - 1) ** 2 + b ** 2);
  let a = 1, b = 0, f = loss(a, b), converged = false;
  for (let it = 0; it < 100 && !converged; it++) {
    let ga = ridge * (a - 1), gb = ridge * b, haa = ridge, hab = 0, hbb = ridge;
    xs.forEach((x, k) => { const z = zs[k], q = sig(a * z + b), w = q * (1 - q), e = q - x.outcome; ga += e * z; gb += e; haa += w * z * z; hab += w * z; hbb += w; });
    const det = haa * hbb - hab * hab;
    if (!(det > 1e-12)) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    let t = 1, moved = false;
    for (let h = 0; h < 30; h++, t /= 2) { const fa = loss(a - t * da, b - t * db); if (fa <= f) { a -= t * da; b -= t * db; f = fa; moved = true; break; } }
    if (!moved || Math.abs(t * da) + Math.abs(t * db) < 1e-9) converged = true;
  }
  // A slope outside this range is not a correction anyone should read off a small record.
  if (!converged || !(a > 0.05 && a < 5) || !Number.isFinite(b)) return null;
  return { a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000 };
}

export const recalibrate = (p: number, f: { a: number; b: number }) => sig(f.a * lg(p) + f.b);

const BUCKETS: [number, number, string][] = [[0, 0.3, "under 30%"], [0.3, 0.5, "30-50%"], [0.5, 0.7, "50-70%"], [0.7, 0.9, "70-90%"], [0.9, 1.01, "90% and up"]];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function calibration(items: ForecastItem[]): Calibration {
  const done = items.filter((x): x is ForecastItem & { outcome: 0 | 1 } => x.outcome !== null);
  const brierOf = (xs: typeof done) => xs.reduce((a, x) => a + (x.p - x.outcome) ** 2, 0) / xs.length;
  const sources = [...new Set(done.map((x) => x.source))];
  return {
    n: done.length, open: items.length - done.length - items.filter((x) => x.outcome === null && x.closedEarly).length,
    closedEarly: items.filter((x) => x.outcome === null && x.closedEarly).length,
    brier: done.length ? r3(brierOf(done)) : null,
    bias: done.length ? r3(done.reduce((a, x) => a + x.p, 0) / done.length - done.reduce((a, x) => a + x.outcome, 0) / done.length) : null,
    buckets: BUCKETS.map(([lo, hi, label]) => {
      const xs = done.filter((x) => x.p >= lo && x.p < hi);
      return { label, n: xs.length, avgP: xs.length ? r3(xs.reduce((a, x) => a + x.p, 0) / xs.length) : 0, held: xs.length ? r3(xs.reduce((a, x) => a + x.outcome, 0) / xs.length) : 0 };
    }).filter((b) => b.n > 0),
    bySource: sources.map((source) => {
      const xs = done.filter((x) => x.source === source);
      const f = fitPlatt(xs);
      const said = xs.reduce((a, x) => a + x.p, 0) / xs.length;
      return { source, n: xs.length, brier: r3(brierOf(xs)), ...(f ? { meant: { said: Math.round(said * 100) / 100, means: Math.round(recalibrate(said, f) * 100) / 100 } } : {}) };
    }).sort((a, b) => b.n - a.n),
  };
}

/** One line for a person: the score and which way it leans. */
export function calibrationLine(c: Calibration): string {
  if (!c.n && c.closedEarly && !c.open) return `${c.closedEarly} forecast${c.closedEarly === 1 ? "" : "s"} closed before ${c.closedEarly === 1 ? "its" : "their"} date and left unscored; none resolved yet.`;
  if (!c.n) return c.open ? `${c.open} forecast${c.open === 1 ? "" : "s"} still open; none resolved yet.` : "No forecasts yet: give a position a conviction and a date.";
  const lean = c.bias === null || Math.abs(c.bias) < 0.05 ? "well calibrated" : c.bias > 0 ? `overconfident by ${Math.round(c.bias * 100)} points` : `underconfident by ${Math.round(-c.bias * 100)} points`;
  return `Brier ${c.brier!.toFixed(3)} over ${c.n} resolved forecast${c.n === 1 ? "" : "s"} (0 is perfect, 0.25 a coin flip): ${lean}${c.open ? `; ${c.open} still open` : ""}${c.closedEarly ? `; ${c.closedEarly} closed before ${c.closedEarly === 1 ? "its" : "their"} date and left unscored` : ""}.`;
}
