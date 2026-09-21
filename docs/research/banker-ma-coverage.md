# Investment Banking M&A and Industry Coverage: Workflow, Data, Methods, and the YouBank Feature Map

Research memo for the YouBank product team. Date: 2026-09-20. Scope: sell-side and buy-side M&A advisory at elite boutiques (Moelis, Evercore, Centerview, PJT, Lazard) and bulge brackets, plus coverage specifics for Technology, Healthcare, Energy & Power, FIG, Industrials, Consumer/Retail, Real Estate/Gaming/Lodging, and TMT/Media. Sources are listed in section 10; numbers are cited to them where they come from a source, and flagged as practitioner convention where they do not.

**Market backdrop (why this persona matters now).** Global M&A reached about $2.8 trillion in H1 2026, up 48% year over year and the strongest first half on record, after $4.6 trillion in 2025 (Dealroom). Dealogic counted $1.38 trillion of Q1 2026 volume and a record $11.3 billion of M&A advisory revenue. Megadeals returned: Paramount Skydance/Warner Bros. Discovery ($114.1B transaction value, $7.0B termination fee), Union Pacific/Norfolk Southern ($89.5B), the Silver Lake-led Electronic Arts take-private ($56.8B), Devon/Coterra ($58B), Equity Residential/AvalonBay ($69B), McCormick/Unilever Foods ($44.8B), GIP-EQT/AES ($33.4B) and Boston Scientific/Penumbra ($14.5B). Shareholder activism hit a third consecutive record in 2025 (297 campaigns) and H1 2026 was the busiest six months ever (184 campaigns). Evercore alone ran 171 investment-banking Senior Managing Directors, earned 806 fees and booked $3.69B of advisory revenue in 2025 (up 31%), which works out to roughly $4.6M per fee-paying engagement.

---

## 1. Role overview: what M&A bankers actually do

### 1.1 Sell-side process, step by step

