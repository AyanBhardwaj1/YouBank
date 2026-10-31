# Market and competitors: AI finance research and deal platforms (as of 31 Oct 2026)

Run: youbank-frontier-20261031, market track. Builds on, and does not repeat, `docs/research/studio-competitive-landscape.md` (Sept 2026, Excel and deck agents: Copilot, Claude for Excel, ChatGPT for Excel, Shortcut, Endex, Tracelight, Macabacus and others). Excel and deck agents appear here only where there is new evidence.

**Method and limits.** 38 distinct web searches, weighted to May–Oct 2026. The session's shared web-search budget ran out before searches on Rogo and Hebbia seat pricing and on MCP entitlements, so those gaps stay open. Direct page fetches were blocked by the session's network allow-list (vals.ai, affinity.co and arr.club all failed to resolve), so every claim below rests on search-result pages. Many of those pages are aggregators or SEO blogs. A claim is tagged **[UNVERIFIED]** when only an aggregator or low-quality page supports it, or when sources conflict. Model names such as "GPT-6 Astra" and "Claude Fable 5.1" are given as the sources report them.

---

## Executive summary (10 bullets)

1. **Capital is concentrating in a few finance-AI platforms.**
   - Rogo went from a $750M valuation in January 2026 ([Axios](https://www.axios.com/pro/fintech-deals/2026/01/28/sequoia-rogo-750m-valuation)) to about $2B in April 2026, on a $160M Series D led by Kleiner Perkins ([FF News](https://ffnews.com/newsarticle/rogo-raises-160m-series-d-to-scale-the-agentic-platform-for-finance/)).
   - AlphaSense raised $350M at $7.5B in June 2026 and reports more than $600M ARR ([RTTNews](https://www.rttnews.com/3657835/alphasense-secures-350-mln-at-a-7-5-bln-valuation-amid-strong-ai-growth.aspx)).
   - Hebbia has no new priced round since its 2024 valuation of about $700M ([agentmarketcap](https://agentmarketcap.ai/blog/2026/07/16/hebbia-130m-series-b-unicorn)).
2. **The frontier labs now sell finance products directly.**
   - Anthropic shipped 10 finance agent templates on 5 May 2026, with connectors to FactSet, PitchBook, Morningstar, MSCI, LSEG and S&P Capital IQ ([Markets Media](https://www.marketsmedia.com/anthropic-introduces-agents-for-financial-services/)).
   - OpenAI launched ChatGPT for Financial Services on 10 Sept 2026. It is sales-quoted only and bundles Daloopa, PitchBook, LSEG News and Crunchbase ([Latenode](https://latenode.com/news/openai-launches-chatgpt-for-financial-services-without-public-pricing)).
   - OpenAI also shipped Codex plugins for public-equity investing and investment banking on 2 June 2026 ([ai-tldr](https://ai-tldr.dev/releases/openai-codex-plugins-white-collar-jun2026/)).
3. **MCP is now the default way finance data is distributed.**
   - FactSet's MCP server has been live since December 2025 ([A-Team](https://a-teaminsight.com/blog/now-the-mcp-layer-is-commoditised-are-entitlements-the-next-challenge/?brand=ati)).
   - LSEG reports more than 150 customers connected to or onboarding onto its MCP server ([LSEG Q1 2026](https://www.lseg.com/en/media-centre/press-releases/2026/london-stock-exchange-group-plc-q1-2026-trading-update)).
   - PitchBook, Daloopa, Quartr and S&P all ship MCP connectors into Claude and ChatGPT.
   - Trade press already calls the MCP layer "commoditised".
4. **Incumbent terminals are adding agents, not losing users yet.** Bloomberg's ASKB reached general availability on 15 Oct 2026, after a beta that covered about 125,000 of 375,000 Terminal users. It lets users bring their own documents and chats ([Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/), [pulse.bot](https://www.pulse.bot/cio-pulse/news/bloomberg-terminal-launches-ai-chatbot-askb-for-125000-users-3d50229d-ae7b-4a71-880f-62044720aa28/)).
5. **The deal-CRM layer has turned agentic.**
   - Affinity launched Ascend in July 2026 with Meeting Prep, Warm Intros and Data Update agents for more than 3,300 firms ([Sovereign](https://www.sovereignmagazine.com/article/affinity-ascend-ai-agents-private-capital)).
   - Intapp launched Celeste in February 2026 and is partnering with Anthropic for DealCloud ([BusinessWire](https://www.businesswire.com/news/home/20260225298423/en/Intapp-announces-Celeste-Agentic-AI-for-professional-firms/)).
6. **Independent benchmarks show agents are still unreliable on finance work.**
   - Vals Finance Agent v2: the top score was about 52% in May 2026 ([KuCoin blog](https://kucoin.com/blog/can-ai-replace-financial-analysts-in-2026-vals-ai-finance-agent-v2-reveals-gpt-5-5-hits-just-52-percent-accuracy)) and about 61% in August, per AllMind [UNVERIFIED] ([AllMind](https://allmind.ai/research/ai-financial-research-benchmarks-explained)).
   - Vals Excel Modeling Benchmark: the top score was 76.7% on 19 Oct 2026, with Claude models taking the top three places ([search summary of vals.ai/benchmarks/emb](https://vals.ai/benchmarks/emb)).
7. **Prices split sharply between enterprise and prosumer tiers.**
   - Enterprise:
     - Bloomberg is about $32K per seat per year [UNVERIFIED, aggregator] ([Eulerpool](https://eulerpool.com/blog/bloomberg-terminal-cost)).
     - AlphaSense is about $10K–30K per seat per year [UNVERIFIED] ([Prospeo](https://prospeo.io/s/alphasense-pricing-reviews-pros-and-cons)).
     - Grata is about $12K–30K+ per year [UNVERIFIED] ([Prospeo](https://prospeo.io/s/grata-pricing-reviews-pros-and-cons)).
   - Prosumer:
     - Koyfin runs $0–299 per month ([PricingSaaS](https://pricingsaas.com/companies/koyfin)).
     - Perplexity Pro is $20 per month.
   - Very little is published between about $300 per month and about $10K per seat per year. That gap is where YouBank's $59–$299 plans sit.
8. **Boutiques adopt quickly but mostly use general tools.**
   - Boutique and middle-market banks (fewer than 500 staff) reportedly adopt AI faster than large banks ([CO/AI](https://getcoai.com/news/71-of-investment-bankers-now-use-chatgpt-survey-finds/)).
   - In one small sample, 71% of bankers used ChatGPT [UNVERIFIED, n=50].
   - Among PE and VC firms, AI use in investment decisions doubled from 13% to 28% in a year ([Affinity survey](https://affinity.co/blog/2026-private-capital-predictions)).
9. **Search funds, independent sponsors and emerging managers are a real but thin-wallet segment.**
   - Stanford tracks 850+ core search funds since 1996, and new launches remain near record highs ([Stanford GSB](https://gsb.stanford.edu/insights/search-funds-keep-offering-proven-path-ownership)).
   - A Searchfunder community post calls the segment "one of the most underserved spaces" for practical AI ([Searchfunder](https://searchfunder.com/post/what-if-deal-sourcing-took-hours-not-weeks)).
10. **Distribution is now multi-surface: agents meet users where they already work.**
    - Rogo's Felix agent takes work by email ([SiliconANGLE](https://siliconangle.com/?p=743784)).
    - Hebbia shipped an API and MCP server in Q3 2026 [UNVERIFIED] ([arr.club](https://www.arr.club/hebbia/hebbia-tripled-new-arr-record-q3-2026)).
    - Affinity's agents run "inside whichever AI environment their analysts prefer".
    - OpenAI claims ChatGPT apps reach 800M+ users ([Windows Report](https://windowsreport.com/openai-launches-chatgpt-app-directory-and-opens-apps-sdk-in-preview)).
    - No source quantified which channel wins finance users. That remains an open question.

---

## 1. AI-native finance research and agent platforms

### 1a. Funding, valuation, users and newest capability

| Company | Latest funding / valuation | Revenue / users | Target user and distribution | Newest 2026 capability |
|---|---|---|---|---|
| **Rogo** | $75M Series C at $750M, Jan 2026 ([Axios](https://www.axios.com/pro/fintech-deals/2026/01/28/sequoia-rogo-750m-valuation)); $160M Series D at about $2B, led by Kleiner Perkins, 29 Apr 2026 ([FF News](https://ffnews.com/newsarticle/rogo-raises-160m-series-d-to-scale-the-agentic-platform-for-finance/)); about $30M strategic round from five banks, Sept 2026 [UNVERIFIED] ([RevenueMemo](https://www.revenuememo.com/p/rogo-funding)) | ARR above $50M ([Crypto Briefing](https://cryptobriefing.com/rogo-arr-triples-50m-surpasses-hebbia/)); 35K–40K users, 250–300+ institutions (figures conflict) ([KuCoin](https://www.kucoin.com/news/flash/ai-financial-startup-rogo-raises-160m-valuation-surges-to-2b-in-3-months)) | Bulge-bracket and middle-market banks, PE; enterprise sales | Acquired Offset, which auto-updates financial models; launched **Felix**, an agent users can email, tailored to the user's role, that does CIM generation, screening and diligence, with an audit trail and access controls ([SiliconANGLE](https://siliconangle.com/?p=743784), [AI Agents Directory](https://aiagentsdirectory.com/blog/rogo-introduces-felix-an-ai-agent-for-financial-research-workflows)); a "Model Broker" for routing between models [UNVERIFIED] ([Distill](https://www.distillintelligence.com/news/rogo)) |
| **Hebbia** | Last priced round: $130M Series B at about $700M, 2024; a Feb 2026 "Series B-II" with no terms disclosed ([CB Insights](https://www.cbinsights.com/company/hebbia/financials)) | Record new ARR in Q3 2026; "5 new banks in one week" [UNVERIFIED] ([arr.club](https://www.arr.club/hebbia/hebbia-tripled-new-arr-record-q3-2026)) | Banks, asset managers, law firms | Q3 2026: **Max** (AI teammate), **Matrix 2.0** and an **API plus MCP server** [UNVERIFIED, secondary] ([arr.club](https://www.arr.club/hebbia/hebbia-tripled-new-arr-record-q3-2026)). A job-board page says Rogo, Harvey and Legora now match Hebbia's table workflows [UNVERIFIED] |
| **AlphaSense (+Tegus)** | $350M at $7.5B, 3 June 2026 ([RTTNews](https://www.rttnews.com/3657835/alphasense-secures-350-mln-at-a-7-5-bln-valuation-amid-strong-ai-growth.aspx)) | ARR above $600M in Q1 2026 ([AlleyWatch](https://www.alleywatch.com/2026/06/alphasense-ai-market-intelligence-enterprise-platform-samantha-greenberg/embed/)) | Corporates, buy side, consultants | **SuperAnalyst**: an always-on agent that monitors filings, pulls Tegus expert calls, flags sentiment shifts and drafts slides ([eWeek](https://www.eweek.com/fr/news/alphasense-7-5b-valuation-350m-funding/)); AI-run expert interviews to grow the Tegus library [UNVERIFIED] |
| **Brightwave** | $15M Series A, Oct 2024; $21M raised in total; no 2026 round found ([Brightwave](https://www.brightwave.io/blog/brightwave-secures-15m-series-a-to-scale-ai-powered-financial-research-platform)) | n/a | Buy-side research | No 2026 release found |
| **Samaya AI** | $43.5M led by NEA (dated 2025 by Pulse2; one listing says Feb 2026, so the date is in conflict) ([Yahoo](https://finance.yahoo.com/news/samaya-ai-startup-building-ai-130000831.html)) | Morgan Stanley named as a customer | Institutional research | No 2026 release found |
| **Bloomberg ASKB** | Inside the Terminal, about $32K per seat per year [UNVERIFIED] ([Eulerpool](https://eulerpool.com/blog/bloomberg-terminal-cost)) | About 125K of 375K users in beta (Apr 2026) | Terminal subscribers | Beta Feb 2026, then mobile in Aug 2026 ([FinTech Global](https://fintech.global/2026/08/19/bloomberg-extends-askb-ai-assistant-to-mobile-devices/)), then GA on 15 Oct 2026, with bring-your-own documents, data and IB chats ([AI Weekly](https://aiweekly.co/alerts/bloomberg-opens-askb-agentic-ai-interface-to-all-terminal-users-with-custom)) |
| **FactSet** | Public company | MCP Explorer beta: 45 firms, 800+ users ([ResearchPool](https://app.researchpool.com/company/fds-us3030751057-factset-research-systems-inc-mBcyvNiu3R/press/factset-research-systems-inc-fds-factset-meets-demand-for-ai-ready-data-first-to-announce-mcp-sans-inte-AUVNOl3w85)) | Institutions | Production MCP server since Dec 2025; Portfolio Analytics MCP in limited release, 26 June 2026 ([BriefGlance](https://briefglance.com/companies/factset-research-systems-inc/pulses/46620)) |
| **LSEG** | Public company | 150+ MCP customers (Q1 2026) ([LSEG](https://www.lseg.com/en/media-centre/press-releases/2026/london-stock-exchange-group-plc-q1-2026-trading-update)) | Institutions | "LSEG Everywhere" strategy; Microsoft partnership; data offered through Amazon Quick ([A-Team](https://a-teaminsight.com/blog/lseg-and-microsoft-deepen-partnership-to-power-ai-agents-with-financial-data/)) |
| **S&P Capital IQ Pro / Kensho** | Public company | n/a | Institutions | MCP servers on Capital IQ Pro; a "verified ChatGPT app"; a Claude connector ([A-Team](https://a-teaminsight.com/blog/sp-global-bets-on-agent-native-architecture-as-capital-iq-pro-consolidation-accelerates/)) |
| **Anthropic, Claude for Financial Services** | n/a | n/a | Banks, asset managers; plugins on all paid plans | 10 agent templates (pitchbook, KYC, earnings review, month-end close) as Cowork and Claude Code plugins, plus Managed Agents in beta; new data connectors ([CFOtech](https://cfotech.com.au/story/anthropic-launches-ai-agents-for-financial-services), [Celent](https://www.celent.com/en/insights/anthropic-launches-software-for-financial-services-may-2026)) |
| **OpenAI, ChatGPT for Financial Services** | No public price; sold by quote ([Latenode](https://latenode.com/news/openai-launches-chatgpt-for-financial-services-without-public-pricing)) | Built with Morgan Stanley and Evercore as design partners | Investment banking and equity research at enterprise scale | Built on "GPT-6 Astra"; bundles Daloopa, PitchBook, LSEG News and Crunchbase ([Pulse 2.0](https://pulse2.com/openai-launches-chatgpt-for-financial-services-with-gpt-6-astra-and-built-in-premium-data/)); Codex public-equity and IB plugins (2 June 2026) that use Quartr, Daloopa and S&P data (provider lists conflict) ([Bloomberg Law](https://news.bloomberglaw.com/tech-and-telecom-law/openai-plans-ai-tools-for-finance-legal-in-race-with-anthropic), [ai-tldr](https://ai-tldr.dev/releases/openai-codex-plugins-white-collar-jun2026/)) |
| **Perplexity Finance** | Pro at $20/month; Finance features largely free | n/a | Retail and prosumer investors | Financials linked to SEC filings, analyst ratings (Feb 2026); brokerage linking through Plaid (Mar 2026); insider and politician trade tracker; scheduled research tasks; free India data [mostly UNVERIFIED, secondary] ([secnews](https://www.secnews.gr/en/725424/perplexity-finance-ai-bloomberg-killer/), [Outlook Business](https://www.outlookbusiness.com/artificial-intelligence/perplexity-adds-live-transcripts-india-market-data-to-finance-dashboard-free-access-for-users)); Daloopa integration ([FF News](https://ffnews.com/newsarticle/daloopa-integrates-with-perplexity-to-bring-its-trusted-financial-data-layer-into-ai-research-workflows/)) |
| **Fiscal.ai (formerly FinChat)** | $10M Series A led by Portage, June 2025; about $11.75M raised in total ([Caplight](https://www.caplight.com/company/finchat)) | 350K+ clients claimed, June 2026 [UNVERIFIED] ([YesPress](https://yespress.io/products/finchat.md)) | Retail, prosumer and RIA users | Data plugin for ChatGPT and Codex (June 2026) [UNVERIFIED]; API and MCP sold separately from terminal plans ([QVeris](https://api.qveris.ai/guides/fiscal-ai-alternative)) |
| **Koyfin** | Private | n/a | Prosumers and RIAs | Plans: Free, Plus $39, Premium $79, Advisor Core $209, Advisor Pro $299 per month ([PricingSaaS](https://pricingsaas.com/companies/koyfin)); another tracker puts the top tier at $359 ([CostBench](https://costbench.com/software/financial-data-terminals/koyfin/)) |
| **TIKR** | Private | n/a | Retail value investors | Four tiers: Free, Plus, Pro, Ultimate ([TIKR support](https://support.tikr.com/hc/en-us/articles/5365166229659-What-are-the-different-plans-that-TIKR-offers)); about $15/month [UNVERIFIED] ([DEV](https://dev.to/pickuma/tikr-terminal-review-analyzing-65000-global-stocks-for-15-a-month-4epn)); its AI is said to lag Fiscal.ai's ([diyai](https://diyai.io/ai-tools/finance/best-equity-research-software/)) |
| **Daloopa** | $47M Series C led by Brighton Park, 28 May 2026; $101.4M raised in total ([Built In](https://builtin.com/articles/daloopa-raises-47m-series-c-20260601), [AlleyWatch](https://alleywatch.com/?p=162786)) | Revenue doubled year on year (company claim) | Data layer for AI tools | MCP connectors for ChatGPT, Claude, Perplexity and Rogo |
| **Captide** | Acquired by Model ML, 12 Feb 2026 ([BusinessWire via Observer-Reporter](https://stocks.observer-reporter.com/observerreporter/article/bizwire-2026-2-12-model-ml-buys-captide-to-give-financial-ai-agents-citable-corporate-disclosure-data)) | n/a | Data layer: filings made LLM-ready | Now part of Model ML ($75M Series A, Nov 2025, led by FT Partners ([FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/ai-start-up-model-ml-closes-75m-series-a-led-by-ft-partners))) |
| **Boosted.ai** | $8M Series A (date unconfirmed); $15M bridge, Nov 2024 ([A-Team](https://a-teaminsight.com/briefs/boosted-ai-raises-8-million-in-series-a-funding)) | n/a | Asset managers ("Alfa" agent) | No 2026 release confirmed |
| **Quartr** | About $10M round, Aug 2025 ([parsers.vc](https://parsers.vc/news/250807-quartr-secures-10-million--fueling-ai)) | 15K+ companies covered | Analysts; API customers | MCP in Claude and in OpenAI's Codex plugin; live transcripts streamed word by word; 38 MCP tools; requires Quartr Pro; API sold by quote ([Quartr](https://quartr.com/newsroom/press-release/quartr-is-now-available-in-openais-codex-via-mcp), [Barchart](https://www.barchart.com/story/news/3232892/best-mcp-servers-for-stock-data-in-2026)) |

### 1b. Notable entrants and moves in 2026

- **Model ML.** It raised $75M in its Series A and acquired Captide (Feb 2026) for citable disclosure data. It is aimed squarely at junior-banker deck and diligence work ([Bloomberg](https://www.bloomberg.com/news/articles/2025-11-24/ai-startup-raises-75-million-to-take-junior-bankers-grunt-work)).
- **Data vendors are going straight to the LLMs.**
  - PitchBook's connector in Claude has been generally available since Oct 2025 ([PitchBook](https://pitchbook.com/help/pitchbook-premium-connector-for-claude-by-anthropic)).
  - Its ChatGPT app was listed on 21 Apr 2026 ([getdrio](https://www.getdrio.com/app-tracker/pitchbook)).
  - PitchBook became a ChatGPT for Financial Services data partner on 10 Sept 2026 ([Finviz](https://finviz.com/news/390963/pitchbooks-private-market-intelligence-now-accessible-within-chatgpt-for-financial-services)).
- **What this means.** Proprietary datasets are now rented by every agent platform. The data alone no longer makes a moat for the app layer. What remains defensible is the workflow, memory and verification built around it.

---

## 2. Deal sourcing and relationship intelligence

| Product | 2026 AI/agent move | Price signal | Notes |
|---|---|---|---|
| **Affinity** | **Ascend** agent platform (late July 2026): Meeting Prep, Warm Intros and Data Update live at launch; agents planned for fundraising, sourcing, IC prep and monitoring; runs in Affinity or in the user's AI environment through MCP ([Sovereign](https://www.sovereignmagazine.com/article/private-capital-crm-affinity-launches-ascend-an-agent-platform-that-automates-investment-workflows)) | Not public | 3,300+ firms; claims 130B relationships, 177M people, 88M companies (vendor figures) |
| **Intapp DealCloud** | **Celeste** agentic platform (Feb 2026); Claude-powered industry agents through an Anthropic partnership ([BusinessWire](https://www.businesswire.com/news/home/20260224123640/en/Intapp-and-Anthropic-collaborate-to-bring-expert-AI-agents-to-highly-regulated-professional-firms)); a plain-English query-and-update demo of DealCloud at Amplify 2026 (GA unconfirmed) | Enterprise | Built for large regulated firms |
| **Grata (+SourceScrub)** | Combined with SourceScrub (Aug 2025), reportedly followed by a BlueFlame AI deal on 1 July 2026 [UNVERIFIED] ([Rework](https://resources.rework.com/es/tools/ai-tools/best-ai-tools-for-private-equity-2026)) | Grata about $12K–30K+ per year; SourceScrub about $10K–25K+ per year; Vendr median for Grata $155K [all UNVERIFIED] ([Prospeo](https://prospeo.io/s/grata-vs-sourcescrub), [CostBench](https://costbench.com/software/financial-data-terminals/grata/)) | 21M+ private companies |
| **Harmonic** | **Scout**, an agent for investors that maps markets and evaluates momentum ([harmonic.ai](https://harmonic.ai)) | Not public | 30M+ companies and 190M+ people (press kit). A reported $17.5M raise in 2026 is [UNVERIFIED] and may belong to a different "Harmonic" ([Signalbase](https://www.trysignalbase.com/news/funding/harmonic-raises-1000)) |
| **Specter** | Claims real-time private-market signals; 55M+ companies, 400+ VC funds as customers ([Specter](https://tryspecter.com/platform)) | Not public | No 2026 round confirmed |
| **Attio** | Acquired Inconvo (conversational analytics) on 7 July 2026; "Ask Attio" in Slack ([multiples.vc](https://multiples.vc/private-comps/attio)) | Self-serve SaaS | $52M Series B in Aug 2025, $116M raised in total ([Built In](https://builtin.com/articles/attio-raises-52m-series-b-20250827)) |
| **4Degrees** | No 2026 information surfaced in search | — | Gap in research |

**Takeaway.** The three agents Affinity launched first are prep, intros and data hygiene, which are relationship chores rather than investment judgement. They are sold to established firms at enterprise prices. The cheapest credible sourcing databases start around $10K per year [UNVERIFIED], which is out of reach for a searcher or a single-GP fund.

---

## 3. Prosumer, boutique and student segments

**Adoption evidence**
- Boutique and middle-market banks (fewer than 500 staff) reportedly have higher AI adoption than large banks. In a 50-person Farsight study, 71% of investment bankers used ChatGPT [small n] ([CO/AI](https://getcoai.com/news/71-of-investment-bankers-now-use-chatgpt-survey-finds/)).
- Among L&D leads at 15 global banks, 80% report using Microsoft Copilot ([Financial Edge](https://www.fe.training/?p=10093465)).
- Affinity surveyed 275 investors: AI in investment decisions rose from 13% to 28% year on year ([Affinity](https://affinity.co/blog/2026-private-capital-predictions)).
- Accordion surveyed 200 PE sponsors and 200 CFOs: 98% of sponsors prioritise AI, while 68% of CFOs are "unsure where to start" ([TechIntelPro](https://techintelpro.com/news/ai/enterprise-ai/accordion-survey-reveals-ai-adoption-divide-in-private-equity)).
- Mercer: 55% of 131 asset managers have AI in at least one investment process ([FinTech Global](https://fintech.global/2026/06/05/ai-adoption-surges-among-investment-managers-in-2026/)).
- A Finalis panel aimed at boutique banks splits their tools into vertical IB AI platforms (comp scraping, deck drafting) and general LLMs ([Finalis](https://www.finalis.com/blog/the-real-impact-of-ai-on-dealmaking-what-boutique-investment-banks-need-to-know-in-2026)).

**Segment sizes found**

| Segment | Size signal | Source |
|---|---|---|
| Search funds | 850+ core search funds tracked since 1996; launches "at historically high levels" in 2024–25; nearly 60% acquire a company | [Stanford GSB](https://gsb.stanford.edu/insights/search-funds-keep-offering-proven-path-ownership) |
| Emerging VC managers | 86 new venture funds raised $3.9B in Q1 2026 (Carta); established firms took 90.9% of Q1 capital [secondary] | [Pipeline Road](https://pipelineroad.com/blog/fundraising-outlook-2026), [Angel Investors Network](https://angelinvestorsnetwork.com/market-analysis/emerging-manager-debut-fund-boom-2026-data) |
| First-time PE funds | About $5.7B raised in 2025, down about 35% [secondary, cites PitchBook] | [Pipeline Road](https://pipelineroad.com/guide/state-of-capital-raising) |
| Investment-research software (TAM) | $4.1B in 2025, rising to $9.05B by 2031 (14.1% CAGR) [single vendor report, UNVERIFIED] | [Ken Research](https://www.kenresearch.com/industry-reports/global-investment-research-software-market) |
| Independent sponsors and solo GPs | Budget "free to under $20K a year" (buyer's guide, not research) [UNVERIFIED] | [Rework](https://resources.rework.com/tools/ai-tools/best-ai-tools-for-private-equity-2026) |

**Price bands seen across the market**
- **$0–20 per month:** Perplexity Pro, ChatGPT Plus, Claude Pro; TIKR (about $15 [UNVERIFIED]).
- **$39–$359 per month:** Koyfin tiers ([PricingSaaS](https://pricingsaas.com/companies/koyfin)); Shortcut Pro $100 (see the prior doc).
- **About $3K–5K per seat per year:** Rogo, about $3.3K (Sacra estimate, cited in the prior doc).
- **$10K–35K+ per seat per year:**
  - Grata and SourceScrub [UNVERIFIED]
  - AlphaSense [UNVERIFIED]
  - Bloomberg (about $32K) [UNVERIFIED]
  - Axial $5K–15K [UNVERIFIED] ([praxisrock](https://praxisrock.com/insights/pitchbook-alternatives))
- **Quote only:** ChatGPT for Financial Services, Quartr Pro and API, Grata, Hebbia.

**Students**
- Students mainly use chatbots for networking emails, interview prep and firm research.
- Interviews are moving toward questions about "a specific financial model" and the logic of a deal, to test real understanding ([Adventis](https://www.adventiscg.com/blog-articles/how-to-and-how-not-to-use-ai-for-investment-banking-recruiting)).
- Wall Street Prep says it teaches generative AI for data extraction and early modeling, while keeping manual auditing ([Featurespace page](https://www2.featurespace.com/wall-street-prep-w76q.html), low quality).
- General AI tools are giving students free plans, such as a free year of Gemini AI Pro and 12 months of Perplexity Pro for education [UNVERIFIED, SEO sources] ([SkillScouter](https://skillscouter.com/best-ai-tools-for-students/)).
- No finance-student adoption survey surfaced. The CFA Institute's 2025 graduate survey says finance is the top career choice ([InvestmentNews](https://www.investmentnews.com/practice-management/finance-back-in-favor-with-career-seeking-grads-but-ai-shakes-up-expectations/261151)).

---

## 4. Distribution shifts

| Channel | Evidence (2026) | Read |
|---|---|---|
| **ChatGPT apps (Apps SDK on MCP)** | App directory live, submissions opened Dec 2025; "800M users" (OpenAI's claim); in-chat monetisation limited to physical goods at first ([Windows Report](https://windowsreport.com/openai-launches-chatgpt-app-directory-and-opens-apps-sdk-in-preview), [Dataconomy](https://dataconomy.com/2025/12/18/chatgpt-might-break-app-stores-as-we-know-it)). PitchBook, S&P and Fiscal.ai are listed or have plugins | Reach and discovery, but no in-chat billing, so it works as a lead funnel to a paid web app |
| **Claude connectors and plugins** | 10 FS agent templates plus connectors to FactSet, PitchBook, Morningstar, MSCI, LSEG and S&P ([Markets Media](https://www.marketsmedia.com/anthropic-introduces-agents-for-financial-services/)); Quartr, Daloopa and PitchBook in Claude; Claude leads the Vals EMB | The finance-heavy agent surface; plugins are available on all paid plans |
| **OpenAI Codex plugins** | Finance plugins (2 June 2026); Codex has 5M+ weekly users ([StockTwits](https://stocktwits.com/news-articles/markets/equity/open-ai-launches-new-codex-tools-for-non-developers-sees-110-growth-in-data-analytics/cZ004UOReD9)) | A new surface for power users at hedge funds (e.g. Balyasny) |
| **Microsoft 365 Copilot / Excel Agent Mode** | Generally available on desktop since Jan 2026; scored 57.2% on SpreadsheetBench against 71.3% for humans (Microsoft's own figure); a step timeline for audits; needs a Copilot licence ([Computerworld](https://www.computerworld.com/article/4064781/microsoft-upgrades-m365-copilot-with-agent-mode.html), [The Neuron](https://www.theneuron.ai/explainer-articles/microsoft-just-turned-excel-into-your-personal-data-analyst)); 80% of global-bank L&D leads use Copilot | The default inside big banks, which already pay for Microsoft |
| **Incumbent terminals** | ASKB generally available on desktop and mobile; LSEG and FactSet expose data through MCP to Copilot, Claude and Amazon Quick | Incumbents are turning into data layers |
| **Email as agent interface** | Rogo Felix takes requests by email ([SiliconANGLE](https://siliconangle.com/?p=743784)) | Low-friction async agent work |
| **Browser agents** | Comet's agent mode is gated at $200/month Max; reviewers call Comet the "research" browser. The standalone ChatGPT Atlas browser was reportedly retired around Sept 2026, folded into ChatGPT and Codex [UNVERIFIED] ([digitalapplied](https://www.digitalapplied.com/blog/ai-browser-landscape-2026-atlas-comet-arc-dia), [Kanerika](https://kanerika.com/blogs/chatgpt-atlas-vs-perplexity-comet/)) | No evidence of finance-specific traction |

**Which channel is winning?** No source measured finance-user share by channel; this is an open gap. Indirect signals:
- Data vendors are prioritising MCP. LSEG has 150+ MCP customers, and every major data vendor now ships connectors into Claude and ChatGPT.
- Large banks standardise on Copilot.
- Trade press says "the MCP layer is commoditised" and that **entitlements** are the next fight ([A-Team](https://a-teaminsight.com/blog/now-the-mcp-layer-is-commoditised-are-entitlements-the-next-challenge/?brand=ati)).
- The best inference is that distribution goes **multi-homed**: a product must be callable from Claude, ChatGPT and Copilot and also keep its own app for state, memory and billing. [Inference, not a sourced fact.]

---

## 5. Where incumbents and new players are weak

1. **Accuracy on real finance tasks is mediocre.**
   - Vals Finance Agent v2: top score about 52% in May 2026 ([KuCoin](https://kucoin.com/blog/can-ai-replace-financial-analysts-in-2026-vals-ai-finance-agent-v2-reveals-gpt-5-5-hits-just-52-percent-accuracy)), about 60.6% in Aug 2026 [UNVERIFIED] ([AllMind](https://allmind.ai/research/ai-financial-research-benchmarks-explained)).
   - Finance Agent v1.1 archive: Claude Opus 4.7 at 64.37% ([BenchLM](https://benchlm.ai/benchmarks/valsfinanceagentv1)).
   - Vals Excel Modeling Benchmark (launched 1 July 2026; LBO, DCF and M&A models scored for correctness *and* usability): top score 76.73% (Claude Fable 5.1), with Sonnet 5.5 and Opus 5.5 next, as of 19 Oct 2026 ([vals.ai via search](https://vals.ai/benchmarks/emb), [LetsDataScience](https://letsdatascience.com/news/vals-ai-launches-excel-modeling-benchmark-for-finance-agents-6a2d5a85)). These are self-reported by Vals and have not been replicated.
   - Ankura's independent May 2026 test ranked Shortcut Pro above Claude for Excel ([Shortcut case page](https://mog.shortcut.ai/cases/shortcut-vs-claude-for-excel-ankura-office-of-the-cfo-benchmark)), a vendor-hosted page.
   - A Sept 2026 modeling benchmark put three Claude versions above OpenAI's models ([Bloomberg Línea](https://www.bloomberglinea.com/tecnologia/chatgpt-o-claude-cual-obtiene-mejores-resultados-en-modelos-financieros/)).
   - Research on grading models without a golden answer is emerging: GAUGE ([alphaXiv](https://www.alphaxiv.org/abs/2607.24889)).
2. **Hallucinated citations persist.**
   - Financial-literature citation hallucination: 20% for GPT-4 and 76.6% for Gemini Advanced ([arXiv 2411.07031](https://arxiv.org/pdf/2411.07031)).
   - In a 2026 single-prompt test, about half of GPT-4o's cited studies were fictitious ([IJEFI](https://www.econjournals.com/index.php/ijefi/article/view/24171)).
   - A May 2026 audit found major errors in AI wealth guidance ([InvestmentNews](https://www.investmentnews.com/transformation/ai-platforms-are-giving-ultra-wealthy-families-flawed-financial-answers-study-finds/266478)).
3. **Pricing is opaque and high.**
   - AlphaSense's most common complaints are cost and learning curve. It has no free plan, and pricing is "heavy for occasional users" ([Prospeo](https://prospeo.io/s/alphasense-pricing-reviews-pros-and-cons), [Toolradar](https://toolradar.com/tools/alphasense/pricing)).
   - ChatGPT FS, Grata, Quartr and Hebbia are quote-only.
   - Bloomberg adds exchange fees of $600–6,000+ per year on top of the seat [UNVERIFIED] ([CostBench](https://costbench.com/software/financial-data-terminals/bloomberg-terminal/hidden-costs)).
4. **Controls and entitlements are hard.**
   - Control requirements are "one of the bigger hurdles to enterprise adoption" for finance teams ([Rillet](https://rillet.com/blog/chatgpt-vs-claude-for-finance-leaders)).
   - MCP entitlement management across vendors is unresolved ([A-Team](https://a-teaminsight.com/blog/now-the-mcp-layer-is-commoditised-are-entitlements-the-next-challenge/?brand=ati)).
5. **Licensed-data gating.**
   - PitchBook in Claude needs seat or trial licences plus SSO ([PitchBook](https://pitchbook.com/premium-connectors/anthropic)).
   - Quartr MCP needs Quartr Pro.
   - Agents without licensed data fall back to the open web, which is the hallucination risk above.
6. **Little is built for small firms.** Affinity, DealCloud and Grata are designed for established firms. Searchers say the segment is underserved ([Searchfunder](https://searchfunder.com/post/what-if-deal-sourcing-took-hours-not-weeks)).

---

## Opportunities for YouBank

Ordered roughly by evidence strength × fit. Codebase paths are from the current tree (`src/lib/*`, `src/app/api/*`).

1. **Ship the remote MCP server and ChatGPT app with *provenance-first* free-data tools.**
   - Evidence: every data vendor now distributes through MCP (FactSet, LSEG with 150+ customers, PitchBook, Daloopa, Quartr, S&P), but behind licences that boutiques lack. The ChatGPT directory offers reach without in-chat billing.
   - The move: expose YouBank's EDGAR/XBRL, Form D and Treasury/BLS tools, each returning a filing and fact URL, as a free connector that funnels users to the Pro plan.
   - Touches: a new `src/app/api/mcp`, wrapping `src/lib/terminal`, `src/lib/edgar`, `src/lib/market`. This is the README roadmap item; this market evidence raises its priority to first.
2. **"Email the desk": async deal tasks by email.**
   - Evidence: Rogo's Felix takes work by email; email is the lowest-friction agent surface for bankers.
   - The move: a user forwards a CIM, 10-K or "screen these 20 names" to a YouBank address. The agent replies with a memo, comps and a Studio link.
   - Touches: `src/lib/crm/mailbox.ts`, `imap.ts`, `gmail.ts`, plus `src/lib/ai/agent.ts` and Inngest jobs.
3. **Relationship agents at boutique prices: Meeting Prep, Warm Intros, Data Hygiene.**
   - Evidence: Affinity Ascend's three launch agents are exactly these, sold to 3,300 established firms at enterprise prices.
   - The move: YouBank already has the mailbox graph and calendar briefs. Ship a warm-intro path finder (who in my team's mail graph knows X) and automatic contact enrichment and dedupe, on Pro and Deal Team.
   - Touches: `src/lib/crm/contacts.ts`, `insights.ts`, `knowledge.ts`, `src/lib/calendar`.
4. **An always-on coverage agent ("SuperAnalyst for one").**
   - Evidence: AlphaSense SuperAnalyst monitors filings and drafts slides; Perplexity offers scheduled research; Bloomberg ASKB is generally available.
   - The move: a watchlist agent that diffs each new 10-Q/8-K/Form 4 against the last one, scores the change, and drops a one-slide update into Studio and a morning brief.
   - Touches: `src/lib/news`, `src/lib/edge/alerts.ts`, `src/lib/edge/change.ts`, Inngest crons, `src/lib/studio`.
5. **Thesis-to-target-list sourcing for searchers, independent sponsors and emerging managers.**
   - Evidence: Grata and SourceScrub run about $10K–30K+ per year [UNVERIFIED] and are consolidating; Stanford tracks 850+ search funds with launches near record levels; Searchfunder calls the segment underserved.
   - The move: build target lists from Form D, state business registries, web and job-post signals, plus the Deal Radar sale-odds model. Draft outreach through the Relationships campaign engine, with cold-email compliance.
   - Touches: `src/lib/vc`, `src/lib/edge` (Deal Radar), `src/lib/edgar` (Form D), `src/lib/crm/campaigns.ts`.
6. **A public accuracy page and benchmark-driven model routing.**
   - Evidence: Vals Finance Agent v2 tops out around 52–61%; the Excel Modeling Benchmark top three are Claude models (about 76%); buyers cite accuracy as the main risk.
   - The move: run YouBank's agent on a public subset (Vals-style Finance Agent questions, EMB-style builds), publish the scores, and route modeling tasks to the best-scoring model family.
   - Touches: `src/lib/ai/route.ts`, `models.ts`, `src/lib/edge/calib`, plus a new `/accuracy` page.
7. **Every number clickable to its source, with a verify pass before sending.**
   - Evidence: citation hallucination is 20%+ in studies; Perplexity markets "auditable financials tied to SEC filings"; OpenAI FS is positioned as "source-traceable".
   - The move: make provenance visible and enforced across chat, memos and decks, not only in Studio. A sentence-level number check refuses to send any figure without a fact ID.
   - Touches: `src/lib/ai/research.ts`, `src/lib/memo.ts`, `src/lib/studio` (extend `tieOut`).
8. **Transparent pricing as a wedge.**
   - Evidence: ChatGPT FS, Grata, Quartr, Hebbia and AlphaSense are quote-only; Koyfin publishes $39–$299. YouBank's $59 Pro and $149 Deal Team sit between Koyfin Premium ($79) and Advisor Core ($209).
   - The move: publish a "cost of a deal desk" comparison (Bloomberg about $32K, AlphaSense about $10K–30K, Grata about $15K, against YouBank), with every figure caveated.
   - Touches: `src/app/pricing`, `src/lib/billing`.
9. **Bring-your-own-licence connector client.**
   - Evidence: ASKB lets users bring their own data; PitchBook, Daloopa, Quartr and FactSet expose MCP but require the user's own licence.
   - The move: let a Deal Team user attach their own PitchBook, Daloopa or Quartr MCP credentials so YouBank's agent can call them. YouBank becomes the workflow layer over whatever data the firm already licenses.
   - Touches: `src/lib/ai/tools.ts`, settings, `src/app/api/settings`.
10. **Live earnings-call desk.**
    - Evidence: Quartr streams live transcripts word by word through MCP; OpenAI's Codex public-equity plugin does post-earnings analysis.
    - The move: combine YouBank's existing Call Desk evasion scoring with a live or near-live transcript feed, and send a 15-minute post-call brief plus model-update suggestions into Studio.
    - Touches: `src/lib/edge/calls`, `src/lib/studio`.
11. **A Campus plan built for interviews, not just a free tier.**
    - Evidence: interviews now probe understanding of "a specific financial model"; Wall Street Prep teaches AI with manual auditing; general AI tools give students free years [UNVERIFIED]. A free plan alone does not stand out.
    - The move: a .edu Campus plan with an "explain and defend this model" drill. The agent builds an LBO or DCF, then quizzes the student cell by cell, which also feeds the adaptive engine.
    - Touches: `src/lib/billing` (Campus), `src/lib/ai/persona.ts`, `src/lib/studio`.
12. **A compliance-grade agent action ledger.**
    - Evidence: controls are "one of the bigger hurdles"; Rogo pairs Felix with an audit trail and access controls; Copilot Agent Mode shows a step timeline; MCP entitlements are the next fight.
    - The move: an exportable per-run ledger (tools called, data sources, model, outputs, approvals) with team-level permissions on agent actions, ahead of SOC 2 Type I.
    - Touches: the usage ledger in `src/lib/ai/usage.ts`, `src/lib/teams`, autonomy certification in `src/lib/crm/engine.ts`.

---

### Open gaps (not resolved this run)

- Rogo and Hebbia seat pricing, beyond the Sacra estimate in the prior doc.
- 4Degrees' 2026 activity.
- First-hand data on which channel (ChatGPT, Claude, Copilot or a standalone app) wins finance users.
- A finance-student AI adoption survey.
- Primary confirmation of Hebbia's Q3 2026 launches and of the Grata/BlueFlame deal.

The search budget ran out, and fetches to vals.ai, affinity.co and arr.club were blocked by the session's network allow-list. Allowing those hosts and running a follow-up would close several of these gaps.
