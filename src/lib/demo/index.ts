import snapshot from "./snapshot.json";

/**
 * A frozen snapshot of real YouBank data (SEC XBRL fundamentals, FMP prices, the startup directory),
 * built by scripts/snapshot.ts. The landing page demos run on this so they work signed out and offline.
 */
export type DemoComp = {
  ticker: string; name: string; price: number | null; changePct: number | null; marketCap: number | null; ev: number | null;
  evRevLtm: number | null; evEbitdaLtm: number | null; growth: number | null; gm: number | null; fcfm: number | null; r40: number | null;
  revenue: number | null; debt: number | null; cash: number | null; ltmEnd: string; fye: string;
  quarters: { label: string; revenue: number }[];
};
export type DemoStartup = { name: string; oneLiner: string; program: string; country: string; industries: string[]; founders: string; stage: string; raised: string; source: string; website: string };

export const DEMO = snapshot as unknown as { asOf: string; comps: DemoComp[]; startups: DemoStartup[]; directoryTotal: number };

export const demoBy = (ticker: string): DemoComp | undefined => DEMO.comps.find((c) => c.ticker === ticker);
export const demoSet = (tickers: string[]): DemoComp[] => tickers.map(demoBy).filter((c): c is DemoComp => !!c);

export const SOFTWARE_SET = ["SNOW", "DDOG", "MDB", "NET", "CRWD", "GTLB", "PLTR", "NOW", "ESTC"];
export const LEVERED_SET = ["CCL", "AAL", "LUMN"];

const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
export const demoMedians = (rows: DemoComp[]) => ({ evRev: med(rows.map((r) => r.evRevLtm)), growth: med(rows.map((r) => r.growth)), gm: med(rows.map((r) => r.gm)), fcfm: med(rows.map((r) => r.fcfm)), r40: med(rows.map((r) => r.r40)) });

/** A scripted AI answer used by the landing demo: the same shape the real assistant streams. */
export type DemoAnswer = {
  id: string;
  question: string;
  tools: { name: string; detail: string }[];
  answer: string;
  sources: { id: string; label: string; url: string }[];
};

