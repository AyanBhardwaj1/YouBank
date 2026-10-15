/**
 * QF4: YouBank's own factors, built from the point-in-time store (prices and SEC fundamentals as known then),
 * so they are current, documented and reproducible. Pure: stocks in, factor returns, exposures and specific
 * risk out (build.ts gathers the inputs and stores the outputs).
 *
 * Characteristics at each monthly rebalance (the last session of a month), each from data public by then:
 *   size  log market value (shares outstanding as known x close)
 *   bm    book-to-market (stockholders' equity as known / market value); ep earnings yield (TTM net income / value)
 *   mom   return from t-12 to t-1 months; rev  last month's return (short-term reversal)
 *   gpa   gross profit over assets (Novy-Marx 2013); inv  asset growth over a year
 *   vol   252-day volatility; beta  252-day beta to the universe's value-weighted return
 * Construction: Fama-French style 2x3 sorts (size at the median, the characteristic at the 30th and 70th
 * percentiles), value-weighted with weights drifting with returns inside the month, rebalanced monthly (value
 * included, the monthly variant). Factor = ½(small high + big high) - ½(small low + big low), with the sign set
 * so the long side is the one the literature calls the premium (low volatility, low investment and the
 * reversal factor long the low side). SMB is the average of the three small minus the three big bm portfolios.
 * A cross-sectional risk model each day: r = f0 + Σ X·f + ε by weighted least squares with weights √(market
 * value), exposures standardised (value-weighted mean 0, standard deviation 1) and clipped at ±3; industry
 * dummies wait for a sector classification in the store (stated on the factor page).
 */
import { quantile } from "../stats/core";
import { wls } from "../stats/regress";
import { asOf, ttmAsOf, type PitFact } from "../pit/fundamentals";

export const ENGINE_VERSION = "yb-2026-10-15.1";

export type StockInput = {
  symbol: string;
  /** Dates of closes, sorted, and the closes (split-adjusted). */
  dates: string[]; close: number[];
  facts: { shares: PitFact[]; equity: PitFact[]; assets: PitFact[]; grossProfit: PitFact[]; netIncome: PitFact[] };
};

export type Chars = { symbol: string; mcap: number; size: number; bm: number | null; ep: number | null; mom: number | null; rev: number | null; gpa: number | null; inv: number | null; vol: number | null; beta: number | null };

export const FACTOR_KEYS = ["MKT", "SMB", "HML", "MOM", "RMW", "CMA", "LVOL", "STREV"] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];
/** Which characteristic each long-short factor sorts on, and whether the long side is the high or the low end. */
export const SORTS: { key: Exclude<FactorKey, "MKT" | "SMB">; char: keyof Chars; long: "high" | "low"; label: string }[] = [
  { key: "HML", char: "bm", long: "high", label: "Value (book-to-market)" },
  { key: "MOM", char: "mom", long: "high", label: "Momentum (12-1 months)" },
  { key: "RMW", char: "gpa", long: "high", label: "Profitability (gross profit / assets)" },
  { key: "CMA", char: "inv", long: "low", label: "Investment (low asset growth)" },
  { key: "LVOL", char: "vol", long: "low", label: "Low volatility" },
  { key: "STREV", char: "rev", long: "low", label: "Short-term reversal" },
];
export const MODEL_CHARS: (keyof Chars)[] = ["size", "bm", "ep", "mom", "rev", "gpa", "inv", "vol", "beta"];

