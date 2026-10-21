/** Live company record assembled from SEC EDGAR (fundamentals) and FMP (price). USD millions unless noted. */
export type CompanyData = {
  ticker: string;
  name: string;
  cik: string;
  sic: string;
  sicLabel: string;
  exchange: string;
  hq: string;
  fye: string; // "Jan 31"
  fyeMMDD: string; // "0131"
  description: string;
  industry: string;
  website: string;
  price: {
    last: number;
    change: number | null;
    changePct: number | null; // fraction: 0.0123 is 1.23% (market/units fmtChange displays it)
    marketCap: number | null; // USD mm; null with several share classes and no feed figure
    low52: number | null;
    high52: number | null;
    asOf: string; // ISO instant the price is true for (the provider's quote time; fetch time when it has none)
    source?: string; // the feed that answered: "FMP", "Nasdaq"
    fetchedAt?: string; // when it was fetched
    delayed?: boolean; // the feed says it is not real time
    stale?: boolean; // behind the market, or the stored price because no feed answered
  } | null;
  ltm: {
    periodEnd: string;
    revenue: number | null;
    priorRevenue: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    da: number | null;
    sbc: number | null;
    ebitda: number | null;
    adjEbitda: number | null;
    operatingCashFlow: number | null;
    capex: number | null;
    netIncome: number | null;
  };
  balance: {
    asOf: string;
    cash: number | null; // cash + short-term investments
    debt: number | null;
    sharesOut: number | null; // mm, cover-page shares (all classes)
    shareClasses?: number | null; // how many classes sharesOut sums; null when unknown
  };
  estimates: { ntmRevenue: number | null; ntmEbitda: number | null; source: "fmp" | "manual" | null; enteredBy?: string; enteredAt?: string };
  quarters: { label: string; end: string; revenue: number }[];
  filings: { form: string; filed: string; period: string; title: string; url: string }[];
  sources: { concepts: Record<string, string>; notes: string[]; factsUrl: string; submissionsUrl: string; filed?: string | null /* filing date of the latest LTM figure */ };
  /** The stored record's format (company.ts RECORD_VERSION). */
  recordVersion?: number;
};

export type TickerRow = { cik: string; ticker: string; name: string };
