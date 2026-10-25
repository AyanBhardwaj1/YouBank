/**
 * The canonical shapes of the Street datasets (earnings, analysts, dividends) that every source maps
 * into: FMP, Nasdaq, SEC filings, AI research and a person's own keys. The terminal's views
 * (terminal/street.ts) compute beat rates, moves and dividend safety from these, whichever source answered.
 * Money in units (dollars), per-share figures per share, dates `YYYY-MM-DD`; missing is null, never 0.
 * Types only, so any module (and the browser) can import them.
 */
import type { Researched } from "./research";

/** One reported quarter. `datedBy: "period"` when the date is the fiscal period's end, not the report date (no price reaction then). */
export type EarningsQuarter = {
  date: string; epsActual: number; epsEstimated: number | null; revenueActual: number | null; revenueEstimated: number | null; datedBy?: "report" | "period";
};
export type NextReport = { date: string; epsEstimated: number | null; revenueEstimated: number | null; estimatedDate?: boolean };
/** Consensus for one fiscal year; revenue in dollars. */
export type AnnualEstimate = { year: string; revenueAvg: number | null; revenueLow: number | null; revenueHigh: number | null; epsAvg: number | null; analysts: number | null };

export type EarningsData = { quarters: EarningsQuarter[]; next: NextReport | null; annual: AnnualEstimate[]; research?: Researched | null };

export type RatingSnapshot = { rating: string; overallScore: number | null; discountedCashFlowScore: number | null; returnOnEquityScore: number | null; returnOnAssetsScore: number | null; debtToEquityScore: number | null; priceToEarningsScore: number | null; priceToBookScore: number | null } | null;

export type AnalystData = {
  target: { high: number | null; low: number | null; mean: number; median: number | null } | null;
  /** Null when no source reported the counts (not zero ratings). */
  counts: { buy: number | null; hold: number | null; sell: number | null } | null;
  /** The latest rating per firm. */
  firms: { firm: string; grade: string; date: string; action: string }[];
  /** Every rating action (for the drift over 90 days). */
  actions: { date: string; action: string }[];
  snapshot: RatingSnapshot;
  consensusRating?: string;
  research?: Researched | null;
};

export type DividendPayment = { date: string; amount: number; payDate: string | null };

export type DividendData = {
  payments: DividendPayment[];
  frequency: string;
  /** "fiscal quarter" when payments are per-share dividends by fiscal quarter from filings, not by ex-date. */
  basis: "ex-date" | "fiscal quarter";
  /** A source's own figures, used over the ones computed from payments. */
  payout?: number | null; ttm?: number | null; annual?: { year: number; amount: number }[];
  /** Trailing EPS as the source reports it (for the payout ratio). */
  epsTtm?: number | null;
  /** A researched yield (no payment history). */
  yield?: number | null;
  /** Amounts as paid, to be restated for splits the filings show (Nasdaq). */
  restate?: "paid";
  research?: Researched | null;
};
