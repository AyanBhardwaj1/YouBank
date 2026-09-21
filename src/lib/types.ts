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
    change: number;
    changePct: number;
    marketCap: number; // USD mm
    low52: number | null;
    high52: number | null;
    asOf: string; // ISO timestamp of fetch
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
    sharesOut: number | null; // mm, cover-page shares
  };
  estimates: { ntmRevenue: number | null; ntmEbitda: number | null; source: "fmp" | "manual" | null; enteredBy?: string; enteredAt?: string };
  quarters: { label: string; end: string; revenue: number }[];
  filings: { form: string; filed: string; period: string; title: string; url: string }[];
  sources: { concepts: Record<string, string>; notes: string[]; factsUrl: string; submissionsUrl: string };
};

export type TickerRow = { cik: string; ticker: string; name: string };
