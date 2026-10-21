/**
 * The shapes of Financial Modeling Prep's /stable answers that YouBank reads, one schema per endpoint,
 * and the mappers into the canonical shapes (canonical.ts). Loose objects: new fields pass, a missing
 * or renamed field the code reads fails (market/validate.ts turns that into SourceError "schema").
 * Fields the code treats as optional are nullable and arrive as null, never as 0.
 */
import { z } from "zod";
import { epochToIso, pctToFraction, type DailyBar, type Profile, type Quote } from "./canonical";

const num = z.number().refine(Number.isFinite, "not a finite number");
/** An optional number: missing or null reads as null. */
const opt = z.number().nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
/** An optional string: missing or null reads as "". */
const text = z.string().nullish().transform((v) => v ?? "");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "not a date");

export const QuoteRow = z.looseObject({
  symbol: z.string(), price: num, name: text, changePercentage: opt, change: opt, volume: opt, dayLow: opt, dayHigh: opt, yearHigh: opt, yearLow: opt,
  marketCap: opt, priceAvg50: opt, priceAvg200: opt, exchange: text, open: opt, previousClose: opt, timestamp: opt,
});
export const QuoteRows = z.array(QuoteRow);
export type FmpQuoteRow = z.output<typeof QuoteRow>;

/** Volume an index or a thin day leaves out reads as 0, the convention of closes-only sources (asBars). */
export const BarRows = z.array(z.looseObject({ date: day, open: num, high: num, low: num, close: num, volume: z.number().nullish().transform((v) => v ?? 0) }));
export const LightRows = z.array(z.looseObject({ date: day, price: num }));

export const PriceChangeRows = z.array(z.looseObject({ symbol: z.string(), "1D": opt, "5D": opt, "1M": opt, "3M": opt, "6M": opt, ytd: opt, "1Y": opt, "3Y": opt, "5Y": opt, "10Y": opt, max: opt }));

export const EarningRows = z.array(z.looseObject({ date: day, epsActual: opt, epsEstimated: opt, revenueActual: opt, revenueEstimated: opt }));
export const EstimateRows = z.array(z.looseObject({
  date: day, revenueLow: opt, revenueHigh: opt, revenueAvg: opt, ebitdaAvg: opt, ebitAvg: opt, netIncomeAvg: opt, epsAvg: opt, epsHigh: opt, epsLow: opt,
  numAnalystsRevenue: opt, numAnalystsEps: opt,
}));
export const GradeRows = z.array(z.looseObject({ date: day, gradingCompany: z.string(), previousGrade: text, newGrade: z.string(), action: text }));
export const TargetRows = z.array(z.looseObject({ targetHigh: opt, targetLow: opt, targetConsensus: num, targetMedian: opt }));
export const DividendRows = z.array(z.looseObject({ date: day, recordDate: text, paymentDate: text, declarationDate: text, adjDividend: opt, dividend: opt, yield: opt, frequency: text }));
export const SplitRows = z.array(z.looseObject({ date: day, numerator: num, denominator: num }));
export const ExecutiveRows = z.array(z.looseObject({ title: text, name: z.string(), pay: opt, currencyPay: text, gender: text, yearBorn: opt, active: z.boolean().nullish().transform((v) => v ?? null) }));
export const PeerRows = z.array(z.looseObject({ symbol: z.string(), companyName: text, price: opt, mktCap: opt }));
export const TreasuryRows = z.array(z.looseObject({ date: day, month1: opt, month2: opt, month3: opt, month6: opt, year1: opt, year2: opt, year3: opt, year5: opt, year7: opt, year10: opt, year20: opt, year30: opt }));
export const MoverRows = z.array(z.looseObject({ symbol: z.string(), price: num, name: text, change: opt, changesPercentage: opt, exchange: text }));
export const SectorRows = z.array(z.looseObject({ date: day, sector: z.string(), exchange: text, averageChange: num }));
export const DealRows = z.array(z.looseObject({ symbol: text, companyName: text, cik: text, targetedCompanyName: text, targetedCik: text, targetedSymbol: text, transactionDate: text, acceptedDate: text, link: text }));
export const EarningsEventRows = z.array(z.looseObject({ symbol: z.string(), date: day, epsActual: opt, epsEstimated: opt, revenueActual: opt, revenueEstimated: opt }));
export const IndicatorRows = z.array(z.looseObject({ name: text, date: day, value: num }));
export const RatingRows = z.array(z.looseObject({
  symbol: z.string(), rating: text, overallScore: opt, discountedCashFlowScore: opt, returnOnEquityScore: opt, returnOnAssetsScore: opt,
  debtToEquityScore: opt, priceToEarningsScore: opt, priceToBookScore: opt,
}));

export const ProfileRows = z.array(z.looseObject({
  symbol: z.string(), price: num, marketCap: opt, change: opt, changePercentage: opt, range: text, companyName: z.string(), cik: text,
  exchange: text, exchangeFullName: text, industry: text, sector: text, website: text, description: text, city: text, state: text, ipoDate: text,
}));
export type FmpProfileRow = z.output<typeof ProfileRows>[number];

/* ---------------- Mappers into the canonical shapes ---------------- */

/** FMP's quote: percent change to a fraction, its `timestamp` (Unix seconds) as the as-of. */
export function quoteOf(r: FmpQuoteRow): Quote {
  return {
    symbol: r.symbol, name: r.name, price: r.price, change: r.change, changePct: pctToFraction(r.changePercentage), volume: r.volume,
    previousClose: r.previousClose, exchange: r.exchange, source: "FMP", asOf: epochToIso(r.timestamp),
  };
}

/** "169.21-260.10" as its low and high. */
export function rangeOf(range: string): { low52: number | null; high52: number | null } {
  const m = /^\s*(-?[\d.]+)\s*-\s*(-?[\d.]+)\s*$/.exec(range);
  return m ? { low52: Number(m[1]), high52: Number(m[2]) } : { low52: null, high52: null };
}

/** FMP's company profile. It has no quote time, so its as-of is when it was fetched (kept through the cache). */
export function profileOf(r: FmpProfileRow, fetchedAt: string): Profile {
  return {
    symbol: r.symbol, name: r.companyName, price: r.price, change: r.change, changePct: pctToFraction(r.changePercentage), marketCap: r.marketCap && r.marketCap > 0 ? r.marketCap : null,
    ...rangeOf(r.range), exchange: r.exchange, industry: r.industry, sector: r.sector, website: r.website, description: r.description, cik: r.cik,
    city: r.city || undefined, state: r.state || undefined, source: "FMP", asOf: fetchedAt, fetchedAt,
  };
}

export const barOf = (r: z.output<typeof BarRows>[number]): DailyBar => ({ date: r.date.slice(0, 10), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });
