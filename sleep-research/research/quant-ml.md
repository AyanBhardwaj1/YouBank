# Frontier financial ML, quant and alternative data (as of 31 October 2026)

Run: youbank-frontier-20261031 · Track: quant / financial ML / alt data · Author: research agent

**How this was made.** 30 web searches (one more was refused when the shared search budget ran out),
prioritising July 2025 to October 2026. arxiv.org could not be fetched from this sandbox, so **every paper below
is cited from search-result pages (abstracts, HTML excerpts, RePEc/alphaXiv/emergentmind listings), not from a
read of the full text**. Figures that came only from a secondary summary are tagged [UNVERIFIED]. Dates come from
the arXiv identifier (YYMM) or the listing. Nothing here is invented. Where a question could not be answered
(for example current licences for Toto, Moirai 2.0 and TimesFM 2.5), it says so.

**What already exists in YouBank (so not repeated).** Edge: Call Desk with EvasionBench/Eva-4B evasion scoring
(`src/lib/edge/calls`), Deal Radar sale-odds model (`edge/odds`), Pulse alt signals including ATS job postings
(`edge/pulse`), split-conformal intervals and calibration (`edge/calib`), the forecast ledger (`edge/forecasts`),
TimesFM premium via BigQuery (`edge/premium/timesfm.ts`), Chronos-2 planned as the free forecaster
(docs/edge-next.md 2.1). Quant: point-in-time store, factor engine, event studies, Backtest Integrity Checker with
trial log and PBO, insider clusters, Kelly governor, TCA, DRILL (`src/lib/quant`). Inference: M4-style
ETS/Theta forecasts with conformal bands, Altman/Ohlson/Merton credit, GARCH/EWMA risk (`src/lib/inference`).
Form D parsing (`src/lib/vc/formd.ts`). The Look-Ahead-Bench and Lopez-Lira/Tang points are already in
docs/quant-edge.md 2.4. **Not built yet (checked in code):** Q8 Filing Change Detector (`DIFF`), any HAR
realized-volatility model, adaptive (online) conformal, an LLM model-cutoff registry.

---

## Executive summary

1. **Time-series foundation models (TSFMs) do not forecast daily stock returns.** Zero-shot Chronos and TimesFM
   give out-of-sample R² of about −1.4% to −2.8% on next-day excess returns with ~50% hit rate (arXiv 2511.18578);
   a June 2026 benchmark calls them "practical starting points rather than reliable sources of trading alpha"
   (arXiv 2606.27100). Never sell a TSFM return forecast.
2. **On volatility, the old HAR model still holds the line.** Across 50 assets and nine zero-shot TSFMs, only Tiny
   Time Mixers beat Log-HAR at every horizon, narrowly; an equal-weight TTM + Log-HAR average matches the best
   model (arXiv 2607.05291, July 2026). YouBank has no HAR model today: that is the cheapest high-value build.
3. **Finance-native foundation models are the exception worth watching.** Kronos (arXiv 2508.02739, AAAI) is
   pretrained on 12bn+ K-line records from 45 exchanges and reports 9% lower volatility MAE; open weights. Treat
   its RankIC claims as [UNVERIFIED] until replicated.
4. **LLM backtests before a model's training cutoff are not evidence.** "Profit Mirage" (arXiv 2510.07920) finds
   published LLM trading agents lose their edge after the cutoff; LLMs recall exact pre-cutoff index values
   (arXiv 2504.14765). Point-in-time LLMs now exist (ChronoBERT/ChronoGPT, arXiv 2502.21206; NBER w35247,
   Kelly-Malamud-Schwab-Xu 2026) and show the true lookahead penalty is modest for embeddings.
5. **LLM alpha-mining agents work best as regularised search, not oracles.** AlphaAgent (KDD 2025) adds
   originality (AST similarity), hypothesis alignment and complexity penalties; RD-Agent(Q) (NeurIPS 2025)
   claims ~2x returns of classical factor libraries with 70% fewer factors. Both are self-reported; YouBank's
   trial log + PBO is exactly the guardrail these need.
6. **Text signals that survive in 2025-26 are structured and specific.** LLM-extracted event features
   (arXiv 2512.19484), analyst-report embeddings (arXiv 2502.20489), and supply-chain-propagated 10-K embeddings
   (arXiv 2606.29290, Sharpe 0.86, single-author preprint) beat generic sentiment.
7. **Earnings calls: "how it's said" predicts risk, not direction.** Vocal + text features explain up to 43.8% of
   out-of-sample 30-day realized-vol variance but do not predict returns (arXiv 2508.18653). Q-A semantic
   alignment as an evasion proxy is reported to carry alpha [UNVERIFIED figure, Routledge May 2026].
8. **For structured credit/event prediction, gradient boosting still wins.** XGBoost/CatBoost beat Llama-3.3-70B
   + TabPFN on bankruptcy at all horizons, and LLM self-reported PDs are poorly calibrated (arXiv 2511.16375).
   TabPFN-2.5+ weights are non-commercial.
