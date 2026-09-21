# Accounting professions: market research for YouBank

Prepared 2026-09-20. Scope: external audit, tax, technical accounting / SEC reporting, transaction advisory (FDD), forensic accounting, corporate controllership. Purpose: what these people do, what data and standards they work from, what an AI copilot plus a financial database can genuinely automate, and which YouBank features to build first. Sources are standards, Big 4 guides, vendor pages, job postings and trade press read this week; where I rely on common firm practice rather than a published source, I say so.

Two facts frame everything. Anything in SEC filings (statements, footnotes, XBRL facts, audit reports, comment letters, 8-Ks) is free and machine-readable, and YouBank already has an EDGAR pipeline. Anything inside a company (general ledger, journal entries, trial balances, sub-ledgers, contracts, bank statements) must be uploaded and arrives in inconsistent formats. The strongest early features run on public data; the highest-value features need uploads.

---

## 1. Role overview and calendar

### 1.1 The six specialties

**External audit (Big 4 / mid-tier).** Opines on financial statements and, for accelerated and large accelerated filers, on internal control (SOX 404(b), AS 2201). Core work: risk assessment (AS 2110), responses to risk (AS 2301), controls and substantive testing, sampling (AS 2315), analytics (AS 2305), estimates (AS 2501), journal-entry and fraud procedures (AS 2401), evaluating results (AS 2810); private companies follow AICPA GAAS. Moving parts: AS 2310 (confirmations) applies to fiscal years ending on or after June 15, 2025; amendments to AS 1000 (conforming), AS 2110, AS 2201, AS 2315, AS 4105 and AS 2901 take effect December 15, 2026; documentation completion drops from 45 to 14 days after report release; the replacement analytical procedures standard proposed June 12, 2024 was not yet adopted on the PCAOB project page.

