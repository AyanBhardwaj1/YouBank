/**
 * The Street views behind EE (earnings), ANR (analysts) and DVD (dividends), with inference on top of
 * the raw feeds: how often a company beats (a Beta-Binomial posterior, so four beats in four quarters
 * is not read as certainty), how far the stock usually moves on the report, where the analyst herd is
 * drifting, and how safe the dividend is.
 *
 * Each view asks its dataset's chain (market/registry.ts): FMP first; when it is out, Nasdaq's earnings,
 * analyst and dividend data stand in, then the company's own SEC filings (reported EPS and revenue with
 * their results 8-K dates; dividends per share by fiscal quarter), and when those fail too, AI research
 * looks up the headline figures (each checked against its source; see research.ts). A person's order and
 * own keys (FMP, Finnhub, Alpha Vantage) apply. The per-source adapters are below; the registry lists them.
 */
import { getCompanyData } from "@/lib/company";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { restate, splitsOf } from "@/lib/edgar/splits";
import { betaRate } from "@/lib/inference/learn";
import { median, quantile } from "@/lib/inference/stats";
import { conformalQuantile } from "@/lib/inference/forecast";
import { history } from "@/lib/market/data";
import { dividends as fmpDividends, earnings as fmpEarnings, estimates, grades, MarketDataError, priceTarget, ratingSnapshot, type Bar } from "@/lib/market/fmp";
import { nasdaqDividends, nasdaqEarningsDate, nasdaqEarningsSurprise, nasdaqEpsForecast, nasdaqRatings, nasdaqTargets } from "@/lib/market/nasdaq";
import { noteSource } from "@/lib/market/provenance";
import { fromChain, isEmptyAnswer, NoSourceError, type Answer, type FetchContext } from "@/lib/market/registry";
import type { AnalystData, DividendData, EarningsData, EarningsQuarter, NextReport } from "@/lib/market/street-types";
import { epsSurprise, trailingEps } from "@/lib/market/units";
import { marketDate, marketYear } from "@/lib/market/calendar";
import { factNum, factStr, research, type Field, type Researched } from "@/lib/market/research";

const subjectOf = async (ticker: string) => { const c = await getCompanyData(ticker).catch(() => null); return { company: c, subject: c ? `${c.name} (${c.exchange ? `${c.exchange}: ` : ""}${c.ticker})` : ticker.toUpperCase() }; };

/** A chain that found nothing anywhere (every source empty, or none may answer) reads as this view being unavailable; other failures keep their own words. */
async function chainOrUnavailable<T>(p: Promise<T>, what: string): Promise<T> {
  try { return await p; } catch (e) {
    if (isEmptyAnswer(e) || e instanceof NoSourceError) throw new MarketDataError(`${what} is unavailable: FMP is out and the backups did not answer`);
    throw e;
  }
}

/* ---------------- Earnings ---------------- */

const mmOrNull = (v: number | null) => (v === null ? null : v / 1e6);

type Quarter = { date: string; epsActual: number; epsEstimated: number | null; epsSurprise: number | null; revenueActual: number | null; revenueEstimated: number | null; revenueSurprise: number | null; move: number | null };

export type EarningsView = {
  ticker: string; next: { date: string; epsEstimated: number | null; revenueEstimated: number | null; estimatedDate?: boolean } | null;
  quarters: Quarter[];
  beat: { eps: { rate: number; lo: number; hi: number; n: number }; revenue: { rate: number; lo: number; hi: number; n: number } };
  move: { median: number | null; p80: number | null; n: number };
  annual: { year: string; revenueAvg: number | null; revenueLow: number | null; revenueHigh: number | null; epsAvg: number | null; analysts: number | null }[];
  /** Figures looked up by AI research when no feed had them, with their sources. */
  research?: Researched | null;
};

/** Close-to-close return spanning the report: from the last close before the date to the close the day after. */
function reaction(bars: Bar[], date: string): number | null {
  const i = bars.findIndex((b) => b.date >= date);
  if (i <= 0 || i + 1 >= bars.length) return null;
  return bars[i + 1].close / bars[i - 1].close - 1;
}