9. **LLM forecasters are near superforecaster level but must be recalibrated, not trusted verbally.**
   ForecastBench projected LLM-superforecaster parity for late 2026; verbal confidence is overconfident above
   0.5 (ECE 0.093 vs 0.044 for a probe, arXiv 2607.08046); markets still aggregate faster (Prophet Arena,
   ICLR 2026).
10. **Live LLM trading is mostly hype so far.** nof1 Alpha Arena Season 1: more than half the models lost money;
    StockBench (arXiv 2510.02209) finds most agents fail to beat buy-and-hold; FINSABER (KDD 2026) shows earlier
    positive results came from short windows and few stocks. YouBank's honest-evaluation stance is a
    differentiator, and the product to build is the evaluator, not another bot.

---

## 1. Time-series foundation models for finance

| Paper / model | Date | What it found | URL |
|---|---|---|---|
| Re(Visiting) Time Series Foundation Models in Finance | Nov 2025 (arXiv 2511.18578) | Global panel, next-day excess returns. Zero-shot Chronos (large, 512 lags) OOS R² −1.37%, ~51% direction; TimesFM (500M) R² −2.80%. Domain-agnostic pretraining is not enough; tree ensembles more robust. | https://arxiv.org/pdf/2511.18578 |
| Pretrained Time-Series Foundation Models for Financial Return Forecasting | Jun 2026 (arXiv 2606.27100) | TimeGPT, TimesFM-2.5, Moirai-2.0, Chronos, Chronos-2 on five large US stocks; Moirai-2.0 and TimesFM-2.5 best average rank; "starting points rather than reliable sources of trading alpha". Error metrics only, no trading test [per secondary summary]. | https://arxiv.org/pdf/2606.27100 · https://ideas.repec.org/p/arx/papers/2606.27100.html |
| Forecasting Realized Volatility with Time Series Foundation Models: A Comparison with Econometric Benchmarks (Brini) | Jul 2026 (arXiv 2607.05291) | VOLARE dataset, 50 assets, 3 horizons, 9 zero-shot TSFMs (incl. Chronos, Moirai 2.0, TimesFM 2.5, Toto) vs 8 econometric models. Only Tiny Time Mixers beats Log-HAR at every horizon, narrowly. Short-horizon gains are mostly scaling; genuine info gain only at monthly horizon. Equal-weight TTM + Log-HAR matches the best model. Architecture choice matters more than "FM vs econometric". | https://huggingface.co/papers/2607.05291 · https://econpapers.repec.org/paper/arxpapers/2607.05291.htm |
| Foundation Time-Series AI Model for Realized Volatility Forecasting (Goel et al.) | May 2025 (arXiv 2505.11163) | Incrementally fine-tuned TimesFM statistically beats traditional models (Diebold-Mariano, Giacomini-White). | https://arxiv.org/pdf/2505.11163 |
| VolaTTM (fine-tuned Granite TTM) | 2026 [date UNVERIFIED] | Self-reported: lower QLIKE than Log-HAR for 50/50, 49/50, 47/50 assets at 1/5/22 sessions; HAR-RV still best MAE at h=1. Treat with caution. | https://huggingface.co/AurelPx/VolaTTM · https://aurelpx-volattm-article.static.hf.space/index.html |
| Marconi, TSFMs zero-shot in finance | Jul 2025 (arXiv 2507.07296) | Zero-shot Tiny Time Mixers beat naive benchmarks on volatility and spread; Chronos did not clearly. | https://arxiv.org/html/2507.07296v1 |
| Kronos: A Foundation Model for the Language of Financial Markets | Aug 2025 (arXiv 2508.02739; AAAI) | Tokenises OHLCV into hierarchical coarse/fine tokens; decoder-only; 12bn+ K-line records from 45 exchanges. Abstract: 9% lower MAE on volatility, 22% better synthetic K-line fidelity. "93% RankIC improvement" is from a secondary source [UNVERIFIED]. Code and weights at github.com/shiyu-coder/Kronos (licence not checked [UNVERIFIED]). | https://arxiv.org/abs/2508.02739 · https://huggingface.co/papers/2508.02739 · https://ojs.aaai.org/index.php/AAAI/article/download/39730/43691 |
| Chronos-2: From Univariate to Universal Forecasting | Oct 2025 (arXiv 2510.15821) | Leads GIFT-Eval over TiRex and TimesFM-2.5 on WQL and MASE win rate and skill. Multivariate + covariates. (General benchmark, not finance.) | https://arxiv.org/pdf/2510.15821 |
| It's TIME / LiveHouse-TS (benchmarks) | Feb 2026 (2602.12147) / Aug 2026 (2608.17299) | Next-generation and "living" TSFM benchmarks, reacting to contamination of static leaderboards [contents not read, UNVERIFIED]. | https://arxiv.org/pdf/2602.12147 · https://arxiv.org/pdf/2608.17299 |
| fin-forecast-arena (practitioner) | Apr 2026 | Zero-shot TSFMs often lose to random walk on next-day returns; varies by horizon. Personal benchmark. | https://shuaiyao.pages.dev/projects/fin-forecast-arena |
| Jheng et al., TSFMs for VaR | 2026 (ECECSR 2/2026) | Benchmarks TSFM VaR against GJR-GARCH, historical simulation and conformal-wrapped ARIMA/LSTM [results not read, UNVERIFIED]. | https://ecocyb.ase.ro/nr2026_2/14_SiangLiJheng_TahulTak.pdf |

