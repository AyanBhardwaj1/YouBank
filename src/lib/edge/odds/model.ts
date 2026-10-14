/**
 * The Deal Radar's model in TypeScript (E4): the evaluation, the calibration and the explanations every
 * version gets, and the logistic hazard model used when the ML service (LightGBM, odds.train) is not set up.
 *
 * - Validation is rolling-origin by year with an embargo of one horizon: to test year Y, a model learns
 *   only from months whose 12-month window had closed by the start of Y (t before Y-1), so no label it
 *   trains on overlaps the test year.
 * - Baselines on the same splits: the base rate (the training share of sales), and a Palepu-style logit
 *   on the classic takeover features (size, growth, profitability, leverage, liquidity, mismatch, wave).
 *   The scorecard says plainly whether the model beats each, with bootstrap 90% intervals.
 * - Calibration is inductive Venn-Abers on the most recent fully labelled year: a model fitted on the years
 *   before it (the proper training set) scores that year (the calibration set); a company's probability is
 *   the Venn-Abers point estimate with its [low, high] interval ("14% (11-18%)").
 * - Reasons are the model's own contributions (a logistic model's terms; LightGBM's TreeSHAP on the ML
 *   service), each linked to its filing; "what would move it" re-scores the company with one feature changed.
 * Pure.
 */
import { auroc, bootstrapCi, brier, isotonicAt, isotonicFit, logisticAt, logisticContrib, logisticFit, prAuc, reliabilityBins, topLift, vennAbers, vennAbersSet, type Bin, type Isotonic, type Logistic, type VennAbersSet } from "../calib";
import { rng } from "../scen/stats";
import { FEATURE, FEATURE_KEYS } from "./features";
import { sectorOf, type PanelRow } from "./labels";

export const HORIZON = 12;
/** The classic features the Palepu-style baseline uses. */
export const PALEPU = ["logAssets", "revGrowth", "roa", "leverage", "cashRatio", "mismatch", "wave"];

const yearOf = (t: string) => Number(t.slice(0, 4));
/** Rows a model testing year Y may learn from: labelled, with their window closed before Y begins. Pure. */
export const trainFor = (rows: PanelRow[], testYear: number) => rows.filter((r) => r.y !== null && r.t < `${testYear - 1}-01-01`);
export const testFor = (rows: PanelRow[], testYear: number) => rows.filter((r) => r.y !== null && yearOf(r.t) === testYear);

/** All positives and a seeded share of negatives, weighted back up, so a fit stays quick on a large panel. Pure. */
export function sample(rows: PanelRow[], negShare: number, seed = 3): { rows: PanelRow[]; w: number[] } {
  const u = rng(seed);
  const out: PanelRow[] = [], w: number[] = [];
  for (const r of rows) { if (r.y === 1) { out.push(r); w.push(1); } else if (u() < negShare) { out.push(r); w.push(1 / negShare); } }
  return { rows: out, w };
}

const cols = (keys: string[]) => keys.map((k) => FEATURE_KEYS.indexOf(k));
const pick = (x: number[], idx: number[]) => idx.map((i) => x[i]);

/** A logistic model on some features, from training rows (negatives sampled to at most `maxRows`). Pure. */
export function fitLogit(rows: PanelRow[], keys: string[] = FEATURE_KEYS, opts: { maxRows?: number; l2?: number } = {}): Logistic {
  const pos = rows.filter((r) => r.y === 1).length, neg = rows.length - pos;
  const share = Math.min(1, Math.max(0.02, ((opts.maxRows ?? 30_000) - pos) / Math.max(1, neg)));
  const s = sample(rows, share);
  const idx = cols(keys);
  return logisticFit(s.rows.map((r) => pick(r.x, idx)), s.rows.map((r) => r.y ?? 0), keys, { l2: opts.l2 ?? 2, iters: 25, weights: s.w });
}

export const scoreLogit = (m: Logistic, x: number[]) => logisticAt(m, pick(x, cols(m.features)));

export type Metric = { value: number | null; ci: [number, number] | null };
export type Scorecard = {
  model: { auroc: Metric; prAuc: Metric; brier: Metric; skill: Metric; lift: { rate: number; base: number; lift: number; n: number; ci: [number, number] | null } };
  palepu: { auroc: Metric; skill: Metric }; base: { brier: number | null };
  years: number[]; n: number; positives: number; bins: Bin[]; beats: { palepu: boolean | null; base: boolean | null }; text: string;
};

