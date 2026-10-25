/**
 * Free, public-domain SEC EDGAR adapters (registry.ts) for what YouBank otherwise reads from FMP:
 * - profile (DES): SEC's company_tickers_exchange.json (ticker, CIK, exchange) and the submissions
 *   document (name, SIC, state, fiscal-year end), with an in-house SIC → sector map, labelled "SIC-based".
 *   No price: price and market cap stay empty, with the reason, until a price source fills them;
 * - earnings actuals (EE): reported EPS and revenue by quarter from XBRL, dated by the 8-K Item 2.02
 *   (results of operations) filing that announced them. No estimates: that is said, never zeroed;
 * - dividends (DVD): dividends per share by fiscal quarter from 10-K and 10-Q XBRL. Ex, record and pay
 *   dates are not structured data in EDGAR, and are flagged as not available;
 * - M&A (MA): full-text search over merger forms (8-K Items 1.01/2.01, DEFM14A, PREM14A, S-4, 425,
 *   SC TO-T, SC 14D9), each checked with zod.
 */
import { z } from "zod";
import { DAY, HOUR, edgarJson } from "@/lib/edgar/client";
import { resolveRevenue } from "@/lib/edgar/concepts";
import { addDays, addMonths, getCompanyFacts, latestEnd, pickConcept, quarterAt, quarterEnds, rowsFor, type CompanyFacts } from "@/lib/edgar/facts";
import { restate, splitsOf } from "@/lib/edgar/splits";
import { getSubmissions, type Submissions } from "@/lib/edgar/submissions";
import { resolveTicker, tickerMap } from "@/lib/edgar/tickers";
import { marketDate } from "./calendar";
import type { Profile } from "./canonical";
import type { Deal } from "./fmp";
import type { DividendData, EarningsData, EarningsQuarter } from "./street-types";
import { canonical, forSec } from "./symbols";
import { parseOrThrow } from "./validate";

/** What an SEC adapter answers: data, plus why fields it cannot fill are empty. */
export type SecAnswer<R> = { data: R; note?: string; reasons?: Record<string, string> };

/* ---------------- company_tickers_exchange.json ---------------- */

const EXCHANGE_FILE = "https://www.sec.gov/files/company_tickers_exchange.json";
const ExchangeFile = z.looseObject({
  fields: z.array(z.string()).refine((f) => ["cik", "name", "ticker", "exchange"].every((k) => f.includes(k)), "cik, name, ticker and exchange fields"),
  data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});
export type ListedRow = { cik: string; name: string; ticker: string; exchange: string };

/** SEC's ticker-and-exchange file as ticker (SEC spelling, BRK-B) -> row, read by field name. Pure. */
export function parseExchangeFile(raw: unknown): Map<string, ListedRow> {
  const f = parseOrThrow(ExchangeFile, raw, "SEC EDGAR", "company_tickers_exchange.json");
  const [ci, ni, ti, ei] = ["cik", "name", "ticker", "exchange"].map((k) => f.fields.indexOf(k));
  const m = new Map<string, ListedRow>();
  for (const r of f.data) {
    const ticker = String(r[ti] ?? "").toUpperCase();
    if (ticker && !m.has(ticker)) m.set(ticker, { cik: String(r[ci] ?? "").padStart(10, "0"), name: String(r[ni] ?? ""), ticker, exchange: String(r[ei] ?? "") });
  }
  return m;
}

let listed: Promise<Map<string, ListedRow>> | null = null;
/** The file, kept a day per instance (about 1 MB: not in the shared cache, like company_tickers.json). */
export function listedMap(): Promise<Map<string, ListedRow>> {
  if (!listed) {
    listed = edgarJson<unknown>(EXCHANGE_FILE, "company_tickers_exchange.json", DAY).then(parseExchangeFile);
    listed.catch(() => { listed = null; });
  }
  return listed;
}
export const findListed = async (symbol: string) => (await listedMap()).get(forSec(symbol)) ?? null;

/* ---------------- SIC -> sector ---------------- */

