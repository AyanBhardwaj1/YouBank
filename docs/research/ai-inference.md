# AI inference in YouBank

*September 2026. What we researched, what we built from it, and what we deliberately left for later.*

"AI inference" covers two things here, and YouBank uses both:

1. **Running language models well:** the right model for each job, prompts that reuse the provider's
   cache, tools that run in parallel, and a ledger of what every call costs.
2. **Statistical inference and machine learning:** forecasts with honest intervals, credit and
   earnings-quality models, risk models, knowledge tracing, survival models, calibrated probabilities
   and Monte Carlo.

The aim is a terminal that does much of what a Bloomberg terminal does for a banker, investor or
student, with the models' working shown, at a small fraction of the cost ($31,980 a year is Bloomberg's
published list price for one terminal).

Three research reports sit behind this: LLM inference techniques, financial ML and knowledge tracing,
and Bloomberg's functions and the free data that can stand in for them. This note condenses them.

---

## 1. Running language models well

### What the research found

- **Most traffic does not need the flagship.** Triage, extraction, summaries and classification ran on
  the user's chosen model (by default the most expensive one). Small models such as GPT-5.6 Luna or
  Claude Haiku 4.5 cost roughly 40 to 100 times less per token at list prices. Recent studies found that
  choosing one model per task type captures most of what a trained router would gain.
- **Prompt caching was being missed.** Both providers charge about a tenth of the normal price for a
  reused prompt prefix. YouBank put the ticker, persona and workbook snapshot inside the system prompt,
  which changes on every request and breaks the reuse.
- **More reasoning is not free quality.** For knowledge work, Anthropic measured "low" effort giving up
  one to three points for 33 to 50% less cost, and several papers show longer reasoning can lower
  accuracy. Effort belongs to the task.
- **A bug:** Claude 5 models reject the older `thinking: enabled` setting, so they failed at the default
  effort. Haiku 4.5 is the reverse: it needs `enabled` with a budget and rejects `adaptive`.
- Also: batch processing costs half as much (good for backfills and nightly passes, not built yet);
  read-only tool calls can run in parallel; nothing recorded token usage or cost; and new customers can
  no longer fine-tune OpenAI models (since May 2026), so cheap-model quality has to come from prompts.

### What we built

| Change | Where |
|---|---|
| Task routing: classify, extract and summarize go to GPT-5.6 Luna (or Claude Haiku 4.5); drafting to GPT-5.6 Terra (or Claude Sonnet 5), within whichever provider has a key. A person can turn routing off. | `src/lib/ai/route.ts` |
| Stable system prompts first, request context after, so the provider's cache applies; a top-level `cache_control` on Claude. | `src/lib/ai/agent.ts`, `prompts.ts`, `workflows/prompt.ts` |
| Model-aware Claude thinking: adaptive with an effort level on Claude 5, a thinking budget on Haiku 4.5. | `src/lib/ai/agent.ts` |
| Read-only tool calls run in parallel in chat. | `src/lib/ai/agent.ts` |
| A usage ledger: every call's tokens (input, cached, cache writes, output, reasoning) and list-price cost, by feature and model, shown in Settings. | `src/lib/ai/usage.ts`, `pricing.ts`, `drizzle/0009_ai_usage.sql` |
| The terminal's cheap AI uses: a short "AI read" of any screen, the plain-English screener and the learning quizzes all run on the small tier. | `src/app/api/terminal/[fn]/route.ts` |

---

## 2. Financial models

Every model keeps its inputs, so each screen can show its working ("Models and sources").

### Forecasting

- **Method.** Simple exponential smoothing, damped trend and Theta, averaged: the combination that did
  best among simple methods in the M4 competition (Makridakis et al. 2018). Seasonality is tested the
  M4 way (autocorrelation at the seasonal lag beyond 90% Bartlett bounds) and removed by classical
  decomposition first.
- **Intervals.** Conformal: a rolling-origin backtest produces relative errors, pooled across horizons
  and scaled by the square root of the horizon, and their empirical quantiles set the 80% and 95% bands.
  Coverage is measured only with errors known before each origin and reported on screen.
