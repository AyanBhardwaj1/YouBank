/**
 * The change library (F2): is this week's number a real change, and how often would the detector cry wolf
 * on a series like this one? Four pieces, combined into one verdict a card can state honestly:
 * - robustZ: the latest point against the trailing 26 weeks' median and MAD, in log space (counts and
 *   dollars move by ratios), so one outlier week does not set the scale;
 * - seasonalNaive: the residual against 52 weeks earlier, used only when that beats the plain last-value
 *   forecast on the series' own one-step backtest (hiring and attention are often seasonal; most are not);
 * - bocpd: Bayesian online change-point detection (Adams and MacKay 2007) with a Normal-Gamma prior, so
 *   each new point is scored by a Student-t predictive, and a hazard of 1/52 (one change a year a priori).
 *   It gives the posterior probability that a change point fell in the last k weeks;
 * - placeboRate: the detector run over block-shuffled copies of a reference history (blocks keep the
 *   week-to-week texture but scatter any real break), counting alarms per company-year. That rate is the
 *   stated error: "about one false alarm every 4 company-years on this kind of series".
 * Pure and deterministic (the shuffles are seeded).
 */
import { rng } from "../scen/stats";

const DAY = 86_400_000;

/** The Monday (UTC) of the week a date falls in, as YYYY-MM-DD. Pure. */
export function weekOf(d: Date | string): string {
  const t = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // Monday 0
  return new Date(t.getTime() - dow * DAY).toISOString().slice(0, 10);
}

/** The first day of the month a date falls in. Pure. */
export const monthStart = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 7) + "-01";

