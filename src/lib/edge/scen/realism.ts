/**
 * Realism, second version: the stylised facts of real returns, each measured on the real days and on
 * synthetic paths of the same length, and judged against a band from a block bootstrap of the real days
 * (how far the fact itself wanders over a sample this long) rather than a fixed threshold. The bootstrap
 * gives the band's width; the real value gives its centre (blocks cut long-memory facts short, so the
 * bootstrap's own centre runs low). A copy check makes sure the generator is not replaying history. Pure.
 */
import { autocorr, kurtosis, mean, pseudoObs, quantileSorted, rng, std } from "./stats";

export type Check = {
  key: string; label: string; note: string; unit: "pct" | "num" | "ratio" | "share";
  real: number; lo: number; hi: number; synthetic: number; pass: boolean; credit: number;
  curve?: { x: number[]; real: number[]; lo: number[]; hi: number[]; synthetic: number[] };
};
export type Stylised = { score: number; checks: Check[]; warnings: string[]; resamples: number; block: number; days: number; paths: number };

const LAGS = 20, LEV = 10, HORIZONS = [1, 5, 10, 20], TAIL = 0.05;
export type Facts = { vol: number; corr: number; acf: number[]; lev: number; tail: number; kurt: number[]; ltd: number; esvar: number };

/** The facts of one sample of daily returns (days by assets), each averaged over the assets (or their pairs). */
export function facts(X: number[][]): Facts {
  const T = X.length, N = X[0]?.length ?? 0;
  const cols = Array.from({ length: N }, (_, j) => X.map((r) => r[j]));
  const abs = cols.map((c) => c.map(Math.abs));
  const acf = Array.from({ length: LAGS }, (_, k) => mean(abs.map((a) => autocorr(a, k + 1))));
  // Leverage: today's move against the size of each of the next ten days' moves.
  const lev = mean(cols.map((c, j) => {
    const a = abs[j], mc = mean(c), ma = mean(a), sc = std(c) || 1, sa = std(a) || 1;
    let s = 0;
    for (let k = 1; k <= LEV; k++) { let acc = 0; for (let t = 0; t + k < T; t++) acc += (c[t] - mc) * (a[t + k] - ma); s += acc / (Math.max(1, T - k) * sc * sa); }
    return s / LEV;
  }));
  const sorted = cols.map((c) => { const m = mean(c); return c.map((v) => v - m).sort((p, q) => p - q); });
  const k = Math.max(1, Math.floor(TAIL * T));
  const tail = mean(sorted.map((s) => { const lo = -mean(s.slice(0, k)), hi = mean(s.slice(-k)); return hi > 0 ? lo / hi : 1; }));
  const kurt = HORIZONS.map((h) => mean(cols.map((c) => { const sums: number[] = []; let acc = 0; for (let t = 0; t < c.length; t++) { acc += c[t]; if (t >= h) acc -= c[t - h]; if (t >= h - 1) sums.push(acc); } return kurtosis(sums); })));
  const esvar = mean(sorted.map((s) => { const losses = s.map((v) => -v).reverse(), v = quantileSorted(losses, 0.975), tailL = losses.filter((x) => x >= v); return v > 0 && tailL.length ? mean(tailL) / v : 1; }));
  let corr = 0, ltd = 0, pairs = 0;
  if (N > 1) {
    const u = cols.map(pseudoObs), sd = cols.map(std), mc = cols.map(mean);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      let c = 0, both = 0, one = 0;
      for (let t = 0; t < T; t++) { c += (cols[i][t] - mc[i]) * (cols[j][t] - mc[j]); if (u[i][t] <= TAIL) { one++; if (u[j][t] <= TAIL) both++; } }
      corr += sd[i] && sd[j] ? c / ((T - 1) * sd[i] * sd[j]) : 0; ltd += one ? both / one : 0; pairs++;
    }
  }
  return { vol: mean(cols.map(std)), corr: pairs ? corr / pairs : 0, acf, lev, tail, kurt, ltd: pairs ? ltd / pairs : 0, esvar };
}

/** Day indices of a stationary block bootstrap (Politis and Romano): runs of average length `block`, wrapping round. */
export function stationaryIndex(T: number, block: number, u: () => number): number[] {
  const out = new Array<number>(T);
  let at = Math.floor(u() * T);
  for (let t = 0; t < T; t++) { if (t > 0) at = u() < 1 / block ? Math.floor(u() * T) : (at + 1) % T; out[t] = at; }
  return out;
}

