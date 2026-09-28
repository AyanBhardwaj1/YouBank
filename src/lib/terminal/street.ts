/**
 * The Street views behind EE (earnings), ANR (analysts) and DVD (dividends), with inference on top of
 * the raw feeds: how often a company beats (a Beta-Binomial posterior, so four beats in four quarters
 * is not read as certainty), how far the stock usually moves on the report, where the analyst herd is
 * drifting, and how safe the dividend is.
 *
 * FMP first. When it is out, Nasdaq's earnings, analyst and dividend data stand in (dividends per share
 * from the company's own filings where Nasdaq has no history), and when that fails too, AI research looks
 * up the headline figures (each checked against its source; see research.ts).
 */
import { getCompanyData } from "@/lib/company";
import { addDays, addMonths, getCompanyFacts, latestEnd, pickConcept, quarterAt, quarterEnds, rowsFor } from "@/lib/edgar/facts";
import { restate, splitsOf } from "@/lib/edgar/splits";
import { betaRate } from "@/lib/inference/learn";
import { median, quantile } from "@/lib/inference/stats";
import { conformalQuantile } from "@/lib/inference/forecast";
import { history } from "@/lib/market/data";
import { dividends as fmpDividends, earnings as fmpEarnings, estimates, grades, MarketDataError, priceTarget, ratingSnapshot, type Bar } from "@/lib/market/fmp";
import { backupEnabled, nasdaqDividends, nasdaqEarningsDate, nasdaqEarningsSurprise, nasdaqEpsForecast, nasdaqRatings, nasdaqTargets } from "@/lib/market/nasdaq";
import { noteSource } from "@/lib/market/provenance";
import { factNum, factStr, research, type Field, type Researched } from "@/lib/market/research";

/** FMP's answer, or null when FMP is out (a plan limit), so the caller can fall back. Other errors still throw. */
const orNull = <T>(p: Promise<T>) => p.catch((e) => { if (e instanceof MarketDataError) return null; throw e; });
const subjectOf = async (ticker: string) => { const c = await getCompanyData(ticker).catch(() => null); return { company: c, subject: c ? `${c.name} (${c.exchange ? `${c.exchange}: ` : ""}${c.ticker})` : ticker.toUpperCase() }; };

/* ---------------- Earnings ---------------- */

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