const idxOnOrBefore = (dates: string[], d: string) => { let lo = 0, hi = dates.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

/** Month-end sessions present in a sorted list of dates. Pure. */
export function monthEnds(dates: string[]): string[] {
  return dates.filter((d, i) => i === dates.length - 1 || dates[i + 1].slice(0, 7) !== d.slice(0, 7));
}

/** Characteristics of one stock at a rebalance date, or null when it cannot be valued. Pure. */
export function characteristics(s: StockInput, at: string, market?: Map<string, number>): Chars | null {
  const i = idxOnOrBefore(s.dates, at);
  if (i < 0 || at.slice(0, 7) !== s.dates[i].slice(0, 7)) return null;
  const at16 = `${at}T21:00:00.000Z`; // after the close: data public by the end of the rebalance day
  const sh = asOf(s.facts.shares, at16, { days: null });
  if (!sh || !(sh.val > 0)) return null;
  const px = s.close[i];
  const mcap = sh.val * px;
  if (!(mcap > 0)) return null;
  const back = (k: number) => (i - k >= 0 ? s.close[i - k] : NaN);
  const eq = asOf(s.facts.equity, at16, { days: null });
  const ni = ttmAsOf(s.facts.netIncome, at16);
  const gp = ttmAsOf(s.facts.grossProfit, at16);
  const as = asOf(s.facts.assets, at16, { days: null });
  const asPrev = as ? s.facts.assets.filter((f) => f.knownAt <= at16 && f.days === null && Math.abs(Date.parse(f.end) - (Date.parse(as.end) - 365 * 86_400_000)) < 40 * 86_400_000).sort((a, b) => a.knownAt.localeCompare(b.knownAt)).at(-1) : null;
  const rets: number[] = [];
  for (let k = Math.max(1, i - 251); k <= i; k++) rets.push(s.close[k] / s.close[k - 1] - 1);
  const m = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const vol = rets.length >= 120 ? Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1) * 252) : null;
  let beta: number | null = null;
  if (market && rets.length >= 120) {
    const mi = market;
    const pairs: [number, number][] = [];
    for (let k = Math.max(1, i - 251); k <= i; k++) { const mr = mi.get(s.dates[k]); if (mr !== undefined) pairs.push([mr, s.close[k] / s.close[k - 1] - 1]); }
    if (pairs.length >= 120) { const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length, my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length; let sxy = 0, sxx = 0; for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; } beta = sxx > 0 ? sxy / sxx : null; }
  }
  return {
    symbol: s.symbol, mcap, size: Math.log(mcap),
    bm: eq && eq.val > 0 ? eq.val / mcap : null, ep: ni ? ni.value / mcap : null,
    mom: Number.isFinite(back(252)) && Number.isFinite(back(21)) && back(252) > 0 ? back(21) / back(252) - 1 : null,
    rev: Number.isFinite(back(21)) && back(21) > 0 ? px / back(21) - 1 : null,
    gpa: gp && as && as.val > 0 ? gp.value / as.val : null,
    inv: as && asPrev && asPrev.val > 0 ? as.val / asPrev.val - 1 : null,
    vol, beta,
  };
}

export type Portfolios = Record<string, string[]>;

/** The 2x3 sort on one characteristic: six lists of symbols (S/B by median size x L/M/H at the 30th and 70th percentiles). Pure. */
export function sort2x3(chars: Chars[], key: keyof Chars): Portfolios {
  const ok = chars.filter((c) => typeof c[key] === "number" && Number.isFinite(c[key] as number));
  const medSize = quantile(chars.map((c) => c.size), 0.5);
  const v = ok.map((c) => c[key] as number);
  const p30 = quantile(v, 0.3), p70 = quantile(v, 0.7);
  const out: Portfolios = { SL: [], SM: [], SH: [], BL: [], BM: [], BH: [] };
  for (const c of ok) {
    const sz = c.size <= medSize ? "S" : "B";
    const x = c[key] as number;
    out[`${sz}${x <= p30 ? "L" : x <= p70 ? "M" : "H"}`].push(c.symbol);
  }
  return out;
}

type Ret = Map<string, Map<string, number>>; // symbol -> date -> return

