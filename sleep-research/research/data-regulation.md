# Data sources and regulation for YouBank (as of 31 October 2026)

Run: youbank-frontier-20261031 · Track: data sources and regulation · Author: research agent

**Method and limits.** About 35 web searches, run on 2026-10-31 and weighted to 2025-H2 through October 2026.
Every claim below carries a URL taken from those search results. Search snippets were read but no pages were
fetched, so many claims rest on law-firm or vendor summaries rather than the primary text. Where a claim could
not be confirmed, or rests on a single low-authority source, it is tagged **[UNVERIFIED]**. The shared
search budget ran out before searches on these topics: the SEC Form D/Reg A/Reg CF data sets, BLS/Census/FERC
endpoints, Google's and Yahoo's own sender pages, Google's own CASA pricing, and the state-by-state list of
recording-consent laws. Those gaps are marked where they come up. This file does not repeat
`docs/data-layer.md` (licence classes, FRED and FMP caveats, BYO keys), `docs/copy-trading.md` or
`docs/algo-trading.md`. It adds what has changed or what those files do not cover.

---

## Executive summary (10 bullets)

1. **FDTA joint data standards are final.** The rule was adopted 8 June 2026 and took effect 1 October 2026. It
   names the LEI as the entity identifier and the CFI for instrument classification, with changes from the
   proposal around FIGI. Agency-specific rules must follow within two years. Over time, LEI and FIGI will become
   the join keys across SEC, CFTC and bank-regulator data.
   ([SEC](https://www.sec.gov/rules-regulations/2026/05/s7-2024-05), [Federal Register](https://www.federalregister.gov/documents/2026/06/25/2026-12787/financial-data-transparency-act-joint-data-standards), [KPMG](https://kpmg.com/us/en/articles/2026/joint-data-standards-interagency-final-rule-reg-alert.html))
2. **Exchanges and vendors now license AI use explicitly.** Nasdaq publishes a Data AI Policy: model training,
   third-party AI tools and redistribution can each need a direct Nasdaq licence. CME and LSEG have aligned on
   GenAI licensing. FMP joined FISD and says its licences follow the display, non-display and derived-data
   categories.
   ([Nasdaq Data AI Policy](https://nasdaqtrader.com/content/AdministrationSupport/AgreementsData/Data_AI_Policy.pdf), [WatersTechnology](https://www.waterstechnology.com/emerging-technologies/7952826/cme-lseg-align-on-market-data-licensing-in-genai-era), [FMP/FISD](https://site.financialmodelingprep.com/education/news/fmp-joins-fisd-strengthening-alignment-with-global-marketdata-standards))
3. **No free real-time US equities feed is left.** IEX DEEP+ real-time became paid on 1 October 2025. A
   pending filing would raise real-time TOPS from $500 to $1,000 a month. Delayed TOPS and DEEP stay free.
   Cboe One Summary costs $1,500 a month.
   ([SEC filing SR-IEX-2026-23](https://www.sec.gov/files/rules/sro/iex/2026/34-105989.pdf), [policyrisk](https://policyrisk.com/federal-register/2025-18950), [Cboe One](https://www.cboe.com/us/equities/market_data_services/cboe_one))
4. **The big vendors now sell through MCP.** FactSet (December 2025), LSEG (in Claude's directory since
   October 2025), S&P Global (ChatGPT app, February 2026), PitchBook, Morningstar, Daloopa and Crunchbase all
   have MCP connectors. Almost all need the customer's own licence, so YouBank can act as a
   "bring-your-licence" MCP client rather than buy redistribution rights.
   ([FactSet](https://www.factset.com/marketplace/catalog/product/model-context-protocol), [LSEG](https://www.lseg.com/en/solutions/ai-finance-solutions/lseg-mcp), [Morningstar IR](https://shareholders.morningstar.com/investor-resources/investor-qa/qa-details/2026/How-are-PitchBook-Model-Context-Protocol-MCP-Connectors-monetized-today-if-at-all--2026-cy9M2BxfO7/default.aspx), [Crunchbase](https://about.crunchbase.com/products/crunchbase-mcp))
5. **The PatentsView API that Edge Pulse calls was paused.** It moved to the USPTO Open Data Portal on
   20 March 2026, and its search and APIs were paused. `src/lib/edge/pulse/sources/patentsview.ts` still calls
   `search.patentsview.org/api/v1` and is likely broken.
   ([USPTO notice](https://www.uspto.gov/subscription-center/2026/patentsview-migrating-uspto-open-data-portal-march-20))
6. **The SEC has stepped back from AI rules but not from AI scrutiny.** It withdrew the predictive-data-analytics
   proposal on 12 June 2025. Its FY2026 exam priorities still single out "representations regarding AI
   capabilities", automated investment tools and algorithmic trading.
   ([Paul Hastings](https://www.paulhastings.com/insights/client-alerts/sec-withdraws-14-pending-rule-proposals), [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/11/sec-division-of-examinations-announces-2026-exam-priorities))
7. **FINRA's 2026 oversight report is the first to address AI agents.** It expects guardrails, limited system
   access, monitoring for unauthorised actions and human validation, which matches YouBank's autonomy-gating
   design.
   ([Debevoise](https://www.debevoise.com/insights/publications/2025/12/finras-2026-regulatory-oversight-report-continued), [DLA Piper](https://www.dlapiper.com/insights/publications/2025/12/finra-flags-generative-ai-risks-and-governance-expectations))
8. **State and EU AI deadlines moved.** Colorado repealed its AI Act and replaced it with SB 26-189, signed
   14 May 2026 and effective 1 January 2027. The EU AI Act omnibus (provisional deal, 7 May 2026) moves Annex III
   high-risk duties to 2 December 2027. California's CCPA ADMT rules apply from 1 January 2027.
   ([govtech](https://www.govtech.com/artificial-intelligence/colorado-passes-bill-amending-current-ai-legislation), [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/), [Hunton](https://www.hunton.com/privacy-and-information-security-law/cppa-finalizes-ccpa-regulations-on-automated-decision-making-technology-risk-assessments-and-cybersecurity-audits))
9. **The adviser line for copy trading is still drawn by structure, not by any new rule.** The two market
   leaders, Autopilot and dub, both run SEC-registered advisers (and dub a broker-dealer). IOSCO's 2025 report
   and Canada's CSA treat facilitating copy trading as potentially regulated. *Lingley v. Seeking Alpha* (2024)
   protects only impersonal content.
   ([InvestmentNews](https://www.investmentnews.com/fintech/autopilot-surges-to-750m-aum-touts-ria-growth-as-users-copy-pelosi-buffett-trades/260729), [IOSCO](https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf), [Katten](https://katten.com/judge-dismisses-case-against-seeking-alpha-implications-for-publishers-of-financial-information))
10. **Outreach and meetings carry the most immediate legal risk.** Gmail and Microsoft now reject
    non-compliant bulk mail (Microsoft with 550 5.7.515 since May 2025). Italy fined a contact-enrichment broker
    EUR 2M (July 2026). The Otter.ai wiretap class action reportedly survived dismissal in August 2026, and
    Granola was sued in July 2026. YouBank's campaign emails still lack an unsubscribe header and a postal
    address, and its Gmail OAuth path uses the restricted `gmail.readonly` scope, which needs a CASA
    assessment.
    ([Mailgun](https://www.mailgun.com/blog/deliverability/microsoft-sender-requirements/), [Legance](https://www.legance.it/pubblicazioni/alert-privacy-cybersecurity-update-gdpr-enforcement-and-the-first-cra-compliance-deadline/), [BuildBetter](https://blog.buildbetter.ai/ai-notetaker-lawsuits-2026-how-to-record-meetings-legally/))

---

## A. Data

### A1. SEC data: EDGAR Next, FDTA, structured data, full-text search

**EDGAR Next is about filer access, not data access.** The rule was adopted in late 2024. The Form ID
compliance date was 24 March 2025 and the date for the other changes was 15 September 2025. Sources disagree on
the enrollment cutoff (19, 21 or 22 December 2025). The optional EDGAR APIs are for filers: submitting filings
and managing accounts. A filer using them needs at least two technical administrators.
([Federal Register 2024-30494](https://www.govinfo.gov/content/pkg/FR-2024-12-27/html/2024-30494.htm), [Mayer Brown](https://acrosstheboard.mayerbrown.com/2024/11/secs-edgar-the-next-chapter/), [JR Wiener](https://jrwiener.com/edgar-next-what-changed-and-how-it-impacts-your-business/))
No source found a 2026 change to the public read APIs (`data.sec.gov` submissions, companyfacts and frames).
**[UNVERIFIED: no change found, not confirmed absent]**

- *Implication for YouBank:* nothing changes for `src/lib/edgar/client.ts`. EDGAR Next matters only if YouBank
  ever **files** for users (for example, Form D preparation for founders), which would need delegated-filer
  set-up.

**FDTA joint data standards (final).** The SEC, CFTC, the Fed, FHFA and the other agencies adopted the rule
on 8 June 2026. It was published 25 June and took effect 1 October 2026. It sets common identifiers: the LEI
(ISO 17442) for entities, ISO 8601 for dates and the CFI for instrument classification. FIGI handling was
modified from the 2024 proposal; the Fed memo and KPMG describe the change differently, so check the Federal
Register text. Agency-specific rules must take effect within two years of the joint rule.
([SEC release 33-11420](https://www.sec.gov/files/rules/final/2026/33-11420.pdf), [Federal Register](https://www.federalregister.gov/documents/2026/06/25/2026-12787/financial-data-transparency-act-joint-data-standards), [XBRL US](https://xbrl.us/news/final-joint-rule-fdta/), [Fed memo](https://www.federalreserve.gov/newsevents/pressreleases/files/bcreg20260611a2.pdf), [Deloitte DART](https://dart.deloitte.com/USDART/home/news/all-news/2026/jun/sec-other-federal-agencies-release-joint-data-standards))

- *Implication:* make LEI (and FIGI where available) first-class keys in the company record (`src/lib/company.ts`,
  `src/lib/edge/entities`). The copy-trading CUSIP map already uses OpenFIGI (`src/lib/copytrade/cusip.ts`).
  Reuse that for every instrument, so data from the SEC, CFTC and FDIC/FFIEC can be joined once agency rules
  land in 2027–28.

**Form D / Reg A structured data.** No 2026 SEC proposal to change Form D's format was found. Form D is still
filed through a web form, with XML generated on submission, and the public tech spec is version 8 (2013).
([SEC OSD history](https://www.sec.gov/osdhistoryandrulemaking), [SEC Form D XML spec](https://www.sec.gov/info/edgar/formdxmltechspec.8_d.htm))
The SEC did publish 2026 draft taxonomies for other forms (SRO 2026Q2, Form CA-1).
([SEC what's new](https://www.sec.gov/newsroom/whats-new/2601-draft-2026q2-sro-taxonomy), [XBRL US](https://xbrl.us/news/sec-public-review-sro-q3-form-ca1/))
**[UNVERIFIED: status of DERA's Form D, Reg A and Reg CF quarterly data sets in 2026; the search budget ran out]**

- *Implication:* `src/lib/vc/formd.ts` can keep parsing `primary_doc.xml`. Adding the quarterly bulk data set
  as a backfill and cross-check is worth an hour of verification at sec.gov/dera.

**EDGAR full-text search.** No official 2026 change was found. Developer write-ups describe
`efts.sec.gov/LATEST/search-index` as returning raw Elasticsearch JSON. It needs a descriptive User-Agent
(generic agents get a 403), fair access is under about 10 requests per second, coverage starts in 2001, and
results cap at 10,000 hits. One developer reports that `startdt` is ignored unless `enddt` is also sent.
([orthogonal.info](https://orthogonal.info/sec-edgar-full-text-search-api-efts-python/), [dev.to](https://dev.to/orthogonalinfo/reverse-engineering-sec-edgars-full-text-search-api-one-undocumented-get-request-4ie6))
**[UNVERIFIED: the endpoint is undocumented, so these are community reports]**

- *Implication:* the MA chain's SEC full-text fallback (`src/lib/market/registry.ts`, the `deals` dataset)
  should always send both `startdt` and `enddt`, and split date windows when `total.value` reaches 10,000.

### A2. Free and low-cost market and fundamental data, and AI-use licensing

| Source | 2026 status found | Display / AI terms found | Source |
|---|---|---|---|
| FMP | Joined FISD; licences use the display, non-display and derived categories. OpenAI's Financial Services Terms (Sept 2026) name FMP as the US equity pricing partner | Showing FMP data in an app needs a specific agreement; distribution or derivative works need written approval. No public AI clause found | [FMP ToS](https://site.financialmodelingprep.com/terms-of-service), [FMP dev ToS](https://site.financialmodelingprep.com/developer/docs/terms-of-service), [OpenAI FS terms](https://openai.com/policies/financial-services-terms/), [FMP AI guide](https://site.financialmodelingprep.com/insights/platform/before-you-connect-fmp-data-to-an-ai-tool-what-to-check-about-inputs) |
| Massive (formerly Polygon.io) | Rebranded 30 Oct 2025; `api.polygon.io` and `api.massive.com` run in parallel. Individual stock plans reported at $0, $29, $79 and $199 a month (checked July 2026) | The individual tiers are non-professional. Business and redistribution pricing is not published | [press repost](https://rcnamericageorgia.blogspot.com/2025/11/polygonio-is-now-massive.html), [QVeris](https://try.qveris.ai/polygon-pricing-optimized/), [apicostcalc](https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html) **[UNVERIFIED pricing: aggregators, not Massive's own page]** |
| IEX | DEEP+ real-time paid since 1 Oct 2025 ($3,500/mo). DEEP real-time $2,500/mo. Pending: TOPS real-time $500 → $1,000. Delayed (15 min or more) TOPS and DEEP stay free. One-time 30-day trial | The free delayed feed works as a licensed delayed-quote source | [SEC filing](https://www.sec.gov/files/rules/sro/iex/2026/34-105989.pdf), [policyrisk 2025-18950](https://policyrisk.com/federal-register/2025-18950), [policyrisk 2025-10975](https://policyrisk.com/federal-register/2025-10975) |
| Cboe One | Summary $1,500/mo; Premium internal distribution $15,000/mo; the five-level Premium feed sunsets 2 Nov 2026 | Paid only | [Cboe](https://www.cboe.com/us/equities/market_data_services/cboe_one), [Cboe notice](https://www.cboe.com/notices/content/?id=58988) |
| NYSE | April 2026: BBO Digital Media Enterprise Fee $40,000/mo | Redistribution to the public is expensive | [policyrisk 2026-06367](https://policyrisk.com/federal-register/2026-06367) |
| Alpha Vantage, Tiingo, EODHD, Finnhub | Retail list prices only (for example Alpha Vantage Premium 600 at $250/mo, Tiingo about $10/mo, EODHD $0–$99.99) | No redistribution prices published. One review calls EODHD commercial use a "grey zone" | [aifinhub benchmark](https://aifinhub.pages.dev/benchmarks/state-of-ai-market-data-2026/), [G2 EODHD](https://www.g2.com/products/eodhd-financial-data-apis/pricing) **[UNVERIFIED]** |

**AI-use licensing trend.**
- Nasdaq's Data AI Policy covers model training, use of third-party AI tools, operational controls and
  licensing. Using a third party's AI tool with Nasdaq data "may" require a direct Nasdaq licence.
  ([Nasdaq](https://nasdaqtrader.com/content/AdministrationSupport/AgreementsData/Data_AI_Policy.pdf))
- Deutsche Börse's market data policy has a section on "use of DBAG Information in AI Solutions".
  ([DBAG](https://mds.deutsche-boerse.com/resource/blob/4028410/ee46a8181b463a0f413d0faa695c0001/data/Market%20Data%20Policy%20Guidelines%20and%20FAQ_V2_7.pdf))
- CME and LSEG have aligned their GenAI-era licensing.
  ([WatersTechnology](https://www.waterstechnology.com/emerging-technologies/7952826/cme-lseg-align-on-market-data-licensing-in-genai-era))
- Cboe filed SR-CBOE-2026-030 to codify a "Non-Display Usage" definition. The search did not show whether it
  names AI. ([Cboe](https://cdn.cboe.com/resources/regulation/rule_filings/approved/2026/SR-CBOE-2026-030.pdf))
- FRED's June 2024 terms bar AI and ML training, and bar storing or caching through the API. Those terms cover
  the "FRED MCP Connector" too. ([St. Louis Fed](https://news.research.stlouisfed.org/2024/06/weve-updated-our-terms-of-use-action-requested/), [FRED API v2 terms](https://fred.stlouisfed.org/docs/api/fred/v2/))
- Secondary sources report a shift to usage-based and per-query licensing for RAG. **[UNVERIFIED]**
  ([pebblous](https://blog.pebblous.ai/report/ai-data-licensing-realtime-shift-2026/en/), [Intrinio](https://intrinio.com/blog/financial-data-licensing-for-ai-common-roadblocks-solutions))

- *Implication:* the "AI" licence class needs its own column in `src/lib/market/sources-meta.ts` beside display
  and caching: `aiUse: "allowed" | "forbidden" | "needs-licence" | "unknown"`. `forModel(...)` in
  `user-context.ts` should read that column rather than special-casing FRED. Ask FMP explicitly for
  display, non-display/derived and AI-use rights in one Data Display and Licensing Agreement. YouBank's
  assistant sends FMP numbers to OpenAI and Anthropic, which is "use of third-party AI tools" in Nasdaq's
  terms.

### A3. Private-market and entity data

- **GLEIF (LEI).** The API is free, needs no key and is CC0. The Golden Copy updates three times a day, and the
  rate limit is reported at about 60 requests per minute. It includes parent relationships (Level 2).
  ([dev.to](https://dev.to/0012303/9-free-company-data-apis-with-no-key-or-signup-2026-3dik), [api evangelist](https://providers.apievangelist.com/providers/gleif/)) **[UNVERIFIED rate limit: secondary source]**
  This is now the FDTA's legally adopted entity identifier (A1).
- **OpenCorporates.** The API needs a token. One blog claims paid plans start around $1,000/mo.
  ([dev.to](https://dev.to/alessandrobinda114/the-best-free-business-intelligence-apis-in-2026-50pp)) **[UNVERIFIED pricing]**
  It has a partnership with GLEIF.
  ([GLEIF PR](https://www.gleif.org/newsroom/press-releases/gleif-and-opencorporates-expand-partnership-to-increase-legal-entity-transparency-in-global-markets/2023-04-18_gleif-and-opencorporates-expand-partnership-to-increase-legal-entity-transparency-in-global-markets_1.0_final.pdf))
- **UK Companies House.** Identity verification became mandatory for directors and PSCs on 18 November 2025,
  with a 12-month transition. Verification for filers starts "no earlier than November 2026". DWF reported
  further delays in August 2026. iXBRL filing of accounts is reported as mandatory from April 2027.
  ([gov.uk campaign](https://changestoukcompanylaw.campaign.gov.uk/identity-verification/), [DWF](https://dwfgroup.com/en/news-and-insights/insights/2026/8/delays-to-implementation-of-compulsory-identity-verification), [AccountsOS](https://accounts-os.com/blog/companies-house-id-verification-2026)) **[UNVERIFIED: April 2027 iXBRL date, single source]**
  The Companies House REST API itself was not re-checked in this run.
- **EU.** Implementing Regulation (EU) 2023/138 (high-value datasets) has required company and ownership data
  to be free, machine-readable and available by API since 2024. Implementation is uneven.
  BRIS is free and live across EU/EEA registers, but only for single look-ups, and it does not scale. A KYB
  vendor's May 2026 audit says some registers (it names Ireland and Italy) still offer no structured API.
  ([data.europa.eu](https://data.europa.eu/en/news-events/news/high-value-datasets-what-has-changed-and-what-will-come-next), [Nordic report](https://pub.norden.org/us2024-459/reliability-and-data-quality-solution-area-d.html), [Kyckr](https://kyckr.com/blog/european-company-registry-database)) **[UNVERIFIED: vendor claim]**
- **India MCA21 V3.** V2 shutdown began 18 June 2025. Master data can be viewed on the portal, and the APIs
  found are third-party resellers (Surepass, Meon). No official MCA API was found.
  ([juststart](https://juststart.co.in/blog/mca-v3-portal-new-update/), [Surepass](https://surepass.io/faq/what-is-the-mca-data-api/), [Meon](https://meon.co.in/mca-data-v3-portal-api)) **[UNVERIFIED: authorisation of the resellers]**
- **Startup databases.** Crunchbase sells an MCP, added as a custom connector. PitchBook has a free
  "Essential" MCP connector with limited data, and its Premium connector needs a full PitchBook licence (see A5).

- *Implication:* add a GLEIF adapter (free, CC0, can be cached and given to models) in `src/lib/market/` or
  `src/lib/edge/entities` for entity resolution and parent-child trees in DES, COMPS and buyer lists. Add a
  Companies House adapter for UK targets (free API key; confirm the terms). Treat the EU and India as
  look-up-only until official APIs are confirmed.

### A4. Government and open alternative data

- **USPTO / PatentsView (breaking change).** USPTO notice: PatentsView moved to the Open Data Portal (ODP) on
  20 March 2026, and its search, APIs and visualisations were paused, to return "in updated forms". Bulk
  downloads, including the Q4 2025 data, are on ODP's Bulk Data Directory. Third-party reports say the v1 API is
  sunset and ODP needs registration plus an `X-API-KEY`, and that ODP search lacks assignee, CPC and citation
  data.
  ([USPTO](https://www.uspto.gov/subscription-center/2026/patentsview-migrating-uspto-open-data-portal-march-20), [GovDelivery](https://content.govdelivery.com/accounts/USPTO/bulletins/40e8c67), [IIPLA](https://iipla.org/news/uspto-updates-patentsview-database-with-q4-2025-disambiguated-patent-data), [glama listing](https://glama.ai/mcp/servers/pecahzndv5)) **[UNVERIFIED: ODP API details]**
  - *Implication:* `src/lib/edge/pulse/sources/patentsview.ts` calls `search.patentsview.org/api/v1/…`. Check
    it with a live call. If it fails, switch to ODP with a key, or to quarterly bulk files loaded into Postgres
    (assignee joins happen locally).
- **USAspending.** The search endpoint needs no auth. It covers awards, not open solicitations.
  ([dev.to](https://dev.to/govtoolsdev/scraping-samgov-usaspending-for-federal-contracts-no-api-key-in-python-1eg2))
  `src/lib/edge/pulse/sources/usaspending.ts` already uses `api/v2/search/spending_by_award`.
- **SAM.gov opportunities.** It needs a free api.data.gov key. Reported non-federal quotas are as low as about
  10 calls a day, and an Apify actor was retired in May 2026 because a shared key could not stay inside the
  free quota.
  ([cleat.ai](https://www.cleat.ai/developers/sam-gov-api), [Apify changelog](https://apify.com/scrapebench/samgov-opportunity-alert/changelog)) **[UNVERIFIED quotas: check open.gsa.gov]**
  - *Implication:* if added, SAM.gov should be a per-user key (BYO, like the market BYO keys) or a nightly
    batch, not something called on each request.
- **WARN notices.** There is no federal database. Aggregators: WARN Firehose (25 free API calls a day, from
  $49/mo), WARN Watch (free CSV, CC BY 4.0, RSS per state), layoffdata.com (paid).
  ([comparison](https://approjects-warn-act-notices.static.hf.space/compare.html), [WARN Firehose](https://warnfirehose.com/blog/layoff-data-api-use-cases)) **[UNVERIFIED: vendor self-descriptions]**
  - *Implication:* `src/lib/edge/pulse/sources/warn.ts` reads TX, CA and NY directly. WARN Watch's CC BY CSV
    could broaden coverage cheaply, with attribution shown. Confirm the licence first.
- **FRED / BLS / Census.** FRED terms as in A2. A 2026 revision of FRED's terms and the BLS API terms were
  not found in this run. **[UNVERIFIED: no change found]** The existing approach in `docs/data-layer.md`
  (originals first, FRED uncached) stands.
- **Sentinel / Planet.** The Copernicus Sentinel licence gives free access, allows commercial use with
  attribution and requires a modification notice on derivatives. Planet joined the Copernicus Contributing
  Missions in January 2025. No startup licence from Planet was found.
  ([ECMWF licence](https://ecds.ecmwf.int/licences/ec-sentinel), [CDSE forum](https://forum.dataspace.copernicus.eu/t/commercial-use-of-the-data-from-api/736), [BusinessWire](https://businesswire.com/news/home/20250128946746/en/Planet))
  - *Implication:* `src/lib/edge/sources/sentinel.ts` and `s1.ts` should print "Contains modified Copernicus
    Sentinel data [year]" on every change-detection output and export.
- **AIS.** No free commercial API was found. AISHub is free only to members who contribute their own receiver
  feed. MarineTraffic is a keyed, paid API. Community scrapers carry terms-of-service risk.
  ([AISHub](https://providers.apievangelist.com/providers/aishub/), [MarineTraffic](https://servicedocs.marinetraffic.com/))
- **FERC / EIA.** EIA is already in the chain. FERC was not researched because the search budget ran out.
  **[UNVERIFIED]**

### A5. Data through MCP

| Vendor | MCP status found | Access terms found | Source |
|---|---|---|---|
| FactSet | Production MCP server since Dec 2025; works with ChatGPT, Claude and Claude Code | Enterprise licence (FactSet customers) | [FactSet catalog](https://www.factset.com/marketplace/catalog/product/model-context-protocol), [developer page](https://developer.factset.com/mcp/factset-ai-ready-data-mcp), [Yahoo/PR](https://finance.yahoo.com/news/factset-meets-demand-ai-ready-110500592.html) |
| LSEG | In Claude's MCP partner directory since Oct 2025; as of July 2026 targets Claude, ChatGPT, Copilot, Gemini, Amazon Quick and Databricks | LSEG entitlement | [LSEG MCP](https://www.lseg.com/en/solutions/ai-finance-solutions/lseg-mcp), [LSEG updates](https://www.lseg.com/en/solutions/ai-finance-solutions/updates) |
| S&P Global | ChatGPT app with an MCP connector (Feb 2026); MCP servers on Databricks Marketplace | Capital IQ / S&P licence | [GitHub issue tracking](https://github.com/KatsuyaITO/indx-autoresearch-financeaiready/issues/345), [VentureBeat](https://venturebeat.com/data/openai-launches-chatgpt-for-financial-services-with-integrated-data-sources-it-pulls-research-cites-it-and-builds-decks-in-minutes) **[UNVERIFIED: secondary sources]** |
| PitchBook | Premium connector in Claude's directory; separate "Essential" connector | Premium needs at least one full PitchBook licence; Essential gives unlicensed users limited data | [Morningstar IR Q&A](https://shareholders.morningstar.com/investor-resources/investor-qa/qa-details/2026/How-are-PitchBook-Model-Context-Protocol-MCP-Connectors-monetized-today-if-at-all--2026-cy9M2BxfO7/default.aspx), [Claude directory](https://claude.com/ja/marketplace/connectors/pitchbook) |
| Morningstar | `mcp.morningstar.com/mcp` (custom connector); ChatGPT app | Direct Platform data needs a licence | [Morningstar news](https://newsroom.morningstar.com/news/news-details/2025/Morningstar-and-PitchBook-Bring-Trusted-Investing-Intelligence-to-Apps-in-ChatGPT), [June 2026 investor answers](https://s25.q4cdn.com/634000362/files/doc_downloads/2026/Morningstar-Responses-to-Investor-Questions-June-25-2026.pdf) |
| Daloopa | `mcp.daloopa.com/server/mcp`; Claude chat and Claude for Excel; Microsoft 365 Copilot connector | Sign-in (customer) | [Daloopa](https://daloopa.com/partners/anthropic-claude), [Copilot launch](https://startupmap.iamsterdam.com/news/feed/daloopa-launches-microsoft-365-copilot-connector-for-ai-ready-financial-data-across-5-500-companies) |
| Crunchbase | Crunchbase MCP added as a custom connector; not in every native directory | Crunchbase API plan | [Crunchbase](https://about.crunchbase.com/products/crunchbase-mcp) |
| TipRanks | MCP connector with its own terms page | Not read | [TipRanks MCP terms](https://mcp.tipranks.com/terms) |
| FRED | "FRED MCP Connector" covered by the FRED terms | No AI training; no caching | [FRED v2 terms](https://fred.stlouisfed.org/docs/api/fred/v2/) |

- *Implication:* YouBank's assistant (`src/lib/ai`, `src/lib/inference`) should become an **MCP client** for
  user-supplied, licensed connectors ("bring your own licence"): a firm with FactSet, PitchBook or Daloopa
  connects its own MCP endpoint through OAuth, and YouBank never redistributes that data. Apply the same rules
  as the market BYO keys in `src/lib/market/byo/`: data goes only to its owner, is never cached into shared
  keys and is never exported to collab views. This is cheaper than licensing and matches how the vendors
  monetise MCP (licence-gated).

---

## B. Regulation and compliance

### B6. AI in financial services

**SEC.**
- The predictive data analytics proposal was formally withdrawn on 12 June 2025 (Federal Register about
  17 June), with 13 other proposals. The SEC said it does not intend to finalise them. Existing conflict and
  fiduciary duties still apply.
  ([Paul Hastings](https://www.paulhastings.com/insights/client-alerts/sec-withdraws-14-pending-rule-proposals), [Proskauer](https://www.proskauer.com/alert/sec-withdraws-fourteen-rule-proposals), [Ropes & Gray](https://www.ropesgray.com/en/insights/alerts/2025/06/sec-clears-unfinished-rulemakings-from-regulatory-agenda))
- The FY2026 exam priorities (17 November 2025) name generative AI, automated investment tools, automated
  advisory services and algorithmic trading. Examiners will review "representations regarding AI
  capabilities" and AI-enabled cyber threats. Crypto no longer has its own section.
  ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/11/sec-division-of-examinations-announces-2026-exam-priorities), [Akin](https://www.akingump.com/en/insights/alerts/sec-announces-2026-exam-priorities), [Harvard CorpGov](https://corpgov.law.harvard.edu/2026/01/04/2026-sec-division-of-examinations-priorities/))
- **AI washing.** The case law is still the 2024 cases: Delphia ($225k) and Global Predictions ($175k) under
  the Marketing Rule, plus a later 2024 case over non-existent AI capabilities. No 2026 AI-washing action
  against an adviser was found in this run. **[UNVERIFIED: absence not confirmed]**
  ([O'Melveny](https://omm.com/insights/alerts-publications/sec-targets-ai-washing-in-charges-against-two-investment-advisers), [Sewkis 40 Act blog](https://40actblog.sewkis.com/blog/sec-charges-investment-company-ceo-and-board-member-for-alleged-misleading-statements-regarding-use-of-artificial-intelligence))
- **Regulation S-P (amended 2024).** Larger entities had to comply by 3 December 2025, smaller entities
  (advisers under $1.5bn AUM) by 3 June 2026. Covered firms must oversee service providers, and summaries
  cite a 72-hour notice to the firm after a provider's breach. Reg S-P is an FY2026 exam priority.
  ([DWT](https://www.dwt.com/blogs/privacy--security-law-blog/2026/05/reg-sp-smaller-entities-june-2026-deadline), [Sewkis](https://www.sewkis.com/insights/90-day-warning-regulation-s-p-amendments-compliance-deadline-approaching-for-smaller-entities/), [Willkie](https://www.willkie.com/publications/2025/10/december-3-compliance-date-for-sec-amendments-to-regulation-s-p-is-fast-approaching))
  - *Implication:* every RIA or broker-dealer customer of YouBank (boutique advisors, emerging managers) is now
    contractually expected to get breach notice within 72 hours from YouBank as a service provider. This
    belongs in the DPA and security page, and in the incident runbook.

**FINRA.** The 2026 Annual Regulatory Oversight Report (9 December 2025) has a standalone GenAI section and,
for the first time, discusses AI agents ("systems or programs that are capable of autonomously performing and
completing tasks on behalf of a user"). It flags agents acting beyond the user's intent or without human
validation. It recommends agent-specific supervision, guardrails, limited access, monitoring for unauthorised
actions, and vetting of vendor contracts. Summarisation and information extraction are the most common use
cases it observed.
([Debevoise](https://www.debevoise.com/insights/publications/2025/12/finras-2026-regulatory-oversight-report-continued), [DLA Piper](https://www.dlapiper.com/insights/publications/2025/12/finra-flags-generative-ai-risks-and-governance-expectations), [Goodwin](https://www.goodwinlaw.com/en/insights/publications/2026/02/alerts-finance-finras-annual-guidance-spotlights-ai))
README's "Regulated mode" already cites this report. Using the e-process autonomy certificate as evidence of
"human validation" is a good fit for selling to broker-dealers.

**CFPB.** No CFPB AI rule was found. Section 1033 (open banking) is under a preliminary injunction while
the CFPB reconsiders it, and the April 2026 first-tier compliance date did not become an enforcement trigger.
([CRS IF13117](https://www.everycrsreport.com/reports/IF13117.html), [openbankingtracker](https://openbankingtracker.com/guides/section-1033-status)) **[UNVERIFIED: latest docket status]**
Low relevance to YouBank unless it adds bank-account aggregation.

**States.**
- **Colorado.** SB 24-205 was first delayed to 30 June 2026 (SB 25B-004). It was then repealed and replaced by
  **SB 26-189**, signed 14 May 2026 (House 57-6, Senate 34-1) and effective 1 January 2027. The replacement
  is a narrower automated decision-making technology framework; summaries say the risk-management programme,
  impact assessments and duty of care were removed.
  ([govtech](https://www.govtech.com/artificial-intelligence/colorado-passes-bill-amending-current-ai-legislation), [Illinois Lawyer Now](https://www.illinoislawyernow.com/2026/06/the-colorado-ai-act-everyone-was-preparing-for-no-longer-exists-here-is-what-actually-takes-effect-and-why-illinois-businesses-should-still-pay-attention/), [GT Law on the 2025 delay](https://www.gtlaw.com/en/insights/2025/9/colorado-delays-comprehensive-ai-law-with-further-changes-anticipated)) **[UNVERIFIED: SB 26-189 substance, from secondary summaries]**
- **California.** The CPPA's rules on ADMT, risk assessments and cybersecurity audits were approved
  23 September 2025 and took effect 1 January 2026. ADMT compliance is due 1 January 2027. Risk assessments for
  ongoing processing are due by 31 December 2027, with submission to the CPPA by 1 April 2028.
  ([Hunton](https://www.hunton.com/privacy-and-information-security-law/cppa-finalizes-ccpa-regulations-on-automated-decision-making-technology-risk-assessments-and-cybersecurity-audits), [Manatt](https://www.manatt.com/insights/newsletters/client-alert/california-finalizes-rules-on-automated-decisionmaking-risk-assessments-cybersecurity-audits))
  YouBank's ADMT exposure is limited, because it makes no "significant decisions" about consumers (credit,
  employment, housing). This is a judgement for counsel. **[UNVERIFIED]** The cybersecurity-audit and
  risk-assessment duties depend on CCPA thresholds.

**EU AI Act.** A provisional omnibus deal was reached on 7 May 2026. Annex III standalone high-risk duties
(including credit scoring and employment) move to 2 December 2027, and Annex I embedded systems move to
2 August 2028. Deployer transparency duties still apply from 2 August 2026. Prohibitions and the GPAI rules are
unchanged.
([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/), [Sidley](https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/), [CMS](https://cms.law/en/gbr/publication/The-EU-s-Digital-Omnibus-on-AI-What-the-Provisional-Agreement-Really-Changes)) **[UNVERIFIED: whether it was published in the Official Journal]**
For YouBank, the article 50-style transparency duties matter: tell users they are dealing with AI, and label
AI-generated content such as drafted emails sent to EU recipients.

**UK FCA.** The AI Live Testing second cohort (Barclays, Lloyds, Experian, UBS and others) began testing in
April 2026. An evaluation report is due Q1 2027, and a good- and poor-practice report on AI is due later in
2026. These sit in the FCA AI Lab alongside the Supercharged Sandbox. The FCA continues to rely on existing
rules rather than a separate AI rulebook.
([FinTech Futures](https://www.fintechfutures.com/ai-in-fintech/fca-unveils-eight-new-participants-for-next-phase-of-ai-live-testing-initiative), [FCA PR](https://www.fca.org.uk/news/press-releases/fca-helps-firms-test-ai-safely)) **[UNVERIFIED: "no AI rulebook" is a characterisation, not a quote]**

### B7. Adviser and broker boundaries: stock ideas, 13F copy trading, retail algo trading

- **Publisher's exclusion.** *Lowe v. SEC* (1985) reads the exclusion broadly for impersonal, bona fide,
  regularly published content. *Lingley v. Seeking Alpha* (S.D.N.Y. 2024) held that stock recommendations and
  analyses were protected because they were not personalised. Commentators warn that auto-trading platforms and
  model-portfolio providers should be careful. Personalised follow-up advice, portfolio reviews or tailored
  recommendations lose the exclusion.
  ([Katten](https://katten.com/judge-dismisses-case-against-seeking-alpha-implications-for-publishers-of-financial-information), [GT Law](https://www.gtlaw.com/en/insights/2024/8/no-need-for-seeking-alpha-to-seek-registration), [IBKR webinar](https://brokerage.ibkr.com/webinars/spotlight-publisher-exclusion.pdf), [FIRE: Lowe](https://www.fire.org/supreme-court/lowe-et-al-v-securities-and-exchange-commission/opinions))
  No 2026 authority on **AI-generated** recommendations was found. **[UNVERIFIED: an open question]** An AI
  assistant that answers "should I buy X?" for one user with that user's holdings in context is the hard case.
- **Market practice for 13F and politician copy trading.** Autopilot's parent says it is not an adviser.
  Advice comes from Autopilot Advisers, LLC, an SEC-registered RIA (reported AUM $750M). dub uses DASTA
  Investment LLC (SEC RIA) and DASTA Financial (SEC broker-dealer, FINRA/SIPC member).
  ([InvestmentNews](https://www.investmentnews.com/fintech/autopilot-surges-to-750m-aum-touts-ria-growth-as-users-copy-pelosi-buffett-trades/260729), [App Store: Autopilot](https://apps.apple.com/us/app/-/id1613625799), [App Store: dub](https://apps.apple.com/us/app/dub-social-investing-app/id1598920501)) **[UNVERIFIED: entity names; check IAPD]**
- **International signals.** IOSCO's report on online imitative trading (FR/06/2025) urges intermediaries to
  check whether copy trading needs registration. Canada's CSA says facilitating copy trading can be "trading"
  under securities law. ([IOSCO](https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf), [CSA](https://www.securities-administrators.ca/investor-tools/finfluencers/))
- **Finfluencer enforcement.** A 2024 SEC censure with a $1.75M fine covered an undisclosed influencer role in an
  ETF launch. A February 2026 SSRN paper discusses *SEC v. Constantinescu* and argues finfluencers act as de
  facto advisers. NASAA's 2025 enforcement report exists but was not read. No 2025–26 SEC order against a
  copy-trading app was found.
  ([Carlton Fields](https://www.carltonfields.com/insights/expect-focus/2024/finra-and-sec-float-concerns-over-social-media-finfluencers), [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6189898), [NASAA](https://www.nasaa.org/wp-content/uploads/2025/10/2025-NASAA-Enforcement-Report_FINAL.pdf))
- *Implication:* the gating in `docs/copy-trading.md` and `docs/algo-trading.md`
  (`COPYTRADE_TRADING_ENABLED`, counsel review) is right. The market's answer is **an RIA affiliate, or a
  partnership with one** (white-label RIA or turnkey asset-management platform). A publisher's-exclusion
  position covers only the *paper* and research parts. Copy and algo features should stay impersonal
  (same output for every subscriber, no per-user sizing advice from the AI) until an RIA structure exists.
  This touches `src/lib/copytrade/rebalance.ts` and `targets.ts`, `src/lib/algo/agent.ts`, `strategy.ts` and
  `live-gate.ts`, and the disclosure files `copytrade/disclosures.ts` and `algo/disclosures.ts`.

### B8. Email and outreach compliance

- **CAN-SPAM.** The maximum civil penalty is reported at $53,088 per violating email after the FTC's
  January 2025 inflation adjustment. Verkada's $2.95M (2024) is the largest CAN-SPAM penalty cited. B2B email
  is covered. No 2025–26 FTC CAN-SPAM action was found.
  ([Tomba](https://tomba.io/blog/can-spam-penalties-per-email), [Lashback](https://lashback.com/?p=984)) **[UNVERIFIED: penalty figure from secondary sources; confirm in the FTC's compliance guide]**
- **Gmail and Yahoo.** Bulk senders (5,000 or more a day to Gmail) need SPF, DKIM and DMARC, one-click
  unsubscribe through the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058; a footer link
  alone does not count), unsubscribes processed within two days, and spam complaints under 0.3%. From November
  2025 Gmail moved to temporary and permanent rejections of non-compliant mail.
  ([Zoho community](https://help.zoho.com/portal/es/community/topic/gmail-is-ramping-up-its-email-sender-policy-as-of-november-2025?page=1), [dev.to](https://dev.to/bounceproof_05/gmails-2026-bulk-sender-rules-what-email-marketers-must-fix-now-2878), [Suped](https://suped.com/email-deliverability/answers/how-to-comply-with-gmails-new-sending-rules-for-bulk-email-senders)) **[UNVERIFIED: Google's own page not reached; one vendor's "June 2026" one-click date is probably wrong, since the original deadline was June 2024]**
- **Microsoft (Outlook.com, Hotmail, MSN).** Enforcement began 5 May 2025 for senders of 5,000 or more a day.
  SPF and DKIM must pass and DMARC must align. Non-compliant mail is rejected with 550 5.7.515, and Safe Sender
  lists do not override this. Sources disagree on whether RFC 8058 is mandatory for Microsoft.
  ([Mailgun](https://www.mailgun.com/blog/deliverability/microsoft-sender-requirements/), [Resend](https://resend.com/blog/microsoft-bulk-sending-requirements-2025), [Validity](https://www.validity.com/blog/keeping-the-inbox-safe-microsofts-new-bulk-email-rules-explained/), [Suped](https://www.suped.com/learn/email-deliverability/what-are-the-new-microsoft-email-sender-requirements-and-observed-enforcement-bounces))
  - Note: YouBank sends from the *user's own* mailbox (IMAP/Gmail), so the 5,000-a-day bulk threshold applies
    to that user's domain. Most single users will not reach it. Authentication and complaint rates still
    decide inbox placement, and the unsubscribe and postal address are required by CAN-SPAM at any volume.
- **GDPR and contact enrichment.** On 14 July 2026 the Italian Garante fined a US data broker that sold
  enriched professional contacts EUR 2,000,000. Its legitimate-interest basis failed all three parts of the
  test. The EDPB published a data-broker market study on 3 March 2026. CNIL accepts legitimate interest for B2B
  only with a "legitimate professional source". Germany is stricter, and the ePrivacy rules are separate from
  GDPR.
  ([Legance](https://www.legance.it/pubblicazioni/alert-privacy-cybersecurity-update-gdpr-enforcement-and-the-first-cra-compliance-deadline/), [exceltic (secondary)](https://exceltic-marketing.pages.dev/en/articles/outbound-eu-cold-email-linkedin-gdpr-2026/)) **[UNVERIFIED: CNIL and Germany characterisations come from secondary sources]**
- **California Delete Act / DROP.** From 1 August 2026, registered data brokers must check DROP at least
  every 45 days and process deletions. SB 361 increased the registration fines, and commentary cites $200 per
  request per day for failures. Whether YouBank is a "data broker" depends on whether it sells or shares
  personal information about consumers it has no direct relationship with. Enriching a *user's own* contacts
  for that user is probably outside; building a shared prospect database is probably inside. **[UNVERIFIED: a
  question for counsel]**
  ([CPPA DROP](https://privacy.ca.gov/drop-for-data-brokers/), [Fenwick](https://www.fenwick.com/insights/publication/dont-drop-ball-upcoming-changes-california-delete-act-five-key-steps-companies), [Alston](https://www.alstonprivacy.com/drop-is-coming-due-what-californias-delete-act-means-for-data-brokers-in-august/))
- **Google OAuth restricted scopes and CASA.** YouBank's `GMAIL_SCOPES` (`src/lib/crm/gmail.ts`) request
  `gmail.readonly`, a **restricted** scope, plus `gmail.send` (sensitive). Production use of restricted scopes
  needs a CASA security assessment, **renewed every year** from the Letter of Validation. Reported costs run
  from $0 (Tier 2 self-scan with approved tools) to about $500–$4,500 through an assessor, with Tier 2 taking
  about two to three weeks. Vendor blogs say send-only (sensitive) scopes skip CASA.
  ([openwearables](https://openwearables.io/blog/google-casa-oauth-verification-health-apps), [LeadCenter](https://help.leadcenter.ai/security-compliance/casa-tier-2-assessment), [Google Cloud Community](https://security.googlecloudcommunity.com/google-security-operations-2/what-happened-to-local-app-gmail-api-access-7138)) **[UNVERIFIED: Google's and the CASA site's own pricing and tier rules not reached]**

### B9. Recording consent and SOC 2

- **AI notetaker litigation.** *In re Otter.AI Privacy Litigation* (N.D. Cal., 5:25-cv-06911) consolidates four
  suits from August–September 2025. The theory is that host-only consent breaches California's all-party rule
  (CIPA) and the federal ECPA. A blog reports that on 13 August 2026 the court partly denied dismissal, with the
  ECPA, CIPA and BIPA claims surviving. *Chamberlain v. Granola* (N.D. Cal., filed 30 July 2026) brings CIPA and
  ECPA claims. Fireflies faces an Illinois BIPA class action (December 2025). CIPA statutory damages are cited
  at $5,000 per violation.
  ([BuildBetter](https://blog.buildbetter.ai/ai-notetaker-lawsuits-2026-how-to-record-meetings-legally/), [Baird Holm](https://www.bairdholm.com/blog/core-privacy-claims-against-ai-note-taking-platform-survive-dismissal/), [UC Today](https://www.uctoday.com/security-compliance-risk/otter-ai-on-trial-and-the-ai-notetaker-industry-with-it/), [PropertyCasualty360](https://www.propertycasualty360.com/amp/2026/04/09/ai-notetaker-lawsuit-exposes-potential-business-liabilities/)) **[UNVERIFIED: 13 Aug 2026 ruling, single blog source; check CourtListener]**
- **All-party consent states.** The full list was not searched in this run. Commonly cited from general
  knowledge: California, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania and
  Washington, with partial rules in others such as Connecticut, Nevada, Oregon and Michigan. **[UNVERIFIED: not
  from this run's sources; get a current 50-state chart from counsel]**
  - *Implication:* README says Meetings already "require everyone's consent (with a notice to paste in the
    chat)". The Otter claims also turn on (a) using recordings to **train** models and (b) **voiceprints**
    under BIPA. So `src/lib/meetings/transcribe.ts` (speaker diarisation) needs a BIPA review for Illinois
    participants. The bot (`src/lib/meetings/bot.ts`) should announce itself and post consent text **by
    default**, not as an optional paste. Store per-participant consent evidence in `meetings.consent`. Keep
    "no training on your data" as a contractual promise.
- **SOC 2.** Type I is a point-in-time test of control design. Type II tests operation over a 3–12 month window,
  and buyers' risk teams often accept only Type II, discounting Type I in diligence. Cost estimates vary widely:
  Type I auditor fees $5k–$35k (Rippling, getagency), Type II $15k–$50k, and Type II after Type I $10k–$30k.
  Claims that the 2026 AICPA updates bring AI systems into scope are **[UNVERIFIED]**.
  ([Rippling](https://www.rippling.com/blog/soc-2-for-startups), [getagency](https://blog.getagency.com/articles/soc-2-audit-cost-for-startups), [soc2auditors](https://soc2auditors.org/insights/soc-2-type-1-vs-type-2/), [trycomp](https://trycomp.ai/soc-2-before-series-a))
  No source specific to PE or investment-bank vendor requirements was found. Combined with the Reg S-P
  service-provider duties (B6), regulated buyers will ask for a SOC 2 report or a security questionnaire, a
  72-hour breach-notice clause and a DPA. **[UNVERIFIED: inference]**
  - *Implication:* start the Type II observation window right after Type I (README roadmap lists Type I only).
    CASA Tier 2 evidence (SAST/DAST scans) overlaps SOC 2 CC7 controls, so run both through one programme.

---

## Actions for YouBank

### (a) New data to integrate

| # | Data | Cost / licence (from this research) | Module | Why |
|---|---|---|---|---|
| 1 | **Fix PatentsView**: live-test `search.patentsview.org/api/v1`; if dead, switch to USPTO ODP (free key) or quarterly bulk files | Free; USPTO public data; key required **[UNVERIFIED API details]** | `src/lib/edge/pulse/sources/patentsview.ts` | The API was paused and migrated on 20 Mar 2026; Pulse patent signals are probably empty |
| 2 | **GLEIF LEI and Level 2 parents** for entity resolution and corporate trees | Free, CC0, no key, about 60 req/min | new adapter beside `src/lib/edgar/client.ts`; `src/lib/company.ts`, `src/lib/edge/entities` | The FDTA made the LEI the joint entity identifier (effective 1 Oct 2026); buyer lists and comps need parent trees |
| 3 | **FIGI as the instrument key** everywhere (reuse the OpenFIGI path from copy trading) | Free (OpenFIGI) | `src/lib/copytrade/cusip.ts` → shared `src/lib/market/` | FDTA identifier set; one key across 13F, prices and filings |
| 4 | **"Bring your own licence" MCP client** for FactSet, LSEG, S&P, PitchBook, Morningstar, Daloopa and Crunchbase | $0 to YouBank; the user's own vendor licence | `src/lib/ai`, `src/lib/inference`; data rules from `src/lib/market/byo/` | Vendors monetise MCP by licence; no redistribution deal needed; fills ANR, FCST and private-market gaps for licensed firms |
| 5 | **IEX delayed TOPS/DEEP** as a licensed, delayed quote backup that replaces the Nasdaq.com scrape | Free on a delayed basis; real-time $1,000/mo (pending) | `src/lib/market/registry.ts`, `sources-meta.ts` | Removes the riskiest "unverified" source; needs a "Delayed" badge |
| 6 | **FMP Data Display and Licensing Agreement**, asking for AI and derived-data rights by name | Price not published; negotiate | `src/lib/market/fmp`, `sources-meta.ts` | FMP's ToS bars display without an agreement; the Nasdaq AI policy shows exchanges now license AI use separately |
| 7 | **UK Companies House** officers, PSCs and filings | Free API key (terms to confirm) | `src/lib/vc/sources/`, `src/lib/edge/entities` | UK targets; ID-verified director data from November 2025 |
| 8 | **WARN Watch CSV** (CC BY 4.0) to widen WARN beyond TX, CA and NY | Free with attribution **[UNVERIFIED licence]** | `src/lib/edge/pulse/sources/warn.ts` | 50-state coverage without scraping 47 more sites |
| 9 | **SAM.gov opportunities** as a per-user key | Free api.data.gov key; tight quotas | `src/lib/edge/pulse/sources/` + BYO pattern | Government contract pipeline signal; a shared key does not work |
| 10 | **Add an `aiUse` licence field** to every source; `forModel()` reads it | n/a | `src/lib/market/sources-meta.ts`, `user-context.ts` | Generalises the FRED special case to the Nasdaq, DBAG and CME/LSEG AI-licensing trend |
| 11 | Sentinel attribution string on every Edge output | Free, attribution required | `src/lib/edge/sources/sentinel.ts`, `s1.ts`, exports | The Copernicus licence requires a modification notice |
| 12 | Full-text search hardening: always send `startdt` and `enddt`; split windows at 10k hits | Free | `deals` adapter in `src/lib/market/registry.ts` | Community-reported quirks **[UNVERIFIED]** |

### (b) Compliance must-dos, ranked by risk

1. **Campaign email: `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058), a visible unsubscribe line and
   a postal address, opt-outs honoured within two days, and SPF/DKIM/DMARC checks on the sender's domain
   before a campaign starts.** CAN-SPAM's per-email penalty exposure plus Gmail and Microsoft rejection.
   README lists these as known gaps. *Module:* `src/lib/crm/campaigns.ts`, `send.ts` (`sendDraft()`),
   `outreach.ts`, `nurture.ts`.
2. **Copy trading and algo trading stay impersonal or go through an RIA.** Keep real orders off
   (`COPYTRADE_TRADING_ENABLED`, live gates) until counsel picks between the publisher's exclusion
   (impersonal, same for all) and an RIA affiliate or partner, which is the Autopilot/dub model. Stop the AI
   agent from giving per-user sizing or "buy for you" advice. *Module:* `src/lib/copytrade/{rebalance,targets,live,disclosures}.ts`,
   `src/lib/algo/{agent,agent-gate,live-gate,disclosures}.ts`, `src/lib/quant`.
3. **Meeting recording consent and biometrics.** The bot announces itself and posts consent text by default.
   Store each participant's consent. No recording when a participant objects. Run a BIPA review of speaker
   diarisation (voiceprints) for Illinois participants. Never train on recordings. *Module:*
   `src/lib/meetings/{bot,transcribe,store,model}.ts`, desktop audio capture (`desktop/`).
4. **Market-data licensing before paid plans.** Sign FMP's display agreement, with AI-use and derived-data
   rights in writing. Set `MARKET_BACKUP=off` in production and replace Nasdaq.com with IEX delayed data.
   Show "Delayed" notices. *Module:* `src/lib/market/{registry,sources-meta,badges}.ts`, `src/lib/fmp`.
5. **AI-capability claims (SEC exam focus, AI washing).** Audit the marketing site and README claims ("does
   the work", benchmark numbers, "anytime-valid autonomy certification") so every claim is reproducible and
   evidenced. Keep the evidence. *Module:* `src/app` marketing pages, `src/lib/site.ts`, docs.
6. **Gmail restricted scope: CASA.** Either budget a yearly CASA Tier 2 (reported cost $0 self-scan to about
   $4.5k, 2–3 weeks), or ship a send-only, sensitive-scope mode (`gmail.send`) and keep reading on the
   IMAP/app-password path. Past 100 test users the OAuth path stops working without verification. *Module:*
   `src/lib/crm/gmail.ts` (`GMAIL_SCOPES`), `mailbox.ts`, `imap.ts`.
7. **GDPR and enrichment provenance.** Record a source for every enriched contact, keep a Legitimate Interest
   Assessment, and keep the EU/EEA/Canada consent guard (and extend it to UK and German domains). Never build a
   shared cross-customer prospect database without counsel, because of the Garante EUR 2M precedent and
   California DROP data-broker status. *Module:* `src/lib/crm/{contacts,outreach,model}.ts`,
   `src/lib/edge/intros.ts`.
8. **Reg S-P service-provider readiness.** Publish a DPA and security addendum with a 72-hour breach notice to
   customers, an incident runbook and a subprocessor list (OpenAI, Anthropic, Neon, Vercel, SnapTrade, Alpaca).
   *Module:* `docs/`, `src/lib/errors.ts` (Sentry), billing and Enterprise onboarding (`src/lib/billing`).
9. **SOC 2.** Type I, then start the Type II window straight away. Reuse the CASA scans as SOC 2 evidence.
   *Module:* org-wide; audit logs (`copy_audit`, `algo_audit`, CRM audit CSV) are evidence.
10. **AI transparency for EU recipients and users (EU AI Act deployer transparency, from 2 August 2026).**
    Disclose AI-drafted outreach where required, and label AI output in shared decks and memos. Watch for
    Colorado SB 26-189 and California ADMT (both 1 January 2027), although YouBank likely makes no consequential
    consumer decisions. *Module:* `src/lib/crm/compose.ts`, `src/lib/studio`, `src/lib/memo.ts`.

**Not confirmed in this run; check before acting:** DERA Form D/Reg A/Reg CF data sets in 2026; Google's and
Yahoo's own sender-guideline pages; CASA's official pricing; final publication of the EU omnibus in the
Official Journal; the 13 August 2026 Otter ruling; SB 26-189's final text; the all-party consent state list;
the FERC and BLS API terms. The search budget ran out before these could be checked.