/** SIC code ranges -> sector (GICS-style names), most specific first. "SIC-based": SIC is the SEC's industry code, not GICS. */
const SIC_SECTORS: [number, number, string][] = [
  [2830, 2836, "Health Care"], [3840, 3851, "Health Care"], [5120, 5122, "Health Care"], [8000, 8099, "Health Care"], [8731, 8731, "Health Care"],
  [3570, 3579, "Information Technology"], [3600, 3629, "Information Technology"], [3640, 3699, "Information Technology"], [3800, 3839, "Information Technology"],
  [3860, 3879, "Information Technology"], [7370, 7379, "Information Technology"],
  [3630, 3639, "Consumer Discretionary"], [3711, 3716, "Consumer Discretionary"], [3751, 3751, "Consumer Discretionary"],
  [2840, 2844, "Consumer Staples"], [5140, 5149, "Consumer Staples"], [5400, 5499, "Consumer Staples"], [5912, 5912, "Consumer Staples"],
  [1200, 1399, "Energy"], [2900, 2999, "Energy"], [4610, 4619, "Energy"], [4920, 4925, "Utilities"],
  [6500, 6553, "Real Estate"], [6798, 6798, "Real Estate"],
  [7810, 7841, "Communication Services"], [2700, 2799, "Communication Services"], [4800, 4899, "Communication Services"],
  [7000, 7099, "Consumer Discretionary"], [7900, 7999, "Consumer Discretionary"], [8200, 8299, "Consumer Discretionary"],
  [100, 999, "Consumer Staples"], [1000, 1099, "Materials"], [1400, 1499, "Materials"], [1500, 1799, "Industrials"],
  [2000, 2199, "Consumer Staples"], [2200, 2399, "Consumer Discretionary"], [2400, 2499, "Materials"], [2500, 2599, "Consumer Discretionary"],
  [2600, 2699, "Materials"], [2800, 2899, "Materials"], [3000, 3099, "Materials"], [3100, 3199, "Consumer Discretionary"], [3200, 3399, "Materials"],
  [3400, 3569, "Industrials"], [3580, 3599, "Industrials"], [3700, 3799, "Industrials"], [3880, 3899, "Industrials"], [3900, 3999, "Consumer Discretionary"],
  [4000, 4799, "Industrials"], [4900, 4999, "Utilities"], [5000, 5199, "Industrials"], [5200, 5999, "Consumer Discretionary"],
  [6000, 6499, "Financials"], [6700, 6799, "Financials"], [7200, 7369, "Industrials"], [7380, 7899, "Industrials"], [8100, 8199, "Industrials"],
  [8300, 8999, "Industrials"],
];

/** The SIC-based sector for an SIC code, or null for none (blank, 9xxx non-classifiable). Pure. */
export function sicSector(sic: string | number | null | undefined): string | null {
  const n = Number(sic);
  if (!Number.isInteger(n) || n <= 0) return null;
  return SIC_SECTORS.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}

/* ---------------- Profile ---------------- */

const NO_PRICE = "SEC filings carry no market price. A price source (YouBank's plan or your own key) fills it; without one it stays empty.";

/** A profile from SEC data alone: name, exchange, SIC industry and SIC-based sector, location. No price. */
export async function secProfile(symbol: string): Promise<SecAnswer<Profile> | null> {
  const row = await findListed(symbol);
  if (!row) return null;
  const sub = await getSubmissions(row.cik);
  const biz = (sub as Submissions & { addresses?: { business?: { city?: string; stateOrCountry?: string } }; website?: string }).addresses?.business;
  const sector = sicSector(sub.sic);
  return {
    data: {
      symbol: canonical(symbol), name: sub.name || row.name, price: null, change: null, changePct: null, marketCap: null, low52: null, high52: null,
      exchange: row.exchange, industry: sub.sicDescription, sector: sector ?? "", website: (sub as { website?: string }).website ?? "", description: "",
      cik: row.cik, city: biz?.city, state: biz?.stateOrCountry, source: "SEC EDGAR", asOf: null,
    },
    note: sector ? "Sector is SIC-based (the SEC's industry code), not GICS" : undefined,
    reasons: { price: NO_PRICE, changePct: NO_PRICE, marketCap: "Needs a price (market cap is price × shares).", low52: NO_PRICE, high52: NO_PRICE, description: "SEC filings have no short business description (the long form is Item 1 of the 10-K)." },
  };
}

/* ---------------- Earnings actuals ---------------- */