**Tax.** ASC 740 provision (current and deferred, valuation allowances, uncertain positions, rate reconciliation), compliance (Forms 1120, 1065, 1120-S, state), M&A structuring (stock vs asset, Sections 338(h)(10), 336(e), F-reorganizations, 382), transfer pricing (Section 482 arm's-length standard, documentation, the IRS APMA program) and state and local tax (nexus, apportionment, sales/use, property). ASU 2023-09 applies to public business entities for annual periods beginning after December 15, 2024, so FY2025 10-Ks were the first with the eight-category rate reconciliation and taxes-paid-by-jurisdiction table.

**Technical accounting / SEC reporting.** Memos and policies on ASC 606, 842, 805, 350, 718, 326, 260, 810, 830 and IFRS differences; disclosure checklists; 10-K/10-Q drafting and tagging under Regulation S-X and S-K. Next adoption: ASU 2024-03 (expense disaggregation), annual periods beginning after December 15, 2026, interim after December 15, 2027.

**Transaction advisory / FDD.** The QoE report and Excel databook: normalized EBITDA, NWC and the peg, net debt and debt-like items, proof of cash, revenue and customer analyses. Engagements run 30 to 45 days (60 to 90 with tax and IT diligence); buy-side fees about $40k to $90k single-entity, $90k to $200k bundled; a 2026 mid-market deal runs about seven parallel workstreams over 400 to 500 documents.

**Forensic accounting.** Investigations, litigation support, anomaly detection (Benford's Law, duplicates, thresholds). ACFE's 2026 Report to the Nations covers 2,402 cases from 143 countries; the costliest red flags were "excessive pressure from within the organization" ($532,000 median loss), past legal problems ($400,000), unusually close vendor/customer ties ($300,000) and refusal to take vacations ($250,000). The 2024 edition's headline figures (about 5% of revenue lost to fraud, median loss about $145,000, financial statement fraud rarest but costliest) still frame the practice.

**Corporate controllership.** Close, reconciliations, consolidation, flux, statements, SOX, XBRL, 10-K/10-Q. Top performers close in 3 to 5 business days; the APQC median is 6.4 calendar days; companies with substantial automation close within six days 88% of the time versus 40% without; 94% of teams still use Excel and half call it the main slowdown.

### 1.2 Calendar for calendar-year filers, 2026 (Mayer Brown)

| Event | Large accelerated | Accelerated | Non-accelerated / SRC |
|---|---|---|---|
| Form 10-K (FYE Dec 31, 2025) | March 2 | March 16 | March 31 |
| Form 10-Q Q1 / Q2 / Q3 | May 11 / Aug 10 / Nov 9 | May 11 / Aug 10 / Nov 9 | May 15 / Aug 14 / Nov 16 |
| Proxy (Part III incorporation) | April 30 | April 30 | April 30 |
| Form 20-F / Form 11-K (ERISA) | April 30 / June 29 | | |
| Form 12b-25 extension | +15 calendar days (10-K), +5 (10-Q), filed by the next business day | | |

Rules: 10-K due 60/75/90 days after year end, 10-Q 40/40/45 days after quarter end. Filer status follows public float on the last business day of Q2: large accelerated at $700 million or more, accelerated at $75 million to $700 million, non-accelerated below $75 million or a smaller reporting company with revenue under $100 million (exit thresholds $560 million and $60 million). 404(b) attestation applies to large accelerated and accelerated filers only.

Tax: Forms 1065 and 1120-S due March 16, 2026 (the 15th is a Sunday), extended to September 15; Form 1120 due April 15, extended to October 15 (Form 7004 extends filing, not payment); corporate estimates April 15, June 15, September 15, December 15. Provision cycle: Q4 provision in January and February feeding the 10-K, an ASC 740-270 estimated annual rate at each 10-Q, return-to-provision true-up after the extended return.

Audit busy season for December year-ends runs mid-January to the 10-K date; planning and interim controls testing June to November; quarterly reviews (AS 4105) before each 10-Q; June 30 year-ends fill July to September; private and benefit plan audits stretch March to June. Controllers close in the first five to ten business days of every month. FDD and forensic work are deal- and event-driven with a Q4 rush.

---

## 2. Day-to-day tasks by seniority

Titles vary by firm, but the pattern holds everywhere: staff prepare, seniors run the day and review staff, managers own the file and the client, partners own the opinion or the relationship.

### 2.1 External audit
- **Associate/Staff (years 1–3).** Roll forward workpapers; lead schedules tied to the trial balance; confirmations under AS 2310 (auditor selects, sends and receives; positives preferred; negatives only as a supplement in low-risk homogeneous populations; alternative procedures such as subsequent receipts on non-replies); vouching and roll-forwards; unrecorded liabilities search; inventory counts; walkthrough documentation; control tests (25 to 40 items for a daily control is common practice); PBC chasing. RKL's "Audit Associate 2026" posting: "assist in detailed testing procedures of the balance sheet and income statement accounts" and "review and audit business transaction cycles such as treasury, revenues, purchases, payroll."
- **Senior (3–5).** Runs two to four associates; drafts the plan and materiality memo; risk assessment (AS 2110: understanding the entity, walkthroughs "from origination through the company's processes ... until it is reflected in the company's financial records," planning analytics, the fraud brainstorm); designs the JE test; tests revenue, estimates, impairment and taxes with specialists; prepares the summary of uncorrected misstatements; drafts management letter points.
- **Manager (5–8).** Budget, staffing, client relationship; reviews every workpaper; concludes on significant risks, going concern (AS 2415: up to one year beyond the balance sheet date) and deficiencies (material weakness vs significant deficiency); national office consultations; drafts the opinion and AS 1305 written deficiency communications before the report date.
- **Senior Manager/Director.** Portfolio of engagements; inspection readiness (PCAOB inspections repeatedly cite JE testing: population completeness untested, selection criteria not tied to fraud risk, rationale undocumented); proposals; technical review.
- **Partner.** Signs the opinion; engagement quality reviews (AS 1220); audit committee relationship; independence and acceptance; economics.

Cadence: planning and materiality (June–September); control matrices (annual); interim controls testing and roll-forward (Q3–Q4); confirmations and substantive testing (year end to February); JE testing (year end, full period considered); SUM and going concern memo (pre-report); management letter and audit committee communications (report date); quarterly reviews three times a year; archive within 14 days.

### 2.2 Tax
- **Staff.** Book-to-tax adjustment workpapers (depreciation, accruals, stock comp, reserves); apportionment schedules; returns in compliance software; extensions and estimates.
- **Senior.** Prepares the provision: current payable, deferred inventory by account, deferred rollforward, rate reconciliation, valuation allowance analysis, proof of provision; return-to-provision true-up; nexus reviews; UTP memos; reviews staff returns.
- **Manager.** BDO's ASC 740 posting: "primary owner of the consolidated income tax provision process, including SEC filing disclosures, ETR reconciliation, deferred tax analysis, and uncertain tax positions," plus reviewing federal and state filings, deadlines and payments, nexus and apportionment, SOX controls. In M&A, models a 338(h)(10) step-up against the seller's incremental cost and the state "mosaic" where treatments diverge.
- **Senior Manager/Director/Partner.** Technical conclusions (Section 382, Pillar Two, APAs, method selection), audit defense, planning, signing returns and opinions, CFO and audit committee relationships.

Cadence: quarterly provision and AETR with each 10-Q; annual provision and disclosure with the 10-K; extensions March/April; estimates quarterly; returns September/October; transfer pricing documentation with the return; UTB rollforward annually.

### 2.3 Technical accounting and SEC reporting
- **Staff/Senior.** Memos for non-standard transactions (Beech Valley posting: "assessing transactions, establishing standard accounting policies, and drafting and reviewing technical memos"); lease schedules; disclosure checklist; 10-K tie-out; XBRL review; EPS and stock comp calculations.
- **Manager.** Owns 10-K/10-Q drafting and the calendar; concludes on ASC 606 (five steps, principal vs agent, the constraint), ASC 842 classification and IBR, ASC 805 allocations with valuation specialists, ASC 350 tests, ASC 326 allowances; evaluates new ASUs (now ASU 2024-03); answers auditors and SEC comment letters; runs S-X significance tests on acquisitions (Rule 3-05 acquired businesses; Rule 3-09 equity investees above 20%; Rule 4-08(g) summarized information above 10%).
- **Director/CAO.** Hardest positions, national office and SEC pre-clearance, audit committee materials, policy elections, IPO readiness, board and investor communication.

### 2.4 Transaction advisory (FDD)
- **Associate/Senior.** Builds the databook from monthly trial balances and GL detail: monthly P&L and balance sheet, EBITDA bridge, adjustment log with support, monthly NWC, net debt schedule, proof of cash, customer and product cubes, headcount and capex.
- **Manager.** Interviews management, decides adjustments, drafts the report; PwC's posting: "analyze financial information focused on quality of earnings, assets, cash flows, and other key client deal issues." Typically 10 to 30% of seller add-backs are disallowed, the classic being an item "labelled one-off that has appeared in three consecutive years"; at 6x, $200,000 of rejected add-backs moves headline price by $1.2 million.
- **Director/Partner.** Scope and fees, SPA input (working capital definition and peg, net debt definitions, true-up 60 to 90 days post close), sell-side diligence, sponsor and lender relationships.

### 2.5 Forensic
- **Staff/Senior.** Data preservation, GL and AP/AR extracts, Benford and duplicate testing, vendor master screening (employee addresses, sequential invoices), document review coding, timelines.
- **Manager/Director/Partner.** Hypothesis-driven plans, interviews, loss quantification, expert reports under privilege, remediation, testimony, special committee investigations.

### 2.6 Controllership
- **Staff/Senior Accountant.** Bank, AR, AP, prepaid, fixed asset and accrual reconciliations ("no rec, no close"); recurring entries (accruals, prepaid amortization, depreciation, deferred revenue, payroll accrual, monthly tax estimate); subledger-to-GL ties by day 3 for cash, AR and AP; intercompany matching.
- **Accounting Manager / Assistant Controller.** Close calendar; review of recs and JEs (preparer never equals approver); flux analysis against prior period and budget; consolidation and eliminations; SOX evidence.
- **Controller / CAO.** Statements and management package; 10-Q/10-K ownership; policy decisions; audit relationship; period lock; SOX 302/906 certifications; hiring (2026 Controllers Council: talent shortage index 77%, hiring index 134%; an MIT Sloan/Stanford study cited by CFO Dive found generative AI cut 7.5 days off the monthly close).

---

## 3. Data and documents

| Source | Fields that matter | Users | Access |
|---|---|---|---|
| Journal entry population | entity, account, period, posting and effective dates, amount, currency, user, approver, source (manual/system/recurring), description, document number, reversal flag | Audit, forensic, controllership | Upload; exports differ by ERP ("a trial balance from QuickBooks and ... Sage do not share the same chart of accounts, field names, or data structure") |
| Trial balance by entity and month | account, FS mapping, period, entity, currency, adjustments | All | Upload |
| Sub-ledgers (AR/AP aging, fixed assets, inventory, payroll, leases, debt) | counterparty, dates, amounts, aging bucket, asset class, lease term and rate | Audit, FDD, controllership | Upload |
| Bank statements | date, description, amount, balance | Audit, FDD, forensic | Upload (PDF/CSV) |
| Contracts (customer, lease, debt, purchase agreements) | obligations, pricing, term, options, covenants | Technical accounting, audit, FDD | Upload |
| Management analyses (impairment models, provision workbooks, SSP studies) | assumptions, rates, growth | Audit (AS 2501), technical accounting | Upload |
| SEC filings (10-K, 10-Q, 8-K, S-1, proxy) | statements, footnotes, MD&A, CAMs, Item 4.01 auditor changes, Item 4.02 restatements, Item 9A controls | All | Free; already fetched by YouBank |
| XBRL company facts and frames | concept, value, unit, period, fiscal year/period, form, accession, dei:EntityPublicFloat, dei:EntityFilerCategory | Analytics, benchmarking, flux | Free APIs, no key, 10 requests/second with a User-Agent; nightly companyfacts.zip about 3 a.m. ET; verified this week: frames for Goodwill at CY2025Q4I returned 2,910 filers |
| Financial Statement and Notes data sets | numeric and text (footnote) tables, monthly | Footnote benchmarking | Free bulk; the 2025 Q1 file is 632 MB |
| EDGAR full-text search | form type (UPLOAD = staff comment letters, CORRESP = responses), date, entity, SIC | Comment letter research | Free JSON endpoint, verified this week |
| Authoritative literature: FASB ASC, PCAOB AS, S-X/S-K, AICPA guides, PwC Viewpoint, KPMG Handbooks, Deloitte DART, EY FRDs | paragraph references | All | PCAOB free; Big 4 guides free with registration; full ASC text needs a FASB login |

For internal data the unlocking fields are entity, account, period, amount, currency and, for JEs, user, timestamp, source and description. Without user and timestamp you cannot run AS 2401 selections; without entity and currency you cannot consolidate.

---

## 4. Core methodologies

**4.1 Materiality (AS 2105, AS 2810).** Overall materiality is a specified amount judged from a reasonable investor's view; tolerable (performance) materiality must be lower; separate lower levels apply where smaller amounts matter. Common practice, not in the standard: 5% of pretax income when profitable, 0.5% to 1% of revenue or assets otherwise, performance materiality 50% to 75% of overall, clearly trivial 3% to 5% of overall. Everything above clearly trivial is accumulated and evaluated individually and in aggregate with qualitative factors (trend changes, covenants, bonus thresholds, fraud).

**4.2 Sampling (AS 2315).** Sampling risk: incorrect acceptance or rejection (substantive), assessing control risk too low or too high (controls). Sample size rises with risk and expected misstatement, falls with tolerable misstatement and other effective procedures; population size has "virtually no effect ... unless the population is very small." Tolerable deviation rates: 5% or less for high reliance, 10% or more when combined with other tests. Project misstatements: $3,000 in a 50-of-1,000 sample projects to $60,000. Monetary unit sampling is standard for overstatement-prone balances.

**4.3 Analytical procedures (AS 2305 and the proposal).** Build an expectation from plausible, predictable relationships; set a threshold (the proposal ties it to tolerable misstatement); compare; investigate. Trend, ratio, reasonableness tests and regression; the proposal bans circular expectations from the company's own amount and adds evidence requirements for external data. Precision comes from disaggregation by month, location, product.

**4.4 Journal entry testing (AS 2401).** Understand controls over JEs; prove completeness by rolling JE detail to the change in trial balance; select entries with fraud characteristics: unrelated or seldom-used accounts, unusual preparers, period-end or post-closing timing, missing descriptions, round numbers or consistent endings, complex estimate accounts; examine support and business purpose. Benford's first-two-digits test (expected proportions from 0.0414 for "10" to 0.0044 for "99") suits manual entries with at least 5,000 records; exclude automated recurring and top-side entries. HealthSouth booked thousands of entries just below a $5,000 testing threshold, visible as a ridge in the digit distribution and via a runs test.

**4.5 Revenue (ASC 606).** Identify the contract; identify performance obligations; determine the transaction price (variable consideration and the constraint, financing, non-cash, consideration payable to the customer); allocate on relative standalone selling prices; recognize when or as obligations are satisfied (over time by input or output, or point in time on control transfer). Principal vs agent turns on control before transfer. Auditors presume a fraud risk in revenue (AS 2110).

**4.6 Leases (ASC 842).** Five finance-lease criteria (ownership transfer, purchase option reasonably certain, major part of economic life, substantially all of fair value, specialized asset). Liability is the present value of remaining payments at the implicit rate if readily determinable (rare), else the incremental borrowing rate: "the rate of interest that a lessee would have to pay to borrow on a collateralized basis over a similar term an amount equal to the lease payments in a similar economic environment," built from a base yield plus credit spread with a downward collateral adjustment; private companies may elect a risk-free rate. ROU asset equals the liability adjusted for prepaid rent, incentives and initial direct costs. IFRS 16 has one lessee model.

**4.7 Purchase price allocation (ASC 805 / 820).** Identifiable assets and liabilities at fair value; goodwill is the residual. Relief-from-royalty for trade names, technology and patents (present value of royalties avoided); multi-period excess earnings for customer relationships (cash flows net of contributory asset charges); with-and-without for non-competes; cross-check the weighted average return on assets against the WACC and IRR. In a 338(h)(10) deal the ADSP is allocated under the Section 1060 residual method with Section 197 intangibles and goodwill amortized over 15 years; the election needs a qualified stock purchase (80% within 12 months) and is filed within 8.5 months.

**4.8 Goodwill impairment (ASC 350, ASU 2017-04).** Optional qualitative step: is it more likely than not (over 50%) that reporting unit fair value is below carrying amount? Then one quantitative step: impairment = carrying amount minus fair value, capped at allocated goodwill. Fair value combines a DCF and guideline multiples reconciled to market capitalization with an implied control premium. Tax-deductible goodwill needs the simultaneous equation in ASC 350-20-55-23C to avoid circularity with the deferred tax liability. Test annually and on triggering events.

**4.9 Income taxes (ASC 740).** Total tax = current + deferred. Current: pretax book income adjusted for permanent and temporary differences, less carryforwards, times the statutory rate, less credits. Deferred: temporary differences and carryforwards at enacted rates, with a valuation allowance when realization is not more likely than not (four sources of taxable income; a three-year cumulative loss is significant negative evidence). Uncertain positions: recognition (more likely than not on technical merits) then measurement (largest amount with over 50% cumulative probability); disclose the UTB rollforward (prior-year positions, current-year positions, settlements, statute lapses), the amount affecting the ETR and open years. Interim: estimated annual rate on year-to-date income with discrete items in the quarter. ASU 2023-09: eight rate reconciliation categories (state and local net of federal, foreign, enacted law changes, cross-border laws, credits, valuation allowance changes, nontaxable/nondeductible items, changes in UTBs) with separate disclosure above 5% of pretax income times the statutory rate, and taxes paid by federal/state/foreign with jurisdictions at or above 5% listed.

**4.10 Flux thresholds.** Dual thresholds are standard practice: investigate any account moving more than, say, 10% and more than a dollar amount tied to materiality (auditors use a fraction of tolerable misstatement); commentary names the driver (volume, price, timing, one-time) with evidence, balance sheet first, then P&L against prior month and budget.

**4.11 Consolidation (ASC 810, ASC 830).** Close local books; translate foreign subsidiaries (assets and liabilities at period-end rate, income statement at average rates, equity at historical; the difference is the cumulative translation adjustment in OCI, while remeasurement of non-functional-currency balances hits earnings); eliminate intercompany balances, revenue/expense, unrealized profit and investment against subsidiary equity; record noncontrolling interest; then top-side entries. Failures cluster in intercompany timing and FX, clearing accounts and top-side entries that bypass controls.

**4.12 Disclosure benchmarking.** Pull the same footnote (revenue policy, goodwill assumptions, lease rates, CECL method, rate reconciliation) across a peer set, compare structure and assumptions, and read staff comment letters on those peers. The SEC data sets and full-text search make this a query, not a reading exercise.

**4.13 QoE, NWC and net debt.** Normalize EBITDA for non-recurring revenue and expense (asset sale gains, insurance and litigation, PPP/ERC, owner personal expenses, family payroll, discontinued operations), run-rate and pro forma items (market-rate owner pay, price changes, lost customers) and accounting corrections (cut-off, revenue recognition, capitalization). The peg is typically a trailing-twelve-month average of monthly NWC on a consistent cash-free/debt-free definition adjusted for seasonality; at closing, actual NWC versus the peg adjusts price dollar for dollar. Net debt adds debt-like items: accrued interest, unpaid bonuses, unfunded pensions, unpaid sales and payroll taxes, deferred consideration, customer deposits, deferred revenue for undelivered services, rent-free accruals, break costs. Proof of cash reconciles bank deposits and disbursements to recorded revenue and expenses.

**4.14 Going concern (AS 2415; ASC 205-40).** Evaluate conditions (recurring losses, working capital deficits, negative operating cash flow, defaults, loss of key customers) over up to one year beyond the balance sheet date, assess management's plans, and if substantial doubt remains add an explanatory paragraph saying "substantial doubt about its ability to continue as a going concern." Management's own ASC 205-40 look-forward runs one year from the issuance date.

**4.15 ICFR (AS 2201).** Top-down: entity-level controls (control environment, management override, period-end reporting), significant accounts and assertions, risk-control matrix, walkthroughs, design then operating effectiveness, roll-forward, deficiency classification. Material weakness: "a reasonable possibility that a material misstatement ... will not be prevented or detected on a timely basis"; indicators include senior management fraud, restatements and ineffective audit committee oversight.

---

## 5. Pain points and what AI plus data can automate

**What hurts.** Getting data out of client systems (a CPA.com survey lists "lack of access to client data" among the top obstacles to AI in audit); inconsistent trial balances and charts of accounts; PBC chasing; re-performing roll-forwards yearly; reading hundreds of contracts for a few terms; rewriting the same memo skeleton; finding how peers disclosed something; anticipating SEC comments; tying numbers across Excel, Word and the filing; the 14-day archive; turnover; provision workbooks that break when the trial balance changes; JE populations too large to sample well; add-back arguments with no evidence trail; close bottlenecks from unreconciled items and missing accruals.

| Task | Automatable today | Data | Notes |
|---|---|---|---|
| Peer disclosure benchmarking, footnote extraction, XBRL comparison | Fully | Public | Free; on the existing pipeline |
| Comment letter research, likely-question prediction | Yes | Public | Letters are released after the review closes, so there is a lag |
| Materiality calculation and memo | Yes | Public benchmarks; upload for private companies | Judgment stays with the auditor |
| Planning and substantive analytics | Largely | Public peers; upload for monthly detail | Precision needs disaggregated internal data |
| JE population testing, Benford, anomaly scoring | Yes once uploaded | JE detail with user, time, source | MindBridge/Caseware territory; differentiate on explainability and price |
| Sample size, selection, projection | Yes | Population upload | Deterministic; AI drafts rationale |
| Walkthroughs and risk-control matrices | Draft only | Narratives | Humans confirm what actually happens |
| Confirmations | Assist only | Intermediary | AS 2310 requires auditor control and evaluation of intermediary controls |
| Technical memos (606, 842, 805, 350, 718, 326) | Strong first drafts | Contract/facts; public precedents | Must cite ASC paragraphs |
| Provision workpapers, rate reconciliation, UTB rollforward | Yes, structured | TB and adjustments | ONESOURCE/Corptax exist; edge is explanation and disclosure drafting |
| QoE databook, peg, net debt, proof of cash | Yes | Monthly TBs, GL, bank statements | Adjustment judgment stays with the manager |
| Close checklist, rec status, flux commentary | Yes | TB and JE detail; XBRL for public flux | BlackLine/FloQast own workflow; edge is narrative and cross-period reasoning |
| 10-K drafting, XBRL tagging | Partially | Peer language, prior filings, draft upload | Workiva owns filing; stay in research and pre-drafting |
| Filing the return, signing the opinion | No | | Licensed professional acts |

Two constraints belong in the product. Confidentiality: client data must never train models, and determinism matters because "multi-step AI workflows compound the problem" when data quality is poor (the Journal of Information Systems study of 37 Big 4 auditors flags overreliance, transparency and confidentiality as audit-quality risks). Independence: an audit firm cannot prepare its audit client's records, so the same feature is framed as analyze/benchmark/select for auditors and prepare/draft/post for controllers.

**Where the market is.** A 2026 Thomson Reuters survey found 40% of organizations using generative AI (22% a year earlier); among tax firms 21% are active, 53% planning, and 52% of users rely on general tools like ChatGPT versus 17% on industry-specific ones. Deloitte embedded generative and agentic AI in Omnia for document review; EY's AI platform underpins 160,000+ audit engagements; PwC reports 20% to 50% development productivity gains and an end-to-end AI-driven audit expected in 2026; 75% of audit partners retire within a decade. Caseware (23,000+ organizations) reports 107 to 167 hours saved per engagement with agents for GL import, risk suggestion, revenue recognition, disclosure checklists and XBRL tagging, and its Validate tool runs 450+ checks; DataSnipper serves all top 100 firms and claims 85% time savings on high-volume testing; MindBridge scores 100% of transactions with ensemble models and explainable control points; BlackLine (4,400+ customers, about $77k a year, 4.5 to 5.2 month implementations) and FloQast (3,500+ customers, $12k to $23k, 1.3 to 1.7 months, ISO 42001) own the close; Workiva (6,700+ customers, over 85% of the Fortune 1000, 350+ form types, six-figure deployments) owns filing and now advertises AI peer benchmarking and predictive tagging. The open space for YouBank is a fast, cheap, database-backed research and analysis layer these workflow tools do not provide: cross-company public-data intelligence plus lightweight upload analytics for teams that cannot justify enterprise platforms.

---

## 6. Glossary

1. **AETR** – Estimated annual effective tax rate applied to year-to-date income in interim periods.
2. **ADSP / AGUB** – Aggregate deemed sale price and adjusted grossed-up basis in a Section 338 election.
3. **ASC / AS** – FASB Codification (US GAAP) / PCAOB Auditing Standards.
4. **Benford's Law** – Expected leading-digit distribution used for anomaly detection.
5. **CAM** – Critical audit matter in the auditor's report.
6. **CECL** – Current expected credit loss model (ASC 326), lifetime losses from day one.
7. **Clearly trivial** – Threshold below which misstatements are not accumulated.
8. **Comment letter** – SEC staff letter (UPLOAD) and company response (CORRESP).
9. **Contributory asset charge** – Return on supporting assets deducted in MPEEM.
10. **CTA** – Cumulative translation adjustment in OCI (ASC 830).
11. **Debt-like item** – Obligation treated as debt in a cash-free/debt-free deal.
12. **Deferred tax asset/liability** – Tax effect of temporary differences at enacted rates.
13. **DISE** – Disaggregation of income statement expenses (ASU 2024-03).
14. **Filer status** – Large accelerated, accelerated, non-accelerated; drives deadlines and 404(b).
15. **Flux analysis** – Period-over-period variance analysis with explanations.
16. **Frames API** – SEC endpoint returning one XBRL fact per filer for a concept and period.
17. **Going concern** – Presumption of continuity; substantial doubt triggers disclosure and report language.
18. **Goodwill** – Residual of consideration over identifiable net assets, tested at the reporting unit.
19. **IBR** – Incremental borrowing rate for discounting lease payments.
20. **ICFR** – Internal control over financial reporting.
21. **Iron curtain / rollover** – Balance sheet and income statement views of uncorrected misstatements.
22. **JE testing** – Fraud-focused examination of journal entries (AS 2401).
23. **Materiality / tolerable misstatement** – Overall and working thresholds (AS 2105).
24. **Material weakness / significant deficiency** – ICFR deficiency classes (AS 2201).
25. **MPEEM** – Multi-period excess earnings method for customer relationships and technology.
26. **MUS** – Monetary unit sampling, probability proportional to size.
27. **NWC peg** – Target normalized working capital in the purchase agreement.
28. **PBC** – Prepared-by-client request list.
29. **Performance obligation** – Distinct promise in a customer contract (ASC 606).
30. **PPA** – Purchase price allocation (ASC 805).
31. **Proof of cash** – Reconciliation of bank activity to recorded revenue and expenses.
32. **QoE** – Quality of earnings, normalized sustainable EBITDA.
33. **Rate reconciliation** – Statutory-to-effective rate bridge; eight categories under ASU 2023-09.
34. **RCM** – Risk-control matrix mapping what-could-go-wrong to controls and tests.
35. **Relief from royalty** – Intangible value as present value of royalties avoided.
36. **ROU asset** – Lessee right-of-use asset.
37. **Section 338(h)(10)** – Joint election treating a stock purchase as an asset purchase for tax.
38. **Significance tests** – S-X Rule 1-02(w) investment, asset and income tests behind Rules 3-05/3-09.
39. **SOX 302 / 404(a) / 404(b)** – Officer certifications; management's ICFR assessment; auditor attestation.
40. **SSP** – Standalone selling price used for allocation.
41. **SUM / SAD** – Summary of uncorrected misstatements / audit differences.
42. **Top-side entry** – Consolidation-level adjustment outside the sub-ledger.
43. **UTB / UTP** – Unrecognized tax benefit from an uncertain tax position.
44. **Valuation allowance** – Reduction of deferred tax assets not more likely than not realizable.
45. **Walkthrough** – Tracing a transaction from origination to the records.
46. **XBRL / iXBRL** – SEC tagging standard; inline XBRL embeds tags in the filing HTML.

---

## 7. Feature proposals for YouBank

Data mode: **P** = public SEC/XBRL only (free, on the existing pipeline); **U** = user upload required; **B** = both. Difficulty is for a v1 on the current Next.js / Neon / EDGAR / LLM stack. Codes follow the `TICKER FUNCTION` convention.

| # | Feature (code) | Description | Inputs | Outputs | Data | AI role | Difficulty |
|---|---|---|---|---|---|---|---|
| 1 | Peer Disclosure Benchmarker (`DISC`) | One footnote or policy side by side across a peer set | Ticker, topic, peer group | Extracted text, assumptions, differences, citations | P | Locate and extract notes; summarize differences | Medium |
| 2 | Comment Letter Radar (`CL`) | Search staff letters and responses; predict questions for a draft | Topic or ticker, SIC, dates | Ranked letters, themes, likely questions | P | Full-text search; clustering; drafting | Medium |
| 3 | XBRL Fact Comparator (`XBRL`) | Any concept across peers and periods with outlier and extension flags | Concept, peer set, period | Table, z-scores, flags | P | Map language to concepts; explain outliers | Low |
| 4 | Materiality Calculator (`MAT`) | Benchmark selection and memo | Ticker or uploaded TB | Overall, performance, clearly trivial, memo | B | Recommend benchmark; draft memo | Low |
| 5 | Planning Analytics Pack | Five-year ratios and trends vs peers with fluctuation flags | Ticker, peer group | Dashboard, flagged accounts, memo | P | Spot unusual relationships; commentary | Low |
| 6 | Substantive Analytics Builder | Trend/ratio/regression expectation with threshold at or below TM | Monthly upload plus public series | Expectation, difference, investigation log | B | Propose predictors; documentation | Medium |
| 7 | JE Population Analyzer (`JE`) | Completeness roll-forward, fraud filters, Benford, risk score, selection | JE export with user, date, account, amount | Selection list, explanations, workpaper | U | Map ERP columns; explain flags | High |
| 8 | Sampling Assistant | MUS/attribute size, selection, projection, evaluation | Population, TM, risk | Sample, projection, conclusion | U | Explain parameters; conclusion | Low |
| 9 | Walkthrough and RCM Drafter | Notes into narratives, WCGWs, controls, test attributes | Notes or transcript | Narrative, risk-control matrix | U | Structured extraction | Medium |
| 10 | Going Concern Assessor | Liquidity, maturities, covenants; AS 2415 checklist | Ticker, or TB and debt agreements | Indicators, memo | B | Extract covenants; draft | Medium |
| 11 | Estimate Challenger | Management assumptions vs peers' disclosed rates and ratios | Ticker, estimate type, inputs | Ranges, percentile | B | Extract footnote assumptions | Medium |
| 12 | Deficiency Evaluator | Classify deficiencies; draft AS 1305 and management letters | Deficiency descriptions | Classification, letter | U | Reason against indicators | Low |
| 13 | Public-Company Risk Profile (`RISK`) | Material weaknesses, restatements, auditor changes, CAMs, going concern | Ticker or screen | Timeline, text, peer comparison | P | Classify and summarize events | Medium |
| 14 | Rate Reconciliation Benchmarker | ETR bridges across peers in ASU 2023-09 categories | Peer set | Category table, drivers | P | Extract and normalize | Medium |
| 15 | Provision Workpaper Builder (`PROV`) | Current/deferred, rollforward, rate reconciliation, proof, interim AETR | TB, adjustments, rates | Workbook, disclosure draft | U | Suggest adjustments; draft footnote | High |
| 16 | Valuation Allowance Memo | Sources of income, cumulative loss test, peer VA releases | Deferred inventory, projections | Memo | B | Weigh evidence | Medium |
| 17 | UTP Tracker | Two-step test, interest and penalties, rollforward, open years | Position list | UTB rollforward, disclosure | U | Structure and draft | Medium |
| 18 | M&A Tax Structure Comparator | Stock vs asset vs 338(h)(10)/336(e)/F-reorg | Deal terms, basis, rates | Comparison, memo | U | Scenario narration | Medium |
| 19 | Transfer Pricing Benchmark | Comparable margin ranges from the comps engine; functional analysis | Tested party, peer set | Interquartile range, draft sections | B | Screen comparables; draft | Medium |
| 20 | Technical Memo Generator (`MEMO`) | Issue/facts/analysis/conclusion memos with ASC citations and precedents | Facts, contract excerpts, topic | Memo with citations | B | Drafting with retrieval | Medium |
| 21 | ASC 606 Contract Analyzer | Obligations, variable consideration, principal/agent, SSP, timing | Contract | Five-step memo, schedule, JEs | U | Contract reasoning | Medium |
| 22 | Lease Classifier and Schedule | Five criteria, IBR build checked against peers' rates, schedules | Lease terms, rates | Memo, amortization schedule | B | Explain judgments; peer rates | Low |
| 23 | PPA Workbench | RFR, MPEEM, with-and-without; allocation mix vs peers | Deal inputs, forecasts | Allocation table, memo | B | Extract peer allocations; narrate | High |
| 24 | Goodwill Impairment Tester (`GWI`) | Step-0 factors, DCF plus multiples, market cap reconciliation, tax equation | Reporting unit data, ticker | Workbook, memo | B | Draft assessment; sensitivity | Medium |
| 25 | Stock Comp Modeler | Option/RSU expense, attribution, forfeitures, peer volatility | Grant data | Expense schedule, tables | B | Assumptions rationale | Medium |
| 26 | CECL Allowance Estimator | Aging/loss-rate method with peer allowance ratios | Aging, history | Allowance, memo | B | Benchmark; draft policy | Medium |
| 27 | EPS Checker | Basic/diluted, treasury stock, two-class; tie to XBRL EPS | Share data | EPS schedule | B | Explain differences | Low |
| 28 | Disclosure Checklist Runner | Draft vs ASC/S-X/S-K requirements with peer examples | Draft statements | Missing items | B | Requirement matching | High |
| 29 | New Standard Impact Scanner | Early adopters' ASU 2024-03 tables; implementation plan | Peer set | Examples, mapping template | P | Extract tables; draft plan | Medium |
| 30 | IFRS-GAAP Difference Mapper | Differences relevant to a TB | TB or account list | Difference register | U | Map accounts to topics | Low |
| 31 | S-X Significance Tester | Investment, asset, income tests for Rules 3-05, 3-09, 4-08(g) | XBRL or uploads | Results, required statements | B | Explain results | Low |
| 32 | MD&A Flux Narrator (`FLUX`) | Variance commentary from XBRL quarters or uploaded TBs | Ticker or TB, thresholds | Commentary with drivers | B | Draft; consistency checks | Medium |
| 33 | XBRL Tagging QA | Tags vs peers; extension overuse | Ticker | Mismatch list | P | Suggest standard tags | Medium |
| 34 | QoE Databook Builder (`QOE`) | Monthly statements, EBITDA bridge, adjustment log | Monthly TBs, GL | Databook, report sections | U | Propose and classify adjustments | High |
| 35 | NWC Peg Analyzer (`NWC`) | Monthly NWC, TTM average, seasonality, peg sensitivity | Monthly balance sheets | Peg schedule, narrative | U | Explain choices | Medium |
| 36 | Net Debt Finder | Debt-like items from TB and notes | TB, notes | Net debt schedule | U | Identify candidates | Medium |
| 37 | Proof of Cash | Bank activity vs GL receipts and disbursements | Statements, GL | Reconciliation, exceptions | U | Parse; explain gaps | Medium |
| 38 | Public-Target Diligence Pack | Analytics, footnote risks, comment letters, controls, CAMs | Ticker | Pack with citations | P | Prioritize red flags | Low |
| 39 | Fraud Indicator Scan | Benford, duplicates, threshold splits, weekend postings, vendor-employee matches | JE/AP detail, masters | Findings with evidence | U | Explain patterns | High |
| 40 | Close Tracker (`CLOSE`) | Checklist, owners, rec status, aged reconciling items | Task list, TB | Status board | U | Draft explanations | Medium |
| 41 | Consolidation Checker | Intercompany matching, FX translation, CTA reasonableness | Entity TBs, rates | Exceptions | U | Explain mismatches | High |

### 7.1 Priority top-12 (build order)

1. **`DISC`** – pure public data, unique cross-company value for all six specialties; reuses saved peer groups and the filing cache.
2. **`CL`** – verified endpoint; nobody offers it cheaply.
3. **`XBRL`** – nearly free on the current pipeline; foundation for 11, 14, 22, 26, 33.
4. **`MAT`** – small, used on every engagement.
5. **Planning Analytics Pack** – extends the comps grid into audit-planning ratios.
6. **`RISK`** – material weaknesses, restatements, auditor changes and CAMs on one screen.
7. **`MEMO`** – the flagship copilot feature, fed by `DISC` precedents.
8. **`FLUX`** – public XBRL version first, upload later.
9. **Rate Reconciliation Benchmarker** – timely (first ASU 2023-09 10-Ks are on file).
10. **`JE`** – first upload feature; defines the column-mapping layer every later upload feature reuses.
11. **`QOE` with `NWC`** – highest willingness to pay.
12. **`GWI`** – reuses the comps engine and `XBRL` peer assumptions.

Items 1–9 need no upload, so they ship before upload standardization is solved. Items 10–12 need the upload and mapping layer, the single most important infrastructure investment for this persona: the market says client data access and format inconsistency are the main blockers.

---

## 8. Prompt library

1. "Show how CRWD, ZS and PANW describe ASC 606 revenue recognition for subscription and support, and highlight where the language differs."
2. "Which SEC comment letters in the last 18 months asked software companies about capitalized commissions under ASC 340-40, and how did they respond?"
3. "Compute planning materiality for NET at 5% of pretax income; if income is volatile, propose an alternative benchmark and draft the rationale."
4. "Compare goodwill as a percentage of total assets across my peer group at CY2025Q4 and flag anyone who recorded an impairment."
5. "Pull the weighted-average lease discount rate and remaining term disclosed by DDOG's peers and tell me if a 6.5% IBR is reasonable."
6. "Here is our JE export. Roll it forward to the change in trial balance, then list entries posted after period end by users outside accounting with round amounts."
7. "Run a first-two-digits Benford test on manual entries only and tell me whether there is a ridge just below $10,000."
8. "Design a monetary unit sample for receivables of $48 million with tolerable misstatement of $1.2 million and no expected misstatement."
9. "Draft an ASC 606 memo: three-year SaaS subscription with a one-time implementation fee, usage-based overages and a 10% renewal discount."
10. "Is this lease finance or operating? Seven-year term, ten-year asset life, $1.2 million a year, fair value $9 million, IBR 6%."
11. "Build the purchase price allocation for a $400 million acquisition with customer relationships (MPEEM), trade name (relief from royalty at 2%) and a non-compete (with-and-without); compare the mix to peers' recent deals."
12. "Perform the ASC 350 qualitative assessment for our Security reporting unit after a 30% share price decline since the last test."
13. "Explain our 31% effective tax rate against the 21% statutory rate using the eight ASU 2023-09 categories and compare to peers."
14. "Prepare a valuation allowance memo: three-year cumulative loss, $60 million of NOLs, projected profitability from 2027."
15. "Should we recognize a benefit for the R&D credit position under the two-step ASC 740 test? Draft the UTB rollforward line."
16. "Compare a stock sale with a 338(h)(10) election for an S-corp target at $50 million: buyer step-up value at 21% over 15 years versus the seller's incremental tax."
17. "Summarize how early adopters presented the ASU 2024-03 expense disaggregation table and propose our mapping from the trial balance."
18. "Run the S-X significance tests for acquiring a target with $80 million of assets and $12 million pretax income against our consolidated numbers."
19. "From these 24 monthly trial balances, build the EBITDA bridge and propose adjustments; flag any 'one-time' item that recurs in three years."
20. "Compute the trailing-twelve-month NWC peg on a cash-free/debt-free basis and show the sensitivity if deferred revenue is excluded."
21. "List debt-like items in this trial balance (accrued bonuses, deferred consideration, unpaid taxes, customer deposits) with amounts."
22. "Reconcile these bank statements to recorded revenue and disbursements for FY2025 and list unexplained differences over $25,000."
23. "Write flux commentary for accounts that moved more than 10% and $500,000 versus prior quarter, citing the journal entries behind each."
24. "Check intercompany balances across these five entity trial balances and explain the out-of-balance after translation at the period-end rate."
25. "What material weaknesses did mid-cap software companies disclose in FY2025 10-Ks, grouped by cause (ITGCs, revenue, close process)?"

---

## 9. Sources

Standards and regulators
- PCAOB AS 2105 Materiality: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2105
- PCAOB AS 2110 Risk Assessment: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2110 (amended, effective 12/15/2026: https://pcaobus.org/oversight/standards/auditing-standards/details/as-2110--identifying-and-assessing-risks-of-material-misstatement-(effective-on-12-15-2026))
- PCAOB AS 2201 Audit of ICFR: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201
- PCAOB AS 2301 Responses to Risks: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2301
- PCAOB AS 2305 Substantive Analytical Procedures: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2305 and project page https://pcaobus.org/oversight/standards/standard-setting-research-projects/substantive-analytical-procedures
- PCAOB AS 2310 Confirmation: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2310
- PCAOB AS 2315 Audit Sampling: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2315
- PCAOB AS 2401 Consideration of Fraud: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2401
- PCAOB AS 2415 Going Concern: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2415
- PCAOB AS 2501 Auditing Accounting Estimates: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2501
- PCAOB AS 2810 Evaluating Audit Results: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2810
- PCAOB AS 1305 Communications About Control Deficiencies: https://pcaobus.org/oversight/standards/auditing-standards/details/AS1305
- PCAOB Audit Focus: Journal Entries: https://pcaobus.org/resources/staff-publications/audit-focus/audit-focus-journal-entries
- Thomson Reuters, new PCAOB standards for 2026: https://tax.thomsonreuters.com/blog/what-to-know-about-the-new-pcaob-auditing-standards/
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- EDGAR full-text search endpoint (verified): https://efts.sec.gov/LATEST/search-index?q=%22material%20weakness%22&forms=UPLOAD
- XBRL frames example (verified): https://data.sec.gov/api/xbrl/frames/us-gaap/Goodwill/USD/CY2025Q4I.json
- XBRL company concept example (verified): https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Goodwill.json
- SEC Financial Statement Data Sets: https://www.sec.gov/dera/data/financial-statement-data-sets
- SEC Financial Statement and Notes Data Sets: https://www.sec.gov/dera/data/financial-statement-and-notes-data-set
- IRS Transfer Pricing: https://www.irs.gov/businesses/international-businesses/transfer-pricing

Calendars and filer status
- Mayer Brown, 2026 SEC filing deadlines and staleness dates: https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2025/12/2026-sec-filing-deadlines-and-financial-statement-staleness-dates.pdf?rev=-1
- Troutman, 2026 SEC filing deadlines: https://www.troutman.com/wp-content/uploads/2025/10/Troutman_SECfilingdeadlines_FinancialStaleness2026.pdf
- PwC Viewpoint SEC 3125, the accelerated filer system: https://viewpoint.pwc.com/dt/us/en/pwc/pwc_sec_volume/pwc_sec_volume_US/3000_registration_an_US/sec_3125_the_acceler_US.html
- Carta, business tax deadlines 2026: https://carta.com/learn/startups/tax-planning/business-tax-deadlines/
- Tavella Group, 2026 business tax extension deadlines: https://www.tavellagroup.com/insights/2026-business-tax-return-deadlines

Technical accounting and tax
- Thomson Reuters, ASC 740 overview: https://tax.thomsonreuters.com/en/glossary/asc-740
- CLA, ASC 740 and ASU 2023-09: https://www.claconnect.com/en/resources/blogs/manufacturing/asc-740-and-asu-2023-09-the-new-landscape-of-income-tax-accounting
- PwC Viewpoint 16.8, uncertain tax positions disclosure: https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/financial_statement_/financial_statement___18_US/chapter_16_income_ta_US/168_presentation_and_dis.html
- RSM, ASU 2024-03 disaggregated expense disclosures: https://rsmus.com/insights/financial-reporting/disaggregated-expense-disclosures-accounting-standards-update.html
- PwC Viewpoint, revenue recognition: https://viewpoint.pwc.com/us/en/revenue-recognition.html and principal vs agent: https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_10_principa_US/10_1_chapter_overview_US.html
- KPMG, lessee discount rates under ASC 842: https://kpmg.com/us/en/frv/reference-library/2021/lessee-discount-rates-under-asc-842.html
- FinQuery, interest rates for ASC 842: https://finquery.com/blog/interest-rates-asc-842-summary/
- Stout, eliminating Step II in goodwill impairment testing: https://www.stout.com/en/insights/article/eliminating-step-ii-streamlining-goodwill-impairment-testing
- PwC Viewpoint, ASU 2017-04 text: https://viewpoint.pwc.com/dt/us/en/fasb_financial_accou/asus_fulltext/2017/asu_201704simplifyin/asu_201704simplifyin_US/asu_201704simplifyin_US.html
- Sofer Advisors, intangible asset valuation methods: https://soferadvisors.com/insights/blog/intangible-asset-valuation-methods-for-measuring-hidden-value/
- Macabacus, Section 338 elections: https://macabacus.com/taxes/section338
- Bridge Law, 338(h)(10) vs 336(e): https://bridgelawllp.com/section-338h10-and-section-336e-elections-in-ma-transactions/
- Houseblend, US GAAP vs IFRS: https://www.houseblend.io/articles/us-gaap-vs-ifrs-standards-comparison and IFRS 9 vs ASC 326: https://www.houseblend.io/articles/ifrs-9-vs-asc-326-credit-loss-comparison
- Equity Methods, IFRS 2 vs ASC 718: https://www.equitymethods.com/white-papers/ifrs-2-and-asc-718-comparison/
- Deloitte DART, S-X significance tests: https://dart.deloitte.com/USDART/home/accounting/sec/sec-reporting-interpretations-manual/roadmap-equity-method-investees-sec-reporting/chapter-3-measuring-significance/3-1-significance-tests

Audit practice, forensic, FDD, controllership
- GAAP Dynamics, journal entry testing: https://www.gaapdynamics.com/auditing-fraud-risk-journal-entry-testing/
- Journal of Accountancy, Benford's Law and journal entries: https://www.journalofaccountancy.com/issues/2022/sep/using-benfords-law-reveal-journal-entry-irregularities/
- ACFE, Report to the Nations: https://www.acfe.com/fraud-resources/report-to-the-nations
- Papermark, financial due diligence in 2026: https://www.papermark.com/blog/financial-due-diligence
- Warren Averett, quality of earnings analysis: https://warrenaverett.com/insights/quality-of-earnings-analysis/
- Morgan & Westfield, quality of earnings in M&A: https://morganandwestfield.com/knowledge/quality-of-earnings-in-ma/
- FDD Interview Prep, FDD workstreams: https://www.fddinterviewprep.com/blog/fdd-workstreams
- TAS Foundations, financial due diligence: https://www.tas-foundations.com/financial-due-diligence
- CheckFlow, month-end close checklist: https://checkflow.io/blog/month-end-close-checklist
- Numeric, financial close software: https://www.numeric.io/blog/financial-close-software
- Coefficient, BlackLine vs FloQast: https://coefficient.io/month-end-close/blackline-vs-floqast

AI adoption and talent
- Journal of Accountancy, how AI is transforming the audit (Feb 2026): https://www.journalofaccountancy.com/issues/2026/feb/how-ai-is-transforming-the-audit-and-what-it-means-for-cpas/
- Journal of Information Systems, generative AI in the Big 4: https://publications.aaahq.org/jis/article/doi/10.2308/ISYS-2024-069/24020/Generative-Artificial-Intelligence-in-the-Big-4
- The CPA Journal (Aug 2026), internal vs external auditors adopting AI: https://www.cpajournal.com/2026/08/26/the-varied-perceptions-and-experiences-of-internal-versus-external-auditors-in-adopting-artificial-intelligence/
- Thomson Reuters, state of AI in audit 2026: https://tax.thomsonreuters.com/blog/state-of-ai-in-audit/
- Thomson Reuters, how accounting firms use AI: https://tax.thomsonreuters.com/blog/how-do-different-accounting-firms-use-ai-tri/
- Validis, the data layer AI needs: https://www.validis.com/newsletter/ai-ready-data-audit-engage-2026/
- Controllers Council, 2026 talent study: https://controllerscouncil.org/2026-corporate-finance-accounting-talent-research-study/
- CFO Dive, accounting talent shortage eases: https://www.cfodive.com/news/accounting-talent-shortage-shows-signs-easing-layoffs-ai/758799/

Vendors and job postings
- DataSnipper: https://www.datasnipper.com/
- MindBridge: https://www.mindbridge.ai/
- Caseware: https://www.caseware.com/
- BlackLine: https://www.blackline.com/
- FloQast: https://floqast.com/
- Workiva SEC reporting: https://www.workiva.com/solutions/sec-reporting and ERP Research review: https://www.erpresearch.com/erp-add-ons/esg-sustainability/workiva
- RKL, Audit Associate 2026: https://builtin.com/job/audit-associate-2026/6896549
- PwC, Financial Due Diligence Manager: https://simplify.jobs/p/726633f6-62ce-435b-89e9-677512799fbe/Financial-Due-Diligence-Manager
- BDO, Tax Manager ASC 740: https://www.theladders.com/job/tax-manager-core-tax-services-corporate-asc-740-bdousallp-salt-lake-city-ut_85251922
- Beech Valley, Technical Accounting Manager ASC 606/842: https://builtin.com/job/technical-accounting-manager-asc-606-asc-842/2225172
