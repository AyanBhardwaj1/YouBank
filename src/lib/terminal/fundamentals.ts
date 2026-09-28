/**
 * Fundamental analytics behind IRAT (implied rating), QUAL (earnings quality), FCST (revenue forecast)
 * and DDIS (debt maturities): SEC XBRL facts for the statements, prices for the market inputs, and the
 * inference library for the models. Everything keeps its inputs so the screens can show the working.
 */
import { getCompanyData } from "@/lib/company";
import { fiscalLabel, getCompanyFacts, pickConcept, quarterAt, quarterEnds } from "@/lib/edgar/facts";
import { impliedRating, type ImpliedRating } from "@/lib/inference/credit";
import { forecast, impliedGrowth, type Forecast } from "@/lib/inference/forecast";
import { annualPanel, type Annual } from "@/lib/inference/fundamentals";
import { beneish, grossProfitability, piotroski, sloanAccruals, workingCapitalDays, type Beneish, type Piotroski } from "@/lib/inference/quality";
import { parkinsonVol, returns, stdev } from "@/lib/inference/stats";
import { history } from "@/lib/market/data";
import { estimates } from "@/lib/market/fmp";
import { noteSource } from "@/lib/market/provenance";
import { factNum, research, type Researched } from "@/lib/market/research";

const REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];

async function base(ticker: string) {
  const company = await getCompanyData(ticker);
  if (!company) throw Object.assign(new Error(`No SEC data for ${ticker.toUpperCase()}`), { status: 404 });
  const cf = await getCompanyFacts(company.cik);
  return { company, cf };
}

export type CreditView = {
  ticker: string; name: string; panel: Annual[];
  rating: ImpliedRating;
  history: { fy: number; zpp: number | null; o: number | null }[];
  market: { marketCap: number | null; equityVol: number | null; pastReturn: number | null; volSource: "daily" | "range" | null };
  coverage: { ebitToInterest: number | null; debtToEbitda: number | null; netDebt: number | null };
  caveat: string | null;
};

export async function creditView(ticker: string): Promise<CreditView> {
  const { company, cf } = await base(ticker);
  const panel = annualPanel(cf, 6);
  if (!panel.length) throw new Error("No annual filings with the balance sheet this needs");
  const latest = panel[panel.length - 1], prior = panel[panel.length - 2] ?? null;
  // The same five-year history the price screens use, so one request serves both.
  const bars = await history(ticker).catch(() => []);
  const c = bars.map((b) => b.close).slice(-260);
  // Daily returns when the plan has them; otherwise the 52-week range (Parkinson), so every company gets a market view.
  const daily = c.length > 60 ? stdev(returns(c.slice(-253), true)) * Math.sqrt(252) : null;
  const range = daily === null ? parkinsonVol(company.price?.high52, company.price?.low52) : null;
  const equityVol = daily ?? range;
  const pastReturn = c.length > 250 ? c[c.length - 1] / c[c.length - 253] - 1 : null;
  const marketCap = company.price?.marketCap ? company.price.marketCap * 1e6 : null;
  const rating = impliedRating(latest, prior, { marketCapUsd: marketCap, equityVol, pastReturn, debtUsd: company.balance.debt !== null ? company.balance.debt * 1e6 : null });
  const hist = panel.map((a, i) => {
    const r = impliedRating(a, panel[i - 1] ?? null, { marketCapUsd: null, equityVol: null, pastReturn: null });
    return { fy: a.fy, zpp: r.zpp?.value ?? null, o: r.o?.value ?? null };
  });
  const debt = (latest.ltDebt ?? 0) + (latest.stDebt ?? 0);
  const ebitda = latest.ebit !== null ? latest.ebit + (latest.da ?? 0) : null;
  const financial = /^6[0-7]/.test(company.sic);
  return {
    ticker: company.ticker, name: company.name, panel, rating, history: hist,
    market: { marketCap, equityVol, pastReturn, volSource: daily !== null ? "daily" : range !== null ? "range" : null },
    coverage: { ebitToInterest: latest.ebit !== null && latest.interest ? latest.ebit / latest.interest : null, debtToEbitda: ebitda && ebitda > 0 ? debt / ebitda : null, netDebt: debt - (latest.cash ?? 0) },
    caveat: financial ? "Banks, insurers and other financials carry leverage these models were not built for: read the implied rating as a rough guide at best." : null,
  };
}