/** The Mondays from `from` to `to` inclusive, in order. Pure. */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${weekOf(from)}T00:00:00Z`), end = Date.parse(`${weekOf(to)}T00:00:00Z`); t <= end; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mad = (xs: number[]) => { const m = med(xs); return med(xs.map((x) => Math.abs(x - m))); };
/** Signals are counts and money: compared as ratios, with zero allowed. */
export const toLog = (v: number) => Math.log1p(Math.max(0, v));

/**
 * Robust z of each point against the `window` points before it (log scale): (x - median) / (1.4826 * MAD),
 * with the MAD floored so a flat history does not divide by zero. NaN until there are `minHistory` points. Pure.
 */
export function robustZ(values: number[], window = 26, minHistory = 8): number[] {
  const x = values.map(toLog);
  return x.map((v, t) => {
    const hist = x.slice(Math.max(0, t - window), t);
    if (hist.length < minHistory) return NaN;
    const scale = Math.max(1.4826 * mad(hist), 0.05);
    return (v - med(hist)) / scale;
  });
}

/** Residuals against the same week a year earlier (log scale); NaN for the first `period` points. Pure. */
export function seasonalNaive(values: number[], period = 52): number[] {
  const x = values.map(toLog);
  return x.map((v, t) => (t >= period ? v - x[t - period] : NaN));
}

/** Whether the seasonal-naive forecast beats the last-value forecast on the series' own one-step backtest (mean absolute error, log scale). Pure. */
export function seasonalBeats(values: number[], period = 52): boolean {
  const x = values.map(toLog);
  if (x.length < period + 12) return false;
  let seas = 0, naive = 0, n = 0;
  for (let t = period; t < x.length; t++) { seas += Math.abs(x[t] - x[t - period]); naive += Math.abs(x[t] - x[t - 1]); n++; }
  return n > 0 && seas / n < naive / n * 0.95;
}

/* ---------------- Bayesian online change-point detection ---------------- */

/** log Gamma by Lanczos, for the Student-t density. */
function lgam(z: number): number {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgam(1 - z);
  z -= 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log density of a Student-t with nu degrees of freedom, location mu and scale^2 = s2. */
function studentLogPdf(x: number, nu: number, mu: number, s2: number): number {
  return lgam((nu + 1) / 2) - lgam(nu / 2) - 0.5 * Math.log(nu * Math.PI * s2) - ((nu + 1) / 2) * Math.log(1 + ((x - mu) ** 2) / (nu * s2));
}

export type Bocpd = { runLength: number[][]; changeProb: (k: number, at?: number) => number; scale: number };

/**
 * BOCPD on the log series, standardised by its own robust scale (median, and the MAD of week-to-week
 * differences over sqrt 2), so the prior means the same on any series. Normal-Gamma prior: mean 0 with
 * little weight (kappa 0.05, so a shift in level is believed quickly), noise variance about 1 (alpha 3,
 * beta 2). `runLength[t][r]` is the posterior that the current run is r points long after point t. Pure.
 */
export function bocpd(values: number[], opts: { hazard?: number; maxRun?: number } = {}): Bocpd {
  const H = opts.hazard ?? 1 / 52, maxRun = opts.maxRun ?? 260;
  const raw = values.map(toLog);
  const diffs = raw.slice(1).map((v, i) => v - raw[i]);
  const scale = Math.max(diffs.length >= 3 ? (1.4826 * mad(diffs)) / Math.SQRT2 : 0, 0.05);
  const center = med(raw.slice(0, Math.min(raw.length, 8)));
  const x = raw.map((v) => (v - center) / scale);
  const mu0 = 0, k0 = 0.05, a0 = 3, b0 = 2;
  let mu = [mu0], kappa = [k0], alpha = [a0], beta = [b0];
  let R = [1];
  const runLength: number[][] = [];
  for (const xt of x) {
    const pred = R.map((_, r) => Math.exp(studentLogPdf(xt, 2 * alpha[r], mu[r], (beta[r] * (kappa[r] + 1)) / (alpha[r] * kappa[r]))));
    const growth = R.map((p, r) => p * pred[r] * (1 - H));
    const cp = R.reduce((s, p, r) => s + p * pred[r] * H, 0);
    let next = [cp, ...growth];
    const z = next.reduce((a, b) => a + b, 0) || 1;
    next = next.map((v) => v / z);
    // Posterior parameters: a fresh run starts from the prior; each run absorbs the point.
    const nmu = [mu0], nk = [k0], na = [a0], nb = [b0];
    for (let r = 0; r < R.length; r++) {
      nmu.push((kappa[r] * mu[r] + xt) / (kappa[r] + 1));
      nk.push(kappa[r] + 1);
      na.push(alpha[r] + 0.5);
      nb.push(beta[r] + (kappa[r] * (xt - mu[r]) ** 2) / (2 * (kappa[r] + 1)));
    }
    if (next.length > maxRun) { const tail = next.slice(maxRun - 1).reduce((a, b) => a + b, 0); next = [...next.slice(0, maxRun - 1), tail]; nmu.length = nk.length = na.length = nb.length = maxRun; }
    R = next; mu = nmu; kappa = nk; alpha = na; beta = nb;
    runLength.push(R);
  }
  // Index r of a run is how many points it has absorbed: index 1 is a run whose first point is this one,
  // index j + 1 one that began j points ago, and index 0 the run that starts after this point (its mass is
  // always the hazard). So "a change point in the last k points" is the mass on indices 0 to k. Before
  // k + 1 points every run is that short, so there is no evidence yet and the answer is 0.
  const changeProb = (k: number, at = runLength.length - 1) => {
    const r = runLength[at];
    if (!r || at < k + 1) return 0;
    return Math.min(1, r.slice(0, k + 1).reduce((a, b) => a + b, 0));
  };
  return { runLength, changeProb, scale };
}

/* ---------------- Placebo false-alarm rate ---------------- */

/** A copy of the series with blocks of `block` points in a random order (seeded). Pure. */
export function blockShuffle(values: number[], block: number, seed: number): number[] {
  const blocks: number[][] = [];
  for (let i = 0; i < values.length; i += block) blocks.push(values.slice(i, i + block));
  const u = rng(seed);
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  return blocks.flat();
}

/**
 * Alarms an online detector raises over a series, counting one alarm per `cooldown` points (a change that
 * lights up three weeks in a row is one alarm). The detector sees only the points up to each week. Pure.
 */
export function alarmsOver(values: number[], threshold: number, opts: { k?: number; burnIn?: number; cooldown?: number } = {}): number {
  const k = opts.k ?? 6, burn = opts.burnIn ?? 12, cool = opts.cooldown ?? 6;
  const run = bocpd(values);
  let alarms = 0, last = -Infinity;
  for (let t = burn; t < values.length; t++) {
    if (t - last < cool) continue;
    if (run.changeProb(k, t) >= threshold) { alarms++; last = t; }
  }
  return alarms;
}

/**
 * False alarms per company-year: the detector run online over `copies` block-shuffled copies of a reference
 * history (weekly points). Returns the rate and how many company-years it rests on. Pure.
 */
export function placeboRate(history: number[], opts: { threshold?: number; copies?: number; block?: number; seed?: number; k?: number } = {}): { perYear: number; years: number; alarms: number } {
  const threshold = opts.threshold ?? 0.9, copies = opts.copies ?? 20, block = opts.block ?? 4, burn = 12;
  if (history.length < burn + 8) return { perYear: NaN, years: 0, alarms: 0 };
  let alarms = 0;
  for (let c = 0; c < copies; c++) alarms += alarmsOver(blockShuffle(history, block, (opts.seed ?? 11) + c * 7919), threshold, { k: opts.k, burnIn: burn });
  const years = (copies * (history.length - burn)) / 52;
  return { perYear: alarms / years, years, alarms };
}

/** "About one false alarm every 4 company-years on this kind of series", from a rate per company-year. Pure. */
export function falseAlarmSentence(perYear: number, family = "this kind of series"): string {
  if (!Number.isFinite(perYear)) return `The detector's false-alarm rate on ${family} is not measured yet.`;
  if (perYear <= 0) return `In placebo runs on ${family} the detector raised no false alarms at this threshold (a rate under the run's resolution, not zero).`;
  const every = 1 / perYear;
  if (every >= 1.5) return `At this threshold the detector raises about one false alarm every ${every >= 10 ? Math.round(every) : Math.round(every * 2) / 2} company-years on ${family}.`;
  return `At this threshold the detector raises about ${Math.round(perYear * 10) / 10} false alarms per company-year on ${family}.`;
}