/**
 * Whether the generator replays history: each synthetic window of `w` days (all assets, in units of each
 * asset's real volatility, then scaled to unit size, so calm windows are not near everything calm) against
 * its nearest real window, compared with how near real windows come to each other (at least `w` days
 * apart). About 1 in 20 synthetic windows lands closer than the real windows' own 5th percentile by
 * chance; many more means copying.
 */
export function copyCheck(real: number[][], paths: number[][][], w = 20, maxWindows = 400): { share: number; exact: number; ratio: number; windows: number; threshold: number } {
  const T = real.length, N = real[0]?.length ?? 0;
  if (T < 3 * w || !N) return { share: 0, exact: 0, ratio: 1, windows: 0, threshold: 0 };
  const sd = Array.from({ length: N }, (_, j) => std(real.map((r) => r[j])) || 1);
  const starts = T - w + 1, len = w * N;
  // Every window as a vector of unit size (overlapping real windows each get their own copy).
  const unit = (a: Float64Array) => { let s = 0; for (const v of a) s += v * v; const k = s > 0 ? Math.sqrt(len / s) : 1; for (let i = 0; i < a.length; i++) a[i] *= k; return a; };
  const R = new Float64Array(starts * len);
  for (let s = 0; s < starts; s++) { const a = new Float64Array(len); for (let d = 0; d < w; d++) for (let j = 0; j < N; j++) a[d * N + j] = real[s + d][j] / sd[j]; R.set(unit(a), s * len); }
  // The nearest real window to a vector `a` (stopping each sum once it passes the best so far), skipping starts within `skip` days of `self`.
  const nearest = (a: Float64Array, off: number, self = -1, skip = 0) => {
    let best = Infinity;
    for (let s = 0; s < starts; s++) {
      if (self >= 0 && Math.abs(s - self) < skip) continue;
      let d = 0;
      const base = s * len;
      for (let i = 0; i < len && d < best; i++) { const x = a[off + i] - R[base + i]; d += x * x; }
      if (d < best) best = d;
    }
    return Math.sqrt(best / len);
  };
  const own: number[] = [];
  for (let s = 0; s < starts; s += 5) own.push(nearest(R, s * len, s, w));
  own.sort((p, q) => p - q);
  const threshold = quantileSorted(own, 0.05), med = quantileSorted(own, 0.5);
  const wins: Float64Array[] = [];
  for (const p of paths) for (let s = 0; s + w <= p.length; s += w) { const a = new Float64Array(len); for (let d = 0; d < w; d++) for (let j = 0; j < N; j++) a[d * N + j] = p[s + d][j] / sd[j]; wins.push(unit(a)); }
  const pick = wins.length > maxWindows ? Array.from({ length: maxWindows }, (_, i) => wins[Math.floor((i * wins.length) / maxWindows)]) : wins;
  const ds = pick.map((a) => nearest(a, 0)).sort((p, q) => p - q);
  return { share: ds.filter((d) => d < threshold).length / (ds.length || 1), exact: ds.filter((d) => d < 1e-9).length / (ds.length || 1), ratio: med > 0 ? quantileSorted(ds, 0.5) / med : 1, windows: ds.length, threshold };
}

const credit = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? 1 : Math.max(0, 1 - (v < lo ? lo - v : v - hi) / Math.max(hi - lo, 1e-9)));
const fmt = (v: number, unit: Check["unit"]) => (unit === "pct" || unit === "share" ? `${(v * 100).toFixed(unit === "pct" ? 2 : 0)}%` : unit === "ratio" ? `${v.toFixed(2)}×` : v.toFixed(2));

/**
 * Score synthetic paths (each a run of days by assets, ideally as long as the real sample) against the
 * real days: each fact's synthetic value is its median over the paths, judged against the real value's
 * bootstrap band. Inside the band earns full credit, a band's width outside earns none; the score is the
 * average credit out of 100.
 */