export async function earningsView(ticker: string): Promise<EarningsView> {
  const t = ticker.toUpperCase();
  const [rows, bars, est] = await Promise.all([orNull(fmpEarnings(t)), history(t).catch(() => [] as Bar[]), estimates(t, "annual").catch(() => [])]);
  const today = new Date().toISOString().slice(0, 10);
  if (rows?.length) {
    noteSource("FMP");
    const upcoming = rows.filter((r) => r.date >= today && r.epsActual === null).sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;
    const past = rows.filter((r) => r.epsActual !== null && r.date < today).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16);
    const quarters = past.map((r) => ({
      date: r.date, epsActual: r.epsActual as number, epsEstimated: r.epsEstimated,
      epsSurprise: r.epsEstimated ? (r.epsActual as number) / r.epsEstimated - 1 : null,
      revenueActual: r.revenueActual, revenueEstimated: r.revenueEstimated,
      revenueSurprise: r.revenueActual && r.revenueEstimated ? r.revenueActual / r.revenueEstimated - 1 : null,
      move: reaction(bars, r.date),
    }));
    const year = new Date().getUTCFullYear();
    return {
      ticker: t, next: upcoming ? { date: upcoming.date, epsEstimated: upcoming.epsEstimated, revenueEstimated: upcoming.revenueEstimated } : null,
      quarters, ...summarizeQuarters(quarters),
      annual: est.filter((e) => Number(e.date.slice(0, 4)) >= year - 1).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 5).map((e) => ({ year: e.date.slice(0, 4), revenueAvg: e.revenueAvg / 1e6, revenueLow: e.revenueLow / 1e6, revenueHigh: e.revenueHigh / 1e6, epsAvg: e.epsAvg, analysts: e.numAnalystsEps })),
    };
  }
  // Backup 1: Nasdaq's earnings surprises, next date and EPS forecasts.
  if (backupEnabled()) {
    const [surprise, date, fc] = await Promise.all([nasdaqEarningsSurprise(t).catch(() => []), nasdaqEarningsDate(t).catch(() => null), nasdaqEpsForecast(t).catch(() => ({ quarterly: [], yearly: [] }))]);
    if (surprise.length || date?.date) {
      noteSource("Nasdaq");
      const quarters: Quarter[] = surprise.filter((s) => s.eps !== null && s.reported).map((s) => ({
        date: s.reported as string, epsActual: s.eps as number, epsEstimated: s.consensus,
        epsSurprise: s.consensus ? (s.eps as number) / s.consensus - 1 : null, revenueActual: null, revenueEstimated: null, revenueSurprise: null,
        move: reaction(bars, s.reported as string),
      })).sort((a, b) => (a.date < b.date ? 1 : -1));
      // Nasdaq's EPS consensus is on the same basis (GAAP or adjusted) as the history beside it, so it
      // wins over a researched one, which may be on the other basis.
      const eps = date?.epsConsensus ?? fc.quarterly[0]?.consensus ?? null;
      let next: EarningsView["next"] = date?.date ? { date: date.date, epsEstimated: eps, revenueEstimated: null, estimatedDate: date.estimated } : null;
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
      return {
        ticker: t, next, quarters, ...summarizeQuarters(quarters),
        annual: fc.yearly.map((y) => ({ year: y.period, revenueAvg: null, revenueLow: null, revenueHigh: null, epsAvg: y.consensus, analysts: y.estimates })),
        research: used ? r : null,
      };
    }
  }
  // Backup 2: AI research for the headline figures.
  const { subject } = await subjectOf(t);
  const r = await research(subject, ["nextEarningsDate", "epsEstimate", "revenueEstimate", "lastReportDate", "lastEps", "lastEpsEstimate"]).catch(() => null);
  if (!r) throw new MarketDataError("Earnings data is unavailable: FMP is out and the backups did not answer");
  noteSource("AI research");
  const lastDate = factStr(r, "lastReportDate"), lastEps = factNum(r, "lastEps"), lastEst = factNum(r, "lastEpsEstimate");
  const quarters: Quarter[] = lastDate && lastEps !== null ? [{ date: lastDate, epsActual: lastEps, epsEstimated: lastEst, epsSurprise: lastEst ? lastEps / lastEst - 1 : null, revenueActual: null, revenueEstimated: null, revenueSurprise: null, move: reaction(bars, lastDate) }] : [];
  const nextDate = factStr(r, "nextEarningsDate");
  return {
    ticker: t, next: nextDate ? { date: nextDate, epsEstimated: factNum(r, "epsEstimate"), revenueEstimated: factNum(r, "revenueEstimate") } : null,
    quarters, ...summarizeQuarters(quarters), annual: [], research: r,
  };
}

/* ---------------- Analysts ---------------- */

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