const EPS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"];
const QUARTERS = 16;
/** An 8-K announcing results is filed within this many days of the quarter's end. */
const REPORT_WINDOW_DAYS = 75;
const NO_ESTIMATES = "SEC filings report actuals only. Estimates need a licensed source: YouBank's FMP plan or your own FMP, Finnhub or Alpha Vantage key.";

/** 8-K filings with Item 2.02 (results of operations), by filing date, oldest first. Pure. */
export function resultsFilingDates(sub: Pick<Submissions, "filings">): string[] {
  const r = sub.filings.recent;
  const out: string[] = [];
  for (let i = 0; i < r.form.length; i++) if ((r.form[i] === "8-K" || r.form[i] === "8-K/A") && /\b2\.02\b/.test(r.items?.[i] ?? "")) out.push(r.filingDate[i]);
  return out.sort();
}

/** The report date for a quarter ending `end`: the first results 8-K within the window, or null. Pure. */
export const reportDateFor = (end: string, dates: string[]): string | null => dates.find((d) => d > end && d <= addDays(end, REPORT_WINDOW_DAYS)) ?? null;

/** Reported quarters (EPS, revenue) from XBRL, newest first, dated by their results 8-K where one was filed. Pure. */
export function secQuarters(cf: CompanyFacts, sub: Pick<Submissions, "filings">): EarningsQuarter[] {
  const eps = pickConcept(cf, EPS, "USD/shares");
  const latest = eps ? latestEnd(eps.rows) : null;
  if (!eps || !latest) return [];
  const rev = resolveRevenue(cf), dates = resultsFilingDates(sub);
  return quarterEnds(eps.rows, latest, QUARTERS).flatMap((end): EarningsQuarter[] => {
    const v = quarterAt(eps.rows, end);
    if (v === null) return [];
    const reported = reportDateFor(end, dates);
    return [{ date: reported ?? end, epsActual: Number(v.toFixed(4)), epsEstimated: null, revenueActual: rev ? quarterAt(rev.rows, end) : null, revenueEstimated: null, datedBy: reported ? "report" : "period" }];
  }).reverse();
}

export async function secEarnings(symbol: string): Promise<SecAnswer<EarningsData> | null> {
  const row = await resolveTicker(symbol);
  if (!row) return null;
  const [cf, sub] = await Promise.all([getCompanyFacts(row.cik), getSubmissions(row.cik)]);
  const quarters = secQuarters(cf, sub);
  if (!quarters.length) return null;
  return { data: { quarters, next: null, annual: [] }, note: "Reported EPS and revenue from 10-K and 10-Q filings, dated by the results 8-K (Item 2.02)", reasons: { next: NO_ESTIMATES, annual: NO_ESTIMATES, epsEstimated: NO_ESTIMATES } };
}

/* ---------------- Dividends ---------------- */

const DPS = ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"];
const NO_DATES = "Ex-dividend, record and pay dates are not structured data in SEC filings; amounts are per share by fiscal quarter.";
/** The fiscal year a period ending on `end` belongs to (a 52-week year ending 2023-01-01 is fiscal 2022). */
const fiscalYear = (end: string) => Number(addDays(end, -45).slice(0, 4));

/**
 * Dividends per share from the company's 10-K and 10-Q filings, restated for splits: by fiscal quarter
 * (oldest first), by fiscal year, and the latest twelve months. Empty when the filings show no dividend;
 * null when they cannot tell (no filings, dividends paid with no per-share figure tagged, or too little
 * history for a year's worth).
 */
