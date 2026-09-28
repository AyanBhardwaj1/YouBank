/**
 * PORT, portfolio risk: volatility, beta, value at risk, drawdown, the correlation matrix, each
 * holding's share of the risk (which is rarely its share of the money), and a one-year range of
 * outcomes from a bootstrap of the portfolio's own daily returns (fat tails included).
 */
import { closes } from "@/lib/market/data";
import { MarketDataError } from "@/lib/market/fmp";
import { correlation, maxDrawdown, mean, ols, quantile, returns, rng, stdev, valueAtRisk } from "@/lib/inference/stats";
import { BENCHMARK } from "./price";

export type Holding = { symbol: string; weight: number };

export type PortfolioView = {
  holdings: (Holding & { vol: number; beta: number | null; riskShare: number; return1y: number | null })[];
  stats: { vol: number; beta: number | null; sharpe: number; return1y: number | null; var95: number; es95: number; var99: number; maxDrawdown: number; diversification: number };
  correlation: { symbols: string[]; matrix: number[][] };
  outcomes: { p5: number; p25: number; p50: number; p75: number; p95: number; lossProbability: number };
  missing: string[];
};

export async function portfolioView(input: Holding[]): Promise<PortfolioView> {
  const clean = input.filter((h) => h.symbol && h.weight > 0).slice(0, 30);
  const total = clean.reduce((a, h) => a + h.weight, 0);
  if (!total) throw new Error("Add holdings with positive weights");
  const from = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const series = await Promise.all([...clean.map((h) => closes(h.symbol.toUpperCase(), from).catch(() => [])), closes(BENCHMARK, from).catch(() => [])]);
  const idx = series.pop() ?? [];
  const missing = clean.filter((_, i) => series[i].length < 60).map((h) => h.symbol.toUpperCase());
  const live = clean.map((h, i) => ({ h: { symbol: h.symbol.toUpperCase(), weight: h.weight / total }, s: series[i] })).filter((x) => x.s.length >= 60);
  if (!live.length) throw new MarketDataError(`No price history for ${missing.join(", ")} on the current market-data plan`);
  const wsum = live.reduce((a, x) => a + x.h.weight, 0);
  // Common dates across every holding.
  const sets = live.map((x) => new Map(x.s.map((p) => [p.date, p.close])));
  const dates = live[0].s.map((p) => p.date).filter((d) => sets.every((m) => m.has(d)));
  const px = sets.map((m) => dates.map((d) => m.get(d) as number));
  const R = px.map((p) => returns(p));
  const n = Math.min(...R.map((r) => r.length));
  const w = live.map((x) => x.h.weight / wsum);
  const port = Array.from({ length: n }, (_, t) => R.reduce((a, r, i) => a + w[i] * r[r.length - n + t], 0));
  // Covariance and each holding's contribution to variance: w_i (Sigma w)_i / sigma_p^2.
  const means = R.map((r) => mean(r.slice(-n)));
  const cov = R.map((ri, i) => R.map((rj, j) => { let s = 0; for (let t = 0; t < n; t++) s += (ri[ri.length - n + t] - means[i]) * (rj[rj.length - n + t] - means[j]); return s / (n - 1); }));
  const sw = cov.map((row) => row.reduce((a, c, j) => a + c * w[j], 0));
  const varP = w.reduce((a, wi, i) => a + wi * sw[i], 0);
  const idxMap = new Map(idx.map((p) => [p.date, p.close]));
  const idxR = returns(dates.map((d) => idxMap.get(d) ?? NaN).filter(Number.isFinite));
  const beta = idxR.length >= n ? ols(idxR.slice(-n), port).beta : null;
  const vols = R.map((r) => stdev(r.slice(-n)) * Math.sqrt(252));
  const volP = Math.sqrt(varP * 252);
  const growth = port.reduce((acc: number[], r) => [...acc, (acc[acc.length - 1] ?? 1) * (1 + r)], []);
  const last252 = port.slice(-252);
  const ret1y = last252.length >= 200 ? last252.reduce((a, r) => a * (1 + r), 1) - 1 : null;
  const v95 = valueAtRisk(port, 0.95), v99 = valueAtRisk(port, 0.99);
  // One-year outcomes: 2,000 paths of 252 days drawn with replacement from the portfolio's own returns.
  const u = rng(19);
  const finals: number[] = [];
  for (let p = 0; p < 2000; p++) { let g = 1; for (let d = 0; d < 252; d++) g *= 1 + port[Math.floor(u() * port.length)]; finals.push(g - 1); }
  return {
    holdings: live.map((x, i) => ({
      ...x.h, weight: w[i], vol: vols[i],
      beta: idxR.length >= n ? ols(idxR.slice(-n), R[i].slice(-n)).beta : null,
      riskShare: varP ? (w[i] * sw[i]) / varP : 0,
      return1y: px[i].length > 252 ? px[i][px[i].length - 1] / px[i][px[i].length - 253] - 1 : null,
    })),
    stats: {
      vol: volP, beta, sharpe: (mean(port) * 252) / volP, return1y: ret1y,
      var95: v95.historical, es95: v95.historicalEs, var99: v99.historical, maxDrawdown: maxDrawdown(growth).mdd,
      diversification: volP ? w.reduce((a, wi, i) => a + wi * vols[i], 0) / volP : 1,
    },
    correlation: { symbols: live.map((x) => x.h.symbol), matrix: R.map((ri) => R.map((rj) => correlation(ri.slice(-n), rj.slice(-n)))) },
    outcomes: { p5: quantile(finals, 0.05), p25: quantile(finals, 0.25), p50: quantile(finals, 0.5), p75: quantile(finals, 0.75), p95: quantile(finals, 0.95), lossProbability: finals.filter((f) => f < 0).length / finals.length },
    missing,
  };
}