**Honest reading.** (a) Returns: no. (b) Volatility: a small, well-chosen TSFM ensembled with Log-HAR is
the evidence-backed recipe; fine-tuning helps. (c) Fundamentals / business series (revenue, KPIs): the prior
repo research already uses M4-style combinations; Chronos-2's GIFT-Eval lead is on general series, so it is a
reasonable additional ensemble member for revenue/KPI series, judged against Theta on YouBank's own rolling
backtest. **Licences:** prior repo research says Chronos-2 is Apache-2.0 and TimesFM 3.0 / Moirai 2.0 weights are
non-commercial (docs/edge-next.md); Toto and TimesFM 2.5 licences could not be re-checked this run [UNVERIFIED].

**Implication for YouBank.** Add HAR / Log-HAR realized-vol forecasting to `src/lib/inference` (feeds Q9 VOLS),
with Tiny Time Mixers or Chronos-2 as an optional ensemble member on the ML service and the "skill vs Log-HAR"
shown on screen. Add a returns "forecastability" disclaimer card in `src/lib/quant` whenever a user asks a TSFM
for price targets.

---

## 2. LLMs for alpha

### 2.1 Alpha-mining agents

| Paper | Date / venue | Claim | URL |
|---|---|---|---|
| AlphaAgent: LLM-Driven Alpha Mining with Regularized Exploration to Counteract Alpha Decay (Tang et al.) | Feb 2025 (arXiv 2502.16789), KDD 2025 | Three regularisers: originality (AST similarity to existing alphas), hypothesis-factor alignment (LLM-scored), complexity control. CSI 500 / S&P 500, 2021-24: 11.0% (IR 1.5) and 8.74% (IR 1.05) annual excess after costs; 81% higher hit ratio; 30% fewer tokens. Self-reported. | https://arxiv.org/html/2502.16789v2 |
| R&D-Agent-Quant: A Multi-Agent Framework for Data-Centric Factors and Model Joint Optimization (Microsoft Research) | May 2025 (arXiv 2505.15155), NeurIPS 2025 | Research stage (hypotheses), Development stage (Co-STEER code agent), feedback; bandit scheduler; alternating factor/model optimisation. Up to 2x annualised returns of classical factor libraries with 70% fewer factors. Self-reported; repo github.com/microsoft/RD-Agent (~12k stars per sotaverified). | https://www.microsoft.com/en-us/research/?p=1153361 · https://arxiv.org/html/2505.15155v2 · https://neurips.cc/virtual/2025/poster/121804 |

### 2.2 Text and embeddings as signals

| Paper | Date | Finding | URL |
|---|---|---|---|
| Structured Event Representation and Stock Return Predictability (Li, Qiao, Zheng) | Dec 2025 (arXiv 2512.19484) | LLM-extracted event features beat other text-driven models out of sample. | https://arxiv.org/pdf/2512.19484 |
| Supply-chain propagated LLM embeddings of annual reports (Yılkı) | Jun 2026 (arXiv 2606.29290) | Network-augmented embedding factor: Newey-West t = −2.64 after momentum/vol/size; long-short Sharpe 0.86; survives OOS, placebo, sector-neutral. Single-author preprint, not peer reviewed. | https://arxiv.org/abs/2606.29290 · https://ideas.repec.org/p/arx/papers/2606.29290.html |
| Do Sell-side Analyst Reports Have Investment Value? (Lv) | Feb 2025 (arXiv 2502.20489) | LLaMA3-8B embeddings of analyst reports predict 12-month returns OOS. | https://arxiv.org/html/2502.20489v1 |
| Financial Statement Analysis with Large Language Models (Kim, Muhn, Nikolaev) | 2024; v3 withdrawn Feb 2025 | GPT-4 on anonymised statements beat median analyst on earnings direction. arXiv shows a later version withdrawn by an author; reason not confirmed. Do not rely on its headline. | https://arxiv.org/abs/2407.17866v3 |
| SAE-FiRE (earnings surprise via sparse-autoencoder features) | 2025 (arXiv 2505.14420) | New method for earnings-surprise prediction from documents [results not read, UNVERIFIED]. | https://arxiv.org/pdf/2505.14420v2 |

### 2.3 Look-ahead bias, memorization and point-in-time LLMs