const m = (v: number) => (Number.isFinite(v) ? v : null);
/** Bootstrap draws for the scorecard's intervals: 150 is enough for a 90% percentile interval and keeps a large panel's scorecard inside one job step. */
let DRAWS = 150;
const ci = (stat: (p: number[], y: number[]) => number, p: number[], y: number[]): [number, number] | null => { const r = bootstrapCi(stat, p, y, { draws: DRAWS, seed: 17 }); return Number.isFinite(r[0]) ? r : null; };
const skillOf = (p: number[], y: number[], b: number[]) => { const bb = brier(b, y); return bb > 0 ? 1 - brier(p, y) / bb : NaN; };

/**
 * The out-of-time record from rolling origins: each test year predicted by models that never saw it,
 * pooled, with bootstrap intervals; the baselines scored on the same rows. `predict` is the model under
 * test (fitted on the year's training rows). Pure.
 */
export function rollingScorecard(rows: PanelRow[], predict: (train: PanelRow[]) => (x: number[]) => number, opts: { minPositives?: number; draws?: number } = {}): Scorecard {
  DRAWS = opts.draws ?? 150;
  const years = [...new Set(rows.filter((r) => r.y !== null).map((r) => yearOf(r.t)))].sort();
  const P: number[] = [], Y: number[] = [], B: number[] = [], L: number[] = [];
  const used: number[] = [];
  for (const yr of years) {
    const train = trainFor(rows, yr), test = testFor(rows, yr);
    if (train.filter((r) => r.y === 1).length < (opts.minPositives ?? 20) || !test.length) continue;
    used.push(yr);
    const f = predict(train), palepu = fitLogit(train, PALEPU);
    const base = train.filter((r) => r.y === 1).length / train.length;
    for (const r of test) { P.push(f(r.x)); Y.push(r.y!); B.push(base); L.push(scoreLogit(palepu, r.x)); }
  }
  const n = Y.length, positives = Y.filter((v) => v === 1).length;
  const lift = n ? topLift(P, Y, 0.01) : { rate: NaN, base: NaN, lift: NaN, n: 0 };
  // The base rate the bootstrap compares against: computed once (resampling it per case is quadratic).
  const meanB = B.length ? B.reduce((a, b) => a + b, 0) / B.length : NaN;
  const card: Scorecard = {
    model: {
      auroc: { value: m(auroc(P, Y)), ci: n ? ci(auroc, P, Y) : null }, prAuc: { value: m(prAuc(P, Y)), ci: n ? ci(prAuc, P, Y) : null },
      brier: { value: n ? brier(P, Y) : null, ci: n ? ci(brier, P, Y) : null }, skill: { value: m(skillOf(P, Y, B)), ci: n ? ci((p, y) => skillOf(p, y, new Array<number>(y.length).fill(meanB)), P, Y) : null },
      lift: { ...lift, ci: n ? ci((p, y) => topLift(p, y, 0.01).rate, P, Y) : null },
    },
    palepu: { auroc: { value: m(auroc(L, Y)), ci: n ? ci(auroc, L, Y) : null }, skill: { value: m(skillOf(L, Y, B)), ci: null } },
    base: { brier: n ? brier(B, Y) : null }, years: used, n, positives, bins: n ? reliabilityBins(P, Y) : [],
    beats: { palepu: null, base: null }, text: "",
  };
  const a = card.model.auroc, p = card.palepu.auroc.value;
  card.beats.palepu = a.ci && p !== null ? a.ci[0] > p : null;
  card.beats.base = card.model.skill.ci ? card.model.skill.ci[0] > 0 : null;
  card.text = scorecardText(card);
  return card;
}

