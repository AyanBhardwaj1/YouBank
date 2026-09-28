/**
 * WACC, the cost of capital, from its parts, each one sourced and each choice shown. Cost of equity by
 * CAPM: the 10-year Treasury yield (from the Treasury), a two-year weekly beta against the S&P 500 with
 * Blume's adjustment (Bloomberg's default), and an equity risk premium the person can change. Cost of
 * debt: the risk-free rate plus the spread for the company's implied rating (the median of the credit
 * models' views), with the effective rate on its existing debt beside it. Weights at the market value
 * of equity and the book value of debt. A Monte Carlo over the uncertain inputs (beta within its
 * standard error, the premium, the spread, the leverage) gives a range instead of false precision, and
 * a tornado says which input matters most.
 */
import { getCompanyData } from "@/lib/company";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { impliedRating } from "@/lib/inference/credit";
import { annualPanel } from "@/lib/inference/fundamentals";
import { simulate, tornado, type Dist } from "@/lib/inference/montecarlo";
import { parkinsonVol } from "@/lib/inference/stats";
import { treasuryCurves } from "@/lib/market/treasury";
import { priceAnalytics, type PriceAnalytics } from "./price";

export const DEFAULT_ERP = 0.05;
/** 21% federal plus a typical state rate: the marginal rate at which interest saves tax. */
const MARGINAL_TAX = 0.25;
/** Approximate long-run corporate spreads over Treasuries by rating band, in decimals: defaults, not a live feed. */
const SPREADS: Record<string, number> = { AAA: 0.006, AA: 0.008, A: 0.011, BBB: 0.015, BB: 0.024, B: 0.036, CCC: 0.075, D: 0.12 };

export type WaccView = {
  ticker: string; name: string; asOf: string;
  riskFree: { value: number; date: string | null; source: string };
  beta: { raw: number | null; adjusted: number; se: number; window: string; r2: number | null; fallback: boolean };
  erp: number;
  debt: { cost: number; method: "rating" | "effective" | "default"; rating: string | null; spread: number; effective: number | null };
  tax: { shield: number; effective: number | null };
  weights: { equity: number; debt: number; marketCap: number | null; debtAmount: number; basis: string };
  costOfEquity: number; afterTaxDebt: number; wacc: number; unleveredBeta: number;
  range: { p10: number; p50: number; p90: number; histogram: { lo: number; hi: number; count: number }[] };
  drivers: { input: string; low: number; high: number; swing: number }[];
  notes: string[];
};

const LABELS = { beta: "Beta", erp: "Equity risk premium", spread: "Credit spread", debtWeight: "Debt weight" } as const;