| Paper | Date | Finding | URL |
|---|---|---|---|
| Profit Mirage: Revisiting Information Leakage in LLM-based Financial Agents (Li et al.) | Oct 2025 (arXiv 2510.07920) | Rolling the test window past the knowledge cutoff, almost every published LLM agent fails to beat a random baseline; leakage is inside the LLM. Introduces FinLake-Bench (memorization probes) and FactFin (counterfactual framework). | https://arxiv.org/html/2510.07920v1 |
| The Memorization Problem: Can We Trust LLMs' Economic Forecasts? (Lopez-Lira, Tang, Zhu) | Apr 2025 (arXiv 2504.14765) | LLMs recall exact pre-cutoff values of indices and returns; mitigate by converting identifiable text into anonymised economic logic. | https://arxiv.org/html/2504.14765v1 |
| Chronologically Consistent Large Language Models (He, Lv, Manela, Wu) | Feb-Jul 2025 (arXiv 2502.21206) | ChronoBERT/ChronoGPT vintages per year from 1999, trained only on text available then. Real-time ChronoBERT news signals give Sharpe comparable to SOTA, so lookahead bias in that task is modest. Small enough for bulk embedding. | https://arxiv.org/html/2502.21206v3 |
| Scaling Point-in-Time Language Models (Kelly, Malamud, Schwab, Xu) | 2026, NBER w35247 | Up to 4B params on 1T chronologically filtered FineWeb tokens; monthly checkpoints 2013-2024; PiT-embedding portfolios close to look-ahead counterparts; capability gap narrows with scale. | https://www.nber.org/papers/w35247 |
| Look-Ahead-Bench (Benhenda) | Jan 2026 (arXiv 2601.13770) | Significant lookahead in Llama 3.1 8B/70B and DeepSeek 3.2 measured via alpha decay; vendor PiT models (Pitinf) did not show it. Vendor-authored; already cited in docs/quant-edge.md. | https://econpapers.repec.org/RePEc:arx:papers:2601.13770 |

**Evaluation protocol that follows from this (for any LLM-derived signal in YouBank):** (1) backtest only
after the model's documented training cutoff; (2) anonymise company names, tickers and dates in prompts;
(3) run a memorization probe (ask the model for the realised outcome; if it knows, the period is
contaminated); (4) prefer PiT embeddings (ChronoBERT-style) for historical backfills; (5) log every variant
tried as a trial so PBO / deflated Sharpe see the whole search.

**Implication for YouBank.** A model-cutoff registry and an "LLM contamination" check in
`src/lib/quant/integrity` (BTX already flags LLM inputs per quant-edge 2.4; make it mechanical); an
alpha-mining agent that writes every candidate to `quant_trials` with AlphaAgent-style originality and
complexity penalties.

---

## 3. Corporate events prediction