const pc = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(dp)}%`);
const f2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(2));

/** The scorecard in words, honest about what the model does and does not beat. Pure. */
export function scorecardText(c: Scorecard): string {
  if (!c.n) return "Not backtested yet: too few labelled years.";
  const span = `${c.years[0]}-${c.years[c.years.length - 1]}`;
  const out = [`Out of time ${span} (${c.n.toLocaleString("en-US")} company-months, ${c.positives} sales): AUROC ${f2(c.model.auroc.value)}${c.model.auroc.ci ? ` (90% interval ${f2(c.model.auroc.ci[0])} to ${f2(c.model.auroc.ci[1])})` : ""} against ${f2(c.palepu.auroc.value)} for a Palepu-style logit and 0.50 for the base rate.`];
  out.push(`Brier skill against the base rate ${pc(c.model.skill.value, 1)}${c.model.skill.ci ? ` (${pc(c.model.skill.ci[0], 1)} to ${pc(c.model.skill.ci[1], 1)})` : ""}.`);
  if (Number.isFinite(c.model.lift.rate)) out.push(`Of companies in the model's top 1% a year ahead, ${pc(c.model.lift.rate, 1)} announced a sale within 12 months, against a ${pc(c.model.lift.base, 1)} base rate.`);
  out.push(c.beats.palepu === true ? "It beats the Palepu-style logit by more than its interval." : c.beats.palepu === false ? "It does not beat the Palepu-style logit by more than its interval." : "");
  out.push(c.beats.base === true ? "It beats stating the base rate." : c.beats.base === false ? "It does not beat stating the base rate by more than its interval." : "");
  return out.filter(Boolean).join(" ");
}

export type Calibration = { iso: Isotonic; va: VennAbersSet; year: number; n: number; positives: number };

/**
 * Inductive calibration on the latest labelled year from the proper training model's scores. A large year is
 * subsampled uniformly (seeded) to `max` cases: keeping every positive would change the base rate the
 * calibration learns and push every probability up. Pure.
 */
export function calibrate(scores: number[], labels: number[], year: number, max = 8000): Calibration {
  let s = scores, y = labels;
  if (s.length > max) {
    const u = rng(23), idx = s.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const keep = idx.slice(0, max);
    s = keep.map((i) => scores[i]); y = keep.map((i) => labels[i]);
  }
  return { iso: isotonicFit(s, y), va: vennAbersSet(s, y), year, n: s.length, positives: y.filter((v) => v === 1).length };
}

/** A raw score as a calibrated probability with its Venn-Abers interval. Pure. */
export function calibrated(c: Calibration, raw: number, interval = true): { p: number; low: number | null; high: number | null } {
  if (!interval) return { p: isotonicAt(c.iso, raw), low: null, high: null };
  const v = vennAbers(c.va, raw);
  return { p: Number.isFinite(v.p) ? v.p : isotonicAt(c.iso, raw), low: v.low, high: v.high };
}

/** Each sector's share of company-months followed by a sale, over the last `years` labelled years. Pure. */
export function sectorRates(rows: PanelRow[], years = 5): Record<string, number> {
  const lab = rows.filter((r) => r.y !== null);
  const last = Math.max(...lab.map((r) => yearOf(r.t)));
  const by: Record<string, { n: number; k: number }> = {};
  for (const r of lab.filter((x) => yearOf(x.t) > last - years)) { const s = sectorOf(r.sic); by[s] ??= { n: 0, k: 0 }; by[s].n++; if (r.y === 1) by[s].k++; }
  return Object.fromEntries(Object.entries(by).map(([s, v]) => [s, v.n ? v.k / v.n : 0]));
}

/** Per feature, the training rows' 25th and 75th percentiles (for "what would move it"). Pure. */
export function quantiles(rows: PanelRow[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  FEATURE_KEYS.forEach((k, j) => {
    const v = rows.map((r) => r.x[j]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length) out[k] = [v[Math.floor(v.length * 0.25)], v[Math.floor(v.length * 0.75)]];
  });
  return out;
}

export type Reason = { key: string; label: string; direction: "up" | "down"; contrib: number };
export type Move = { key: string; label: string; to: number };

/** The top reasons (by absolute contribution to the log odds), in words with their direction. Pure. */
export function reasonsOf(contribs: { feature: string; contrib: number; value: number }[], top = 3): Reason[] {
  return contribs.filter((c) => Number.isFinite(c.contrib) && Math.abs(c.contrib) > 1e-6).sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, top)
    .map((c) => ({ key: c.feature, label: c.contrib > 0 ? FEATURE[c.feature]?.up ?? c.feature : FEATURE[c.feature]?.down ?? c.feature, direction: c.contrib > 0 ? "up" : "down", contrib: Math.round(c.contrib * 1000) / 1000 }));
}