export async function waccView(ticker: string, erpIn?: number, betaMethod: "blume" | "welch" = "blume"): Promise<WaccView> {
  const company = await getCompanyData(ticker);
  if (!company) throw Object.assign(new Error(`No SEC data for ${ticker.toUpperCase()}`), { status: 404 });
  const erp = erpIn && erpIn > 0 && erpIn < 0.15 ? erpIn : DEFAULT_ERP;
  const [curves, px, cf] = await Promise.all([
    treasuryCurves().catch(() => []),
    priceAnalytics(company.ticker).catch(() => null as PriceAnalytics | null),
    getCompanyFacts(company.cik),
  ]);
  const notes: string[] = [];

  // Risk-free: today's 10-year par yield.
  const tenYear = curves.find((c) => c.yields["10 Yr"] !== undefined);
  const rf = tenYear ? tenYear.yields["10 Yr"] / 100 : 0.0425;
  if (!tenYear) notes.push("Treasury rates were unavailable, so a 4.25% risk-free rate is assumed.");

  // Beta: two years of weekly returns, Blume-adjusted (or Welch's, which forecasts better); the standard error carries into the range.
  const blume = px?.beta.find((x) => x.window === "2y weekly") ?? px?.beta[0] ?? null;
  const b = betaMethod === "welch" ? px?.beta.find((x) => x.window.includes("Welch")) ?? blume : blume;
  const beta = b
    ? { raw: b.beta, adjusted: b.adjusted, se: b.window.includes("Welch") ? b.se : 0.67 * b.se, window: b.window, r2: b.r2, fallback: false }
    : { raw: null, adjusted: 1, se: 0.3, window: "assumed", r2: null, fallback: true };
  if (beta.fallback) notes.push("No price history on the current market-data plan, so beta is assumed to be 1.0 (the market) with a wide range.");
  else if (beta.se > 0.2) notes.push(`Beta is imprecise (standard error ${beta.se.toFixed(2)} after adjustment): treat the cost of equity as a range.`);

  // Credit: the implied rating sets the spread; the effective rate on existing debt is shown beside it.
  const panel = annualPanel(cf, 3);
  const latest = panel[panel.length - 1] ?? null, prior = panel[panel.length - 2] ?? null;
  const rating = latest ? impliedRating(latest, prior, { marketCapUsd: company.price?.marketCap ? company.price.marketCap * 1e6 : null, equityVol: px?.vol.realized1y ?? parkinsonVol(company.price?.high52, company.price?.low52), pastReturn: px?.change.y1 ?? null }) : null;
  const debtNow = latest ? (latest.ltDebt ?? 0) + (latest.stDebt ?? 0) : 0;
  const debtPrior = prior ? (prior.ltDebt ?? 0) + (prior.stDebt ?? 0) : 0;
  const avgDebt = debtPrior ? (debtNow + debtPrior) / 2 : debtNow;
  const effective = latest?.interest && avgDebt > 0 ? latest.interest / avgDebt : null;
  const effectiveOk = effective !== null && effective > 0.005 && effective < 0.25 ? effective : null;
  const band = rating && rating.rating !== "NR" ? rating.rating.replace(/[+-]$/, "") : null;
  const debt = band && SPREADS[band] !== undefined
    ? { cost: rf + SPREADS[band], method: "rating" as const, rating: rating!.rating, spread: SPREADS[band], effective: effectiveOk }
    : effectiveOk !== null
      ? { cost: effectiveOk, method: "effective" as const, rating: null, spread: Math.max(0.002, effectiveOk - rf), effective: effectiveOk }
      : { cost: rf + 0.02, method: "default" as const, rating: null, spread: 0.02, effective: null };
  if (effectiveOk !== null && debt.method === "rating" && Math.abs(effectiveOk - debt.cost) > 0.015) notes.push(`Existing debt costs ${(effectiveOk * 100).toFixed(1)}% on average against ${(debt.cost * 100).toFixed(1)}% to borrow today: ${effectiveOk < debt.cost ? "cheap legacy debt, which will reprice as it matures" : "expensive legacy debt"}.`);

  // Tax: the marginal rate saves tax on interest while the company has taxable income.
  const pretax = latest?.pretax ?? latest?.netIncome ?? null;
  const effectiveTax = latest?.pretax && latest.pretax > 0 && latest.incomeTax !== null ? latest.incomeTax / latest.pretax : null;
  const shield = pretax !== null && pretax <= 0 ? 0 : MARGINAL_TAX;
  if (shield === 0) notes.push("Loss-making, so interest saves no tax today: the debt tax shield is set to zero.");

  // Weights: market value of equity, book debt (SEC balance sheet).
  const marketCap = company.price?.marketCap ?? null;
  const debtAmount = company.balance.debt ?? debtNow / 1e6;
  const equityValue = marketCap ?? (latest?.equity ? latest.equity / 1e6 : 0);
  const capital = equityValue + debtAmount;
  const wd = capital > 0 ? debtAmount / capital : 0;
  if (!marketCap) notes.push("No market value for the equity, so book equity sets the weights.");
  if (wd > 0.5) notes.push(`Debt is ${(wd * 100).toFixed(0)}% of capital at market value: check whether that is the target capital structure.`);
  if (/^6[0-7]/.test(company.sic)) notes.push("For banks and insurers debt is operating capital, not financing: value the equity at the cost of equity instead of using WACC.");

  const ke = rf + beta.adjusted * erp;
  const kdAfter = debt.cost * (1 - shield);
  const wacc = (1 - wd) * ke + wd * kdAfter;
  const de = equityValue > 0 ? debtAmount / equityValue : 0;
  const unlevered = beta.adjusted / (1 + (1 - shield) * de);

  // The range: the inputs that are judgment or estimate, drawn together.
  const inputs: Record<keyof typeof LABELS, Dist> = {
    beta: { kind: "normal", mean: beta.adjusted, sd: Math.max(0.05, beta.se), min: 0.1, max: 3.5 },
    erp: { kind: "triangular", low: Math.max(0.02, erp - 0.01), mode: erp, high: erp + 0.01 },
    spread: { kind: "triangular", low: debt.spread * 0.7, mode: debt.spread, high: debt.spread * 1.6 },
    debtWeight: { kind: "triangular", low: wd * 0.7, mode: wd, high: Math.min(0.9, wd * 1.3) },
  };
  const model = (x: Record<keyof typeof LABELS, number>) => (1 - x.debtWeight) * (rf + x.beta * x.erp) + x.debtWeight * (rf + x.spread) * (1 - shield);
  const sim = simulate(inputs, model, 4000, 23);

  return {
    ticker: company.ticker, name: company.name, asOf: new Date().toISOString(),
    riskFree: { value: rf, date: tenYear?.date ?? null, source: "10-year Treasury par yield (U.S. Treasury)" },
    beta, erp, debt, tax: { shield, effective: effectiveTax },
    weights: { equity: 1 - wd, debt: wd, marketCap, debtAmount, basis: marketCap ? "Market value of equity, book value of debt" : "Book values" },
    costOfEquity: ke, afterTaxDebt: kdAfter, wacc, unleveredBeta: unlevered,
    range: { p10: sim.p10, p50: sim.p50, p90: sim.p90, histogram: sim.histogram },
    drivers: tornado(inputs, model).map((d) => ({ ...d, input: LABELS[d.input] })),
    notes,
  };
}