- **Used in:** FCST (revenue against the Street), ECO (BLS series), Studio's `forecast_series`, the
  "Forecast with honest intervals" calculator.

### Credit

- **Altman Z'' (1995)**, mapped to a rating through Altman's 1996 median scores by S&P rating (nearest
  median, so the cut-offs are midpoints). Left out when retained earnings are negative because of
  buybacks rather than losses, which the model misreads as distress.
- **Ohlson O-score (1980, model 1).** SIZE is log(total assets / GNP price-level index) with the index at
  100 in 1968 (about 610 today) and assets in dollars. With assets in millions every company looks like a
  bankruptcy risk; this is the most common implementation error, and we had made it.
- **Merton distance to default**, naive form (Bharath and Shumway 2008): debt at face as short-term plus
  half of long-term, debt volatility 5% plus 25% of equity volatility. Market-implied default
  probabilities are floored at one basis point. When daily prices are not on the data plan, equity
  volatility comes from the 52-week range (Parkinson 1980), a rough but cautious estimate.
- **Implied rating:** the median of the views that apply; with two views, the midpoint rounded to the
  more cautious notch. Probabilities map to ratings at the geometric means of S&P's long-run one-year
  issuer default rates; the screen also shows Altman's mortality rates for the rating.
- **Checked against reality:** Microsoft AA, AT&T BBB, McDonald's A-, Apple A. The models are harsh on
  loss-making growth companies and generous to leveraged but stable ones; the screen says so.

### Earnings quality

Beneish M-score with its probit probability N(M); Piotroski F-score; Sloan accruals; Novy-Marx gross
profitability; working-capital days and cash conversion over up to six years.

### Risk

- EWMA (RiskMetrics, λ 0.94) and GARCH(1,1) with variance targeting, fitted by likelihood; a price cone
  from the GARCH term structure.
- Betas: two years of weekly returns with Blume's adjustment (0.67 raw + 0.33, the market's convention),
  and **Welch's slope-winsorized, recency-weighted beta** (2022), which predicted future betas better than
  OLS, Blume, Vasicek and Dimson in his tests. Standard errors are always shown.
- Value at risk three ways (historical, normal, Cornish-Fisher) with expected shortfall, and a **Kupiec
  proportion-of-failures backtest** of the rolling historical VaR over the last 250 days.
- Portfolio risk: covariance risk shares, the diversification ratio and a bootstrap of a year of outcomes.

### Macro and rates

The New York Fed's recession probit, N(-0.5333 - 0.6330 x the 10-year minus 3-month spread); the Sahm
rule from BLS unemployment; a Nelson-Siegel fit of the Treasury curve with Diebold and Li's λ.

### Cost of capital and Monte Carlo

- **WACC** from its parts: the 10-year Treasury, beta, an equity risk premium (5% by default,
  editable), the cost of debt as the Treasury plus the implied rating's spread (with the effective rate
  on existing debt beside it), a marginal tax shield and market-value weights. A Monte Carlo over beta,
  the premium, the spread and leverage gives the 80% range and a tornado.
