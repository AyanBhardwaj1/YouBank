/**
 * Q1, Factor Lab: what a portfolio really owns. Server side; the regressions and maths are the pure kit.
 *
 * 1. Returns-based exposures: the portfolio's daily excess returns at today's weights regressed on the factors
 *    over one and three years, Newey-West errors, each beta with its 90% interval, R² and the alpha with its t
 *    (below 2 is indistinguishable from luck), plus 126-day rolling betas for the chart.
 * 2. Holdings-based exposures: the weighted average of each holding's standardised exposures in YouBank's
 *    cross-sectional model, which reacts at once to a change in holdings; holdings outside the model are listed
 *    with their weight, never dropped silently.
 * 3. Risk split: the share of variance the factors explain and the stock-specific rest.
 * 4. Factor-proxy tracking: the mix of factor index funds that tracks the portfolio most closely (weights >= 0
 *    summing to 1), with its tracking error, worded as analysis.
 * 5. Crowding: a flag when the exposure to a factor is above 0.3 and that factor is crowded.
 * 6. The factor dashboard: each factor's return over a month, the year to date, one and five years, drawdown,
 *    volatility and correlations.
 * The factor set is YouBank's own when it covers the window, else the ETF proxies; the answer names which.
 */
import { annualise, maxDrawdown, std, wealth } from "../stats/core";
import { ols, simplexLs } from "../stats/regress";
import { DISCLOSURES, T } from "../words";
import { crowding, factorPanel, storedExposures, ETF_LABELS, YB_LABELS } from "./read";
import { align, fundReturns, TRACKING_FUNDS, FACTOR_FUNDS } from "./etf";
import { holdingsExposure } from "./engine";

export const LAB_VERSION = "q1-2026-10-15.1";

export type Holding = { symbol: string; weight: number };

export type Beta = { factor: string; label: string; beta: number; low: number; high: number; t: number };
export type Window = { years: number; n: number; from: string; to: string; betas: Beta[]; alphaAnnual: number; alphaT: number; r2: number; luck: string } | null;

export type LabResult = {
  holdings: (Holding & { inModel: boolean; history: number })[];
  outside: { symbol: string; weight: number; reason: string }[];
  tier: "youbank" | "etf"; factorSource: string; factorNames: string[]; labels: Record<string, string>;
  windows: { y1: Window; y3: Window };
  rolling: { dates: string[]; betas: Record<string, number[]> };
  holdingsBased: { exposures: Record<string, number>; covered: number; asOf: string; disagreements: string[] } | null;
  riskSplit: { factor: number; specific: number; explained: string } | null;
  tracking: { weights: { fund: string; weight: number }[]; r2: number; trackingErrorAnnual: number; sentence: string; years: number } | null;
  crowding: { factor: string; exposure: number; percentile: number; sentence: string }[];
  dashboard: { factor: string; label: string; m1: number | null; ytd: number | null; y1: number | null; y5: number | null; vol: number | null; maxDrawdown: number | null; funds: string[] }[];
  correlations: { names: string[]; matrix: number[][] };
  summary: string;
  disclosures: string[]; sources: string[]; version: string;
};

const DAY = 86_400_000;
const isoAgo = (years: number) => new Date(Date.now() - years * 365.25 * DAY).toISOString().slice(0, 10);

/** Portfolio daily returns at fixed weights on the dates every included holding traded. Pure. */
export function portfolioReturns(series: Record<string, { dates: string[]; ret: number[] }>, holdings: Holding[]): { dates: string[]; ret: number[]; used: Holding[] } {
  const used = holdings.filter((h) => series[h.symbol]?.dates.length);
  const total = used.reduce((s, h) => s + h.weight, 0) || 1;
  if (!used.length) return { dates: [], ret: [], used };
  const a = align(series, used.map((h) => h.symbol));
  return { dates: a.dates, ret: a.rows.map((r) => r.reduce((s, x, i) => s + (used[i].weight / total) * x, 0)), used: used.map((h) => ({ ...h, weight: h.weight / total })) };
}

/** One regression window: betas with 90% intervals (Newey-West), alpha and R². Pure. */
export function regressWindow(y: number[], X: number[][], names: string[], labels: Record<string, string>, dates: string[], years: number): Window {
  const n = Math.min(y.length, Math.round(years * 252));
  if (n < 120) return null;
  const ys = y.slice(-n), Xs = X.slice(-n), ds = dates.slice(-n);
  const f = ols(Xs, ys);
  const betas = names.map((nm, i) => ({ factor: nm, label: labels[nm] ?? nm, beta: f.coef[i + 1], low: f.coef[i + 1] - 1.645 * f.seNw[i + 1], high: f.coef[i + 1] + 1.645 * f.seNw[i + 1], t: f.tNw[i + 1] }));
  return { years, n, from: ds[0], to: ds[ds.length - 1], betas, alphaAnnual: f.coef[0] * 252, alphaT: f.tNw[0], r2: f.r2, luck: T.alphaLuck(f.tNw[0]) };
}

