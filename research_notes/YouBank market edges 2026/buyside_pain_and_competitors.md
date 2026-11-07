# Buy-side research workflow pain, budgets and the AI research tool landscape (as of Nov 2026)

Method note: Every source page fetch was blocked by the session's network allowlist (aima.org, substantiveresearch.com and mondovisione.com all failed to resolve). So every finding below comes from web-search result summaries of the cited pages, not from reading the full pages. Treat all figures as seen secondhand through search snippets unless they are marked as a press release. Vendor pricing comes almost entirely from third-party estimates, because none of the named vendors publish list prices. To verify, allow those hosts and re-read the primary pages (Substantive Research, AIMA, Neudata, SEC).

## 1. What do funds of different sizes spend on research, data and AI in 2025-2026, and what are they cutting or adding?

### Takeaway
Total buy-side research budgets are flat: +0.4% in H1 2026. Inside that flat budget, AI and analytics tooling grew about 40% year on year and now takes about 7%, taken mostly from brokers and independent research. Data budgets, especially alternative data, are expected to rise or hold. Emerging managers work under tight cost limits: breakeven AUM is about $83M and total data budgets are often around $100k. The big pod shops mostly build their own AI rather than buy it.

### Cited Findings
**Large and mid-size asset managers (Substantive Research, Oct 2026)**
- Survey published 9 Oct 2026 covering 50 asset managers with about $20T AUM. Average global research budgets rose only 0.4% in H1 2026. — [Substantive Research press release](https://substantiveresearch.com/insights-and-press/buy-side-research-spend-continues-to-flatline-despite-new-ai-driven-requirements/); [FOW](https://www.fow.com/insights/buy-side-research-budgets-flatline-as-ai-spending-rises-40); [Traders Magazine](https://www.tradersmagazine.com/featured_articles/buy-side-research-spend-flatlines-despite-new-ai-requirements/)
- Spend on research analytics and tooling rose 40% in one year and is now about 7% of an average research budget, "mostly at the expense of brokers and independent providers." — [FinanceFeeds](https://financefeeds.com/ai-research-spending-jumps-40-while-asset-managers-keep-budgets-flat/); [FOW](https://www.fow.com/insights/buy-side-research-budgets-flatline-as-ai-spending-rises-40)
- Concentration: a firm's top 10 research providers take 56% of the average research budget, and the top 3 take 23%. European managers spend about 40% less on research than US managers. The sell side has "not yet monetised direct feeds into buy-side LLMs." — [Substantive Research](https://substantiveresearch.com/insights-and-press/buy-side-research-spend-continues-to-flatline-despite-new-ai-driven-requirements/) (seen via search summary)
- Substantive/Aiera survey (July 2026): 77% of buy-side firms have organisation-wide generative AI platforms deployed. Broker-research licensing restrictions are a barrier to feeding broker research into AI workflows. — [Mondo Visione / Substantive Research](https://mondovisione.com/media-and-resources/news/substantive-research-buy-side-ai-adoption-hindered-by-broker-research-licensing-2026716/)
- In earlier 2026 coverage, 70% of large asset managers expected "maintenance" research coverage to become AI-generated over time. — [IPE](https://www.ipe.com/news/asset-managers-rethink-research-budgets-amid-ai-shift/10136661.article) (secondhand via search summary)

**Data and alternative data budgets**
- Neudata, *Future of Alternative and Market Data 2026* (191 responses from data buyers and providers: quant, multi-strat, discretionary, macro funds and AI labs): 97% of data buyers expect alt-data spend to rise or hold, up from 89% the year before. About a third say the quality of purchased data has got worse over the past two years. — [Neudata press release (PR Newswire)](https://www.prnewswire.com/news-releases/alternative-data-budget-confidence-hits-3-year-high-while-ai-returns-remain-efficiency-led--neudatas-2026-industry-report-302881291.html); [Hedgeweek](https://hedgeweek.com/news/ai-boom-raises-data-quality-concerns-for-hedge-funds)
- Neudata reported alt-data spend up 17% in 2025. — [Alternative Fund Insight](https://alternativefundinsight.com/alt-data-spend-rises-17-in-2025-neudata/) (headline only)
- Coalition Greenwich (56 buy-side firms surveyed Sep-Oct 2025, published Feb 2026): 75% use alt data in research and investment, 46% in portfolio construction, and "AI fuels" an alt-data spending boom. — [Coalition Greenwich](https://www.greenwich.com/press-release/ai-fuels-buy-side-spending-boom-alternative-data)
- One blog attributes to S&P Global Market Intelligence a figure of about 12% of buy-side tech budgets going to AI research tools, versus 8% on the sell side. **The original source was not found, so treat it as unverified.** — search summary of a vendor blog (no primary link)

**Emerging managers (<$500M-$1B)**
- AIMA/Marex *Emerging Manager Survey 2026* (180 managers up to $1B AUM, 50 allocators): average management fee 1.43%. Breakeven AUM averages $82.9M, up from $70.1M two years earlier. Only 34% of investors say AI is a core consideration when assessing managers, so managers are adopting AI faster than allocators demand it. — [AIMA](https://www.aima.org/article/stacking-up-emerging-managers-2026.html) (via search summary). One secondary source gives a 42% AI-adoption headline figure, **not confirmed in AIMA text**.
- AIMA: the old rule of thumb was $250k to launch, and the minimum is now "closer to US$100,000," which AIMA calls "a very thin budget." — [AIMA, "What emerging managers get wrong"](https://www.aima.org/article/what-emerging-managers-get-wrong-when-launching-a-hedge-fund.html)
- Astraea Law: $100k-$220k to first close, plus $150k-$300k a year in recurring costs for a small US emerging fund. — [Astraea Law](https://astraea.law/insights/how-to-start-a-hedge-fund)
- Vibe Advisors: on a $40M launch, a 0.25% fee difference is $100k a year, "roughly a junior hire or your entire data budget." — [Vibe Advisors](https://www.vibe-advisors.com/emerging-hedge-fund-fees/)
- Unsourced or vendor-style estimates: market data feeds cost $50k-$300k a year [(Alpha Maven)](https://alpha-maven.com/aum-accelerator/resources/hedge-fund-startup-costs-breakdown), and year-one AI tooling for an emerging manager costs $80k-$250k [(Ricci blog)](https://www.tommasomariaricci.com/blog/ai-for-hedge-funds). Low reliability.

**Multi-manager and pod shops**
- These firms mainly build in-house. Per OpenAI (March 2026), 95% of Balyasny investment teams use its proprietary AI platform, which includes a deep-research agent built to mimic a senior analyst. Citadel's in-house equities tool highlights risk and builds portfolio-specific reading lists. Ken Griffin (May 2026) said research that took PhD analysts weeks now runs in days with agents. — [Inflxd](https://media.inflxd.com/article/citadel-balyasny-push-proprietary-ai-deeper-into-analyst-and-pm-) (trade-press summary)
- Walleye Capital: all employees use Claude Code. — [Anthropic, Claude for Financial Services](https://www.anthropic.com/news/claude-for-financial-services)
- Squarepoint Capital invested in Daloopa's $47M Series C (May 2026), a sign that pods buy structured-data infrastructure rather than front-end chat tools. — [Finextra](https://www.finextra.com/newsarticle/47823/daloopa-raises-47m-to-power-data-layer-behind-ai-driven-finance)
- No disclosed dollar figures for pod-shop AI budgets were found.

### Inferences
- The money for AI tools is coming out of broker and independent research budgets, not from new budget. A new product has to displace a line item (a seat of AlphaSense, a broker payment, an analyst hire) rather than ask for incremental spend.
- Emerging managers cannot afford a $25k-$30k Bloomberg, a $10k-$20k AlphaSense seat and a $10k-$30k Rogo seat at the same time. Their whole data budget is about $100k, which leaves room for a sub-$10k all-in-one research desk.
- Pod shops build their own front end but buy data layers and APIs. An MCP server is the natural way into them, rather than a UI seat.

### Gaps
- No primary 2025/2026 figures on hedge-fund research spend broken out by AUM tier. BarclayHedge, Burton-Taylor and Opimas 2026 data did not surface in searches.
- No 2025 edition of the EY Global Alternative Fund Survey was found. The latest found is 2024 (224 managers, 200 investors), and it gives no hedge-fund-specific AI spend figures. — [EY 2024](https://www.ey.com/en_us/insights/wealth-asset-management/how-can-alternative-fund-managers-shape-new-horizons-of-opportunity)
- No pod-shop AI budget figures.

## 2. What do the AI research tool competitors do, what do they charge, and what do users complain about?

### Takeaway
The market has split into three layers: content and search incumbents (Bloomberg ASKB, FactSet, AlphaSense+Tegus), document and agent workbenches (Hebbia, Rogo, Brightwave, Fintool), and data and content infrastructure feeding LLMs (Daloopa, Aiera, Moody's/FactSet MCP). Frontier labs (Anthropic, OpenAI) now ship finance agent templates and MCP connectors directly. Pricing is opaque and enterprise-only, typically $10k-$30k per seat. The most common complaints are price and opacity, hallucinations and data gaps, and broker-research licensing.

### Cited Findings
**Bloomberg ASKB**
- Beta on 24 Feb 2026. General availability on 15 Oct 2026. Clients can bring their own Instant Bloomberg chats, Worksheets and files into AI conversations. ASKB is built as a network of specialised agents and uses Bloomberg's own models plus frontier models, including Anthropic's. — [Bloomberg press (GA)](https://www.bloomberg.com/professional/insights/press-announcement/the-next-evolution-of-askb-your-insights-bloombergs-intelligence-one-conversation/); [Bloomberg roadmap](https://www.bloomberg.com/professional/insights/press-announcement/bloomberg-unveils-askb-roadmap-for-clients-to-augment-their-investment-process-with-agentic-ai/); [Fortune, 28 Apr 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)
- About a third of the Terminal's 375,000 users had ASKB access by April 2026 (WIRED, seen secondhand). Bloomberg's Wayne Barlow called it "our most rapidly adopted" functionality. — [Hedge Fund Alpha / Bloomberg](https://www.bloomberg.com/company/press/hedge-fund-alpha-inside-bloombergs-askb-how-the-terminal-is-rethinking-agentic-ai/)
- ASKB is included with the Terminal. No separate price was found.

**FactSet (Mercury / AI)**
- Mercury was an LLM knowledge agent for junior bankers (beta 2023, buy-side release planned for spring 2024). FactSet now sells "FactSet AI for Banking" as a premium add-on to the Workstation. — [FactSet IR](https://investor.factset.com/news-releases/news-release-details/factset-launches-factset-mercury-supercharge-junior-banker); [FactSet marketplace](https://www.factset.com/marketplace/catalog/product/factset-ai-for-banking)
- Workstation pricing (third-party): $12k floor, $14k-$22k per seat, median about $27.5k a year. — [Costbench](https://costbench.com/software/financial-data-terminals/factset/); [MarketIntelligenceTools](https://marketintelligencetools.com/reviews/factset/)

**AlphaSense (+Tegus)**
- Third-party pricing: median contract about $18k (range $12k-$51k), or $10k-$20k per seat a year. Vendr data shows multi-year discounts of 10-20% and renewal uplifts of 3-5% a year. ARR is reported above $600M as of Q1 2026. — [Allmind](https://allmind.ai/research/alphasense-pricing-2026); [MarketIntelligenceTools](https://marketintelligencetools.com/reports/alphasense-pricing/); [Marvin Labs comparison](https://www.marvin-labs.com/blog/ai-tools-for-equity-research-complete-platform-comparison/)
- Tegus: median contract about $30k. Custom expert calls cost about $450 an hour plus a $75 fee. Expert networks in general charge $525-$1,050 per call. — [MarketIntelligenceTools Tegus](https://marketintelligencetools.com/reports/tegus-pricing/); [Expert network cost](https://marketintelligencetools.com/reports/expert-network-cost/)
- Complaints: "price and price opacity the most common complaint, by a wide margin," and it is out of reach for teams with occasional needs. — [MarketIntelligenceTools review](https://marketintelligencetools.com/reviews/alphasense/); [G2 reviews](https://www.g2.com/products/alphasense/reviews)
- July 2026: AlphaSense integrated with Bipsync, with Bipsync as the "system-of-record" for internal knowledge. This shows AlphaSense does not own the internal research record. — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/07/14/3326983/0/en/bipsync-and-alphasense-integrate-to-put-clients-institutional-knowledge-inside-market-intelligence-workflows.html)

**Hebbia**
- Matrix grid analysis across large document sets, positioned for PE, credit and banking. An executive interview cited about $3k-$3.5k per seat for a lite tier and about $10k for the full product (single source). G2 reviewers call it expensive and non-transparent. Last priced round: $130M Series B (2024). — [G2 compare](https://www.g2.com/compare/alphasense-vs-hebbia-ai-2026-02-24); [aiagentsquare](https://aiagentsquare.com/compare/rogo-vs-hebbia); [GAII Institute](https://www.gaiiinstitute.com/research-updates/hebbia-coverage-update-21-oct-2026/)

**Rogo**
- $75M Series C (Jan 2026, $750M post-money, Sequoia). $160M Series D (Apr 2026, Kleiner Perkins, about $2B). Launched "Felix," an agent you can email, focused on IB deal production (CIMs, diligence memos). Reports 35,000+ professionals at 250+ institutions. Its OpenAI collaboration targets PE and hedge fund users. Pricing is unpublished, with estimates ranging from about $3.3k to $10k-$30k per seat. — [SiliconANGLE](https://siliconangle.com/2026/04/29/rogo-raises-160m-speed-financial-analysis-ai-agents/); [aiagentsquare](https://aiagentsquare.com/agents/rogo-ai); [Vantaige](https://vantaige.io/blog/rogo-ai-review-felix-investment-banking-2026)

**Brightwave**
- Founded 2023. $21M raised (Decibel, Point72 Ventures, OMERS). Has repositioned toward agent infrastructure (Tidebreak, an open-source desktop agent). No product posts since June 2026, according to a third-party rating site. — [GAII Institute](https://www.gaiiinstitute.com/companies/brightwave/)

**Daloopa**
- $47M Series C (May 2026; Brighton Park lead, with Squarepoint, Touring and Nexus). 160+ customers, including hedge funds, mutual funds, banks, Anthropic, OpenAI and Perplexity. Revenue more than doubled year on year. Pitches "reliable and auditable" structured fundamentals for AI. — [Finextra](https://www.finextra.com/newsarticle/47823/daloopa-raises-47m-to-power-data-layer-behind-ai-driven-finance); [AlleyWatch](https://alleywatch.com/2026/06/daloopa-structured-financial-data-infrastructure-ai-investment-research-thomas-li/)

**Aiera, Fintool**
- Aiera is a content layer (event and earnings-call transcripts) with an MCP server and connectors for Anthropic, OpenAI and Azure. — [Hebbia blog (competitor-authored)](https://www.hebbia.com/resources/rogo-competitors)
- Fintool is YC-backed LLM search and chat over SEC filings and transcripts for hedge funds, consultancies and banks. — [Marvin Labs comparison](https://www.marvin-labs.com/blog/ai-tools-for-equity-research-complete-platform-comparison/)

**Bridgewater AIA Labs**
- Bridgewater's AIA Labs strategy is reportedly above $5B AUM. With Thinking Machines Lab (published 30 June 2026), its fine-tuned document-filtering model reached 84.7% accuracy on six investor-workflow tasks at 13.8x lower cost per task than frontier models. It is an internal and fund capability, not a product sold to others. — [Hedge Fund Alpha](https://hedgefundalpha.com/news/bridgewater-thinking-machines-ai/); [HedgeCo](https://hedgeco.net/news/03/2026/bridgewater-dalios-principles-to-algorithmic-intelligence-the-road-to-5billion.html)

**Frontier labs as competitors**
- Anthropic (early May 2026): 10 finance agent templates (Cowork/Claude Code plugins and Managed Agents), Microsoft 365 add-ins, MCP connectors (FactSet, Morningstar, PitchBook, Daloopa, D&B, Fiscal AI, Verisk) and a Moody's MCP app. — [Anthropic](https://www.anthropic.com/news/claude-for-financial-services); [CFOtech](https://cfotech.news/story/anthropic-launches-ai-agents-for-financial-services); [GitHub anthropics/financial-services](https://github.com/anthropics/financial-services)

**Research management incumbents**
- Bipsync: AI (April 2025) adds summarization and smart tagging. Toro is a cited Q&A assistant over the firm's own research database. Integrations with Arch (Feb 2026) and AlphaSense (July 2026). The platform has a "Decision" content type, but no evidence of thesis kill criteria, calibration or bias analytics. — [Bipsync Toro](https://bipsync.com/blog/bipsync-launches-toro-an-ai-research-assistant-that-puts-institutional-knowledge-at-investors-fingertips/); [Bipsync AI](https://bipsync.com/blog/bipsync-introduces-bipsync-ai-to-transform-investment-research-processes/)

**Behavioral and process analytics**
- Essentia Analytics: Behavioral Alpha Benchmark (peer-reviewed in the Journal of Investing, Feb 2026) scores 7 decision types: picking, entry, sizing, scaling in, size adjusting, scaling out and exit. In Q2 2026, 81.2% of 207 portfolios destroyed value while scaling out, and the median score is still below the value-additive threshold. Essentia covers about $430B in assets, mainly long-only equity managers. It analyses trades after the fact and does not run a thesis or kill-criteria workflow. — [Essentia Q2 insight](https://www.essentia-analytics.com/26q2-ebab-insights/); [Essentia BAB](https://www.essentia-analytics.com/product/behavioral-alpha-benchmark/)

**Cross-cutting complaints**
- Hallucinations and data gaps: when a tool cannot compute a figure from the underlying data, it still gives a confident wrong answer (Hedgeweek, March 2026). Inaccurate outputs, privacy and cyber are the concerns surveys raise most. — [Hedgeweek](https://www.hedgeweek.com/hedge-funds-deploy-ai-for-speed-gains-in-research/)
- Broker-research licensing restricts LLM use. — [Substantive/Mondo Visione](https://mondovisione.com/media-and-resources/news/substantive-research-buy-side-ai-adoption-hindered-by-broker-research-licensing-2026716/)
- Alt-data quality has deteriorated, according to a third of buyers. — [Hedgeweek/Neudata](https://hedgeweek.com/news/ai-boom-raises-data-quality-concerns-for-hedge-funds)

### Inferences
- Every major vendor competes on finding and summarising information (search, documents, transcripts). None of the tools found tracks whether a held position's thesis is still valid, or scores the PM's own decision quality. Essentia comes closest on decision quality but works on trades after the fact, and Bipsync stores decisions without testing them.
- Incumbents are bundling AI into existing seats: ASKB comes with the Terminal, and FactSet AI is an add-on. A standalone "chat with filings" product, like Fintool's, is being commoditised by both incumbents and frontier labs. Differentiation has to come from proprietary workflow state (the Book, theses, journal, ledger).
- Data-layer players (Daloopa, Aiera, Moody's) are selling to LLMs through MCP. YouBank's MCP server is table stakes, and its edge depends on exposing the fund's own thesis and process data rather than public content.

### Gaps
- Canoe: no 2026 information surfaced. Canoe Intelligence is generally known as LP-side alternative-investment document and data automation, but this is **unverified in this session**.
- No 2026 primary-source user reviews from Reddit or Wall Street Oasis surfaced. User complaints rest on review aggregators, G2 and trade press.
- No published price for ASKB, FactSet AI, Hebbia Max, Rogo, Fintool, Aiera or Brightwave.
- No details found on OpenAI's finance-specific hedge-fund agents.

## 3. Which workflow steps are still manual or painful?

### Takeaway
Funds use AI mainly for productivity (summaries, search, document review), not for investment judgement. The remaining pain sits in linking data to the fund's own models and positions: model updates from filings, earnings-season volume, monitoring the book against the original thesis, capturing institutional knowledge, and compliance and supervision of AI use itself.

### Cited Findings
- Neudata 2026: 66% use AI/LLMs mainly for internal productivity and workflow efficiency, versus 31% for optimising investment strategies. "Funds trust AI with their workflow much more than they trust it with their alpha" (Daryl Smith). — [Neudata PR](https://www.prnewswire.com/news-releases/alternative-data-budget-confidence-hits-3-year-high-while-ai-returns-remain-efficiency-led--neudatas-2026-industry-report-302881291.html)
- Hedge funds mostly use AI for research and summarization, while investment decisions remain human-led. — [Hedgeweek](https://www.hedgeweek.com/hedge-funds-deploy-ai-for-speed-gains-in-research/)
- Coalition Greenwich (57 buy-side traders and PMs, Q1 2026, fixed income): the areas where AI is expected to have the most impact are data analysis (65%) and document review (47%). — [Greenwich blog](https://www.greenwich.com/blog/how-buy-side-thinks-ai-will-impact-fixed-income-markets)
- Earnings volume: more than 65% of S&P 500 Q2 2026 earnings calls cited "AI." — [FactSet Insight](https://insight.factset.com/sp-500-earnings-season-preview-q2-2026)
- Model updates: vendors describe extracting XBRL-tagged facts and mapping them to model line items, with analyst approval queues. This is vendor marketing, not survey evidence of pain. — [Marvin Labs](https://www.marvin-labs.com/blog/equity-research-in-2025-evolution-in-the-ai-era/); [Allmind](https://allmind.ai/research/ai-earnings-season-preparation). Daloopa's funding pitch rests on "AI's financial data problem" (unreliable figures from LLMs). — [FinTech Global](https://fintech.global/2026/05/28/daloopa-raises-47m-to-fix-ais-financial-data-problem/)
- Institutional knowledge: Bipsync's July 2026 AlphaSense integration exists to put "clients' institutional knowledge inside market intelligence workflows." This shows internal notes and decisions are still kept separate from external research tools. — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/07/14/3326983/0/en/bipsync-and-alphasense-integrate-to-put-clients-institutional-knowledge-inside-market-intelligence-workflows.html)
- Exit and sizing discipline: 81.2% of 207 portfolios destroyed value while scaling out (Q2 2026). Essentia's thesis is that payoff discipline on the way out matters more than hit rate. — [Essentia](https://www.essentia-analytics.com/26q2-ebab-insights/)
- An arXiv study of analysts finds AI can reduce forecast accuracy when analysts face heavy workloads. 55% of analysts surveyed express accuracy or bias concerns. — [arXiv 2512.19705](https://arxiv.org/pdf/2512.19705)
- Compliance: the SEC FY2026 exam priorities (released 17 Nov 2025) cover advisers' use of AI and automated tools, the accuracy of AI representations ("AI washing"), supervision, recordkeeping (Rule 204-2) and oversight of third-party AI vendors. Newly registered or never-examined advisers will be prioritised. — [Goodwin](https://www.goodwinlaw.com/en/insights/publications/2025/12/alerts-privateequity-pif-2026-sec-exam-priorities-for-registered-investment-advisers); [WealthManagement](https://www.wealthmanagement.com/regulation-compliance/sec-2026-examination-priorities-what-financial-services-firms-need-to-know); [Dorsey](https://www.dorsey.com/newsresources/publications/client-alerts/2025/12/sec-2026-examination-priorities)
- DDQ and AI: vendors warn about hallucination risk in AI-drafted DDQs (Sept 2026). — [GovernGPT (vendor)](https://www.governgpt.com/blog/fund-manager-ai-hallucination-ddq)

### Inferences
- The "monitor the book" step falls between tools. Research tools answer questions you ask, but nobody automatically checks each position's stated thesis against new filings, prices and insider activity. That makes daily kill-criteria checks a clear and distinct job.
- Under the SEC's priorities, regulators will expect funds to show which AI output informed which decision and how it was supervised. A tamper-evident research ledger connecting sources, AI outputs and decisions answers this directly, and new emerging-manager registrants are the ones prioritised for exams.
- PM-analyst handoffs and the reasoning behind decisions still live in notes systems (Bipsync, Notion, OneNote) that do not record forecasts as probabilities or measure them later.

### Gaps
- No survey quantified hours spent on model updates, earnings prep or PM-analyst handoffs specifically.
- No sourced evidence on Notion or OneNote usage share among hedge funds.
- The SEC FY2027 exam priorities, likely due around Nov 2026, were not checked.

## 4. What do recent surveys say about AI adoption and ROI on the buy side?

### Takeaway
Adoption is close to universal: 95% of hedge fund managers use Gen AI (AIMA 2025), 77% of firms have organisation-wide deployments (Substantive, July 2026), and 70% use AI in the front office (SimCorp 2026). The return is efficiency rather than alpha: only 17% credit AI with better investment performance (Neudata 2026).

### Cited Findings
- AIMA 2025 (*Charting the course*, about 150 managers): 95% use Gen AI, up from 86% in 2023. 58% expect more use inside the investment process, versus 20% in 2023 (that second figure is secondhand). 60% of investors are more likely to invest in a fund that puts meaningful budget into Gen AI. — [Opalesque](https://www.opalesque.com/711534/Hedge_funds_accelerate_Gen_AI_adoption_as_investor153.html); [AIMA 2023 PDF](https://www.aima.org/static/a4f9bc40-8c32-42e6-87f52bd89f6e1a82/How-hedge-funds-are-leveraging-Gen-AI-to-get-ahead.pdf)
- AIMA/Marex 2026 emerging managers: only 34% of investors call AI a core consideration when assessing managers. — [AIMA](https://www.aima.org/article/stacking-up-emerging-managers-2026.html)
- Neudata 2026: 56% measured a tangible return from AI in the past 12 months. 41% cite efficiency and 17% cite improved investment performance. — [Neudata PR](https://www.prnewswire.co.uk/news-releases/alternative-data-budget-confidence-hits-3-year-high-while-ai-returns-remain-efficiency-led--neudatas-2026-industry-report-302881293.html); [Alternative Fund Insight](https://alternativefundinsight.com/hedge-funds-struggle-to-turn-ai-adoption-into-alpha/)
- SimCorp 2026 InvestOps (200 buy-side executives, mostly asset managers, pensions and insurers): 70% successfully use AI to support the front office. — [SimCorp](https://www.simcorp.com/about-us/news/2026/two-thirds-managers-adopt-AI); [AMWatch](https://amwatch.com/AMNews/article18932624.ece)
- Substantive Research (Oct 2026): AI tooling spend is up 40% to 7% of research budgets, while total research budgets are flat. — [FOW](https://www.fow.com/insights/buy-side-research-budgets-flatline-as-ai-spending-rises-40)
- Coalition Greenwich Market Data 2026 (65 buy-side and 8 sell-side firms, May-Jun 2026): "emerging technologies demand trusted data." — [Greenwich](https://www.greenwich.com/market-structure-technology/market-data-2026-emerging-technologies-demand-trusted-data)
- Wealth management context: "AI budgets surge but ROI remains elusive." — [InvestmentNews](https://www.investmentnews.com/transformation/ai-in-wealth-management-budgets-surge-but-roi-remains-elusive/267540)

### Inferences
- Since nearly every fund has adopted AI, buyers will now ask whether it makes them better investors, and only 17% say yes. A product that measures decision quality (Brier calibration, disposition effect, goalposts moved) gives funds the evidence of AI ROI they currently lack.
- Allocators are not yet pricing AI in: only 34% say it is a core consideration. However, 60% favour funds that invest in it (AIMA 2025), so evidence of a disciplined process is a selling point in LP and DDQ conversations.

### Gaps
- Burton-Taylor, Opimas and BarclayHedge 2025/26 AI figures did not surface.
- The full AIMA 2025 and 2026 report texts could not be fetched.

## 5. Concrete unmet needs (gaps) that a product like YouBank could fill

### Takeaway
Competitors concentrate on searching and summarising external content. The underserved jobs concern the fund's own decisions: thesis monitoring, decision-quality measurement, audit trails, and cheap all-in-one coverage for small managers.

### Cited Findings (gap and evidence)
1. **Automated thesis and kill-criteria monitoring of the live book.** AI is used for productivity, not for decisions (66% vs 31%, [Neudata](https://www.prnewswire.com/news-releases/alternative-data-budget-confidence-hits-3-year-high-while-ai-returns-remain-efficiency-led--neudatas-2026-industry-report-302881291.html)). No surveyed vendor (AlphaSense, Hebbia, Rogo, ASKB) is positioned around position-level thesis validity, and Citadel had to build portfolio-specific risk and reading tools in-house ([Inflxd](https://media.inflxd.com/article/citadel-balyasny-push-proprietary-ai-deeper-into-analyst-and-pm-)). This gives non-pod funds a "Citadel-lite" opportunity.
2. **Decision-quality and AI-ROI measurement.** Only 17% credit AI with performance gains ([Neudata](https://alternativefundinsight.com/hedge-funds-struggle-to-turn-ai-adoption-into-alpha/)). 81.2% of portfolios destroy value when scaling out, and median decision skill is below the value-additive threshold ([Essentia](https://www.essentia-analytics.com/26q2-ebab-insights/)). Essentia is long-only, trade-based and runs after the fact. Calibration, disposition and stale-thesis metrics captured before the trade are not served.
3. **Auditable AI research trail for SEC exams.** FY2026 priorities cover AI use, AI representations, supervision, recordkeeping and third-party AI vendors, with focus on new registrants ([Goodwin](https://www.goodwinlaw.com/en/insights/publications/2025/12/alerts-privateequity-pif-2026-sec-exam-priorities-for-registered-investment-advisers)). Daloopa is raising on "auditable" AI data ([AlleyWatch](https://alleywatch.com/2026/06/daloopa-structured-financial-data-infrastructure-ai-investment-research-thomas-li/)). No research tool found offers a tamper-evident ledger linking sources, AI output and decisions.
4. **Affordable all-in-one desk for emerging managers.** The launch budget minimum is about $100k ([AIMA](https://www.aima.org/article/what-emerging-managers-get-wrong-when-launching-a-hedge-fund.html)), a 25bp fee gap equals the whole data budget ([Vibe Advisors](https://www.vibe-advisors.com/emerging-hedge-fund-fees/)), and breakeven is $82.9M ([AIMA](https://www.aima.org/article/stacking-up-emerging-managers-2026.html)). Meanwhile, seats cost $10k-$30k each at AlphaSense, Tegus, FactSet and Rogo, and price is the top complaint ([MarketIntelligenceTools](https://marketintelligencetools.com/reviews/alphasense/)).
5. **Grounded numbers rather than confident hallucinations.** Tools give confident wrong answers when the data is missing ([Hedgeweek](https://www.hedgeweek.com/hedge-funds-deploy-ai-for-speed-gains-in-research/)). Checking kill criteria directly against SEC XBRL facts, with a refusal when data is missing, addresses this.
6. **Fund-owned context exposed to general LLMs through MCP.** Funds already run Claude and ChatGPT firm-wide (77% organisation-wide deployments, [Substantive/Mondo Visione](https://mondovisione.com/media-and-resources/news/substantive-research-buy-side-ai-adoption-hindered-by-broker-research-licensing-2026716/); [Anthropic](https://www.anthropic.com/news/claude-for-financial-services)). The connector ecosystem (FactSet, Daloopa, Moody's, Aiera) covers public data, not the fund's own theses, journal and positions. Broker-research licensing also limits what can be fed in, which favours a fund's own first-party research.
7. **Institutional memory and PM-analyst handoffs tied to positions.** Bipsync and AlphaSense had to integrate to bring "institutional knowledge" into research ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/07/14/3326983/0/en/bipsync-and-alphasense-integrate-to-put-clients-institutional-knowledge-inside-market-intelligence-workflows.html)). A decision journal linked to the Book and to forecasts does this natively.
8. **LP and DDQ evidence of AI governance and process.** 60% of investors favour funds that invest in Gen AI (AIMA 2025, [Opalesque](https://www.opalesque.com/711534/Hedge_funds_accelerate_Gen_AI_adoption_as_investor153.html)), and vendors warn about hallucinated DDQ answers ([GovernGPT](https://www.governgpt.com/blog/fund-manager-ai-hallucination-ddq)). Drafting DDQ answers from the ledger and process metrics lets a fund prove its claims.

### Inferences
- The defensible position is a "system of record for decisions" with AI checks, rather than another research copilot, since search and summary are being bundled into Bloomberg and FactSet and offered by frontier labs.
- The AI investment committee and the Bloomberg-style terminal in YouBank compete directly with ASKB, Rogo, Hebbia and Claude agent templates, where differentiation is weakest.

### Gaps
- No direct user-voice evidence (Reddit or Wall Street Oasis) was retrieved on demand for thesis tracking or calibration tools, so demand for gaps 1, 2 and 7 is inferred from survey ROI data and vendor positioning.
- No willingness-to-pay data for process or behavioral analytics, and Essentia's pricing was not found.