- **Monte Carlo DCF** (Damodaran's approach): FCFF from growth, margin and reinvestment; terminal value
  with return on new capital equal to WACC; draws with terminal growth within a point of WACC rejected
  and counted. Inputs can be correlated through a **Gaussian copula** (each input keeps its own
  distribution; growth-margin +0.3 and WACC-terminal growth +0.5 by default). Outputs: P10/P50/P90, the
  chance of beating the price, a tornado, Spearman shares of variance, and what a bear, base and bull
  outcome looked like. Available as a calculator and, over any live workbook, as Studio's
  `monte_carlo` tool.

---

## 3. Knowledge tracing

### People learning the terminal

- **Bayesian knowledge tracing with forgetting.** Each function is a skill. Typing a command unaided is
  strong evidence (guess 0.1); reaching it by clicking a suggestion is weaker (guess 0.3); a four-option
  quiz answer has a guess of 0.25; closing a panel within seconds counts against. Learning rate 0.15,
  slip 0.1, prior 0.2, mastery at 0.95 (Corbett and Anderson's bounds keep guess below 0.3 and slip at or
  below 0.1). Between uses, the part above the prior halves every 30 days.
- **Policies.** Hints are full while the next attempt is more likely wrong than right, collapsed while
  practising, and gone at mastery: the expertise-reversal effect (Kalyuga et al. 2003) says scaffolding
  that helps a novice slows an expert. The next functions to learn unlock only when their prerequisites
  are known (P ≥ 0.8), ranked by value x (1 - P). LEARN shows all of it and writes quiz questions.

### What contacts already know (the email CRM)

Each email is tagged once with its topics by a small model (and, for inbound mail, what the sender
showed they know or asked about). Replaying a contact's mail gives, per topic:
- **Awareness**, a BKT-style hidden Markov model: our mention is a learning event (T 0.9 if they replied
  about it, 0.5 if they replied at all, 0.3 if not), their words are observations with guess and slip of
  0.05, and awareness fades with a half-life that starts at 60 days and doubles after each engaged
  exposure.
- **Interest**, a Beta whose counts decay with a 120-day half-life, with the person's own reply rate as
  the prior.
- **What to raise next:** a Thompson draw from interest plus (1 - awareness) x importance, minus
  anything mentioned in the last two weeks.

Every reply, new email and reconnect the agent drafts is told what the contact knows well (do not
re-explain), what they heard before (refer back) and what is worth raising.

---

## 4. Relationship and pipeline inference (the email CRM)

- **Reply odds.** Each settled email (a reply within seven days, or none) is an example with features
  known at send time: the contact's smoothed reply rate, time since they last wrote, thread depth, who
  started it, length, questions, weekend, two-way history. A regularized logistic model is trained on
  the oldest three quarters and scored on the newest quarter against the baseline (each contact's rate
  shrunk toward the person's); whichever has the lower Brier score is used. The Brier score, skill score
  and a reliability table are shown.
- **Time to reply and when to nudge.** Kaplan-Meier over every email, still-waiting ones censored; the
  plateau is the share that never replies. A nudge is due when the chance of an unprompted reply in the
  next three days falls below 5%.
- **Relationship strength.** Recency-weighted interactions (two-way 1.5, inbound 1, unanswered 0.25,
  60-day half-life) times reciprocity, scaled to the person's own mail volume; bands at 60 and 40
  (Gilbert and Karahalios 2009 on recency; Affinity and Dynamics 365 on the scoring).
- **Going quiet:** people who wrote regularly and have gone past twice their usual gap.
- **Deal odds and the pipeline.** Stage priors calibrated to the desk's own wins and losses (shrunk with
  κ = 20), moved on the logit scale by idle time, an overdue next step, relationship strength and recent
  replies. The number of wins is exact (Poisson-binomial); the value is 10,000 seeded draws.

---

## 5. Data and licences

| Source | Use | Terms |
|---|---|---|
| SEC EDGAR and XBRL (company facts, frames) | Fundamentals, credit, quality, forecasts, the screener | Public |
| U.S. Treasury par yield curve | GC, WACC, recession odds | Public domain |
| BLS | ECO outlooks, the Sahm rule, the assistant's macro tool | Public domain (the keyless API allows 25 requests a day; answers are cached for 12 hours) |
| FRED | ECO display tiles only | FRED's terms bar using its content in connection with machine learning or LLMs, and some series belong to third parties (ICE BofA, Cboe VIX, the Michigan survey), so FRED data is shown with attribution and never sent to a model or used to fit one |
| Financial Modeling Prep | Prices, quotes, estimates, grades, dividends, M&A, sectors | The free plan covers daily prices for about 87 sample tickers and caps requests per day; FMP Starter (about $19 a month billed yearly) covers all US symbols, and a separate display licence is needed before prices are shown to paying users |
| Loughran-McDonald dictionary | Not used | Academic licence only |

### Backups when FMP is out

The free plan's daily cap and its 87-ticker limit made the terminal fragile, so every market-data call
now falls back in order (`src/lib/market/data.ts`):

1. **Free sources.** Nasdaq's quote API (keyless) for every US stock and ETF: daily history, quotes,
   market cap, dividends, earnings surprises and dates, EPS forecasts, analyst targets and ratings,
   movers. ETFs stand in for what Nasdaq does not list (S&P 500 via SPY, gold via GLD; returns, not
   levels). The ECB's reference rates for currencies (via Frankfurter), CoinGecko for crypto, the SPDR
   sector ETFs for sectors, and merger filings on SEC EDGAR for deals. Nasdaq has dividend history only
   for Nasdaq-listed stocks, so for the rest DVD reads dividends per share from the company's own 10-K
   and 10-Q XBRL: fiscal quarters for the table, 10-K fiscal years for growth and the no-cut streak (a
   52-week year ending 2023-01-01 counts as fiscal 2022).
   Per-share history is restated for splits (`src/lib/edgar/splits.ts`). A split shows as the cover-page
   share count (dei:EntityCommonStockSharesOutstanding) jumping between two filings by a split-like
   ratio; the dividends must show it too, so a stock-funded merger that happens to add half the share
   count restates nothing. Amounts as paid change at the split itself; filings restate their
   comparatives for a few years, so there the boundary is the first step of about the split ratio. A
   10-for-1 with a raise at the split (NVIDIA, 2024) is still caught: the fall need only be a third of
   the split's size in log terms.
2. **AI research** (`src/lib/market/research.ts`), for facts rather than series. GPT-5.6 Luna, the
   cheapest OpenAI model with web search (about 1 to 3 cents a lookup, mostly the search fee), returns
   each figure with its date, its page and a verbatim quote. A figure is kept only if the page is one
   the search actually retrieved and not a forum or social network, the quote contains the number, it
   is fresh enough for its kind, and it passes cross-checks (a price inside its 52-week range, a market
   cap near price times SEC shares, targets near the price). Under half surviving triggers one retry
   on GPT-5.4 mini. Results are cached for 4 to 12 hours and logged, search fees included.

Yahoo Finance (what yfinance scrapes) was tested first and refused: it now answers plain requests with
HTTP 429, and yfinance itself only gets through by impersonating Chrome's TLS fingerprint. Stooq and
Cboe sit behind bot checks. Nasdaq's API is the site's own, meant for personal use, so the backups suit
the free beta and switch off with `MARKET_BACKUP=off`.

---

## 6. Left for later

- The Campbell-Hilscher-Szilagyi failure model, and calibrating PDs on EDGAR bankruptcies (8-K Item 1.03).
- Fitting the knowledge-tracing parameters per skill (EM or a grid) and half-life regression or FSRS for
  spaced refreshers; Elo placement tests.
- Isotonic calibration once there are 1,000+ labelled emails; FTRL-Proximal online learning; Thompson
  sampling for send times in the recipient's time zone; a cure-rate survival model.
- A filing-change detector (Lazy Prices), a text-and-returns peer engine, and robust anomaly alerts.
- Batch processing for backfills and nightly passes (half price), and hybrid (keyword plus embedding)
  retrieval over filings with a reranker.
- More free-data functions the research found: DTCC single-name CDS, the Atlanta Fed's market-implied
  rate probabilities, and XBRL executive pay.

---

## Key references

- Makridakis, Spiliotis and Assimakopoulos (2018), the M4 competition; Hyndman and Billah, "Unmasking the Theta method".
- Angelopoulos and Bates, "A gentle introduction to conformal prediction" (arXiv:2107.07511).
- Altman (2018), fifty-year Z-score retrospective; Ohlson (1980); Bharath and Shumway (2008).
- Beneish (1999); Piotroski (2000); Sloan (1996); Novy-Marx (2013).
- Welch (2022), "Simply better market betas"; Blume (1975); RiskMetrics; Kupiec (1995).
- Estrella and Mishkin, and the New York Fed's yield-curve model; Sahm (2019); Nelson and Siegel (1987), Diebold and Li (2006).
- Damodaran, probabilistic approaches to valuation (NYU Stern lecture notes).
- Corbett and Anderson (1994), BKT; Khajah, Lindsey and Mozer (2016); Settles and Meeder (2016), half-life regression; Kalyuga et al. (2003).
- Gilbert and Karahalios (2009), tie strength; Niculescu-Mizil and Caruana (2005), calibration; McMahan et al. (2013), FTRL.