export function stylisedRealism(names: string[], real: number[][], paths: number[][][], opts: { seed?: number; resamples?: number; block?: number } = {}): Stylised {
  const T = real.length, N = names.length, B = opts.resamples ?? 200, block = opts.block ?? 40;
  const u = rng((opts.seed ?? 1) + 7919);
  // Short generated paths (the diffusion model's windows) are joined end to end to about the real length.
  const runs: number[][][] = [];
  for (let cur: number[][] = [], i = 0; i < paths.length; i++) { cur = cur.concat(paths[i]); if (cur.length >= Math.min(T, 750) || i === paths.length - 1) { if (cur.length > 2 * LAGS + 5) runs.push(cur); cur = []; } }
  const fr = facts(real), boot = Array.from({ length: B }, () => facts(stationaryIndex(T, block, u).map((t) => real[t]))), syn = runs.map(facts);
  const med = (xs: number[]) => quantileSorted([...xs].sort((p, q) => p - q), 0.5);
  const band = (realV: number, xs: number[]) => { const s = [...xs].sort((p, q) => p - q), c = quantileSorted(s, 0.5); return [realV + quantileSorted(s, 0.025) - c, realV + quantileSorted(s, 0.975) - c] as const; };
  const checks: Check[] = [];
  const scalar = (key: keyof Facts, label: string, unit: Check["unit"], note: string) => {
    const pick = (f: Facts) => f[key] as number, real0 = pick(fr), [lo, hi] = band(real0, boot.map(pick)), s = med(syn.map(pick)), c = credit(s, lo, hi);
    checks.push({ key, label, note, unit, real: real0, lo, hi, synthetic: s, pass: c === 1, credit: c });
  };
  const curve = (key: "acf" | "kurt", label: string, x: number[], main: (v: number[]) => number, note: string) => {
    const pts = x.map((_, i) => { const pick = (f: Facts) => f[key][i], [lo, hi] = band(pick(fr), boot.map(pick)); return { real: pick(fr), lo, hi, synthetic: med(syn.map(pick)) }; });
    const credits = pts.map((p) => credit(p.synthetic, p.lo, p.hi)), mainOf = (f: Facts) => main(f[key]), [lo, hi] = band(mainOf(fr), boot.map(mainOf));
    checks.push({ key, label, note, unit: "num", real: mainOf(fr), lo, hi, synthetic: med(syn.map(mainOf)), pass: credits.filter((c) => c === 1).length >= 0.8 * credits.length, credit: mean(credits), curve: { x, real: pts.map((p) => p.real), lo: pts.map((p) => p.lo), hi: pts.map((p) => p.hi), synthetic: pts.map((p) => p.synthetic) } });
  };
  scalar("vol", "Volatility", "pct", "The assets' average daily volatility.");
  if (N > 1) scalar("corr", "Correlation", "num", "The average correlation between the assets' daily moves.");
  curve("acf", "Volatility clustering", Array.from({ length: LAGS }, (_, i) => i + 1), mean, "Autocorrelation of the size of daily moves at lags 1 to 20 (the figure is their average): calm and wild spells persist.");
  scalar("lev", "Leverage effect", "num", "Today's move against the size of the next ten days' moves: falls raise volatility more than rises, so it is negative in real markets.");
  scalar("tail", "Tail asymmetry", "ratio", "The average of the worst 5% of days over that of the best 5%: above 1 when losses run larger than gains.");
  curve("kurt", "Fat tails fade with horizon", HORIZONS, (v) => v[v.length - 1], "Excess kurtosis of 1-, 5-, 10- and 20-day returns (the figure is the 20-day one): fat day to day, thinner over weeks.");
  if (N > 1) scalar("ltd", "Joint crashes", "share", "How often one asset's worst 5% of days are also another's (lower-tail dependence).");
  scalar("esvar", "Beyond value at risk", "ratio", "Expected shortfall over value at risk at 97.5%: how much worse the average bad day is than the threshold.");
  // Windows that only look alike (a model with fewer spiky days than history) can run a little over 5%, so up to three times chance passes; replayed history runs far higher.
  const cc = copyCheck(real, paths), cCopy = cc.windows ? credit(cc.share, 0, 0.15) : 1;
  checks.push({ key: "copy", label: "Copies of history", unit: "share", real: 0.05, lo: 0, hi: 0.15, synthetic: cc.share, pass: cCopy === 1, credit: cCopy, note: `Synthetic 20-day windows closer to a real window than real windows come to each other: about 5% by chance, up to 15% passes; far more means history is being replayed. Their typical distance to the nearest real window is ${cc.ratio.toFixed(2)} of the real windows' own.${cc.exact ? ` ${Math.round(cc.exact * 100)}% are exact copies.` : ""}` });
  const warnings = checks.filter((c) => !c.pass).map((c) => `${c.label}: synthetic ${fmt(c.synthetic, c.unit)}, outside the real data's band of ${fmt(c.lo, c.unit)} to ${fmt(c.hi, c.unit)}.`);
  return { score: Math.round(100 * mean(checks.map((c) => c.credit))), checks, warnings, resamples: B, block, days: T, paths: runs.length };
}