export async function secDividends(cik: string): Promise<{ quarters: { date: string; amount: number }[]; annual: { year: number; amount: number }[]; ttm: number | null } | null> {
  const cf = await getCompanyFacts(cik.padStart(10, "0")).catch(() => null);
  if (!cf) return null;
  const today = marketDate();
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

export async function secDividendData(symbol: string): Promise<SecAnswer<DividendData> | null> {
  const row = await resolveTicker(symbol);
  const sec = row ? await secDividends(row.cik) : null;
  if (!sec) return null;
  return {
    data: { payments: sec.quarters.map((q) => ({ ...q, payDate: null })), frequency: sec.quarters.length ? "from 10-K and 10-Q filings" : "", basis: "fiscal quarter", ttm: sec.ttm, annual: sec.annual },
    note: "Dividends per share from 10-K and 10-Q filings, by fiscal quarter",
    reasons: { payDate: NO_DATES, exDate: NO_DATES },
  };
}

/* ---------------- M&A ---------------- */

const FTS_URL = "https://efts.sec.gov/LATEST/search-index";
/** Merger forms: agreements (8-K 1.01, completed 2.01), proxies, registrations, communications, tender offers. */
export const MERGER_FORMS = ["8-K", "DEFM14A", "PREM14A", "S-4", "425", "SC TO-T", "SC 14D9"];
const MERGER_ITEMS = /\b(1\.01|2\.01)\b/;
const DEAL_DAYS = 21;
const MAX_DEALS = 80;

/** What each merger filing is, in words, for the deal list. */
export const FORM_MEANING: Record<string, string> = {
  "8-K": "8-K: merger agreement announced", DEFM14A: "DEFM14A: definitive merger proxy", PREM14A: "PREM14A: preliminary merger proxy",
  "S-4": "S-4: shares registered for a merger", "425": "425: merger communication", "SC TO-T": "SC TO-T: tender offer by a buyer", "SC 14D9": "SC 14D9: target's response to a tender offer",
};

const FtsAnswer = z.looseObject({
  hits: z.looseObject({
    hits: z.array(z.looseObject({
      _id: z.string().regex(/^[\d-]+:.+/),
      _source: z.looseObject({ display_names: z.array(z.string()).nullish(), ciks: z.array(z.string()).nullish(), form: z.string().nullish(), root_forms: z.array(z.string()).nullish(), file_date: z.string().nullish(), items: z.array(z.string()).nullish() }),
    })),
  }),
});

/** A full-text search answer as deals, newest first, one per filer and form; 8-Ks only for Items 1.01/2.01 when items are given. Pure. */
export function dealsFromFts(raw: unknown, tickerByCik: Map<string, string>): Deal[] {
  const hits = parseOrThrow(FtsAnswer, raw, "SEC EDGAR", "full-text search").hits.hits;
  const seen = new Set<string>(), out: Deal[] = [];
  for (const h of [...hits].sort((a, b) => ((a._source.file_date ?? "") < (b._source.file_date ?? "") ? 1 : -1))) {
    const s = h._source, form = s.form ?? s.root_forms?.[0] ?? "", base = form.replace(/\/A$/, ""), cik = s.ciks?.[0] ?? "";
    if (base === "8-K" && s.items?.length && !s.items.some((i) => MERGER_ITEMS.test(i))) continue;
    if (seen.has(`${cik}:${form}`)) continue;
    seen.add(`${cik}:${form}`);
    const [accession, doc] = h._id.split(":");
    const link = `https://www.sec.gov/Archives/edgar/data/${Number(cik || 0)}/${accession.replace(/-/g, "")}/${doc}`;
    out.push({
      symbol: tickerByCik.get(String(Number(cik))) ?? "", companyName: (s.display_names?.[0] ?? "").replace(/\s*\(CIK \d+\)\s*$/, "").replace(/\s*\([A-Z.\-, ]+\)\s*$/, ""), cik,
      targetedCompanyName: FORM_MEANING[base] ? `${FORM_MEANING[base]}${form.endsWith("/A") ? " (amended)" : ""}` : form, targetedCik: "", targetedSymbol: "",
      transactionDate: s.file_date ?? "", acceptedDate: s.file_date ?? "", link,
    });
  }
  return out.slice(0, MAX_DEALS);
}

/** Merger agreements, proxies, registrations and tender offers filed on EDGAR in the last three weeks. */
export async function secDeals(now = Date.now()): Promise<Deal[]> {
  const from = new Date(now - DEAL_DAYS * 86_400_000).toISOString().slice(0, 10), to = new Date(now).toISOString().slice(0, 10);
  const p = new URLSearchParams({ q: "\"Agreement and Plan of Merger\"", forms: MERGER_FORMS.join(","), dateRange: "custom", startdt: from, enddt: to });
  const [raw, tickers] = await Promise.all([edgarJson<unknown>(`${FTS_URL}?${p}`, `fts-mergers-${from}.json`, 6 * HOUR), tickerMap().catch(() => new Map())]);
  const byCik = new Map<string, string>();
  for (const t of tickers.values()) { const c = String(Number(t.cik)); if (!byCik.has(c)) byCik.set(c, t.ticker); }
  return dealsFromFts(raw, byCik);
}
