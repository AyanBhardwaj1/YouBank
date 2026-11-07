# Decision-science and investment-skill measurement edges (2015-2026) for YouBank

Scope note: This catalogue covers findings beyond what YouBank already ships (kill criteria, decision journal, process-health items, Brier + Platt recalibration, pre-mortem prompt, volatility base rate, AI bull/bear committee). Each item gives what it measures, the evidence and its strength, how to compute it from a fund's own records, and why a PM or allocator would care. Evidence grades: **[Robust]** means peer-reviewed and replicated or a top-journal result with broad support. **[Single study]** means one peer-reviewed or working paper. **[Vendor]** means a vendor's claim from its own client data, not independently audited. Some foundational studies are older than 2015 and are marked as such.

Research limitation: papers.ssrn.com and nber.org were blocked in this session's network, so full texts on those hosts were not read. Most figures below come from abstracts, publisher records or trade-press summaries, as noted.

---

## Q1. Skill vs luck and decision attribution (buying, selling, sizing, holding-period alpha decay)

### Takeaway
The best-evidenced, most product-ready edge is **decomposing a PM's alpha by decision type** (entry/stock pick, add, trim/"scale out", exit, sizing) and benchmarking each against a random or passive counterfactual from the fund's own trades. The academic evidence (top journal, 2023) and vendor data both say PMs are usually skilled at buying and poor at selling and sizing. Alpha from an idea decays over months, and PMs typically hold well past that decay.

