# Quant Edge: the quant desk in your pocket

The owner's brief: YouBank is missing a way **"to put these financial resources in the hands of a small firm or
regular investor/user."** This document researches how the top trading and quant firms get their edge, says
plainly which parts of that edge a small firm or a person with a brokerage account can reproduce, and specifies
the features that do it. It is the spec for the builder agent who implements the chosen set right after this.

It also defines the contract between these features and the **agentic and algorithmic trading** work being built
in parallel on `claude/new-session-6k1ff0-algo` (broker connections, a strategy engine, backtesting, paper and
live trading, risk controls). Quant Edge **produces** signals, target portfolios, risk budgets, cost estimates
and integrity reports. The algo engine **consumes** them. Quant Edge never places an order.

Written 15 October 2026 on `claude/new-session-6k1ff0-quant`, from `main` at `06a4628`. Built the same day on the
same branch: see [13. Build status](#13-build-status) for what shipped, the owner's defaults used for the open
questions, and where the build departs from or corrects this spec.

## Contents

- [At a glance](#at-a-glance)
- [1. The bar these features meet](#1-the-bar-these-features-meet)
- [2. Research: how the top firms get their edge](#2-research-how-the-top-firms-get-their-edge)
  - [2.1 Method and limits of this research](#21-method-and-limits-of-this-research)
  - [2.2 The firms](#22-the-firms)
  - [2.3 The edges by kind, and what a small investor can replicate](#23-the-edges-by-kind-and-what-a-small-investor-can-replicate)
  - [2.4 What changed in 2024–2026](#24-what-changed-in-20242026)
  - [2.5 Not replicable, and the lesson that still transfers](#25-not-replicable-and-the-lesson-that-still-transfers)
- [3. What YouBank already has](#3-what-youbank-already-has)
- [4. Shared foundations (build these first)](#4-shared-foundations-build-these-first)
- [5. The contract with the algo engine: `QuantSignal` and `TargetPortfolio`](#5-the-contract-with-the-algo-engine-quantsignal-and-targetportfolio)
- [6. The features](#6-the-features)
- [7. Ranking, the chosen set and build order](#7-ranking-the-chosen-set-and-build-order)
- [8. Free and premium](#8-free-and-premium)
- [9. Compliance and wording](#9-compliance-and-wording)
- [10. Licences to keep out](#10-licences-to-keep-out)
- [11. Open questions for the owner](#11-open-questions-for-the-owner)
- [12. Sources](#12-sources)
- [13. Build status](#13-build-status)

---

## At a glance

| # | Feature | One line | Terminal | Size | Rank | This round |
|---|---|---|---|---|---|---|
| Q1 | **Factor Lab** | What your portfolio really owns: its exposure to market, size, value, momentum, quality, low volatility and investment, how crowded each factor is, and point-in-time factor returns built from SEC data and prices. | `FACT` | M | 2 | **Yes (2)** |
| Q2 | **Risk Model and Stress Tests** | A factor risk model with shrinkage for your real holdings: where the risk comes from, value at risk that is backtested, liquidity, and what 2008, 2020, 2022 or a shock you describe would do to you. | `PORT` (extended) | M | 3 | **Yes (3)** |
| Q3 | **Backtest Integrity Checker** | Is this backtest real? Deflated Sharpe, the probability of backtest overfitting, minimum track record, look-ahead and survivorship checks, and cost sensitivity, with every backtest you ran counted as a trial. | `BTX` | M | 1 | **Yes (1)** |
| Q4 | **Sizing and Drawdown Governor** | Kelly with the uncertainty left in, volatility targeting, risk parity and pod-style drawdown rules, turned into a risk budget the algo engine enforces. | `KELLY` | S | 4 | **Yes (4)** |
| Q5 | **Execution Cost Analyzer** | What your trades really cost: your own fills against fair benchmarks, your broker's Rule 605 and 606 numbers (payment for order flow included), and a pre-trade cost estimate. | `TCA` | M | 6 | **Yes (5)** |
| Q6 | **Event Desk** | Earnings drift, index adds and the Russell reconstitution, spin-offs, buybacks and dividend changes as a calendar with honest historical base rates by era and size. | `EVB` | M | 8 | Next |
| Q7 | **Insider and Activist Clusters** | Opportunistic insider buying (not routine), cluster buys and new or upgraded 13D stakes, each with its base rate, timed from when the filing became public. | `INSC` | M | 5 | **Yes (6)** |
| Q8 | **Filing Change Detector** | "Lazy prices": which 10-K and 10-Q sections changed most from last year, what changed in quotes, and how stocks with similar changes did. | `DIFF` | M | 9 | Next |
| Q9 | **Volatility Desk** | Implied against realized volatility, the volatility risk premium, skew, term structure, the expected earnings move against history, and dealer gamma with its caveats. | `VOLS` | M | 13 | Later (data licence) |
| Q10 | **Pairs and Residual Scanner** | Cointegrated pairs and PCA residuals within sectors, with half-life, out-of-sample stability, a cost hurdle and a false-discovery correction. | `PAIR` | M | 12 | Later |
| Q11 | **Regime Monitor** | A calibrated probability of a high-volatility regime from public-domain inputs, scored in the forecast ledger against a GARCH baseline. | `REGM` | S | 10 | Next |
| Q12 | **Factor Sleeve Builder** | Rules you choose (universe, factors, constraints, rebalance) turned into a transparent target portfolio, checked by Q3, that the algo engine or paper trading can follow. | `SLEEVE` | M | 7= | Next (after counsel) |
| Q13 | **Short Interest and Crowding** | FINRA short interest and days to cover, daily short-sale volume labelled for what it is, and hedge-fund crowding from the 13F data YouBank already reads. | `SINT` | S | 11 | Next |
| Q14 | **Desk Drills: expected value and calibration** | Jane Street and SIG-style training: 90% intervals, a market-making game, a Kelly coin, and your own forecasts scored for calibration. | `DRILL` | S | 7= | **Yes (7)** |

The chosen set for this round is seven features. In build order: **foundations QF1–QF2, Q3, foundations QF3–QF5,
Q1, Q2, Q4, Q5, Q7, Q14** (section 7). The numbers in brackets in the last column are the build order.

---

## 1. The bar these features meet

Edge's bar (docs/edge-next.md, section 1) applies unchanged: real data with citations, calibrated models with
stated error, audit trails, UI on every surface including the phone, tests, free first, and honesty. Quant
features add six rules of their own, because this is where a product can most easily mislead people about money.

1. **Point in time, or say so.** Every number used as an input carries the moment it became public (`knownAt`),
   not the period it describes. A Form 4 counts from its EDGAR acceptance time, not the trade date. A 10-Q's
   figures count from its acceptance time plus one trading day. A backtest that cannot prove this for an input
   shows a "not point in time" badge, and Q3 marks it down.
2. **Every trial counts.** The deflated Sharpe ratio needs the number of strategies tried. YouBank counts it
   itself: every backtest a person (or the algo engine, or an AI agent) runs on a strategy family is logged as a
   trial. Nobody types "1".
3. **Costs on by default.** Every backtest, signal base rate and sleeve result is shown after an estimated
   spread, commission and impact cost (Q5's model), with the before-cost number beside it, not instead of it.
4. **Base rates beside every signal.** A signal never appears without the unconditional rate it should be
   compared with ("stocks with an insider cluster beat the market over 6 months 56% of the time; all stocks
   52%").
5. **Impersonal outputs.** Signals and factor data are the same for everyone. Analysis of a person's own
   portfolio describes that portfolio; it never says what they should buy or sell (section 9).
6. **Null results are shown.** When a signal stopped working (post-earnings drift in large caps; the index
   effect), the feature says so with the evidence, and the era split is on screen.

---

## 2. Research: how the top firms get their edge

### 2.1 Method and limits of this research

- **Web search** (standard and extended) worked on 15 October 2026. Results were checked against more than one
  source where possible.
- **Direct network access from the build sandbox was refused** by the egress policy for every data host tried:
  `cdn.cboe.com`, `cdn.finra.org`, `mba.tuck.dartmouth.edu` (Kenneth French's library), `stooq.com`,
  `www.sec.gov`, `api.nasdaq.com`, `fred.stlouisfed.org`, `jkpfactors.com` and `api.finra.org` all answered 403
  to CONNECT. So no data endpoint, file layout or terms page in this document was downloaded and checked. The
  builder must verify URL patterns and file formats against live responses (or saved fixtures) before relying
  on them, as the copy-trading build did.
- **Private firms do not publish their methods.** What is said about Renaissance, Jane Street, Citadel, HRT and
  the pod shops comes from books, interviews, regulatory filings, court and regulator documents and press
  reports. Revenue figures for 2025 are press reports citing people familiar, not audited numbers.
- Items marked *(prior knowledge)* rest on my own knowledge of the literature and were not re-checked this
  session. They are standard results, but launch copy should cite the primary source after checking it.

### 2.2 The firms

| Firm | What it is | Where the edge comes from (public evidence) | What transfers to a small investor |
|---|---|---|---|
| **Jane Street** | Market maker and proprietary trader in ETFs, options, bonds and equities | Pricing and liquidity provision at scale, especially ETFs and options; net trading revenue reported at about $39.6bn in 2025, roughly double 2024 ([Hedgeweek, citing Reuters](https://www.hedgeweek.com/jane-street-outpaces-rivals-with-record-40bn-trading-haul/)). A culture of probability, expected value and trading games in hiring and training (third-party interview guides, e.g. [techinterview.org](https://www.techinterview.org/companies/jane-street/?format=md)). In July 2025 India's SEBI issued an interim order alleging expiry-day manipulation of Bank Nifty, impounding Rs 4,843 crore; Jane Street deposited it, disputes the findings and has appealed ([Oxford Business Law Blog](https://blogs.law.ox.ac.uk/oblb/blog-post/2025/07/jane-street-and-expiry-day-trap-unpacking-sebis-crackdown-algorithmic)). | **Thinking, not speed:** expected value, calibrated confidence intervals and bet sizing are teachable (Q14). And a sobering fact: the other side of a retail options trade is usually a firm like this. |
| **Citadel Securities** | The largest US retail wholesaler and an options market maker | Internalising retail order flow it pays brokers for. Market makers paid a combined $1.19bn for US retail flow in Q1 2025, most of it for options ([Global Trading](https://www.globaltrading.net/?p=38554)); estimates put Citadel Securities near 40% of retail equity orders (unverified estimates). Net trading revenue reported at about $12.2bn in 2025. | **Execution quality is measurable and differs.** Identical market orders at different brokers cost 0.07% to 0.46% round trip on average, and payment for order flow does not explain the difference ([Schwarz et al., Journal of Finance 2025](https://ideas.repec.org/a/bla/jfinan/v80y2025i5p2507-2541.html)). Q5 measures it. |
| **Citadel** (hedge fund) | Multi-strategy fund with many independent teams | Central risk management over many teams, factor-neutral equity books, hard risk limits *(prior knowledge; widely reported)* | Separate the bets you mean (stock picks) from the ones you don't (unintended factor exposure): Q1 and Q2. |
| **Hudson River Trading**, **Jump**, **Tower**, **XTX**, **DRW** | High-frequency trading and electronic market making | Latency (colocation, microwave links, FPGAs), market microstructure models, scale. HRT's net trading revenue was reported at about $12.3bn in 2025 ([Young and Calculated](https://youngandcalculated.substack.com/p/jane-street-booked-396bn-in-2025)). | **Not replicable.** The lesson is to stop paying them more than necessary: limit orders, avoiding wide-spread and illiquid names, not trading the open and close blindly (Q5). |
| **Virtu** | Public market maker and wholesaler | Many tiny, independent edges across thousands of instruments; its 2014 IPO filing showed one losing day in 1,238 *(prior knowledge)*. | **The law of large numbers.** A small edge only becomes reliable over many independent bets; a few concentrated bets are mostly noise. Q3 and Q14 make this visible. |
| **Optiver**, **IMC**, **SIG** (Susquehanna) | Options market makers | Pricing volatility, managing inventory and Greeks, a bid-ask spread on every trade. SIG is known for poker, game theory and decision training *(prior knowledge)*. | Options carry a **volatility risk premium** and a spread that buyers pay. 0DTE retail traders lost about $358,000 a day in 2022–23, more than 60% of it transaction costs ([Beckmeyer, Branger and Gayda, via Bloomberg](https://www.bloomberg.com/news/articles/2023-04-21/day-traders-lose-358-000-per-day-gambling-on-zero-day-options)). Q9 shows the premium; Q14 teaches the arithmetic. |
| **D. E. Shaw** | Early computational statistical arbitrage, now multi-strategy | Systematic relative-value trading from the late 1980s *(prior knowledge)* | Statistical arbitrage at daily frequency is understandable and partly testable, but much decayed (Q10, honest about decay). |
| **Renaissance Technologies** | Medallion: short-horizon systematic trading, closed to outsiders | Zuckerman reconstructs 66.1% a year before fees and 39.1% after, 1988–2018 ([AIER review](https://www.aier.org/?p=48400)); a later paper argues the compounded figure is overstated and probably under 35% before fees ([arXiv 2405.10917](https://arxiv.org/pdf/2405.10917v2)). Thousands of short-term long and short positions, many weak signals, obsessive data cleaning, a capacity cap. | **Data hygiene and many weak signals,** not one story. Point-in-time data, survivorship-free universes and cost-aware testing are the replicable part (QF3, Q3). The signals themselves are not. |
| **Two Sigma** | Systematic manager built on data science and ML | A scientific-method research process, alternative data, ML ([Harvard D3 case](https://d3.harvard.edu/platform-rctom/?p=28381)); it built Venn, a factor-analytics product for allocators *(prior knowledge)*. | A **factor lens** on any portfolio (Q1) and regime models (Q11). |
| **Millennium**, **Point72**, **Balyasny** | "Pod" multi-manager funds | Many independent teams under strict central risk limits: a manager who loses 5% of allocated capital typically has it halved, and around 7.5% is often the end ([eFinancialCareers, citing WSJ](https://www.efinancialcareers.com/news/pratik-madhvani-glen-scheinberg); [Hedgeweek](https://www.hedgeweek.com/bluecrest-and-millennium-closed-pods-amid-market-turmoil/)). Factor-neutral mandates so returns come from stock picking. | **Hard drawdown rules written down in advance** (Q4), and factor neutrality as a diagnostic (Q1). |
| **Bridgewater** | Global macro; All Weather | Risk parity: balance risk, not dollars, across assets that do well in different growth and inflation regimes *(prior knowledge)* | Risk parity with a handful of ETFs is cheap and replicable (Q4, Q12). |
| **AQR** | Systematic factor investing | Value, momentum, carry and defensive across asset classes *(prior knowledge: Asness, Moskowitz and Pedersen 2013)*. Contrarian factor timing adds little to a diversified factor portfolio ([Asness et al. 2017](https://www.cxoadvisory.com/value-premium/valuation-based-factor-timing/)). Merger arbitrage earns about 4% a year above the market after costs, with a payoff like selling index puts ([Mitchell and Pulvino 2001](https://ideas.repec.org/a/bla/jfinan/v56y2001i6p2135-2175.html)). | **Diversify across factors, don't time them,** and know which strategies are short a crash (Q1, Q6). |
| **Man Group (AHL)** | Systematic trend following and ML | Time-series momentum across futures *(prior knowledge: Moskowitz, Ooi and Pedersen 2012)*, an ML research platform, NLP on filings and news ([job description via Selby Jennings](https://www.selbyjennings.com/en-hk/job/ml-alpha-researcher-pr580670_1778748912)) | Trend and volatility scaling with ETFs, with honest out-of-sample tests (Q3, Q4). |
| **WorldQuant** | An "alpha factory" of many small, short-lived signals | Published "101 Formulaic Alphas" (Kakushadze 2016) and crowd-sources signals *(prior knowledge)* | Signals decay and crowd; combine many weak ones, measure turnover and costs, and count every one tried (Q3). |

### 2.3 The edges by kind, and what a small investor can replicate

Verdicts: **No** = not replicable; **Partly**; **Yes** = very replicable with free or cheap data and software.

| Edge | How the top firms do it | Does it still work? | Verdict | What YouBank can do |
|---|---|---|---|---|
| **Speed and infrastructure** | Colocation, microwave and laser links, FPGAs, kernel bypass; microsecond reaction to order-book changes | Yes, for those with the infrastructure; a winner-takes-most race | **No.** Retail orders go through a broker and a wholesaler; there is no path to microsecond trading, and pretending otherwise would be dishonest | Show what latency and spreads cost the person (Q5); a "Why we don't offer this" note |
| **Market making and liquidity provision** | Quote both sides, earn the spread, manage inventory risk and adverse selection; buy retail flow (PFOF) because it is uninformed on average | Yes; record revenues in 2025 | **No** for retail (no rebates, no flow, no inventory financing). **The lesson transfers:** you are the one paying the spread | Q5 (your fills, your broker's 605/606 numbers), Q14's market-making game |
| **Statistical arbitrage** | Pairs and baskets, PCA residual mean reversion, intraday and multi-day, thousands of names, low cost | Decayed since the 2000s: Avellaneda and Lee's PCA strategy had Sharpe 1.44 over 1997–2007 after costs but only 0.9 in 2003–2007 ([Avellaneda and Lee 2010](https://ideas.repec.org/a/taf/quantf/v10y2010i7p761-782.html)); pairs profits fell after 2002 *(prior knowledge: Do and Faff 2010)* | **Partly.** Daily-frequency pairs are testable with free data; costs, shorting and borrow fees eat most of the edge for small accounts | Q10, with a cost hurdle and a false-discovery correction |
| **Systematic factor investing** | Value, momentum, quality (profitability), low volatility (betting against beta), size, investment, carry; long-short, diversified, low cost | Most published factors replicate: over 80% stay significant after consistent construction and multiple-testing adjustment, in 13 themes and 93 countries ([Jensen, Kelly and Pedersen, JF 2023](https://nber.org/system/files/working_papers/w28432/w28432.pdf)) | **Yes** as long-only tilts with ETFs or direct holdings; long-short is partly replicable | Q1 (factor lab), Q12 (sleeves), QF4 (factor engine) |
| **Factor timing and crowding** | Valuation spreads, factor momentum, crowding measures (return comovement, ownership concentration), volatility management | Hard. Value timing adds little to diversified factors ([Asness et al. 2017](https://www.cxoadvisory.com/value-premium/valuation-based-factor-timing/)); volatility-managed portfolios do not beat unmanaged ones out of sample across 103 strategies ([Cederburg et al., JFE 2020](https://www.lehigh.edu/~xuy219/research/COWY.pdf)). Crowding raises crash risk *(prior knowledge: the August 2007 quant quake, Khandani and Lo)* | **Partly.** Crowding as a risk warning is useful; timing as a return source mostly is not | Q1 crowding panel, Q13, honest copy against timing |
| **Volatility and options** | Sell the variance risk premium with hedges; skew, term structure, dispersion; dealer positioning | The average variance risk premium is negative (implied above realized) and sizeable at all horizons ([Carr and Wu, RFS 2009](https://ideas.repec.org/a/oup/rfinst/v22y2009i3p1311-1341..html)), though one 2006–2020 study found the S&P 500 premium not significantly different from zero ([Wikipedia summary](https://en.wikipedia.org/wiki/Variance_risk_premium)). Dealer-gamma ("GEX") numbers rest on a sign assumption, and a direct test found no support for the gamma-hedging feedback channel ([Princeton thesis](https://theses-dissertations.princeton.edu/entities/publication/61115cd1-cb09-4a8b-9230-ff488fc2a386)) | **Partly.** Understanding implied versus realized volatility, skew and the expected move is replicable; profitably selling volatility is a short-crash strategy that needs margin, discipline and sizing; GEX is a modelled estimate, not data | Q9, when an options data licence is settled |
| **Event-driven** | Earnings drift (PEAD), index rebalances, merger arbitrage, spin-offs, activist 13Ds, insider clusters, buybacks | Mixed and decaying. PEAD vanished in large caps by about 2006 ([Martineau, CFR 2022](https://nowpublishers.com/article/Details/CFR-0122)), though 2025 papers dispute it ([UCLA Anderson Review](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again/)). The S&P 500 addition effect fell from 7.4% in the 1990s to under 1% ([Greenwood and Sammon, JF 2025](https://papers.ssrn.com/abstract=4294297)). Opportunistic insider trades earned 82 bp a month value-weighted, routine ones about zero ([Cohen, Malloy and Pomorski 2012](https://www.nber.org/digest/apr11/w16454.html)). Merger arbitrage about 4% a year excess, short-put-like ([Mitchell and Pulvino 2001](https://ideas.repec.org/a/bla/jfinan/v56y2001i6p2135-2175.html)) | **Yes** for the information (all from public filings, which YouBank already reads); **partly** for profit after costs and decay | Q6, Q7, Q8 with base rates by era |
| **Alternative data** | Satellite, card spend, web traffic, app data, job postings, NLP on filings and calls; expensive licensed feeds | Works where it is not yet priced; the cheap kinds get crowded fast. LLM headline scores predict the immediate reaction with about 90% hit rates, but that move is not tradable, and strategy returns decline as LLM adoption rises ([Lopez-Lira and Tang v6](https://arxiv.org/html/2304.07619v6)). Textual changes in 10-Ks predict returns: up to 188 bp a month in the strongest specification, 34–58 bp value-weighted ([Cohen, Malloy and Nguyen, JF 2020](https://www.nber.org/papers/w25084)) | **Partly.** Licensed card and app data is out of reach; free public alternative data (jobs, filings text, contracts, patents) is in reach and YouBank already collects much of it | Reuse Edge's Pulse as signals (section 5); Q8 for filing text |
| **Execution** | VWAP and TWAP schedules, implementation shortfall, transaction cost analysis, smart order routing, minimising impact | Essential at scale | **Yes, for measurement.** Retail cannot route orders itself, but it can measure fills, choose brokers and order types, and avoid paying for bad timing | Q5; the algo engine executes |
| **Risk and portfolio construction** | Factor risk models, shrinkage covariance, risk parity, mean-variance with constraints, Kelly-fraction sizing, drawdown limits, stress tests, regime awareness | Yes, and it is where most of the professional advantage over retail lies | **Yes.** All of it runs on daily prices and free factor data | Q2, Q4, Q11 |
| **Research process** | Walk-forward validation, purged cross-validation, deflated Sharpe, probability of backtest overfitting, multiple-testing corrections (t above 3), point-in-time data, no survivorship | Essential; most published and retail backtests fail it | **Yes.** It is mathematics; the only hard part is honest point-in-time data | Q3, QF2, QF3 |
| **Culture and decision process** | Calibration, expected value, Kelly sizing, betting on everything, post-mortems | Yes | **Yes.** In a biased-coin game with a 60% edge, about 30% of finance-literate players went bust ([Haghani and Dewey 2016](https://papers.ssrn.com/abstract=2856963)) | Q14, the forecast ledger |

### 2.4 What changed in 2024–2026

| Development | Evidence | What it means here |
|---|---|---|
| **Record trading-firm revenues** | Jane Street about $39.6bn, HRT about $12.3bn and Citadel Securities about $12.2bn in 2025 (press reports, section 2.2) | Liquidity provision is enormously profitable; much of it is paid by people who trade often and in options |
| **Retail is about a fifth of US equity volume** | 20.1% in Q3 2025, second only to early 2021 (Jefferies); up to 35% in April 2025 (JPMorgan) ([Benzinga summary](https://cdn4.benzinga.com/markets/tech/26/01/49671587/retail-investors-historic-2025-streak-record-inflows-record-influence)) | A large audience trading without professional tools |
| **0DTE options dominate SPX** | 59% of SPX volume in 2025, a record 62.4% in August; retail about 53–54% of 0DTE volume ([Cboe](https://www.cboe.com/insights/posts/spx-0-dte-options-jump-to-record-62-share-in-august)) | Q9 and Q14 should make the cost of short-dated options concrete |
| **Retail derivative losses, documented by a regulator** | 93% of individual F&O traders in India lost money in FY22–FY24, Rs 1.8 lakh crore in total; algorithmic firms made most of the profits ([Business Standard on the SEBI study](https://www.business-standard.com/markets/capital-market-news/sebi-study-exposes-massive-losses-for-individual-f-o-traders-in-india-124092400948_1.html)) | The honest framing for any options feature |
| **Payment for order flow at records** | $1.19bn in Q1 2025; options the majority ([Global Trading](https://www.globaltrading.net/?p=38554)) | Q5 shows each person's broker's 606 numbers |
| **Rule 605 modernised** | Brokers with 100,000+ customer accounts must publish execution quality, including a new summary report; compliance moved from 14 December 2025 to **1 August 2026** by SEC Release 34-104147 (90 FR 47552, October 2025, per search summaries; a 2026 SEC order on Rule 605 reporting, [34-105136](https://www.sec.gov/files/rules/exorders/2026/34-105136.pdf), was not read and may change details) ([Sidley on the amendments](https://www.sidley.com/en/insights/newsupdates/2024/04/sec-adopts-amendments-to-modernize-disclosure-of-order-execution-information)) | New, free, comparable broker execution data exists from September 2026 onward: Q5's broker scorecard |
| **Half-penny ticks and a lower access-fee cap** | Adopted September 2024; compliance reported as 2 November 2026, with a further extension to November 2027 reported but unconfirmed ([AIMA](https://www.aima.org/compass/practical-guides/spotlight-on-compliance/minimum-tick-size.html); [FlexTrade](https://flextrade.com/resources/secs-broader-reg-nms-overhaul-could-delay-access-fee-tick-sizes/)) | Spreads in many names may narrow; Q5's cost model must be dated and re-fitted after the change |
| **Faster 13D disclosure** | Initial Schedule 13D now due five business days after crossing 5% (from ten calendar days), amendments within two business days ([Harvard Law forum](https://corpgov.law.harvard.edu/2023/10/24/sec-adopts-updates-to-schedule-13d-and-13g-reporting)) | Q7's base rates must split the pre- and post-change eras |
| **Russell goes semi-annual** | The first December reconstitution: rank day 30 October 2026, preliminary lists 13 November, effective after the close on 11 December 2026 ([LSEG](https://www.lseg.com/en/media-centre/press-releases/ftse-russell/2026/ftse-russell-announces-december-2026-russell-us-indexes-reconstitution-schedule)) | Q6's index-flow calendar; YouBank can estimate adds and deletes from rank-day market caps itself |
| **The index effect has nearly gone** | S&P 500 additions earned 7.4% abnormal in the 1990s, under 1% in the last decade ([Greenwood and Sammon](https://papers.ssrn.com/abstract=4294297)) | "Front-running" index adds is not an edge to sell; the calendar is about avoiding forced-flow prices |
| **LLMs and look-ahead bias** | GPT scores predict the immediate (non-tradable) reaction; drift predictability concentrates in small stocks and bad news and declines with adoption ([Lopez-Lira and Tang v6](https://arxiv.org/html/2304.07619v6)). Backtests with LLMs are contaminated by look-ahead and "distraction"; anonymising company names helps ([Glasserman and Lin](https://arxiv.org/abs/2309.17322); [Look-Ahead-Bench 2026](https://arxiv.org/pdf/2601.13770)) | Any LLM-derived signal (Q8) must anonymise inputs and only be backtested after the model's training cutoff; Q3 flags LLM inputs |
| **Brokers open APIs to AI agents** | Webull launched an MCP server for natural-language trading (June 2026) and a paper-trading OpenAPI ([Nasdaq press release](https://www.nasdaq.com/press-release/webull-launches-model-context-protocol-enabling-investors-trade-through-ai-plain)) | The algo branch's broker layer; Quant Edge supplies what the agent should and should not do (risk budget, integrity) |
| **PEAD is contested again** | Martineau (2022) against two 2025 papers; Subrahmanyam attributes the gap to research design ([UCLA Anderson Review](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again/)) | Q6 shows the drift by era and size and does not take sides |

### 2.5 Not replicable, and the lesson that still transfers

Each of these gets a short "Why YouBank doesn't offer this" note in the Quant hub (one paragraph each, with the
source), because people will ask, and the honest answer is itself useful.

| Not replicable | Why | The lesson that transfers, and where |
|---|---|---|
| Sub-millisecond HFT and latency arbitrage | Needs colocation, direct exchange access and engineering costing tens of millions a year; retail orders reach the market through a broker and usually a wholesaler | Spreads, slippage and order timing are a cost you control: Q5 |
| Electronic market making | Needs exchange membership or a broker-dealer, rebates, inventory financing and uninformed flow | You are usually the one paying the spread; the market-making game in Q14 shows why the spread exists |
| Buying retail order flow | Only wholesalers can | Q5 shows your broker's payment for order flow and execution quality |
| Licensed alternative data (card panels, app panels, satellite at scale) | Costs six to seven figures a year and is licensed per firm | Edge's free signals (Pulse jobs, contracts, patents; SEC text) as `QuantSignal`s, section 5 |
| Medallion-style short-horizon signals | Unknown, capacity-limited, cost-sensitive at the intraday horizon | The research hygiene behind them: QF3 and Q3 |
| Selling options at scale as a business | Needs portfolio margin, hedging infrastructure and the capital to survive tail events | Understand the volatility risk premium before buying or selling an option: Q9, Q14 |
| Factor timing as a reliable return source | Evidence says it mostly does not work out of sample | Use crowding and regime as risk warnings, not trading signals: Q1, Q11 |

---

## 3. What YouBank already has

Quant Edge reuses these rather than duplicating them.

| Area | Already in YouBank | Reuse | Gap Quant Edge fills |
|---|---|---|---|
| Prices | `src/lib/market/data.ts`: FMP first, then Nasdaq (personal-use API, beta only), ETF proxies for indices, the ECB for currencies, CoinGecko for crypto, AI research for missing facts; `provenance.ts` notes each source | Every quant price read goes through `history()`/`closes()` and `noteSource()` | No cross-sectional store, no point-in-time universe, no delisted securities, no corporate-action audit beyond splits |
| Fundamentals | `src/lib/edgar/facts.ts` (company facts with `filed` dates), `src/lib/market/frames.ts` (one concept for every filer), `src/lib/edgar/splits.ts` | Characteristics for the factor engine | An "as known on date D" query; filing acceptance times; the SEC Financial Statement Data Sets as a bulk point-in-time source |
| Insiders and owners | `src/lib/edgar/insiders.ts` (Form 4 XML for one company, last 12 filings), `src/lib/edge/graph/ingest.ts` (13D/13G stakes as graph links, activist flag), `insiderFlags` in `graph/algo.ts` | Parsing code and flags | Bulk history (SEC Insider Transactions Data Sets), routine/opportunistic classification, clusters, base rates |
| 13F | `src/lib/copytrade/*`: 13F ingest, CUSIP mapping, clone rules (`targets.ts`), lag-aware backtest (`backtest.ts`), blends | Clones become one more `TargetPortfolio` producer (`copy.13f`); holdings feed crowding (Q13) | Crowding metrics |
| Risk | `PORT` (`terminal/portfolio.ts`: covariance attribution, bootstrap outcomes, 30 holdings), `RISK` (GARCH, VaR, Kupiec), `BETA` (Welch), `SIM` and `src/lib/edge/scen/*` (GJR-GARCH filtered historical simulation, crisis replays, entropy pooling, Kenneth French market and oil factors cached in R2) | Q2 extends `PORT`; stress replays reuse `scen/` | Multi-factor model, shrinkage, factor shocks at portfolio level, liquidity, VaR backtest on the portfolio |
| Statistics | `src/lib/inference/stats.ts` (OLS, multi-OLS, inverse, GARCH, VaR, Sharpe/Sortino, seeded RNG, Kupiec), `src/lib/edge/calib/*` (isotonic, Platt, Venn-Abers, conformal, Brier, reliability) | Built on, not copied | Deflated Sharpe, PBO, MinTRL, block bootstrap, shrinkage, HMM, cointegration (QF2) |
| Earnings | `EE` (`terminal/street.ts`: beat odds as Beta-Binomial, typical move by conformal quantile), Call Desk | Q6 reuses dates and reactions | Standardised surprise from XBRL, drift base rates |
| Forecast ledger | `edge_forecasts` and `src/lib/edge/forecasts/*`, Track record UI | Q6, Q7, Q11 and Q14 log probabilities here | New kinds and rules (section 4) |
| Signal store | `edge_series` with change detection (`series/change.ts`, BOCPD) | Pulse metrics become `QuantSignal`s through an adapter | — |
| Macro | Treasury par curve and BLS (both public domain, allowed in models); FRED (display only: its terms bar model use, so it never feeds a model) | Q11 uses Treasury and BLS | FRED series such as `VIXCLS` and `BAA10Y` must not enter Quant models |
| Brokers | SnapTrade client (holdings, recent orders for 3 days, order impact), copy-trading orders and audit log; the algo branch is adding Webull and others | Q2 and Q5 read holdings and fills through an adapter | Fill history import (CSV, SnapTrade, the algo engine's fills) |
| Learning | `LEARN` with Bayesian knowledge tracing | Q14 drills are tracked the same way | — |
| Infrastructure | R2 (`edge/infra/r2.ts`), the Modal ML service (`ml/edge_ml.py`), Inngest, the cron passes, the premium registry (`src/lib/billing/features/`), plan checks (`requireFeature`) | All of it | A `quant` feature area |
| Options, short interest, VIX | None (short interest appears only as a manual input in a markets workflow; VIX only through FRED, display only) | — | Q9, Q13, with licensing settled first |

**Name clash to avoid.** `src/lib/edge/canvas/values.ts` already exports `type Signal` (a canvas metric) and
`src/lib/news/affinity.ts` another `Signal`. The new contract is therefore `QuantSignal`.

---
## 4. Shared foundations (build these first)

Five pieces are shared by the features. Building them once is what makes seven features feasible in one round.
All code goes under `src/lib/quant/`; all new tables go in one additive migration, `drizzle/0025_quant.sql`
(applied by hand on a Neon branch first, then production with the owner's approval, as with 0020–0024). **The
algo branch may also add a 0025 migration; whichever merges second renumbers its file.** Schema in
`src/db/schema.ts` beside the `copy_*` tables.

```
src/lib/quant/
  contracts.ts          QF1  QuantSignal, TargetPortfolio, RiskBudget, Fill, CostEstimate, IntegrityReport (no imports)
  signals.ts            QF1  publishSignals, signalsAsOf, latestSignals (Postgres)
  targets.ts            QF1  saveTarget, getTarget, targetHistory; adapters from copytrade clones
  stats/                QF2  integrity.ts, bootstrap.ts, shrink.ts, hmm.ts, coint.ts, multiple.ts, purged.ts
  pit/                  QF3  universe.ts, bars.ts, fundamentals.ts, calendar.ts, actions.ts
  factors/              QF4  french.ts, characteristics.ts, engine.ts, crowding.ts
  events/               QF5  study.ts (event-study engine), catalog.ts (event definitions)
  risk/  sizing/  tca/  insiders/  drills/  ...   one folder per feature
  words.ts                   every user-facing sentence about performance, advice and risk (section 9)
```

### QF1. The contracts and the signal and target stores

**What.** `src/lib/quant/contracts.ts` holds the types in section 5 and nothing else: no imports, so the algo
branch can import it (or copy it byte for byte until both branches are merged). `CONTRACT_VERSION = "quant/1"`.

**Tables.**
```
quant_signals(
  id text pk,                         -- sha256(producer, producerVersion, instrument key, asOf, horizonDays) hex, first 32
  producer text not null,             -- 'quant.insider_cluster' | 'quant.factor_score' | 'edge.pulse' | 'copy.13f' ...
  producer_version text not null,
  symbol text not null, cik text, asset_class text not null default 'equity',
  as_of timestamptz not null,         -- when every input was public (max knownAt)
  computed_at timestamptz not null default now(),
  reconstructed boolean not null default false,  -- computed later from archived inputs (a backfill), not live
  valid_until timestamptz not null,
  horizon_days int not null,
  body jsonb not null,                -- the full QuantSignal
  forecast_id bigint,                 -- edge_forecasts.id when the signal carries a scorable probability
  index (producer, as_of), index (symbol, as_of)
)
quant_targets(
  id bigserial pk, target_key text not null,     -- stable per portfolio definition: 'sleeve:12' | 'copy:34' | 'algo:strategy:56'
  owner_id text,                                  -- null for impersonal model definitions
  version int not null, as_of timestamptz not null, body jsonb not null,
  created_at timestamptz not null default now(),
  unique (target_key, version)
)
quant_trials(                                    -- QF2/Q3: every backtest run counts
  id bigserial pk, owner_id text, family text not null,  -- a strategy family: 'algo:strategy:56' | 'sleeve:12' | 'upload:<hash>'
  params jsonb not null, returns_ref text not null,       -- R2 key of the daily return series
  sharpe real, n_obs int, skew real, kurt real,
  source text not null,                                   -- 'algo' | 'sleeve' | 'upload' | 'agent'
  created_at timestamptz not null default now(),
  index (family)
)
quant_runs(                                      -- saved analyses: integrity reports, TCA reports, stress runs
  id bigserial pk, owner_id text not null, kind text not null, input jsonb not null, output jsonb not null,
  sources jsonb not null default '[]', model_version text not null, created_at timestamptz not null default now()
)
quant_fills(                                     -- Q5: the person's own executions
  id bigserial pk, owner_id text not null, source text not null,  -- 'csv' | 'snaptrade' | 'algo'
  account_ref text not null, symbol text not null, side text not null, qty double precision not null,
  price double precision not null, executed_at timestamptz not null, placed_at timestamptz,
  order_type text, limit_price double precision, broker text, fees double precision, ext_id text,
  unique (owner_id, source, ext_id)
)
quant_factor_returns(
  date date not null, factor text not null, universe text not null, version text not null,
  ret double precision not null, primary key (date, factor, universe, version)
)
```

**Interface.**
- `publishSignals(signals)`: validates against the contract, upserts by id, logs probabilities to the forecast
  ledger when `probability` is present, and emits the Inngest event `quant/signals.published` with the ids.
- `signalsAsOf({ producers, symbols, at })`: only signals with `as_of <= at` and `valid_until > at`, newest per
  (producer, symbol). **This is the only function a backtest may use to read signals.** It is what makes replays
  free of look-ahead.
- `latestSignals({ producers, symbols })`: the live read.
- `saveTarget(target)`, `getTarget(key, { at? })`, `targetHistory(key)`; Inngest event `quant/target.updated`.
- Routes: `GET /api/quant/signals?producer=&symbols=&at=`, `GET /api/quant/targets/:key?at=`,
  `GET /api/quant/targets/:key/history`. Owner-scoped targets need the owner's session; impersonal ones need
  only a signed-in user.

**Adapters, so existing YouBank output becomes consumable without new features:**
- `copy.13f`: each copy portfolio's clone (`copytrade/targets.ts` `cloneTargets` or `blendTargets`) becomes a
  `TargetPortfolio` with `asOf` = the 13F's acceptance time and the `TIMING` disclosure attached.
- `edge.pulse`: a Pulse change point (BOCPD probability at least 0.9, `edge_series`) becomes an `event`-kind
  `QuantSignal` with its false-alarm rate in `calibration`.
- `edge.odds`: a Deal Radar probability becomes a `probability`-kind signal (P(announces a sale in 12 months))
  with its Venn-Abers interval and base rate. It is an estimate about corporate events, not about returns, and the
  signal says so (`kind: "probability"`, `question`).

**Tests.** Contract validation (`validateSignal`, `validateTarget`) on good and bad fixtures; `signalsAsOf` never
returns a signal whose `as_of` is after `at` (property test over random timestamps); adapter round trips.

### QF2. The statistics kit

Pure functions in `src/lib/quant/stats/`, built on `src/lib/inference/stats.ts` and `src/lib/edge/calib/`.
Every function has a test against a known answer or a simulation with a known truth (`scripts/test-quant.ts`).

| Function | What | Formula or method |
|---|---|---|
| `psr(returns, srStar)` | Probabilistic Sharpe ratio: the probability the true Sharpe exceeds `srStar` | Φ( (ŜR − SR*) · √(n−1) / √(1 − γ₃·ŜR + (γ₄−1)/4 · ŜR²) ), with per-period ŜR, skewness γ₃ and (non-excess) kurtosis γ₄ (Bailey and López de Prado 2012) |
| `dsr(returns, trialSharpes)` | Deflated Sharpe ratio | `psr` with SR* = √V[ŜRₖ] · ((1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e))), γ ≈ 0.5772 (Euler–Mascheroni), N = effective number of independent trials, V = variance of the trials' Sharpes ([Bailey and López de Prado 2014](https://papers.ssrn.com/abstract=2460551)) |
| `effectiveTrials(trialReturns)` | N for `dsr` when trials are correlated | Number of clusters of the trials' return correlation matrix (hierarchical clustering at correlation 0.5, plus the silhouette check), bounded by the raw count; both N's are shown |
| `minTrl(returns, srStar, alpha)` | Minimum track record length | 1 + (1 − γ₃ŜR + (γ₄−1)/4·ŜR²) · (Φ⁻¹(1−α) / (ŜR − SR*))² periods |
| `pbo(matrix, S=16)` | Probability of backtest overfitting by combinatorially symmetric cross-validation | Split the T×N trial-return matrix into S blocks; for each of C(S, S/2) splits pick the in-sample best, find its relative rank ω in the out-of-sample half, λ = ln(ω/(1−ω)); PBO = share of λ ≤ 0. Also the degradation slope (OOS on IS Sharpe) and P(OOS loss) ([Bailey, Borwein, López de Prado and Zhu 2017](https://escholarship.org/content/qt4w1110bb/qt4w1110bb.pdf)). C(16,8) = 12,870 splits; for N up to 500 this runs in seconds in TypeScript; beyond that, the ML service |
| `haircutSharpe(sr, n, trials, method)` | Sharpe after a multiple-testing haircut | Harvey and Liu (2015) with Bonferroni, Holm and BHY; plus the plain "t above 3" rule (Harvey, Liu and Zhu 2016) *(prior knowledge)* |
| `bh(pValues, q)` | Benjamini-Hochberg false discovery rate | Standard; used by every scanner (Q10, Q7's sweeps) |
| `blockBootstrap(x, block, B, seed)` | Stationary bootstrap (Politis-Romano) for confidence intervals on Sharpe, drawdown and CAR | Seeded with `rng()`; block length by the Politis-White rule |
| `purgedKFold(times, k, embargo)` | Cross-validation folds without leakage between overlapping labels | López de Prado, *Advances in Financial Machine Learning* ch. 7 *(prior knowledge)* |
| `ledoitWolf(R)` | Shrinkage covariance toward constant correlation | Ledoit and Wolf (2004) *(prior knowledge)* |
| `hmmFit(X, k)`, `hmmFilter` | Gaussian hidden Markov model, Baum-Welch with several seeded starts; filtered (not smoothed) state probabilities | Smoothed probabilities use the future; only filtered ones may be shown as "now" or used in backtests |
| `engleGranger(y, x)`, `adf(e, lags)`, `halfLife(e)`, `hurst(x)`, `johansen(Y)` | Cointegration tools | MacKinnon (2010) critical values for the residual ADF; half-life −ln 2 / ln(1+θ) from Δεₜ = θεₜ₋₁ + uₜ |
| `kellyGrowth(...)`, `drawdownProb(c, x)` | Kelly growth and drawdown odds | For a fraction c of full Kelly under geometric Brownian motion, P(wealth ever falls to x of its peak) = x^(2/c − 1) (Thorp; MacLean, Thorp and Ziemba) *(prior knowledge)* |

### QF3. The point-in-time store

**Why.** Every serious quant result depends on knowing, for any past date, which companies existed, what their
prices were, and what their filings said **as known then**. YouBank's current reads are "latest", which flatters
any backtest built on them.

**Universe (`pit/universe.ts`, table `quant_universe`).**
```
quant_universe(
  symbol text not null, cik text, name text not null, exchange text, share_class text,
  security_type text not null,             -- common | etf | adr | reit | preferred | unit | other
  first_date date not null, last_date date, -- trading days covered; last_date null while listed
  successor text,                           -- ticker change or merger survivor, when known
  source text not null, primary key (symbol, first_date)
)
```
Built from SEC `company_tickers_exchange.json` (current listings), EDGAR submissions (former names and tickers),
and the price vendor's delisted list. **Survivorship is a stated, measured property:** the universe page shows how
many securities in each year have no price history ("delisted, no prices: 312 of 3,410 in 2012"), and Q3 uses
that count.

**Prices (`pit/bars.ts`).** Daily adjusted and unadjusted closes, volume and dividends per symbol in R2, one
object per symbol (`quant/bars/<symbol>.json.gz`, columns as arrays) plus one cross-sectional panel per year
(`quant/panel/<year>.bin`, Float32 returns for the universe, about 3,000 × 252 × 4 bytes ≈ 3 MB) that the factor
engine and the risk model read in one request.
- **Source, in order:** the licensed EOD vendor the owner chooses (open question 1), then the existing
  `market/data.ts` chain for the beta (FMP, then Nasdaq). The Nasdaq API is for personal use; in the beta the
  universe is capped at the 1,000 largest names, refreshed nightly with one short call per symbol, and
  `MARKET_BACKUP=off` turns it off.
- **Corporate actions:** splits from the vendor checked against `edgar/splits.ts` (the cover-page share count
  jump); dividends for total return; ticker changes from `successor`.
- **Raw prices are never shown to users from this store** unless the vendor's display licence covers it; the
  store feeds analytics (factor returns, risk, signals), which are derived data.

**Fundamentals (`pit/fundamentals.ts`).** For each company and concept, every value with its `knownAt`.
- **Bulk history:** the SEC Financial Statement Data Sets (quarterly zips since 2009; `sub.txt` carries each
  filing's `filed` date and `accepted` timestamp, `num.txt` the values) *(prior knowledge for the field names;
  verify against a downloaded file)*. Public domain.
- **Current:** `edgar/facts.ts` company facts, which carry `filed` but not the acceptance time; the acceptance
  time comes from the submissions index.
- `asOf(cik, concept, at)` returns the latest value whose `knownAt <= at`, never a later restatement.
  `knownAt` = acceptance time, rounded up to the next trading day's open if after 4 pm New York time.
- Shares outstanding: `dei:EntityCommonStockSharesOutstanding` with its own `knownAt`, for point-in-time market
  capitalisation.

**Trading calendar (`pit/calendar.ts`).** NYSE sessions and early closes, generated by rule with a list of
exceptions (as `copytrade/markethours.ts` does), with tests for each holiday rule.

**Jobs.** A nightly quant pass (Inngest `quant/nightly`, triggered by the existing cron): new bars for the
universe, new filings' facts, then QF4 and the signal producers. A one-off backfill script
`scripts/quant-backfill.ts` (prices from 2005, FSDS from 2009), run by an administrator with a spend cap like
Edge's backfill.

**Tests.** `asOf` never returns a value filed after `at` (fixtures with a restatement); calendar rules; panel
encode/decode; split adjustment against a fixture with a known split.

### QF4. The factor-returns engine

**Two tiers, both shown with their source.**

1. **Reference factors.** Kenneth French's daily and monthly research factors (Mkt-RF, SMB, HML, RMW, CMA, the
   risk-free rate, momentum, short- and long-term reversal) and industry portfolios. `src/lib/edge/scen/data.ts`
   already downloads and unzips two of his files; `factors/french.ts` generalises it. They are built from CRSP and
   Compustat and are the academic standard, but they update about monthly with a lag, and his site posts no
   licence terms (open question 3).
2. **YouBank factors (`factors/engine.ts`)**, built nightly from QF3, so they are current, point in time and
   fully documented:
   - **Universe:** US common stocks in `quant_universe`, price at least $5, the largest 1,000 (beta) or 3,000
     (with a licensed vendor) by point-in-time market cap at each monthly rebalance.
   - **Characteristics** (each with `knownAt` lag): value = book-to-market and earnings yield; momentum = return
     from t−12 to t−1 months; profitability = gross profit over assets (Novy-Marx 2013); investment = asset growth;
     low volatility = 252-day volatility, and beta for betting-against-beta; size = log market cap; short-term
     reversal = last month's return.
   - **Construction:** Fama-French style 2×3 sorts (size by characteristic terciles), value-weighted, rebalanced
     monthly (June for value, as Fama and French, with a monthly variant), daily returns by holding the legs.
   - **A cross-sectional risk model** from the same data each day: rₙ = Σₖ Xₙₖ·fₖ + industry dummies + εₙ,
     weighted least squares by √(market cap), with standardised characteristic exposures. Its factor returns and
     specific variances feed Q2.
   - **Validation, shown on the factor page:** monthly correlation of each YouBank factor with French's version
     over the overlapping years (target at least 0.9 for market, size, value and momentum, 0.8 for the others);
     the gap is shown, not hidden. `scripts/eval-factors.ts` runs it.
3. **Crowding (`factors/crowding.ts`)**, three measures per factor, each as a percentile of its own history:
   - **Valuation spread:** the long leg's book-to-market over the short leg's (AQR's measure).
   - **Comovement:** average pairwise correlation of the long leg's residual returns over 52 weeks ("comomentum",
     Lou and Polk) *(prior knowledge)*.
   - **Ownership concentration:** the share of the long leg's market value held by 13F filers that YouBank
     classifies as hedge funds (from the copy-trading 13F store), against its history.

Output: `quant_factor_returns` (YouBank factors and the French ones, `universe` and `version` keyed) and an R2
object of daily exposures per stock for the risk model.

### QF5. The event-study engine

`events/study.ts`, pure: given events `{ symbol, knownAt }` and the QF3 panel, abnormal returns in windows
(day 0 to +1, +2 to +20, +2 to +60, +2 to +125 trading days), where day 0 is the first session the event could be
traded on. Abnormal return against the market model (estimation window −250 to −30) and against the five
French factors plus momentum; cumulative abnormal returns with stationary-bootstrap intervals; hit rate against
the unconditional rate for the same stocks; splits by era (before and after a regime change such as 2006, or the
2024 13D rule), size tercile and liquidity. Results are cached per event definition and version in R2.

Every base rate a feature shows comes from here, so they are computed one way, with one set of caveats.

### Conventions every feature follows

- **Terminal.** A new `FunctionGroup` `"quant"` in `src/lib/functions.ts`; codes in the feature list. Before
  adding a code, check it against SEC's `company_tickers.json` (the parser already handles "TICKER CODE" when a
  code is also a ticker, as PG and GEO do). `SIZE` and `SLV` are tickers, so they are not used.
- **Pages.** `/app/quant` (the Quant hub) with a tab per feature, and on phones a card stack (section 6,
  each feature's UI). Navigation entry in `src/lib/nav.ts` after Fund copies.
- **AI tools.** New tools in `src/lib/ai/tools.ts` (`quant_factor_exposures`, `quant_risk`, `quant_backtest_check`,
  `quant_signals`, `quant_event_base_rates`, `quant_costs`); each returns numbers with sources and the wording
  rules in `quant/words.ts` go into the tool descriptions, so the assistant does not turn statistics into advice.
- **Edge canvas.** Three value kinds in `canvas/catalog.ts`: `portfolio` (holdings and weights), `quantsignals`
  and `target`; nodes `quant.factors`, `quant.risk`, `quant.integrity`, `quant.events`, `quant.insiders`, with
  `evidenceOf`, `rowsOf`, `metricOf` and `kindOfValue` branches in `values.ts`.
- **Feed cards.** New `edge_detections.kind` values `quant.insider_cluster`, `quant.activist`, `quant.filing_change`,
  `quant.regime`, `quant.crowding`, with `noveltyOf`, `isBig` and a card in `Cards.tsx`, shown to people who
  watch the company or hold it.
- **Forecast ledger.** New kinds `quant_event` (signal outcome), `quant_regime`, `drill` (Q14, owner-scoped) and
  `user_call` (a person's own forecast). New rule `{ type: "return", symbol, benchmark, from, to, op, value }`,
  resolved from QF3 bars by `resolveDue()`.
- **Studio.** "Send to Studio" on Q1, Q2 and Q3 results writes a linked block (as Edge's canvas outputs do), and
  `src/lib/studio/inference-tools.ts` gains `quant_factor_exposures` and `quant_stress` for the Studio agent.
- **Premium.** Ids `quant.<name>` in a new `src/lib/billing/features/quant.ts` with `costPerUseUsd` and `perUse`;
  a new `FeatureArea` `"quant"`. Background passes never spend premium money.
- **Words.** All performance, risk and disclaimer text lives in `src/lib/quant/words.ts` (section 9), as
  `copytrade/disclosures.ts` does for copies.
- **Tests.** Pure functions in `scripts/test-quant.ts` (no network, no database; fixtures under
  `scripts/fixtures/quant/`), run like `scripts/test-copytrade.ts`. Quality checks that need the network go in
  `scripts/eval-factors.ts` (YouBank factors against French's) and `scripts/eval-quant-signals.ts` (each signal
  producer's base rates and calibration on held-out years). `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build`
  pass before each feature is called done.

---

## 5. The contract with the algo engine: `QuantSignal` and `TargetPortfolio`

### 5.1 Who does what

| Quant Edge (this work) | Algo engine (`claude/new-session-6k1ff0-algo`) |
|---|---|
| Produces `QuantSignal`s (per instrument, timestamped, calibrated, with evidence) | Strategies read signals through `signalsAsOf()` (backtests) or `latestSignals()` (live) |
| Produces `TargetPortfolio`s (sleeves, risk-parity mixes, 13F clones) | Rebalances an account toward a target: order generation, approval, routing, fills |
| Produces a `RiskBudget` recommendation (Q4) | Enforces risk controls, using the budget as one input among its own |
| Estimates costs before a trade (`estimateCost`, Q5) | Chooses order types and schedules; records fills, which Q5 reads |
| Judges backtests (`integrityCheck`, Q3) and keeps the trial count (`quant_trials`) | Logs every backtest it runs as a trial and shows the integrity badge before a strategy may go live |

Neither side imports the other's internals; they meet only at `contracts.ts`, the functions in QF1, the Inngest
events, and the routes.

### 5.2 The types (`src/lib/quant/contracts.ts`)

```ts
export const CONTRACT_VERSION = "quant/1" as const;

/** What a signal or a target refers to. Equities by ticker plus CIK; options carry their terms. */
export type Instrument = {
  symbol: string;                                   // "AAPL", "BRK-B" (dots become dashes, as copytrade does)
  assetClass: "equity" | "etf" | "option" | "crypto" | "future" | "fx";
  cik?: string; figi?: string; currency: string;    // "USD"
  option?: { underlying: string; expiry: string; strike: number; right: "C" | "P" };
};

/** Where a number came from, for the "Models and sources" panel and the audit trail. */
export type Evidence = { label: string; url: string; source: string; licence: string; knownAt: string; retrievedAt: string };

/** How trustworthy a producer's numbers are, measured, not asserted. */
export type Calibration = {
  method: "isotonic" | "platt" | "venn-abers" | "conformal" | "event-study" | "none";
  n: number;                                        // resolved examples behind it
  brierSkill?: number | null;                       // against the base rate, when probabilities are scored
  falseAlarmRate?: number | null;                   // per instrument-year, for detectors
  trackKind?: string;                               // edge_forecasts.kind for the live track record
};

/** Q3's verdict on whatever produced a number. */
export type IntegrityReport = {
  pointInTime: boolean;                             // every input carried knownAt and was used only after it
  survivorshipSafe: boolean;                        // universe included delisted securities
  trials: number; effectiveTrials: number;          // from quant_trials, not typed in
  sharpe: number; psr: number; dsr: number | null;  // annualised Sharpe; probabilities 0..1
  pbo: number | null; minTrlYears: number | null;
  oosSharpe: number | null;                         // walk-forward out-of-sample
  costBpsAssumed: number;                           // round-trip cost used
  llmInputs: boolean;                               // any LLM-derived input (look-ahead risk before the model's cutoff)
  grade: "A" | "B" | "C" | "D" | "F";               // rules in Q3
  warnings: string[]; checkedAt: string; version: string;
};

export type QuantSignal = {
  contract: typeof CONTRACT_VERSION;
  id: string;                                       // deterministic (QF1)
  producer: string; producerVersion: string;        // "quant.insider_cluster", "2026-10-20.1"
  instrument: Instrument;
  asOf: string;                                     // ISO time every input was public (max knownAt); usable from here
  computedAt: string; reconstructed: boolean;       // backfilled from archives rather than computed live
  validUntil: string;                               // stop using after this
  horizonDays: number;                              // trading days the statement is about
  kind: "score" | "expected_return" | "probability" | "event";
  /** score: cross-sectional z-score clipped to [-3, 3], sign = direction relative to the universe. */
  score?: number;
  /** expected_return: excess return over `benchmark` across the horizon, with an interval. */
  expectedReturn?: { mean: number; low: number; high: number; level: number; benchmark: string; net: boolean };
  /** probability: of a stated, machine-checkable question (also logged to the forecast ledger). */
  probability?: { p: number; low: number; high: number; baseRate: number; question: string };
  /** event: something happened (a cluster buy, a 13D), with the base rate of what followed similar events. */
  event?: { type: string; occurredAt: string; baseRate: { car: number; low: number; high: number; hitRate: number; unconditionalHitRate: number; n: number; window: string; era: string } };
  universe: string;                                 // the set the score is relative to: "us-top1000"
  explain: string;                                  // one sentence, factual, from quant/words.ts templates; never "buy" or "sell"
  evidence: Evidence[];
  calibration: Calibration;
  integrity?: IntegrityReport;                      // of the producer's historical backtest, when it has one
  costs?: CostEstimate;                             // estimated round trip at a reference size
  forecastId?: number | null;                       // edge_forecasts row when probability is present
  tags?: string[];
};

export type CostEstimate = {
  spreadBps: number; impactBps: number; commissionBps: number; borrowBpsYear?: number | null;
  totalRoundTripBps: number; referenceNotionalUsd: number; adv20Usd: number; model: string; asOf: string;
};

export type TargetWeight = {
  instrument: Instrument;
  weight: number;                                   // fraction of NAV; negative = short
  reason?: string;                                  // factual: "top decile momentum", "risk-parity share"
  signalIds?: string[];
  bounds?: { min: number; max: number };            // what the producer would accept when rounding to shares
};

export type TargetPortfolio = {
  contract: typeof CONTRACT_VERSION;
  key: string; version: number;                     // quant_targets
  producer: string; producerVersion: string;        // "quant.sleeve", "copy.13f", "quant.riskparity"
  ownerId: string | null;                           // null = impersonal definition, same for everyone
  name: string;
  asOf: string; validUntil: string;
  weights: TargetWeight[];
  cashWeight: number;                               // 1 − Σ weights; short financing and margin are the engine's concern
  constraints: {
    longOnly: boolean; maxWeight: number; maxNames?: number; maxGross: number; netRange: [number, number];
    sectorCap?: number; minAdvUsd?: number; minPrice?: number; excluded: string[]; maxTurnoverPerRebalance?: number;
  };
  rebalance: {
    policy: "on_change" | "calendar" | "drift";
    cadence?: "daily" | "weekly" | "monthly" | "quarterly";
    driftBand?: number;                             // rebalance when any weight drifts this far (absolute)
    window: "open" | "close" | "vwap_day" | "any";  // when the producer's backtest assumed trading
    notBefore: string;                              // earliest time trading on this version is consistent with the backtest
  };
  sizing: { method: "fixed" | "equal" | "vol_target" | "risk_parity" | "kelly_fraction" | "mean_variance"; kellyFraction?: number; volTarget?: number };
  risk: { exAnteVol: number; beta?: number; factorExposures?: Record<string, number>; var95_1d?: number; model: string };
  integrity?: IntegrityReport;
  disclosures: string[];                            // keys of DISCLOSURES in quant/words.ts ("hypothetical", "not_advice", "timing_13f")
  provenance: { signalIds: string[]; inputsHash: string; recipe: string };
};

/** Q4's output: a recommendation the algo engine's own risk controls may adopt or tighten, never loosen. */
export type RiskBudget = {
  ownerId: string; accountRef: string | null; asOf: string;
  maxPositionWeight: number; maxGross: number; maxDailyLossPct: number;
  volTarget: number | null;                         // annualised, for scaling
  kellyFraction: number;                            // of full Kelly, after the uncertainty haircut
  drawdownRules: { fromPeakPct: number; action: "halve" | "flatten" | "pause_new" | "notify" }[];
  basis: string;                                    // how it was derived, in words
};

/** A person's execution, for Q5. */
export type Fill = {
  source: "csv" | "snaptrade" | "algo"; accountRef: string; broker?: string; extId: string;
  symbol: string; side: "buy" | "sell" | "short" | "cover"; qty: number; price: number;
  executedAt: string; placedAt?: string; orderType?: "market" | "limit" | "stop" | "other"; limitPrice?: number; fees?: number;
};
```

### 5.3 Rules both sides keep

1. **Time.** A backtest uses a signal only from `asOf`, and trades on it no earlier than the next session open
   after `asOf` (or `rebalance.notBefore` for targets). A live strategy uses it only before `validUntil`.
2. **Reconstructed signals** (`reconstructed: true`) are fine for research, but Q3 grades a strategy that uses
   them at most "B" until it has a live record of computed-at-the-time signals.
3. **Every backtest is a trial.** The algo engine calls `logTrial({ family, params, returns })` for each run;
   `integrityCheck(family)` reads them all.
4. **Versions.** A producer changing its method bumps `producerVersion`; old signals stay readable. A breaking
   change to the contract becomes `quant/2`, and both are served for one release.
5. **No advice in payloads.** `explain` and `reason` are factual templates from `words.ts`. Strategies may
   show them; they must not rewrite them into recommendations.
6. **Gate before live.** The algo engine refuses to run a strategy live (not paper) whose `IntegrityReport.grade`
   is D or F unless the person types an override that is logged in its audit trail. This is the single most
   useful thing Quant Edge gives the trading work.

### 5.4 Examples

An insider-cluster signal (Q7):
```json
{
  "contract": "quant/1", "id": "9f1c…", "producer": "quant.insider_cluster", "producerVersion": "2026-10-20.1",
  "instrument": { "symbol": "XYZ", "assetClass": "equity", "cik": "0000123456", "currency": "USD" },
  "asOf": "2026-10-14T20:41:07Z", "computedAt": "2026-10-14T21:05:00Z", "reconstructed": false,
  "validUntil": "2027-04-14T20:00:00Z", "horizonDays": 125, "kind": "event",
  "event": { "type": "cluster_buy", "occurredAt": "2026-10-09",
             "baseRate": { "car": 0.021, "low": 0.008, "high": 0.034, "hitRate": 0.56, "unconditionalHitRate": 0.51,
                           "n": 1840, "window": "+2..+125", "era": "2015-2026" } },
  "universe": "us-all", "explain": "Three officers or directors bought shares on the open market within 30 days; none trades routinely.",
  "evidence": [{ "label": "Form 4, Jane Doe (CFO)", "url": "https://www.sec.gov/Archives/edgar/data/…", "source": "SEC EDGAR", "licence": "public domain", "knownAt": "2026-10-14T20:41:07Z", "retrievedAt": "2026-10-14T21:02:11Z" }],
  "calibration": { "method": "event-study", "n": 1840, "trackKind": "quant_event" }
}
```

A sleeve target (Q12) would carry `producer: "quant.sleeve"`, `ownerId` of the person whose rules built it,
`weights` for 40 names, `rebalance: { policy: "calendar", cadence: "monthly", window: "close", notBefore: … }`,
`sizing: { method: "equal" }`, its `IntegrityReport` from Q3, and `disclosures: ["hypothetical", "not_advice"]`.

---
## 6. The features

Each feature follows the same outline: pitch and lineage, the user problem, how it works (data, method,
uncertainty, audit), how it plugs into YouBank, UI (desktop and phone), free and premium, tests, size and risks.
Features in this round's set (Q1–Q5, Q7, Q14) are specified in full; the others are specified enough to plan,
and their details are settled when they are scheduled.

### Q1. Factor Lab (`FACT`)

**Pitch and lineage.** Every pod shop separates a manager's stock picking from the factor bets they carry by
accident, and pays only for the first. Two Sigma built Venn to give allocators a factor lens on any portfolio
*(prior knowledge)*; Barra and Axioma risk models are the industry's version. Factor Lab gives a regular investor
the same lens: what your portfolio really owns, and whether what you think is skill is a factor you could buy for
0.15% a year. The evidence that factors are real and replicable is strong ([Jensen, Kelly and Pedersen
2023](https://nber.org/system/files/working_papers/w28432/w28432.pdf)); the evidence that timing them is hard is
also strong ([Asness et al. 2017](https://www.cxoadvisory.com/value-premium/valuation-based-factor-timing/)), so the
lab shows exposures and crowding, not timing calls.

**The user problem.** "I own 15 stocks I picked carefully. Am I diversified? Am I just long tech momentum? When
my portfolio beat the market last year, was that me?"

**How it works.**

*Data.*

| Input | Source | Licence and cost |
|---|---|---|
| Holdings | Typed (`FACT AAPL 40 MSFT 30 KO 30`), CSV, a copy portfolio or sleeve, the person's connected broker account (SnapTrade holdings today; the algo branch's brokers when merged) | The person's own data |
| Daily prices | QF3 (`market/data.ts` chain) | As QF3; beta on FMP and Nasdaq |
| Factor returns | QF4: French reference factors and YouBank factors | French: no posted terms (open question 3); YouBank factors: our own derived data |
| Stock exposures | QF4 cross-sectional model (characteristics from SEC XBRL, point in time) | Public domain filings |
| ETF look-through | SEC Form N-PORT holdings (quarterly, public for the last month of each quarter, about 60 days' lag) *(prior knowledge; verify the public data set's layout)* | Public domain |

*Method.*
1. **Returns-based exposures:** regress the portfolio's daily excess returns at today's weights on the factor
   returns over one and three years, with Newey-West standard errors, plus a 126-day rolling window for the
   chart. Report each beta with its 90% interval, R² ("factors explain 78% of your daily moves") and alpha with its
   t-statistic, and say plainly that an alpha with t below 2 is indistinguishable from luck.
2. **Holdings-based exposures:** the weighted average of each holding's standardised exposures from QF4, which
   reacts at once to a change in holdings. Where the two methods disagree by more than their intervals, the lab
   says so ("your recent trades moved you into value; the 1-year regression has not caught up").
3. **Risk split:** share of variance from factors, industries and stock-specific risk, using QF4's model (Q2 shows
   the detail).
4. **Factor-proxy tracking:** the mix of broad factor ETFs (market, small cap, value, growth, momentum, quality,
   minimum volatility) that tracks the portfolio's past returns most closely by constrained least squares, with
   its tracking error. Worded as analysis: "Over three years, 82% of this portfolio's daily variance is tracked
   by this mix of index funds", never "replace your portfolio with".
5. **Crowding:** QF4's three crowding percentiles for each factor; a flag when the portfolio's exposure to a factor
   is above 0.3 and that factor's crowding is above its 90th percentile, with the August 2007 quant quake as the
   reason the flag exists *(prior knowledge: Khandani and Lo)*.
6. **Factor dashboard:** each factor's return (month, year to date, one, five and twenty years), drawdown from
   peak, volatility, correlations, and the YouBank-versus-French validation figure.

*Uncertainty and calibration.* Intervals on every exposure; the returns-based method needs 120 days of common
history (fewer gives "not enough history"); holdings not in the factor universe (crypto, foreign listings,
small caps under the cut) are shown as "outside the model" with their weight, never silently dropped.

*Audit trail.* Each run is saved to `quant_runs` (inputs, factor version, universe version, dates) and is
reproducible from them; "Models and sources" lists every source with retrieval time.

**In YouBank.** Terminal `FACT` (portfolio) and `<TICKER> FACT` (one stock's loadings and its factor-adjusted
return); a factor-exposure strip on `PORT`; the `quant.factors` canvas node (input `portfolio`, output `table`);
the AI tool `quant_factor_exposures`; "Send to Studio" as a live table; a feed card when a held stock's crowding
flag turns on. Copy portfolios (`/app/copy`) get a "factor exposures" panel for the fund being copied ("this 13F
clone is mostly value and size"), which is one of the most useful things to know before copying a fund.

**UI.** Desktop: exposures as a horizontal bar chart with interval whiskers, centred on zero; beside it the risk
split as one stacked bar; below, the factor dashboard as a table with sparklines. Phone: three cards in a stack:
"What you own" (the three largest exposures in words: "Mostly large-cap growth and momentum"), "Where your risk
comes from" (one stacked bar), and "Crowding" (only when a flag is on); tap for the full table. Every number has
the interval on tap.

**Free and premium.**

| | Free | Pro (`quant.factorlab.pro`) |
|---|---|---|
| Holdings | Up to 30, typed or CSV | Up to 200; synced from a connected broker; ETF look-through |
| History | 3 years | 20 years (French factors) and full YouBank-factor history |
| Factors | Market, size, value, momentum, quality, low volatility, investment | Plus industry factors, reversal, custom factor from a sleeve's rules |
| Cost to us per use | under $0.001 (CPU) | under $0.001; broker sync is already paid through SnapTrade's per-user fee |

**Tests.** Recover known betas from a synthetic portfolio built as 0.8·market + 0.5·value + noise (within the
90% interval in at least 85 of 100 seeds); holdings-based exposure of a single stock equals its model exposure;
Newey-West against a hand-computed fixture; tracking regression respects weights summing to 1 and no shorts;
`scripts/eval-factors.ts` (network) for the French correlations.

**Size and risks.** M (with QF4 being most of the work). Risks: people reading "alpha" as skill (always show the
t-statistic and the luck sentence); the YouBank factors differing from French's (show the correlation); factor
ETF names reading as product recommendations (list several per factor, label them "index funds that track this
factor", no affiliate links).

### Q2. Risk Model and Stress Tests (`PORT`, extended)

**Pitch and lineage.** Central risk teams at Citadel, Millennium and Point72 see every book through a factor risk
model, stress it daily against history and hypotheticals, and cut what they cannot explain. YouBank's `PORT`
already shows risk shares and a bootstrap of outcomes; this extends it into a real risk model with stress tests,
built on Edge's scenario engine (`src/lib/edge/scen/`), which already does GJR-GARCH filtered historical
simulation, crisis replays and entropy pooling.

**The user problem.** "What happens to my money in a crash like 2008 or 2022? Where does my risk actually come
from? How bad can a normal bad month get, and is that estimate any good?"

**How it works.**

*Data.* Holdings as Q1; prices and factor returns from QF3 and QF4; Treasury yields (public domain) for the rates
factor; crisis windows from `scen/drivers.ts` `REPLAYS`.

*Method.*
1. **Covariance.** For stocks in the factor universe: Σ = B·F·Bᵀ + D (QF4 exposures B, factor covariance F
   estimated with exponential weights (half-life 90 days) and Newey-West, specific variances D shrunk toward
   their industry median). For anything outside it (ETFs, crypto, small caps): Ledoit-Wolf shrinkage of the sample
   covariance, combined with the factor block.
2. **Risk decomposition.** Total volatility; each holding's and each factor's contribution
   (wᵢ(Σw)ᵢ / wᵀΣw, as `PORT` does now); "your three largest risks" in words.
3. **Value at risk and expected shortfall, backtested.** One-day and ten-day 95% and 99% VaR and ES by filtered
   historical simulation (EWMA-scaled historical days) and by Cornish-Fisher; the portfolio's own exceptions over
   the last two years with Kupiec's and Christoffersen's tests. If the model fails its own backtest, the screen
   says so and widens the figures by the ratio of observed to expected exceptions.
4. **Historical stress.** Replay 2008 (September to November), March 2020, 2022 (rates shock), the 2000–2002
   technology bust and the August 2007 quant quake. For holdings that did not trade then, losses come through
   their factor exposures plus resampled specific moves (as `scen/market.ts` does), and the screen says which
   holdings were proxied.
5. **Hypothetical shocks.** "Market −20%, 10-year +1 point, momentum −15%": the stated factors are fixed, the
   others filled conditionally (`conditionalFill` in `scen/views.ts`), and the loss distribution comes from paths,
   not one number.
6. **Reverse stress.** The gentlest scenario (nearest to normal, by entropy pooling, `scen/reverse.ts`) that
   loses a chosen amount, say 25%.
7. **Liquidity.** Days to sell each position at 20% of average daily volume, and a flag above five days.
8. **Drawdown odds.** From 2,000 bootstrap years of the portfolio's own daily returns (as `PORT` now), the
   probability of a 10%, 20% and 30% fall from peak within a year.

*Uncertainty.* VaR with its backtest; stress losses as ranges across paths (5th–95th percentile); every
synthetic result labelled with its recipe and seed (Edge's convention).

*Audit.* `quant_runs` with model version, factor version and seed.

**In YouBank.** `PORT` gains tabs Risk, Factors (Q1), Stress and Liquidity; `PORT STRESS 2008` and
`PORT SHOCK market -20` as arguments; `SIM` remains the single-stock simulator; canvas node `quant.risk`; AI tool
`quant_risk`; Studio's agent gets `quant_stress`; a weekly risk card in the feed for people with a connected
account ("your 99% one-day VaR rose from 3.1% to 4.4% this week, mostly from NVDA").

**UI.** Desktop: a risk-contribution waterfall, the VaR panel with its exception chart, stress results as a
horizontal bar per scenario with the path range as a whisker, and the reverse-stress narrative. Phone: one
summary card ("18% annual volatility; a 2008 replay loses 38% (31–45%); 62% of risk from three names"), each
scenario a swipe card, the liquidity flag only when it applies.

**Free and premium.**

| | Free | Pro (`quant.risk.pro`) |
|---|---|---|
| Holdings | 30 | 200, synced from a broker |
| Stress | The five historical replays, two hypothetical shocks | Unlimited hypotheticals, reverse stress, 10,000 paths |
| VaR backtest | One-day 95% | All horizons and levels |
| Cost to us | under $0.001 | about $0.002 (10,000 paths of CPU) |

**Tests.** Factor covariance reproduces a known simulated covariance within tolerance; Ledoit-Wolf against a
published small example; risk contributions sum to total variance; VaR exception counts on a simulated
Student-t series match the theoretical rate; a replay of a portfolio of only SPY in 2008 equals SPY's actual
loss over the window.

**Size and risks.** M. Risks: false precision (show ranges and the backtest); proxied holdings (label them); the
temptation to word stress results as advice ("you should hedge") — the words file forbids it.

### Q3. Backtest Integrity Checker (`BTX`)

**Pitch and lineage.** The single habit that most separates professional quant research from retail backtesting
is suspicion of one's own results. López de Prado's work (*Advances in Financial Machine Learning*; the deflated
Sharpe ratio; the probability of backtest overfitting) and Harvey, Liu and Zhu's multiple-testing hurdle are how
the industry formalised it; Renaissance's emphasis on clean data and AQR's insistence on out-of-sample evidence
are the culture. With AI agents now able to generate and test hundreds of strategies an hour (the algo branch,
Webull's MCP), the cost of overfitting has never been lower. This is the feature that makes everything else on
the trading side honest.

**The user problem.** "This strategy (mine, my agent's, or one I saw online) shows a Sharpe of 2.1. Is it real?
Did I fool myself by trying fifty versions? Would it survive costs? How long a live record before I should trust
it?"

**How it works.**

*Inputs, any of:*
- An algo-engine strategy family (all its trials from `quant_trials`, with signal reads logged for the
  point-in-time audit);
- a sleeve (Q12) or a copy-trading clone backtest (`copytrade/backtest.ts`: the existing 13F clones get graded
  too);
- an uploaded CSV of daily returns, optionally with a matrix of every variant tried;
- **"Check a claim"**: typed numbers only (Sharpe, years, frequency, skew, kurtosis, how many variants were tried,
  a guess if unknown) for a strategy seen online. This mode needs no data and is free for everyone.

*Checks, in four groups.*
1. **Statistics.** Annualised Sharpe with a stationary-bootstrap 90% interval; PSR against zero; DSR with N from
   the trial log (both raw and `effectiveTrials`); minimum track record length; PBO by CSCV when there are at
   least two trials and at least 16 blocks of 20 observations; the haircut Sharpe and the t-above-3 rule; White's
   Reality Check p-value across trials by stationary bootstrap *(prior knowledge: White 2000)*.
2. **Data hygiene** (strategies that run on YouBank data, where every read is logged with its `knownAt` and the
   time it was used):
   - **look-ahead:** any read used before its `knownAt` fails the check, with the offending read listed;
   - **same-bar execution:** a signal computed from a day's close and traded at that same close is flagged (the
     most common retail backtest error);
   - **survivorship:** whether the universe included securities that later delisted, from `quant_universe`;
   - **restatements:** fundamentals read through `asOf` or through "latest" (the latter flagged);
   - **LLM inputs:** any signal that used a language model on text from before that model's training cutoff is
     flagged as look-ahead-exposed ([Glasserman and Lin](https://arxiv.org/abs/2309.17322)).
3. **Implementation.** Sharpe at 0, 10, 25 and 50 basis points round trip, and the breakeven cost; turnover;
   capacity (largest position as a share of average daily volume at a stated account size; above 5% flagged);
   borrow for shorts (assumed fee shown).
4. **Robustness.** Year-by-year Sharpe; Sharpe by Q11 regime; neighbourhood stability when the trials form a
   parameter grid (a heat map; a lone peak among weak neighbours is the picture of overfitting); a placebo run on
   the signal shuffled in time within each stock (the distribution of Sharpe under no skill); the factor-adjusted
   alpha (Q1's factors) with its t-statistic ("0.9 beta to momentum; alpha t = 0.8").

*Grade.* A–F from explicit rules, shown with the rule that set it:

| Grade | All of |
|---|---|
| A | Point in time and survivorship-safe; DSR ≥ 0.95; PBO ≤ 0.2 (or one pre-registered trial); breakeven cost ≥ 3× assumed; out-of-sample Sharpe ≥ half of in-sample; years ≥ MinTRL |
| B | DSR ≥ 0.90; PBO ≤ 0.35; breakeven ≥ 2× assumed; no hygiene failure |
| C | DSR ≥ 0.70; PBO ≤ 0.5; no hygiene failure |
| D | DSR < 0.70 or PBO > 0.5 |
| F | Any look-ahead or same-bar failure, or years < MinTRL / 2 |

Reconstructed signals cap the grade at B (section 5.3). The grade, the warnings and "what would change the
verdict" ("3.4 more years of live record at this Sharpe", "costs below 12 bp") are the output, as an
`IntegrityReport`.

*Live follow-up.* When a graded strategy runs on paper or live in the algo engine, Q3 logs to the forecast ledger
"realised Sharpe over the next six months is above zero" with the probability implied by the backtest's
bootstrap distribution, and resolves it from the engine's returns. Over time this shows, publicly in the Track
record, how much backtests on YouBank overstate live results: a number nobody else publishes.

*Audit.* Each report is a `quant_runs` row with every input hashed; the trial list is append-only.

**In YouBank.** Terminal `BTX` (with an argument for a strategy or sleeve id, or the "check a claim" form); a
badge on every backtest anywhere in YouBank (copy clones, sleeves, the algo engine's strategies); the AI tool
`quant_backtest_check`, which the assistant must call before describing any backtest's performance; the gate in
section 5.3 rule 6; a canvas node `quant.integrity`.

**UI.** Desktop: the grade as a large letter with the deciding rule beside it; four panels (statistics, hygiene,
implementation, robustness), each a checklist of pass, warn or fail with one sentence and an expandable chart;
the Sharpe-versus-trials curve ("the best of N random strategies would show this Sharpe by chance"). Phone: the
grade card, the three most important warnings as cards, "what would change the verdict" at the bottom. "Check a
claim" is a single form that works well on a phone, built to be shared: "a Sharpe of 2 over 18 months, best of
about 30 variants, has a deflated Sharpe of 0.41".

**Free and premium.**

| | Free | Pro (`quant.integrity.pro`) |
|---|---|---|
| Check a claim | Yes | Yes |
| Uploaded returns | One series; PSR, DSR, MinTRL, bootstrap, costs | Trial matrices up to 500 variants; PBO; Reality Check; placebo |
| Algo strategies and sleeves | Grade and top warnings | Full report, neighbourhood maps, live follow-up |
| Cost to us | ~0 | about $0.002 (PBO with 12,870 splits on 500 trials, CPU); ML service above 500 trials, about $0.01 |

**Tests.** On 1,000 matrices of pure-noise strategies (N = 50), the best one's DSR exceeds 0.95 about 5% of the
time and PBO averages about 0.5; with one genuinely skilled column added (Sharpe 1.5), PBO falls below 0.2 in most
seeds; PSR and MinTRL against values computed by hand from the formulas; the same-bar detector on a fixture
strategy that trades on its own close; the look-ahead detector on a read log with one early read; the
survivorship check on a universe fixture with delisted names.

**Size and risks.** M. Risks: false comfort from an A (the report says "an A means fewer reasons to doubt it, not
a promise"); people gaming the trial count by starting new families (families are keyed by strategy code hash
and owner, and a near-duplicate is merged); compute on very large matrices (offload to the ML service).

### Q4. Sizing and Drawdown Governor (`KELLY`)

**Pitch and lineage.** Kelly sizing is the professional answer to "how much", from Thorp's blackjack and fund
years to SIG's and Jane Street's betting culture *(prior knowledge)*. The pod shops add the other half: hard
drawdown rules written down in advance (lose 5% from peak, lose half your capital; around 7.5%, out — [press
reports](https://www.efinancialcareers.com/news/pratik-madhvani-glen-scheinberg)). Retail investors mostly have
neither: in Haghani and Dewey's coin experiment, finance-literate players with a known 60% edge went bust about
30% of the time ([SSRN 2856963](https://papers.ssrn.com/abstract=2856963)).

**The user problem.** "How big should this position, or this strategy, be? What happens to me if I'm wrong about
my edge? When should I cut back?"

**How it works.**
1. **Kelly with the uncertainty left in.**
   - Discrete: f* = p − (1−p)/b. Continuous: f* = (μ − r)/σ². Multi-asset: f* = Σ⁻¹(μ − r) with Q2's Σ.
   - Edge comes from the person (a range, not a point) or from Q3's report (Sharpe with its bootstrap interval).
   - The screen shows the growth-optimal fraction for the central estimate, for the low end of the range, and
     the fraction that maximises expected log growth averaged over the uncertainty (Monte Carlo over the edge's
     distribution). With realistic uncertainty this is usually a small fraction of naive Kelly, and the screen
     says why.
   - Growth at fraction c of full Kelly is c(2 − c) of the maximum: half Kelly keeps 75% of the growth with half
     the volatility *(prior knowledge, standard result)*.
2. **Drawdown odds.** P(ever falling to x of peak) = x^(2/c − 1) under the model; plus a bootstrap of the
   strategy's own returns for one- and three-year maximum drawdown at each fraction, because real returns have
   fat tails. Shown as a table: full Kelly, half, quarter, the person's current size.
3. **Volatility targeting.** Scale = target volatility / forecast volatility (EWMA or GARCH from `inference/stats.ts`),
   capped at 1.5×, with the honest note that it stabilises risk but does not reliably raise returns out of sample
   ([Cederburg et al. 2020](https://www.lehigh.edu/~xuy219/research/COWY.pdf)).
4. **Risk parity.** Equal risk contribution weights for assets the person chooses (Maillard, Roncalli and
   Teiletche 2010 *(prior knowledge)*), with inverse-volatility as the simple version, from Q2's covariance.
5. **Drawdown governor.** Templates the person picks and edits, each simulated on the strategy's (or portfolio's)
   own history to show what it would have cost and saved:
   - **Pod rules:** −5% from peak halves exposure; −7.5% flattens and pauses new risk for ten sessions;
   - **Floor (CPPI, after Grossman and Zhou 1993):** exposure = m × (wealth − floor) / wealth, floor at 80% of peak;
   - **Custom:** levels and actions.
   The simulation shows return given up and drawdown avoided, with a warning when the rule would have sold near
   the bottom and missed the recovery, as stop rules often do.
6. **Output.** A `RiskBudget` (section 5.2) for an account or strategy, saved and sent to the algo engine
   (`quant/riskbudget.updated`), which may adopt it or tighten it, never loosen it.

*Uncertainty.* Every Kelly number appears with the input range that produced it, and the drawdown table states
its model.

*Audit.* Budgets are versioned in `quant_runs` and the algo engine logs which version it enforced.

**In YouBank.** Terminal `KELLY` (the calculator; `KELLY 0.55 1` for a bet, `KELLY strategy 56`); a "Size" step in
the algo engine's strategy setup and in sleeves; the AI tool exposes the calculator only with person-supplied
inputs; Q14's Kelly coin links here.

**UI.** Desktop: inputs on the left (edge as a range slider), outputs on the right (fractions, growth curve
across fractions with the person's current size marked, the drawdown table, the governor simulation). Phone: a
calculator card first; the growth-versus-fraction curve as the one chart; the governor as a card list of rules.

**Free and premium.** All calculators free. Pro (`quant.sizing.pro`): governor simulations on synced accounts and
algo strategies, multi-asset Kelly above five assets, budgets sent to the algo engine. Cost to us ~0.

**Tests.** Closed forms (discrete and continuous Kelly; c(2 − c)); the drawdown formula against a simulation of
GBM at several fractions; ERC weights give equal contributions; the governor simulation on a fixture path with
known drawdowns triggers on the right days.

**Size and risks.** S. Risks: a calculator that looks like personal advice. It never takes a position size from
the person's account balance without the person entering the edge themselves, and it says "for the inputs you
entered" on every output. Kelly with an overestimated edge is dangerous; the default view leads with the
uncertainty-adjusted fraction and quarter Kelly, not full Kelly.

### Q5. Execution Cost Analyzer (`TCA`)

**Pitch and lineage.** Citadel Securities, Virtu and the other wholesalers earn their spread from retail order
flow, and brokers are paid for sending it: $1.19bn in Q1 2025 alone, most of it for options
([Global Trading](https://www.globaltrading.net/?p=38554)). The same market order costs 0.07% to 0.46% round trip
depending on the broker, and payment for order flow does not explain the difference
([Schwarz, Barber, Huang, Jorion and Odean, JF 2025](https://ideas.repec.org/a/bla/jfinan/v80y2025i5p2507-2541.html)).
Institutions measure this with transaction cost analysis (implementation shortfall, after Perold 1988 *(prior
knowledge)*). And from 1 August 2026, large retail brokers must publish standardised Rule 605 execution reports
with a summary report (section 2.4), so for the first
time the comparison data is public.

**The user problem.** "What am I actually paying to trade, beyond the zero commission? Is my broker good? Do my
market orders at the open cost me? What will this trade cost before I place it?"

**How it works.**

*Data.*

| Input | Source | Licence and cost |
|---|---|---|
| Your fills | CSV export from the broker (templates for Schwab, Fidelity, Robinhood, Webull, Interactive Brokers, E*TRADE); SnapTrade order history (`recentOrders` covers three days; longer history needs SnapTrade's account activities endpoint, to be verified); the algo engine's fills | The person's own data; stored owner-scoped in `quant_fills`, deletable |
| Daily bars | QF3 | As QF3 |
| One-minute bars (Pro) | A minute-bar source: FMP's intraday endpoints on a higher plan, or Polygon/Massive Stocks Starter (about $29 a month, 15-minute delayed, which is fine for after-the-fact analysis) (prices unverified) | Per open question 1 |
| Rule 605 reports | Each market center's and (from August 2026) each large broker's monthly reports, in the Rule 605 NMS plan's format | Public disclosures; a curated list of report URLs per broker |
| Rule 606 reports | Each broker's quarterly order-routing reports (venues, payment for order flow per 100 shares for S&P 500 stocks, other stocks and options) | Public disclosures |

*Method.*
1. **Per fill, free (daily bars):** slippage against the day's open, close and typical price (H+L+C)/3 (labelled
   "typical price", not VWAP); the share of the day's range at which it filled; market orders at the open and in
   the last minutes flagged.
2. **Per fill, Pro (minute bars):** arrival price = the one-minute bar at `placedAt`; implementation shortfall =
   side × (fill − arrival) / arrival, split into delay (placement to execution) and execution; against the
   interval VWAP from placement to fill.
3. **Spread estimate where no quotes exist:** the Corwin-Schultz high-low estimator and the Abdi-Ranaldo
   close-high-low estimator on daily bars *(prior knowledge)*, cross-checked against the 605 reports' effective
   spreads for the symbol where available.
4. **Pre-trade estimate** (`estimateCost(symbol, notionalUsd, side)`, also exported for the algo engine): half the
   estimated spread + impact Y·σ_daily·√(Q / ADV) (the square-root law, Y about 0.7 *(prior knowledge)*) +
   commission from a broker table + borrow for shorts. Y is shrunk toward the person's own measured fills once
   there are 30 or more.
5. **Your annual cost:** fills over the last 12 months projected: "at your pace (14 trades a month, about $3,200
   each) you paid about $X in spreads and slippage, Y% of your portfolio a year". Options fills against the
   option's mid at fill time when an options feed is available (Q9's data).
6. **Broker scorecard:** from 605 and 606 reports: price improvement per share and effective-over-quoted spread by
   order size for market orders; payment for order flow received per 100 shares, by venue, equities and options;
   the person's broker against others, with the Schwarz et al. finding as context. Each figure links to the report
   it came from.

*Uncertainty.* Daily-bar comparisons are labelled as rough (they cannot see the quote at the moment of the trade);
estimates carry ranges; a broker comparison needs the same order-size bucket and month.

*Audit.* Imported fills keep their raw row; each report is a `quant_runs` row.

**In YouBank.** Terminal `TCA`; a costs line on every algo-engine order ticket (`estimateCost`) and on copy-trading
batches before approval (copytrade's `orderImpact` already returns the broker's commission; this adds spread and
impact); `CostEstimate` attached to signals; the AI tool `quant_costs`.

**UI.** Desktop: a fills table with slippage coloured by sign; a scatter of slippage against time of day; the
annual cost headline; the broker scorecard as a small table with sources. Phone: the annual cost card first, then
"your most expensive trades" as cards, then the broker card. CSV import is drag-and-drop on desktop and a file
picker on phones.

**Free and premium.**

| | Free | Pro (`quant.tca.pro`) |
|---|---|---|
| Fills | CSV import, daily-bar analysis, annual cost | Broker sync, minute-bar shortfall, options against mid |
| Scorecard | Your broker's latest 605/606 summary | All brokers, history, by order size |
| Pre-trade | Estimate for one symbol | Inside the algo engine and copy batches |
| Cost to us | ~0 | about $0.0005 per fill analysed at minute resolution (vendor plan is a fixed monthly cost; open question 1) |

**Tests.** CSV parsers on fixtures for each broker's export; shortfall arithmetic by side; Corwin-Schultz on a
simulated series with a known spread; the square-root model's monotonicity; a 606 XML fixture parsed into
payments per 100 shares.

**Size and risks.** M. Risks: daily-bar comparisons mistaken for precise TCA (label them); broker report formats
varying (curate and test each); naming a broker as worse is a factual claim that must be sourced to its own
filings, never editorialised; fills are personal financial data (owner-scoped, encrypted at rest as other
personal data, deletable, never aggregated across people without explicit opt-in).

### Q6. Event Desk (`EVB`)

**Pitch and lineage.** Event-driven pods at Millennium, Point72 and Citadel trade earnings, index changes, spin-offs
and mergers with base rates for each. Most of the information is public; what retail lacks is the base rate,
honestly measured, and the knowledge of which effects have decayed: post-earnings drift in large caps
([Martineau 2022](https://nowpublishers.com/article/Details/CFR-0122), disputed in 2025 papers), the S&P 500
addition effect ([Greenwood and Sammon 2025](https://papers.ssrn.com/abstract=4294297)).

**The user problem.** "My stock reports next week; what usually happens? It's being added to an index; does that
matter now? There's a merger at $50 and it trades at $47; what does that imply?"

**How it works.**
- **Earnings:** dates and consensus from the existing `EE` chain (FMP, Nasdaq). Standardised unexpected earnings
  from XBRL diluted EPS by the seasonal random walk, SUE = (EPSq − EPSq−4) / σ(last eight such changes), and
  from consensus where available. QF5 base rates of the drift (+2 to +60 days) by SUE decile, size tercile and era
  (before 2006, 2006–2015, 2016 on), shown side by side so the decay is visible.
- **Index flows calendar:** S&P quarterly rebalance dates (third Friday of March, June, September and December),
  the Nasdaq-100 annual December reconstitution, and the Russell semi-annual reconstitution (2026: rank day 30
  October, preliminary lists 13 November, effective after the close 11 December
  ([LSEG](https://www.lseg.com/en/media-centre/press-releases/ftse-russell/2026/ftse-russell-announces-december-2026-russell-us-indexes-reconstitution-schedule))).
  YouBank estimates likely Russell 1000/2000 migrations from QF3 market caps on rank day, with a probability from
  the distance to the breakpoint and the banding rule *(prior knowledge: ±2.5 percentage points of cumulative
  market cap; verify in the FTSE Russell methodology)*, and links to the official lists once published (the
  lists themselves are not republished). Base rates by era show the effect's decline; the framing is "large
  predictable flows at the close", not a trade.
- **Mergers:** for pending deals in the Precedent Engine (`edge_deals`), the current spread, the annualised spread
  to the expected close, and the completion probability the market implies, p = (P − P_fail) / (offer − P_fail),
  with P_fail from the target's pre-announcement price moved by the market since; beside Deal Radar's view where it
  has one. Merger arbitrage's crash-like payoff is stated ([Mitchell and Pulvino](https://ideas.repec.org/a/bla/jfinan/v56y2001i6p2135-2175.html)).
- **Spin-offs** (Form 10-12B registrations and when-issued trading), **buyback announcements** (8-K text) and
  **dividend initiations and cuts** (XBRL dividends per share): calendar entries with QF5 base rates.

**In YouBank.** `EVB` board and `<TICKER> EVB`; event signals (`kind: "event"`) through QF1; ledger forecasts of
the base-rate probability, resolved by the return rule; calendar entries can be added to the person's YouBank
calendar.

**UI.** A week view of events for holdings and watches (phone: a list grouped by day); each event opens a base-rate
card with the era split as three small bars.

**Free and premium.** Calendar and base rates free; Pro (`quant.events.pro`): the market-wide board, custom event
studies on the person's own event lists, CSV export. Cost to us ~0.

**Tests.** SUE arithmetic; merger implied probability; Russell breakpoint estimate on a fixture cross-section;
QF5 on a simulated panel with a planted abnormal return.

**Size and risks.** M (QF5 does most of the work). Risks: base rates read as predictions (each card states n, the
interval and the era); index lists' licences (link, never republish).

### Q7. Insider and Activist Clusters (`INSC`)

**Pitch and lineage.** The insider literature is clear about one thing: most insider trades are routine and carry
no information, but opportunistic ones do (82 basis points a month value-weighted against about zero for routine
trades, [Cohen, Malloy and Pomorski 2012](https://www.nber.org/digest/apr11/w16454.html)), and several insiders
buying together is a stronger tell. Activist 13D filings are the other classic public-filing event, now due within
five business days of crossing 5% ([2023 amendments](https://corpgov.law.harvard.edu/2023/10/24/sec-adopts-updates-to-schedule-13d-and-13g-reporting)).
YouBank already parses Form 4 and 13D/13G (`edgar/insiders.ts`, `edge/graph/ingest.ts`); this turns them into
classified, base-rated signals.

**The user problem.** "Insiders are buying my stock: does it mean anything? Which insider buying across the market
is unusual, not routine? An activist just filed: what usually follows?"

**How it works.**

*Data.*

| Input | Source | Licence and cost |
|---|---|---|
| History | SEC Insider Transactions Data Sets (Forms 3, 4, 5, quarterly, flattened from the XML) ([SEC DERA](https://www.sec.gov/dera/data/form-345)) | Public domain; free |
| Live | EDGAR's latest-filings feed for Form 4 and SC 13D/13G every 10 minutes during the filing day, then the raw XML through `edgar/client.ts` (User-Agent, rate limit) | Public domain; free |
| 13D/13G | EDGAR full index and the graph's existing parser (old text and new XML) | Public domain |
| Returns | QF3 and QF5 | As QF3 |

*Method.*
1. **Clean:** open-market purchases (code P) and sales (S) only; drop 10% owners for the insider signal; drop
   trades marked as made under a Rule 10b5-1 plan (the Form 4 checkbox added in 2023 *(prior knowledge)*); drop
   purchases in an offering (at the offering price within five days of a 424B prospectus).
2. **Routine or opportunistic** (Cohen, Malloy and Pomorski): an insider who traded in the same calendar month in
   each of the three prior years is routine; one with three years of history who is not is opportunistic; others
   are "unclassified" and shown separately.
3. **Signals:**
   - `cluster_buy`: three or more distinct officers or directors with opportunistic open-market purchases within
     30 days, at least $100,000 in total;
   - `large_officer_buy`: a CEO or CFO opportunistic purchase of at least $250,000 or 25% of their holding;
   - `cluster_sell`: shown, with the literature's caution that sales are weakly informative;
   - `activist_new`: a new SC 13D, or a 13G holder switching to 13D; `activist_up`: a 13D/A adding at least 1% or
     changing Item 4 (purpose). Item 4's intent (board seats, a sale, a proxy contest, "no plans") is read by the
     small model with the quote verified against the filing (Edge's quote check), and the quote is shown.
4. **Timing:** every signal's `asOf` is the EDGAR acceptance time of the filing that completed it; the first
   tradable session is the next open. Academic returns measured from the trade date overstate what anyone can
   capture; QF5 measures from acceptance.
5. **Base rates:** QF5 cumulative abnormal returns at +2..+20, +2..+60 and +2..+125, hit rate against the
   unconditional rate, by size tercile and era (and for 13Ds, before and after the 2024 deadline change), and
   **after estimated costs** (Q5's model at a $10,000 position), because many clusters are in small, wide-spread
   stocks.
6. **Calibration:** the probability that the stock beats the market over 125 sessions, from the base rate by
   isotonic regression on history, logged to the ledger (`quant_event`) and scored when it resolves.

*Audit.* Every signal links its filings; each base rate links its event list (downloadable in Pro).

**In YouBank.** `INSC` (the market-wide board) and `<TICKER> INSC`; the existing `INS` screen gains a routine or
opportunistic column and a cluster badge; feed cards `quant.insider_cluster` and `quant.activist` for watched and
held companies; Deal Radar gains `activist_new` as a feature input (it already reads 13Ds); signals through QF1 for
the algo engine; canvas node `quant.insiders`.

**UI.** Desktop: the board as a table (company, signal, insiders and amounts, filed, base rate with interval, cost
-adjusted); a company view with a timeline of insider trades, routine in grey, opportunistic in colour. Phone: a
card per signal ("3 directors bought $1.2M in 2 weeks; similar clusters beat the market 56% of the time over 6
months, against 51% for all stocks; n = 1,840") with the filings one tap away.

**Free and premium.** Signals on watched and held companies, the board's top 20 and base rates free. Pro
(`quant.insiders.pro`): the full board with filters, alerts on any company, event-list export, Item 4 readings.
Cost to us: Item 4 reading about $0.002 per 13D with the small model (shared, cached per filing, platform spend on
the live feed is about 10–30 filings a day, under $2 a month).

**Tests.** Routine classification on a fixture history; cluster detection windows; 10b5-1 and offering
exclusions; acceptance-time handling across 4 pm and weekends; the 13D parser on old-text and new-XML fixtures
(reuse the graph's); QF5 numbers on a planted-effect panel.

**Size and risks.** M. Risks: implying insiders know something specific (wording: "insiders bought", never "insiders
expect"); small-cap base rates dominated by costs (show after-cost figures first); the data sets lagging a quarter
(the live feed fills the gap).

### Q8. Filing Change Detector (`DIFF`)

**Pitch and lineage.** "Lazy prices": when a firm changes the language of its 10-K, especially risk factors, its
stock tends to underperform over the following months, and the market does not react on the day: up to 188 basis
points a month in the strongest specification, 34–58 value-weighted ([Cohen, Malloy and Nguyen, JF
2020](https://www.nber.org/papers/w25084)). Man AHL and others run NLP on filings at scale (job descriptions,
[Selby Jennings](https://www.selbyjennings.com/en-hk/job/ml-alpha-researcher-pr580670_1778748912)). Edge already
reads, chunks and embeds filings; this compares them across years.

**The user problem.** "My company filed its 10-K. What changed from last year that I should read, and does a big
change usually matter?"

**How it works.** Sections (Item 1A, Item 7, Item 3, the notes) parsed from this and last year's same-form filing
(Edge's document pipeline); similarity by TF-IDF cosine and by embeddings; sentence-level diff (added, removed,
changed sentences, with numbers normalised so "$4.1 billion" to "$4.3 billion" counts as an update, not a rewrite);
a "changer" score as the cross-sectional percentile of 1 − similarity; QF5 base rates for changer deciles
(2010 on). The written summary ("new risk factor on customer concentration; litigation section doubled") is drafted
by the small model on **anonymised** text (company and product names masked, per
[Glasserman and Lin](https://arxiv.org/abs/2309.17322)), with every claim quoted and checked by Calibrated Claims.

**In YouBank.** `<TICKER> DIFF`; feed card `quant.filing_change` when a watched or held company's change score is
above the 90th percentile; a `score` signal per company per filing; Call Desk links when a risk factor changed
on a topic analysts asked about.

**UI.** Side-by-side diff with added text highlighted (desktop); on phones, a list of the ten largest changes, each
expandable to old and new text.

**Free and premium.** Diffs and scores for watched and held companies free; Pro (`quant.diff.pro`): the market-wide
changer board, the written summary, alerts. Cost to us: embeddings about $0.0005 per section pair; summary about
$0.01–0.03 per filing on the small model.

**Tests.** Section parser fixtures; number normalisation; similarity on hand-made pairs; anonymiser coverage.

**Size and risks.** M. Risks: parsing failures on unusual filings (show "section not found"); the effect's decay
since publication (era split); LLM look-ahead (anonymise; no backtest with LLM features before the model's cutoff).

### Q9. Volatility Desk (`VOLS`)

**Pitch and lineage.** Optiver, IMC and SIG price volatility for a living; the variance risk premium (implied above
realized on average, [Carr and Wu 2009](https://ideas.repec.org/a/oup/rfinst/v22y2009i3p1311-1341..html)) is what
an option buyer pays them. With 0DTE at 59% of SPX volume and retail about half of it
([Cboe](https://www.cboe.com/insights/posts/spx-0-dte-options-jump-to-record-62-share-in-august)), and retail 0DTE
traders losing mostly to costs ([Beckmeyer et al.](https://www.bloomberg.com/news/articles/2023-04-21/day-traders-lose-358-000-per-day-gambling-on-zero-day-options)),
a desk that shows what an option prices in, against what usually happens, is consumer protection as much as edge.

**The user problem.** "Is this option expensive? What move is the market pricing for earnings, and how does that
compare with the stock's history? What does 'dealer gamma' on social media mean, and should I trust it?"

**How it works.**
- **Data (the blocker).** Options quotes need a licence. Paths, in order of preference:
  1. **The person's own broker** (the algo branch's connections: Tradier is free with an account, Alpaca has an
     indicative options feed on its free plan, Webull's OpenAPI): fetched with the person's credentials and shown
     only to them ([Alpaca docs](https://docs.alpaca.markets/docs/market-data)).
  2. **A vendor** for shared analytics: ThetaData (from about $40 a month), Polygon/Massive options (from about $29–
     $79 a month, 15-minute delayed) (prices from a competitor's comparison, [FlashAlpha](https://flashalpha.com/articles/options-data-pricing-comparison-flashalpha-thetadata-polygon-spotgamma-squeezemetrics),
     unverified); whether showing derived analytics (IV, skew) to subscribers triggers OPRA display fees must be
     checked (open question 5).
  3. **Free fallback:** realized volatility, GARCH forecasts (`RISK`), and the historical earnings move (`EE`),
     without implied volatility. Cboe's delayed-quote JSON endpoints are unofficial and their terms unconfirmed,
     so they stay out ([third-party note](https://www.skills.sh/gauss314/skills/cboe-data)); Cboe's volatility index
     histories (VIX, VIX9D, VIX3M) are usable only after their terms are checked; FRED's copy of VIX is display only.
- **Method.** Implied volatility by inverting Black-Scholes with the forward from put-call parity (handles dividends
  and borrow); 30-day constant-maturity ATM volatility by interpolating total variance; IV rank and percentile;
  variance risk premium = IV30 against the GARCH forecast of 30-day realized volatility, and ex post against what
  was realized (a history chart); skew as the 25-delta risk reversal; term structure slope (30 against 90 days);
  the expected earnings move from the front straddle (≈ 0.8 × straddle / price) against the stock's own
  distribution of earnings moves (`EE`); dealer gamma exposure Σ OI × Γ × 100 × S² × 1% under the stated
  assumption that dealers are short calls and long puts, shown with a range under the opposite assumption and the
  caveat that a direct test did not support the gamma-feedback story
  ([thesis](https://theses-dissertations.princeton.edu/entities/publication/61115cd1-cb09-4a8b-9230-ff488fc2a386)).
- **Honesty.** The premium is pay for bearing crash risk; selling it loses heavily in crashes. Every screen with
  a short-volatility number shows the worst historical month for a short-volatility index alongside.

**In YouBank.** `<TICKER> VOLS`; the earnings card in `EE` gains "priced move against history"; Q2 stress includes
option positions when a feed is connected; Q14 uses the expected-move drill.

**UI.** IV term structure and skew curves (desktop); on phones, one card: "Options price a 6.2% earnings move; the
stock has moved more than that 4 times in the last 12 reports".

**Free and premium.** Free: realized volatility and earnings moves; with the person's own broker, their IV. Pro
(`quant.vol.pro`): shared vendor IV, skew and term history, GEX. Cost: vendor fixed fee (open question 5), ~0 per use.

**Tests.** IV inversion round trip; parity forward; variance interpolation; GEX sign handling.

**Size and risks.** M once data exists. Risks: licence (blocker), encouraging options trading (frame as cost and
risk education; no "trade ideas").

### Q10. Pairs and Residual Scanner (`PAIR`)

**Pitch and lineage.** Statistical arbitrage made D. E. Shaw's and many others' early fortunes; the academic
versions are pairs (Gatev, Goetzmann and Rouwenhorst 2006 *(prior knowledge)*) and PCA residual mean reversion
([Avellaneda and Lee 2010](https://ideas.repec.org/a/taf/quantf/v10y2010i7p761-782.html): Sharpe 1.44 over
1997–2007 after costs, 0.9 in 2003–2007). It has decayed and needs cheap shorting, so the scanner is honest about
both.

**The user problem.** "Which stocks move together closely enough that a gap between them tends to close? How fast?
Would it pay after costs?"

**How it works.** Within each industry (QF4 classifications), candidate pairs by distance of normalised prices,
then Engle-Granger cointegration (residual ADF with MacKinnon critical values), half-life from the residual's AR(1),
Hurst exponent; Johansen for baskets of up to four; PCA residual s-scores within sectors (residuals of returns on
sector principal components, fitted as an Ornstein-Uhlenbeck process over 60 days). Walk-forward: formation 252
days, trading 126 days, repeated; **Benjamini-Hochberg at q = 0.1** across all pairs tested, because scanning
10,000 pairs at 5% finds 500 by chance; a cost hurdle (Q5's round trip on both legs plus an assumed borrow fee); the
out-of-sample record of the pair's past signals. Output: `score` signals (the spread's z-score) for pairs that pass.

**In YouBank.** `PAIR` board, `<TICKER> PAIR`; signals for the algo engine (which owns entries and exits); Q3 grades
any strategy built on them.

**UI.** Desktop: a pair's spread chart with bands and the walk-forward record. Phone: pair cards with half-life and
"passes after costs: yes/no".

**Free and premium.** Free: the top 20 pairs per sector, daily. Pro (`quant.pairs.pro`): custom universes and
baskets, intraday-free history, export. Cost: a 500-name scan is 125,000 pairs; in TypeScript minutes, on the ML
service about $0.01.

**Tests.** Recover a planted cointegrated pair's half-life within 20%; ADF critical values; BH on a null simulation
keeps the false discovery rate.

**Size and risks.** M. Risks: shorting availability and cost for small accounts; decay; regime breaks (show the
pair's stability).

### Q11. Regime Monitor (`REGM`)

**Pitch and lineage.** Bridgewater's growth-and-inflation quadrants and Two Sigma's published regime work (a
Gaussian mixture on factor returns *(prior knowledge)*) are ways to describe the environment a portfolio lives in.
Regimes are useful for risk (Q2's stress, Q3's robustness) and dangerous as timing signals; the monitor is built for
the first use.

**How it works.** A two- or three-state Gaussian HMM on weekly features from **public-domain or self-computed data
only** (FRED is barred from models): market return and 21-day realized volatility (QF3), the 10-year minus 3-month
Treasury slope (Treasury), a credit proxy from the high-yield bond ETF's return against Treasury ETFs (derived from
prices), and breadth (share of the universe above its 200-day average, QF3). Filtered state probabilities only.
Each week it logs to the ledger "SPY's realized volatility over the next 21 sessions exceeds 20% annualised" with
its probability, scored against the base rate and against a GARCH-only forecast; the Track record shows whether the
regime model adds anything (and says so if it does not).

**In YouBank.** `REGM`; a regime ribbon on `GP`, `PORT` and Q3; feed card `quant.regime` when the high-volatility
probability crosses 0.7; inputs to Q2 and Q4 (volatility targeting).

**UI.** A ribbon chart of state probabilities over price; phone: one card with today's probabilities and the
model's Brier skill.

**Free and premium.** Free. Cost ~0.

**Tests.** Recover a planted two-state process; filtered never uses future data; ledger rule resolution.

**Size and risks.** S. Risks: being read as a market-timing call (wording; the skill score is always beside it).

### Q12. Factor Sleeve Builder (`SLEEVE`)

**Pitch and lineage.** AQR, Dimensional and the factor ETF industry sell diversified factor exposure; a small firm
or a person can build a transparent version for the cost of trading. With QF3 and QF4 in place, a sleeve is a few
rules away, and it is the natural `TargetPortfolio` producer for the algo engine and paper trading.

**How it works.** The person chooses: universe (largest 500 or 1,000, sectors excluded, minimum price and daily
volume), factor blend (value, momentum, profitability, low volatility, each a weight), number of names, weighting
(equal, capped market cap, inverse volatility, risk parity), constraints (maximum weight, sector cap, maximum
turnover) and rebalance (monthly or quarterly, drift band). The backtest runs on QF3 with costs, point in time,
including delisted names where the vendor has them, and every rule change is a trial in `quant_trials`, so Q3's
grade reflects the tinkering. The current target is a `TargetPortfolio` (`producer: "quant.sleeve"`), which the
person may follow on paper or route to the algo engine. Starting points are labelled as textbook definitions
("Fama-French value, top 30% by book-to-market"), never as recommendations.

**In YouBank.** `SLEEVE`; a Sleeves tab in the Quant hub; targets in the algo engine; Q1, Q2 and Q3 run on every
sleeve automatically.

**UI.** A rules form on the left, the graded backtest on the right; phone: a step-by-step builder, then the grade
card and the current holdings list.

**Free and premium.** One sleeve on paper free; Pro (`quant.sleeves`): five sleeves, routing to the algo engine;
Deal Team: shared firm sleeves. Cost ~0 beyond data.

**Tests.** Rules produce the expected holdings on a fixture cross-section; turnover and drift logic; trial logging
on every change.

**Size and risks.** M. Risks: **regulatory** (a rules-based portfolio that a subscriber follows with one tap is the
same question as copy trading's adviser analysis, docs/copy-trading.md item 1); counsel review before routing to
real accounts; hypothetical-performance disclosure on every backtest.

### Q13. Short Interest and Crowding (`SINT`)

**Pitch and lineage.** Hedge funds watch who else owns their longs and how heavily their names are shorted;
crowded trades unwind together (the 2007 quant quake, the January 2021 short squeezes *(prior knowledge)*). YouBank
already reads every 13F filer for copy trading, so it can measure hedge-fund crowding nearly for free.

**How it works.** FINRA equity short interest, twice monthly, published about eight business days after each
settlement date ([FINRA API docs](https://WWW.FINRA.ORG/sites/default/files/Equity_Short_Interest_Data_File_Download_API.pdf);
[catalog](https://www.finra.org:443/finra-data/browse-catalog/equity-short-interest)): short interest as a share
of shares outstanding (XBRL, point in time) and of an approximate float (labelled), days to cover against 20-day
volume, change against the prior report. FINRA's daily short-sale volume files are shown only with FINRA's own
caveat that they are not short interest and cover only trades reported to its facilities
([FINRA](https://www.finra.org/finra-data/browse-catalog/reg-sho-daily)). Hedge-fund crowding from 13Fs: number of
hedge-fund holders, the share of the float they hold, quarter-on-quarter change, and a "most crowded hedge-fund
longs" basket with its historical behaviour in drawdowns (QF5). High short interest's link to lower future returns
is shown as a QF5 base rate *(prior knowledge: Asquith, Pathak and Ritter 2005; Boehmer, Jones and Zhang 2008)*.

**In YouBank.** `<TICKER> SINT`, the `SINT` board; a crowding row in Q1; feed card `quant.crowding` for held names
whose hedge-fund ownership or short interest crosses its 95th percentile; signals through QF1.

**UI.** A short-interest history chart with days to cover; phone: a card per held name only when a flag is on.

**Free and premium.** Free; Pro (`quant.crowding.pro`) for the market-wide boards and export. Cost ~0.

**Tests.** FINRA file parser on fixtures; days-to-cover arithmetic; 13F crowding on a fixture of filers.

**Size and risks.** S. Risks: short-volume misreading (label); 13F lag (45 days, stated as copy trading does).

### Q14. Desk Drills: expected value and calibration (`DRILL`)

**Pitch and lineage.** Jane Street and SIG train traders with estimation questions, betting games and market-making
games, because good trading is calibrated probability and disciplined sizing ([interview guides](https://www.techinterview.org/companies/jane-street/?format=md);
SIG's poker-based training *(prior knowledge)*). Tetlock's superforecasting research shows calibration can be
trained and measured *(prior knowledge)*. This is the most replicable edge of all, costs almost nothing, and makes
every other feature safer, because a person who knows their own calibration sizes bets better.

**The user problem.** "Am I as good at judging this as I think? How should I size a bet when I'm only fairly sure?"

**How it works.**
1. **Calibration intervals:** ten numeric questions with known answers, generated from YouBank's own data (XBRL:
   "Costco's revenue in fiscal 2025"; prices: "the S&P 500's worst day in 2020"; macro: "US unemployment in
   October 2009") plus general-knowledge sets. The person gives 90% intervals; scored by hit rate against 90% and
   by the interval score (Gneiting and Raftery 2007 *(prior knowledge)*), which rewards narrow intervals that
   still contain the answer.
2. **Probability questions:** true-or-false statements with a confidence from 50% to 100%; Brier score and a
   reliability diagram (the `calib` library), with the person's over- or under-confidence in one sentence.
3. **The Kelly coin:** Haghani and Dewey's game, virtual: $25, a coin that lands heads 60% of the time, 300 flips
   or 30 minutes, a cap on winnings. Afterwards: the person's path against Kelly's, their bet sizes, and how often
   people in the original study went bust ([SSRN 2856963](https://papers.ssrn.com/abstract=2856963)).
4. **The market-making game:** an unknown quantity (the sum of hidden dice, or a fact); the person quotes a bid
   and an ask; simulated traders, some of them informed, trade against them; the score shows spread earned against
   adverse selection. Teaches why spreads exist and who pays them (linked to Q5).
5. **Expected-value drills:** short problems (pay $1 to reroll a 100-sided die; is this option's expected payoff
   worth its price; does a 55% edge at 1:1 justify this stake), with worked answers.
6. **Your own calls:** the person logs forecasts about stocks ("NVDA beats SPY over the next 3 months: 60%"),
   stored as `user_call` in the forecast ledger with a return rule, resolved automatically. After 20 resolved
   calls they see their Brier skill with an interval ("after 40 calls your skill is −0.03 (−0.12 to 0.06): no
   better than 50/50 yet"). This is the most honest mirror a stock picker can have.
Progress uses the knowledge tracing behind `LEARN`; streaks and a weekly set keep it a habit.

**In YouBank.** `DRILL` in the terminal and a Drills tab in the Quant hub; the student and markets function strips;
Q4 links to the Kelly coin; Q5 to the market-making game; personal calls appear in the Track record under "My
calls".

**UI.** Built phone-first: one question per screen, a slider for intervals and confidence, instant feedback,
results as a reliability chart; on desktop the same in a centred column.

**Free and premium.** Free for everyone (it is the best top of funnel in the Quant area). Pro: private group
leaderboards for a firm or a class (`quant.drills.teams`, Deal Team). Cost to us: question generation from
YouBank data is ~0; an optional small-model explanation is about $0.0005.

**Tests.** Interval score and Brier against hand values; question generator answers match the source data; the
Kelly coin's cap logic; the market-making simulation's informed-trader share.

**Size and risks.** S. Risks: reading as gambling (virtual money only, no prizes, no real-money stakes); generated
questions with wrong answers (only questions whose answers come from cited data, with the source on the answer
screen).

---
## 7. Ranking, the chosen set and build order

### 7.1 Impact × feasibility

Impact: how much it helps a regular investor or a small firm, and how much it protects them (1–5). Feasibility:
data available free or cheap today, reuse of existing code, regulatory clarity (1–5).

| Rank | Feature | Impact | Feasibility | Score | Size | Why |
|---|---|---|---|---|---|---|
| 1 | Q3 Backtest Integrity Checker | 5 | 5 | 25 | M | Pure mathematics; protects users and makes the algo engine honest; grades existing copy-trade backtests too |
| 2 | Q1 Factor Lab | 5 | 4 | 20 | M | The single most useful professional lens; French factors give a quick first version |
| 3 | Q2 Risk Model and Stress Tests | 4 | 5 | 20 | M | Extends `PORT` and Edge's scenario engine |
| 4 | Q4 Sizing and Drawdown Governor | 4 | 5 | 20 | S | Calculators plus a `RiskBudget` the algo engine needs |
| 5 | Q7 Insider and Activist Clusters | 4 | 4 | 16 | M | Free public data YouBank already parses; first `QuantSignal` producer; builds QF5 |
| 6 | Q5 Execution Cost Analyzer | 5 | 3 | 15 | M | Real money saved; new 605 data from August 2026; fills access is the constraint |
| 7= | Q14 Desk Drills | 3 | 5 | 15 | S | Cheap, sticky, safe, phone-first |
| 7= | Q12 Factor Sleeve Builder | 5 | 3 | 15 | M | High value, but needs QF3/QF4 at full strength and counsel review |
| 8 | Q6 Event Desk | 4 | 3 | 12 | M | Cheap after QF5 |
| 9 | Q8 Filing Change Detector | 3 | 4 | 12 | M | Reuses Edge's documents |
| 10 | Q11 Regime Monitor | 3 | 4 | 12 | S | Mostly a risk input |
| 11 | Q13 Short Interest and Crowding | 3 | 4 | 12 | S | Free data, simple |
| 12 | Q10 Pairs and Residual Scanner | 3 | 4 | 12 | M | Real but decayed; shorting costs |
| 13 | Q9 Volatility Desk | 4 | 2 | 8 | M | Options data licence is the blocker |

### 7.2 The set for this round, in build order

Shared infrastructure first, then features in the order that each one's foundation is ready. Rough effort in
builder-days assumes the pace of earlier rounds.

| Step | What | Depends on | Delivers | Effort |
|---|---|---|---|---|
| 1 | **QF1 contracts and stores** (`contracts.ts`, `quant_signals`, `quant_targets`, `quant_trials`, `quant_runs`, the routes, the `copy.13f` and `edge.pulse` adapters) | — | The algo branch can code against the contract on day one | 1 |
| 2 | **QF2 statistics kit** | — | DSR, PBO, MinTRL, bootstrap, shrinkage, HMM, cointegration, all tested | 1.5 |
| 3 | **Q3 Backtest Integrity Checker** | 1, 2 | `BTX`, "check a claim", grades on copy-trade backtests, the `IntegrityReport` and the live gate | 2 |
| 4 | **QF3 point-in-time store** (universe, bars, fundamentals as of, calendar, nightly pass, backfill script) | owner's vendor choice (open question 1); beta runs on the existing chain, top 1,000 names | Point-in-time panel in R2 | 3 |
| 5 | **QF4 factor engine** (French reference factors, YouBank factors, cross-sectional model, crowding) and **QF5 event-study engine** | 4 | `quant_factor_returns`, exposures, base rates | 3 |
| 6 | **Q1 Factor Lab** | 5 | `FACT`, copy-portfolio factor panel | 1.5 |
| 7 | **Q2 Risk Model and Stress Tests** | 5 | `PORT` tabs, stress, VaR backtest | 2 |
| 8 | **Q4 Sizing and Drawdown Governor** | 2, 7 | `KELLY`, `RiskBudget` to the algo engine | 1 |
| 9 | **Q5 Execution Cost Analyzer** | 4 (bars); fills from CSV first, SnapTrade and algo fills after | `TCA`, `estimateCost` for the algo engine and copy batches, 605/606 scorecard | 2.5 |
| 10 | **Q7 Insider and Activist Clusters** | 4, 5 | `INSC`, first live `QuantSignal` producer, feed cards, ledger forecasts | 2.5 |
| 11 | **Q14 Desk Drills** | ledger (exists), `LEARN` | `DRILL`, personal calls | 1.5 |

Total about 21 builder-days. If time is short, cut from the end: Q14 is independent and can ship any time; Q7 can
ship with base rates computed on the beta universe.

**Stop points.** After step 3, the algo branch has a contract and an integrity gate even if nothing else ships.
After step 7, regular investors have the professional risk view of their own portfolio. After step 10, the algo
engine has its first signal source.

### 7.3 Monthly run-rate of the chosen set at beta scale

| Item | Cost | Notes |
|---|---|---|
| End-of-day prices for the point-in-time store | $0 in the beta (FMP plan already paid, Nasdaq backup); $20–$80 a month with a licensed vendor covering delisted names (open question 1) | The largest decision |
| Minute bars for Q5 Pro | $0–$29 a month (vendor starter tier, delayed) | Only when Pro TCA launches |
| R2 storage | Under $0.50 a month (bars about 2–4 GB, panels and reports small) | |
| Postgres | Signals, targets, trials, fills, factor returns: under 200 MB in year one | Fits the paid Neon plan already needed by Edge |
| Compute | Nightly pass a few minutes of serverless time; ML service only for very large PBO and pair scans | Under $5 a month |
| Models | Q7 Item 4 readings under $2 a month; Q14 explanations a few dollars | |
| SEC, FINRA, Treasury data | $0 | Public; SEC's fair-access limit (10 requests a second, a User-Agent) applies |
| **Total** | **about $10 a month in the beta; $40–$120 a month with licensed data** | |

---

## 8. Free and premium

Registered in a new `src/lib/billing/features/quant.ts` (area `"quant"`), following docs/premium.md: spend only on
explicit use, the server checks the plan, a free path always stays, background passes never spend premium money.

| Id | Plan | What it adds | Cost to us per use | Cost driver |
|---|---|---|---|---|
| `quant.factorlab.pro` | Pro | 200 holdings, broker sync, ETF look-through, 20-year history, custom factors | under $0.001 | CPU |
| `quant.risk.pro` | Pro | Unlimited hypotheticals, reverse stress, 10,000 paths, all VaR horizons | about $0.002 | CPU |
| `quant.integrity.pro` | Pro | Trial matrices up to 500, PBO, Reality Check, placebo, live follow-up | about $0.002 ($0.01 above 500 trials on the ML service) | CPU |
| `quant.sizing.pro` | Pro | Governor simulations on accounts and strategies, multi-asset Kelly, budgets to the algo engine | ~0 | — |
| `quant.tca.pro` | Pro | Broker sync, minute-bar shortfall, options against mid, all-broker scorecard | about $0.0005 a fill | Minute-bar vendor (fixed monthly) |
| `quant.insiders.pro` | Pro | Full board, alerts on any company, event-list export, Item 4 readings | about $0.002 a 13D reading (shared, cached) | Small model |
| `quant.events.pro` | Pro | Market-wide board, custom event studies, export | ~0 | — |
| `quant.diff.pro` | Pro | Changer board, written summaries, alerts | $0.01–0.03 a filing summary | Small model, embeddings |
| `quant.vol.pro` | Pro | Shared IV, skew, term history, GEX | ~0 per use | Vendor fixed fee and any OPRA fees |
| `quant.pairs.pro` | Pro | Custom universes and baskets, export | about $0.01 a large scan | ML service |
| `quant.sleeves` | Pro | Five sleeves, routing to the algo engine | ~0 | Data |
| `quant.sleeves.team` / `quant.drills.teams` | Deal Team | Shared firm sleeves; private leaderboards | ~0 | — |
| `quant.crowding.pro` | Pro | Market-wide short interest and crowding boards, export | ~0 | — |

Free for everyone: every calculator, "check a claim", factor exposures for up to 30 holdings, the risk view with
five replays, signals and base rates on watched and held companies, the regime monitor, and Desk Drills.

**A plan question.** Pro at $59 a month is priced for professionals; the regular investor the owner describes
compares it with $10–$30 a month retail tools. Open question 2 proposes an "Investor" plan.

---

## 9. Compliance and wording

None of this is legal advice; the owner's counsel should review it with the copy-trading list
(docs/copy-trading.md, "Compliance"), since the questions overlap.

**What the product does to stay on the safe side.**
- **Impersonal outputs.** Signals, factor data, base rates and event calendars are the same for everyone and
  describe statistics and filings, which keeps them within the publisher's exclusion as copy trading reads it
  (*Lowe v. SEC*: impersonal, bona fide, of general and regular circulation).
- **Analysis of the person's own portfolio describes it; it does not advise.** "62% of your risk comes from three
  names" is analysis; "you should sell NVDA" is advice and never appears. Calculators (Kelly, risk parity) take the
  person's own inputs and say "for the inputs you entered".
- **Words in one file.** `src/lib/quant/words.ts` holds the templates (`explain` and `reason` strings, card text,
  disclaimers) and a forbidden list checked by a test over every template and every AI tool description:
  "buy", "sell", "should", "recommend", "guaranteed", "risk-free", "can't lose", "beat the market" (as a promise),
  "AI picks". Statistics are phrased as what happened before: "similar clusters beat the market 56% of the time
  (n = 1,840)".
- **Disclosures.** `DISCLOSURES` in `words.ts`: `not_advice` (reusing copy trading's `NOT_ADVICE_SHORT` wording,
  adapted), `hypothetical` (beside every backtest and base rate, with the assumptions), `base_rate` ("a historical
  frequency, not a prediction for this stock"), `synthetic` (stress paths), `model_estimate` (regime, GEX).
- **Consent.** One consent at first use of the Quant hub (`quant.terms`, versioned and stored like
  `copy_consents`), stating that YouBank is not the person's adviser and that results are hypothetical.
- **The live gate** (section 5.3 rule 6) means a strategy graded D or F needs a typed, logged override before it
  trades real money.
- **AI.** The assistant's quant tools carry the wording rules in their descriptions, and the assistant must call
  `quant_backtest_check` before describing any backtest's performance.

**For counsel, in addition to the copy-trading list.**
1. Whether sleeves (Q12) followed with one tap, or `RiskBudget` and Kelly outputs computed on a connected account,
   change the adviser analysis.
2. The SEC Marketing Rule's treatment of hypothetical performance, if YouBank is or becomes an adviser: base
   rates and backtests shown to subscribers.
3. Whether showing a broker's own 605/606 figures, and the person's measured costs at that broker, raises any issue
   (it should not: they are the broker's public disclosures and the person's own data).
4. Whether options analytics (Q9) shown to subscribers need OPRA or vendor display agreements.
5. CFTC questions if the algo branch adds futures and Quant signals cover them (not in this round).

---

## 10. Licences to keep out

| Data | Why it stays out (or is restricted) |
|---|---|
| FRED series in any model (VIXCLS, BAA10Y, ICE BofA spreads, S&P 500) | FRED's terms bar use with machine learning or generative AI, and many series belong to third parties; display only, as today (`market/fred.ts`) |
| JKP Global Factor Data (jkpfactors.com) | CC BY-NC 4.0, non-commercial ([tidyfinance docs](https://rdrr.io/cran/tidyfinance/man/download_data_jkp.html)); use only with a commercial licence |
| Cboe delayed-quote JSON (`cdn.cboe.com/api/global/delayed_quotes/...`) | Unofficial endpoints backing cboe.com, terms unconfirmed ([third-party note](https://www.skills.sh/gauss314/skills/cboe-data)) |
| Nasdaq's quote API beyond the beta | Personal-use site terms; already restricted to the beta by `MARKET_BACKUP` |
| FTSE Russell and S&P index constituent lists | Proprietary; link to the official announcements, publish only YouBank's own estimates |
| Raw vendor prices shown to users | Only with the vendor's display licence; analytics derived from them are fine |
| Options quotes from a person's broker | For that person only, never pooled or shown to others |
| Kenneth French data library | No posted terms found; widely used for research and already used in Edge's scenarios; ask or attribute (open question 3) |

---

## 11. Open questions for the owner

1. **Price data vendor.** The point-in-time store needs end-of-day history for 3,000+ US stocks, including
   delisted ones, with a licence to show analytics derived from it (and ideally raw prices). Options: stay on FMP
   (upgrade the plan; check delisted coverage and its display licence), or add a vendor with delisted history
   (EODHD, Tiingo, Polygon/Massive, Norgate; prices roughly $20–$80 a month, unverified). Until then the beta runs
   survivorship-flagged on the 1,000 largest names. Which budget?
2. **An Investor plan.** Pro ($59) is priced for professionals. Would an "Investor" plan at about $15–$25 a month
   (Quant hub, Fund copies, the terminal, a small AI allowance; no Studio, Relationships or Edge) fit the owner's
   aim? It needs its own margin check in `scripts/test-billing.ts`.
3. **Kenneth French factors.** Use them as the reference (attributed), or rely only on YouBank's own factors in the
   product and keep French's for validation? An email to Professor French's office would settle it.
4. **Where Quant lives.** A new `/app/quant` hub (proposed), or inside Edge (which is a beta for deal people), or
   inside the terminal only?
5. **Options data.** Is the Volatility Desk worth a vendor fee and any OPRA display fees now, or only through each
   person's own broker connection (free, private to them) until demand is clear?
6. **Fills and privacy.** May YouBank, with explicit opt-in, compute anonymous aggregate execution costs by broker
   from many people's fills (a crowd-sourced 605)? It would be the most useful broker comparison anywhere, and the
   most sensitive data YouBank would hold.
7. **The live gate.** Should a D or F integrity grade block live trading in the algo engine outright, or allow a
   typed override (proposed)?
8. **Counsel.** Combine the copy-trading and Quant reviews into one engagement before sleeves route to real
   accounts?
9. **Coordination with the algo branch.** Who owns `contracts.ts` once both merge (proposed: Quant owns it, the
   algo branch reviews changes), and which branch's migration takes 0025?

---

## 12. Sources

**Checked this session (web search, 15 October 2026)**

Firms and market structure
- Jane Street, Citadel Securities and HRT 2025 revenues: [Hedgeweek (Reuters)](https://www.hedgeweek.com/jane-street-outpaces-rivals-with-record-40bn-trading-haul/); [Young and Calculated](https://youngandcalculated.substack.com/p/jane-street-booked-396bn-in-2025); [Bloomberg, Sept 2025](https://www.bloomberg.com/news/articles/2025-09-02/jane-street-citadel-securities-cement-sway-with-trading-hauls)
- SEBI and Jane Street: [Oxford Business Law Blog](https://blogs.law.ox.ac.uk/oblb/blog-post/2025/07/jane-street-and-expiry-day-trap-unpacking-sebis-crackdown-algorithmic); [ECGI](https://www.ecgi.global/publications/blog/expiry-day-and-the-governance-of-algorithmic-trading-the-jane-street-episode); SEBI F&O study: [Business Standard](https://www.business-standard.com/markets/capital-market-news/sebi-study-exposes-massive-losses-for-individual-f-o-traders-in-india-124092400948_1.html), [Taxmann](https://www.taxmann.com/post/blog/93-of-1-crore-fo-traders-saw-rs-2l-avg-loss-while-top-3-5-faced-rs-28l-avg-loss-incl-costs-sebi/)
- Pod drawdown limits: [eFinancialCareers](https://www.efinancialcareers.com/news/pratik-madhvani-glen-scheinberg); [Hedgeweek](https://www.hedgeweek.com/bluecrest-and-millennium-closed-pods-amid-market-turmoil/); [Young and Calculated](https://youngandcalculated.substack.com/p/risk-management-inside-a-pod-how)
- Renaissance: [AIER review of Zuckerman](https://www.aier.org/?p=48400); [arXiv 2405.10917](https://arxiv.org/pdf/2405.10917v2); [Institutional Investor](https://www.institutionalinvestor.com/article/2bswymr8cih3jeaslxc00/portfolio/famed-medallion-fund-stretches-explanation-to-the-limit-professor-claims)
- Two Sigma: [Harvard D3](https://d3.harvard.edu/platform-rctom/?p=28381); Man AHL: [CB Insights](https://www.cbinsights.com/company/man-ahl), [Selby Jennings role](https://www.selbyjennings.com/en-hk/job/ml-alpha-researcher-pr580670_1778748912)
- Jane Street culture (third-party): [techinterview.org](https://www.techinterview.org/companies/jane-street/?format=md); [Interview Query](https://www.interviewquery.com/interview-guides/jane-street)
- Payment for order flow: [Global Trading Q1 2025](https://www.globaltrading.net/?p=38554); [Q2](https://www.globaltrading.net/?p=40423)
- Execution quality across brokers: [Schwarz, Barber, Huang, Jorion and Odean, JF 2025](https://ideas.repec.org/a/bla/jfinan/v80y2025i5p2507-2541.html); [WashU Olin](https://olin.washu.edu/about/news-and-media/news/2022/10/study-finds-astonishing-differences-in-brokers-pricing-of-stock-trades.php)
- Rule 605: compliance extension, SEC Release 34-104147 (via search summaries); [SEC 2026 order 34-105136 (not read)](https://www.sec.gov/files/rules/exorders/2026/34-105136.pdf); [Sidley](https://www.sidley.com/en/insights/newsupdates/2024/04/sec-adopts-amendments-to-modernize-disclosure-of-order-execution-information)
- Tick size and access fees: [AIMA](https://www.aima.org/compass/practical-guides/spotlight-on-compliance/minimum-tick-size.html); [FlexTrade](https://flextrade.com/resources/secs-broader-reg-nms-overhaul-could-delay-access-fee-tick-sizes/); [The TRADE](https://www.thetradenews.com/tick-sizes-transparency-and-fee-caps-a-look-at-the-secs-rule-amendments/)
- Retail share of volume: [Benzinga](https://cdn4.benzinga.com/markets/tech/26/01/49671587/retail-investors-historic-2025-streak-record-inflows-record-influence)
- 0DTE: [Cboe, August 2025](https://www.cboe.com/insights/posts/spx-0-dte-options-jump-to-record-62-share-in-august); [Cboe, May 2025](https://www.cboe.com/insights/posts/spx-0-dte-options-jump-to-61-share-on-retail-resurgence); retail 0DTE losses: [Bloomberg](https://www.bloomberg.com/news/articles/2023-04-21/day-traders-lose-358-000-per-day-gambling-on-zero-day-options), [CXO Advisory](https://cxoadvisory.com/individual-investing/retail-0dte-option-trader-performance)
- Webull OpenAPI and MCP: [Nasdaq press release](https://www.nasdaq.com/press-release/webull-launches-model-context-protocol-enabling-investors-trade-through-ai-plain); [FOW](https://www.fow.com/insights/webull-launches-model-context-protocol-to-support-ai-based-trading)
- Russell semi-annual reconstitution: [LSEG, September 2026](https://www.lseg.com/en/media-centre/press-releases/ftse-russell/2026/ftse-russell-announces-december-2026-russell-us-indexes-reconstitution-schedule); [FTSE Russell FAQ](https://www.lseg.com/content/dam/ftse-russell/en_us/documents/policy-documents/ftse-faq-document-russell-us-equity-2026.pdf)
- 13D/13G amendments: [Harvard Law forum](https://corpgov.law.harvard.edu/2023/10/24/sec-adopts-updates-to-schedule-13d-and-13g-reporting); [Simpson Thacher](https://www.stblaw.com/about-us/publications/view/2023/10/12/sec-amends-schedule-13d-and-schedule-13g-beneficial-ownership-disclosure-requirements)

Academic evidence
- Factor zoo: [Jensen, Kelly and Pedersen (NBER w28432; JF 2023)](https://nber.org/system/files/working_papers/w28432/w28432.pdf)
- Factor timing: [Asness, Chandra, Ilmanen and Israel 2017 (CXO summary)](https://www.cxoadvisory.com/value-premium/valuation-based-factor-timing/); [AQR interview](https://www.Aqr.Com/-/media/AQR/Documents/Insights/Interviews/AQRPAJan18Asness-31518.pdf)
- Volatility-managed portfolios: [Cederburg, O'Doherty, Wang and Yan, JFE 2020](https://www.lehigh.edu/~xuy219/research/COWY.pdf)
- Index effect: [Greenwood and Sammon (SSRN; JF 2025)](https://papers.ssrn.com/abstract=4294297)
- PEAD: [Martineau, CFR 2022](https://nowpublishers.com/article/Details/CFR-0122); [UCLA Anderson Review on the 2025 dispute](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again/)
- Insiders: [Cohen, Malloy and Pomorski (NBER digest)](https://www.nber.org/digest/apr11/w16454.html); [SSRN](https://papers.ssrn.com/abstract=1692517)
- Lazy prices: [Cohen, Malloy and Nguyen (NBER w25084)](https://www.nber.org/papers/w25084)
- Merger arbitrage: [Mitchell and Pulvino, JF 2001](https://ideas.repec.org/a/bla/jfinan/v56y2001i6p2135-2175.html)
- Statistical arbitrage: [Avellaneda and Lee, QF 2010](https://ideas.repec.org/a/taf/quantf/v10y2010i7p761-782.html); [NYU draft](https://math.nyu.edu/~avellane/AvellanedaLeeStatArb071008.pdf)
- Variance risk premium: [Carr and Wu, RFS 2009](https://ideas.repec.org/a/oup/rfinst/v22y2009i3p1311-1341..html); [Wikipedia summary](https://en.wikipedia.org/wiki/Variance_risk_premium)
- Dealer gamma: [Princeton thesis](https://theses-dissertations.princeton.edu/entities/publication/61115cd1-cb09-4a8b-9230-ff488fc2a386); [SpotGamma on GEX assumptions](https://spotgamma.com/gamma-exposure-gex/)
- Backtest overfitting: [Bailey and López de Prado, deflated Sharpe (SSRN 2460551)](https://papers.ssrn.com/abstract=2460551); [Bailey, Borwein, López de Prado and Zhu, PBO](https://escholarship.org/content/qt4w1110bb/qt4w1110bb.pdf); [CRAN pbo](https://cran.hafro.is/web/packages/pbo/readme/README.html)
- LLMs and returns: [Lopez-Lira and Tang (arXiv 2304.07619 v6)](https://arxiv.org/html/2304.07619v6); look-ahead: [Glasserman and Lin (arXiv 2309.17322)](https://arxiv.org/abs/2309.17322); [Look-Ahead-Bench (arXiv 2601.13770)](https://arxiv.org/pdf/2601.13770)
- Kelly experiment: [Haghani and Dewey (SSRN 2856963)](https://papers.ssrn.com/abstract=2856963)

Data sources
- SEC Insider Transactions Data Sets: [DERA page](https://www.sec.gov/dera/data/form-345); [readme](https://SEC.gov/files/insider_transactions_readme.pdf)
- FINRA short interest: [catalog](https://www.finra.org:443/finra-data/browse-catalog/equity-short-interest); [API guide](https://WWW.FINRA.ORG/sites/default/files/Equity_Short_Interest_Data_File_Download_API.pdf); daily short-sale volume: [catalog](https://www.finra.org/finra-data/browse-catalog/reg-sho-daily)
- Options data vendors (vendor-written comparison): [FlashAlpha](https://flashalpha.com/articles/options-data-pricing-comparison-flashalpha-thetadata-polygon-spotgamma-squeezemetrics); Alpaca market data: [docs](https://docs.alpaca.markets/docs/market-data)
- JKP factors licence: [tidyfinance documentation](https://rdrr.io/cran/tidyfinance/man/download_data_jkp.html)
- VIX history (where to find it on Cboe): [Macroption](https://www.macroption.com/vix-historical-data/)

**Prior knowledge, not re-checked this session** (standard references; check before launch copy)
- Books: Gregory Zuckerman, *The Man Who Solved the Market* (2019); Rishi Narang, *Inside the Black Box* (2nd ed.
  2013); Michael Lewis, *Flash Boys* (2014); Marcos López de Prado, *Advances in Financial Machine Learning* (2018);
  Lasse Heje Pedersen, *Efficiently Inefficient* (2015); Antti Ilmanen, *Expected Returns* (2011); Larry Harris,
  *Trading and Exchanges* (2003); Philip Tetlock and Dan Gardner, *Superforecasting* (2015); Edward Thorp, *A Man
  for All Markets* (2017).
- Papers: Bailey and López de Prado, "The Sharpe Ratio Efficient Frontier" (PSR, 2012); Harvey, Liu and Zhu,
  "…and the Cross-Section of Expected Returns" (RFS 2016); Harvey and Liu, "Backtesting" (JPM 2015); White, "A
  Reality Check for Data Snooping" (Econometrica 2000); Ledoit and Wolf, "Honey, I Shrunk the Sample Covariance
  Matrix" (2004); Maillard, Roncalli and Teiletche, equal risk contribution (2010); Grossman and Zhou, drawdown
  constraints (1993); MacLean, Thorp and Ziemba on fractional Kelly; Perold, implementation shortfall (1988);
  Almgren and Chriss (2000) and the square-root impact law; Corwin and Schultz (2012) and Abdi and Ranaldo (2017)
  spread estimators; Novy-Marx, gross profitability (2013); Frazzini and Pedersen, betting against beta (2014);
  Asness, Moskowitz and Pedersen, "Value and Momentum Everywhere" (2013); Moskowitz, Ooi and Pedersen, time-series
  momentum (2012); Daniel and Moskowitz, momentum crashes (2016); Gatev, Goetzmann and Rouwenhorst, pairs trading
  (2006); Do and Faff (2010); Khandani and Lo, the August 2007 quant quake; Lou and Polk, comomentum; Bernard and
  Thomas, PEAD (1989); Brav, Jiang, Partnoy and Thomas, hedge-fund activism (2008); Asquith, Pathak and Ritter
  (2005) and Boehmer, Jones and Zhang (2008) on short interest; Gneiting and Raftery, proper scoring rules (2007);
  Kakushadze, "101 Formulaic Alphas" (2016); Barber and Odean, "Trading Is Hazardous to Your Wealth" (2000);
  Bryzgalova, Pavlova and Sikorskaya on retail options and wholesalers (JF 2023); MacKinnon (2010) critical values.
- Facts: Virtu's one losing day in 1,238 (2014 IPO filing); the Form 4 10b5-1 checkbox (2023); the FTSE Russell
  ±2.5% banding rule; the SEC Financial Statement Data Sets' `accepted` field; Form N-PORT public holdings; SnapTrade's
  account activities endpoint; Two Sigma's Venn and its regime-modelling article.

**Not verified because the sandbox could not reach them:** every data endpoint and file layout named in this
document (SEC, FINRA, Cboe, Kenneth French, Nasdaq, Stooq, FRED, JKP). The builder should save one real response per
source as a fixture under `scripts/fixtures/quant/` before writing its parser, and record any difference from this
document.

---

## 13. Build status

Built on `claude/new-session-6k1ff0-quant`, 15 October 2026: every step of 7.2. `contracts.ts` is unchanged
from its first commit. Checks: `scripts/test-quant.ts` (245 checks: known answers for every statistic, then the
features), typecheck, lint, the billing, premium, Edge next, copy-trading, errors and icon suites, and a
production build.

### What shipped

| Step | Status | Where |
|---|---|---|
| QF1 contracts and stores | Done. `quant_signals`, `quant_targets` (versioned), `quant_trials` (append-only by rule), `quant_runs`; `signalsAsOf`, `latestSignals`, `getTarget`, `logTrial` (dedupes re-runs, marks near-duplicates as aliases), `integrityCheck`, `estimateCost`, `latestRiskBudget`; routes under `/api/quant`; Inngest events `quant/*`; adapters `copy.13f` (targets for copies and curated funds), `edge.pulse` and Deal Radar | `src/lib/quant/`, `api.ts` is the algo engine's entry point; `drizzle/0026_quant.sql` |
| QF2 statistics kit | Done, each statistic against a known answer (statsmodels, NumPy and SciPy outputs saved in `scripts/fixtures/quant/stats-oracle.json`, or the papers' examples) | `src/lib/quant/stats/` |
| Q3 BTX | Done: grade A to F with its rule, check a claim, graded uploads (each a trial), families from the trial log, copy-trade clone backtests graded, the live gate with a typed, logged override | `integrity/`, `/app/quant?tab=integrity`, `BTX` |
| QF3 point-in-time store | Done for the beta: NYSE calendar with special closures, knownAt rules, daily bars in R2 (live fallback), SEC company facts as of acceptance, the top-1,000 universe rebuilt weekly with first and last dates; the nightly pass backfills bars from 2005 in slices. No separate backfill script: the nightly pass's slices are the backfill | `pit/`, `nightly.ts`, `functions.ts` |
| QF4 factor engine, QF5 event studies | Done: YouBank's own 2x3 factors, the cross-sectional risk model, crowding (valuation spread, comovement, 13F ownership), an ETF-proxy tier until YouBank's factors have history; the market-model event study with a calendar-month bootstrap and the unconditional hit rate | `factors/`, `events/` |
| Q1 FACT | Done for typed holdings (and the API's copy and broker sources); the copy-portfolio panel in Fund copies is not built | `/app/quant?tab=factors`, `FACT`, `AAPL FACT` |
| Q2 PORT tabs | Done: PORT gains "Risk model, stress, liquidity" and "Factors" tabs beside its overview | `risk/`, `PORT` |
| Q4 KELLY | Done; the RiskBudget is saved per account and announced with `quant/riskbudget.updated` | `sizing/`, `KELLY` |
| Q5 TCA | Done on daily bars: seven broker CSV templates, SnapTrade sync (Pro), the pre-trade estimate, Rule 605/606 parsing and payment for order flow on the person's orders. Minute bars are registered as planned. `estimateCost` is not yet shown on copy-trading rebalance batches | `tca/`, `TCA` |
| Q7 INSC | Done: Form 4 and 13D/13G polling every ten minutes, routine versus opportunistic, exclusions, clusters and activist events, signals gated on base rates, feed cards, ledger forecasts (kind `quant_event`), Item 4 readings (Pro) | `insiders/`, `INSC`, `AAPL INSC` |
| Q14 DRILL | Done: intervals, true-or-false with confidence, EV problems, the Kelly coin, personal calls scored from closes (kind `user_call`), team leaderboards (Deal Team). The market-making game is built and tested in `drills/games.ts` but has no screen yet | `drills/`, `DRILL` |
| Surfaces | `/app/quant` with nine tabs, "Quant" in the navigation after Fund copies, terminal group "Quant", AI tools, five canvas blocks, two Edge feed kinds, two Studio agent tools | see the README's Quant section |

### The owner's open questions: defaults used

1. No price vendor: the beta universe is today's top 1,000 by market value, and every result on it carries the
   survivorship flag (`DISCLOSURES.survivorship`).
2. No "Investor" plan was added; `features/quant.ts` and `docs/pricing.md` say where one would go.
3. Kenneth French's data is neither displayed nor redistributed. YouBank builds its own factors; no offline
   comparison was run in this round.
4. A `/app/quant` hub, "Quant" in the navigation, and terminal functions.
5. No options data: Q9 is out of scope.
6. No pooling of people's fills: each person's TCA uses their own fills and public data only.
7. A D or F grade allows live use only with the typed phrase `I accept grade <G> for <family>`, logged in
   `quant_runs` with its hash.
8. No "buy" or "sell" in explanations: templates and AI tool descriptions are checked against `FORBIDDEN`; every
   result carries "hypothetical" and "not investment advice" disclosures where they apply.
9. The migration is `drizzle/0026_quant.sql` (`IF NOT EXISTS` throughout), mirrored in `schema.ts`.

### Where the build departs from this spec

- **Premium ids** use a hyphen (`quant.factorlab-pro`), as every other area does.
- **Premium costs.** The Pro layers are perks with no cost of their own (their CPU is under a tenth of a cent a
  use, inside the per-person infrastructure line, and capped per person per day); only Item 4 readings are
  metered, inside the AI allowance. This keeps Deal Team's margin where the algo branch leaves it.
- **AI tools** live in `src/lib/quant/ai-tools.ts` (registered in the chat agent beside the crypto tools), not in
  `src/lib/ai/tools.ts`, and add `quant_kelly` (person-supplied inputs only).
- **Canvas.** The five blocks pass portfolios as `companies` (equal weights) or a `table` with symbol and weight
  columns, and return `table`, `memo` and `findings`; the new value kinds `portfolio`, `quantsignals` and
  `target` were not added. "Send to Studio" on Q1 to Q3 results is not built; the Studio agent has
  `quant_factor_exposures` and `quant_stress` instead.
- **Feed.** `quant.insider_cluster` and `quant.activist` ship; `quant.filing_change`, `quant.regime` and
  `quant.crowding` belong to features of later rounds. Cards reach people who watch the company in Edge; matching
  a person's holdings is not built.
- **Ledger.** Kinds `quant_event`, `quant_signal` and `user_call` and the `return` rule ship; `quant_regime` and
  `drill` (Q11 and per-question drill forecasts) do not.
- **Lone peak.** A parameter set is flagged as a lone peak when it beats its neighbours' median Sharpe by more
  than two standard errors of a Sharpe estimate (not 2.5) and the median is under half of it.

### Corrections to this spec

- **The deflated Sharpe ratio's false-positive rate.** Section 6 (Q3) says DSR keeps the false-positive rate "at
  about 5%" when the best of many noise strategies is tested. In a 2,000-run check with SciPy (best of 50 noise
  strategies, a year of daily returns), the 95% DSR test flagged 0.05% of them, against about 92% for the raw
  PSR: 5% is an upper bound, not the rate. The test's own 300 runs give 0% and 95%; it asserts at most 5% for DSR
  and over 80% for PSR.
- **Kelly's drawdown law.** The probability that a fraction c of full Kelly ever falls to x of its *starting*
  value is x^(2/c - 1) (continuous rebalancing, known edge). It is relative to the starting value, not to the
  running peak; the screens say "ever falling that far below the starting value". Verified by simulation.
- **Kelly for one bet with an uncertain win rate.** Expected log growth is linear in p, so averaging over a belief
  about p gives the same optimum as the midpoint: for a single bet the uncertainty-adjusted fraction equals full
  Kelly at the midpoint, and the low end of the range is what shows the cost of being wrong. For an asset
  (uncertain mean return) the adjustment is real, μ/(σ² + var μ).
- **Newey-West.** statsmodels' HAC errors (the reference) apply no small-sample factor; the kit matches them.

### Known gaps

- **Fixtures are constructed.** Every data host was unreachable from the build sandbox, so each parser's fixture
  under `scripts/fixtures/quant/` is built from the documented format and says so in its README. Save one real
  response per source and rerun the tests before relying on a parser in production.
- **Survivorship.** Until a vendor with delisted history is chosen, YouBank's factors and base rates rest on
  today's survivors and say so.
- **Minute bars** (Pro TCA) are planned, not bought.
- **The ML service** is not used: PBO on more than 500 trials is capped rather than offloaded.
- **Graded strategies' live follow-up** (out-of-sample tracking after a grade) is left to the algo engine's logs.
- **The risk model** has no industry factors yet, and funds are not looked through to their N-PORT holdings.
- **Insider base rates** need stored history: signals publish only once 30 or more past events of a kind have
  been measured, so the first weeks after deploy show events without signals.

### Notes for the algo branch

- Import only from `src/lib/quant/api.ts` (and `contracts.ts`); listen for `quant/signals.published`,
  `quant/target.updated`, `quant/trial.logged` and `quant/riskbudget.updated`.
- Log every backtest run with `logTrial` under one family per strategy, then call `integrityCheck(family)` before
  going live; `liveGate(report, family)` says whether the typed override is needed, and `logOverride` records it.
- `estimateCost(symbol, notionalUsd, side)` is free and safe to call per order ticket.
- Signals publish only with a base rate behind them; a backtest reads them through `signalsAsOf({ at })`, which
  never returns a signal whose `asOf` is after `at`.