/** "Mostly large-cap growth and momentum": the three largest exposures in words. Pure. */
export function describe(betas: Beta[]): string {
  const style = betas.filter((b) => b.factor !== "MKT" && Math.abs(b.t) >= 2).sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta)).slice(0, 3);
  if (!style.length) return "No factor tilt stands out beyond the market itself.";
  const word = (b: Beta) => {
    const pos = b.beta > 0;
    switch (b.factor) {
      case "SMB": return pos ? "small companies" : "large companies";
      case "HML": return pos ? "value" : "growth";
      case "MOM": return pos ? "momentum" : "recent losers";
      case "QMJ": case "RMW": return pos ? "quality (profitable companies)" : "less profitable companies";
      case "LVOL": return pos ? "low volatility" : "high volatility";
      case "CMA": return pos ? "conservative investment" : "fast-growing balance sheets";
      case "STREV": return pos ? "last month's losers" : "last month's winners";
      default: return b.label.toLowerCase();
    }
  };
  return `Mostly ${style.map(word).join(", ").replace(/, ([^,]*)$/, " and $1")}, measured against the factors.`;
}

const pctCh = (r: number[]) => (r.length ? wealth(r)[r.length] - 1 : null);

export async function factorLab(input: Holding[], opts: { years?: number; maxHoldings: number }): Promise<LabResult> {
  const holdings = input.filter((h) => h.symbol && h.weight > 0).map((h) => ({ symbol: h.symbol.toUpperCase().replace(/\./g, "-"), weight: h.weight }));
  if (!holdings.length) throw Object.assign(new Error("Add holdings with positive weights."), { status: 400 });
  if (holdings.length > opts.maxHoldings) throw Object.assign(new Error(`Up to ${opts.maxHoldings} holdings on your plan.`), { status: 402 });
  const years = Math.min(Math.max(opts.years ?? 3, 1), 10);
  const from = isoAgo(Math.max(years, 5) + 0.1);
  const [series, fp, etfFunds, exposures, crowd] = await Promise.all([
    fundReturns([...holdings.map((h) => h.symbol), "BIL"], isoAgo(years + 0.1)),
    factorPanel(from),
    fundReturns(TRACKING_FUNDS, isoAgo(Math.min(years, 3) + 0.1)),
    storedExposures().catch(() => null),
    crowding().catch(() => []),
  ]);
  const outside: LabResult["outside"] = [];
  for (const h of holdings) {
    const s = series[h.symbol];
    if (!s?.dates.length) outside.push({ symbol: h.symbol, weight: h.weight, reason: "no daily prices on the current data sources" });
    else if (s.dates.length < 120) outside.push({ symbol: h.symbol, weight: h.weight, reason: `only ${s.dates.length} days of history (120 needed)` });
  }
  const priced = holdings.filter((h) => (series[h.symbol]?.dates.length ?? 0) >= 120);
  const port = portfolioReturns(series, priced);
  const labels = fp.tier === "youbank" ? YB_LABELS : ETF_LABELS;
  // Excess returns over bills (BIL) where available.
  const rf = new Map(series.BIL?.dates.map((d, i) => [d, series.BIL.ret[i]]) ?? []);
  const fAt = new Map(fp.dates.map((d, i) => [d, fp.rows[i]]));
  const common = port.dates.filter((d) => fAt.has(d));
  const y = common.map((d) => port.ret[port.dates.indexOf(d)] - (rf.get(d) ?? 0));
  const X = common.map((d) => fAt.get(d)!);
  const y1 = regressWindow(y, X, fp.names, labels, common, 1);
  const y3 = years >= 3 ? regressWindow(y, X, fp.names, labels, common, 3) : null;
  // Rolling 126-day betas, every fifth day.
  const rolling: LabResult["rolling"] = { dates: [], betas: Object.fromEntries(fp.names.map((n) => [n, [] as number[]])) };
  for (let t = 126; t <= y.length; t += 5) {
    try { const f = ols(X.slice(t - 126, t), y.slice(t - 126, t)); rolling.dates.push(common[t - 1]); fp.names.forEach((n, i) => rolling.betas[n].push(f.coef[i + 1])); } catch { /* collinear window */ }
  }
  // Holdings-based exposures from the cross-sectional model.
  let holdingsBased: LabResult["holdingsBased"] = null;
  if (exposures) {
    const h = holdingsExposure(Object.fromEntries(holdings.map((x) => [x.symbol, x.weight / holdings.reduce((s, z) => s + z.weight, 0)])), exposures);
    const main = y3 ?? y1;
    const map: Record<string, [string, number]> = { size: ["SMB", -1], bm: ["HML", 1], mom: ["MOM", 1], gpa: [fp.tier === "youbank" ? "RMW" : "QMJ", 1], vol: ["LVOL", -1], inv: ["CMA", -1] };
    const disagreements: string[] = [];
    if (main) for (const [k, [f, sign]] of Object.entries(map)) {
      const b = main.betas.find((x) => x.factor === f), z = h.exposures[k];
      if (b && z !== undefined && Math.abs(z) > 0.5 && (b.low > 0 || b.high < 0) && Math.sign(b.beta) !== Math.sign(sign * z)) disagreements.push(`${labels[f] ?? f}: your holdings today lean ${sign * z > 0 ? "toward" : "away from"} it, while the ${main.years}-year regression shows the opposite; recent trades may have moved the portfolio and the regression has not caught up.`);
    }
    holdingsBased = { exposures: h.exposures, covered: h.covered, asOf: exposures.asOf, disagreements };
    for (const s of h.outside) if (!outside.some((o) => o.symbol === s)) outside.push({ symbol: s, weight: holdings.find((x) => x.symbol === s)?.weight ?? 0, reason: "outside the factor model's universe (the 1,000 largest US companies)" });
  }
  const main = y3 ?? y1;
  const riskSplit = main ? { factor: main.r2, specific: 1 - main.r2, explained: T.factorExplained(main.r2) } : null;
  // Tracking mix of factor index funds.
  let tracking: LabResult["tracking"] = null;
  const funds = TRACKING_FUNDS.filter((f) => etfFunds[f]?.dates.length);
  if (funds.length >= 3 && port.dates.length >= 120) {
    const a = align({ ...etfFunds, __p: { dates: port.dates, ret: port.ret } }, ["__p", ...funds]);
    if (a.rows.length >= 120) {
      const r = simplexLs(a.rows.map((row) => row.slice(1)), a.rows.map((row) => row[0]));
      const yrs = Math.round((a.rows.length / 252) * 10) / 10;
      tracking = { weights: funds.map((f, i) => ({ fund: f, weight: r.weights[i] })).filter((w) => w.weight > 0.005).sort((p, q) => q.weight - p.weight), r2: r.r2, trackingErrorAnnual: r.trackingSd * Math.sqrt(252), sentence: T.trackedBy(r.r2, Math.max(1, Math.round(yrs))), years: yrs };
    }
  }
  // Crowding flags.
  const crowdFlags: LabResult["crowding"] = [];
  if (main) for (const c of crowd) {
    const b = main.betas.find((x) => x.factor === c.factor);
    const pct = Math.max(c.comove.pct ?? 0, c.ownership.pct ?? 0);
    if (b && b.beta > 0.3 && c.crowded) crowdFlags.push({ factor: c.factor, exposure: b.beta, percentile: pct, sentence: T.crowdingFlag(labels[c.factor] ?? c.factor, b.beta, pct) });
  }
  // Dashboard.
  const today = new Date().toISOString().slice(0, 10), ytdFrom = `${today.slice(0, 4)}-01-01`;
  const col = (k: number) => fp.rows.map((r) => r[k]);
  const since = (d: string, k: number) => col(k).filter((_, i) => fp.dates[i] >= d);
  const dashboard = fp.names.map((f, k) => {
    const all = col(k);
    return {
      factor: f, label: labels[f] ?? f, m1: pctCh(since(isoAgo(1 / 12), k)), ytd: pctCh(since(ytdFrom, k)), y1: pctCh(since(isoAgo(1), k)), y5: fp.dates[0] <= isoAgo(4.9) ? pctCh(since(isoAgo(5), k)) : null,
      vol: all.length > 20 ? std(all.slice(-252)) * Math.sqrt(252) : null, maxDrawdown: all.length ? maxDrawdown(wealth(all)) : null, funds: FACTOR_FUNDS[f] ?? [],
    };
  });
  const last = fp.rows.slice(-252);
  const corrM = fp.names.map((_, i) => fp.names.map((__, j) => { const a = last.map((r) => r[i]), b = last.map((r) => r[j]); const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length; let sab = 0, saa = 0, sbb = 0; a.forEach((v, t) => { sab += (v - ma) * (b[t] - mb); saa += (v - ma) ** 2; sbb += (b[t] - mb) ** 2; }); return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0; }));
  return {
    holdings: holdings.map((h) => ({ ...h, inModel: !outside.some((o) => o.symbol === h.symbol), history: series[h.symbol]?.dates.length ?? 0 })),
    outside, tier: fp.tier, factorSource: fp.source, factorNames: fp.names, labels, windows: { y1, y3 }, rolling, holdingsBased, riskSplit, tracking, crowding: crowdFlags,
    dashboard, correlations: { names: fp.names, matrix: corrM },
    summary: main ? describe(main.betas) : "Not enough common history (120 trading days) to estimate exposures.",
    disclosures: [DISCLOSURES.not_advice, DISCLOSURES.model_estimate, ...(fp.tier === "youbank" ? [DISCLOSURES.survivorship] : [])],
    sources: [fp.source, "Holdings' daily prices: FMP, then Nasdaq (beta), split-adjusted closes", "Risk-free rate: BIL (1-3 month Treasury bill fund) daily returns", ...(exposures ? [`Holdings-based exposures: YouBank cross-sectional model as of ${exposures.asOf}`] : [])],
    version: LAB_VERSION,
  };
}

/** Annualised volatility of a return series (for the dashboard's single-stock view). */
export const annualVol = (r: number[]) => (r.length > 20 ? std(r) * Math.sqrt(252) : null);
export { annualise };
