/**
 * Price analytics behind GP, HP, BETA and RISK: trend and volatility regimes, a GARCH volatility
 * forecast turned into a price cone, beta against the S&P 500 (raw and Blume-adjusted, daily and
 * weekly, and Welch's slope-winsorized beta), value at risk three ways with a Kupiec backtest,
 * drawdowns and risk-adjusted returns.
 */
import { closes, history, type Bar } from "@/lib/market/fmp";
import { correlation, ewmaVariance, garch11, garchForecast, kupiec, maxDrawdown, mean, ols, percentRank, quantile, returns, sharpeSortino, stdev, valueAtRisk, welchBeta } from "@/lib/inference/stats";

const TRADING_DAYS = 252;
export const BENCHMARK = "^GSPC";

export type PricePoint = { date: string; close: number; sma50: number | null; sma200: number | null; volume: number };

function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    out.push(i >= n - 1 ? s / n : null);
  }
  return out;
}

/** Align two daily close series on common dates. */
function align(a: { date: string; close: number }[], b: { date: string; close: number }[]): { dates: string[]; x: number[]; y: number[] } {
  const mb = new Map(b.map((r) => [r.date, r.close]));
  const dates: string[] = [], x: number[] = [], y: number[] = [];
  for (const r of a) { const v = mb.get(r.date); if (v) { dates.push(r.date); x.push(v); y.push(r.close); } }
  return { dates, x, y };
}

/** Every Friday's close (or the last trading day of the week). */
function weekly(rows: { date: string; close: number }[]): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  let lastWeek = "";
  for (const r of rows) {
    const d = new Date(r.date + "T00:00:00Z");
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday === lastWeek) out[out.length - 1] = r; else { out.push(r); lastWeek = monday; }
  }
  return out;
}

export type BetaStat = { window: string; beta: number; adjusted: number; alpha: number; r2: number; correlation: number; se: number; n: number };

function betaOf(stock: { date: string; close: number }[], index: { date: string; close: number }[], window: string, periodsPerYear: number): BetaStat | null {
  const a = align(stock, index);
  const rx = returns(a.x), ry = returns(a.y);
  if (rx.length < 30) return null;
  const f = ols(rx, ry);
  return { window, beta: f.beta, adjusted: 0.67 * f.beta + 0.33, alpha: f.alpha * periodsPerYear, r2: f.r2, correlation: correlation(rx, ry), se: f.seBeta, n: f.n };
}

export type PriceAnalytics = {
  ticker: string; asOf: string; last: number; points: PricePoint[];
  change: { d1: number | null; m1: number | null; ytd: number | null; y1: number | null; y3: number | null };
  high52: number; low52: number; drawdownNow: number; maxDrawdown: { value: number; from: string; to: string };
  vol: { realized20: number; realized60: number; realized1y: number; ewma: number; garch: { next: number; m1: number; m3: number; longRun: number; persistence: number } | null; percentile: number };
  cone: { horizonDays: number; p10: number; p50: number; p90: number }[];
  regime: { trend: "uptrend" | "downtrend" | "sideways"; vol: "calm" | "normal" | "stressed"; note: string };
  beta: BetaStat[]; rollingBeta: { date: string; beta: number }[];
  risk: { var95: ReturnType<typeof valueAtRisk>; var99: ReturnType<typeof valueAtRisk>; sharpe: number; sortino: number; momentum12_1: number | null };
  /** Rolling one-day historical VaR (500-day window) tested on the last 250 days. */
  backtest: { days: number; level: number; exceptions: number; expected: number; pValue: number; verdict: string }[];
  relative: { date: string; stock: number; index: number }[];
};

const pct = (a: number | undefined, b: number | undefined) => (a && b ? a / b - 1 : null);