export type QualityView = {
  ticker: string; name: string; fy: number;
  beneish: Beneish | null; piotroski: Piotroski | null; accruals: number | null; grossProfitability: number | null;
  trend: { fy: number; dso: number | null; dio: number | null; accruals: number | null; cfoToNetIncome: number | null; grossMargin: number | null }[];
  flags: string[];
};

export async function qualityView(ticker: string): Promise<QualityView> {
  const { company, cf } = await base(ticker);
  const panel = annualPanel(cf, 6);
  if (panel.length < 2) throw new Error("Needs at least two annual filings");
  const t = panel[panel.length - 1], p = panel[panel.length - 2], pp = panel[panel.length - 3] ?? null;
  const b = beneish(t, p), f = piotroski(t, p, pp), acc = sloanAccruals(t, p);
  const trend = panel.map((a, i) => {
    const wc = workingCapitalDays(a);
    return { fy: a.fy, dso: wc.dso, dio: wc.dio, accruals: sloanAccruals(a, panel[i - 1] ?? null), cfoToNetIncome: a.cfo !== null && a.netIncome ? a.cfo / a.netIncome : null, grossMargin: a.revenue && a.grossProfit !== null ? a.grossProfit / a.revenue : null };
  });
  const flags: string[] = [];
  if (b?.flag) flags.push(`Beneish M-score ${b.m.toFixed(2)} is above -1.78, the level Beneish associated with manipulators. Look at ${Object.entries(b.vars).filter(([k, v]) => (k === "TATA" ? v > 0.03 : k !== "SGAI" && k !== "LVGI" && v > 1.2)).map(([k]) => k).join(", ") || "the inputs"}.`);
  if (acc !== null && acc > 0.1) flags.push(`Accruals are ${(acc * 100).toFixed(1)}% of assets: earnings well ahead of cash.`);
  const last = trend[trend.length - 1], first = trend[0];
  if (last.dso !== null && first.dso !== null && last.dso > first.dso * 1.25 && last.dso - first.dso > 10) flags.push(`Days sales outstanding rose from ${first.dso.toFixed(0)} to ${last.dso.toFixed(0)}.`);
  if (last.cfoToNetIncome !== null && last.cfoToNetIncome < 0.8 && (t.netIncome ?? 0) > 0) flags.push(`Operating cash flow is ${(last.cfoToNetIncome * 100).toFixed(0)}% of net income.`);
  if (f.score <= 3) flags.push(`Piotroski F-score ${f.score}/9: weak and weakening fundamentals.`);
  return { ticker: company.ticker, name: company.name, fy: t.fy, beneish: b, piotroski: f, accruals: acc, grossProfitability: grossProfitability(t), trend, flags };
}

export type ForecastView = {
  ticker: string; name: string;
  history: { label: string; end: string; revenue: number }[];
  forecast: Forecast; labels: string[]; growth: (number | null)[];
  consensus: { period: string; revenueAvg: number; revenueLow: number; revenueHigh: number; analysts: number }[];
  /** Where the Street's numbers came from: FMP, or AI research (one figure, with its source) when FMP has none. */
  consensusSource: "FMP" | "AI research" | null;
  research: Researched | null;
  modelVsStreet: { period: string; model: number; street: number; gap: number } | null;
};