The sell-side mandate is the canonical banker workflow. Timelines below blend a private/sponsor-backed auction (Auxo's week-by-week schedule: 9-12 months from preparation to close) with public-company practice; a public target adds board process, proxy/tender mechanics and a fairness opinion.

| Step | What happens | Banker output | Typical timing |
|---|---|---|---|
| 0. Pitch / bake-off | 2-4 banks present positioning, valuation, buyer universe, process design and fee proposal to the board or sponsor | Pitch book: football field, "why now", buyer list, process options (broad auction 50-150+ buyers, targeted 10-30, negotiated 1-3) | 2-6 weeks |
| 1. Engagement | Engagement letter negotiated with counsel | Scope, retainer, success fee, minimum fee, separate fairness-opinion fee, 12-24 month tail, expenses, indemnity | 1-2 weeks |
| 2. Preparation | Diligence the client, normalize EBITDA (add-backs, QoE), build the model, populate the VDR | Teaser (1-2 pages, anonymized), CIM (40-80 pages), 5-year model with monthly NWC, tiered buyer list, NDA form (with standstill for public targets), data room index, Phase I process letter, working group list | 4-8 weeks (Auxo budgets 12 weeks for owner-readiness plus positioning) |
| 3. Launch and Phase I | Teaser to buyers, NDAs executed, CIM plus process letter distributed | NDA log, buyer contact log, first-round bid instructions | NDAs 1-2 weeks; IOIs due 2-5 weeks after CIM |
| 4. IOIs and shortlist | Bids normalized on EV, equity bridge, structure, financing and approvals | Bid comparison matrix; shortlist of 3-8 | 1-2 weeks |
| 5. Phase II | Management presentations (4-6 hours each), staged VDR access, site visits, expert sessions, Q&A log, draft SPA/merger agreement circulated with Phase II letter | Management presentation (60-100 pages), Q&A responses, final-bid package requirements: firm price, SPA mark-up, debt and equity commitment letters, board approvals, remaining diligence, timing | 4-8 weeks |
| 6. Final bids, LOI, signing | Compare on value, certainty and speed; private deals grant 30-60 days exclusivity; public deals go to board approval with a fairness opinion, then sign and announce | Board book, final bid summary, fairness opinion book, press release, 8-K | 1-3 weeks of negotiation |
| 7. Confirmatory diligence and SPA | QoE, legal, tax, commercial, technology, insurance diligence in parallel with SPA negotiation: reps and warranties, indemnity baskets and caps, escrow/holdback, R&W insurance, NWC peg, net debt and debt-like items, earnouts, rollover equity | Funds-flow and EV-to-proceeds bridge | 6-12 weeks |
| 8. Signing to closing | HSR waiting period (30 days), CFIUS/EU/SAMR where relevant, shareholder vote via DEFM14A (2-4 months) or tender offer (20 business days minimum), financing funded | Closing checklist, purchase-price adjustment statement | 1-6 months; 12-18 months for heavily regulated deals (NextEra/Dominion is pending on that timetable) |

**IOI contents** (per Auxo): valuation range and value bridge (EV, normalized EBITDA, cash/debt and debt-like items, NWC expectations); consideration and structure (cash at close, rollover, earnouts, seller notes, escrows); financing and approvals (debt/equity sources, lender involvement, investment committee status); remaining diligence and retrade exposure; management and ownership expectations; timing and exclusivity requests. **LOI** adds a firm price, the EV-to-equity bridge, NWC peg and seasonality, escrow terms, exclusivity length, closing conditions and the expected SPA structure. A LOI is "not final value": anything left open becomes harder to negotiate once exclusivity is granted.

### 1.2 Buy-side process

1. **Acquisition criteria**: sector, size, geography, financial profile, strategic fit, affordability (leverage headroom, EPS accretion tolerance).
2. **Screening**: long list (50-200 names from CapIQ/PitchBook screens, coverage knowledge) to short list (10-20) to 3-5 priority targets, each with a one-page profile, trading/precedent multiples and a strategic rationale (Sell Side Handbook's buy-side pitch example runs 5-50 names, tiered by synergy fit and multiple).
3. **Preliminary valuation and ability-to-pay**: comps, precedents, DCF with synergies, accretion/dilution for strategics, quick LBO for sponsors (hurdle IRRs of roughly 20-25% for buyout funds; infrastructure money may accept about 12%).
4. **Approach**: CEO-to-CEO call, private letter, "bear hug" or public unsolicited proposal; in hostile situations a tender offer (Schedule TO) or proxy fight.
5. **NDA, diligence, financing**: QoE, legal, commercial and technology diligence; bridge/commitment letters for debt, equity raise if needed.
6. **Bid tactics and negotiation**: IOI, LOI/final bid, merger agreement terms (termination fee, reverse termination fee, MAE definition, regulatory efforts covenant, go-shop), board approval, sometimes an acquirer-side fairness opinion (common when issuing more than 20% of shares).
7. **Announcement and integration**: press release and investor deck with synergies and accretion, 8-K, integration planning (30/60/100-day plan). Most buy-side mandates run 6-12 months.

### 1.3 Fee structures

- **Lehman scale**: the original 5-4-3-2-1 formula; modern middle-market variants use 5% on the first $10M, 4% on the next $10M, 3% on the next $10M, 2% on the next $20M and 1% above $50M (about $1.7M, or 1.7%, on a $100M sale). Double Lehman (10-8-6-4-2) and Modified Lehman (3-3-2-1-1) are also common; 41% of advisers in one 2026 survey still anchor on a Lehman variant.
- **Success fees by size**: under $25M, 4-6% with minimum fees around $150k; $25-100M, 3-5%; $100-500M, 1-2.5%; larger deals compress well below 1% and are usually negotiated as fixed dollar amounts. Merger proxies routinely disclose lead-adviser fees in the tens of millions on $10B-plus deals, the majority contingent on closing (practitioner observation from DEFM14A filings).
- **Retainers**: $10-50k per month for 3-6 months in the middle market (or a $25-75k engagement fee), normally credited against the success fee. Tails of 12-24 months cover buyers contacted during the engagement.
- **Buy-side**: lower percentages than sell-side, often with a portion payable at announcement and the balance at closing; hourly or fixed "advisory" fees for abandoned deals are rare at boutiques.
- **Fairness opinion fees**: hundreds of thousands to low single-digit millions, paid on delivery regardless of closing; the NBER example of a $15M success fee versus a $1M opinion fee illustrates the conflict critics cite. Houlihan Lokey leads the fairness-opinion league table.

### 1.4 Fairness opinions

A fairness opinion is a 2-4 page letter to the board (or special committee) stating that the consideration is fair "from a financial point of view" as of a date, supported by a 40-80 page book: transaction overview, trading comps, precedent transactions, premiums paid, DCF (with sensitivity tables), LBO/ability-to-pay, equity research price targets and 52-week trading range, plus a football field. The book is reviewed by the bank's fairness committee (senior bankers not on the deal), presented at the board meeting immediately before signing, and summarized in the DEFM14A/S-4 together with the fee and material relationships (FINRA Rule 5150 governs those disclosures). It is required in practice for nearly all public-company sales, take-privates and MBOs, and appears as an "inadequacy opinion" in hostile defenses. The work is compressed into the final days before announcement and demands hand-verified numbers because it is litigation evidence.

### 1.5 Activism defense and shareholder advisory

Lazard's 2025 review counted 297 campaigns (North America 173, up 28%); objectives were board change (37%), M&A (35%, versus a 29% five-year average; 50% in Europe) and capital allocation (31%). Industrials (24%) and technology (19%) were most targeted; H1 2026 added AI implementation as a headline demand. Evercore, Lazard's Capital Markets Advisory group and PJT Camberview are the reference practices. The standing product is a **vulnerability assessment**: TSR versus peers over 1/3/5 years, valuation discount on comps and SOTP, governance scorecard (classified board, rights plan, advance-notice bylaws, universal proxy exposure), shareholder-base analysis (13F holders, turnover, cost basis, likely voting), balance-sheet capacity for buybacks, and a "break-glass" response plan. When a Schedule 13D lands (now due within five business days of crossing 5%), the team drafts the response, models the activist's likely white paper (breakup, sale, buyback), runs a vote projection with the proxy solicitor, and negotiates a settlement (board seats, committee formation, strategic review) or runs the contest.

---

## 2. Day-to-day tasks by seniority

Deal teams at boutiques are thin: one MD, one VP or Director, one Associate, one or two Analysts, each staffed on 3-6 live matters. Time allocation for juniors is roughly 30-40% modeling and analysis, 30-40% presentations (pitch books, CIMs), 15-20% logistics, 10-15% meetings, at 70-100 hours per week.

| Level | Owns | Exact deliverables | Cadence |
|---|---|---|---|
| **Analyst** (years 1-3) | Numbers and pages | Trading comps (spread from filings/CapIQ, footnoted, calendarized); precedent transactions table; DCF, LBO and merger-model updates; sensitivity tables; football field; WACC page; buyer/target lists with tiering columns; Public Information Book (PIB); teaser and CIM first drafts; management presentation pages; data room index and uploads; due diligence tracker; NDA/process tracker; working group list; weekly market update; league-table pulls; sector newsletter data; board deck and fairness book pages with tie-outs | Comps refreshed on every earnings/8-K release (30 minutes per name once built, hours from scratch); market update every Monday; pitch turns nightly; fairness book over 3-7 days before signing |
| **Associate** (years 3-6) | Model logic and process mechanics | Checks every analyst output; owns the operating model and valuation narrative; drafts CIM sections and the management presentation storyline; runs the buyer log, NDA negotiations with counsel, bid comparison matrix; triages VDR Q&A; drafts process letters; joins buyer calls | Daily deal-team check-ins; weekly client process update |
| **VP** (years 6-9) | Deal quarterback | Translates MD/client asks into work plans; edits decks before they go up; negotiates process points with buyers' VPs and counsel (NDA, process letter, SPA business points); runs management-presentation logistics; drafts board-deck storyline; starts covering junior client contacts | Weekly client and board-committee updates; multiple decks per week |
| **Director/SVP** | Hybrid | Leads mid-cap executions end to end; pitches with the MD; sector coverage of a sub-vertical; the hardest promotion because it requires revenue origination | Monthly pipeline reviews |
| **MD** | Revenue and relationships | Origination (who should sell, buy, split or defend, and why now); CEO/CFO/board and sponsor relationships; negotiation strategy and structuring; fee negotiation; fairness committee; staffing; league-table positioning | 10-20 client touchpoints per week; quarterly pipeline and fee forecasts |

**Deliverable catalog (what each artifact contains)**

- **Trading comps**: peer tiers (core/adjacent), price, diluted shares (TSM), equity value, EV bridge, LTM/NTM revenue, EBITDA, EPS, growth, margins, multiples with min/25th/median/mean/75th/max, footnotes on normalization and calendarization.
- **Precedents**: announce/close date, acquirer, target, TV, EV, equity value, EV/Revenue, EV/EBITDA, premiums (1-day, 30-day/VWAP), consideration mix, structure, deal protection, synergies (section 4).
- **DCF, LBO, merger model, SOTP, WACC**: section 5.
- **Football field**: horizontal bars of implied share price or EV per method (52-week range, research targets, comps, precedents, DCF, LBO), with the offer price as a vertical line.
- **Buyer/target list**: name, type (strategic/sponsor), tier, rationale, prior deals, capacity (cash, leverage headroom, dry powder), contact and coverage MD, status.
- **Teaser**: 1-2 anonymized pages: investment highlights, financial snapshot, transaction, contact. **CIM**: executive summary and investment highlights, products/services, market, sales and marketing, management, financials and projections, risk factors, appendices; bankers spend "90% of the thinking time" on the executive summary and financial sections; no valuation guidance is included.
- **Management presentation**: 60-100 slides delivered by management with bankers in the room; **process letters**: Phase I (IOI format, date, information requested) and Phase II (final bid requirements, SPA mark-up, financing evidence, timetable).
- **Working group list (WGL)**: every party (company, bankers, counsel, accountants, VDR provider, lenders) with role, email, mobile. **Data room index**: numbered folder tree (1. Corporate, 2. Financial, 3. Tax, 4. Legal/Contracts, 5. HR, 6. IP/IT, 7. Commercial, 8. Operations, 9. Insurance, 10. Environmental/Regulatory) mirroring the request list one-for-one; a mid-market VDR holds 5,000-50,000 pages. **Due diligence tracker**: request #, category, requester, date, owner, status, response, document reference.
- **Board decks**: strategic alternatives (status quo vs sale vs spin vs recap vs merger of equals) with value, certainty and timing trade-offs; process updates with bid matrices; final board book with fairness analysis. **Pitch books**: credentials and tombstones, team bios, industry update, valuation and football field, buyer/target profiles (the most time-consuming section), recommendations; versions reaching "v44" are normal.
- **Weekly market update**: index and sector moves, multiple ranges by sub-sector, announced deals and premiums, ECM/DCM windows, upcoming catalysts. **League tables**: Dealogic/LSEG rankings by value, count and fees, with credit rules for co-advisers. **Sector newsletter**: monthly or quarterly deal round-up and valuation dashboard for clients.

---

## 3. Sector-specific coverage: metrics, data, deal types, analyses

### 3.1 Technology (software, internet, semiconductors)

- **Metrics and multiples.** Software: ARR and net new ARR, NRR/GRR, Rule of 40 (growth + margin), gross margin, CAC payback, magic number, billings, RPO/cRPO, EV/NTM revenue (the headline multiple), EV/NTM FCF, EV/ARR for private targets. Public software is cheap by history: median EV/NTM revenue fell to 3.6x in February 2026, a 10-year low per Clouded Judgement, and reportedly touched 3.2x at the June low and multiples.vc's September 2026 medians are 2.1x horizontal, 2.2x vertical and 2.9x infrastructure SaaS (EV/NTM EBITDA 9.7-12.1x, median Rule of 40 around 30) with DevOps at 8.4x and data infrastructure at 5.5x; McKinsey's cut shows NRR above 120% commanding 21x versus 9x. Internet: MAU/DAU, ARPU, GMV and take rate, EV/GMV. Semiconductors: gross margin by model (fabless 50-70%, foundry 40-50%, memory 30-45% at peak), R&D intensity, capex intensity (20-30% for foundries/memory, under 5% fabless), inventory days, book-to-bill, design-win pipeline (3-24 months to volume); P/E of 20-35x fabless, 15-25x foundry, 8-15x memory through-cycle, 25-50x equipment; valuation on normalized 3-5 year cycle margins.
- **Data sources.** 10-K/10-Q KPI disclosures and earnings decks, Gartner/IDC, PitchBook for private ARR and rounds, Clouded Judgement / Meritech / Bessemer indices, SIA/WSTS and SEMI for semis, company design-win commentary.
- **Deal types.** Sponsor take-privates (EA $56.8B; Synopsys/ANSYS $33.5B and Cisco/Splunk $31.0B as strategic precedents), sponsor-to-sponsor secondaries, carve-outs, AI-driven consolidation, growth-equity recaps; semis: fabless consolidation, IP licensing, government-reviewed (CFIUS) cross-border deals.
- **Analyses.** ARR bridge and cohort/NRR waterfall, Rule-of-40 versus EV/NTM revenue regression ("growth-adjusted multiple"), take-private LBO with recurring-revenue loans, strategic accretion with cost synergies as % of target opex, cycle-normalized semis comps, design-win pipeline value.

### 3.2 Healthcare (biotech, pharma, medtech, services)

- **Metrics and multiples.** Biotech: rNPV per asset (cash flows times cumulative probability of success, discounted at 8-10% for large pharma, 10-15% mid-cap, 15-20% early-stage); phase transition probabilities of roughly 40-50% preclinical to Phase 1, 50-65% P1 to P2, 25-35% P2 to P3, 50-60% P3 to filing, 85-90% filing to approval; cumulative 7-12% overall (oncology 5-8%, rare disease 15-25%); peak sales, launch curve, loss-of-exclusivity date. Pharma: EV/EBITDA, P/E, pipeline-adjusted SOTP, LOE exposure (a $170-300B revenue cliff through 2032). Medtech: EV/Revenue 3-6x and EV/EBITDA 10-20x (pure-play growth names like Edwards at 20-25x), FDA class and reimbursement status. Services: EV/EBITDA (median about 11.5x in 2025 versus 14.5x in 2024), payer mix (commercial reimburses 2-4x Medicare/Medicaid and drives 40-60% multiple premiums), same-facility admissions, revenue per bed, ALOS, net revenue per adjusted admission; physician practices 5-7x under $1M EBITDA to 11x-plus above $5M, with owned ASCs/imaging adding 1-3 turns.
- **Data sources.** ClinicalTrials.gov, FDA Orange/Purple Books and calendars (PDUFA dates), Evaluate Pharma, Citeline, IQVIA, CMS cost reports, Definitive Healthcare, company R&D day decks.
- **Deal types.** 2026 to date: Boston Scientific/Penumbra $14.5B, Sun Pharma/Organon $11.75B, AbbVie/Apogee $10.9B, GSK/Nuvalent $10.6B, Danaher/Masimo $9.9B, Gilead/Arcellx $7.8B, Lilly/Kelonia $7B ($3.25B upfront plus milestones), Merck/Terns $6.7B, Biogen/Apellis $5.6B. Structures: CVRs and milestone-based consideration, licensing (upfront, milestones, royalties), royalty monetization, PE physician-practice roll-ups.
- **Analyses.** rNPV by asset rolled into SOTP, CVR probability-weighted value, licensing-deal comps (upfront as % of total, royalty tiers), LOE bridge with generic erosion, payer-mix-adjusted QoE, de novo versus acquired ASC economics.

### 3.3 Energy & Power (upstream, midstream, oilfield services, renewables, utilities)

- **Metrics and multiples.** Upstream: EV/EBITDAX (3-7x), EV/flowing boe/d ($30-100k), EV/proved reserves ($8-25 per boe), $/acre ($5-60k-plus in core Permian), PV-10 and standardized measure at SEC pricing, NAV (type curves, decline, F&D, LOE, netbacks, hedges, no terminal value), P/NAV, EV/DACF, R/P and reserve replacement. Midstream: EV/EBITDA, P/DCF, distribution coverage, contract mix (take-or-pay and MVCs on 5-20 year terms). OFS: rig count, dayrates, utilization, EV/EBITDA from 3.8x (drilling) to 12.8x (storage) with an asset-value floor. Renewables: contracted DCF on PPA price and tenor plus merchant tail, CAFD, cash-on-cash yield 7-10%, EV/MW as a screen only (capacity factor about 15% for solar). Utilities: forward P/E 16-22x, EV/rate base 1.2-1.8x, allowed ROE (9.35-10.2% in H1 2025 decisions), rate-base growth, DDM.
- **Data sources.** Enverus, Rystad, Wood Mackenzie, EIA, Baker Hughes rig count, third-party reserve reports (NSAI, Ryder Scott), 10-K supplemental oil and gas disclosures, FERC filings, S&P Global Commodity Insights and Regulatory Research Associates for rate cases, SNL for utilities.
- **Deal types.** Corporate shale consolidation (Exxon/Pioneer $65.6B in 2023; Devon/Coterra $58B in 2026), A&D of acreage packages, JV/DrillCo and royalty deals, MLP simplifications and dropdowns, RBL financings, utility take-privates and mergers (GIP-EQT/AES $33.4B; NextEra/Dominion pending), renewable platform and yieldco transactions.
- **Analyses.** NAV by asset and reserve category, strip versus flat price decks, acreage overlap and inventory-life maps, accretion on CFPS and FCF per share, breakeven WTI, EV/rate-base premium, contracted versus merchant cash-flow split, PPA re-contracting risk.

### 3.4 FIG (banks, insurance, asset managers, fintech)

- **Metrics and multiples.** Banks: P/TBV and P/E (no EV, because funding is the business), ROTCE versus 9-12% cost of equity, NIM, efficiency ratio, deposit beta, CET1 and leverage ratios, NPLs and reserves, AOCI marks; intrinsic value via three-stage DDM or excess-capital model (terminal value 60-80% of the total). Bank M&A: TBV dilution and earnback (a sub-3-year crossover is the market norm), cost saves as % of target expense base, core deposit intangible, loan and AOCI marks, pro forma CET1. Insurance: P/BV, P/E, combined ratio, reserve development, float; life insurers on P/EV (ANAV plus value in-force). Asset managers: % of AUM (0.5-1.5% passive to 5-15% alternatives), EV/EBITDA 7-10x traditional and 15-25x alternatives, fee-related earnings, net flows, fee rate; brokers 16-18x EV/EBITDA. Fintech: EV/Revenue (about 4.5x versus 1.8x for banks), TPV and take rate, Rule of 40.
- **Data sources.** S&P Global Market Intelligence (SNL), FDIC call reports, FR Y-9C, NAIC statutory filings, A.M. Best, Morningstar/ISS flows, company AUM releases.
- **Deal types.** Bank mergers and MOEs (regulatory approval from Fed/OCC/FDIC dominates timing), insurance block reinsurance and Bermuda platforms, wealth and asset-manager consolidation (Nuveen/Schroders $13.5B in 2026), fintech take-privates.
- **Analyses.** Pro forma capital and TBV earnback, EPS accretion, DDM, deposit-franchise and CRE-exposure analysis, contribution analysis for MOEs, embedded-value roll-forward, FRE-based SOTP for alternatives managers.

### 3.5 Industrials

- **Metrics and multiples.** Organic growth split into price, volume and mix; incremental and decremental margins (about 30% on the upswing, with EBITDA down 40-50% peak to trough for capital goods); backlog and book-to-bill (General Dynamics reported a $112.5B defense backlog at 1.4x and a 1.5x aerospace book-to-bill in Q2 2026); aftermarket mix; maintenance versus growth capex; mid-cycle EBITDA (5-7 year average, normalized margin on current revenue, or capacity-utilization regression); EV/EBITDA, EV/EBITA or EV/EBIT for capital-intensive names; transportation 5-9x EBITDA; airlines on ASM, load factor, yield and fuel per ASM.
- **Data sources.** ISM PMI, industrial production, Caterpillar retail statistics, Cass freight index, Dodge construction data, defense budget documents, company backlog disclosures.
- **Deal types.** Conglomerate breakups (GE, Honeywell three-way split), carve-outs to sponsors, PE platform roll-ups with bolt-ons, rail mega-merger (Union Pacific/Norfolk Southern $89.5B), dividend recaps.
- **Analyses.** Cycle-normalized comps, SOTP/breakup versus conglomerate discount, synergy build (procurement, footprint, SG&A), carve-out standalone cost and TSA build, accretion with purchase-accounting step-ups.

### 3.6 Consumer / Retail

- **Metrics and multiples.** Same-store sales (comps), sales per square foot, four-wall EBITDA and margin, new-unit ROI and payback, whitespace, EBITDAR and lease-adjusted leverage, gross margin, inventory turns and cash conversion cycle, household penetration, price/volume/mix, DTC share; EV/EBITDA ranges from 20-25x for premium beverage brands to 4-6x for struggling department stores; about 84% of consumer M&A value sits in discretionary.
- **Data sources.** NIQ/Nielsen and Circana scanner data, Placer.ai foot traffic, Bloomberg Second Measure and Similarweb, Euromonitor, monthly comps releases.
- **Deal types.** Brand carve-outs and portfolio reshaping (McCormick/Unilever Foods $44.8B; Mars/Kellanova $36.1B; Kimberly-Clark/Kenvue $49.7B), sponsor LBOs and retail take-privates (Sycamore/Walgreens $43.7B), refranchising, restructurings of offline retailers.
- **Analyses.** Unit-economics model and store-count runway, brand SOTP, lease-adjusted comps, LBO with sale-leaseback, private-label and channel-mix bridges.

### 3.7 Real Estate, Gaming, Lodging

- **Metrics and multiples.** REITs: NAV (forward NOI capitalized at market cap rates less net debt; premium/discount to NAV), implied cap rate, FFO and AFFO with P/FFO and P/AFFO, same-store NOI, occupancy, leasing spreads, net debt/EBITDAre, dividend yield and 75-90% payout requirements. Lodging: RevPAR (ADR times occupancy), EBITDA per key, EV per key, 8-14x EBITDA depending on flag and market. Gaming: EBITDAR, rent coverage of 1.7-2.0x in OpCo/PropCo structures, GGR, slot and table counts, net debt/EBITDAR (above 4-5x is a warning). Homebuilders: P/BV, orders, absorption, lots owned versus optioned, backlog.
- **Data sources.** Green Street (NAV estimates, cap-rate series, CPPI, sales and rent comps), CoStar, MSCI/RCA, STR for RevPAR, Nareit T-Tracker, state gaming commissions.
- **Deal types.** REIT M&A (Equity Residential/AvalonBay $69B), take-privates by large managers, OpCo/PropCo separations and sale-leasebacks with gaming REITs, portfolio sales, hotel brand and management-contract deals.
- **Analyses.** NAV model with cap-rate sensitivity, FFO accretion, OpCo/PropCo separation math (EBITDAR divided by a coverage target sets the rent), rent-coverage stress tests, RevPAR-driven hotel models.

### 3.8 TMT / Media and Telecom

- **Metrics and multiples.** Telecom: EV/EBITDA (US wireless 7-10x; Europe 5-7x), EV/subscriber ($200-600 wireless, $300-800 fixed broadband), ARPU ($55-60 postpaid, $25-30 prepaid, $70-100 fiber), churn, capex intensity, spectrum $/MHz-pop, fiber $/passing and penetration; towers on AFFO at 20-25x. Media: subscribers and net adds, ARPU, content spend, affiliate fees, advertising CPM; streaming on EV/subscriber and EV/Revenue, studios on EV/EBITDA with library premiums, conglomerates on SOTP.
- **Data sources.** Company KPI decks, Nielsen and Comscore, S&P Kagan, Ampere, FCC spectrum auction data, MoffettNathanson.
- **Deal types.** Paramount Skydance/WBD ($114.1B; $7.0B termination fee, 6.1% of value), tower and fiber infrastructure sales, cable consolidation, studio and library sales, sports-rights-driven partnerships.
- **Analyses.** Subscriber LTV and churn cohorts, SOTP breakup of conglomerates, spectrum and fiber-build economics, synergy models for scale mergers, leverage capacity given EBITDA stability (telecom EBITDA rarely falls more than 5-10% in recessions).

---

## 4. Data and documents bankers use

### 4.1 SEC filings and deal documents

| Document | Filed by / when | What bankers pull from it |
|---|---|---|
| 10-K / 10-Q | Issuer, annual/quarterly | Financial statements and notes for spreading, segment data, share counts (cover page), options and RSUs for TSM, debt schedules, leases, pensions, KPIs (ARR, backlog, RevPAR, reserves) |
| 8-K | Within 4 business days of an event | Deal announcement press release (price, consideration, synergies, accretion), merger agreement as exhibit, investor deck, earnings releases |
| DEF 14A | Annual proxy | Ownership, compensation, board structure, anti-takeover provisions |
| PREM14A / DEFM14A | Target, weeks after announcement | Background of the merger (the process narrative: who was contacted, when, at what price), fairness opinion summaries and fees, management projections, deal protection terms, treatment of equity awards, golden parachutes |
| S-4 | Acquirer, when stock is issued | Same content as the merger proxy in a joint proxy/prospectus, plus pro forma financials |
| SC TO-T / SC 14D-9 | Bidder / target board within 10 business days | Tender offer terms; board recommendation and fairness opinion (critical in hostile bids) |
| SC 13D / 13G, 13F | Holders above 5% / institutions quarterly | Activist stakes and intentions (13D within five business days), shareholder base |
| Earnings transcripts, investor days | Issuer | Guidance, KPI definitions, M&A appetite, capital allocation |

Rule of thumb from the deal-documents guide: the most recent filing wins when documents disagree.

### 4.2 Data platforms

Capital IQ and FactSet are the modeling and comps layer (FactSet's Excel and PowerPoint plugins automate spreading and pitch pages); Bloomberg for market data and one desk seat; PitchBook for private companies, sponsors, dry powder and buyer lists; Mergermarket and Dealogic for proprietary deal intelligence and league tables (Dealogic runs $30-60k per M&A seat); LSEG Deals Intelligence for league tables; sector sets in section 3. Typical mid-tier stack: FactSet or CapIQ plus Mergermarket or Dealogic plus one Bloomberg.

### 4.3 Precedent transaction fields that matter

Announce date; close date (or withdrawn); target and acquirer with type (strategic/sponsor) and domicile; % sought; offer price per share; diluted shares at the offer price (TSM on options/warrants/converts); equity value; net debt and other EV items (preferred, NCI, leases, pensions, earnouts/CVRs); transaction value and EV (the Houlihan Lokey study uses both definitions); LTM and NTM revenue and EBITDA; EV/Revenue, EV/EBITDA, P/E; premiums to 1-day, 1-week, 30-day and 52-week-high unaffected prices and to 30/60-day VWAP; consideration mix (cash, stock, mixed; 40.6% of 2025 US public deals included stock); exchange ratio type (fixed, floating, collar); structure (one-step merger, tender offer, LBO, tender plus squeeze-out); process (auction versus negotiated, hostile versus friendly, go-shop); deal protection (termination fee, reverse termination fee, no-shop, matching rights); regulatory conditions and outside date; announced synergies (run-rate, timing, cost to achieve); financing sources; advisers. 2025 benchmarks (160 US public targets above $50M): termination fee median 2.7% of transaction value and 2.8% of EV, range 0.1-10.1%, about 48% of fees between 2.0% and 3.5%; median fee $41.4M; all-stock deals 3.0%, all-cash 2.6%; go-shops appear in roughly 8.5% of deals with 30-60 day windows and fees often halved during the window.

---

## 5. Core methodology detail

**Trading comps.** (1) Pick 5-15 peers by business model, size and growth, tiered core/adjacent. (2) Diluted shares: basic shares from the latest cover page plus in-the-money options and warrants via the treasury stock method (proceeds repurchase shares at the current price), plus RSUs/PSUs, plus if-converted shares for in-the-money converts. (3) EV bridge: equity value + debt + preferred + non-controlling interest + operating leases where the peer set capitalizes them + underfunded pensions - cash and short-term investments (- non-core equity investments). (4) LTM = latest fiscal year + current YTD - prior YTD; NTM from consensus (FactSet/Bloomberg/CapIQ). (5) Calendarize non-December year-ends to December (weight the two fiscal years by months; footnote it). (6) Normalize EBITDA: remove restructuring, impairments, litigation, gains on sale, FX, one-time COVID/tariff items; decide on stock-based compensation consistently; adjust for acquisitions (pro forma LTM). (7) Compute EV/Revenue, EV/EBITDA, EV/EBIT, P/E, EV/FCF and sector metrics; show min, 25th, median, mean, 75th, max; NM if the denominator is negative or the multiple is outside a plausible band. (8) Refresh on every earnings release; associates re-spread from scratch to check.

**Precedent transactions.** Screen 5-20 deals in the last 3-5 years by sector, size and structure. Purchase equity value = offer price times diluted shares at the offer price (TSM at the offer price, not the market price); EV adds net debt and other claims. Premium = offer price / unaffected price - 1, measured at 1-day, 1-week, 30-day (or VWAP) and 52-week high; typical control premiums 25-50%-plus. Note buyer type (strategics pay for synergies), consideration (stock deals price lower), process competitiveness, cycle timing and credit conditions. Synergies: capitalize announced run-rate synergies at the acquirer's multiple to show "value of synergies" versus premium paid. Output: multiples table with statistics, implied valuation range, premiums-paid summary.

**DCF.** UFCF = EBIT x (1 - t) + D&A - capex - change in NWC (- stock comp if treated as cash). Project 5-10 years; discount with the mid-year convention (raises PV by roughly 6-7% at typical WACCs; use end-of-period for highly seasonal cash flows or when the transaction closes mid-year). Terminal value by perpetuity growth (FCF x (1+g) / (WACC - g), g of 2-3% nominal) and by exit multiple (LTM EBITDA x multiple), cross-checking the implied growth and implied multiple of each; terminal value is typically 60-80% of EV. WACC = E/V x Ke + D/V x Kd x (1 - t); Ke via CAPM (risk-free from 10-20 year Treasuries, unlevered peer betas re-levered at the target structure, equity risk premium 5-6%) plus a size premium of roughly 100-400 bps from CRSP/Kroll deciles for small caps and any company-specific premium; Kd from current yields on the company's debt or comparable ratings. Show sensitivity grids on WACC versus g and WACC versus exit multiple.

**LBO.** Sources and uses: purchase equity value plus refinanced debt, fees (financing fees about 2% of debt, amortized) and minimum cash, funded by tranches and sponsor equity. 2026 middle-market structure: total leverage 4.0-5.0x EBITDA (5.0-6.0x for upper-mid-market quality credits), unitranche at SOFR + 475-550 bps (about 9% all-in), plus revolver, term loan A/B, second lien or mezzanine, seller notes, rollover equity, sponsor equity of 40-60%. Build a debt schedule with mandatory amortization, cash sweep, PIK toggles, covenants (net leverage, interest coverage). Exit in years 3-7 at an assumed multiple; equity proceeds = exit EV - net debt - management promote. Returns: IRR and MOIC; sponsors target 20-25% IRR minimum. Attribution: EBITDA growth = (exit EBITDA - entry EBITDA) x entry multiple; multiple expansion = (exit multiple - entry multiple) x exit EBITDA; deleveraging = entry net debt - exit net debt; WSP's example splits a 3.27x MoM / 26.8% IRR into 27.6% EBITDA growth, 25.5% multiple expansion, 57.0% debt paydown, less 10.1% fees. Ability-to-pay: solve for the maximum entry price at the hurdle IRR.

**Merger model.** Offer price = target price x (1 + premium); offer value = price x diluted target shares. Sources and uses: cash (from balance sheet and new debt at an assumed rate), stock (offer value x stock % / acquirer price = new shares). Purchase price allocation: excess of purchase price over target net identifiable assets is split into PP&E write-ups, identifiable intangibles (customer relationships, technology, brand) amortized over useful lives, and residual goodwill (not amortized under US GAAP); deferred tax liability = write-ups x tax rate; transaction fees (about 2.5% of offer value) expensed, financing fees capitalized. Pro forma net income = acquirer + target + pre-tax synergies (net of integration costs) - new interest - foregone interest on cash - incremental D&A, taxed; pro forma EPS over pro forma diluted shares; accretion/dilution = pro forma EPS / standalone EPS - 1, shown for years 1-3, with and without synergies, and against pre-tax synergies needed to break even. Rule of thumb: all-stock deals are accretive when the acquirer's P/E exceeds the target's; cash deals when the target's after-tax earnings yield exceeds the after-tax cost of debt. Contribution analysis: each company's share of revenue, EBITDA, net income and equity value versus pro forma ownership. Exchange ratio analysis: fixed ratio (seller bears acquirer price risk; 1.25x in BIWS's example), floating ratio (fixed dollar value, buyer bears dilution), collars with floors and caps (BIWS example: fixed 1.25x between $15 and $25, floor guaranteeing $93.8M, cap at $156.3M), walk-away rights; present implied premium and ownership across a grid of acquirer prices and historical exchange-ratio charts for MOEs. Bank deals add TBV dilution and earnback.

**Sum-of-the-parts.** Value each segment on its own peer multiples (or DCF/NAV/rNPV), subtract corporate costs capitalized at a blended multiple, subtract net debt, pensions and NCI, add non-operating assets; compare to the market price to quantify the conglomerate discount (typically 10-15%; activists pitch 30-50% breakup upside). Adjust for dis-synergies, stranded costs, tax leakage and separation costs when used for spin or breakup analysis.

---

## 6. Pain points and what AI plus data can automate (honestly)

**Where the hours go.** Hand-spreading a comp takes 20-30 minutes once a template exists and hours from scratch; every earnings night triggers re-spreads. Analysts report 20 of 40 contracted hours on manual PowerPoint work; 30-40% of the week is deck formatting, "v44" revisions and copying numbers between Excel and PowerPoint. Precedents for private targets rely on press releases and guesswork. Fairness books are re-tied by hand under deadline. Process management lives in email and spreadsheets: NDA status, buyer questions, VDR permissions. MD preparation is thin because insight sits in analysts' heads and CRM notes.

**What is already being automated.** Rogo (a $2B valuation after its April 2026 round, more than 35,000 users and 250 clients including Lazard, JPMorgan, Moelis, Bank of America and GIC) and Hebbia generate company profiles, comp universes, first-draft CIM sections and market slides, data-room triage and buyer/target lists; FactSet Pitch Creator automates pitch pages; banks report 20-plus hours saved per deal cycle and brief production falling from nine hours to about 30 minutes. Practitioner consensus: research assembly, screening, drafting, summarizing filings and transcripts, extracting KPIs, tie-outs and formatting are high-yield; peer selection, normalization judgment, assumptions, negotiation and the numbers a banker signs are not.

**Automatable with YouBank's data core plus AI (high confidence).** Spreading and calendarizing comps from XBRL with footnotes; LTM/NTM roll-forwards on earnings day; extracting precedent fields from 8-Ks, merger proxies and S-4s (offer price, consideration, termination fees, synergies, background-of-merger timeline); premiums paid from price history; PIBs; buyer and target long lists with rationale; teaser and CIM first drafts from structured KPIs; data-room indexing and Q&A deduplication; DD and process trackers; WGLs; weekly market updates and sector newsletters; earnings digests with KPI extraction; model linting (hard-codes, broken links, sign errors, balance checks); Excel and PowerPoint export.

**Limits to state plainly.** Consensus NTM estimates, private-company financials and real-time deal data are licensed (FactSet/CapIQ/PitchBook/Mergermarket); EDGAR covers US registrants only and extension-heavy filers have sparse standardized facts. LLM extraction needs citations and confidence flags because "a confident wrong answer is the real hazard". Peer choice, normalization calls, synergy and WACC assumptions and anything that goes in a fairness book need a human owner. Client-confidential CIM and VDR content must never train shared models. Bank IT will require SOC 2, SSO, data residency and MNPI walls before any live-deal use.

---

## 7. Glossary (key terms)

1. **Accretion/dilution**: change in pro forma EPS versus standalone. 2. **ARR / NRR / GRR**: annual recurring revenue; net and gross revenue retention. 3. **Bake-off**: competitive pitch for a mandate. 4. **Bear hug**: unsolicited offer letter designed to force a board response. 5. **Book-to-bill**: orders divided by revenue. 6. **Break-up (termination) fee**: paid by target if it accepts a superior offer; median 2.7% of value in 2025. 7. **CAFD / DCF (midstream)**: cash available for distribution; distributable cash flow. 8. **Cap rate**: NOI divided by property value. 9. **CET1**: common equity tier 1 capital ratio. 10. **CIM**: confidential information memorandum. 11. **Collar**: exchange-ratio band with floor and cap. 12. **Combined ratio**: (losses + expenses) / earned premiums. 13. **Contribution analysis**: each party's share of metrics versus pro forma ownership. 14. **CVR**: contingent value right tied to milestones. 15. **DACF**: debt-adjusted cash flow (E&P). 16. **EBITDAX / EBITDAR**: EBITDA before exploration expense / before rent. 17. **Embedded value**: ANAV plus value of in-force (life insurers). 18. **EV bridge**: equity value to enterprise value reconciliation. 19. **Exchange ratio**: acquirer shares per target share. 20. **Fairness opinion**: bank's letter on financial fairness to the board. 21. **FFO / AFFO**: REIT cash-earnings measures. 22. **Football field**: valuation range summary chart. 23. **Four-wall EBITDA**: unit-level profit excluding corporate overhead. 24. **Go-shop**: post-signing window (30-60 days) to solicit superior bids. 25. **HSR**: Hart-Scott-Rodino antitrust filing with a 30-day waiting period. 26. **IOI / LOI**: non-binding indication of interest / letter of intent with exclusivity. 27. **IRR / MOIC**: sponsor return measures. 28. **Lehman formula**: tiered percentage success fee. 29. **LTM / NTM**: last / next twelve months. 30. **MAE / MAC**: material adverse effect condition. 31. **Management presentation**: Phase II management meeting deck. 32. **Mid-cycle EBITDA**: normalized earnings across a cycle. 33. **MOE**: merger of equals. 34. **NAV**: net asset value (REITs, E&P, asset managers). 35. **NWC peg**: target working capital at close for price adjustment. 36. **P/TBV, ROTCE**: price to tangible book; return on tangible common equity. 37. **PIB**: public information book. 38. **Process letter**: bid instructions for each round. 39. **PV-10**: present value of proved reserves at 10%. 40. **QoE**: quality of earnings report. 41. **rNPV / PoS**: risk-adjusted NPV; probability of success. 42. **Reverse termination fee**: paid by buyer on financing or regulatory failure (often 5-7% of equity value). 43. **RevPAR**: ADR times occupancy. 44. **Rule of 40**: growth plus margin. 45. **SOTP**: sum-of-the-parts. 46. **Standstill**: NDA clause barring unsolicited offers. 47. **Tail**: post-termination fee protection period. 48. **TSM**: treasury stock method. 49. **VDR**: virtual data room. 50. **WGL**: working group list.

---

## 8. Feature proposals for YouBank

Context: YouBank already has an EDGAR/XBRL data core, FMP prices, a comps grid with AI peer proposal, saved peer groups, footnotes and chat with citations, plus a venture workspace. The proposals below extend that into the full M&A workflow. Difficulty: L (weeks), M (1-2 months), H (quarter-plus or needs licensed data).

### Top-12 priority

1. **Precedent Transaction Extractor** (#4) — turns EDGAR deal filings into a real precedents database; the single biggest data gap today.
2. **Earnings-Day Comps Refresh** (#2) — auto re-spread and diff on every 10-Q/10-K/8-K.
3. **Calendarization and Normalization Engine** (#1) — known gap; required for credible comps.
4. **Public Information Book Generator** (#12) — fully automatable, high daily use.
5. **Buyer/Target List Builder** (#10) — every pitch needs one.
6. **Football Field and Valuation Summary** (#6) — the page every deck ends on.
7. **Merger Proxy Miner** (#5) — background-of-merger timelines, fairness ranges, fees, projections.
8. **Excel/PowerPoint Export with Live Footnotes** (#30) — bankers live in Office.
9. **Weekly Market Update Generator** (#20) — recurring, templated, data-driven.
10. **Sector KPI Extractor** (#24) — ARR/NRR, backlog, RevPAR, reserves, CET1 from filing text.
11. **Accretion/Dilution and Contribution Workbench** (#8) — the strategic buyer's first question.
12. **Model Linter** (#29) — catches errors before an MD does.

### Full list

| # | Feature | One-line description | Inputs | Outputs | Data source | AI use | Diff. |
|---|---|---|---|---|---|---|---|
| 1 | Calendarization and normalization engine | Standardize fiscal years to December and strip one-time items with footnotes | XBRL facts, filing text | Calendarized LTM/NTM, adjusted EBITDA, footnotes | EDGAR XBRL, filing notes | Reads notes to classify non-recurring items; drafts footnotes | M |
| 2 | Earnings-day comps refresh | Re-spread affected peers when a filing hits and show a diff | Filing feed, saved sheets | Updated grid, change log, alert | EDGAR submissions, FMP | Explains deltas in plain English | M |
| 3 | Diluted share calculator | TSM on options/RSUs/converts from the equity note | 10-K equity footnote, price | Diluted shares, waterfall | EDGAR text | Extracts strike/quantity tables | M |
| 4 | Precedent transaction extractor | Build the precedents table from 8-K, DEFM14A, S-4, SC TO-T | Filing text | Deal record with all section 4.3 fields, citations | EDGAR | LLM extraction with confidence and quote | H |
| 5 | Merger proxy miner | Summarize background of the merger, fairness methods and ranges, adviser fees, projections | DEFM14A/S-4 | Timeline, methodology table, fee table | EDGAR | Structured summarization | M |
| 6 | Football field builder | Chart implied values across methods | Comps, precedents, DCF, LBO, research ranges | Football field chart and page | Internal | Suggests ranges and narrative | L |
| 7 | DCF workbench | UFCF, mid-year, dual terminal value, sensitivity grids | Financials, WACC inputs, forecasts | DCF output, implied multiples | EDGAR, FMP, user forecasts | Proposes base-case drivers from history and guidance | M |
| 8 | Accretion/dilution and contribution workbench | Merger model with PPA, synergies, financing mix | Two tickers, offer terms | EPS accretion by year, breakeven synergies, contribution table | EDGAR, FMP | Drafts assumptions and commentary | M |
| 9 | Exchange ratio and collar analyzer | Fixed/floating/collar grids and historical ratio chart | Prices, terms | Ownership and premium grids | FMP history | Explains risk allocation | L |
| 10 | Buyer/target list builder | Tiered lists with rationale and capacity | Target profile, sector | List with tiers, rationale, capacity flags | Company DB, filings, venture DB | Generates rationale and screens fit | M |
| 11 | Ability-to-pay LBO | Quick LBO solving max price at hurdle IRR | Financials, leverage, exit | IRR/MOIC, returns attribution, max price | EDGAR, user inputs | Suggests market leverage/pricing | M |
| 12 | PIB generator | One-click binder of filings, transcripts, news, research summary | Ticker | PDF/HTML binder with TOC | EDGAR, FMP, web | Summaries and highlights | L |
| 13 | Teaser and CIM drafter | First drafts from structured KPIs and management notes | Data room docs, KPIs | Teaser, CIM sections | Uploaded docs | Long-form drafting with citations | H |
| 14 | Management presentation outliner | Storyline and slide skeleton from CIM | CIM | Slide outline and draft pages | Internal | Drafting | L |
| 15 | Process letter templates | Phase I/II letters with dates and requirements | Process calendar | Letters | Internal | Fill-in drafting | L |
| 16 | Process tracker | NDA, CIM, IOI, LOI status per buyer with bid matrix | Buyer list, bids | Dashboard, bid comparison | Internal | Normalizes bids across structures | M |
| 17 | Data room index and Q&A triage | Numbered index mirroring request list; duplicate-question detection | Request list, uploads | Index, Q&A log, draft answers | Uploads | Classifies, drafts answers from docs | M |
| 18 | Due diligence tracker | Request list with owners and status | Buyer request lists | Tracker, aging report | Internal | Maps requests to VDR folders | L |
| 19 | Working group list builder | Contact sheet from email signatures and engagement docs | Emails, PDFs | WGL | Uploads | Entity extraction | L |
| 20 | Weekly market update generator | Sector multiples, deals, movers, calendar | Comps sheets, deal feed | Deck pages and email | FMP, EDGAR, internal | Drafts commentary | M |
| 21 | Sector newsletter composer | Monthly client-ready round-up | Deal DB, comps | Newsletter | Internal | Drafting | L |
| 22 | League table tracker | Adviser rankings from proxy/8-K adviser disclosures | Precedent DB | Rankings by sector/size | EDGAR (partial) | Adviser name normalization | M |
| 23 | Earnings and transcript digest | Post-call summary with KPI deltas and M&A commentary | Transcripts, releases | One-pager, alerts | FMP/EDGAR, transcripts (licensed) | Summarization | M |
| 24 | Sector KPI extractor | Pull ARR/NRR/RPO, backlog/book-to-bill, RevPAR, reserves, CET1 from text | Filing text | KPI time series with quotes | EDGAR | Extraction with confidence | H |
| 25 | Biotech rNPV builder | Asset-level rNPV with PoS library and LOE | Pipeline table, assumptions | rNPV per asset, SOTP | ClinicalTrials.gov, FDA, user | Drafts assumptions from trial registries | H |
| 26 | E&P NAV/PV-10 reader | Parse supplemental reserve disclosures and standardized measure | 10-K supplemental data | Reserves, PV-10, EV/boe, EV/production | EDGAR | Table extraction | M |
| 27 | Bank M&A TBV earnback calculator | TBV dilution, earnback, pro forma CET1 | Two banks, deal terms | Earnback years, capital ratios | EDGAR (call-report tags), user | Suggests cost saves and marks from precedents | M |
| 28 | REIT NAV and implied cap rate | NAV model with cap-rate sensitivity | NOI, debt, cap rates | NAV/share, premium/discount | EDGAR, user cap rates (Green Street licensed) | Drafts assumptions | M |
| 29 | Model linter | Scan uploaded Excel for hard-codes, broken links, sign errors, balance checks | .xlsx | Issue list with cell references | Uploads | Explains fixes | M |
| 30 | Excel/PowerPoint export with live footnotes | Formatted comps, precedents, football field to Office with sources | Sheets | .xlsx/.pptx | Internal | Page layout suggestions | M |
| 31 | Premiums paid analysis | Unaffected price detection and premium windows | Deal DB, price history | Premium table and distribution | FMP history, EDGAR | Detects leak dates from news/volume | M |
| 32 | Deal protection benchmark | Termination fees, RTFs, go-shops by size and buyer type | Precedent DB | Benchmark table | EDGAR merger agreements | Clause extraction | M |
| 33 | Synergy benchmark library | Announced synergies as % of target revenue/opex, timing | 8-K decks | Benchmarks by sector | EDGAR | Extraction | M |
| 34 | Regulatory timeline predictor | Sign-to-close durations and conditions from precedents | Precedent DB | Expected timeline and risk flags | EDGAR | Pattern summarization | M |
| 35 | Activism vulnerability screen | TSR, valuation discount, governance, holder turnover | Ticker | Vulnerability scorecard | FMP, DEF 14A, 13F/13D | Drafts the activist thesis | M |
| 36 | Shareholder base analyzer | 13F/13D holders, turnover, cost basis | Filings | Holder table, vote map | EDGAR 13F | Classifies holder types | M |
| 37 | Deal idea generator | Signals (PE hold period, activist stake, 52-week low, LOE, founder age) ranked | DBs | Idea cards with rationale | Internal, venture DB | Ranking and rationale | M |
| 38 | Call-prep memo | One-page brief before a client meeting | Ticker, CRM notes | Memo | All of the above | Synthesis | L |
| 39 | Fee estimator | Lehman variants, retainers, tails, fairness fee | Deal size, structure | Fee schedule | Internal | None | L |
| 40 | Utility rate-base tracker | Rate base, allowed ROE, pending cases | 10-K, rate filings | EV/rate base comps | EDGAR, regulator sites | Extraction | H |

Sector-specific entries: 24, 25, 26, 27, 28, 40 plus telecom EV/subscriber and retail lease-adjusted EBITDAR column sets inside the comps engine (L).

---

## 9. Suggested prompt library (25 prompts an M&A banker would ask)

1. "Spread trading comps for SNOW with core and adjacent peers, calendarize to December, and footnote every normalization."
2. "Which of these peers has a non-December fiscal year, and how did you calendarize it?"
3. "Pull all public software acquisitions above $1B since 2023 with EV/NTM revenue, premium to 30-day VWAP and consideration mix."
4. "Summarize the background of the merger in the Penumbra DEFM14A as a dated timeline of contacts, bids and price moves."
5. "What valuation methods and ranges did the fairness opinion in this proxy use, and what was the adviser fee?"
6. "Build a football field for this target using comps, precedents, a DCF at 9-11% WACC and an LBO at 20-25% IRR."
7. "Run a DCF with mid-year convention and both terminal value methods; show me the implied exit multiple at 2.5% growth."
8. "Re-lever peer betas to a 30% debt-to-capital structure and compute the WACC with a size premium for a $600M market cap."
9. "Model Company A acquiring Company B at a 30% premium, 50/50 cash and stock, 7% cost of debt; is it accretive in year 2 with $50M synergies?"
10. "What pre-tax synergies are needed to break even on EPS in year 1?"
11. "Show contribution analysis and the implied exchange ratio range for a merger of equals between these two banks, including TBV earnback."
12. "Draft a tiered buyer list for a $400M revenue vertical SaaS company with strategic rationale and sponsor dry powder."
13. "Which sponsors have owned software assets for more than five years and are likely sellers?"
14. "Generate a PIB for Coterra covering the last four quarters, the latest proxy and the merger announcement."
15. "What termination fee and reverse termination fee are market for a $3B all-cash take-private by a sponsor?"
16. "Extract every announced synergy target from 8-K investor decks in industrials deals above $5B since 2024."
17. "What is the median EV/EBITDAX and EV/flowing barrel for Permian E&Ps today, and how does Devon/Coterra compare?"
18. "Compute rNPV for this Phase 2 oncology asset with $1.2B peak sales, launch in 2030, and standard oncology PoS."
19. "Compare this REIT's implied cap rate to Green Street's sector average and estimate the premium or discount to NAV."
20. "Draft the executive summary of a CIM from these KPIs and management notes, in banker tone, with no valuation guidance."
21. "Write the Phase I process letter with IOI due in three weeks and list the information we request from bidders."
22. "Deduplicate these 140 data-room questions, group by workstream and draft answers where the VDR already has the document."
23. "Prepare Monday's TMT market update: sector multiples, last week's deals, and premiums."
24. "Score this company's activism vulnerability: TSR versus peers, valuation discount, governance provisions and holder turnover."
25. "Lint this LBO model for hard-coded numbers, broken links and a balance sheet that does not balance."

---

## 10. Sources

**Process, fees, fairness opinions, deal protection, activism**
- Auxo Capital Advisors, sell-side process: https://auxocapitaladvisors.com/sell-side-m-a-process/ and timeline: https://auxocapitaladvisors.com/sell-side-mna-timeline/ ; buy-side: https://auxocapitaladvisors.com/buy-side-m-a-process/
- PCE Companies, M&A process stages: https://www.pcecompanies.com/resources/ma-process-stages-timeline
- Praxis Rock, sell-side advisory fees 2026: https://praxisrock.com/insights/sell-side-advisory-fees
- First Page Sage, M&A advisory fee structure: https://firstpagesage.com/business/ma-advisory-fee-structure/
- M&A Community, fees by deal size: https://mnacommunity.com/insights/ma-fees-by-deal-size/
- Mergers & Inquisitions, fairness opinions: https://mergersandinquisitions.com/investment-banking-fairness-opinions/
- Stout, fairness opinions primer: https://www.stout.com/en/insights/article/fairness-opinions-brief-primer
- NBER, banker fees and acquisition premia: https://www.nber.org/system/files/working_papers/w11333/w11333.pdf
- Houlihan Lokey, 2025 Transaction Termination Fee Study (June 2026): http://cdn.hl.com/pdf/2026/2025-transaction-termination-fee-study.pdf
- DealLawyers, termination fees: https://www.deallawyers.com/blog/2025/05/termination-fees-how-much-is-too-much.html
- CFI, go-shop period: https://corporatefinanceinstitute.com/resources/valuation/go-shop-period/
- Lazard, Annual Review of Shareholder Activism 2025: https://www.lazard.com/research-insights/annual-review-of-shareholder-activism-2025/ and H1 2026 page: https://www.lazard.com/research-insights/shareholder-activism/
- Evercore FY2025 Form 10-K: https://www.sec.gov/Archives/edgar/data/1360901/000162828026010273/evr-20251231.htm
- IB Vine, strategic defense and shareholder advisory: https://ibvine.io/interview-guides/specialist-groups/strategic-defense-shareholder-advisory

**Day-to-day, deliverables, documents**
- Wall Street Prep, M&A analyst day in the life: https://www.wallstreetprep.com/knowledge/ma-analyst-day-in-the-life/
- Mergers & Inquisitions, IB vice president: https://mergersandinquisitions.com/investment-banking-vice-president/ ; career path: https://mergersandinquisitions.com/investment-banking-career-path/ ; pitch books: https://mergersandinquisitions.com/investment-banking-pitch-book/ ; CIM guide: https://mergersandinquisitions.com/confidential-information-memorandum/
- Quintedge, what bankers do all day: https://quintedge.com/blog/what-does-an-investment-banker-do
- Sell Side Handbook, spreading comps: http://sellsidehandbook.com/2019/03/15/spreading-trading-comps-for-investment-banking/ ; buyers lists: http://sellsidehandbook.com/2019/01/20/compiling-a-buyers-list-in-investment-banking/
- iDeals, data room checklist: https://www.idealsvdr.com/blog/virtual-data-room/data-room-checklist/ ; Peony, 174-document checklist: https://www.peony.ink/blog/due-diligence-data-room-checklist
- Wall Street Prep, M&A deal documents and filings: https://www.wallstreetprep.com/knowledge/deal-documents-go-find-information-ma-transactions/
- Wall Street Prep, Bloomberg vs CapIQ vs FactSet: https://www.wallstreetprep.com/knowledge/bloomberg-vs-capital-iq-vs-factset-vs-thomson-reuters-eikon/ ; CT Acquisitions provider comparison: https://ctacquisitions.com/refinitiv-vs-bloomberg-vs-factset-vs-capital-iq/ ; o11, PitchBook vs CapIQ vs FactSet: https://o11.ai/blog/pitchbook-vs-capital-iq-vs-factset

**Methodology**
- Wall Street Prep: comps https://www.wallstreetprep.com/knowledge/comparable-company-analysis-comps/ ; LTM vs NTM https://www.wallstreetprep.com/knowledge/ltm-vs-ntm-multiples/ ; precedents https://www.wallstreetprep.com/knowledge/precedent-transaction-analysis/ ; terminal value https://www.wallstreetprep.com/knowledge/terminal-value/ ; merger model https://www.wallstreetprep.com/knowledge/merger-model/ ; exchange ratios https://www.wallstreetprep.com/knowledge/exchange-ratios-ma-fixed-vs-floating-exchange-ratios-collars-caps/ ; LBO returns attribution https://www.wallstreetprep.com/knowledge/lbo-returns-attribution-analysis-value-creation/ ; Premium Package curriculum https://www.wallstreetprep.com/self-study-programs/premium-package/
- Breaking Into Wall Street: precedents https://breakingintowallstreet.com/kb/valuation/precedent-transaction-analysis/ ; exchange ratios and collars https://breakingintowallstreet.com/kb/ma-and-merger-models/exchange-ratios-in-ma-deals-fixed-floating-and-collars/
- Macabacus, precedent transactions: https://macabacus.com/valuation/precedent-transactions
- IB Interview Questions guides: EV bridge https://ibinterviewquestions.com/guides/valuation-investment-banking/equity-value-to-enterprise-value-bridge ; mid-year convention https://ibinterviewquestions.com/guides/valuation-investment-banking/discounting-mechanics-present-value-mid-year-convention ; SOTP https://ibinterviewquestions.com/guides/valuation-investment-banking/sum-of-the-parts-valuation-methodology ; breakup analysis https://ibinterviewquestions.com/guides/valuation-investment-banking/breakup-analysis-conglomerate-discount ; private credit and LBOs https://ibinterviewquestions.com/guides/valuation-investment-banking/private-credit-boom-reshaping-lbo-financing
- CT Acquisitions, DCF construction guide (size premium): https://ctacquisitions.com/discounted-cash-flow-model/
- Capstone Partners, middle market leveraged finance update: https://www.capstonepartners.com/insights/middle-market-leveraged-finance-report/

**Sectors**
- Technology: multiples.vc September 2026 software multiples https://multiples.vc/insights/software-saas-valuation-multiples ; Clouded Judgement https://cloudedjudgement.substack.com/p/clouded-judgement-13026-software ; McKinsey Rule of 40 https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/saas-and-the-rule-of-40-keys-to-the-critical-value-creation-metric ; M&I technology IB https://mergersandinquisitions.com/technology-investment-banking/ ; semis valuation https://ibinterviewquestions.com/guides/tmt-investment-banking/semiconductor-valuation-cyclical-adjustments and https://ibinterviewquestions.com/guides/tmt-investment-banking/semiconductor-financial-analysis
- Healthcare: rNPV https://ibinterviewquestions.com/guides/healthcare-investment-banking/risk-adjusted-npv-biotech-valuation ; Drug Discovery Today rNPV framework https://www.sciencedirect.com/science/article/pii/S1359644626001224 ; M&I healthcare IB https://mergersandinquisitions.com/healthcare-investment-banking/ ; healthcare multiples https://ibinterviewquestions.com/guides/healthcare-investment-banking/healthcare-valuation-multiples-metrics and https://ibinterviewquestions.com/guides/healthcare-investment-banking/medtech-valuation-multiples-comps ; FOCUS healthcare multiples https://focusbankers.com/valuation-multiples-by-industry/ ; Healthcare Brew 2026 deals https://www.healthcare-brew.com/stories/2026-biggest-healthcare-deals-so-far ; CNBC patent cliff https://www.cnbc.com/2026/01/07/big-pharma-race-to-snap-up-biotech-assets-as-170-billion-patent-cliff-looms.html
- Energy & Power: E&P multiples https://ibinterviewquestions.com/guides/energy-investment-banking/ep-valuation-multiples-ebitdax-production-reserves-acre ; NAV model https://ibinterviewquestions.com/guides/energy-investment-banking/nav-model-energy-signature-valuation ; M&I oil and gas https://mergersandinquisitions.com/oil-gas-investment-banking/ ; M&I power and utilities https://mergersandinquisitions.com/power-utilities-investment-banking/ ; utility valuation https://ibinterviewquestions.com/guides/energy-investment-banking/utility-valuation-pe-rate-base-dividend-models ; renewables https://ibinterviewquestions.com/guides/energy-investment-banking/renewable-energy-valuation-methods ; midstream https://ibinterviewquestions.com/guides/energy-investment-banking/midstream-business-model-fee-based-infrastructure ; OFS multiples https://iconic.co/blog/oilfield-services-and-energy-valuation-multiples/
- FIG: M&I bank and insurance modeling https://mergersandinquisitions.com/bank-insurance-modeling-101/ ; FI valuation https://ibinterviewquestions.com/guides/valuation-investment-banking/financial-institutions-valuation-ptbv-ddm-embedded-value ; asset managers https://ibinterviewquestions.com/guides/fig-investment-banking/aum-based-valuation-asset-managers ; fintech https://ibinterviewquestions.com/guides/fig-investment-banking/fintech-valuation-revenue-multiples-unit-economics ; brokers https://ibinterviewquestions.com/guides/fig-investment-banking/insurance-broker-valuation-ebitda-revenue
- Industrials: M&I industrials https://mergersandinquisitions.com/industrials-investment-banking/ ; mid-cycle EBITDA https://ibinterviewquestions.com/guides/industrials-investment-banking/mid-cycle-ebitda-normalized-earnings-full-cycle ; General Dynamics Q2 2026 10-Q https://www.sec.gov/Archives/edgar/data/0000040533/000004053326000032/gd-20260705.htm
- Consumer/Retail: M&I consumer retail https://mergersandinquisitions.com/consumer-retail-investment-banking/ ; retail valuation https://ibinterviewquestions.com/guides/valuation-investment-banking/retail-consumer-valuation-ebitdar-unit-economics ; four-wall EBITDA https://www.acceinvestments.com/learn/four-wall-ebitda
- Real Estate/Gaming/Lodging: M&I real estate IB https://mergersandinquisitions.com/real-estate-investment-banking/ ; REIT valuation https://ibinterviewquestions.com/guides/valuation-investment-banking/real-estate-reit-valuation-nav-ffo-affo-cap-rates ; OpCo/PropCo https://ibinterviewquestions.com/guides/real-estate-investment-banking/opco-propco-separations-value-creation ; hotel multiples https://ctacquisitions.com/hotel-business-valuation/ ; Green Street data https://www.greenstreet.com/products/data-analytics/
- TMT/Media: M&I TMT https://mergersandinquisitions.com/tmt-investment-banking-group/ ; telecom valuation https://ibinterviewquestions.com/guides/tmt-investment-banking/telecom-valuation-ev-ebitda-ev-subscriber ; media valuation https://ibinterviewquestions.com/guides/tmt-investment-banking/media-valuation-subscriber-content

**AI, pain points, market context**
- Rogo: Sacra https://sacra.com/c/rogo/ ; Financial Advisor / Bloomberg https://www.fa-mag.com/news/junior-bankers-sick-of-grunt-work-build--2-billion-ai-tool-to-do-the-job-86823.html ; workflow review https://www.theleveragedyears.com/ai-workflows/rogo-ai-investment-banking-ma-workflow
- Disruption Banking, AI skills gap: https://www.disruptionbanking.com/2026/04/01/the-skills-gap-ai-is-creating-in-investment-banking/
- ChatFin, pitchbook automation 2026: https://chatfin.ai/blog/ai-pitchbook-presentation-automation-for-investment-banking-2026/ ; Blueflame, AI in IB: https://blueflame.ai/resources/ai-in-investment-banking
- UpSlide, IB burnout survey: https://upslide.com/wp-content/uploads/2024/12/Investment-Banking-Burnout.pdf ; WSO, hand-spread vs CapIQ https://www.wallstreetoasis.com/forum/investment-banking/spreading-comps-hand-spread-vs-capiq-spread
- Dealogic/ION Q1 2026 rankings: https://ionanalytics.com/insights/dealogic/global-markets-rankings-1q26/ ; Dealroom 2026 deal tracker: https://dealroom.net/blog/recent-m-a-deals ; ONEtoONE 2026 megadeals: https://www.onetoonecf.com/the-return-of-the-megadeal-the-biggest-ma-transactions-of-2026-so-far/ ; CT Acquisitions US M&A league table: https://ctacquisitions.com/guides/us-investment-banking-ma-league-table-replication-2024-2026/