export async function analystView(ticker: string): Promise<AnalystView> {
  const t = ticker.toUpperCase();
  const [g, tg, snap, company] = await Promise.all([orNull(grades(t)), priceTarget(t), ratingSnapshot(t), getCompanyData(t).catch(() => null)]);
  const last = company?.price?.last ?? null;
  if (g?.length || tg) {
    noteSource("FMP");
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const latestByFirm = new Map<string, NonNullable<typeof g>[number]>();
    for (const x of [...(g ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))) if (x.date >= yearAgo && !latestByFirm.has(x.gradingCompany)) latestByFirm.set(x.gradingCompany, x);
    const firms = [...latestByFirm.values()].map((x) => ({ firm: x.gradingCompany, grade: x.newGrade, bucket: gradeBucket(x.newGrade), date: x.date, action: x.action }));
    return {
      ticker: t, last, target: tg ? targetOf(tg.targetHigh, tg.targetLow, tg.targetConsensus, last, tg.targetMedian) : null,
      counts: { buy: firms.filter((f) => f.bucket === "buy").length, hold: firms.filter((f) => f.bucket === "hold").length, sell: firms.filter((f) => f.bucket === "sell").length },
      firms, drift: driftOf(g ?? []), snapshot: snap,
    };
  }
  // Backup 1: Nasdaq's consensus targets and rating changes.
  if (backupEnabled()) {
    const [nt, nr] = await Promise.all([nasdaqTargets(t).catch(() => null), nasdaqRatings(t).catch(() => null)]);
    if (nt || nr?.actions.length) {
      noteSource("Nasdaq");
      const firms = (nr?.actions ?? []).filter((a) => a.date).map((a) => ({ firm: a.firm, grade: a.to || a.action, bucket: gradeBucket(a.to || a.action), date: a.date as string, action: a.action }));
      return {
        ticker: t, last, target: nt ? targetOf(nt.high, nt.low, nt.mean, last) : null,
        counts: nt ? { buy: nt.buy, hold: nt.hold, sell: nt.sell } : { buy: 0, hold: 0, sell: 0 },
        firms, drift: driftOf(firms), snapshot: null, consensusRating: nr?.mean || undefined,
      };
    }
  }
  // Backup 2: AI research for the consensus.
  const { subject } = await subjectOf(t);
  const r = await research(subject, ["rating", "analysts", "buy", "hold", "sell", "targetMean", "targetHigh", "targetLow"]).catch(() => null);
  if (!r) throw new MarketDataError("Analyst data is unavailable: FMP is out and the backups did not answer");
  noteSource("AI research");
  return {
    ticker: t, last, target: targetOf(factNum(r, "targetHigh"), factNum(r, "targetLow"), factNum(r, "targetMean"), last),
    counts: { buy: factNum(r, "buy") ?? 0, hold: factNum(r, "hold") ?? 0, sell: factNum(r, "sell") ?? 0 },
    firms: [], drift: driftOf([]), snapshot: null, consensusRating: factStr(r, "rating") ?? undefined, research: r,
  };
}

/* ---------------- Dividends ---------------- */

export type DividendView = {
  ticker: string; payments: { date: string; amount: number; payDate: string }[];
  ttm: number; yield: number | null; frequency: string; growth: { y1: number | null; y3: number | null; y5: number | null };
  payout: number | null; streakYears: number; safety: { score: number; label: "safe" | "watch" | "at risk"; reasons: string[] };
  /** "fiscal quarter" when payments are per-share dividends by fiscal quarter from filings, not by ex-date. */
  basis?: "ex-date" | "fiscal quarter";
  /** Dividends per share by fiscal year from 10-Ks, when the history comes from filings. */
  annual?: { year: number; amount: number }[];
  research?: Researched | null;
};

const DPS = ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"];
/** The fiscal year a period ending on `end` belongs to (a 52-week year ending 2023-01-01 is fiscal 2022). */
const fiscalYear = (end: string) => Number(addDays(end, -45).slice(0, 4));

/**
 * Dividends per share from the company's 10-K and 10-Q filings, restated for splits: by fiscal quarter
 * (oldest first), by fiscal year, and the latest twelve months. Empty when the filings show no dividend;
 * null when they cannot tell (no filings, dividends paid with no per-share figure tagged, or too little
 * history for a year's worth).
 */
