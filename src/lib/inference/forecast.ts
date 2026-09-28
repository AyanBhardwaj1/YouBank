/**
 * Short-horizon forecasting for business series (quarterly revenue, macro data): simple exponential
 * smoothing, damped-trend Holt, the Theta method, and their average, which is the kind of simple
 * combination that beat most complex methods in the M3 and M4 competitions. Series are seasonally
 * adjusted first (classical multiplicative decomposition) when a seasonality test says so.
 *
 * Prediction intervals are conformal: the model is re-fitted at earlier cut-off dates on the series's
 * own history, its errors on what happened next are pooled (scaled by the square root of the horizon),
 * and the interval is their finite-sample quantile. No normality assumption, and honest about short
 * histories: with too few backtests the interval says so.
 */
import { mean, quantile } from "./stats";

export type Forecast = {
  model: "combination" | "ses" | "damped" | "theta" | "naive";
  point: number[];
  lower80: number[]; upper80: number[];
  lower95: number[]; upper95: number[];
  seasonal: boolean;
  period: number;
  backtest: { origins: number; mape: number | null; mase: number | null; coverage80: number | null };
  /** Plain-language caveat (short history, few backtests). Empty when none. */
  note: string;
};

/* ---------------- Seasonality ---------------- */

function acf(y: number[], lag: number): number {
  const m = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < y.length; i++) { den += (y[i] - m) ** 2; if (i >= lag) num += (y[i] - m) * (y[i - lag] - m); }
  return den ? num / den : 0;
}

/**
 * The seasonality test used by the M4 Theta benchmark: seasonal if the autocorrelation at the seasonal
 * lag exceeds 1.645 standard errors (90%), with Bartlett's standard error from the lower lags.
 */
export function isSeasonal(y: number[], m: number): boolean {
  if (m <= 1 || y.length < 3 * m) return false;
  const r = Array.from({ length: m }, (_, i) => acf(y, i + 1));
  const se = Math.sqrt((1 + 2 * r.slice(0, m - 1).reduce((a, x) => a + x * x, 0)) / y.length);
  return Math.abs(r[m - 1]) > 1.645 * se;
}

/** Multiplicative seasonal indices by classical decomposition (centred moving average), normalized to average 1. */
export function seasonalIndices(y: number[], m: number): number[] {
  const n = y.length;
  const cma: (number | null)[] = Array(n).fill(null);
  const half = Math.floor(m / 2);
  for (let t = half; t < n - half; t++) {
    if (m % 2 === 0) {
      let s = 0.5 * y[t - half] + 0.5 * y[t + half];
      for (let k = t - half + 1; k < t + half; k++) s += y[k];
      cma[t] = s / m;
    } else {
      let s = 0;
      for (let k = t - half; k <= t + half; k++) s += y[k];
      cma[t] = s / m;
    }
  }
  const byPos: number[][] = Array.from({ length: m }, () => []);
  for (let t = 0; t < n; t++) if (cma[t]) byPos[t % m].push(y[t] / (cma[t] as number));
  const raw = byPos.map((v) => (v.length ? mean(v) : 1));
  const avg = mean(raw);
  return raw.map((v) => v / avg);
}

/* ---------------- Models (fitted by grid search on one-step squared error) ---------------- */

type Fit = { forecast: (h: number) => number[]; alpha?: number };

function fitSes(y: number[]): Fit {
  let best = { sse: Infinity, a: 0.5, level: y[0] };
  for (let a = 0.05; a <= 0.951; a += 0.05) {
    let l = y[0], sse = 0;
    for (let t = 1; t < y.length; t++) { sse += (y[t] - l) ** 2; l = a * y[t] + (1 - a) * l; }
    if (sse < best.sse) best = { sse, a, level: l };
  }
  return { alpha: best.a, forecast: (h) => Array(h).fill(best.level) };
}

function fitDamped(y: number[]): Fit {
  if (y.length < 4) return fitSes(y);
  let best = { sse: Infinity, l: y[0], b: 0, phi: 0.9 };
  for (let a = 0.1; a <= 0.91; a += 0.1) for (let bt = 0.05; bt <= 0.51; bt += 0.05) for (const phi of [0.8, 0.85, 0.9, 0.95, 0.98]) {
    let l = y[0], b = y[1] - y[0], sse = 0;
    for (let t = 1; t < y.length; t++) {
      const f = l + phi * b;
      sse += (y[t] - f) ** 2;
      const nl = a * y[t] + (1 - a) * (l + phi * b);
      b = bt * (nl - l) + (1 - bt) * phi * b;
      l = nl;
    }
    if (sse < best.sse) best = { sse, l, b, phi };
  }
  return {
    forecast: (h) => {
      const out: number[] = [];
      let damp = 0;
      for (let k = 1; k <= h; k++) { damp += Math.pow(best.phi, k); out.push(best.l + damp * best.b); }
      return out;
    },
  };
}

/** The Theta method as Hyndman and Billah (2003) express it: SES plus half the linear-trend slope, with SES's drift correction. */
function fitTheta(y: number[]): Fit {
  const ses = fitSes(y);
  const n = y.length, a = ses.alpha ?? 0.5;
  const t = y.map((_, i) => i), mt = mean(t), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (t[i] - mt) * (y[i] - my); sxx += (t[i] - mt) ** 2; }
  const b0 = sxx ? sxy / sxx : 0;
  const level = ses.forecast(1)[0];
  return { alpha: a, forecast: (h) => Array.from({ length: h }, (_, k) => level + 0.5 * b0 * (k + (1 - Math.pow(1 - a, n)) / a)) };
}