export async function priceAnalytics(ticker: string): Promise<PriceAnalytics> {
  const [bars, idx] = await Promise.all([history(ticker), closes(BENCHMARK).catch(() => [])]);
  if (bars.length < 60) throw new Error(`Not enough price history for ${ticker}`);
  const c = bars.map((b) => b.close);
  const s50 = sma(c, 50), s200 = sma(c, 200);
  const points: PricePoint[] = bars.map((b: Bar, i) => ({ date: b.date, close: b.close, sma50: s50[i], sma200: s200[i], volume: b.volume }));
  const last = c[c.length - 1], asOf = bars[bars.length - 1].date;
  const at = (daysBack: number) => c[Math.max(0, c.length - 1 - daysBack)];
  const yearStart = bars.findIndex((b) => b.date.slice(0, 4) === asOf.slice(0, 4));
  const y1 = c.slice(-TRADING_DAYS);
  const r = returns(c, true);
  const ann = (xs: number[]) => stdev(xs) * Math.sqrt(TRADING_DAYS);
  const g = garch11(r.slice(-1000));
  const garchVol = g ? {
    next: Math.sqrt(garchForecast(g, 1) * TRADING_DAYS),
    m1: Math.sqrt((Array.from({ length: 21 }, (_, h) => garchForecast(g, h + 1)).reduce((a, v) => a + v, 0) / 21) * TRADING_DAYS),
    m3: Math.sqrt((Array.from({ length: 63 }, (_, h) => garchForecast(g, h + 1)).reduce((a, v) => a + v, 0) / 63) * TRADING_DAYS),
    longRun: Math.sqrt(g.longRunVariance * TRADING_DAYS), persistence: g.persistence,
  } : null;
  // Rolling 20-day volatility history, to place today's volatility in its own distribution.
  const roll: number[] = [];
  for (let i = 20; i <= r.length; i++) roll.push(ann(r.slice(i - 20, i)));
  const v20 = ann(r.slice(-20));
  const volPct = percentRank(v20, roll);
  // Price cone from the GARCH term structure (lognormal with the forecast variance summed over the horizon).
  const cone = [5, 21, 63, 126, 252].map((h) => {
    const v = g ? Array.from({ length: h }, (_, k) => garchForecast(g, k + 1)).reduce((a, x) => a + x, 0) : (v20 ** 2 / TRADING_DAYS) * h;
    const sd = Math.sqrt(v);
    return { horizonDays: h, p10: last * Math.exp(-1.2816 * sd), p50: last, p90: last * Math.exp(1.2816 * sd) };
  });
  const lastS50 = s50[s50.length - 1], lastS200 = s200[s200.length - 1], priorS50 = s50[s50.length - 21];
  const trend: PriceAnalytics["regime"]["trend"] = lastS200 && lastS50 && priorS50 ? (last > lastS200 && lastS50 > priorS50 ? "uptrend" : last < lastS200 && lastS50 < priorS50 ? "downtrend" : "sideways") : "sideways";
  const volRegime = volPct >= 0.8 ? "stressed" : volPct <= 0.3 ? "calm" : "normal";
  const mdd = maxDrawdown(y1.length >= 60 ? c.slice(-3 * TRADING_DAYS) : c);
  const off = Math.max(0, c.length - 3 * TRADING_DAYS);
  const beta: BetaStat[] = [];
  if (idx.length) {
    const stock = bars.map((b) => ({ date: b.date, close: b.close }));
    const d1 = betaOf(stock.slice(-TRADING_DAYS - 1), idx, "1y daily", TRADING_DAYS);
    const w2 = betaOf(weekly(stock.slice(-2 * TRADING_DAYS)), weekly(idx), "2y weekly", 52);
    const w5 = betaOf(weekly(stock), weekly(idx), "5y weekly", 52);
    for (const b of [d1, w2, w5]) if (b) beta.push(b);
    const a = align(stock.slice(-TRADING_DAYS - 1), idx);
    const wb = welchBeta(returns(a.x), returns(a.y));
    if (wb && d1) beta.push({ window: "1y daily, Welch", beta: wb.beta, adjusted: wb.beta, alpha: d1.alpha, r2: d1.r2, correlation: d1.correlation, se: wb.se, n: wb.n });
  }
  // Rolling 63-day beta for the chart.
  const rollingBeta: { date: string; beta: number }[] = [];
  const relative: { date: string; stock: number; index: number }[] = [];
  if (idx.length) {
    const a = align(bars.map((b) => ({ date: b.date, close: b.close })), idx);
    const rx = returns(a.x), ry = returns(a.y);
    for (let i = 63; i <= rx.length; i += 5) rollingBeta.push({ date: a.dates[i], beta: ols(rx.slice(i - 63, i), ry.slice(i - 63, i)).beta });
    const startI = Math.max(0, a.dates.length - TRADING_DAYS);
    for (let i = startI; i < a.dates.length; i++) relative.push({ date: a.dates[i], stock: a.y[i] / a.y[startI] - 1, index: a.x[i] / a.x[startI] - 1 });
  }
  const r1y = returns(y1);
  const ss = sharpeSortino(r1y, TRADING_DAYS);
  const high52 = Math.max(...y1), low52 = Math.min(...y1);
  // VaR backtest: for each of the last 250 days, the historical VaR from the 500 days before it.
  const rs = returns(c);
  const backtest = [0.95, 0.99].map((level) => {
    const days = Math.min(250, rs.length - 500);
    if (days < 60) return null;
    let exceptions = 0;
    for (let t = rs.length - days; t < rs.length; t++) if (rs[t] < quantile(rs.slice(t - 500, t), 1 - level)) exceptions++;
    const k = kupiec(exceptions, days, level);
    return { days, level, exceptions, expected: k.expected, pValue: k.pValue, verdict: k.pValue < 0.05 ? (exceptions > k.expected ? "Too many losses beyond VaR: the model understates risk." : "Too few losses beyond VaR: the model is conservative.") : "Consistent with the stated coverage." };
  }).filter((b): b is NonNullable<typeof b> => b !== null);
  const notes: string[] = [];
  if (volRegime === "stressed") notes.push(`20-day volatility is in the top ${Math.round((1 - volPct) * 100)}% of the last five years.`);
  if (trend === "uptrend") notes.push("Above its 200-day average with a rising 50-day.");
  if (trend === "downtrend") notes.push("Below its 200-day average with a falling 50-day.");
  if (garchVol && garchVol.persistence > 0.97) notes.push("Volatility shocks are persistent (GARCH persistence above 0.97).");
  return {
    ticker, asOf, last, points,
    change: { d1: pct(last, at(1)), m1: pct(last, at(21)), ytd: yearStart > 0 ? pct(last, c[yearStart - 1]) : null, y1: c.length > TRADING_DAYS ? pct(last, at(TRADING_DAYS)) : null, y3: c.length > 3 * TRADING_DAYS ? pct(last, at(3 * TRADING_DAYS)) : null },
    high52, low52, drawdownNow: last / high52 - 1,
    maxDrawdown: { value: mdd.mdd, from: bars[off + mdd.peak]?.date ?? "", to: bars[off + mdd.trough]?.date ?? "" },
    vol: { realized20: v20, realized60: ann(r.slice(-60)), realized1y: ann(r.slice(-TRADING_DAYS)), ewma: Math.sqrt(ewmaVariance(r.slice(-500)) * TRADING_DAYS), garch: garchVol, percentile: volPct },
    cone,
    regime: { trend, vol: volRegime, note: notes.join(" ") },
    beta, rollingBeta,
    risk: { var95: valueAtRisk(r.slice(-500), 0.95), var99: valueAtRisk(r.slice(-500), 0.99), sharpe: ss.sharpe, sortino: ss.sortino, momentum12_1: c.length > TRADING_DAYS ? c[c.length - 22] / c[c.length - 1 - TRADING_DAYS] - 1 : null },
    backtest,
    relative,
  };
}

/** Mean of daily log returns annualized (drift), for the Merton model's expected return. */
export function annualDrift(c: number[]): number {
  return mean(returns(c, true)) * TRADING_DAYS;
}