/** Value-weighted daily returns of a portfolio from start weights (market values), drifting with returns. Pure. */
export function vwReturns(members: string[], mcap: Map<string, number>, rets: Ret, dates: string[]): number[] {
  const w = new Map(members.map((s) => [s, mcap.get(s) ?? 0]));
  return dates.map((d) => {
    let tot = 0, acc = 0;
    for (const [s, x] of w) { if (!(x > 0)) continue; const r = rets.get(s)?.get(d) ?? 0; tot += x; acc += x * r; }
    for (const [s, x] of w) w.set(s, x * (1 + (rets.get(s)?.get(d) ?? 0)));
    return tot > 0 ? acc / tot : 0;
  });
}

export type FactorSeries = { dates: string[]; factors: Record<string, number[]>; counts: { date: string; universe: number; valued: number }[] };

/**
 * Factor returns over a span of sessions, rebalancing at each month end. `rets` holds every stock's daily
 * returns by date; `rf` the daily risk-free rate by date (missing = 0). Pure.
 */
export function factorReturns(stocks: StockInput[], dates: string[], market: { dates: string[]; ret: number[] }, rf: Map<string, number> = new Map()): FactorSeries {
  const rets: Ret = new Map(stocks.map((s) => [s.symbol, new Map(s.dates.slice(1).map((d, k) => [d, s.close[k + 1] / s.close[k] - 1]))]));
  const ends = monthEnds(dates);
  const mm = new Map(market.dates.map((d, k) => [d, market.ret[k]]));
  const out: FactorSeries = { dates: [], factors: Object.fromEntries(FACTOR_KEYS.map((k) => [k, [] as number[]])), counts: [] };
  for (let k = 0; k < ends.length - 1; k++) {
    const reb = ends[k];
    const hold = dates.filter((d) => d > reb && d <= ends[k + 1]);
    if (!hold.length) continue;
    const chars = stocks.map((s) => characteristics(s, reb, mm)).filter((c): c is Chars => !!c);
    out.counts.push({ date: reb, universe: stocks.length, valued: chars.length });
    if (chars.length < 30) continue;
    const mcap = new Map(chars.map((c) => [c.symbol, c.mcap]));
    const mkt = vwReturns(chars.map((c) => c.symbol), mcap, rets, hold);
    const legs = (p: Portfolios) => Object.fromEntries(Object.entries(p).map(([n, syms]) => [n, vwReturns(syms, mcap, rets, hold)])) as Record<string, number[]>;
    const bm = legs(sort2x3(chars, "bm"));
    const series: Record<string, number[]> = {
      MKT: mkt.map((r, t) => r - (rf.get(hold[t]) ?? 0)),
      SMB: hold.map((_, t) => (bm.SL[t] + bm.SM[t] + bm.SH[t]) / 3 - (bm.BL[t] + bm.BM[t] + bm.BH[t]) / 3),
    };
    for (const s of SORTS) {
      const p = s.char === "bm" ? bm : legs(sort2x3(chars, s.char));
      const hi = hold.map((_, t) => (p.SH[t] + p.BH[t]) / 2), lo = hold.map((_, t) => (p.SL[t] + p.BL[t]) / 2);
      series[s.key] = hold.map((_, t) => (s.long === "high" ? hi[t] - lo[t] : lo[t] - hi[t]));
    }
    out.dates.push(...hold);
    for (const f of FACTOR_KEYS) out.factors[f].push(...series[f]);
  }
  return out;
}

/** Standardise a characteristic across stocks: value-weighted mean 0, equal-weighted sd 1, clipped at ±3; missing = 0. Pure. */
export function standardise(chars: Chars[], key: keyof Chars): Map<string, number> {
  const ok = chars.filter((c) => typeof c[key] === "number" && Number.isFinite(c[key] as number));
  const wsum = ok.reduce((s, c) => s + c.mcap, 0) || 1;
  const mu = ok.reduce((s, c) => s + (c.mcap / wsum) * (c[key] as number), 0);
  const sd = Math.sqrt(ok.reduce((s, c) => s + ((c[key] as number) - mu) ** 2, 0) / Math.max(1, ok.length - 1)) || 1;
  return new Map(chars.map((c) => [c.symbol, typeof c[key] === "number" && Number.isFinite(c[key] as number) ? Math.max(-3, Math.min(3, ((c[key] as number) - mu) / sd)) : 0]));
}