async function secDividends(cik: string): Promise<{ quarters: { date: string; amount: number }[]; annual: { year: number; amount: number }[]; ttm: number | null } | null> {
  const cf = await getCompanyFacts(cik.padStart(10, "0")).catch(() => null);
  if (!cf) return null;
  const today = new Date().toISOString().slice(0, 10);
  const dps = pickConcept(cf, DPS, "USD/shares");
  const latest = dps ? latestEnd(dps.rows) : null;
  if (!dps || !latest || latest < addMonths(today, -18)) {
    const paid = pickConcept(cf, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]);
    return paid?.rows.some((r) => r.end >= addMonths(today, -24) && r.val > 0) ? null : { quarters: [], annual: [], ttm: null };
  }
  // A company that switched tags (declared to paid, or back) keeps its older history under the other
  // one. Only history that joins up is used: stray old rows are often mis-tagged.
  const earliest = dps.rows[0].end;
  const older = DPS.filter((c) => c !== dps.concept).flatMap((c) => rowsFor(cf, "us-gaap", c, "USD/shares")).filter((r) => r.end < earliest);
  const joins = older.some((r) => r.end >= addMonths(earliest, -15));
  const rows = [...(joins ? older : []), ...dps.rows];
  const splits = splitsOf(cf);
  const quarters = restate(quarterEnds(rows, latest, 64).map((date) => ({ date, amount: quarterAt(rows, date) ?? 0 })).filter((q) => q.amount > 0), splits, "filed");
  const years = restate(rows.filter((r) => r.start && r.days >= 350 && r.days <= 380).map((r) => ({ date: r.end, amount: r.val })), splits, "filed");
  // The latest twelve months: four straight quarters, else a fiscal year ended in the last six months.
  // A new registrant (after a reorganization, say) may have neither yet; then the filings cannot tell.
  const last4 = quarters.slice(-4), lastYear = years.at(-1);
  const ttm = last4.length === 4 && last4[0].date >= addDays(latest, -320) ? last4.reduce((a, q) => a + q.amount, 0) : lastYear && lastYear.date >= addMonths(latest, -6) ? lastYear.amount : null;
  if (ttm === null) return null;
  return { quarters, annual: years.map((r) => ({ year: fiscalYear(r.date), amount: r.amount })), ttm };
}

function safetyOf(payout: number | null, epsTtm: number | null, ttm: number, cagr3: number | null, streak: number, leverage: number | null) {
  const reasons: string[] = [];
  let score = 100;
  if (payout !== null && payout > 0.9) { score -= 35; reasons.push(`Pays out ${(payout * 100).toFixed(0)}% of earnings.`); } else if (payout !== null && payout > 0.7) { score -= 15; reasons.push(`Payout ratio ${(payout * 100).toFixed(0)}% leaves little room.`); }
  if (epsTtm !== null && epsTtm <= 0 && ttm > 0) { score -= 40; reasons.push("Earnings over the last four quarters do not cover the dividend."); }
  if ((cagr3 ?? 0) < 0) { score -= 15; reasons.push("The dividend has fallen over three years."); }
  if (streak >= 10) reasons.push(`${streak} straight years without a cut.`);
  if (leverage !== null && leverage > 4) { score -= 15; reasons.push(`Debt is ${leverage.toFixed(1)}x EBITDA.`); }
  score = Math.max(0, Math.min(100, score));
  return { score, label: (score >= 70 ? "safe" : score >= 45 ? "watch" : "at risk") as "safe" | "watch" | "at risk", reasons };
}

/** Overrides for a source that knows better: its payout ratio, its latest twelve months, its fiscal years. */
type PaymentOpts = { payout?: number | null; ttm?: number | null; annual?: { year: number; amount: number }[] };

