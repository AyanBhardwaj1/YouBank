/**
 * The shapes of Nasdaq.com's API answers that YouBank reads (the `data` member of each answer), one
 * schema per endpoint. Nasdaq writes most numbers as display strings ("$1,234.56", "+0.58%", "N/A"),
 * which canonical.toNumber reads; the schemas check that the fields are there and are text or numbers,
 * so a renamed or restructured field is drift (SourceError "schema"), never a silent NaN or 0.
 */
import { z } from "zod";

/** A number or Nasdaq's display text for one ("$1.2", "-0.5%", "1,000", "N/A", "--", ""). */
const numish = z.union([z.number(), z.string().regex(/^\s*(?:[-+$\d.,%\s]*|n\/?a|--)\s*$/i, "not a number")]).nullish();
const text = z.string().nullish().transform((v) => v ?? "");
const rowsOf = <T extends z.ZodType>(row: T) => z.looseObject({ rows: z.array(row).nullish() }).nullish();

export const Info = z.looseObject({
  symbol: z.string(), companyName: text, exchange: text,
  primaryData: z.looseObject({ lastSalePrice: z.string(), netChange: numish, percentageChange: numish, lastTradeTimestamp: text, isRealTime: z.boolean().nullish(), volume: numish }),
});

export const Historical = z.looseObject({
  tradesTable: rowsOf(z.looseObject({ date: z.string(), close: z.string(), volume: numish, open: numish, high: numish, low: numish })),
});

export const Summary = z.looseObject({ summaryData: z.record(z.string(), z.looseObject({ value: z.union([z.string(), z.number()]).nullish() })) });

export const Dividends = z.looseObject({
  payoutRatio: numish, annualizedDividend: numish,
  dividends: rowsOf(z.looseObject({ exOrEffDate: z.string(), type: text, amount: numish, declarationDate: text, paymentDate: text })),
});

export const Surprise = z.looseObject({
  earningsSurpriseTable: rowsOf(z.looseObject({ fiscalQtrEnd: z.string(), dateReported: text, eps: numish, consensusForecast: numish, percentageSurprise: numish })),
});

export const EarningsDate = z.looseObject({ reportText: text, announcement: text });

const ForecastRow = z.looseObject({ fiscalEnd: z.string(), consensusEPSForecast: numish, highEPSForecast: numish, lowEPSForecast: numish, noOfEstimates: numish });
export const Forecast = z.looseObject({ quarterlyForecast: rowsOf(ForecastRow), yearlyForecast: rowsOf(ForecastRow) });

export const Targets = z.looseObject({
  consensusOverview: z.looseObject({ lowPriceTarget: numish, highPriceTarget: numish, priceTarget: numish, buy: numish, hold: numish, sell: numish }).nullish(),
});

export const Ratings = z.looseObject({
  meanRatingType: text, ratingsSummary: text,
  upgradesDowngrades: z.array(z.looseObject({ date: text, brokerName: text, action: text, previousRating: text, newRating: text, ratingsChange: text })).nullish(),
});

const MoverTable = z.looseObject({ table: rowsOf(z.looseObject({ symbol: z.string(), name: text, lastSalePrice: z.string(), lastSaleChange: numish, change: numish })) });
export const Movers = z.looseObject({ STOCKS: z.record(z.string(), MoverTable).nullish() });