export async function forecastView(ticker: string): Promise<ForecastView> {
  const { company, cf } = await base(ticker);
  const pick = pickConcept(cf, REVENUE);
  if (!pick) throw new Error("No revenue reported in XBRL");
  const fyeMonth = Number(company.fyeMMDD.slice(0, 2)) || 12;
  const latest = pick.rows.reduce((m, r) => (r.start && r.end > m ? r.end : m), "");
  const ends = quarterEnds(pick.rows, latest, 28);
  const hist = ends.map((end) => ({ end, revenue: quarterAt(pick.rows, end), label: fiscalLabel(end, fyeMonth) })).filter((h): h is { end: string; revenue: number; label: string } => h.revenue !== null && h.revenue > 0);
  if (hist.length < 8) throw new Error(`Only ${hist.length} quarters of revenue: too few to forecast`);
  const y = hist.map((h) => h.revenue / 1e6);
  const fc = forecast(y, 4, { period: 4 });
  const labels = Array.from({ length: 4 }, (_, k) => {
    const d = new Date(hist[hist.length - 1].end + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 3 * (k + 1));
    return fiscalLabel(d.toISOString().slice(0, 10), fyeMonth);
  });
  const est = await estimates(ticker, "quarter").catch(() => []);
  const future = est.filter((e) => e.date > hist[hist.length - 1].end).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 4);
  let consensus = future.map((e) => ({ period: fiscalLabel(e.date, fyeMonth), revenueAvg: e.revenueAvg / 1e6, revenueLow: e.revenueLow / 1e6, revenueHigh: e.revenueHigh / 1e6, analysts: e.numAnalystsRevenue }));
  let consensusSource: ForecastView["consensusSource"] = consensus.length ? "FMP" : null;
  let researched: Researched | null = null;
  if (consensus.length) noteSource("FMP");
  else {
    // No consensus from FMP: look up next quarter's figure, checked against its source, and label it as such.
    researched = await research(`${company.name} (${company.exchange ? `${company.exchange}: ` : ""}${company.ticker}), next quarter after the one ending ${hist[hist.length - 1].end}`, ["revenueEstimate"]).catch(() => null);
    const v = factNum(researched, "revenueEstimate");
    if (v !== null && v > 0) {
      const mm = v / 1e6;
      consensus = [{ period: labels[0], revenueAvg: mm, revenueLow: mm, revenueHigh: mm, analysts: 0 }];
      consensusSource = "AI research";
      noteSource("AI research");
    }
  }
  const next = consensus[0];
  return {
    ticker: company.ticker, name: company.name, history: hist.map((h) => ({ ...h, revenue: h.revenue / 1e6 })), forecast: fc, labels, growth: impliedGrowth(y, fc, 4), consensus,
    consensusSource, research: researched,
    modelVsStreet: next ? { period: next.period, model: fc.point[0], street: next.revenueAvg, gap: fc.point[0] / next.revenueAvg - 1 } : null,
  };
}

const MATURITY = [
  ["Next 12 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
  ["Year 2", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
  ["Year 3", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"],
  ["Year 4", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
  ["Year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"],
  ["After year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
] as const;

export type DebtView = {
  ticker: string; name: string; asOf: string | null;
  ladder: { bucket: string; amount: number }[]; total: number; cash: number | null; cfo: number | null;
  interest: number | null; ebit: number | null; coverage: number | null; nearTermShare: number | null;
  runway: string;
};

export async function debtView(ticker: string): Promise<DebtView> {
  const { company, cf } = await base(ticker);
  const panel = annualPanel(cf, 2);
  const latest = panel[panel.length - 1];
  let asOf: string | null = null;
  const ladder: { bucket: string; amount: number }[] = [];
  for (const [bucket, tag] of MATURITY) {
    const rows = pickConcept(cf, [tag])?.rows.filter((r) => !r.start) ?? [];
    const lastRow = rows[rows.length - 1];
    if (!lastRow) continue;
    if (!asOf || lastRow.end > asOf) asOf = lastRow.end;
    ladder.push({ bucket, amount: lastRow.val / 1e6 });
  }
  const total = ladder.reduce((a, l) => a + l.amount, 0);
  const cash = latest?.cash !== null && latest?.cash !== undefined ? latest.cash / 1e6 : null;
  const cfo = latest?.cfo !== null && latest?.cfo !== undefined ? latest.cfo / 1e6 : null;
  const near = ladder.find((l) => l.bucket === "Next 12 months")?.amount ?? 0;
  const two = near + (ladder.find((l) => l.bucket === "Year 2")?.amount ?? 0);
  const resources = (cash ?? 0) + Math.max(0, cfo ?? 0);
  const runway = !total ? "No scheduled maturities reported in XBRL." : resources >= two ? "Cash and a year of operating cash flow cover the next two years of maturities." : resources >= near ? "Covers the next year of maturities; year two will need refinancing or cash generation." : "Near-term maturities exceed cash plus a year of operating cash flow: refinancing risk.";
  return {
    ticker: company.ticker, name: company.name, asOf, ladder, total, cash, cfo,
    interest: latest?.interest ? latest.interest / 1e6 : null, ebit: latest?.ebit !== null && latest?.ebit !== undefined ? latest.ebit / 1e6 : null,
    coverage: latest?.ebit !== null && latest?.ebit !== undefined && latest.interest ? latest.ebit / latest.interest : null,
    nearTermShare: total ? near / total : null, runway,
  };
}