### Cited Findings
**Selling vs buying skill (academic, robust)**
- Akepanidtaworn, Di Mascio, Imas & Schmidt, "Selling Fast and Buying Slow: Heuristics and Trading Performance of Institutional Investors," *Journal of Finance* 78(6), 2023, pp. 3055-3098 (SSRN 2019, NBER w29076 2021). Institutional PMs show skill in buying, but their selling decisions underperform substantially, **even relative to random-selling strategies**. — [NBER](https://nber.org/papers/w29076); [SSRN](https://papers.ssrn.com/abstract=3301277); [EconPapers](https://econpapers.repec.org/RePEc:nbr:nberwo:29076)
- Mechanism: attention. The authors find a systematic, costly heuristic process for selling but not for buying. Search summaries say selling is triggered by extreme past returns (a CFA Society India summary of an earlier version, not checked against the paper). — [CFA Society India](https://www.cfasocietyindia.org/events/research-paper-discussion); [SUFE newsletter](https://academicnewsletter.sufe.edu.cn/info/359038)
- The paper won first prize in the 2024 Dimensional Fund Advisors Prize for the *Journal of Finance*, which signals strong field acceptance. — [AFA/JF](https://afajof.org/news/journal-of-finance-webinar-2024-dimensional-fund-advisors-prize)

**Alpha decay after entry (academic + vendor)**
- Di Mascio, Lines & Naik, "Alpha Decay" (SSRN 2580551; 2015 draft, 2017 version). Professional asset managers' trades earn positive alpha. Returns on stocks institutions buy decline gradually over time, and managers build positions gradually and unwind them gradually once the alpha is exhausted. Reported figures: trading continues about as long as alpha stays positive (~12 months), and the average holding period is ~2.2 years. [Single study, working paper; Di Mascio runs Inalytics.] — [SSRN PDF via top1000funds](https://www.top1000funds.com/wp-content/uploads/2021/05/SSRN-id2580551.pdf)
- Essentia Analytics, "endowment effect" study: ~10,000 position episodes, 43 portfolios, 14 years. Alpha starts strong and fades sharply with position age. The average idea was held 275 business days. The top-alpha quartile held ~133 business days (~6 months). Curbing over-attachment was estimated to be worth ~1.2% annual portfolio-level alpha. A separate summary cites ~400 bp peak-to-trough decay per position. [Vendor; reported via trade press.] — [Institutional Investor](https://www.institutionalinvestor.com/article/b1hxzwxndzj7rc/Active-Equity-Managers-Actually-Do-Generate-Alpha-Here-s-How-They-Squander-It); [Wealth Professional](https://www.wealthprofessional.ca/news/industry-news/are-active-managers-wasting-their-alpha-advantage/321742); [Validea blog](https://blog.validea.com/heres-how-active-managers-squander-alpha/)
- Essentia founder Clare Flynn Levy suggested automated reminders tied to each manager's own alpha-decay pattern. — [Wealth Professional](https://www.wealthprofessional.ca/news/industry-news/are-active-managers-wasting-their-alpha-advantage/321742)

**Decision-type benchmarking (vendor)**
- Essentia 2022 "Behavioral Alpha Benchmark": 76 long-only equity PMs, 36 months to 30 Mar 2022.
  - Sizing was the weakest decision type: only 38% of managers added value there.
  - Stock picking was the strongest: 58% added value.
  - About three-quarters destroyed value through "scaling out" (trimming/selling).
  - Only 18% made value-adding decisions most of the time, but just over two-thirds gained more when right than they lost when wrong (asymmetric payoff).
  - [Vendor; clients only.] — [Investment International](https://investment-international.com/News/only-18-of-fund-managers-make-the-right-decision-most-of-the-time/); [Institutional Investor](https://www.institutionalinvestor.com/article/b1zsqjnqsxx2fd/were-those-great-returns-the-result-of-skill-or-just-luck)
- Essentia persistence study: 123 portfolios, 2014-2023. Managers whose decisions showed skill over the past year were more likely to beat their benchmark over the next 12 months. The relationship stayed statistically significant for nearly two years for the median PM (Essentia says this is where significance fades, not necessarily where skill ends). The methodology was reportedly peer-reviewed in the *Journal of Investing*. [Vendor + journal.] — [Institutional Investor](https://www.institutionalinvestor.com/article/2bstrsmm8ilt81f43pslc/corner-office/these-managers-have-real-skill-not-just-luck); [I&C](https://ioandc.com/?p=34796)
- Inalytics hit rate (winners as a % of decisions) and win/loss ratio (alpha from good decisions ÷ alpha lost on bad ones). Across 215 long-only portfolios: average hit rate 49.6%, average win/loss 102%. A later summary puts the industry win/loss at ~100% and calls ~110% "good". An Inalytics/GLG paper found a strong win/loss ratio mattered more than a consistent hit rate. Pension funds use this for manager selection and monitoring. [Vendor.] — [The Hedge Fund Journal](https://thehedgefundjournal.com/identifying-manager-skill/); [Money Management](https://www.moneymanagement.com.au/news/funds-management/fund-managers-nail-half-investment-decisions); [Global Custodian](https://www.globalcustodian.com/inalytics-and-glg-examine-managers/); [top1000funds](https://www.top1000funds.com/organisational-design/working-hard-for-the-money-funds-managers-need-to-self-examine/)

**Position sizing / conviction (academic foundational + vendor)**
- Cohen, Polk & Silli, "Best Ideas" (working paper from ~2010, pre-window but foundational). PMs' highest-conviction holdings outperform the market and the PM's other holdings: ~1-4% per quarter depending on benchmark and definition (one version: 39-127 bp/month). Returns fall monotonically from the top pick down. The effect is strongest in illiquid and unpopular stocks and in small funds. Critiques: "best ideas" is inferred from weights, not confirmed by managers, and the figures exclude costs and fees. — [LSE PDF](https://personal.lse.ac.uk/polk/research/BestIdeas.pdf); [LSE Research Online](https://researchonline.lse.ac.uk/id/eprint/24471); [HBS Working Knowledge](https://hbswk.hbs.edu/item/best-ideas); [Stockopedia/Medium](https://medium.com/stockopedia/how-you-can-beat-fund-managers-by-cloning-their-best-ideas-d5a38f825fe8)
- Alpha Theory client data (vendor, numbers shift between annual reports):
  - 2025 review: across 14 years and 200+ funds, sizing by research-implied expected return raised annual returns from 7.9% to 11.8%.
  - 2024 review: optimal sizing beat a randomly chosen position 56% of the time and equal weight by 2.5%.
  - 2022 review: equal weight beat managers' actual sizing by 1.6%.
  - [Vendor; self-selected clients.] — [Alpha Theory 2025](https://www.alphatheory.com/blog/alpha-theory-2025-year-in-review-position-sizing-as-a-persistent-edge); [2024](https://www.alphatheory.com/blog/alpha-theory-2024-year-in-review); [2022](https://www.alphatheory.com/blog/alpha-theory-2022-year-in-review-the-year-that-broke-the-streak); [2023](https://www.alphatheory.com/blog/alpha-theory-2023-year-in-review)

### Inferences (candidate features)
- **F1. Sell-vs-random counterfactual ("Did your exits beat a coin flip?").** For each sell or trim, compare the forward return (e.g., 1, 3, 6, 12 months) of the sold name against (a) a randomly chosen other holding sold in the same amount on the same date, Monte-Carlo'd, and (b) holding unchanged. Report "selling alpha" in bp/yr with a bootstrap CI. Do the same for buys against a random buy from the fund's watchlist or universe. Inputs: trades and prices only. Value: this is a top-journal result that most PMs have never seen for themselves, and an allocator can see buying vs selling skill separately. Defensibility: needs clean per-trade history plus a counterfactual engine.
- **F2. Sell-trigger attention audit.** Tag each sell with the position's trailing return percentile at the time (the paper links sells to extreme returns), whether a thesis or kill-criterion event happened, and whether a journal reason exists. Flag sells that are "extreme-return driven, no thesis event". This extends YouBank's disposition-effect item from "holding losers" to "how you choose which name to sell".
- **F3. Personal alpha-decay curve and "half-life" nudge.** Build an event-time curve of cumulative active return by days since entry, pooled across all of a PM's positions, with a CI. Estimate the day the curve peaks or flattens. Flag positions held past the PM's own peak with no refreshed thesis. This links to YouBank's "stale theses" item but uses the PM's own empirical decay instead of a calendar rule. Essentia's ~6-month top-quartile figure is a useful prior, but it is vendor data.
- **F4. Decision-type P&L attribution (entry / add / trim / exit / sizing / timing).** Compute the hit rate and win/loss ratio per decision type, in Inalytics style, and set them against a scorecard (Essentia benchmarks: sizing 38% add value, picking 58%). Allocators already buy this from Inalytics and Essentia, which shows willingness to pay. YouBank's edge would be joining it to the journal's stated reasons.
- **F5. Conviction-weight alignment.** Correlate position weight with the PM's own recorded conviction or expected return (from forecasts) and with realized alpha. "Best Ideas" and Alpha Theory both suggest many PMs under-size their best ideas. Show "alpha left on the table" from equal weight vs actual vs conviction-proportional weights.
- **F6. Skill persistence test for allocators.** Use rolling 12-month decision-skill scores and test whether they predict the next 12 months (the Essentia design), with an explicit luck band (permutation test). This gives allocators a "skill not luck" certificate.

### Gaps
- I could not open the full JF paper (SSRN/NBER blocked), so the exact bp magnitude of selling underperformance vs random, the sample size, and the earnings-announcement/attention test details are not verified here. From memory (unverified): the sample is ~780+ institutional portfolios, and selling performance improves around earnings announcements when attention is higher. Verify before citing.
- I found no public material on **Cabot Investment Technology's** methodology. Novus analytics were not researched due to the tool budget.
- Essentia and Inalytics figures are client-sample, vendor-reported, and not independently replicated.

---

## Q2. Forecasting science measurable from logs (Tetlock/GJP, extremizing, updating, granularity, overconfidence)

### Takeaway
Beyond Brier and Platt, the replicated GJP findings give several **behavioural forecast-hygiene metrics computable from timestamped forecast logs**:
- update frequency and step size (small, frequent updates predict accuracy)
- granularity (finer probabilities are more accurate for good forecasters)
- interval calibration (overprecision)
- log-odds extremizing for pooled forecasts
- short probabilistic-reasoning training (~6-11% Brier gain)

### Cited Findings
- Atanasov, Witkowski, Ungar, Mellers & Tetlock, "Small steps to accuracy: Incremental belief updaters are better forecasters," *Organizational Behavior and Human Decision Processes* 160 (2020), pp. 19-35. It separates updating into frequency, magnitude and confirmation propensity.
  - Accurate forecasters update in small, frequent steps.
  - Small-increment updating is a valid early signal of accuracy.
  - High-frequency updaters scored higher on crystallized intelligence and open-mindedness, accessed more information, and improved over time.
  - [Single large study; GJP data.] — [Wharton PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2022/03/1-s2.0-S0749597819300949-main.pdf); [IDEAS](https://ideas.repec.org/a/eee/jobhdp/v160y2020icp19-35.html); [Gelman blog post by Atanasov](https://statmodeling.stat.columbia.edu/2021/01/31/small-steps-to-accuracy-incremental-updaters-are-better-forecasters/)
- Granularity: GJP work (Mellers et al., described in *Superforecasting*, 2015) found that rounding forecasts to coarser increments reduced accuracy. The average forecaster who sticks to multiples of 10 is less accurate than one who uses multiples of 5. [Robust within GJP; source here is a secondary review.] — [EconLib review](https://www.econlib.org/archives/2015/10/superforecastin.html)
- Chang, Chen, Mellers & Tetlock, *Judgment and Decision Making* 11(5), 2016. A training module under one hour ("CHAMPS KNOW") improved Brier scores 6-11% over control across a four-year tournament. The authors call this a likely lower bound. [Robust: RCT across years.] — [Cambridge PDF](https://cambridge.org/core/services/aop-cambridge-core/content/view/123EB18425391D05FA6581FDBB3F309F/S1930297500004599a.pdf/developing-expert-political-judgment-the-impact-of-training-and-practice-on-judgmental-accuracy-in-geopolitical-forecasting-tournaments.pdf); [IDEAS](https://ideas.repec.org/a/cup/judgdm/v11y2016i5p509-526_8.html)
- GJP predictors of accuracy: dispositional factors (cognitive ability, knowledge, open-mindedness) and situational ones (probabilistic-reasoning training, collaborative teams that shared information and discussed rationales). — [Upenn repository (Mellers et al.)](https://repository.upenn.edu/fnce_papers/60)
- Extremizing: Baron, Mellers, Tetlock, Stone & Ungar, "Two Reasons to Make Aggregated Probability Forecasts More Extreme," *Decision Analysis* 11(2), 2014.
  - Averaged probabilities are under-extreme for two reasons: random error pulls the mean toward 0.5, and forecasters discount for their own incomplete information.
  - Pushing aggregates toward 0 or 1 improves accuracy. Transforming individual forecasts and then averaging in log-odds gave the largest gain.
  - Theory: Satopää, Pemantle & Ungar (JASA 2016) tie the optimal degree of extremizing to how much forecasters' information overlaps.
  - Caveat: Peker & Wilkening (IJF 2025) show extremizing a wrong-sided average can worsen calibration.
  - [Robust, with known failure mode.] — [Wharton PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2015/07/2015---two-reasons-to-make-aggregated-probability-forecasts_1.pdf); [arXiv Satopää](https://arxiv.org/pdf/1406.2148v2); [NYUAD WP 2024 on metabelief recalibration](https://nyuad.nyu.edu/content/dam/nyuad/academics/divisions/social-science/working-papers/2024/WP%200102.pdf)
- Overprecision in finance professionals: Ben-David, Graham & Harvey, "Managerial Miscalibration," *QJE* 2013 (pre-window, foundational). CFOs' 80% confidence intervals for S&P 500 returns contained the outcome only ~36% of the time (33-38% across versions; >11,600 forecasts). Miscalibrated executives ran more aggressive policies (more investment, more debt). Follow-up (Boutros, Graham, Harvey et al.): 31.5% hit rate in the full sample, and CFOs update their intervals after misses too slowly to reach calibration. [Robust.] — [NBER WP](https://www.nber.org/papers/w16215.pdf); [VoxEU](https://cepr.org/voxeu/columns/managers-are-miscalibrated); [Boutros-Graham-Harvey (BFI)](https://bfi.uchicago.edu/wp-content/uploads/Managerial-Recalibrations_Boutros_Graham_Harvey.pdf)
- Reciprocal scoring for unresolvable or long-horizon questions: Karger, Monrad, Mellers & Tetlock (working paper, Oct 2021). Independent panels forecast each other's forecasts. A secondary summary says it performed about the same as traditional scoring in an RCT. Karger, Atanasov & Tetlock extend this to "intersubjective" metrics for long-run questions. [Single study; WP.] — [Wharton PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2022/03/SSRN-id3954498.pdf); [ACX summary](https://www.astralcodexten.com/p/mantic-monday-1115); [FHI](https://www.fhi.ox.ac.uk/improving-judgments-of-existential-risk)

### Inferences (candidate features)
- **F7. Belief-updating profile.** From forecast revision logs, compute per PM:
  - update frequency per forecast-month
  - median absolute step (pp)
  - share of "jump" updates (>20pp)
  - confirmation propensity (share of updates that move further in the prior direction)
  - "stuck" forecasts with no revision despite thesis-relevant news (journal entries, price moves beyond the volatility base rate)
  Atanasov et al. show small, frequent steps predict accuracy, so this gives an early skill signal months before Brier scores stabilise. This is especially valuable because investment questions resolve slowly.
- **F8. Granularity check.** Share of forecasts on round 10s or 50/50, plus a per-forecaster test of whether coarsening their forecasts to 10s would hurt their Brier score (the GJP method). If it would not, their fine-grained numbers carry no information. Cheap to compute.
- **F9. Interval calibration (overprecision) for price targets and estimates.** Ask for an 80% range on each price target or KPI estimate and track the hit rate (target ≈80%; CFO benchmark ≈36%). Show a recommended widening factor. This complements the binary Brier score, which does not capture overprecision on continuous targets.
- **F10. Log-odds pooling and extremizing for the AI committee and team forecasts.** Pool chair and analyst forecasts as a mean of log-odds, then extremize with a parameter fitted on the fund's own resolved history. Shrink the extremizing when forecasters share information or when the pool is wrong-sided (per Satopää and Peker & Wilkening). This directly upgrades YouBank's "pooled chairs".
- **F11. Micro-training plus measurement.** A built-in under-one-hour CHAMPS-KNOW-style module (base rates, averaging perspectives, granularity, updating), with a before/after Brier comparison. The 6-11% gain is RCT-based, which makes the claim credible to buyers.
- **F12. Reciprocal / intersubjective scoring for multi-year theses.** Have team members (or independent LLM agents) predict each other's long-horizon probability. This scores thesis forecasts that won't resolve for years.

### Gaps
- No finance-specific replication of the Atanasov updating result (on PM forecasts of earnings, price targets and so on) was found.
- "Cost of overconfidence" in bp for portfolios: no clean, sourced estimate was found beyond the CFO-policy link.

---

## Q3. Debiasing in investment committees (pre-mortem, red teams, devil's advocacy, noise audits, reference class, decision hygiene)

### Takeaway
**Noise audits** are the most directly productisable idea: the same case is scored independently by several people and the dispersion is measured. Kahneman, Sibony & Sunstein report large, unexpected variability among professionals (insurance underwriters about 5x what executives expected). Structured dissent (devil's advocacy) has meta-analytic support over expert-only approaches, but the evidence is older and mostly from lab studies. LLM devil's advocates have early RCT support (2024).

### Cited Findings
- *Noise* (Kahneman, Sibony, Sunstein, 2021). Noise is defined as the variability of error, distinct from bias, which is the average error.
  - Insurance underwriter audit: a ~55% median difference in premiums for identical cases, against executives' expectation of ~10%. Other secondary sources state it as "up to 40%" or "~50%".
  - Decision hygiene includes sequencing information, aggregating independent estimates, guidelines and resisting premature intuition.
  - [Book; underlying audits are consultancy case studies, not peer-reviewed replications.] — [Behavioral Scientist interview](https://behavioralscientist.org/a-conversation-with-daniel-kahneman-about-noise/); [McKinsey Quarterly](https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/sounding-the-alarm-on-system-noise); [CLM](https://www.theclm.org/Magazine/articles/turn-down-that-noise/2381); [Becker's](https://www.beckershospitalreview.com/strategy/the-ironically-quiet-threat-plaguing-organizations.html)
- Devil's advocacy (DA) and dialectical inquiry (DI):
  - Schwenk's 1990 meta-analysis (*OBHDP* 47:1) found DA more effective than the expert-only approach in general. DI's superiority over expert-only was not shown on ill-structured tasks, and neither DA nor DI was clearly better than the other.
  - Valacich & Schwenk (1995): DA groups considered more alternatives and chose higher-quality recommendations than DI or expert groups.
  - [Robust but pre-2015, lab-based.] — [Meta-analysis record](https://data.zhenzhi.com/details/1/999233521); [Arizona (Valacich & Schwenk)](https://experts.arizona.edu/en/publications/devils-advocacy-and-dialectical-inquiry-effects-on-face-to-face-a/); [SMJ 1989](https://ideas.repec.org/a/bla/stratm/v10y1989i3p303-306.html)
- LLM devil's advocate: Chiang, Lu, Li & Yin, IUI 2024 (Purdue), randomized human-subject experiment.
  - An LLM devil's advocate arguing against the AI recommendation promoted groups' *appropriate* reliance on AI.
  - Interactive advocates that engaged with members' arguments worked best, mainly on in-distribution cases.
  - It did not raise perceived process quality.
  - A 2025 follow-up studies AI devil's advocates for minority voices in power-imbalanced groups.
  - [Single study.] — [NSF PAR](https://par.nsf.gov/servlets/purl/10524816); [arXiv 2502.06251](https://arxiv.org/abs/2502.06251); [arXiv 2503.14263](https://arxiv.org/pdf/2503.14263)

### Inferences (candidate features)
- **F13. Committee noise audit.** Periodically give each committee member (and each AI chair) the same thesis packet. Each scores it independently and blind on expected return, probability the thesis is right, conviction size and kill level, before any discussion. Report the dispersion (coefficient of variation, pairwise median absolute difference) and decompose it into level noise (a person who is always more bullish) and pattern noise. Repeat with the same case after some weeks to measure occasion noise. Allocators can ask for this as an "IC consistency" statistic. YouBank already collects independent briefs, so this is a natural extension.
- **F14. Independent-first sequencing enforcement.** Log whether each member's estimate was entered before seeing others' or the chair's view, using timestamps against when the discussion opened. Score the "anchoring exposure" of each decision. This is core decision hygiene.
- **F15. Interactive AI devil's advocate targeting the majority.** Upgrade the bull/bear briefs. When the committee converges, an agent argues against the *current consensus* and replies to specific members' arguments (Chiang 2024 found interactive and engaging versions worked best). Measure "appropriate reliance": were overrides of the AI right more often than not?
- **F16. Reference-class panel.** For each thesis type (turnaround, compounder, event and so on), show the fund's own historical base rate of success and the median return and holding-time distribution from its records. This is "outside view from your own book" and complements the volatility base rate. (See gaps: no new sourced evidence was gathered on reference-class forecasting.)

### Gaps
- No peer-reviewed noise audit of **investment committees** was found. The underwriter result is from an insurance setting and reported in a book.
- Pre-mortem efficacy: the commonly cited "prospective hindsight increases reasons generated by ~30%" (Mitchell, Russo & Pennington 1989) was not confirmed in this session's searches. Treat it as unverified. I found no recent (2015+) RCT of pre-mortems in finance.
- Reference-class forecasting (Flyvbjerg) and red-teaming evidence were not researched within the tool budget.

---

## Q4. Behavioural signals from text and LLM-assisted debiasing (2024-2026)

### Takeaway
Evidence that **manager text predicts performance is mixed**. A *Management Science* 2025 paper finds positive tone predicts more risk and style bets, not future performance. Another study finds confidence predicts performance only after conditioning on past returns. A thesis suggests an inverted U. The stronger 2024-2026 evidence is on **LLM assistants improving human forecasts** (RCT, +24-28% accuracy) and LLM devil's advocates. LLMs also carry their own investment biases (confirmation-like behaviour, overconfidence), which a product must audit.

### Cited Findings
- Hillert, Niessen-Ruenzi & Ruenzi, "Mutual Fund Shareholder Letters: Flows, Performance, and Managerial Behavior," *Management Science* 71(5), 2025, pp. 4453-4473.
  - Investors respond to tone: a less negative tone brings higher net flows.
  - A positive writing style predicts higher idiosyncratic risk and more style bets, but has no consistent predictive power for future performance.
  - [Single study, top journal.] — [SAFE](https://safe-frankfurt.de/de/publikationen/details/publicationname/mutual-fund-shareholder-letters-flows-performance-and-managerial-behavior-1466.html); [EconPapers](https://econpapers.repec.org/RePEc:inm:ormnsc:v:71:y:2025:i:5:p:4453-4473)
- LMU working paper (authors not identified in search), 10,813 equity-fund shareholder letters, 2006-2016.
  - Net textual confidence does not predict alpha on its own.
  - Conditional on past performance it does: among bottom performers, higher confidence predicts better future performance.
  - Flows do not respond to confidence.
  - [Single WP.] — [LMU PDF](https://cba.lmu.edu/media/lmucollegeofbusinessadministration/responsivesite/research/paper_6.pdf)
- Edinburgh thesis on fund manager commentaries.
  - Overconfidence is proxied by overoptimism, excessive certainty and excessive self-reference.
  - Strong past performance raises measured overconfidence.
  - Overconfidence vs subsequent performance follows an inverted U.
  - [Thesis.] — [Edinburgh Research Archive](https://era.ed.ac.uk/handle/1842/9705)
- Schoenegger, Park, Karger, Trott & Tetlock, "AI-Augmented Predictions: LLM Assistants Improve Human Forecasting Accuracy," arXiv Feb 2024; *ACM TiiS* 2025.
  - N = 991.
  - Frontier LLM assistants improved accuracy 24-28% vs control in the published version (23% in the preprint).
  - Even a deliberately overconfident, base-rate-neglecting assistant helped.
  - Without an outlier question: superforecasting-prompted assistant +41%, noisy assistant +29%.
  - Authors call for robustness work.
  - [Single RCT, strong design.] — [arXiv](https://arxiv.org/abs/2402.07862); [MIT DSpace](https://dspace.mit.edu/handle/1721.1/158063); [LSE](https://researchonline.lse.ac.uk/id/eprint/127059)
- LLM investment bias:
  - "Your AI, Not Your View" (arXiv 2507.20957, ICAIF '25): LLMs reverse with 100% counter-evidence, but minimal supporting evidence for their initial lean sharply reduces their willingness to adapt. Some models show Dunning-Kruger-like self-trust.
  - "Are LLMs Rational Investors?" (Findings of ACL 2025): measures overconfidence, anchoring, loss aversion and framing in LLMs. A causal-knowledge debiasing method cut bias 68% for the most biased model (abstract-level claim).
  - [Single studies.] — [arXiv 2507.20957](https://arxiv.org/abs/2507.20957v1); [ACL Findings 2025](https://preview.aclanthology.org/anlp-naacl/2025.findings-acl.1239.pdf)

### Inferences (candidate features)
- **F17. Journal language analytics, framed as risk and behaviour signals, not alpha signals.** Score journal and memo entries for:
  - certainty words vs hedges
  - self-reference ("I/we" vs evidence)
  - tone
  - whether disconfirming evidence is mentioned
  The Management Science result supports using tone to flag **upcoming risk-taking and style bets**, not as a performance predictor. Pair it with past performance (LMU) and watch for overconfidence building after hot streaks (Edinburgh). Use it as a coaching prompt, not a scorecard.
- **F18. "Superforecaster-prompted" LLM forecast assistant with an A/B log.** Before each forecast, offer an LLM base-rate and consideration assistant. Record pre-assistant and post-assistant probabilities so the fund can measure its own "AI uplift" in Brier score. The Schoenegger RCT makes a 20%+ uplift claim plausible but unproven in finance.
- **F19. Bias audit of YouBank's own AI committee.** Periodically run the committee on cases with planted contradictory evidence and measure its updating (per arXiv 2507.20957), and monitor whether chairs anchor to their first brief. This answers the allocator question: "how do I know your AI isn't just confirming the PM?"

### Gaps
- I found no study (2015-2026) linking **private decision-journal text** (rather than public letters) to subsequent investment outcomes.
- No RCT of LLM-assisted debiasing with professional PMs on real portfolios was found.

---

## Q5. What allocators measure about managers' process (process consistency, style drift)

### Takeaway
Allocators already pay for decision-level skill analytics (Inalytics hit rate and win/loss, Essentia behavioural benchmarks) and use style consistency as a screen. Academic support for style consistency predicting performance is mixed and regime-dependent. A product edge is to give allocators **verifiable, record-derived process metrics** (decision-type skill, its persistence, drift between stated process and actual behaviour) rather than returns-based style analysis alone.

### Cited Findings
- Inalytics: pension funds use hit rate and win/loss analytics for manager selection and monitoring, not only for managers' own self-improvement. Inalytics argues track records are a weak guide to skill. — [top1000funds](https://www.top1000funds.com/organisational-design/working-hard-for-the-money-funds-managers-need-to-self-examine/); [Euromoney](https://www.euromoney.com/article/b1322l1ksyv7s6/money-management-lucky-or-smart)
- Essentia's persistence result: past-year decision skill predicts next-year outperformance (see Q1). Institutional Investor frames this as tooling for allocators picking managers. — [Institutional Investor](https://institutionalinvestor.com/article/2cax680d5kzzm6kw5gav4/portfolio/theres-no-gps-for-outperforming-managers-but-this-can-get-investors-closer)
- Style consistency:
  - Brown & Harlow (and Brown, Harlow & Zhang 2009, "Staying the course"): style-consistent funds outperformed (3,177 Morningstar funds, 1991-2000).
  - Holmes & Faff: the effect is driven by rising-market months.
  - Loick (2017): consistency matters, and the financial crisis changed the relation.
  - Wermers: the link between style consistency and stock-picking talent is "at best, tenuous."
  - [Mixed.] — [FA Magazine](https://www.fa-mag.com/news/article-770.html); [Maastricht Marble (Loick)](https://openjournals.maastrichtuniversity.nl/Marble/article/view/408); [Wikipedia: Style drift](https://en.wikipedia.org/wiki/Style_drift)

### Inferences (candidate features)
- **F20. Stated-process vs revealed-process drift.** Compare each PM's declared rules (max position size, holding horizon, sell discipline, kill-criteria usage, sector or factor limits) with behaviour over rolling windows. Add returns-based factor exposure drift, but anchor it to the **mandate the PM wrote down in YouBank**. This is more defensible than generic returns-based style drift because it needs the journal.
- **F21. Allocator "process tear sheet".** One exportable, auditable page with:
  - decision-type hit rate and win/loss with luck bands (F4/F6)
  - sell-vs-random (F1)
  - personal alpha-decay half-life (F3)
  - forecast calibration, updating profile and interval calibration (F7-F9)
  - committee noise (F13)
  - process-drift score (F20)
  Each metric would come with its evidence grade. Inalytics and Essentia sell parts of this as consulting-style reports, so a self-serve, continuously updated version is the gap.

### Gaps
- No public, quantified evidence was found on which process metrics allocators weight most (e.g., survey data from AIMA, CFA Institute or consultants). Not researched within the tool budget.
- The Brown, Harlow & Zhang full text was not retrieved. The figures above are from secondary coverage, and the study period predates 2015.
