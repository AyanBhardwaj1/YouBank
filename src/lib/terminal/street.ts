/**
 * The Street views behind EE (earnings), ANR (analysts) and DVD (dividends), with inference on top of
 * the raw feeds: how often a company beats (a Beta-Binomial posterior, so four beats in four quarters
 * is not read as certainty), how far the stock usually moves on the report, where the analyst herd is
 * drifting, and how safe the dividend is.
 */
import { getCompanyData } from "@/lib/company";
import { betaRate } from "@/lib/inference/learn";
import { median, quantile } from "@/lib/inference/stats";
import { dividends as fmpDividends, earnings as fmpEarnings, estimates, grades, history, priceTarget, ratingSnapshot, type Bar } from "@/lib/market/fmp";
import { conformalQuantile } from "@/lib/inference/forecast";

export type EarningsView = {
  ticker: string; next: { date: string; epsEstimated: number | null; revenueEstimated: number | null } | null;
  quarters: { date: string; epsActual: number; epsEstimated: number | null; epsSurprise: number | null; revenueActual: number | null; revenueEstimated: number | null; revenueSurprise: number | null; move: number | null }[];
  beat: { eps: { rate: number; lo: number; hi: number; n: number }; revenue: { rate: number; lo: number; hi: number; n: number } };
  move: { median: number | null; p80: number | null; n: number };
  annual: { year: string; revenueAvg: number; revenueLow: number; revenueHigh: number; epsAvg: number; analysts: number }[];
};

/** Close-to-close return spanning the report: from the last close before the date to the close the day after. */
function reaction(bars: Bar[], date: string): number | null {
  const i = bars.findIndex((b) => b.date >= date);
  if (i <= 0 || i + 1 >= bars.length) return null;
  return bars[i + 1].close / bars[i - 1].close - 1;
}

export async function earningsView(ticker: string): Promise<EarningsView> {
  const [rows, bars, est] = await Promise.all([fmpEarnings(ticker), history(ticker).catch(() => [] as Bar[]), estimates(ticker, "annual").catch(() => [])]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter((r) => r.date >= today && r.epsActual === null).sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;
  const past = rows.filter((r) => r.epsActual !== null && r.date < today).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16);
  const quarters = past.map((r) => ({
    date: r.date, epsActual: r.epsActual as number, epsEstimated: r.epsEstimated,
    epsSurprise: r.epsEstimated ? (r.epsActual as number) / r.epsEstimated - 1 : null,
    revenueActual: r.revenueActual, revenueEstimated: r.revenueEstimated,
    revenueSurprise: r.revenueActual && r.revenueEstimated ? r.revenueActual / r.revenueEstimated - 1 : null,
    move: reaction(bars, r.date),
  }));
  const epsN = quarters.filter((q) => q.epsEstimated !== null), revN = quarters.filter((q) => q.revenueSurprise !== null);
  const eb = betaRate(epsN.filter((q) => q.epsActual > (q.epsEstimated as number)).length, epsN.length);
  const rb = betaRate(revN.filter((q) => (q.revenueSurprise as number) > 0).length, revN.length);
  const moves = quarters.map((q) => q.move).filter((m): m is number => m !== null).map(Math.abs);
  const year = new Date().getUTCFullYear();
  return {
    ticker: ticker.toUpperCase(),
    next: upcoming ? { date: upcoming.date, epsEstimated: upcoming.epsEstimated, revenueEstimated: upcoming.revenueEstimated } : null,
    quarters,
    beat: { eps: { rate: eb.mean, lo: eb.lo, hi: eb.hi, n: epsN.length }, revenue: { rate: rb.mean, lo: rb.lo, hi: rb.hi, n: revN.length } },
    move: { median: moves.length ? median(moves) : null, p80: conformalQuantile(moves, 0.2) ?? (moves.length ? quantile(moves, 0.8) : null), n: moves.length },
    annual: est.filter((e) => Number(e.date.slice(0, 4)) >= year - 1).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 5).map((e) => ({ year: e.date.slice(0, 4), revenueAvg: e.revenueAvg / 1e6, revenueLow: e.revenueLow / 1e6, revenueHigh: e.revenueHigh / 1e6, epsAvg: e.epsAvg, analysts: e.numAnalystsEps })),
  };
}

const BUY = /buy|outperform|overweight|accumulate|strong buy|positive|add|top pick/i;
const SELL = /sell|underperform|underweight|reduce|negative/i;
export const gradeBucket = (g: string): "buy" | "hold" | "sell" => (SELL.test(g) ? "sell" : BUY.test(g) ? "buy" : "hold");

export type AnalystView = {
  ticker: string; last: number | null;
  target: { high: number; low: number; consensus: number; median: number; upside: number | null; dispersion: number | null } | null;
  counts: { buy: number; hold: number; sell: number };
  firms: { firm: string; grade: string; bucket: "buy" | "hold" | "sell"; date: string; action: string }[];
  drift: { upgrades90: number; downgrades90: number; net: number; label: string };
  snapshot: Awaited<ReturnType<typeof ratingSnapshot>>;
};