export type Verdict = {
  /** Posterior probability of a change point in the last `k` weeks (by default the six weeks the move is measured over). */
  prob: number;
  /** Robust z of the latest point (log scale; the seasonal residual's when seasonality earns its place). */
  z: number;
  /** The latest value against the value `lookback` weeks earlier, as a fraction (0.6 is up 60%). */
  move: number;
  seasonal: boolean;
  alarm: boolean;
};

/**
 * The verdict on a weekly series' latest point: change probability, robust z, the move over `lookback`
 * weeks, and whether it is an alarm (probability at or above the threshold and the move outside
 * [down, up]). Pure.
 */
export function changeVerdict(values: number[], opts: { k?: number; threshold?: number; lookback?: number; up?: number; down?: number } = {}): Verdict {
  const lookback = opts.lookback ?? 6, k = opts.k ?? lookback, threshold = opts.threshold ?? 0.9;
  const n = values.length;
  if (n < 12) return { prob: 0, z: NaN, move: NaN, seasonal: false, alarm: false };
  const seasonal = seasonalBeats(values);
  const z = seasonal ? (() => { const r = seasonalNaive(values).filter((v) => Number.isFinite(v)); const last = r[r.length - 1]; const hist = r.slice(-27, -1); return hist.length >= 8 ? (last - med(hist)) / Math.max(1.4826 * mad(hist), 0.05) : NaN; })() : robustZ(values)[n - 1];
  const prob = bocpd(values).changeProb(k);
  const before = values[Math.max(0, n - 1 - lookback)];
  const move = before > 0 ? values[n - 1] / before - 1 : values[n - 1] > 0 ? Infinity : 0;
  const big = move >= (opts.up ?? 0.6) || move <= -(opts.down ?? 0.4);
  return { prob, z, move, seasonal, alarm: prob >= threshold && big };
}