const BINARY = new Set(["mismatch", "switch13g", "proxyFight", "lateFiling"]);
const COUNTS = new Set(["sc13d", "sc13dA", "officerChange", "rightsPlan", "bylaws"]);

/**
 * What would move it: the company re-scored with one feature changed to a plausible value (an event that
 * has not happened happening, a continuous feature at the other quartile), the three largest changes. Pure.
 */
export function movesOf(x: number[], score: (x: number[]) => number, q: Record<string, [number, number]>, top = 3): Move[] {
  const p0 = score(x);
  const out: (Move & { d: number })[] = [];
  FEATURE_KEYS.forEach((k, j) => {
    let alt: number | null = null;
    if (BINARY.has(k)) alt = x[j] >= 1 ? 0 : 1;
    else if (COUNTS.has(k)) alt = x[j] >= 1 ? 0 : 1;
    else if (q[k] && Number.isFinite(x[j])) alt = x[j] <= (q[k][0] + q[k][1]) / 2 ? q[k][1] : q[k][0];
    if (alt === null || alt === x[j]) return;
    const y = [...x]; y[j] = alt;
    const p = score(y);
    const def = FEATURE[k];
    out.push({ key: k, label: alt > (Number.isFinite(x[j]) ? x[j] : 0) ? def.up : def.down, to: p, d: Math.abs(p - p0) });
  });
  return out.sort((a, b) => b.d - a.d).slice(0, top).map(({ key, label, to }) => ({ key, label, to: Math.round(to * 1000) / 1000 }));
}

export type TsModel = { kind: "logit"; logit: Logistic; calibration: Calibration; quantiles: Record<string, [number, number]>; sectorRates: Record<string, number>; scorecard: Scorecard; version: string; trainedThrough: string };

/**
 * Train the TypeScript model end to end: the scorecard from rolling origins, the proper training model on
 * months before the calibration year, its calibration on that year, sector base rates and quantiles. Pure.
 */
export function trainTs(rows: PanelRow[], version: string, opts: { draws?: number } = {}): TsModel | { error: string } {
  const labelled = rows.filter((r) => r.y !== null);
  if (labelled.filter((r) => r.y === 1).length < 40) return { error: `Only ${labelled.filter((r) => r.y === 1).length} sales in the panel; the model needs at least 40.` };
  const calYear = Math.max(...labelled.map((r) => yearOf(r.t)));
  const proper = trainFor(rows, calYear), calib = testFor(rows, calYear);
  if (!calib.some((r) => r.y === 1)) return { error: `No sales in ${calYear}, the calibration year.` };
  const logit = fitLogit(proper);
  const calibration = calibrate(calib.map((r) => scoreLogit(logit, r.x)), calib.map((r) => r.y!), calYear);
  const scorecard = rollingScorecard(rows, (train) => { const mdl = fitLogit(train); return (x) => scoreLogit(mdl, x); }, { draws: opts.draws });
  return { kind: "logit", logit, calibration, quantiles: quantiles(proper), sectorRates: sectorRates(rows), scorecard, version, trainedThrough: `${calYear - 2}-12` };
}

/** One company's odds from the TypeScript model: probability, interval, reasons and what would move it. Pure. */
export function scoreTs(model: TsModel, x: number[]): { p: number; low: number | null; high: number | null; reasons: Reason[]; contribs: Reason[]; moves: Move[] } {
  const raw = scoreLogit(model.logit, x);
  const c = calibrated(model.calibration, raw);
  const contribs = reasonsOf(logisticContrib(model.logit, model.logit.features.map((k) => x[FEATURE_KEYS.indexOf(k)])), 8);
  const moves = movesOf(x, (y) => calibrated(model.calibration, scoreLogit(model.logit, y), false).p, model.quantiles);
  return { ...c, reasons: contribs.slice(0, 3), contribs, moves };
}

/** The calibration note shown beside every probability. Pure. */
export function calibrationNote(c: { year: number; n: number; positives: number }): string {
  return `Calibrated with Venn-Abers on ${c.n.toLocaleString("en-US")} company-months from ${c.year} (${c.positives} sales) that the model did not learn from; the interval is where a calibrated probability lies.`;
}

export const DISCLAIMER = "A model probability from public filings, not a rumour, a prediction that a sale will happen, or investment advice.";
