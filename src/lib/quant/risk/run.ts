/**
 * Q2 on the server: gather prices for the holdings and the factor index funds, then run the pure risk model.
 * The factors are the ETF-proxy set plus a rates factor (a 7-10 year Treasury fund minus bills), because they
 * reach back to the 2000 and 2008 replays; Kenneth French's data stays out of the product (open question 3).
 *
 * Free: 30 holdings, the five replays, two hypothetical shocks, one-day 95% VaR with its backtest, liquidity,
 * drawdown odds, 2,000 paths. Pro (quant.risk-pro): 200 holdings, unlimited shocks, the reverse stress test,
 * 10,000 paths, every VaR horizon and level.
 */
import { loadBars, barReturns } from "../pit/bars";
import { DISCLOSURES, T } from "../words";
import { align, fundReturns } from "../factors/etf";
import { mean } from "../stats/core";
import { covariance, daysToExit, decompose, drawdownOdds, fitHoldings, parseShock, REPLAYS, replayLoss, reverseStress, shockLoss, valueAtRisk, ewmaCov, type Reverse, type ShockResult, type StressResult, type VarResult, type Decomposition } from "./model";

export const RISK_VERSION = "q2-2026-10-15.1";

const FACTORS = [
  { key: "MKT", long: "SPY", short: "BIL", label: "Market" },
  { key: "SMB", long: "IWM", short: "IWB", label: "Size" },
  { key: "HML", long: "IWD", short: "IWF", label: "Value" },
  { key: "MOM", long: "MTUM", short: "SPY", label: "Momentum" },
  { key: "QMJ", long: "QUAL", short: "SPY", label: "Quality" },
  { key: "LVOL", long: "USMV", short: "SPY", label: "Low volatility" },
  { key: "RATES", long: "IEF", short: "BIL", label: "Rates (Treasury fund minus bills)" },
] as const;
export const RISK_FACTOR_LABELS: Record<string, string> = Object.fromEntries(FACTORS.map((f) => [f.key, f.label]));

export type RiskInput = { holdings: { symbol: string; weight: number }[]; pro: boolean; shocks?: string[]; reverseLoss?: number; horizonDays?: number; portfolioUsd?: number };

export type RiskResult = {
  holdings: { symbol: string; weight: number }[]; missing: { symbol: string; reason: string }[];
  decomposition: Decomposition; covarianceMethod: string; factorLabels: Record<string, string>;
  var: VarResult; varSentence: string; stress: StressResult[]; shocks: (ShockResult & { leftover: string[] })[]; reverse: Reverse | null;
  liquidity: { symbol: string; positionUsd: number; advUsd: number | null; days: number | null; flag: boolean; sentence: string | null }[];
  drawdowns: { level: number; probability: number }[]; summary: string; window: { from: string; to: string; days: number };
  paths: number; seed: number; disclosures: string[]; sources: string[]; version: string; locked: string[];
};