function summarizeQuarters(quarters: Quarter[]) {
  const epsN = quarters.filter((q) => q.epsEstimated !== null), revN = quarters.filter((q) => q.revenueSurprise !== null);
  const eb = betaRate(epsN.filter((q) => q.epsActual > (q.epsEstimated as number)).length, epsN.length);
  const rb = betaRate(revN.filter((q) => (q.revenueSurprise as number) > 0).length, revN.length);
  const moves = quarters.map((q) => q.move).filter((m): m is number => m !== null).map(Math.abs);
  return {
    beat: { eps: { rate: eb.mean, lo: eb.lo, hi: eb.hi, n: epsN.length }, revenue: { rate: rb.mean, lo: rb.lo, hi: rb.hi, n: revN.length } },
    move: { median: moves.length ? median(moves) : null, p80: conformalQuantile(moves, 0.2) ?? (moves.length ? quantile(moves, 0.8) : null), n: moves.length },
  };
}

/** A reported quarter with its surprises, and the price reaction when it is dated by the report (not the period's end). */
const quarterView = (q: EarningsQuarter, bars: Bar[]): Quarter => ({
  date: q.date, epsActual: q.epsActual, epsEstimated: q.epsEstimated, epsSurprise: epsSurprise(q.epsActual, q.epsEstimated),
  revenueActual: q.revenueActual, revenueEstimated: q.revenueEstimated, revenueSurprise: q.revenueActual !== null ? epsSurprise(q.revenueActual, q.revenueEstimated) : null,
  move: q.datedBy === "period" ? null : reaction(bars, q.date),
});

/** FMP: every report on record and the annual consensus (estimates in dollars). */
export async function fmpEarningsData(t: string): Promise<Answer<EarningsData> | null> {
  const [rows, est] = await Promise.all([fmpEarnings(t), estimates(t, "annual").catch(() => [])]);
  if (!rows.length) return null;
  const today = marketDate(), year = marketYear();
  const upcoming = rows.filter((r) => r.date >= today && r.epsActual === null).sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;
  const past = rows.filter((r) => r.epsActual !== null && r.date < today).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16);
  return {
    data: {
      quarters: past.map((r) => ({ date: r.date, epsActual: r.epsActual as number, epsEstimated: r.epsEstimated, revenueActual: r.revenueActual, revenueEstimated: r.revenueEstimated })),
      next: upcoming ? { date: upcoming.date, epsEstimated: upcoming.epsEstimated, revenueEstimated: upcoming.revenueEstimated } : null,
      annual: est.filter((e) => Number(e.date.slice(0, 4)) >= year - 1).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 5).map((e) => ({ year: e.date.slice(0, 4), revenueAvg: e.revenueAvg, revenueLow: e.revenueLow, revenueHigh: e.revenueHigh, epsAvg: e.epsAvg, analysts: e.numAnalystsEps })),
    },
  };
}