export async function analystView(ticker: string): Promise<AnalystView> {
  const [g, t, snap, company] = await Promise.all([grades(ticker).catch(() => []), priceTarget(ticker), ratingSnapshot(ticker), getCompanyData(ticker).catch(() => null)]);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10), q = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const latestByFirm = new Map<string, (typeof g)[number]>();
  for (const x of [...g].sort((a, b) => (a.date < b.date ? 1 : -1))) if (x.date >= yearAgo && !latestByFirm.has(x.gradingCompany)) latestByFirm.set(x.gradingCompany, x);
  const firms = [...latestByFirm.values()].map((x) => ({ firm: x.gradingCompany, grade: x.newGrade, bucket: gradeBucket(x.newGrade), date: x.date, action: x.action }));
  const recent = g.filter((x) => x.date >= q);
  const up = recent.filter((x) => /upgrade/i.test(x.action)).length, down = recent.filter((x) => /downgrade/i.test(x.action)).length;
  const last = company?.price?.last ?? null;
  return {
    ticker: ticker.toUpperCase(), last,
    target: t ? { high: t.targetHigh, low: t.targetLow, consensus: t.targetConsensus, median: t.targetMedian, upside: last ? t.targetConsensus / last - 1 : null, dispersion: t.targetConsensus ? (t.targetHigh - t.targetLow) / t.targetConsensus : null } : null,
    counts: { buy: firms.filter((f) => f.bucket === "buy").length, hold: firms.filter((f) => f.bucket === "hold").length, sell: firms.filter((f) => f.bucket === "sell").length },
    firms,
    drift: { upgrades90: up, downgrades90: down, net: up - down, label: up - down >= 2 ? "Ratings are improving: more upgrades than downgrades in 90 days." : down - up >= 2 ? "The Street is cooling: more downgrades than upgrades in 90 days." : "No clear drift in ratings over 90 days." },
    snapshot: snap,
  };
}

export type DividendView = {
  ticker: string; payments: { date: string; amount: number; payDate: string }[];
  ttm: number; yield: number | null; frequency: string; growth: { y1: number | null; y3: number | null; y5: number | null };
  payout: number | null; streakYears: number; safety: { score: number; label: "safe" | "watch" | "at risk"; reasons: string[] };
};

export async function dividendView(ticker: string): Promise<DividendView> {
  const [rows, company, earn] = await Promise.all([fmpDividends(ticker), getCompanyData(ticker).catch(() => null), fmpEarnings(ticker).catch(() => [])]);
  const payments = rows.map((r) => ({ date: r.date, amount: r.adjDividend || r.dividend, payDate: r.paymentDate })).sort((a, b) => (a.date < b.date ? 1 : -1));
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const ttm = payments.filter((p) => p.date > yearAgo).reduce((a, p) => a + p.amount, 0);
  const byYear = new Map<number, number>();
  for (const p of payments) { const y = Number(p.date.slice(0, 4)); byYear.set(y, (byYear.get(y) ?? 0) + p.amount); }
  const thisYear = new Date().getUTCFullYear();
  const full = (y: number) => byYear.get(y) ?? null;
  const cagr = (n: number) => { const a = full(thisYear - 1), b = full(thisYear - 1 - n); return a && b ? Math.pow(a / b, 1 / n) - 1 : null; };
  let streak = 0;
  for (let y = thisYear - 1; full(y) && full(y - 1) && (full(y) as number) >= (full(y - 1) as number) * 0.999; y--) streak++;
  const eps = earn.filter((e) => e.epsActual !== null).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4).reduce((a, e) => a + (e.epsActual as number), 0);
  const payout = eps > 0 && ttm > 0 ? ttm / eps : null;
  const last = company?.price?.last ?? null;
  const reasons: string[] = [];
  let score = 100;
  if (payout !== null && payout > 0.9) { score -= 35; reasons.push(`Pays out ${(payout * 100).toFixed(0)}% of earnings.`); } else if (payout !== null && payout > 0.7) { score -= 15; reasons.push(`Payout ratio ${(payout * 100).toFixed(0)}% leaves little room.`); }
  if (eps <= 0 && ttm > 0) { score -= 40; reasons.push("Earnings over the last four quarters do not cover the dividend."); }
  if ((cagr(3) ?? 0) < 0) { score -= 15; reasons.push("The dividend has fallen over three years."); }
  if (streak >= 10) reasons.push(`${streak} straight years without a cut.`);
  const lev = company && company.ltm.ebitda && company.balance.debt ? company.balance.debt / company.ltm.ebitda : null;
  if (lev !== null && lev > 4) { score -= 15; reasons.push(`Debt is ${lev.toFixed(1)}x EBITDA.`); }
  score = Math.max(0, Math.min(100, score));
  return {
    ticker: ticker.toUpperCase(), payments, ttm, yield: last && ttm ? ttm / last : null, frequency: rows[0]?.frequency ?? "",
    growth: { y1: cagr(1), y3: cagr(3), y5: cagr(5) }, payout, streakYears: streak,
    safety: { score, label: score >= 70 ? "safe" : score >= 45 ? "watch" : "at risk", reasons },
  };
}