const ago = (years: number) => new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export async function riskView(input: RiskInput): Promise<RiskResult> {
  const max = input.pro ? 200 : 30;
  const holdings = input.holdings.filter((h) => h.symbol && h.weight > 0).map((h) => ({ symbol: h.symbol.toUpperCase().replace(/\./g, "-"), weight: h.weight }));
  if (!holdings.length) throw Object.assign(new Error("Add holdings with positive weights."), { status: 400 });
  if (holdings.length > max) throw Object.assign(new Error(`Up to ${max} holdings on your plan.`), { status: 402 });
  const paths = input.pro ? 10_000 : 2_000, seed = 41, horizon = Math.min(Math.max(input.horizonDays ?? 21, 5), 63);
  const shocksIn = (input.shocks ?? []).filter((s) => s.trim()).slice(0, input.pro ? 10 : 2);
  const locked: string[] = [];
  if (!input.pro && (input.shocks?.length ?? 0) > 2) locked.push("More than two hypothetical shocks");
  if (!input.pro && input.reverseLoss) locked.push("The reverse stress test");
  const funds = [...new Set(FACTORS.flatMap((f) => [f.long, f.short]))];
  const [hist, fund] = await Promise.all([fundReturns(holdings.map((h) => h.symbol), "1999-12-01"), fundReturns(funds, "1999-12-01")]);
  // The risk window: the last two years on common dates.
  const from = ago(2.05);
  const missing: RiskResult["missing"] = [];
  const usable = holdings.filter((h) => {
    const n = hist[h.symbol]?.dates.filter((d) => d >= from).length ?? 0;
    if (n < 250) { missing.push({ symbol: h.symbol, reason: n ? `only ${n} days in the last two years (250 needed)` : "no daily prices on the current data sources" }); return false; }
    return true;
  });
  if (!usable.length) throw Object.assign(new Error("None of these holdings has two years of daily prices on the current data sources."), { status: 422 });
  const wsum = usable.reduce((s, h) => s + h.weight, 0);
  const w = usable.map((h) => h.weight / wsum);
  const factorSeries: Record<string, { dates: string[]; ret: number[] }> = {};
  for (const f of FACTORS) {
    const a = align(fund, [f.long, f.short]);
    if (a.dates.length) factorSeries[f.key] = { dates: a.dates, ret: a.rows.map((r) => r[0] - r[1]) };
  }
  const fnames = FACTORS.map((f) => f.key).filter((k) => factorSeries[k]?.dates.some((d) => d >= from));
  const recent = (s: { dates: string[]; ret: number[] }) => { const i = s.dates.findIndex((d) => d >= from); return { dates: s.dates.slice(i), ret: s.ret.slice(i) }; };
  const all: Record<string, { dates: string[]; ret: number[] }> = {};
  for (const h of usable) all[h.symbol] = recent(hist[h.symbol]);
  for (const k of fnames) all[`F:${k}`] = recent(factorSeries[k]);
  const keys = [...usable.map((h) => h.symbol), ...fnames.map((k) => `F:${k}`)];
  const A = align(all, keys);
  const Y = A.rows.map((r) => r.slice(0, usable.length)), Fr = A.rows.map((r) => r.slice(usable.length));
  const symbols = usable.map((h) => h.symbol);
  const cm = covariance(Y, fnames.length ? Fr : null, symbols);
  const dec = decompose(symbols, w, cm, fnames);
  const port = Y.map((r) => r.reduce((s, x, i) => s + w[i] * x, 0));
  const v = valueAtRisk(port, { paths, seed, levels: input.pro ? [0.95, 0.99] : [0.95], horizons: input.pro ? [1, 10] : [1] });
  if (!input.pro) locked.push("Ten-day and 99% VaR");
  const v95 = v.rows.find((r) => r.horizon === 1 && r.level === 0.95)!;
  // Replays: actual returns where a holding traded through the window, else factor betas plus resampled residuals.
  const fits = fitHoldings(symbols, Y, Fr);
  const stress: StressResult[] = [];
  REPLAYS.forEach((rp, idx) => {
    const avail = fnames.filter((k) => { const s = factorSeries[k]; return s.dates[0] <= rp.from && s.dates.at(-1)! >= rp.to; });
    const fi = avail.map((k) => fnames.indexOf(k));
    const windowDays = factorSeries.MKT ? factorSeries.MKT.dates.filter((d) => d > rp.from && d <= rp.to).length : 0;
    const moves = avail.map((k) => { const s = factorSeries[k]; let x = 0; s.dates.forEach((d, i) => { if (d > rp.from && d <= rp.to) x += Math.log(1 + s.ret[i]); }); return x; });
    const actual = new Map<string, number>(), proxy = new Map<string, { betas: number[]; resid: number[] }>();
    for (const h of usable) {
      const s = hist[h.symbol];
      if (s.dates[0] <= rp.from && s.dates.at(-1)! >= rp.to) { let g = 1; s.dates.forEach((d, i) => { if (d > rp.from && d <= rp.to) g *= 1 + s.ret[i]; }); actual.set(h.symbol, g - 1); }
      else if (avail.length) {
        const sub = fitHoldings([h.symbol], Y.map((r) => [r[symbols.indexOf(h.symbol)]]), Fr.map((r) => fi.map((k) => r[k])))[0];
        proxy.set(h.symbol, { betas: sub.betas, resid: sub.resid });
      }
    }
    stress.push(replayLoss(rp, usable, actual, proxy, moves, windowDays, Math.min(paths, 2_000), seed + idx));
  });
  // Hypothetical shocks and the reverse stress test.
  const B = cm.B.length ? cm.B : fits.map((f) => f.betas);
  const D = cm.B.length ? cm.D : fits.map((f) => f.residVar);
  const Fd = cm.F.length ? cm.F : ewmaCov(Fr, 90);
  const shocks = shocksIn.map((t, i) => { const p = parseShock(t); return { ...shockLoss(p.spec, fnames, Fd, B, D, w, horizon, paths, seed + 100 + i), leftover: p.leftover }; });
  const b = fnames.map((_, k) => w.reduce((s, wi, i) => s + wi * (B[i]?.[k] ?? 0), 0));
  const reverse = input.pro && fnames.length ? reverseStress(fnames, Fd, b, Math.min(Math.max(input.reverseLoss ?? 0.25, 0.05), 0.8), horizon) : null;
  // Liquidity at 20% of 20-day average dollar volume.
  const value = Math.max(input.portfolioUsd ?? 100_000, 1);
  const liquidity: RiskResult["liquidity"] = [];
  const bars = new Map<string, Awaited<ReturnType<typeof loadBars>>>();
  let bi = 0;
  await Promise.all(Array.from({ length: Math.min(6, usable.length) }, async () => { while (bi < usable.length) { const s = usable[bi++].symbol; bars.set(s, await loadBars(s, ago(0.15)).catch(() => null)); } }));
  for (const h of usable) {
    const lb = bars.get(h.symbol);
    const c = lb?.bars.c.slice(-20) ?? [], vol = lb?.bars.v.slice(-20) ?? [];
    const adv = c.length >= 5 && vol.some((x) => x > 0) ? mean(c.map((x, i) => x * (vol[i] ?? 0))) : null;
    const pos = (h.weight / wsum) * value, days = adv && adv > 0 ? daysToExit(pos, adv) : null;
    liquidity.push({ symbol: h.symbol, positionUsd: pos, advUsd: adv, days, flag: days !== null && days > 5, sentence: days !== null && days > 5 ? T.daysToExit(h.symbol, days) : null });
  }
  const drawdowns = drawdownOdds(port, [0.1, 0.2, 0.3], 2_000, seed);
  const worst = [...stress].sort((a, c) => c.mid - a.mid)[0];
  const summary = `${pct(dec.volAnnual)} annual volatility${worst ? `; a ${worst.label} replay loses ${pct(worst.mid)} (${pct(worst.low)} to ${pct(worst.high)})` : ""}; ${pct(dec.top3Share)} of the risk comes from three names.`;
  return {
    holdings: usable.map((h, i) => ({ symbol: h.symbol, weight: w[i] })), missing, decomposition: dec, covarianceMethod: cm.method, factorLabels: RISK_FACTOR_LABELS,
    var: v, varSentence: T.varBacktest(v.backtest.exceptions, v.backtest.expected, v.backtest.pass) + ` The 1-day 95% VaR is ${(v95.varFhs * 100).toFixed(2)}% of the portfolio.`,
    stress, shocks, reverse, liquidity, drawdowns, summary, window: { from: A.dates[0], to: A.dates.at(-1)!, days: A.dates.length },
    paths, seed, locked,
    disclosures: [DISCLOSURES.not_advice, DISCLOSURES.synthetic, DISCLOSURES.model_estimate],
    sources: ["Daily prices: FMP, then Nasdaq (beta), split-adjusted closes", "Factors: index funds SPY, IWM, IWB, IWD, IWF, MTUM, QUAL, USMV, IEF and BIL (daily returns, long minus short)", `Covariance: ${cm.method}`, `Simulations: ${paths.toLocaleString("en-US")} paths, seed ${seed}`],
    version: RISK_VERSION,
  };
}

export { barReturns };
