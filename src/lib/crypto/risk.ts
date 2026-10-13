/**
 * Risk of a crypto portfolio, from holdings and daily price histories. Pure, for tests and both sides.
 *
 * - Concentration: weights, the largest holding, and the Herfindahl index (1 / HHI is the "effective
 *   number" of equally sized holdings).
 * - Stablecoin share and chain exposure: how much is dollars, and on which chains.
 * - Volatility and value at risk from the holdings' joint daily returns over the last year, at today's
 *   weights (historical simulation, so fat tails and the way crypto falls together are kept), plus a
 *   parametric figure for comparison, and the drawdown the current mix would have suffered.
 * - Profit and loss against the cost a person entered (YouBank cannot see what they paid).
 *
 * Crypto trades every day, so volatility annualises with 365 days, not 252.
 */

export type Holding = { asset: string; symbol: string; chain: string; quantity: number; priceUsd: number | null; valueUsd: number; stable: boolean; costUsd?: number | null };
export type Series = { date: string; close: number }[];

export type RiskView = {
  totalUsd: number;
  weights: { asset: string; symbol: string; weight: number }[];
  largest: { symbol: string; weight: number } | null;
  hhi: number;
  effectiveN: number;
  stableShare: number;
  chains: { chain: string; usd: number; weight: number }[];
  vol: number | null;
  var95: number | null;
  varParametric95: number | null;
  es95: number | null;
  maxDrawdown: number | null;
  days: number;
  /** Share of the non-stable value whose price history went into the volatility figures. */
  historyCoverage: number;
  pnl: { costUsd: number; valueUsd: number; gainUsd: number; gainPct: number | null; covered: number } | null;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Combine holdings of the same asset (the same token held on two chains or in two wallets). */
export function aggregate(holdings: Holding[]): { asset: string; symbol: string; usd: number; stable: boolean }[] {
  const by = new Map<string, { asset: string; symbol: string; usd: number; stable: boolean }>();
  for (const h of holdings) {
    const e = by.get(h.asset) ?? { asset: h.asset, symbol: h.symbol, usd: 0, stable: h.stable };
    e.usd += h.valueUsd; by.set(h.asset, e);
  }
  return [...by.values()].filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd);
}

/** Daily simple returns aligned on dates every series has, as [date][asset]. */
export function alignedReturns(series: Record<string, Series>): { dates: string[]; returns: Record<string, number[]> } {
  const keys = Object.keys(series).filter((k) => series[k].length > 2);
  if (!keys.length) return { dates: [], returns: {} };
  const maps = keys.map((k) => new Map(series[k].map((p) => [p.date, p.close])));
  const dates = series[keys[0]].map((p) => p.date).filter((d) => maps.every((m) => m.has(d))).sort();
  const returns: Record<string, number[]> = {};
  keys.forEach((k, i) => {
    const m = maps[i];
    returns[k] = dates.slice(1).map((d, j) => m.get(d)! / m.get(dates[j])! - 1);
  });
  return { dates: dates.slice(1), returns };
}

/** The empirical quantile (linear interpolation), q in [0, 1]. */
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function maxDrawdown(path: number[]): number | null {
  if (path.length < 2) return null;
  let peak = path[0], worst = 0;
  for (const v of path) { peak = Math.max(peak, v); worst = Math.min(worst, v / peak - 1); }
  return worst;
}

/**
 * The whole view. `series` holds daily closes by asset (CoinGecko id); stablecoins without a series
 * are treated as cash (zero return), which is what a dollar stablecoin is meant to be.
 */
export function portfolioRisk(holdings: Holding[], series: Record<string, Series>): RiskView {
  const agg = aggregate(holdings);
  const totalUsd = sum(agg.map((a) => a.usd));
  const weights = agg.map((a) => ({ asset: a.asset, symbol: a.symbol, weight: totalUsd ? a.usd / totalUsd : 0 }));
  const hhi = sum(weights.map((w) => w.weight ** 2));
  const stableShare = totalUsd ? sum(agg.filter((a) => a.stable).map((a) => a.usd)) / totalUsd : 0;
  const byChain = new Map<string, number>();
  for (const h of holdings) byChain.set(h.chain, (byChain.get(h.chain) ?? 0) + h.valueUsd);
  const chains = [...byChain.entries()].map(([chain, usd]) => ({ chain, usd, weight: totalUsd ? usd / totalUsd : 0 })).filter((c) => c.usd > 0).sort((a, b) => b.usd - a.usd);

  // Portfolio daily returns at today's weights; assets without history count as cash only if stable.
  const risky = weights.filter((w) => !agg.find((a) => a.asset === w.asset)?.stable);
  const { returns } = alignedReturns(Object.fromEntries(risky.filter((w) => series[w.asset]).map((w) => [w.asset, series[w.asset]])));
  const covered = risky.filter((w) => returns[w.asset]);
  const days = covered.length ? returns[covered[0].asset].length : 0;
  let vol: number | null = null, var95: number | null = null, varP: number | null = null, es95: number | null = null, mdd: number | null = null;
  if (days >= 30) {
    const port = Array.from({ length: days }, (_, t) => sum(covered.map((w) => w.weight * returns[w.asset][t])));
    const mean = sum(port) / days;
    const sd = Math.sqrt(sum(port.map((r) => (r - mean) ** 2)) / (days - 1));
    vol = sd * Math.sqrt(365);
    const q = quantile(port, 0.05);
    var95 = q === null ? null : -q;
    varP = 1.6448536 * sd - mean;
    const tail = port.filter((r) => q !== null && r <= q);
    es95 = tail.length ? -sum(tail) / tail.length : null;
    let level = 1; const path = [1];
    for (const r of port) { level *= 1 + r; path.push(level); }
    mdd = maxDrawdown(path);
  }

  const withCost = holdings.filter((h) => typeof h.costUsd === "number" && h.costUsd! > 0);
  const pnl = withCost.length ? (() => {
    const costUsd = sum(withCost.map((h) => h.costUsd!)), valueUsd = sum(withCost.map((h) => h.valueUsd));
    return { costUsd, valueUsd, gainUsd: valueUsd - costUsd, gainPct: costUsd ? valueUsd / costUsd - 1 : null, covered: totalUsd ? valueUsd / totalUsd : 0 };
  })() : null;

  return {
    totalUsd, weights, largest: weights[0] ? { symbol: weights[0].symbol, weight: weights[0].weight } : null, hhi, effectiveN: hhi ? 1 / hhi : 0, stableShare, chains,
    vol, var95, varParametric95: days >= 30 ? varP : null, es95, maxDrawdown: mdd, days, pnl,
    historyCoverage: sum(risky.map((w) => w.weight)) ? sum(covered.map((w) => w.weight)) / sum(risky.map((w) => w.weight)) : 1,
  };
}
