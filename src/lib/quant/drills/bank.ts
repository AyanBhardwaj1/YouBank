/**
 * Q14: the question bank. Only questions whose answers come from cited data: a fixed set of market history with
 * a source on every answer, and questions generated at run time from YouBank's own data (SEC XBRL company facts,
 * BLS series), whose answers are read from the same source shown on the answer screen. Pure.
 */
export type IntervalQ = { id: string; kind: "interval"; question: string; unit: string; answer: number; source: { label: string; url: string }; note?: string };
export type TrueFalseQ = { id: string; kind: "truefalse"; statement: string; answer: boolean; explanation: string; source: { label: string; url: string } };

const wiki = (page: string) => ({ label: `Wikipedia: ${page.replace(/_/g, " ")}`, url: `https://en.wikipedia.org/wiki/${page}` });

/** Market history with well-documented answers. */
export const INTERVALS: IntervalQ[] = [
  { id: "unemp-2009-10", kind: "interval", question: "US unemployment rate in October 2009 (seasonally adjusted, %)", unit: "%", answer: 10.0, source: { label: "BLS, series LNS14000000", url: "https://data.bls.gov/timeseries/LNS14000000" } },
  { id: "cpi-2022-06", kind: "interval", question: "US consumer price inflation over the year to June 2022 (CPI-U, %)", unit: "%", answer: 9.1, source: { label: "BLS CPI news release, July 2022", url: "https://www.bls.gov/cpi/" } },
  { id: "spx-2020-03-16", kind: "interval", question: "The S&P 500's one-day change on 16 March 2020 (%)", unit: "%", answer: -11.98, source: wiki("Stock_market_crash_of_2020") },
  { id: "dji-1987", kind: "interval", question: "The Dow Jones Industrial Average's one-day change on Black Monday, 19 October 1987 (%)", unit: "%", answer: -22.61, source: wiki("Black_Monday_(1987)") },
  { id: "spx-gfc", kind: "interval", question: "The S&P 500's fall from its October 2007 closing high to its March 2009 closing low (%)", unit: "%", answer: -56.8, source: wiki("Financial_crisis_of_2007–2008") },
  { id: "ixic-2000", kind: "interval", question: "The Nasdaq Composite's closing high on 10 March 2000", unit: "index points", answer: 5048.62, source: wiki("Dot-com_bubble") },
  { id: "buttonwood", kind: "interval", question: "The year of the Buttonwood Agreement that began the New York Stock Exchange", unit: "year", answer: 1792, source: wiki("Buttonwood_Agreement") },
  { id: "vanguard-index", kind: "interval", question: "The year Vanguard launched the first index fund for individual investors", unit: "year", answer: 1976, source: wiki("Vanguard_500_Index_Fund") },
  { id: "fed-2023", kind: "interval", question: "The top of the federal funds target range after the July 2023 increase (%)", unit: "%", answer: 5.5, source: { label: "Federal Reserve, open market operations", url: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm" } },
  { id: "gme-2021", kind: "interval", question: "GameStop's closing high on 27 January 2021, before its 2022 split (US$)", unit: "$", answer: 347.51, source: wiki("GameStop_short_squeeze") },
  { id: "unemp-2020-04", kind: "interval", question: "US unemployment rate in April 2020 (seasonally adjusted, %, as first published)", unit: "%", answer: 14.7, source: { label: "BLS, series LNS14000000", url: "https://data.bls.gov/timeseries/LNS14000000" } },
  { id: "flash-crash", kind: "interval", question: "The Dow's largest intraday fall in points during the 6 May 2010 Flash Crash (about)", unit: "points", answer: 998.5, source: wiki("2010_flash_crash") },
];

export const TRUE_FALSE: TrueFalseQ[] = [
  { id: "bm-vs-2008", kind: "truefalse", statement: "Black Monday in 1987 was a larger one-day percentage fall for the Dow than any day in 2008.", answer: true, explanation: "Black Monday's -22.6% was about three times the worst day of 2008 (about -7.9%).", source: wiki("Black_Monday_(1987)") },
  { id: "btc-lehman", kind: "truefalse", statement: "Bitcoin's first block was mined before Lehman Brothers filed for bankruptcy.", answer: false, explanation: "Lehman filed on 15 September 2008; the genesis block is dated 3 January 2009.", source: wiki("Bitcoin") },
  { id: "fed-zero-2020", kind: "truefalse", statement: "The Federal Reserve cut its policy rate to near zero in March 2020.", answer: true, explanation: "On 15 March 2020 the target range went to 0 to 0.25%.", source: { label: "Federal Reserve press release, 15 March 2020", url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm" } },
  { id: "ixic-5000", kind: "truefalse", statement: "The Nasdaq Composite closed above 5,000 again before 2015.", answer: false, explanation: "After March 2000 it next closed above 5,000 in March 2015.", source: wiki("Nasdaq_Composite") },
  { id: "cpi-9", kind: "truefalse", statement: "US year-over-year CPI inflation went above 9% in 2022.", answer: true, explanation: "It reached 9.1% in June 2022.", source: { label: "BLS CPI", url: "https://www.bls.gov/cpi/" } },
  { id: "ltcm", kind: "truefalse", statement: "Long-Term Capital Management collapsed in the 2000s.", answer: false, explanation: "It was rescued in September 1998.", source: wiki("Long-Term_Capital_Management") },
  { id: "aapl-1t", kind: "truefalse", statement: "Apple was the first US company to close above $1 trillion in market value.", answer: true, explanation: "It closed above $1 trillion on 2 August 2018.", source: wiki("Apple_Inc.") },
  { id: "regnms", kind: "truefalse", statement: "The SEC adopted Regulation NMS before the 2008 financial crisis.", answer: true, explanation: "It was adopted in 2005.", source: wiki("Regulation_NMS") },
  { id: "decimal", kind: "truefalse", statement: "US stocks began trading in decimal prices after 2005.", answer: false, explanation: "Decimal pricing was completed in 2001.", source: wiki("Decimalisation") },
  { id: "unemp-14", kind: "truefalse", statement: "The US unemployment rate went above 14% in April 2020.", answer: true, explanation: "It was first published at 14.7%.", source: { label: "BLS, series LNS14000000", url: "https://data.bls.gov/timeseries/LNS14000000" } },
];

/** A question from a company's reported annual revenue (SEC XBRL), for a run-time set. */
export function revenueQuestion(o: { ticker: string; name: string; fiscalYear: number; revenueUsd: number; url: string }): IntervalQ {
  return { id: `rev-${o.ticker}-${o.fiscalYear}`, kind: "interval", question: `${o.name}'s reported revenue for fiscal ${o.fiscalYear} (US$ billions)`, unit: "$bn", answer: Math.round((o.revenueUsd / 1e9) * 100) / 100, source: { label: `SEC XBRL company facts, ${o.ticker}`, url: o.url } };
}

/** A question from a BLS observation. */
export function blsQuestion(o: { id: string; label: string; date: string; value: number; unit: string; seriesId: string }): IntervalQ {
  const [y, m] = o.date.split("-");
  const month = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return { id: `bls-${o.id}-${o.date}`, kind: "interval", question: `${o.label}, ${month} ${y} (${o.unit})`, unit: o.unit, answer: o.value, source: { label: `BLS, series ${o.seriesId}`, url: `https://data.bls.gov/timeseries/${o.seriesId}` } };
}

/** A seeded pick of `n` questions of each kind, so a set can be replayed. */
export function pickSet<T>(xs: T[], n: number, seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
