# Comps engine: v1 spec

## User story
An analyst types `SNOW COMPS` in the command bar. Within seconds they see a peer set proposed
by Claude (core and adjacent tiers, each with a one-line rationale), edit it, and get a fully
spread trading comps grid with footnotes. They can chat with the sheet ("why is DDOG's gross
margin higher?") and get cited answers. They save the peer group for reuse and export to Excel.

## Functions (command bar)
| Code | Screen |
|---|---|
| `DES` | Company description: name, ticker, CIK, SIC, HQ, fiscal year end, business summary |
| `FA` | Financial analysis: income statement, balance sheet, cash flow, LTM, by quarter and year |
| `COMPS` | Trading comps grid for a target and peer set |
| `PREC` | Precedent transactions (seeded table in v1) |
| `FIL` | Filings list with links and AI-extracted highlights |
| `AI` | Chat panel scoped to the current screen |
| `PG` | Saved peer groups |

Syntax: `<TICKER> <FUNCTION>` or `<FUNCTION>` alone to use the active company.

## Data model (Postgres)
- `companies`: cik, ticker, name, sic, state, fiscal_year_end, description
- `filings`: company_id, accession, form, filed_at, period_end, url
- `financial_facts`: company_id, concept (us-gaap tag), value, unit, period_start, period_end, fiscal_year, fiscal_period, filing_id
- `derived_metrics`: company_id, as_of, ltm_revenue, revenue_growth, gross_margin, op_margin, fcf_margin, rule_of_40, ...
- `manual_inputs`: company_id, field (price, ntm_revenue, ntm_ebitda, shares, net_debt), value, entered_by, note
- `peer_groups`, `peer_group_members` (tier: core/adjacent, rationale)
- `comps_sheets`: target_company_id, peer_group_id, as_of, snapshot jsonb
- `footnotes`: comps_sheet_id, company_id, column, text, source (ai/user), citation
- `extractions`: company_id, filing_id, field (nrr, arr, customers), value, quote, location, confidence

## EDGAR pipeline
1. `company_tickers.json` maps ticker to CIK.
2. `submissions/CIK##########.json` lists filings.
3. `api/xbrl/companyfacts/CIK##########.json` gives every reported us-gaap concept by period.
4. Derive LTM by summing the last four quarters (handle 10-K annual minus 9-month YTD).
5. Rate limit 10 req/s, User-Agent with contact email, cache responses in Postgres.

## Calculations
- LTM revenue, gross profit, operating income, net income, D&A, capex, operating cash flow
- FCF = OCF - capex; margins as % of revenue; growth = LTM / prior LTM - 1
- Rule of 40 = revenue growth % + FCF margin %
- EV = market cap + net debt (needs manual price in v1); multiples NM if denominator <= 0
- Calendarization to December year-end when fiscal years differ (flag in footnote)

## AI (Claude API)
- Tool-using agent with tools: `search_companies`, `get_financials`, `get_filing_text`,
  `propose_peers`, `add_footnote`, `extract_field`.
- Every number in a chat answer carries a citation: filing accession + concept or text span.
- Peer proposal prompt uses SIC code, description, revenue scale, and growth profile.

## Out of scope for v1
Live prices, analyst estimates, private companies, PowerPoint export, multi-user permissions.
