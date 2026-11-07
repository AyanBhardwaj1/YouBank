# Frontier AI Capabilities (2025-2026) for Investment Research and Portfolio Management

Researcher notes, current as of 2026-11-07. Method note: web search worked, but direct page fetches to arxiv.org, vals.ai and forum.effectivealtruism.org were blocked by this session's network policy. So most findings below come from search-result abstracts and snippets of primary sources, not full-text reads. Figures from 2026 preprints have not been independently verified unless stated. Labels used: [PEER-REVIEWED], [PREPRINT], [VENDOR/SELF-REPORTED], [SECONDARY].

## 1. LLM forecasting and stock/earnings prediction: what holds up out of sample?

### Takeaway
On general event forecasting, the best LLM systems are now at or near statistical parity with superforecasters and Metaculus Pros. Top humans still lead on point estimates, but the gap is no longer statistically significant. They still trail liquid market prices, and a model blended with the market beats the market alone. On stock and earnings prediction, the strongest results (Kim/Muhn/Nikolaev 2024, Lopez-Lira/Tang 2023) hold up only partially once tested after the training cutoff. Edges are small, concentrated in small caps and bad news, and tend to disappear in clean post-cutoff windows. The durable product edge is calibration and aggregation tooling, not "the LLM picks stocks".

### Cited Findings
**General forecasting benchmarks**
- ForecastBench (FRI), January 2026 update: superforecasters still ranked #1, ahead of the best LLMs by 0.017 Brier points, which FRI said equals about one year of LLM progress. FRI extrapolated parity around November 2026 (95% interval Jan 2026 to Nov 2027). — [FRI Substack](https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human); [ForecastBench paper, Wharton-hosted 2026 version](https://faculty.wharton.upenn.edu/wp-content/uploads/2026/02/ForecastBench_A_Dynamic_.pdf) [PEER-REVIEWED, ICLR 2025 original: arXiv 2409.19839](https://arxiv.org/pdf/2409.19839)
- In July 2026, ForecastBench's own blog reportedly said AI models had "likely reached parity" with superforecasters. A Lightning Rod post of 8 July 2026 placed Gemini, the "Cassi" ensemble and Foresight-v3 inside the superforecasters' confidence interval, with the superforecaster median still #1. — [Lightning Rod](https://blog.lightningrod.ai/p/ai-reaches-human-superforecaster-range); [ForecastBench about](https://www.forecastbench.org/about/). Conflicting: a Parallect summary of the ForecastBench working paper says superforecasters still significantly outperform the top LLM on mean Brier and t-tests. — [Parallect May 2026](https://parallect.ai/reports/ai-superforecasters-forecastbench-may-2026-895525)
- Bridgewater AIA Labs, "AIA Forecaster: Technical Report" (arXiv 2511.07678, Nov 2025) [PREPRINT/VENDOR]. The system has three parts: agentic search over high-quality news, a supervisor agent that reconciles disparate forecasts for the same event, and statistical calibration to counter LLM behavioural biases. It claims a ForecastBench score "indistinguishable from superforecasters". On a harder benchmark built from liquid prediction markets it lags market consensus slightly, but an ensemble of AIA plus market consensus beats consensus alone. A modest live sample is described as "highly competitive" with markets. — [arXiv 2511.07678](https://arxiv.org/html/2511.07678v1)
- A May 2026 synthesis of 11 analyses (EA Forum/LessWrong) says parity claims "have not been evaluated with the rigor needed to rule out leakage or statistical noise". It treats the AIA report's evidence as retrospective/backtested, while calling it the best effort so far. — [EA Forum](https://forum.effectivealtruism.org/posts/Spyz3wESZu2eeqhDj/ai-forecasting-in-2026-what-11-analyses-say); [LessWrong mirror](https://www.lesswrong.com/posts/a82q6yd8zKpYk56cF/ai-forecasting-in-2026-what-11-analyses-say)
- Metaculus AI Benchmark / FutureEval:
  - Q2 2025: Pros significantly beat bots (p = 0.00001). The best bot was OpenAI o3. — [EA Forum Q2 2025](https://forum.effectivealtruism.org/posts/F2stjK9wHSy3HPEC9/q2-ai-benchmark-results-pros-maintain-clear-lead)
  - Spring 2026: 10 Pros vs the top 10 bots, with 173 bots on 297 scored questions. Pros led by a head-to-head score of -1.25, which was not statistically significant. — [Metaculus FutureEval methodology](https://www.metaculus.com/futureeval/methodology/); [Metaculus on X](https://x.com/metaculus/status/2095608079991894293)
  - Summer 2026: the Pro lead was again not significant. — [Metaculus GitHub PR #5292](https://github.com/Metaculus/metaculus/pull/5292)
  - A bot reportedly beat every human in the Summer 2026 Metaculus Cup [SECONDARY]. — [explainx](https://explainx.ai/blog/ai-beats-forecasters-metaculus-cup-coverage-2026)
- Prophet Arena (UChicago SIGMA lab and Kalshi; ICLR 2026) [PEER-REVIEWED]. This live benchmark adds about 20 new events daily and scores both Brier and simulated betting P&L against Kalshi prices. A secondary summary says most models beat the average Kalshi human on calibration and profit, but all are worse than the best humans. — [ICLR 2026 paper](https://proceedings.iclr.cc/paper_files/paper/2026/file/aec5e2847c5ae90f939ab786774856cc-Paper-Conference.pdf); [leaderboard](https://www.prophetarena.co/leaderboard/forecast); [ML Safety Newsletter](https://x.com/ml_safety/article/1968005866562740251)
- Prediction Arena (arXiv 2604.07355) [PREPRINT] ran six frontier models trading real capital for 57 days (12 Jan to 9 Mar 2026). Final Kalshi returns ranged from -16.0% to -30.8%. Cohort 1 averaged -1.1% on Polymarket versus -22.6% on Kalshi. — [arXiv 2604.07355](https://arxiv.org/html/2604.07355v1)
- Schoenegger et al., "Wisdom of the Silicon Crowd" (Science Advances, 2024) [PEER-REVIEWED]. An ensemble of 12 LLMs on 31 binary questions was statistically indistinguishable from a crowd of 925 human forecasters. — [Science Advances](https://www.science.org/doi/10.1126/sciadv.adp1528)

**Stock and earnings prediction**
- Kim, Muhn & Nikolaev, "Financial Statement Analysis with LLMs" (2024) [WORKING PAPER, widely cited]. GPT-4 was given anonymized, date-free statements. With chain-of-thought it predicted the direction of earnings changes with about 60.35% accuracy, beating analysts' one-month-ahead consensus. A simple prompt managed only about 52%, on par with consensus. Both the model and analysts struggle with small and loss-making firms, and the authors call them complementary. They ran an out-of-training-window test. — [arXiv 2407.17866](https://arxiv.org/html/2407.17866v1); [Kim et al. PDF](https://www.bayes.citystgeorges.ac.uk/__data/assets/pdf_file/0009/799794/Alex-Kim_Financial_Statement_Analysis_with_Large_Language_Models__2024_-6.pdf)
- Critiques of Kim et al.: anonymization may not prevent firm re-identification from distinctive ratio patterns, and the chain-of-thought prompt may steer the model toward ratios already known to predict earnings. — [Continuum Labs commentary](https://training.continuumlabs.ai/continuum-applications/discussion-and-use-cases/financial-statement-analysis-with-large-language-models). I found no standalone independent replication.
- Contrary evidence: Li, Tu & Zhou (2023) found GPT-4 earnings forecasts had larger errors than consensus and were more optimistic. — [Scoping review, arXiv 2412.05731](https://arxiv.org/pdf/2412.05731)
- Gao, Jiang & Yan, "Detecting Lookahead Bias in LLM Forecasts" (arXiv 2512.23847) [PREPRINT]. Using Llama-3.3-70B's December 2023 cutoff, the apparent memorization-driven predictive effect "collapses sharply" in the year after the cutoff. Post-cutoff windows are short, so statistical power is low. — [arXiv 2512.23847](https://arxiv.org/html/2512.23847v2)
- Liang (SSRN): GPT-4's monthly stock-price forecast errors are about 16% lower before its knowledge cutoff than after, which is evidence of leakage in naive backtests. — [SSRN](https://papers.ssrn.com/sol3/Delivery.cfm/6772819.pdf?abstractid=6772819&mirid=1&type=2)
- Glasserman & Lin (2023): out-of-sample LLM headline-sentiment signals are immune to look-ahead bias but not to a "distraction effect" from general knowledge about the company. Anonymizing names helps. — [arXiv 2309.17322](https://arxiv.org/pdf/2309.17322)
- arXiv 2602.09504 [PREPRINT]: GPT-generated "goal-aware" competition scores predict earnings in-sample but show no out-of-sample generalization after the cutoff. — [arXiv 2602.09504](https://arxiv.org/pdf/2602.09504)
- Lopez-Lira & Tang, "Can ChatGPT Forecast Stock Price Movements?" Headline-sentiment predictability is concentrated in small stocks and after negative news, which suggests limits to arbitrage. — [arXiv 2304.07619](https://arxiv.org/pdf/2304.07619)
- AEA 2026 paper "What Does ChatGPT Make of Historical Stock Returns?" uses a post-cutoff window (Mar to Nov 2024, after GPT-4o's Dec 2023 cutoff). It finds that LLM forecasts extrapolate recent returns with a decaying-lag pattern, i.e. LLMs behave like extrapolative retail investors. — [AEA 2026](https://www.aeaweb.org/conference/2026/program/paper/zNrQ4Yn6)
- 2026 preprints treat look-ahead bias as the field's central methodological problem: "Summoning the Oracle to Slay It" (arXiv 2605.24564) and "Does Training on Future Data Pay?" (arXiv 2609.20554). — [arXiv 2605.24564](https://arxiv.org/pdf/2605.24564); [arXiv 2609.20554](https://arxiv.org/pdf/2609.20554)

**Earnings-call tone and voice** (see also Q3)
- "Voice vs. tone" (ScienceDirect, 2026) uses a large audio language model to measure the mismatch between vocal and textual tone. Higher mismatch is associated with lower short-window returns and more pessimistic analyst revisions, but long-horizon return prediction is weak. — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0890838926001642)
- A text-only conference-call model can predict earnings surprises "with reasonable accuracy" (ACL Findings 2023). — [ACL 2023](https://aclanthology.org/2023.findings-acl.520.pdf)

### Inferences
- **Capability A: calibrated probability engine for kill criteria and theses.**
  - What it enables: an AIA-style pipeline (retrieval agents, a supervisor reconciling several forecasts, then post-hoc calibration such as Platt scaling or extremization) attached to each Book thesis. It outputs a daily probability that each kill criterion triggers, scored by Brier against outcomes.
  - Evidence: the strongest of anything in these notes (ForecastBench, Metaculus, AIA).
  - Limits: the evidence is on general geopolitical/economic questions, not firm-specific ones. Systems trail liquid markets.
  - Build difficulty: medium.
  - YouBank fit: it already has Brier calibration, so this is a natural, differentiated extension: "AI second forecaster vs. PM, scored over time".
- **Capability B: market-blended forecasts.**
  - What it enables: a blend of the model's probability with market-implied probabilities (options-implied moves, prediction markets, consensus), which beats either alone.
  - Evidence: AIA's ensemble result.
  - Limits: few firm-level prediction markets exist.
  - Build difficulty: medium.
- **Capability C: post-cutoff evaluation as a product feature.**
  - What it enables: because look-ahead bias inflates naive LLM backtests (Liang, Gao et al., 2602.09504), YouBank can label every signal test as "post-model-cutoff only", backed by its tamper-evident ledger. That is real trust edge versus vendors marketing in-sample backtests.
  - Build difficulty: low to medium.
- Do not build an "LLM picks stocks" feature. The out-of-sample evidence is thin, small-cap concentrated and decaying, and live trading agents lost money on Kalshi.

### Gaps
- I could not read the full live ForecastBench leaderboard as of November 2026 (fetches blocked). Whether parity is formally declared remains contested.
- No independent replication of Kim et al. was found, and no 2025-2026 paper testing frontier models post-cutoff against analyst consensus on earnings direction.
- I found no rigorous published evidence on LLMs predicting analyst estimate revisions from text alone (as opposed to audio mismatch).

## 2. Agentic research: what is possible now that was not in 2024?

### Takeaway
Three things changed between 2024 and 2026:
- Agents now sustain multi-hour autonomous work. METR 50% time horizons of about 16 hours are reported for top early-2026 models, with doubling every ~4 months.
- MCP became the standard data plumbing. FactSet, LSEG, S&P Capital IQ (Kensho), Morningstar, PitchBook and Moody's ship MCP connectors into Claude, and MCP Apps (Jan 2026) lets servers render interactive UI inside Claude, ChatGPT and VS Code.
- Finance-agent benchmarks show top models answering about two-thirds of real analyst research tasks, and only about a third of modelling tasks.

### Cited Findings
- **METR time horizons** [SECONDARY reports of METR data; check METR directly]
  - The doubling time was originally about 7 months (2019-2025). METR Time Horizon 1.1 (Jan 2026) put the post-2023 doubling time at about 130 days. — [Wikipedia: METR](https://en.wikipedia.org/wiki/METR); [arXiv 2505.05115](https://arxiv.org/pdf/2505.05115)
  - Claude Mythos Preview reportedly reached a 50% horizon of 16+ hours and an 80% horizon of about 3h06m. METR says measurements above about 16h are unreliable with the current task suite. — [Wikipedia: METR](https://en.wikipedia.org/wiki/METR); [SQ Magazine](https://sqmagazine.co.uk/ai-agent-autonomy-statistics/); [AI 2027 tracker](https://ai2027-tracker.com/predictions/metr-doubling/)
  - The 80% reliability horizon is much shorter than the 50% horizon. — [ODSC](https://opendatascience.com/ai-agent-task-horizon-workforce-planning/)
- **Vals AI Finance Agent benchmark** (real-world financial research tasks; paper arXiv 2508.00828) [THIRD-PARTY BENCHMARK]
  - v2.1 (updated 5 Nov 2026): Claude Opus 5.5 at 67.85%, Gemini 4 Argon 67.66%, "Wonder Full" 67.58%, Claude Sonnet 5.5 67.28%, Gemini 4 Carbon 67.16%. Cost per test runs from $8.91 (top model) down to $0.18 (Inkling 2 Small, about 0.3 points behind). — [Vals Finance Agent v2.1](https://www.vals.ai/benchmarks/fabv2-1); [paper](https://arxiv.org/pdf/2508.00828)
  - v2 (29 Oct 2026): Gemini 4 Argon led at 65.40%. Financial Modeling was the hardest category, with the top score at 34.52%. — [Vals v2](https://www.vals.ai/benchmarks/fabv2)
  - v1.1 (June 2026): Claude Opus 4.7 led at 64.37%. Versions are not directly comparable. — [Vals v1.1](https://www.vals.ai/benchmarks/finance_agent)
  - A separate benchmark, FrontierFinance (arXiv 2608.11683), targets harder frontier finance-agent tasks. — [arXiv 2608.11683](https://arxiv.org/pdf/2608.11683)
- **Finance data vendors on MCP**
  - Anthropic's `financial-services` repo lists remote MCP endpoints for Morningstar, S&P Global, FactSet and LSEG, with partner-built plugins from LSEG and S&P Global. — [GitHub anthropics/financial-services](https://github.com/anthropics/financial-services)
  - Anthropic's product page lists connectors for LSEG, FactSet, S&P Capital IQ, Morningstar, PitchBook, Moody's, Dun & Bradstreet, Daloopa, Box, Databricks and Snowflake [VENDOR]. — [Claude financial services](https://claude.com/solutions/financial-services)
  - The S&P Capital IQ connector is reportedly Kensho's MCP server [SECONDARY]. LSEG announced its Anthropic collaboration on 27 Oct 2025 [SECONDARY]. — [globaldatabase.com](https://www.globaldatabase.com/top-mcp-financial-data-providers-for-claude); [GitHub article](https://github.com/danielithomas/AI-Articles/blob/main/articles/claude-for-financial-services-20260619.md)
  - Morningstar's Q1 2026 shareholder letter cites its collaboration with Claude for Financial Services. — [SEC 8-K](https://www.sec.gov/Archives/edgar/data/0001289419/000128941926000026/morningstarq126ceoletter.htm)
  - Bloomberg is listed as a Claude connector by some SEO blogs, but I found no official confirmation. Treat it as unverified.
- **MCP Apps** (SEP-1724, extension id `io.modelcontextprotocol/ui`)
  - Launched 26 Jan 2026 as the first official MCP extension. Servers can deliver interactive UIs that run in sandboxed iframes and talk to the host through logged messages. Claude, ChatGPT, Goose and VS Code supported it at launch. — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/); [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx); [VS Code blog](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support)
- **MCP scale and spec** [SECONDARY]: more than 10,000 MCP servers reportedly deployed in production by mid-2026. A spec revision finalized 28 Jul 2026 reportedly makes MCP stateless at the protocol layer. — [Wikipedia: MCP](https://en.wikipedia.org/wiki/Model_Context_Protocol)

### Inferences
- **Capability D: overnight "thesis audit" agents.**
  - What it enables: multi-hour autonomous runs, newly feasible in 2026. Each night an agent re-underwrites every Book position: pull the new XBRL, transcripts and insider Form 4s, re-score kill criteria, draft a memo diff. The 80% horizon (about 3h) is the safer design target than the 50% horizon.
  - Build difficulty: medium. The hard parts are checkpointing and verification, not the model.
- **Capability E: MCP Apps for YouBank's own MCP server.**
  - What it enables: instead of returning text, the server renders the Book, kill-criteria status, VaR panels and calibration curves as interactive widgets inside Claude and ChatGPT. Because this is new (Jan 2026), few research tools ship it yet, so early-mover distribution edge is plausible.
  - Build difficulty: low to medium.
- **Capability F: bring-your-own-entitlement composition.**
  - What it enables: since FactSet, S&P, LSEG and Morningstar MCP endpoints exist, YouBank can act as the process layer (theses, journal, calibration, ledger) that sits on top of the user's licensed data, rather than competing on data. This is a structural positioning edge.
- Benchmark ceilings are a product signal. Even the best agents get about a third of financial-modelling tasks wrong (v2 Financial Modeling category, top 34.52%), so YouBank should present agent output with verification surfaces, not as finished models.
- Cost spreads are huge ($0.18 to $8.91 per task at near-identical accuracy), so model routing is a margin lever.

### Gaps
- I did not verify agent-to-agent protocol (A2A) status or governance in 2026. Search returned nothing usable.
- I did not find quantified evidence on computer-use agents in terminals or vendor UIs, or on "deep research" mode accuracy for finance specifically.
- The Vals pages could not be fetched, so category breakdowns for v2.1 and failure-mode commentary are missing.

## 3. Multimodal and real-time: earnings calls, voice, charts and tables, alternative data

### Takeaway
Audio adds real, peer-reviewed-adjacent signal on top of transcripts, especially the mismatch between voice and text, evasiveness, and short-window returns and revisions. Long-horizon return value is weak. Multimodal table and chart reading is reliable for single-document extraction but brittle in multi-step and cross-document analysis. Accuracy falls roughly 14-19% when moving from single-document to cross-company or cross-year tasks. The evidence that LLM-extracted alternative data predicts returns is thin. The best evidence is LLMs fusing alternative data streams to forecast revenue or labour metrics.

### Cited Findings
- **Earnings-call audio**
  - Netspar Industry Paper 2025-15 (deep speech embeddings): vocal cues in the first ~4 seconds of prepared-remark introductions, and the first ~10 seconds of Q&A answers, carry predictive power for the sign of future returns. — [Netspar](https://www.netspar.nl/wp-content/uploads/Netspar-Industry-Paper-2025-15-WEB.pdf)
  - "Voice vs. tone" (2026, journal): a large audio language model measures voice-text mismatch. Higher mismatch goes with lower short-window returns and more pessimistic analyst revisions, in both good-news and bad-news settings. Long-horizon prediction is weak. — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0890838926001642)
  - "Listen Closely: Measuring Vocal Tone in Corporate Disclosures": vocal tone in linguistically neutral sentences predicts future earnings changes and partly explains return drift (venue unclear). — [ResearchGate](https://www.researchgate.net/publication/395389040_Listen_Closely_Measuring_Vocal_Tone_in_Corporate_Disclosures)
  - CEO vocal-cue models predict analyst recommendation changes, unexpected earnings and abnormal returns with 60-65% accuracy. — [AFA paper listing](https://afajof.org/management/viewp.php?n=65996)
  - "Lie to me" (arXiv 2609.13893) [PREPRINT, verify]: an LLM judge on Q&A text fused with a conversational audio encoder detects managerial evasiveness. Reported AUROC is about 0.89 for predicting SEC late filings, versus 0.55 for text alone. — [arXiv 2609.13893](https://arxiv.org/pdf/2609.13893)
- **Tables and charts in filings**
  - Fin-RATE (Feb 2026) [PREPRINT]: across 17 LLMs on SEC filings, accuracy drops about 14-19% from single-document to cross-company or cross-year tasks. — [arXiv 2602.07294](https://arxiv.org/html/2602.07294)
  - LREC 2026 workshop, "When Tables Go Crazy" (SCRIBE FINANCE): vision-language models are reliable for well-defined extraction on French financial documents but brittle in multi-step analysis. — [LREC 2026](https://lrec.elra.info/lrec2026-ws-fnp-02)
  - MMFCTUB (arXiv 2601.04643) tests multimodal LLMs on linked credit-report tables. — [arXiv 2601.04643](https://arxiv.org/pdf/2601.04643)
  - FinTagging is a benchmark for XBRL-style extraction and structuring. — [arXiv 2505.20650](https://arxiv.org/html/2505.20650v1)
- **Alternative data**
  - "Making Alternative Data Work: Context-Augmented LLMs for Financial Forecasting" (arXiv 2609.11607) [PREPRINT]: LLMs fuse card spending, web traffic, foot traffic and prediction-market data to forecast firm revenue. — [arXiv 2609.11607](https://arxiv.org/html/2609.11607v1)
  - LLMs forecasting labour-market changes from real-time job-posting streams (arXiv 2510.23358). — [arXiv 2510.23358](https://arxiv.org/html/2510.23358v1)
  - Supply-chain propagation of LLM text embeddings predicts cross-sectional returns (arXiv 2606.29290) [PREPRINT]. — [arXiv 2606.29290](https://arxiv.org/pdf/2606.29290)

### Inferences
- **Capability G: live earnings-call copilot with an audio-mismatch layer.**
  - What it enables: building on the desktop meeting copilot, stream the call, align the audio-LLM tone with the transcript, and flag Q&A segments where voice and text diverge or answers are evasive. Tie each flag to Book kill criteria and to the pre-call earnings-prep questions ("management dodged question #3 on your thesis").
  - Evidence: moderate. Several papers point the same way, for short horizons.
  - Limits: speaker-specific baselines are needed, and long-horizon alpha is weak.
  - Build difficulty: medium to high (audio models, real-time).
- **Capability H: cross-period figure reconciliation.**
  - What it enables: because models are reliable at single-document extraction but weak cross-document (Fin-RATE), YouBank should extract per-document with an LLM, then do cross-period arithmetic deterministically against XBRL. That is a hybrid architecture, not pure-LLM.
  - Build difficulty: low to medium, and it fits the existing XBRL pipeline.
- **Capability I: KPI nowcasting from alternative data via local files.**
  - What it enables: the local agent ingests the user's licensed alternative-data exports and has an LLM map them to thesis KPIs.
  - Evidence: early preprints only.

### Gaps
- No 2026 benchmark found for chart (as opposed to table) understanding in SEC filings.
- No peer-reviewed evidence found that LLM-extracted job postings, satellite or app data predict equity returns.
- No public latency or accuracy data found for real-time (live) earnings-call analysis products.

## 4. Simulation and synthetic "what would X think": persona simulation, debate vs. independent ensembles

### Takeaway
LLM crowds work as forecasting ensembles (Science Advances 2024). But persona-simulated investors are not independent: they converge on the same media-prominent stocks, and psychometric audits find synthetic respondents "plausible but not valid". Debate mostly adds value through the ensembling inside it. Under fixed compute, independent sampling usually matches or beats debate, and debate tends to collapse diversity through sycophantic convergence. For YouBank's AI investment committee, the evidence favours independent, evidence-diverse chairs aggregated statistically over chairs that talk each other into consensus.

### Cited Findings
- Wisdom of the Silicon Crowd (Science Advances, 2024) [PEER-REVIEWED]: 12-LLM ensemble statistically indistinguishable from a 925-person human crowd on 31 questions. — [Science Advances](https://www.science.org/doi/10.1126/sciadv.adp1528)
- "Do LLM 'Crowds' Produce Investment Signals?" [SECONDARY write-up]: LLM investor personas built from the same corpus produce correlated picks regardless of persona framing. The resulting portfolio reproduces the most media-prominent US equities, a failure of the independence that crowd wisdom needs. — [Quantpedia](https://quantpedia.com/do-llm-crowds-produce-investment-signals-an-empirical-test/?a=6080)
- "Plausible but Not Valid: A Psychometric Audit of LLMs as Synthetic Survey Respondents" (arXiv 2608.14606) [PREPRINT]. — [arXiv 2608.14606](https://arxiv.org/pdf/2608.14606)
- "Do LLM Personas Dream of Bull Markets?": personas simulate human behaviour better when performing a task than when answering survey questions. — [arXiv 2411.05801](https://arxiv.org/html/2411.05801)
- "Debate or Vote" (NeurIPS 2025) [PEER-REVIEWED]: separates debate into ensembling and communication. Theory suggests debate alone does not improve on majority voting. — [NeurIPS 2025](https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf)
- "When Independent Sampling Outperforms Agentic Reasoning" (arXiv 2605.08478) [PREPRINT]: under fixed inference budgets, repeated independent sampling consistently beats agent-based approaches. — [arXiv 2605.08478](https://arxiv.org/pdf/2605.08478)
- "Diverse Evidence, Better Forecasts: Multi-Agent Deliberation Under Information Asymmetry" (arXiv 2607.01661) [PREPRINT]:
  - On 375 binary questions (PolyGym), debate scored Brier 0.202 / 73.9% accuracy versus 0.245 / 65.9% for a crowd ensemble.
  - The paper itself states that debate under homogeneous input behaves as a martingale with no expected accuracy gain, so the benefit comes from agents holding different evidence.
  — [arXiv 2607.01661](https://arxiv.org/html/2607.01661v1)
- "Multi-Agent Debate for Explainable Trading" (arXiv 2609.29701) [PREPRINT]: benefits come mainly through signal diversity, and sycophantic convergence collapses agents toward similar allocations. — [arXiv 2609.29701](https://arxiv.org/pdf/2609.29701)
- Contrasting result: a debate framework with adaptive stability detection reportedly beats majority voting for LLM-as-judge tasks. — [arXiv 2510.12697](https://arxiv.org/html/2510.12697v1)

### Inferences
- **Capability J: an "evidence-asymmetric committee" redesign.**
  - What it enables: give each IC chair a different evidence slice (bull chair gets management and sell-side material; bear chair gets short reports, insider selling and credit). Each produces an independent probability first, and the votes are aggregated with calibration (as AIA does). Debate is used only to surface cruxes, not to reach consensus.
  - Evidence: preprints plus NeurIPS theory.
  - Build difficulty: low, since it is a reconfiguration of the existing IC.
  - Measurable: log each chair's Brier score in the existing calibration module.
- **Capability K: a "what would X think" persona simulator.**
  - The evidence argues against marketing it as predictive of real investors.
  - Defensible use: a structured red team ("argue as a short-seller would"), labelled as scenario generation, not as a forecast of how actual holders will behave.
- A diversity metric (dispersion across chairs before debate, plus convergence after) could be shown as a process-health metric to warn about herding.

### Gaps
- I found no direct study replicating sell-side analyst or institutional investor expectation surveys with LLM personas.
- The underlying paper behind the Quantpedia "LLM crowds" summary was not identified or verified.

## 5. Verification: citation grounding, figure checking, hallucination rates in finance benchmarks

### Takeaway
Grounded pipelines with atomic claim verification report single-digit hallucination rates on FinanceBench. Computational claims remain the weak spot (about 28% error in one 2026 preprint), and accuracy degrades sharply under realistic retrieval and cross-document tasks. FinanceBench (2023) is aging. Finance-specific numeric and temporal checks are not well covered by generic hallucination benchmarks. Deterministic figure-checking against XBRL is the defensible edge.

### Cited Findings
- FinGround (arXiv 2604.23588) [PREPRINT, self-reported]:
  - Overall: 4.9% end-to-end hallucination rate on FinanceBench, with 92.1% citation precision and 87.6% citation recall. Removing its claim taxonomy roughly doubles hallucinations, to 11.7%.
  - Computational claims: the highest hallucination rate, at 28.4%.
  — [arXiv 2604.23588](https://arxiv.org/html/2604.23588v1)
- About 89% FinanceBench accuracy with perfect retrieval, dropping sharply under realistic RAG [SECONDARY aggregator]. — [presenc.ai](https://presenc.ai/research/financial-ai-hallucination-rates-2026)
- Generic hallucination rates of 15-52% across 37 models [SECONDARY aggregator, not finance-specific]. — [SQ Magazine](https://sqmagazine.co.uk/llm-hallucination-statistics/)
- FinVerBench (arXiv 2605.29586) [PREPRINT] studies benchmark validity and calibration in LLM financial-statement verification. — [arXiv 2605.29586](https://arxiv.org/pdf/2605.29586)
- A 2026 paper notes that FinanceBench dates from 2023 and that general hallucination benchmarks miss numerical precision and temporal accuracy. — [arXiv 2603.08704](https://arxiv.org/pdf/2603.08704)
- Fin-RATE: a 14-19% accuracy drop on cross-company or cross-year SEC tasks (see Q3). — [arXiv 2602.07294](https://arxiv.org/html/2602.07294)
- Vals Finance Agent v2: the top Financial Modeling category score is 34.52% (see Q2). — [Vals v2](https://www.vals.ai/benchmarks/fabv2)

### Inferences
- **Capability L: atomic-claim verifier on every output.**
  - What it enables: split each LP letter, DDQ answer, IC memo and MCP response into atomic claims. Route numeric claims to deterministic checks against XBRL, prices and Form 4 data, route textual claims to source-span entailment, then write a per-claim verification record to the tamper-evident ledger.
  - Evidence: FinGround's reductions are large, and numeric claims are exactly where LLMs fail most (28.4%).
  - Build difficulty: medium.
  - Edge: YouBank already owns structured ground truth (XBRL) and an audit ledger, which competitors' chat-over-filings lacks. A "verified figures" badge is a compliance-relevant differentiator for LP and DDQ drafting.
- Publish YouBank's own verification metrics (claim-level precision and recall on its outputs). Vendor hallucination claims are mostly self-reported, so transparent measurement is itself a trust edge.

### Gaps
- No independently run 2026 hallucination leaderboard for finance documents was found. FinGround's numbers are self-reported.
- I found no FinQA or TAT-QA 2026 state-of-the-art figures in this pass.
- Vals, arXiv and EA Forum pages could not be fetched (network policy), so methodologies were not read in full. Allowing arxiv.org, vals.ai and forum.effectivealtruism.org would enable verification.
