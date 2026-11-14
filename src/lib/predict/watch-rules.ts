/**
 * The pure parts of watching a market and forecasting on one. Tested in scripts/test-predict.ts.
 *
 * Move alerts: a watch remembers the probability it last told the person about (its base). When the market
 * has moved at least `threshold` points from that base, an alert goes out and the base moves to the new
 * price, so a market that drifts 2 points a day sets off one alert per `threshold` points, not one a day,
 * and a market that swings back and forth inside the band sets off none. A resolved market alerts once.
 *
 * Forecasts: a person records their own probability on a market (paper only). When the market resolves,
 * the forecast is scored with the Brier score, (p - outcome)^2: 0 is perfect, 0.25 is always saying 50%.
 * The market's own price when the forecast was made is scored the same way, so the person sees whether they
 * beat the crowd. The Book's calibration table (src/lib/book/forecast.ts) reads the result.
 */
import type { ForecastItem } from "@/lib/book/forecast";
import type { Market } from "./types";

/** Thresholds a person may pick, in probability points (0.05 = 5 points). */
export const THRESHOLDS = [0.03, 0.05, 0.1, 0.15, 0.2] as const;
export const DEFAULT_THRESHOLD = 0.05;
export const WATCHES_FREE = 5;
export const WATCHES_PRO = 100;

/** A threshold given as points (5) or a fraction (0.05), cleaned to one we allow. Pure. */
export function normalizeThreshold(v: unknown): number {
  let n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_THRESHOLD;
  if (n >= 1) n = n / 100;
  return THRESHOLDS.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best), THRESHOLDS[0]);
}

export type WatchState = { threshold: number; baseProb: number | null; resolvedSent?: boolean };
export type MoveDecision = { fire: boolean; move: number; kind: "move" | "resolved" | null; nextBase: number | null };

/** Whether a watch fires now, and its new base. Pure. */
export function moveAlert(w: WatchState, m: Pick<Market, "prob" | "status" | "result">): MoveDecision {
  if (m.status === "resolved" && m.result) {
    return { fire: !w.resolvedSent, move: w.baseProb === null ? 0 : (m.result === "yes" ? 1 : 0) - w.baseProb, kind: w.resolvedSent ? null : "resolved", nextBase: m.result === "yes" ? 1 : 0 };
  }
  if (m.prob === null) return { fire: false, move: 0, kind: null, nextBase: w.baseProb };
  if (w.baseProb === null) return { fire: false, move: 0, kind: null, nextBase: m.prob };
  const move = Math.round((m.prob - w.baseProb) * 10_000) / 10_000;
  // A hair under the threshold (floating point) counts: 5 points means 5 points.
  if (Math.abs(move) + 1e-9 >= w.threshold) return { fire: true, move, kind: "move", nextBase: m.prob };
  return { fire: false, move, kind: null, nextBase: w.baseProb };
}

const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))} pts`;

/** The alert's words. Pure. */
export function alertText(label: string, venue: string, d: MoveDecision, prob: number | null, result: "yes" | "no" | null): { title: string; body: string } {
  if (d.kind === "resolved") return { title: `Resolved ${result === "yes" ? "yes" : "no"}: ${label}`.slice(0, 300), body: `${venue} settled this market ${result === "yes" ? "yes" : "no"}. Any forecast you made on it is now scored.` };
  return {
    title: `${pts(d.move)} to ${Math.round((prob ?? 0) * 100)}%: ${label}`.slice(0, 300),
    body: `${venue}'s price for this market moved ${Math.abs(Math.round(d.move * 100))} points since your last alert, to ${Math.round((prob ?? 0) * 100)}%. Information, not advice.`,
  };
}

/* ---------------- Forecasts ---------------- */

/** A forecast as entered: 1 to 99 (percent) or 0.01 to 0.99. Null outside. Pure. */
export function normalizeForecastP(v: unknown): number | null {
  let p = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(p)) return null;
  if (p >= 1) p = p / 100;
  if (p < 0.01 || p > 0.99) return null;
  return Math.round(p * 100) / 100;
}

/** The Brier score of one forecast. Pure. */
export const brier = (p: number, outcome: 0 | 1) => Math.round((p - outcome) ** 2 * 10_000) / 10_000;

/** Why a forecast cannot be recorded on this market now, or null. Pure. */
export function forecastRefusal(m: Pick<Market, "status" | "closeTime" | "prob">, now = Date.now()): string | null {
  if (m.status !== "open") return "This market is no longer open, so a forecast now would be scored on a known result.";
  if (m.closeTime && Date.parse(m.closeTime) - now < 3_600_000) return "This market closes within the hour. Forecasts close an hour before the market does.";
  return null;
}

export type StoredForecast = { id: number; marketKey: string; title: string; venue: string; p: number; marketP: number | null; day: string; outcome: number | null; resolvedAt: string | null };

/**
 * Forecasts as the Book's calibration reads them: the person's ("You") and the market price at the same
 * moment ("Market price"), so calibration() and calibrationLine() from src/lib/book/forecast.ts score both. Pure.
 */
export function asForecastItems(fs: StoredForecast[]): ForecastItem[] {
  const out: ForecastItem[] = [];
  for (const f of fs) {
    const outcome = f.outcome === 1 ? 1 : f.outcome === 0 ? 0 : null;
    const resolvedOn = f.resolvedAt ? f.resolvedAt.slice(0, 10) : null;
    out.push({ ticker: f.marketKey, p: f.p, by: resolvedOn ?? f.day, source: "You", outcome, resolvedOn });
    if (f.marketP !== null) out.push({ ticker: f.marketKey, p: Math.min(0.99, Math.max(0.01, f.marketP)), by: resolvedOn ?? f.day, source: "Market price", outcome, resolvedOn });
  }
  return out;
}