/** Nasdaq: earnings surprises, the next date and EPS forecasts; AI research for what Nasdaq lacks, unless only asked to fill fields. */
export async function nasdaqEarningsData(t: string, ctx: FetchContext = {}): Promise<Answer<EarningsData> | null> {
  const [surprise, date, fc] = await Promise.all([nasdaqEarningsSurprise(t).catch(() => []), nasdaqEarningsDate(t).catch(() => null), nasdaqEpsForecast(t).catch(() => ({ quarterly: [], yearly: [] }))]);
  if (!surprise.length && !date?.date) return null;
  const quarters: EarningsQuarter[] = surprise.filter((s) => s.eps !== null && s.reported).map((s) => ({ date: s.reported as string, epsActual: s.eps as number, epsEstimated: s.consensus, revenueActual: null, revenueEstimated: null }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  // Nasdaq's EPS consensus is on the same basis (GAAP or adjusted) as the history beside it, so it
  // wins over a researched one, which may be on the other basis.
  const eps = date?.epsConsensus ?? fc.quarterly[0]?.consensus ?? null;
  let next: NextReport | null = date?.date ? { date: date.date, epsEstimated: eps, revenueEstimated: null, estimatedDate: date.estimated } : null;
  const annual = fc.yearly.map((y) => ({ year: y.period, revenueAvg: null, revenueLow: null, revenueHigh: null, epsAvg: y.consensus, analysts: y.estimates }));
  if (ctx.fill) return { data: { quarters, next, annual } };
  // Nasdaq has no revenue estimates, and its vendor may not have dated the next report yet: one
  // lookup for what is missing (each figure checked against its source).
  const want: Field[] = next ? ["revenueEstimate"] : eps !== null ? ["nextEarningsDate", "revenueEstimate"] : ["nextEarningsDate", "epsEstimate", "revenueEstimate"];
  const r = await research((await subjectOf(t)).subject, want).catch(() => null);
  const researchedDate = next ? null : factStr(r, "nextEarningsDate");
  if (researchedDate) next = { date: researchedDate, epsEstimated: eps ?? factNum(r, "epsEstimate"), revenueEstimated: null };
  const revenue = factNum(r, "revenueEstimate");
  if (next && revenue !== null) next = { ...next, revenueEstimated: revenue };
  const used = !!researchedDate || (!!next && revenue !== null);
  if (used) noteSource("AI research");
  return { data: { quarters, next, annual, research: used ? r : null } };
}

/** AI research for the headline figures: the next date and estimates, and the last report. */
export async function researchEarningsData(t: string): Promise<Answer<EarningsData> | null> {
  const r = await research((await subjectOf(t)).subject, ["nextEarningsDate", "epsEstimate", "revenueEstimate", "lastReportDate", "lastEps", "lastEpsEstimate"]).catch(() => null);
  if (!r) return null;
  const lastDate = factStr(r, "lastReportDate"), lastEps = factNum(r, "lastEps"), nextDate = factStr(r, "nextEarningsDate");
  return {
    data: {
      quarters: lastDate && lastEps !== null ? [{ date: lastDate, epsActual: lastEps, epsEstimated: factNum(r, "lastEpsEstimate"), revenueActual: null, revenueEstimated: null }] : [],
      next: nextDate ? { date: nextDate, epsEstimated: factNum(r, "epsEstimate"), revenueEstimated: factNum(r, "revenueEstimate") } : null, annual: [], research: r,
    },
  };
}

export async function earningsView(ticker: string): Promise<EarningsView> {
  const t = ticker.toUpperCase();
  const [a, bars] = await Promise.all([chainOrUnavailable(fromChain("earnings", { symbol: t }), "Earnings data"), history(t).catch(() => [] as Bar[])]);
  const quarters = a.data.quarters.map((q) => quarterView(q, bars));
  return {
    ticker: t, next: a.data.next, quarters, ...summarizeQuarters(quarters),
    annual: a.data.annual.map((y) => ({ ...y, revenueAvg: mmOrNull(y.revenueAvg), revenueLow: mmOrNull(y.revenueLow), revenueHigh: mmOrNull(y.revenueHigh) })),
    ...(a.data.research !== undefined ? { research: a.data.research } : {}),
  };
}

/* ---------------- Analysts ---------------- */

const BUY = /buy|outperform|overweight|accumulate|strong buy|positive|add|top pick/i;
const SELL = /sell|underperform|underweight|reduce|negative/i;
export const gradeBucket = (g: string): "buy" | "hold" | "sell" => (SELL.test(g) ? "sell" : BUY.test(g) ? "buy" : "hold");

export type AnalystView = {
  ticker: string; last: number | null;
  target: { high: number; low: number; consensus: number; median: number; upside: number | null; dispersion: number | null } | null;
  /** Null when no source reported the counts (not zero ratings); a count a source left out is null too. */
  counts: { buy: number | null; hold: number | null; sell: number | null } | null;
  firms: { firm: string; grade: string; bucket: "buy" | "hold" | "sell"; date: string; action: string }[];
  drift: { upgrades90: number; downgrades90: number; net: number; label: string };
  snapshot: AnalystData["snapshot"];
  /** The consensus rating in words, when a backup reports it. */
  consensusRating?: string;
  research?: Researched | null;
};

const driftOf = (actions: { date: string; action: string }[]) => {
  const q = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = actions.filter((x) => x.date >= q);
  const up = recent.filter((x) => /upgrade/i.test(x.action)).length, down = recent.filter((x) => /downgrade/i.test(x.action)).length;
  return { upgrades90: up, downgrades90: down, net: up - down, label: up - down >= 2 ? "Ratings are improving: more upgrades than downgrades in 90 days." : down - up >= 2 ? "The Street is cooling: more downgrades than upgrades in 90 days." : "No clear drift in ratings over 90 days." };
};
const targetOf = (hi: number | null, lo: number | null, mean: number | null, last: number | null, med?: number | null) =>
  mean !== null ? { high: hi ?? mean, low: lo ?? mean, consensus: mean, median: med ?? mean, upside: last ? mean / last - 1 : null, dispersion: hi !== null && lo !== null && mean ? (hi - lo) / mean : null } : null;
const bucketCounts = (firms: { grade: string }[]) => ({ buy: firms.filter((f) => gradeBucket(f.grade) === "buy").length, hold: firms.filter((f) => gradeBucket(f.grade) === "hold").length, sell: firms.filter((f) => gradeBucket(f.grade) === "sell").length });

/** FMP: grades (the latest per firm within a year), the target consensus and its rating snapshot. */
export async function fmpAnalystData(t: string): Promise<Answer<AnalystData> | null> {
  // Grades failing on their own leave the target to answer (FMP's call is recorded as failed either way).
  const [g, tg, snap] = await Promise.all([grades(t).catch(() => [] as Awaited<ReturnType<typeof grades>>), priceTarget(t), ratingSnapshot(t)]);
  if (!g.length && !tg) return null;
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const latestByFirm = new Map<string, (typeof g)[number]>();
  for (const x of [...g].sort((a, b) => (a.date < b.date ? 1 : -1))) if (x.date >= yearAgo && !latestByFirm.has(x.gradingCompany)) latestByFirm.set(x.gradingCompany, x);
  const firms = [...latestByFirm.values()].map((x) => ({ firm: x.gradingCompany, grade: x.newGrade, date: x.date, action: x.action }));
  return { data: { target: tg ? { high: tg.targetHigh, low: tg.targetLow, mean: tg.targetConsensus, median: tg.targetMedian } : null, counts: bucketCounts(firms), firms, actions: g, snapshot: snap } };
}

/** Nasdaq: consensus targets and rating changes. */
export async function nasdaqAnalystData(t: string): Promise<Answer<AnalystData> | null> {
  const [nt, nr] = await Promise.all([nasdaqTargets(t).catch(() => null), nasdaqRatings(t).catch(() => null)]);
  if (!nt && !nr?.actions.length) return null;
  const firms = (nr?.actions ?? []).filter((a) => a.date).map((a) => ({ firm: a.firm, grade: a.to || a.action, date: a.date as string, action: a.action }));
  return {
    data: {
      target: nt && nt.mean !== null ? { high: nt.high, low: nt.low, mean: nt.mean, median: null } : null,
      counts: nt ? { buy: nt.buy, hold: nt.hold, sell: nt.sell } : null,
      firms, actions: firms, snapshot: null, consensusRating: nr?.mean || undefined,
    },
  };
}

/** AI research for the consensus. A count it could not confirm stays null, never 0. */
export async function researchAnalystData(t: string): Promise<Answer<AnalystData> | null> {
  const r = await research((await subjectOf(t)).subject, ["rating", "analysts", "buy", "hold", "sell", "targetMean", "targetHigh", "targetLow"]).catch(() => null);
  if (!r) return null;
  const mean = factNum(r, "targetMean");
  return {
    data: {
      target: mean !== null ? { high: factNum(r, "targetHigh"), low: factNum(r, "targetLow"), mean, median: null } : null,
      counts: { buy: factNum(r, "buy"), hold: factNum(r, "hold"), sell: factNum(r, "sell") }, firms: [], actions: [], snapshot: null, consensusRating: factStr(r, "rating") ?? undefined, research: r,
    },
  };
}

export async function analystView(ticker: string): Promise<AnalystView> {
  const t = ticker.toUpperCase();
  const [a, company] = await Promise.all([chainOrUnavailable(fromChain("analysts", { symbol: t }), "Analyst data"), getCompanyData(t).catch(() => null)]);
  const last = company?.price?.last ?? null, d = a.data;
  return {
    ticker: t, last, target: d.target ? targetOf(d.target.high, d.target.low, d.target.mean, last, d.target.median) : null, counts: d.counts,
    firms: d.firms.map((f) => ({ ...f, bucket: gradeBucket(f.grade) })), drift: driftOf(d.actions), snapshot: d.snapshot,
    ...(d.consensusRating ? { consensusRating: d.consensusRating } : {}), ...(d.research !== undefined ? { research: d.research } : {}),
  };
}

/* ---------------- Dividends ---------------- */

export type DividendView = {
  ticker: string; payments: { date: string; amount: number; payDate: string | null }[];
  ttm: number | null; yield: number | null; frequency: string; growth: { y1: number | null; y3: number | null; y5: number | null };
  payout: number | null; streakYears: number; safety: { score: number; label: "safe" | "watch" | "at risk"; reasons: string[] };
  /** "fiscal quarter" when payments are per-share dividends by fiscal quarter from filings, not by ex-date. */
  basis?: "ex-date" | "fiscal quarter";
  /** Dividends per share by fiscal year from 10-Ks, when the history comes from filings. */
  annual?: { year: number; amount: number }[];
  research?: Researched | null;
};

function safetyOf(payout: number | null, epsTtm: number | null, ttm: number | null, cagr3: number | null, streak: number, leverage: number | null) {
  const reasons: string[] = [];
  let score = 100;
  if (payout !== null && payout > 0.9) { score -= 35; reasons.push(`Pays out ${(payout * 100).toFixed(0)}% of earnings.`); } else if (payout !== null && payout > 0.7) { score -= 15; reasons.push(`Payout ratio ${(payout * 100).toFixed(0)}% leaves little room.`); }
  if (epsTtm !== null && epsTtm <= 0 && ttm !== null && ttm > 0) { score -= 40; reasons.push("Earnings over the last four quarters do not cover the dividend."); }
  if ((cagr3 ?? 0) < 0) { score -= 15; reasons.push("The dividend has fallen over three years."); }
  if (streak >= 10) reasons.push(`${streak} straight years without a cut.`);
  if (leverage !== null && leverage > 4) { score -= 15; reasons.push(`Debt is ${leverage.toFixed(1)}x EBITDA.`); }
  score = Math.max(0, Math.min(100, score));
  return { score, label: (score >= 70 ? "safe" : score >= 45 ? "watch" : "at risk") as "safe" | "watch" | "at risk", reasons };
}

/** Overrides for a source that knows better: its payout ratio, its latest twelve months, its fiscal years. */
type PaymentOpts = { payout?: number | null; ttm?: number | null; annual?: { year: number; amount: number }[] };

function fromPayments(ticker: string, payments: DividendView["payments"], last: number | null, epsTtm: number | null, leverage: number | null, frequency: string, opts: PaymentOpts = {}): DividendView {
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const ttm = opts.ttm ?? sorted.filter((p) => p.date > yearAgo).reduce((a, p) => a + p.amount, 0);
  // Whole years: fiscal years from 10-Ks when given, else calendar years of payments (this one is partial).
  const byYear = new Map<number, number>();
  if (opts.annual?.length) for (const a of opts.annual) byYear.set(a.year, a.amount);
  else for (const p of sorted) { const y = Number(p.date.slice(0, 4)); byYear.set(y, (byYear.get(y) ?? 0) + p.amount); }
  const base = opts.annual?.length ? Math.max(...byYear.keys()) : marketYear() - 1;
  const full = (y: number) => byYear.get(y) ?? null;
  const cagr = (n: number) => { const a = full(base), b = full(base - n); return a && b ? Math.pow(a / b, 1 / n) - 1 : null; };
  let streak = 0;
  for (let y = base; full(y) && full(y - 1) && (full(y) as number) >= (full(y - 1) as number) * 0.999; y--) streak++;
  const payout = opts.payout ?? (epsTtm && epsTtm > 0 && ttm > 0 ? ttm / epsTtm : null);
  return {
    ticker, payments: sorted, ttm, yield: last && ttm ? ttm / last : null, frequency,
    growth: { y1: cagr(1), y3: cagr(3), y5: cagr(5) }, payout, streakYears: streak,
    safety: safetyOf(payout, epsTtm, ttm, cagr(3), streak, leverage),
    ...(opts.annual ? { annual: opts.annual } : {}),
  };
}

/** FMP: every dividend on record (empty means none), with trailing EPS from its earnings for the payout ratio. */
export async function fmpDividendData(t: string): Promise<Answer<DividendData> | null> {
  const rows = await fmpDividends(t);
  const earn = await fmpEarnings(t).catch(() => null);
  const epsTtm = trailingEps((earn ?? []).filter((e) => e.epsActual !== null).sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => e.epsActual));
  const payments = rows.flatMap((r) => { const amount = r.adjDividend || r.dividend; return amount ? [{ date: r.date, amount, payDate: r.paymentDate || null }] : []; });
  return { data: { payments, frequency: rows[0]?.frequency ?? "", basis: "ex-date", epsTtm } };
}

/** Nasdaq: dividend history and payout ratio (Nasdaq-listed stocks only), as paid (restated for splits by the view). */
export async function nasdaqDividendData(t: string): Promise<Answer<DividendData> | null> {
  const [nd, surprise] = await Promise.all([nasdaqDividends(t).catch(() => null), nasdaqEarningsSurprise(t).catch(() => [])]);
  if (!nd || (!nd.payments.length && nd.annualized === null)) return null;
  const payments = nd.payments.map((p) => ({ date: p.exDate, amount: p.amount, payDate: p.payDate ?? null })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { data: { payments, frequency: "", basis: "ex-date", payout: nd.payoutRatio, epsTtm: trailingEps(surprise.slice(0, 4).map((s) => s.eps)), restate: "paid" } };
}

/** AI research for the current dividend. A dividend the lookup could not confirm is unknown (null), not "no dividend". */
export async function researchDividendData(t: string): Promise<Answer<DividendData> | null> {
  const r = await research((await subjectOf(t)).subject, ["annualDividend", "dividendYield", "exDividendDate", "payoutRatio"]).catch(() => null);
  if (!r) return null;
  return { data: { payments: [], frequency: "", basis: "ex-date", ttm: factNum(r, "annualDividend"), payout: factNum(r, "payoutRatio"), yield: factNum(r, "dividendYield"), research: r } };
}

/** The view from a source's dividends: computed growth, payout and safety, with the company's price and leverage. */
async function dividendFrom(t: string, d: DividendData, company: Awaited<ReturnType<typeof getCompanyData>>): Promise<DividendView> {
  const last = company?.price?.last ?? null;
  const lev = company && company.ltm.ebitda && company.balance.debt ? company.balance.debt / company.ltm.ebitda : null;
  if (d.research && !d.payments.length) {
    const annual = d.ttm ?? null, payout = d.payout ?? null;
    return { ticker: t, payments: [], ttm: annual, yield: d.yield ?? (last && annual ? annual / last : null), frequency: "", growth: { y1: null, y3: null, y5: null }, payout, streakYears: 0, safety: safetyOf(payout, null, annual, null, 0, lev), research: d.research };
  }
  let payments = d.payments;
  if (d.restate === "paid") {
    // Nasdaq lists dividends as paid; restate them for the splits the filings show.
    const cf = company?.cik ? await getCompanyFacts(company.cik.padStart(10, "0")).catch(() => null) : null;
    payments = restate(payments, cf ? splitsOf(cf) : [], "paid");
  }
  const companyEps = company && company.ltm.netIncome !== null && company.balance.sharesOut ? company.ltm.netIncome / company.balance.sharesOut : null;
  const eps = d.epsTtm !== undefined ? d.epsTtm : companyEps;
  const view = fromPayments(t, payments, last, eps, lev, d.frequency, { ...(d.payout !== undefined ? { payout: d.payout } : {}), ...(d.ttm !== undefined ? { ttm: d.ttm } : {}), ...(d.annual ? { annual: d.annual } : {}) });
  return d.basis === "fiscal quarter" ? { ...view, basis: "fiscal quarter" } : view;
}

export async function dividendView(ticker: string): Promise<DividendView> {
  const t = ticker.toUpperCase();
  const [a, company] = await Promise.all([chainOrUnavailable(fromChain("dividends", { symbol: t }), "Dividend data"), getCompanyData(t).catch(() => null)]);
  return dividendFrom(t, a.data, company);
}