export type Exposures = { asOf: string; keys: string[]; bySymbol: Record<string, number[]>; specificVar: Record<string, number>; factorCov: number[][]; version: string };

/**
 * The cross-sectional risk model over a span: exposures from the latest rebalance, one WLS regression per day,
 * factor returns, and each stock's specific variance (EWMA of residuals, half-life 90 days, daily units). Pure.
 */
export function crossSection(stocks: StockInput[], dates: string[], market: { dates: string[]; ret: number[] }, halfLife = 90): { exposures: Exposures; factorReturns: { dates: string[]; keys: string[]; rows: number[][] } } {
  const ends = monthEnds(dates);
  const reb = ends.length >= 2 ? ends[ends.length - 2] : ends[0];
  const mm = new Map(market.dates.map((d, k) => [d, market.ret[k]]));
  const chars = stocks.map((s) => characteristics(s, reb, mm)).filter((c): c is Chars => !!c);
  const keys = MODEL_CHARS as string[];
  const X = keys.map((k) => standardise(chars, k as keyof Chars));
  const syms = chars.map((c) => c.symbol);
  const w = chars.map((c) => Math.sqrt(c.mcap));
  const rets = new Map(stocks.map((s) => [s.symbol, new Map(s.dates.slice(1).map((d, k) => [d, s.close[k + 1] / s.close[k] - 1]))]));
  const lam = Math.pow(0.5, 1 / halfLife);
  const spec = new Map<string, number>();
  const rows: number[][] = [], used: string[] = [];
  for (const d of dates.filter((x) => x > reb)) {
    const have = syms.map((s, i) => [s, i, rets.get(s)?.get(d)] as const).filter(([, , r]) => r !== undefined && Number.isFinite(r));
    if (have.length < keys.length + 10) continue;
    const A = have.map(([, i]) => [1, ...keys.map((_, k) => X[k].get(syms[i]) ?? 0)]);
    const y = have.map(([, , r]) => r as number);
    const fit = wls(A, y, have.map(([, i]) => w[i]));
    rows.push(fit.coef); used.push(d);
    have.forEach(([s], j) => { const e = fit.resid[j]; spec.set(s, lam * (spec.get(s) ?? e * e) + (1 - lam) * e * e); });
  }
  // Factor covariance (daily) of the style factor returns, sample over the span.
  const F = rows.map((r) => r.slice(1));
  const K = keys.length, n = F.length;
  const mu = Array.from({ length: K }, (_, k) => F.reduce((s, r) => s + r[k], 0) / Math.max(1, n));
  const cov = Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => F.reduce((s, r) => s + (r[a] - mu[a]) * (r[b] - mu[b]), 0) / Math.max(1, n - 1)));
  return {
    exposures: { asOf: reb, keys, bySymbol: Object.fromEntries(syms.map((s) => [s, keys.map((_, k) => X[k].get(s) ?? 0)])), specificVar: Object.fromEntries(spec), factorCov: cov, version: ENGINE_VERSION },
    factorReturns: { dates: used, keys: ["intercept", ...keys], rows },
  };
}

/** A portfolio's holdings-based exposures: the weighted average of its holdings' standardised exposures. Pure. */
export function holdingsExposure(weights: Record<string, number>, ex: Pick<Exposures, "keys" | "bySymbol">): { exposures: Record<string, number>; covered: number; outside: string[] } {
  const out = new Array<number>(ex.keys.length).fill(0);
  let covered = 0;
  const outside: string[] = [];
  for (const [s, wt] of Object.entries(weights)) {
    const x = ex.bySymbol[s];
    if (!x) { outside.push(s); continue; }
    covered += wt;
    x.forEach((v, k) => { out[k] += wt * v; });
  }
  return { exposures: Object.fromEntries(ex.keys.map((k, i) => [k, covered > 0 ? out[i] / covered : 0])), covered, outside };
}