export const DEMO_ANSWERS: DemoAnswer[] = [
  {
    id: "peers",
    question: "Propose a tiered peer set for Snowflake and tell me where it trades versus the group.",
    tools: [
      { name: "get_company_financials", detail: "SNOW" },
      { name: "get_trading_comps", detail: "SNOW + 8 peers" },
      { name: "calc", detail: "medians, premium" },
    ],
    answer: `**Core peers:** Databricks-adjacent data platforms and consumption-priced infrastructure. Datadog, MongoDB, Cloudflare, Elastic, GitLab [S1].

**Where it trades.** Snowflake is at **21.2x EV/LTM revenue** against a peer median of **15.5x**, a 37% premium [S2]. The premium is carried by growth and cash conversion, not margin: 32% LTM revenue growth and a 22% free cash flow margin put it at a Rule of 40 of **54**, the best in the set [S2].

| Company | EV/LTM rev | Rev growth | Gross margin | FCF margin |
|---|---|---|---|---|
| Snowflake | 21.2x | 32% | 67% | 22% |
| Peer median | 15.5x | 24% | 76% | 19% |

**Comparability caveats.** Snowflake's January fiscal year end is not calendarized against the December filers, and EBITDA here is reported operating income plus D&A, so the GAAP-unprofitable names show NM [S2].`,
    sources: [
      { id: "S1", label: "SNOW 10-Q filed 2026-08-28 (business overview)", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001640147" },
      { id: "S2", label: "SEC XBRL company facts, LTM to 2026-07-31", url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001640147.json" },
    ],
  },
  {
    id: "restructuring",
    question: "Build Carnival's capital structure and tell me the liquidity runway.",
    tools: [
      { name: "get_xbrl_series", detail: "LongTermDebt, InterestExpense" },
      { name: "search_filing", detail: "10-Q → \"Indebtedness\"" },
      { name: "get_recent_filings", detail: "8-K items" },
      { name: "calc", detail: "leverage, coverage, runway" },
    ],
    answer: `**Headline.** Carnival carries **$26.6B of debt against $1.2B of cash**, so net debt is **$25.4B**, or **4.9x** LTM reported EBITDA of $5.2B [S1]. Interest expense of $1.6B leaves EBITDA/interest at **3.2x**, comfortable but the maturity wall matters more than the ratio [S1].

**Runway.** Operating cash flow of $6.1B against capex of $4.9B leaves $1.2B of free cash flow. With $1.2B of cash plus the undrawn revolver, the company funds a full year of scheduled amortization without new issuance [S2].

**What to watch.** The 10-Q's indebtedness footnote lists export-credit facilities with springing covenants tied to the first-lien leverage test, and the next refinancing window opens before the 2027 maturities [S2].`,
    sources: [
      { id: "S1", label: "CCL SEC XBRL company facts, LTM to 2026-05-31", url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000815097.json" },
      { id: "S2", label: "CCL 10-Q filed 2026-06-27 (Indebtedness)", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000815097" },
    ],
  },
  {
    id: "venture",
    question: "Find seed-stage fintech founders in Africa and how to reach them.",
    tools: [
      { name: "search_startups", detail: "fintech, Nigeria/Kenya" },
      { name: "form_d_search", detail: "recent raises" },
      { name: "web_search", detail: "founder profiles" },
    ],
    answer: `**12 companies matched** across the directory and web discovery, 7 with a named founder and a working contact path [S1].

- **Moniepoint** (Lagos) business banking for merchants; Series C, led by Development Partners International [S2].
- **Kuda** (Lagos) mobile-first retail bank; last round at $500M post-money [S2].
- **Asaak** (Kampala) asset finance for motorcycle couriers; Form D on file with officer names and address [S3].

**How to reach them.** Warm paths first: Future Africa and Ventures Platform co-invest with most of this set, and three founders have public Demo Day intro links. For cold outreach the research says a specific, numbers-led first line doubles reply rates over a generic intro; the draft is in the next block.`,
    sources: [
      { id: "S1", label: "YouBank startup directory (YC, a16z, Show HN, Form D, web discovery)", url: "https://youbank-nu.vercel.app/app/vc" },
      { id: "S2", label: "Web research, funding announcements", url: "https://www.google.com/search?q=moniepoint+funding" },
      { id: "S3", label: "SEC Form D, notice of exempt offering", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=D" },
    ],
  },
  {
    id: "accounting",
    question: "How do ServiceNow's peers disclose remaining performance obligations, and what should our footnote say?",
    tools: [
      { name: "search_filing", detail: "NOW, CRM, WDAY 10-K → ASC 606" },
      { name: "edgar_fulltext_search", detail: "\"remaining performance obligations\"" },
      { name: "read_document", detail: "comment letters" },
    ],
    answer: `**Practice.** All three disclose total RPO and the share expected to be recognized within twelve months, but only two give the current/non-current split in a table; the third buries it in narrative [S1].

**Comment-letter risk.** The staff has asked registrants to explain the *judgments* behind the twelve-month split, not just the number, and to reconcile RPO to the deferred revenue rollforward [S2].

**Suggested footnote.** Give the total, the twelve-month percentage, a one-sentence statement of the estimation judgment (contract term, cancellability, usage-based excluded under ASC 606-10-50-14A), and a reconciliation to the contract-liability balance.`,
    sources: [
      { id: "S1", label: "NOW / CRM / WDAY 10-K revenue footnotes", url: "https://www.sec.gov/cgi-bin/srqsb?text=form-type%3D10-K" },
      { id: "S2", label: "SEC staff comment letters (UPLOAD) on RPO disclosure", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=UPLOAD" },
    ],
  },
];