function fitModel(model: Forecast["model"], y: number[]): Fit {
  if (model === "naive" || y.length < 3) return { forecast: (h) => Array(h).fill(y[y.length - 1]) };
  if (model === "ses") return fitSes(y);
  if (model === "damped") return fitDamped(y);
  if (model === "theta") return fitTheta(y);
  const parts = [fitSes(y), fitDamped(y), fitTheta(y)];
  return { forecast: (h) => { const fs = parts.map((p) => p.forecast(h)); return Array.from({ length: h }, (_, k) => mean(fs.map((f) => f[k]))); } };
}

/** Point forecast of a (possibly seasonal) series. */
function pointForecast(y: number[], h: number, model: Forecast["model"], m: number, seasonal: boolean): number[] {
  if (!seasonal) return fitModel(model, y).forecast(h);
  const idx = seasonalIndices(y, m);
  const adj = y.map((v, t) => v / idx[t % m]);
  const f = fitModel(model, adj).forecast(h);
  return f.map((v, k) => v * idx[(y.length + k) % m]);
}

/** Finite-sample conformal quantile: the ceil((n + 1)(1 - alpha))-th smallest score, or null when there are too few scores. */
export function conformalQuantile(scores: number[], alpha: number): number | null {
  const s = [...scores].sort((a, b) => a - b);
  const k = Math.ceil((s.length + 1) * (1 - alpha));
  return k <= s.length ? s[k - 1] : null;
}

/**
 * Forecast h steps with conformal intervals from rolling-origin backtests. `period` is the seasonal
 * period (4 for quarterly, 12 for monthly). Values must be positive for the relative intervals.
 */
export function forecast(series: number[], h: number, opts: { period?: number; model?: Forecast["model"]; minTrain?: number; maxOrigins?: number } = {}): Forecast {
  const y = series.filter((v) => Number.isFinite(v));
  const m = opts.period ?? 1;
  const model = opts.model ?? "combination";
  const seasonal = isSeasonal(y, m);
  const point = pointForecast(y, h, model, m, seasonal);
  const minTrain = opts.minTrain ?? Math.max(6, seasonal ? 2 * m + 2 : 6);
  const origins: number[] = [];
  for (let o = Math.max(minTrain, y.length - (opts.maxOrigins ?? 16)); o < y.length; o++) origins.push(o);
  // Relative errors, scaled by sqrt(horizon) so every horizon contributes to one pool.
  const scores: number[] = [], ape: number[] = [], naiveErr: number[] = [], modelErr: number[] = [];
  let inside80 = 0, checked80 = 0;
  const provisional: number[] = [];
  for (const o of origins) {
    const train = y.slice(0, o);
    const f = pointForecast(train, h, model, m, seasonal && isSeasonal(train, m));
    for (let j = 1; j <= h && o + j - 1 < y.length; j++) {
      const actual = y[o + j - 1], fc = f[j - 1];
      if (!(fc > 0) || !(actual > 0)) continue;
      const rel = actual / fc - 1;
      scores.push(Math.abs(rel) / Math.sqrt(j));
      if (j === 1) {
        ape.push(Math.abs(rel));
        modelErr.push(Math.abs(actual - fc));
        const snaive = o - m >= 0 && m > 1 ? y[o - m] : y[o - 1];
        naiveErr.push(Math.abs(actual - snaive));
        // Coverage of the interval built only from errors known before this origin.
        const q = conformalQuantile(provisional, 0.2);
        if (q !== null) { checked80++; if (Math.abs(rel) <= q) inside80++; }
        provisional.push(Math.abs(rel));
      }
    }
  }
  const band = (alpha: number) => {
    const q = conformalQuantile(scores, alpha);
    return point.map((p, k) => (q === null ? [NaN, NaN] : [p * (1 - q * Math.sqrt(k + 1)), p * (1 + q * Math.sqrt(k + 1))]));
  };
  const b80 = band(0.2), b95 = band(0.05);
  const notes: string[] = [];
  if (y.length < 12) notes.push(`Only ${y.length} observations: treat the forecast as indicative.`);
  if (conformalQuantile(scores, 0.05) === null) notes.push("Too few backtests for a 95% interval.");
  return {
    model, point, seasonal, period: m,
    lower80: b80.map((b) => b[0]), upper80: b80.map((b) => b[1]),
    lower95: b95.map((b) => b[0]), upper95: b95.map((b) => b[1]),
    backtest: {
      origins: ape.length,
      mape: ape.length ? mean(ape) : null,
      mase: naiveErr.length && mean(naiveErr) > 0 ? mean(modelErr) / mean(naiveErr) : null,
      coverage80: checked80 ? inside80 / checked80 : null,
    },
    note: notes.join(" "),
  };
}

/** Year-over-year growth implied by a forecast, against the same period a year earlier. */
export function impliedGrowth(series: number[], fc: Forecast, period: number): (number | null)[] {
  return fc.point.map((p, k) => {
    const prior = series[series.length - period + k];
    return prior > 0 ? p / prior - 1 : null;
  });
}

export { quantile };