function fromPayments(ticker: string, payments: { date: string; amount: number; payDate: string }[], last: number | null, epsTtm: number | null, leverage: number | null, frequency: string, opts: PaymentOpts = {}): DividendView {
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const ttm = opts.ttm ?? sorted.filter((p) => p.date > yearAgo).reduce((a, p) => a + p.amount, 0);
  // Whole years: fiscal years from 10-Ks when given, else calendar years of payments (this one is partial).
  const byYear = new Map<number, number>();
  if (opts.annual?.length) for (const a of opts.annual) byYear.set(a.year, a.amount);
  else for (const p of sorted) { const y = Number(p.date.slice(0, 4)); byYear.set(y, (byYear.get(y) ?? 0) + p.amount); }
  const base = opts.annual?.length ? Math.max(...byYear.keys()) : new Date().getUTCFullYear() - 1;
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

export async function dividendView(ticker: string): Promise<DividendView> {
  const t = ticker.toUpperCase();
  const [rows, company] = await Promise.all([orNull(fmpDividends(t)), getCompanyData(t).catch(() => null)]);
  const last = company?.price?.last ?? null;
  const lev = company && company.ltm.ebitda && company.balance.debt ? company.balance.debt / company.ltm.ebitda : null;
  if (rows) {
    noteSource("FMP");
    const earn = await orNull(fmpEarnings(t)).catch(() => null);
    const eps = (earn ?? []).filter((e) => e.epsActual !== null).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4).reduce((a, e) => a + (e.epsActual as number), 0);
    return fromPayments(t, rows.map((r) => ({ date: r.date, amount: r.adjDividend || r.dividend, payDate: r.paymentDate })), last, earn?.length ? eps : null, lev, rows[0]?.frequency ?? "");
  }
  // Backup 1: Nasdaq's dividend history and payout ratio (Nasdaq-listed stocks only).
  if (backupEnabled()) {
    const [nd, surprise] = await Promise.all([nasdaqDividends(t).catch(() => null), nasdaqEarningsSurprise(t).catch(() => [])]);
    if (nd && (nd.payments.length || nd.annualized !== null)) {
      noteSource("Nasdaq");
      const eps = surprise.slice(0, 4).reduce((a, s) => a + (s.eps ?? 0), 0);
      // Nasdaq lists dividends as paid; restate them for the splits the filings show.
      const cf = company?.cik ? await getCompanyFacts(company.cik.padStart(10, "0")).catch(() => null) : null;
      const paid = nd.payments.map((p) => ({ date: p.exDate, amount: p.amount, payDate: p.payDate ?? "" })).sort((a, b) => (a.date < b.date ? -1 : 1));
      return fromPayments(t, restate(paid, cf ? splitsOf(cf) : [], "paid"), last, surprise.length >= 4 ? eps : null, lev, "", { payout: nd.payoutRatio });
    }
  }
  // Backup 2: dividends per share from the company's own filings. Nasdaq has dividend history only for
  // Nasdaq-listed stocks; the filings cover every US filer, by fiscal quarter rather than ex-date.
  const sec = company?.cik ? await secDividends(company.cik) : null;
  if (sec) {
    noteSource("SEC EDGAR", "Dividends per share from 10-K and 10-Q filings, by fiscal quarter");
    const eps = company && company.ltm.netIncome !== null && company.balance.sharesOut ? company.ltm.netIncome / company.balance.sharesOut : null;
    return { ...fromPayments(t, sec.quarters.map((q) => ({ ...q, payDate: "" })), last, eps, lev, sec.quarters.length ? "from 10-K and 10-Q filings" : "", { ttm: sec.ttm, annual: sec.annual }), basis: "fiscal quarter" };
  }
  // Backup 3: AI research for the current dividend.
  const { subject } = await subjectOf(t);
  const r = await research(subject, ["annualDividend", "dividendYield", "exDividendDate", "payoutRatio"]).catch(() => null);
  if (!r) throw new MarketDataError("Dividend data is unavailable: FMP is out and the backups did not answer");
  noteSource("AI research");
  const annual = factNum(r, "annualDividend") ?? 0, payout = factNum(r, "payoutRatio");
  return {
    ticker: t, payments: [], ttm: annual, yield: factNum(r, "dividendYield") ?? (last && annual ? annual / last : null), frequency: "",
    growth: { y1: null, y3: null, y5: null }, payout, streakYears: 0, safety: safetyOf(payout, null, annual, null, 0, lev), research: r,
  };
}
