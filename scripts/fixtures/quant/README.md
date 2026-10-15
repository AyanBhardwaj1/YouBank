# Quant Edge test fixtures

**Constructed, not downloaded.** The build sandbox's egress policy refused every data host this work needs
(`www.sec.gov`, `data.sec.gov`, `efts.sec.gov`, `api.nasdaq.com`, `financialmodelingprep.com`, `stooq.com`,
`mba.tuck.dartmouth.edu`; each answered 403 to CONNECT on 15 October 2026). So, as docs/quant-edge.md asks, each
fixture below is written in the source's documented layout with fictional companies, people and numbers, and the
parser is built against it. Replace each with a real saved response when working with network access, and record
any difference from the layout here.

| File | Layout it follows | Used by |
|---|---|---|
| `stats-oracle.json` | Not a data source: deterministic inputs with answers computed independently by statsmodels 0.15, SciPy 1.17 and NumPy 2.4 | QF2 known-answer tests |
| `fills/*.csv` | Each broker's CSV export as commonly shared (Schwab transactions, Fidelity account history, Robinhood account activity, Webull order records, Interactive Brokers activity statement Trades section, E*TRADE transactions) and YouBank's template | Q5 importers |
| `rules/rule606.xml` | The SEC Rule 606(a)(1) XML technical specification (`heldOrderRoutingPublicReport`, monthly `rSP500` / `rOtherStocks` / `rOptions`, venues with net payment fields) | Q5 broker scorecard |
| `rules/rule605.txt` | The original Rule 605 pipe-delimited layout (26 fields; order type codes 11-15, size codes 21-24) | Q5 broker scorecard |
| `insiders/form4-*.xml` | SEC Form 4 XML (`ownershipDocument`, schema X0508 with the `aff10b5One` checkbox) | Q7 parser |
| `insiders/current.atom` | EDGAR's latest-filings Atom feed (`browse-edgar?action=getcurrent&output=atom`) | Q7 live feed |
| `insiders/filing.hdr.sgml` | An EDGAR filing header with `ACCEPTANCE-DATETIME` | Q7 acceptance times |
| `insiders/SUBMISSION.tsv`, `REPORTINGOWNER.tsv`, `NONDERIV_TRANS.tsv` | The SEC Insider Transactions Data Sets' tab-separated files (field names per the SEC readme, prior knowledge) | Q7 history |
| `insiders/13d-text.htm`, `13d.xml` | Schedule 13D, old text form and the 2024 XML form | Q7 activists |
| `pit/company_tickers_exchange.json` | SEC's `company_tickers_exchange.json` (`fields`, `data`) | QF3 universe |
| `pit/companyfacts.json` | SEC XBRL company facts (`facts.us-gaap.<concept>.units.<unit>[]` with `filed`, `form`, `accn`) including a restatement | QF3 point-in-time fundamentals |