| Topic | Paper / product | Date | Finding | URL |
|---|---|---|---|---|
| M&A targets | Fine-tuning transformer models for M&A target prediction in the U.S. energy sector (Cogent Business & Management) | Dec 2025 | 200 energy firms' SEC filings; FinBERT + oversampling best (precision, few false positives) vs ALBERT, GPT-3 babbage-002. Single sector. | https://repositorio.comillas.edu/items/729ddd45-2522-4f7c-be0c-31ed65b2595c/full |
| M&A targets | LSEG StarMine M&A Target Model | current | Ranks 12-month target likelihood for 38,000+ public companies; LLM (BERT-based) over news plus financials, corporate actions, credit and deal data. The commercial bar Deal Radar is compared against. | https://solutions.lseg.com/StarmineMATargetModel · https://www.risk.net/insight/technology-and-data/7958507/leading-edge-llm-approaches-predictive-analytics-for-ma-targets |
| Bankruptcy | Are Foundation Models Useful for Bankruptcy Prediction? | Nov 2025 (arXiv 2511.16375), NeurIPS 2025 GenAI-in-Finance workshop | XGBoost/CatBoost beat Llama-3.3-70B (text) + TabPFN (tabular) at every horizon; LLM self-reported probabilities poorly calibrated and discretised; base rates <1%. | https://arxiv.org/pdf/2511.16375 |
| Bankruptcy | ECL dataset (multi-modal, 10-K text + numbers) | 2023-24 (arXiv 2401.12652) | Text and numbers complementary; zero-shot LLM bankruptcy prediction poor. | https://ar5iv.labs.arxiv.org/html/2401.12652 |
| Earnings-call evasion | EvasionBench | Jan 2026 (arXiv 2601.09142) | 22.7M Q&A pairs, direct/intermediate/fully evasive. Already in Call Desk. | https://arxiv.org/html/2601.09142v2 |
| Earnings-call evasion | "The Language of evasion: How semantic similarity between questions and answers predicts stock returns" (Routledge) | May 2026 | Embedding similarity of answer to question; low-similarity answers rated evasive 67% vs 22%. Aligned responders earn 3.9% annual alpha (t = 3.41) [UNVERIFIED, from an aggregator]. Exact URL not returned by search [UNVERIFIED]. | (cited via search summary; see https://synapsesocial.com/papers/6a13178dae549d8bbc3bd9f6) |
| Earnings-call evasion | Henschel et al., evasive answer taxonomy (FinNLP 2025) | 2025 | Multi-level taxonomy; direct answers engage more with question substance. | https://preview.aclanthology.org/ingest-emnlp/2025.finnlp-2.12.pdf |
| Call audio | The Sound of Risk | Aug 2025 (arXiv 2508.18653) | Vocal + text features do **not** forecast direction; explain up to 43.8% of OOS variance in 30-day realized vol; physics-informed acoustic features robust to clipped teleconference audio; ~1,795 calls [count UNVERIFIED]. | https://arxiv.org/abs/2508.18653v1 |
| 10-K change ("Lazy Prices") | Cohen, Malloy, Nguyen and follow-ups | original 2020; embeddings follow-up | Year-over-year 10-K edits predict returns; embedding similarity is significant vs bag-of-words (Lombardo et al.). No 2025-26 LLM out-of-sample replication found. | https://dash.harvard.edu/server/api/core/bitstreams/48b75045-2a9a-463a-b168-f41ca002078c/content · https://air.unipr.it/bitstream/11381/2887410/4/postprint_Lombardo_neural_network_embeddings.pdf · https://quantpedia.com/the-positive-similarity-of-company-filings-and-the-cross-section-of-stock-returns/ |

**Implication for YouBank.** Keep Deal Radar and credit on boosted trees; add filing-text and news-event
features as columns rather than letting an LLM emit probabilities (`src/lib/edge/odds/features.ts`,
`src/lib/inference/credit.ts`). Build Q8 DIFF (not yet built). Add a cheap Q-A alignment score and an
audio-to-volatility feature to Call Desk (`src/lib/edge/calls`), framed as risk, never direction.

---

## 4. Private markets data

| Item | Date | Finding | URL |
|---|---|---|---|
| VCBench: Benchmarking LLMs in Venture Capital (Oxford + Vela) | Sep 2025 (arXiv 2509.14448) | 9,000 anonymised founder profiles, 9% success base rate (vs ~1.9% real); success = exit/IPO >$500M or raise >$500M. DeepSeek-V3 >6x baseline precision; GPT-4o best F0.5; most models beat human benchmarks. Anonymisation cut re-identification >90%. Inflated base rate limits extrapolation. Leaderboard vcbench.com. | https://arxiv.org/html/2509.14448v1 |
| CrunchLLM | Sep 2025 (arXiv 2509.10698) | Claims >80% accuracy predicting IPO/acquisition from Crunchbase. Self-reported. | https://arxiv.org/html/2509.10698v1 |
| In-context learning for early-stage startup prediction | Jan 2026 (arXiv 2601.16568) | Few-shot LLM beats supervised baselines on Crunchbase profiles [details UNVERIFIED]. | https://arxiv.org/html/2601.16568 |
| Sinovation startup success (Crunchbase) | 2021 (arXiv 2112.07985) | LightGBM/XGBoost best, F1 ~53%: the realistic ceiling for structured data. | https://arxiv.org/pdf/2112.07985 |
| FilingFlow (vendor) | Mar 2026 | Form D intelligence product; "Runway Tracker" claims to predict follow-on funding from filing changes. Product claim only. | https://blog.filingflow.app/2026/03/15/introducing-filingflow-form-d-intelligence-for-dealmakers/ |

**Gap.** No peer-reviewed study was found that uses Form D fields (offering size, amount sold, investor counts,
amendment cadence, exemptions, related persons) as predictors of follow-on funding or exit. That is an open
lane: YouBank already parses Form D and can build the labels itself (a later Form D or amendment with higher
amount sold = follow-on).

**Implication for YouBank.** A Form D "next raise" hazard model in `src/lib/vc` + `src/lib/inference/survival.ts`,
evaluated honestly with time splits; any LLM founder screen must use VCBench-style anonymisation and report
precision against the true base rate.

---

## 5. Alternative data frontier: what is free or cheap in 2026

| Source | Evidence | Cost / access | URL |
|---|---|---|---|
| Job postings | Management Science: changes in postings predict performance changes, stronger for growth vs replacement hiring. Vendor (Informa) claims sector-neutral L/S IR 1.1, 2.9%/yr weekly [UNVERIFIED, vendor]. | Free via ATS APIs (already in Pulse); vendors (JobSpikr, Textkernel) paid. | https://research.vu.nl/en/publications/how-do-job-vacancy-rates-predict-firm-performance-a-web-crawling- · https://informaconnect.com/make-more-informed-investment-decisions-with-workforce-intelligence |
| Satellite parking lots | Berkeley Haas: lot counts flag analyst forecast errors before earnings; advantage accrues to well-funded investors. Data Score: satellite better for slow trends (capex) than retail revenue. Free Sentinel-2 (10 m) replications are anecdotal. | Commercial imagery paid (RS Metrics, Orbital Insight historically); Sentinel-2 free. | https://newsroom.haas.berkeley.edu/how-hedge-funds-use-satellite-images-to-beat-wall-street-and-main-street/ · https://core-prod.cambridgecore.org/core/services/aop-cambridge-core/content/view/2F5F99D68D1F8940F61578F198D6C005/S0022109023001448a.pdf/on-the-capital-market-consequences-of-big-data-evidence-from-outer-space.pdf · https://thedatascore.substack.com/p/satellite-data-3-good-and-3-bad-use |
| Shipping / AIS | IMF WP/26/99 (May 2026) nowcasts monthly country-level trade from IMF PortWatch vessel data; IMF 2025 "Nowcasting Global Trade from Space"; AIS nowcasts volumes, not values or services (IMF 2019). | IMF PortWatch free; Global Fishing Watch API terms not confirmed [UNVERIFIED]. | https://www.imf.org/-/media/files/publications/wp/2026/english/wpiea2026099-source-pdf.pdf · https://www.imf.org/en/publications/wp/issues/2025/05/16/nowcasting-global-trade-from-space-566957 |
| Search interest | Official Google Trends API (alpha) launched 24 Jul 2025; limited testers, relative interest only, no public pricing. | Apply for alpha access. | https://developers.google.com/search/blog/2025/07/trends-api |
| Government contracts | USAspending-based event study (pharma): positive but insignificant CARs; older literature mixed; foreign-government awards more valuable. Use `new_awards_only` to avoid counting modifications. | Free API. | https://anserpress.org/journal/jea/3/1/43 · https://www.emerald.com/insight/content/doi/10.1108/JOPP-02-02-2002-B004/full/html · https://apify.com/datasignalslab/gov-contract-awards-monitor |
| App data / web traffic | No credible 2025-26 study surfaced in this run [gap]. | Paid (Sensor Tower, Similarweb) [prior knowledge, UNVERIFIED]. | — |

**Implication for YouBank.** The free stack (ATS postings, PortWatch, Sentinel/Planet already in Edge,
USAspending, Trends alpha) is enough for honest "signals with stated false-alarm rates"; the edge for users is
evaluation (does this signal lead earnings or revenue for this company?) rather than raw data. Touches
`src/lib/edge/pulse`, `src/lib/edge/sources`.

---

## 6. Uncertainty: conformal prediction and calibrated probabilities

| Paper | Date | Finding | URL |
|---|---|---|---|
| Temporal Conformal Prediction (Aich, Aich, Jain) | Jul 2025, v6 Jan 2026 (arXiv 2507.05470) | Rolling-window split conformal + online offset for financial series; sharper intervals, equal or better coverage, especially in high-vol regimes. | https://arxiv.org/abs/2507.05470 |
| Testing Marginal and Conditional Coverage in Conformal Prediction for Non-Stationary Time Series via VaR Backtesting (Retzlaff et al.) | 2025, PMLR 266 | Use VaR backtests (Kupiec/Christoffersen-style) to test conformal coverage; reveals adaptation failures standard metrics miss. | https://proceedings.mlr.press/v266/retzlaff25a.html |
| Conformal Prediction For Financial Time Series Under Asset Pricing Models (Cocouvi thesis) | 2025 | Inductive CP robust coverage but wide; classical vol models competitive. | https://trepo.tuni.fi/handle/10024/232978 |
| What LLM Forecasters Know but Don't Say | Jul 2026 (arXiv 2607.08046) | Verbalised confidence overconfident above 0.5 (ECE 0.093); a probe on internal states 0.044. | https://arxiv.org/pdf/2607.08046 |
| FinBench (calibration for financial forecasting) | Jun-Jul 2026 (arXiv 2607.16229) | Time-gated (no look-ahead) financial forecasting benchmark scored with proper scoring rules [results UNVERIFIED]. | https://econpapers.repec.org/RePEc:arx:papers:2607.16229 |
| ConfidenceBench | Jul 2026 (arXiv 2607.20526) | Brier-scored verbal confidence in 15 frontier LLMs; overconfidence common, improves with scale, varies by domain. | https://www.alphaxiv.org/abs/2607.20526 |
| ForecastBench (Forecasting Research Institute) | 2025-26 | Gap to superforecasters ~0.017 Brier (≈1 year of progress); parity projected Oct-Nov 2026; by 6 Jul 2026 top AI systems no longer significantly worse (third-party write-up). Good Judgment critiques the difficulty-adjusted comparison. | https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human · https://blog.lightningrod.ai/p/ai-reaches-human-superforecaster-range · https://goodjudgment.com/what-superforecasters-actually-said-about-forecastbench |
| LLM-as-a-Prophet / Prophet Arena | Oct 2025 (arXiv 2510.17638), ICLR 2026 | Live Kalshi events; top-model Brier 0.17-0.24, calibration differs more; bottlenecks: event recall, misreading sources, slower aggregation than markets. | https://arxiv.org/abs/2510.17638 |
| Foresight Arena; Prediction Arena | May 2026 (arXiv 2605.00420); Mar 2026 | PnL-based evaluation conflates forecasting with sizing and timing; agents did better choosing their own Polymarket markets than on a fixed Kalshi set. | https://arxiv.org/html/2605.00420v1 |

**Implication for YouBank.** Upgrade `src/lib/edge/calib/conformal.ts` from split conformal to an adaptive
(online-offset / ACI-style) version for non-stationary series, and test coverage with the Kupiec machinery
already in `src/lib/inference`. For every LLM probability that reaches the forecast ledger, store the raw
verbal number and a recalibrated number (Platt or isotonic fitted on the ledger's settled history) and show
the market price beside it when one exists.

---

## 7. Agentic trading: benchmarks vs hype

| Item | Date | Result | URL |
|---|---|---|---|
| nof1 Alpha Arena Season 1 | Oct-Nov 2025 | Real-money crypto; Qwen3-Max won (+22.3% in ~17 days); more than half the models ended in the red; nof1 called it exploratory. | https://www.blockhead.co/2025/10/21/ai-models-battle-in-live-crypto-trading-competition · https://www.kucoin.com/news/flash/ai-trading-models-struggle-in-live-market-tests-majority-of-systems-report-losses |
| Alpha Arena Season 1.5 and Season 2 | 2026 | 1.5: ~$320K deployed, Grok 4.2 won, overall losses about a third [figures from press, UNVERIFIED]. nof1 raised $15M; Season 2 (web search, reasoning, multi-prompt, longer, more assets) start not confirmed. Founder: not yet feasible to hand an LLM money. | https://forklog.com/en/news/ai-model-grok-4-2-triumphs-in-trading-tournament · https://aiweekly.co/alerts/nof1-raises-15m-to-run-ai-models-in-live-trading · https://www.thinkadvisor.com/amp/2026/05/06/why-ai-bots-arent-ready-to-replace-your-fund-manager/ |
| StockBench | Oct 2025, v2 Mar 2026 (arXiv 2510.02209) | Multi-month daily decisions; most models fail to beat buy-and-hold; a few show better returns/risk. Historical, not live. | https://arxiv.org/html/2510.02209v2 |
| FINSABER: Can LLM-based Financial Investing Strategies Outperform the Market in Long Run? | May 2025 (arXiv 2505.07078), KDD 2026 | 2004-2024, broad universe; earlier positives relied on <1 year and <10 stocks; LLM strategies need regime-aware risk controls, not more framework complexity. | https://arxiv.org/html/2505.07078v5 |
| DeepFund; Agent Market Arena | 2025 | Live arena platforms for LLM fund investing [results not retrieved, UNVERIFIED]. | — |

**Implication for YouBank.** YouBank's algo branch should not market "AI picks". It should ship the evaluator:
any agent strategy (user's own, copy, or LLM) runs as a paper sleeve against buy-and-hold and the factor
sleeve, only in post-cutoff time, through BTX and KELLY. Touches `src/lib/algo`, `src/lib/quant/integrity`,
`src/lib/quant/sizing`.

---

## Models and signals to build in YouBank

Ordered by value per unit of work. "Data cost" is incremental to what YouBank already pays.

| # | Build | Evidence | Expected value to users | Data cost | Module |
|---|---|---|---|---|---|
| 1 | **Realized-vol forecaster: HAR-RV / Log-HAR, plus an optional TTM or Chronos-2 member, equal-weighted, with skill vs Log-HAR on screen.** Daily-bar RV until intraday bars exist. | arXiv 2607.05291 (only TTM beats Log-HAR; equal-weight TTM+Log-HAR = best); 2505.11163 (fine-tuned TimesFM helps); 2507.07296 | Better option-sizing, VaR, LBO/credit stress inputs; an honest "FM vs econometric" scorecard that no retail tool shows | Free (existing daily bars); ML service CPU for TTM | `src/lib/inference` (new `vol.ts`), consumed by Q9 VOLS in `src/lib/quant`, `risk/` |
| 2 | **LLM contamination guard: model-cutoff registry + memorization probe + anonymiser**, enforced by BTX for any signal with an LLM input; backtests before cutoff graded "contaminated". | Profit Mirage 2510.07920; Memorization Problem 2504.14765; Look-Ahead-Bench 2601.13770; NBER w35247 | Prevents users (and YouBank's own agents) from believing fake alpha; a trust feature competitors lack | Free | `src/lib/quant/integrity`, `src/lib/ai` (cutoff table), `src/lib/quant/trials.ts` |
| 3 | **Q8 DIFF filing-change detector** (Lazy Prices): section-level cosine change of 10-K/10-Q (risk factors, MD&A, legal) with embeddings, plus a point-in-time (ChronoBERT-style) embedder for historical backfill; event-study the signal in YouBank's own panel before showing any return claim. | Cohen-Malloy-Nguyen; Lombardo embeddings; ChronoBERT 2502.21206 | Analysts see "what changed" in seconds; quants get a documented factor | EDGAR free; embedding cost ~cents per filing (batch API) | `src/lib/quant` (Q8), `src/lib/edgar`, `src/lib/quant/events/study.ts` |
| 4 | **Regularised alpha-mining agent** ("Factor Scout"): LLM proposes hypotheses and formulas over the PiT panel; AlphaAgent-style originality (AST similarity to existing factors) and complexity penalties; every candidate logged to `quant_trials`; output graded by PBO and deflated Sharpe; only post-cutoff windows count. | AlphaAgent 2502.16789; RD-Agent(Q) 2505.15155 | Pro users get a research assistant that cannot p-hack silently; feeds Q12 sleeves | LLM tokens (~$0.5-2 per run est. [UNVERIFIED]); data free | `src/lib/quant/factors`, `quant/trials.ts`, `quant/integrity`, `src/lib/edge/agent` |
| 5 | **Call Desk Q-A alignment score**: embedding cosine of each answer to its question, peer-normalised, shown beside Eva-4B evasion; cheap free-tier proxy. | Routledge May 2026 [alpha figure UNVERIFIED]; EvasionBench 2601.09142 | Faster evasion triage on every call, free tier | Embeddings only | `src/lib/edge/calls/qa.ts`, `evasion.ts` |
| 6 | **Call audio to volatility (not direction)**: acoustic features from call audio predicting 30-day realized vol, blended with #1. | Sound of Risk 2508.18653 (43.8% OOS RV variance; no directional signal) | Event-risk sizing around earnings; premium | Audio access/ASR (already have `edge/premium/audio.ts`, `diarize.ts`) | `src/lib/edge/calls`, `src/lib/edge/premium/audio.ts`, `src/lib/inference` |
| 7 | **LLM event extractor -> typed event features** from 8-Ks and news (guidance change, buyback, CEO exit, contract win, litigation), feeding Q6 event studies and Deal Radar as columns. | Structured Event Representation 2512.19484; StarMine (text + structured) | Better event alerts and Deal Radar features without LLM-emitted probabilities | LLM tokens on small model; data free/existing news | `src/lib/news`, `src/lib/quant/events`, `src/lib/edge/odds/features.ts` |
| 8 | **Credit: keep boosted trees, add text features, calibrate PDs on EDGAR bankruptcies (8-K Item 1.03).** Explicitly reject LLM self-reported PDs. | arXiv 2511.16375 (GBM > FMs; LLM PDs poorly calibrated); ECL 2401.12652; already on ai-inference.md "left for later" | Calibrated default odds for restructuring and credit users | Free (EDGAR) | `src/lib/inference/credit.ts`, `survival.ts` |
| 9 | **Form D "next raise" hazard model**: from YouBank's Form D store, predict probability of a follow-on Form D / higher amount sold within 6-18 months; features: offering size, amount sold vs total, investor count, filing cadence, exemptions, industry, related persons' track record. | No academic study found (open lane); FilingFlow sells a similar claim; Crunchbase ML ceiling F1 ~53% (2112.07985) | VC/PE users get a free "who is raising next" list; unique data asset | Free (EDGAR) | `src/lib/vc/formd.ts`, `src/lib/inference/survival.ts`, `src/lib/edge/pulse` |
| 10 | **Anonymised founder/company screen with honest base rates** (VCBench protocol): LLM scores anonymised profiles; report precision vs true base rate, never accuracy. | VCBench 2509.14448 | Credible VC screening; avoids inflated claims | LLM tokens | `src/lib/vc`, `src/lib/edge/odds` |
| 11 | **Hiring signal v2: growth vs replacement postings**, change-point alerts with false-alarm rates, and a per-company "does hiring lead revenue here?" check. | Management Science job-postings study; vendor IR claims [UNVERIFIED] | Sharper Pulse alerts for public and private names | Free (ATS APIs already ingested) | `src/lib/edge/pulse/postings.ts`, `titles.ts`, `findings.ts` |
| 12 | **Trade and port nowcast from IMF PortWatch** for countries and chokepoints, linked to Supply-Chain Atlas and macro screens. | IMF WP/26/99 (May 2026); IMF 2025 | Macro/commodity users get free near-real-time trade volumes | Free | `src/lib/edge/sources`, `src/lib/terminal/macro.ts` |
| 13 | **Adaptive conformal intervals** (rolling window + online offset) replacing plain split conformal for non-stationary series, with VaR-style coverage backtests printed on screen. | TCP 2507.05470; Retzlaff et al. PMLR 266 | Bands that stay honest in volatile regimes; extends existing "coverage on screen" promise | Free | `src/lib/edge/calib/conformal.ts`, `src/lib/inference/forecast.ts` |
| 14 | **LLM probability recalibration + market comparison in the forecast ledger**: store raw verbal probability, isotonic/Platt-recalibrated probability fitted on settled ledger rows, and the Kalshi/Polymarket price when a matching market exists; Brier and calibration curve per model. | arXiv 2607.08046 (verbal overconfidence); Prophet Arena 2510.17638; ForecastBench | Every AI probability in YouBank becomes calibrated and benchmarked | Free (public market prices) | `src/lib/edge/forecasts/ledger.ts`, `track.ts`, `src/lib/edge/calib/fit.ts` |
| 15 | **Agent strategy evaluator ("paper sleeve league")**: any LLM/agent or copy strategy runs as a paper sleeve vs buy-and-hold and the factor sleeve, post-cutoff only, sized by KELLY, graded by BTX; publish results rather than claims. | StockBench 2510.02209; FINSABER 2505.07078; Alpha Arena S1 losses | Protects users from agent-trading hype; a differentiating trust surface for the algo branch | Free (paper trading APIs) | `src/lib/algo`, `src/lib/quant/integrity`, `src/lib/quant/sizing` |

**Explicitly not recommended:** TSFM daily return forecasts as signals; LLM-emitted bankruptcy or M&A
probabilities without a tree model and calibration; TabPFN-2.5+ in production (non-commercial weights,
needs a Prior Labs commercial licence); claims about Kronos RankIC until replicated on YouBank's panel.

## Gaps and limits of this run

- arxiv.org was blocked from this sandbox, so no paper was read in full; numbers are from abstracts or search
  summaries. Allowing arxiv.org in the session's network settings would let a follow-up verify tables.
- The shared web-search budget ran out after 30 queries; current licences for Toto, Moirai 2.0 and TimesFM 2.5,
  Kronos's licence, DeepFund/Agent Market Arena results, app-data and web-traffic evidence, and a 2025-26 LLM
  Lazy Prices replication were not checked.
