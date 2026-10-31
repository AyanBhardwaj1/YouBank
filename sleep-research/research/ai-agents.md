# Frontier AI agent techniques for YouBank (finance research + deal agents)

*Run youbank-frontier-20261031. Written 2026-10-31. Track: frontier LLM/agent techniques, mid-2025 to Oct 2026.*

## How to read this file

- **Method.** 27 distinct web searches (benchmarks, verification, long-horizon agents, tools and protocols,
  cost, safety), plus two fetched primary pages: Anthropic's tool-search documentation and the MCP
  2026-07-28 release post. Claude model IDs, prices and API behaviour come from Anthropic's Claude API
  reference bundled with Claude Code, which was cached on 2026-10-06.
- **Limits of this run.** WebFetch could not reach `arxiv.org` or `developers.openai.com`: the hosts did not
  resolve in this sandbox. arXiv figures therefore come from search-result snippets of the abstract or
  HTML page, not from reading the full paper. The shared web-search budget also ran out before the
  planned cross-checks. Allow those hosts and re-run the cross-checks before quoting any number in
  marketing.
- **Tags.**
  - **[V]**: confirmed on a fetched primary page or in Anthropic's own API reference.
  - **Untagged**: the primary source (arXiv abstract or official page) as the search engine summarised it.
  - **[UNVERIFIED]**: only an aggregator, blog or press item says so, or the sources conflict.
- **Already covered.** `docs/research/ai-inference.md` (Sept 2026) covered task routing, prompt caching,
  effort levels, the Claude 5 thinking bug and batch pricing in principle. This file does not repeat those
  findings. It adds what is new or more specific.
- **What exists in code today** (`src/lib/ai/`). Both providers run in one hand-written loop in
  `agent.ts`. The chat tool set is `CHAT_TOOLS`: about 39 data tools across `tools.ts`,
  `inference-tools.ts`, `crypto/ai-tools.ts` and `quant/ai-tools.ts`, and every one is sent on every turn.
  Separately, `/app/tools` holds 328 tools (230 AI workflows and 98 calculators, in `src/lib/workflows/`),
  and the chat agent cannot call them.
  - `route.ts` sends classify/extract/summarize work to `claude-haiku-4-5` or `gpt-5.6-luna`.
  - `deep.ts` runs a 30-turn deep-research mode at xhigh effort.
  - `calc.ts` is a safe arithmetic tool.
  - `research.ts` keeps a web figure only when the quoted text on the page contains the number.
  - `algo/agent-gate.ts` already splits the trading agent into a plan step and an execute step, and it
    marks a turn as tainted once outside text has been read.

---

## Executive summary

1. **Finance agents are still at roughly 60% on the hardest public finance benchmark, and the leaderboard
   changes every month.** Mirrors of Vals AI's Finance Agent v2 put the top score at 58.6–61.4% between
   July and September 2026. The leader changed from Claude Opus 5 to Gemini 3.8 Flash in that window
   [UNVERIFIED: mirrors disagree]. A 27B finance-specific model, Mint-Ag, reports 60.49% on v2 and 76.00%
   on v1.1 (arXiv 2608.16386). Small specialised models now match the frontier on this benchmark.
2. **Spreadsheet agents fail on real business workbooks.** On SpreadsheetBench 2 the best system scores
   34.89%, and debugging tasks score only 12%. The main causes are not inspecting the sheet enough and
   writing to the wrong cell (arXiv 2606.29955). Studio should treat "inspect before write, verify after
   write" as required.
3. **The errors are about evidence and numbers, not writing.** In Deep FinResearch Bench, agent
   factuality ran from 86.0% down to 53.2%. The agent that wrote the best-graded reports was among the
   least factual [UNVERIFIED: secondary summary]. Getting the evidence out of the source and doing the
   arithmetic are the recurring failure points.
4. **More thinking can hurt on simple lookups.** In FinSearchComp, models with thinking modes scored
   about 7 points worse on simple time-sensitive data fetching (arXiv 2509.13160, ICLR 2026). Lookups
   should run at low effort.
5. **Checking an answer costs far less than finding it.** In one study, verifying a candidate answer took
   18 tool calls against 75.3 to solve the problem. Spending compute on a verifier gave +10 points for
   about one fifth of the extra tool calls that more search would need [UNVERIFIED: arXiv ID not
   confirmed]. This suits YouBank's deep-research and memo flows well.
6. **Tool search is now standard on both APIs.**
   - Anthropic's docs say tool-selection accuracy degrades past 30–50 tools. Tool search cuts
     tool-definition tokens by more than 85% and handles up to 10,000 deferred tools [V].
   - OpenAI ships hosted `tool_search` with namespaces for gpt-5.4 and later.
   - This lets YouBank offer the chat agent all 328 workflows and calculators without bloating context.
7. **Prices for small models fell about tenfold.**
   - Claude Haiku 5.5 is $0.10/$0.50 per MTok, against $1/$5 for the Haiku 4.5 that `route.ts` uses [V].
   - Claude Opus 5.5 is $4/$20, against $5/$25 for the default Opus 5 [V].
   - Aggregators list GPT-6 Luna at $0.10/$0.50 and GPT-6 Astra at $10/$50 [UNVERIFIED].
8. **A router that decides before generating usually beats a cascade.** A cascade pays for the cheap
   model's output before deciding to escalate (arXiv 2605.06350, ICML 2026). Step-level routing inside
   agent loops is the new frontier (TwinRouterBench, arXiv 2605.18859). A 2026 paper warns that reported
   routing gains are inflated (arXiv 2605.07395).
9. **MCP's 2026-07-28 spec makes YouBank's planned MCP server simpler** [V].
   - The protocol is stateless.
   - Elicitation becomes Multi Round-Trip Requests: the server returns `resultType: "input_required"`.
   - Tasks moved into an extension, and Sampling and Roots are deprecated.
   - MCP Apps, the first official extension (Jan 2026), renders interactive UI in Claude, ChatGPT and
     VS Code.
10. **Separating capabilities by design is the defence that holds against prompt injection.**
    - CaMeL completes 77% of AgentDojo tasks with provable security, against 84% undefended, at about 2.8x
      the tokens.
    - A privilege-separated email pipeline blocked all 649 LLMail attacks that worked against a single
      agent (arXiv 2603.13424).
    - YouBank's trading gate already follows this pattern. The chat agent, CRM autopilot and Studio do
      not.

---

## 1. Finance agent benchmarks and what fails

### 1.1 Leaderboards (latest numbers found)

| Benchmark | What it measures | Latest top score found | Source and date | Status |
|---|---|---|---|---|
| Vals AI Finance Agent v2 | Analyst-style research tasks with tools over SEC filings and the web | Gemini 3.8 Flash 61.4% (BenchLM, 2026-09-21); 60.60% top (AllMind, 2026-08-19); Claude Opus 5 58.6% (BenchLM, 2026-07-22); GPT-5.5 about 52% (KuCoin, May 2026) | https://www.benchlm.ai/benchmarks/financeAgentV2 · https://allmind.ai/research/ai-financial-research-benchmarks-explained · https://kucoin.com/blog/can-ai-replace-financial-analysts-in-2026-vals-ai-finance-agent-v2-reveals-gpt-5-5-hits-just-52-percent-accuracy | [UNVERIFIED]: mirrors are inconsistent, and the AllMind piece says one widely copied v2 table did not match vals.ai. Check vals.ai directly. |
| Vals AI Finance Agent v1.1 | Earlier version; not comparable with v2 | Claude Opus 4.7 64.37%, Sonnet 4.6 63.33% (2026-06-04) | https://benchlm.ai/benchmarks/valsfinanceagentv11 | [UNVERIFIED] |
| Mint-Agent (finance-native models) | FAB v1.1, FAB v2, FinSearchComp T2, RFC-Bench | Mint-Ag (27B): 76.00% FAB v1.1, 60.49% FAB v2, 98.33% RFC-Bench; Mint-Cu (9B): 69.86% FinSearchComp T2 | "Mint-Agent: Introducing Finance-Native Agentic Foundation Models", arXiv 2608.16386, 2026-08-17, https://arxiv.org/pdf/2608.16386 | Self-reported in the abstract. One secondary snippet says that on its v2 set "accuracy falls to 41.98%" and that the dominant error is evidence extraction (18.5%) [UNVERIFIED]. |
| FinSearchComp | 635 expert-written financial search questions in three families: time-sensitive fetching, simple historical lookup, complex historical investigation | Grok 4 (web) top on the global subset, "approaching expert-level"; DouBao (web) top on Greater China | arXiv 2509.13160, 2025-09-16, ICLR 2026 poster, https://arxiv.org/abs/2509.13160 · https://iclr.cc/virtual/2026/poster/10011221 | Abstract-level |
| SpreadsheetBench 2 | 321 end-to-end business workflows: build, debug, visualise; on average 11.8 worksheets and 593.5 cell changes per task | Best 34.89% (official board: Claude Opus 4.6 with a Bash agent, 2026-03-26); GPT-5.2 26.79%; Gemini 3.1 Pro 23.68%. Debugging 12.00% | arXiv 2606.29955, 2026-06-30, NeurIPS 2026, https://arxiv.org/pdf/2606.29955 · https://neurips.cc/virtual/2026/poster/139155 · https://spreadsheetbench.github.io | Abstract-level. The leaderboard may have newer entries. |
| SpreadsheetBench v1 (912 tasks) | Spreadsheet manipulation built from forum questions | SpreadsheetAgent: 41.67% with Qwen3-480B (arXiv 2604.12282). A WPS press item claims 73.46% [UNVERIFIED]. Shortcut claims 59.25% [UNVERIFIED]. | https://arxiv.org/pdf/2604.12282 · https://gmt8press.com/flash/detail/1425504 · https://shortcut.ai/blog/posts/spreadsheetbench | Mixed |
| FrontierFinance | 25 tasks that build a model from scratch: three-statement, LBO, DCF, merger, lender. Each takes a skilled human more than 18 hours. Graded by a rubric-based LLM judge checked against experts | No model scores found in the snippets | arXiv 2604.05912, April 2026, https://arxiv.org/html/2604.05912v1 | Abstract-level |
| Deep FinResearch Bench | Deep-research agents from OpenAI, Gemini, Perplexity and Grok write pre-earnings equity research; scored on qualitative rigour, forecast and valuation accuracy, and claim verifiability | Analysts 2.84/4 against 2.31/4 for the best agent; agent factuality 86.0% down to 53.2%; Gemini wrote the best-graded reports but had the second-lowest factuality | arXiv 2604.21006, 2026-04-22, https://arxiv.org/abs/2604.21006 · https://allmind.ai/research/ai-financial-research-benchmarks-explained | The paper's scope comes from the abstract. The numbers and the JPMorgan attribution come only from a blog [UNVERIFIED]. |
| BizFinBench / BizFinBench.v2 | v1: 6,781 Chinese queries across nine categories. v2: 29,578 QA pairs on Chinese and US equities across eight tasks, including anomaly tracing, quantitative computation and event-logic reasoning | No single model wins every task (v1) | arXiv 2505.19457 (May 2025), arXiv 2601.06401 (Jan 2026), https://arxiv.org/abs/2601.06401v1 | Abstract-level |
| XBRL / filings | FinAuditing: multi-document audit tasks over US-GAAP XBRL filings. FinTagging: XBRL tagging and extraction. FinLoRA: XBRL analysis datasets | FinAuditing: LLMs score "below 14%" [UNVERIFIED: blog] | arXiv 2510.08886 · 2505.20650 · 2505.19819; https://beancount.io/fr/bean-labs/research-logs/2026/06/03/finauditing-xbrl-taxonomy-benchmark-llm | Mixed |
| FinanceBench | Open-book QA over 10-Ks | No authoritative 2026 leaderboard found. The widely cited figure (81% wrong or refused with a shared vector store) is from Nov 2023. | https://beancount.io/bean-labs/research-logs/2026/05/12/financebench-open-book-financial-qa-benchmark · https://benchmarklist.com/benchmarks/financebench/ | Historic baseline only |

Other 2026 finance-modelling evaluations found but not read:
- WorkstreamBench, spreadsheet financial workflows judged by an LLM (arXiv 2605.22664, https://arxiv.org/pdf/2605.22664).
- A DCF task in which an agent builds a model from a data room and a verifier grades it (arXiv 2604.11304,
  https://arxiv.org/pdf/2604.11304).
- A 2026 Wall Street Prep practitioner bake-off [UNVERIFIED]
  (https://www.pulse.bot/finance/video/the-best-ai-for-financial-modeling-efd5a404-5422-458e-8ad9-d97b6e5df165).

### 1.2 Failure modes that recur across benchmarks

| Failure | Evidence | Where it bites in YouBank |
|---|---|---|
| **Evidence extraction and retrieval**: the agent reads the wrong passage or misses the row | Mint-Agent's taxonomy (dominant v2 error, [UNVERIFIED] snippet); FinanceBench's historic retrieval failures | `read_filing`, `full_text_search`, XBRL concept selection in `tools.ts` |
| **Numerical reasoning** | Program-of-thought gains on FinQA, ConvFinQA and TAT-QA (§2.2); BizFinBench.v2 has a dedicated quantitative-computation task | Free-text arithmetic in chat answers; Studio formulas |
| **Not inspecting enough, and writing to the wrong cell** | SpreadsheetBench 2's "dominant bottlenecks" | Studio agent (`src/lib/studio/`), Excel add-in |
| **Debugging existing models** (12%) | SpreadsheetBench 2 | Studio "audit my model" flows |
| **Over-thinking simple lookups** (about −7 points) | FinSearchComp | Price and quote lookups at the user's default effort |
| **Polished but less factual** | Deep FinResearch Bench (Gemini) [UNVERIFIED] | Memos and briefs, where readers judge quality by prose |
| **Reliability falls as tasks get longer** | Beyond pass@1 (§3.1) | Deep research (30 turns), Autopilot, canvases |

**Implication for YouBank.** Benchmark scores show the agent should not simply take the model's word.
Spend engineering on (a) better evidence retrieval, (b) arithmetic done in code, (c) checks before and
after spreadsheet writes, and (d) a post-hoc check of every figure in an answer. Build an internal
regression set that mirrors these failure types (Technique 12).

---

## 2. Grounding and verification

### 2.1 Citation faithfulness

| Work | Date | Finding | URL |
|---|---|---|---|
| "Generation-Time vs. Post-hoc Citation: A Holistic Evaluation of LLM Attribution" (Saxena et al., NeurIPS 2025 workshop, arXiv 2509.21557) | Sep 2025 | Recommends a retrieval-centred, post-hoc-first approach for high-stakes use. Post-hoc citation covers more claims but is less faithful to their meaning. | https://mdsoar.org/items/53fd494a-eab7-4477-968a-83be9c2befb7/full |
| CiteAudit, "You Cited It, But Did You Read It?" (arXiv 2602.23452) | Feb 2026 | Splits citation checking across agents (extract claim, retrieve, match passage, reason, judge) and ships a human-validated benchmark | https://arxiv.org/html/2602.23452 |
| CiteGuard (arXiv 2510.17853) | Oct 2025 | Treats citation evaluation as attribution alignment, using retrieval to validate. One secondary source reports 68% on CiteME [UNVERIFIED]. | https://arxiv.org/pdf/2510.17853 |
| "Cited but Not Verified" (arXiv 2605.06635) | May 2026 | Yes/no attribution checks miss poor citations; parses citation-claim pairs out of deep-research Markdown reports | https://arxiv.org/html/2605.06635 |
| Span-level alignment (arXiv 2606.07130) | Jun 2026 | Aligning cited spans after generation makes snippets more accurate but can slightly lower claim-to-citation faithfulness | https://www.emergentmind.com/papers/2606.07130 |
| "Evaluating and Guarding Citation Faithfulness in Agentic Scientific Synthesis" (arXiv 2607.20527) | Jul 2026 | Snippet too thin to summarise | https://arxiv.org/pdf/2607.20527 |
| Anthropic Citations (API feature) | current | `citations: {enabled: true}` on document blocks returns `cited_text` with character or page locations. It cannot be combined with `output_config.format` (returns a 400). [V] | https://platform.claude.com/docs (Citations) |

**Implication for YouBank.** YouBank already cites at the source level: `ctx.addSource` yields S1, S2 and
so on. The gap is at the claim level, because nothing checks that "revenue grew 14% [S2]" is what S2
says. Add a post-hoc claim check that compares each number in an answer with the tool output it cites
(Technique 3). For filing reads on Claude, pass filing text as `document` blocks with citations enabled,
so the API returns exact spans to show in the UI. This works on free-text answers only, not on JSON
workflows.

### 2.2 Arithmetic done in code (program of thought)

| Work | Date | Finding | URL |
|---|---|---|---|
| Program of Thoughts prompting (Chen et al., arXiv 2211.12588) | 2022, baseline | About 12% average gain over chain of thought, including on FinQA, ConvFinQA and TAT-QA | https://arxiv.org/pdf/2211.12588 |
| FINDER (Khatuya et al.) | 2025 | Retrieve the facts first, then program-of-thought: +5.98% execution accuracy on FinQA and +4.05% on ConvFinQA over prior state of the art | (search snippet; https://www.wizwand.com/paper/68fa7c2d1e209131cea8ce1b) |
| Financial-PoT (arXiv 2601.21157) | Jan 2026 | Separates pulling out the variables from executing the calculation, and adds an execute-and-correct loop for noisy documents. Its "Cognitive Complexity Benchmark" shows program-of-thought holding up better than direct answers or chain of thought on cross-table synthesis. | https://arxiv.org/pdf/2601.21157 |

**Implication for YouBank.** `calc` exists, but the model types the numbers into it. The research says to
separate fetching a number from computing with it. Let `calc` refer to tool outputs by name (for example
`S3.ltm.revenue`) so a value is never re-typed, and require `calc` for every derived figure
(Technique 4).

### 2.3 Verifiers, test-time compute and self-consistency

| Work | Date | Finding | URL |
|---|---|---|---|
| "Pushing Test-Time Scaling Limits of Deep Search with Asymmetric Verification" | 2025–26 (arXiv ID not confirmed) | A verifier agent with the same tools checks each condition in the question against the candidate answer. On BrowseComp, GLM-4.5 needs 75.3 tool calls to solve but 18 to verify. Going from 35.7% (majority of 8) to 45% (weighted voting) cost about 100 extra tool calls with a verifier, against about 500 by scaling search alone. Little gain when verifying is as hard as solving. | https://www.themoonlight.io/en/review/pushing-test-time-scaling-limits-of-deep-search-with-asymmetric-verification [UNVERIFIED: review site] |
| Multi-Agent Verification (ICLR 2025) | 2025 | Uses more verifiers, each checking a different aspect, as the axis for spending test-time compute (best-of-n with multiple verifiers) | https://iclr.cc/virtual/2025/36216 |
| "Verifiable Process Rewards" (arXiv 2605.10325) | May 2026 | Turns checkable end conditions into turn-level rewards for long agent runs | https://www.emergentmind.com/papers/2605.10325 |

### 2.4 Calibrating LLM judges and abstaining

| Work | Date | Finding | URL |
|---|---|---|---|
| "Judge, Retrieve, or Abstain: Uncertainty-Guarded LLM Judging with Provable Risk Guarantees" (arXiv 2608.17994) | Aug 2026 | When unsure, the judge first retrieves from the web. If it is still unsure, it abstains and sends the case to a human. Gives a high-confidence bound on the error rate of the verdicts it does give. | https://arxiv.org/pdf/2608.17994 |
| SCOPE (arXiv 2602.13110) | Feb 2026 | Selective conformal prediction for pairwise judging, with finite-sample guarantees on the error of accepted judgments. Says thresholding raw confidence gives no such guarantee. | https://arxiv.org/pdf/2602.13110v2.pdf |
| "The Judge Knows When It Knows" (arXiv 2608.07517) | Aug 2026 | Calibrated abstention for predicting A/B-test outcomes with an LLM; gains may not transfer to a held-out test | https://arxiv.org/pdf/2608.07517 |
| "A CaLLM Judge is a Better Judge" (arXiv 2610.18108) | Oct 2026 | Multicalibration to reduce judge bias | https://www.emergentmind.com/papers/2610.18108 |
| Trust or Escalate (arXiv 2407.18370) | 2024, baseline | An abstention policy calibrated to guarantee agreement with humans | https://arxiv.org/pdf/2407.18370 |
| CalibJudge (Preprints.org) | Mar 2026 | 88% balanced accuracy at 70% coverage on multilingual RAG judging [UNVERIFIED: not peer-reviewed] | https://www.preprints.org/frontend/manuscript/6e4066ab1c1c516037265264c0f068c4/download_pub |
| IteraJudge (in BizFinBench) | May 2025 | An LLM-judge method designed to reduce bias in financial QA grading | https://arxiv.org/pdf/2505.19457 |

**Implication for YouBank.** Two places should use risk-controlled abstention:
- **Relationships autopilot.** Today a draft auto-sends when the model says confidence is "high". That
  value is self-reported and uncalibrated (`crm/agent.ts`, line 62).
- **Workflow outputs.** Fit a conformal threshold on labelled outcomes. Send the draft or answer only
  when the calibrated risk is below α; otherwise escalate.

This complements the existing e-process autonomy certification, which decides *whether* a category may
run autonomously. Conformal abstention decides *which individual items* it may skip review on
(Technique 6).

---

## 3. Long-horizon and deep-research agents

### 3.1 Reliability over long tasks

- **"Beyond pass@1: A Reliability Science Framework for Long-Horizon LLM Agents"** (Khanal, Tao, Zhou;
  arXiv 2603.29231; 2026-03-31; https://arxiv.org/abs/2603.29231).
  - Across 10 models, mean pass@1 falls from 76.3% to 52.1% (−24.3 points) from short to very long tasks.
  - Document processing barely degrades (graceful-degradation score 0.74 → 0.71), while software
    engineering collapses (0.90 → 0.44).
  - Model rankings on short tasks do not predict rankings on long tasks.
  - Memory scaffolds hurt: one summary says "6 of 10 models", another says "universally" [UNVERIFIED:
    conflicting secondary summaries].
- **Implication for YouBank.** Measure reliability by task length and over repeated runs, not single-run
  accuracy alone. Do not add a generic memory layer without an A/B test.

### 3.2 Context engineering and compaction

| Work | Date | Idea | URL |
|---|---|---|---|
| Memex(RL) (arXiv 2603.04257) | Mar 2026 | Indexed experience memory: compress the context but keep the evidence retrievable instead of summarising it away | https://arxiv.org/html/2603.04257 |
| ARC, Addressable Recall Compaction (arXiv 2607.25066) | Jul 2026 | Lossless compaction: replace old content with addressable pointers and recall it on demand. Describes how lossy summaries fail on long runs. | https://www.alphaxiv.org/abs/2607.25066 |
| AdaCoM (arXiv 2605.30785) | May 2026 | A separately trained context manager prunes stale content while keeping constraints and progress, for web search and deep research. The agent itself is unchanged. | https://arxiv.org/html/2605.30785 |
| Parallel Context Compaction (arXiv 2605.23296) | May 2026 | Compares parallel and sequential compaction on retention and latency | https://www.alphaxiv.org/abs/2605.23296 |
| Context-compression survey (Gu, McAuley, Zeng) | May 2026 | Design space and failure taxonomy, including deep research. arXiv ID not captured. | (search snippet) |
| Survey: compression as lifecycle management | Jul 2026 | Treats compression as managing context over an agent's whole run, not one-shot prompt shortening (preprint) | https://www.preprints.org/manuscript/202607.0924 |

Anthropic platform primitives available now [V]:
- Server-side compaction (beta `compact-2026-01-12`; triggers at 150K tokens by default).
- Context editing, which clears old tool results (`clear_tool_uses_20250919`) or thinking blocks.
- The memory tool (`memory_20250818`).
- Task budgets (beta `task-budgets-2026-03-13`). The model sees a token countdown and finishes
  gracefully; the minimum total is 20,000.
- Mid-conversation `role: "system"` messages, which change instructions without invalidating the cache.

**Implication for YouBank.** `agent.ts` cuts every tool result at 120,000 characters and resends all of
them on every turn.
- Keep full tool outputs server-side, keyed by source ID.
- Give the model a summary plus a handle it can expand (the ARC/Memex idea).
- On Claude, turn on `clear_tool_uses` for deep and Studio runs.
- Replace the hand-rolled `deadline` nudge with task budgets where the model supports them.

(Technique 7.)

### 3.3 Memory (episodic, semantic, procedural)

- EvoMemBench (arXiv 2605.18421) groups memory by scope (within or across episodes) and by content
  (knowledge or experience): https://papers.cool/arxiv/2605.18421
- Procedural-memory retrieval benchmark (arXiv 2511.21730): https://arxiv.org/html/2511.21730v1
- Memp, procedural memory built while doing tasks (arXiv 2508.06433): https://arxiv.org/pdf/2508.06433
- Mem0 v2.0.0 (April 2026) reportedly moved to single-pass, add-only extraction [UNVERIFIED:
  https://forkast.news/agent-memory].
- The practitioner consensus is that there is no accepted production benchmark for agent memory.

**Implication for YouBank.** YouBank already has strong domain memory: CRM knowledge tracing, playbooks
and voice. The new idea worth taking is **procedural memory**: store the tool-call sequences that
succeeded for a workflow and user, and offer them as few-shot plans. Gate it behind evals, because of
the Beyond pass@1 result on memory scaffolds.

### 3.4 Orchestrating sub-agents

- A Google study of five agent architectures reportedly found centralised coordination improved
  financial-reasoning tasks by 80.9% over a single agent. Gains concentrate on tasks that split into
  independent parts [UNVERIFIED: secondary coverage, https://www.infoq.com/news/2026/02/google-agent-scaling-principles].
- A Stanford / Contextual AI paper reportedly finds a single agent more information-efficient under a
  fixed reasoning-token budget [UNVERIFIED: https://flowhunt.io/blog/multi-agent-ai-system/].
- Rule of thumb from these sources: use several agents only when the work splits into parallel, separate
  streams.
- **Implication for YouBank.** Fan out where the work is naturally parallel: comps across N tickers,
  precedent screens, Deal Radar scoring, newsroom clustering. Keep memos and models in one agent.

### 3.5 Agentic RL with verifiable rewards (RLVR) in finance

| Work | Date | Finding | URL |
|---|---|---|---|
| Mint-Agent (arXiv 2608.16386) | Aug 2026 | A data engine of checkable financial tasks, a harness with persistent context, then supervised fine-tuning + RLVR + on-policy distillation. 9B and 27B models compete with frontier models on finance benchmarks. | https://arxiv.org/pdf/2608.16386 |
| Trade-R1 (arXiv 2601.03948) | Jan 2026 | RLVR in noisy markets. A "Triangular Verification Protocol" turns checking reasoning over long financial documents into a RAG task for an LLM judge. A naive multiplied reward was gamed: the agent zeroed out losses and hallucinated more. | https://www.arxiv.org/pdf/2601.03948v1 |
| AlphaQuanter (ACL 2026 Findings) | 2026 | A single agent with tools learns a trading policy through RL with verifiable rewards | https://aclanthology.org/2026.findings-acl.456.pdf |

**Implication for YouBank.** Fine-tuning hosted OpenAI models is closed to new customers (per the prior
doc), so RLVR is not a near-term build. The transferable lesson is to design **checkable tasks**
(numbers that can be recomputed from XBRL) as the eval set. Those same tasks become a distillation set if
YouBank ever hosts an open-weight model. Watch Mint-Ag: if its weights are released, a 27B model scoring
60% on FAB v2 could run YouBank's background research cheaply.

---

## 4. Tools and protocols

### 4.1 Tool search for large catalogues (the 328-tool problem)

- **Anthropic tool search tool** [V] (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool, fetched 2026-10-31).
  - The docs state that "Claude's ability to pick the right tool degrades once you exceed 30–50 available
    tools." A multi-server setup uses about 55k tokens of tool definitions, and tool search "typically
    reduces this by over 85 percent."
  - Two variants: `tool_search_tool_regex_20251119` and `tool_search_tool_bm25_20251119`.
  - Up to 10,000 deferred tools per request. A search returns 5 tools by default.
  - Keep the 3–5 most-used tools non-deferred.
  - Deferred tools stay out of the cached prefix, so prompt caching keeps working. A deferred tool cannot
    carry `cache_control`.
  - Custom search is possible by returning `tool_reference` blocks from your own tool, for example an
    embedding-based search.
  - Supported from Haiku 4.5 up through Fable 5.1.
  - Tip from the docs: give tool names a consistent prefix by namespace.
  - Anthropic's internal figures (Opus 4: 49% → 74%; Opus 4.5: 79.5% → 88.1%) appear only in secondary
    write-ups [UNVERIFIED: https://learn-anthropic.pages.dev/en/articles/engineering/advanced-tool-use].
- **OpenAI hosted tool search** (https://developers.openai.com/api/docs/guides/tools-tool-search; search
  snippet only).
  - Declare deferred functions, namespaces or MCP servers, and the API loads tools as needed.
  - Namespaces are recommended. Azure suggests fewer than 10 functions per namespace
    (https://learn.microsoft.com/en-ca/Azure/foundry/openai/how-to/tool-search).
  - Requires gpt-5.4 or later. A client-executed variant (`execution: "client"`) exists [UNVERIFIED].
- **Independent evidence.**
  - "Scalable LLM Agent Tool Access in the Cloud" (arXiv 2607.15593, https://arxiv.org/pdf/2607.15593):
    naive tool selection drops from 92.4% at 15 tools to 78.2% at 640 (ToolBench). Hybrid retrieval holds
    81.6% at 3,616 tools, against 72.1% for RAG-MCP and 70.6% for ToolLLM.
  - ToolRet (arXiv 2503.01763, 43k tools): standard retrieval models do poorly at finding tools.
  - ToolLibGen (arXiv 2510.07768): grouping similar tools keeps retrieval accurate.
  - A blog reports 56% (regex) and 64% (BM25) retrieval accuracy over 4,027 tools [UNVERIFIED:
    https://dev.to/rawveg/more-tools-made-ai-worse-po7].
- **Implication for YouBank.**
  - The chat agent sends about 39 tool definitions every turn, already near the 30–50 range where
    selection degrades.
  - The 328 workflows and calculators cannot be reached from chat at all.
  - Make the 3–5 core data tools non-deferred (`get_company`, `calc`, `read_filing`, `web_research`).
  - Defer the rest, and add the workflows and calculators as deferred tools with prefixes such as
    `wf_ib_`, `wf_pe_` and `calc_lbo_`.
  - Use BM25 on Claude and namespaces on OpenAI. Consider a custom embedding search over the workflow
    catalogue, since the published regex and BM25 recall at thousands of tools is only moderate.

  (Technique 1.)

### 4.2 Programmatic tool calling and code-execution sandboxes

- **Anthropic programmatic tool calling** [V: API reference].
  - Add `code_execution_20260120` and set `allowed_callers: ["code_execution_20260120"]` on a custom
    tool. Claude then writes Python that calls the tools inside a sandbox, and only the final output
    returns to context.
  - It cannot be combined with `strict: true`, forced `tool_choice`, or MCP tools.
  - Reported savings: −24% input tokens with slightly better accuracy on two research benchmarks, and
    −37% on a complex research task [UNVERIFIED: secondary,
    https://dev.to/jangwook_kim_e31e7291ad98/claude-programmatic-tool-calling-measured-token-savings-5255
    and https://adilghazali.substack.com/p/anthropic-measured-the-token-problem].
  - One case went from 150k to 2k tokens [UNVERIFIED:
    https://medium.com/@DebaA/anthropic-just-shipped-the-fix-for-tool-definition-bloat-77464c8dbec9].
- **Hosted code execution** (`code_execution_20260521`) returns `bash_code_execution_tool_result` [V].
  The new web search and fetch tools (`web_search_20260209`, `web_fetch_20260209`) filter results with
  code execution built in, so code execution must not also be declared [V].
- **Implication for YouBank.** Comps across 20 tickers, XBRL time series and screening return large JSON
  results that the model only aggregates. Run them programmatically: the model writes the aggregation
  code and sees only the table. This also supplies the code-executed arithmetic from §2.2 (Technique 8).

### 4.3 Structured outputs and parallel calls (what changed)

[V: Anthropic API reference]
- `output_config.format` is the current structured-output parameter; `output_format` is deprecated.
- `strict: true` on a tool guarantees schema-valid inputs.
- On Claude Opus 5.5, Sonnet 5.5 and Fable 5.1, **forced `tool_choice` (`any` or `tool`) returns a 400**.
  Use `auto` plus `strict`, or structured outputs.
- Parallel tool calls are on by default. Return all results in one user message, or the model learns to
  stop calling tools in parallel.
- Under API version `2026-10-21`, `temperature`, `top_p` and `top_k` return a 400 on every model.
- Claude Opus 5.5 rejects disabled thinking and defaults to `medium` effort.

**Implication for YouBank.** `agent.ts` already returns parallel results in one message and does not use
forced `tool_choice`. Before adding Opus 5.5, Sonnet 5.5 or Haiku 5.5 to `models.ts`:
- Audit every `structured()` caller for sampling parameters.
- Confirm `claudeThinking()` sends no disabled thinking to them. The current regex sends 5.5-family
  models down the adaptive path, which is correct.

### 4.4 MCP: the 2026-07-28 spec, MCP Apps and the end of elicitation as a stream

- **MCP 2026-07-28 specification** [V] (https://blog.modelcontextprotocol.io/posts/2026-07-28/, fetched).
  - Stateless request/response: no `initialize` handshake and no `Mcp-Session-Id`. Each request carries
    its protocol version and capabilities in `_meta`.
  - Optional `server/discover`. Any instance behind a round-robin load balancer can serve any request.
  - Streamable HTTP requests must carry `Mcp-Method` and `Mcp-Name` headers.
  - **Multi Round-Trip Requests replace the server-initiated `elicitation/create`,
    `sampling/createMessage` and `roots/list`.** The server returns `resultType: "input_required"`, and
    the client retries with `inputResponses`.
  - Tasks moved to the `io.modelcontextprotocol/tasks` extension (poll with `tasks/get`, plus a new
    `tasks/update`).
  - Roots, Sampling and Logging are deprecated (supported for at least 12 more months). Dynamic Client
    Registration is deprecated in favour of Client ID Metadata Documents (CIMD).
  - Authorisation is hardened: `iss` validation (RFC 9207), and credentials are bound to the issuer.
  - Tier-1 SDKs: TypeScript, Python, Go, C#.
- **MCP Apps**, the first official extension (2026-01-26; https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).
  - Servers declare `ui://` resources rendered in sandboxed iframes, with two-way messaging and a
    required text fallback.
  - Supported by Claude, ChatGPT, VS Code and Goose. Microsoft Copilot reportedly added support in April
    2026 [UNVERIFIED].
- **Implication for YouBank.** The roadmap's remote MCP server should be built stateless on Vercel from
  the start:
  - Use MRTR `input_required` as the human-confirmation step for any action tool (send email, place
    order), so the confirmation happens in the user's client.
  - Use the Tasks extension for deep-research runs that outlive one HTTP request.
  - Use MCP Apps to render the live workbook and comps tables.
  - Avoid Sampling: it is deprecated.

  (Technique 13.)

### 4.5 Agent Skills

- Anthropic shipped Agent Skills (SKILL.md) on 2025-10-16 and published it as an open standard at
  agentskills.io on 2025-12-18. OpenAI reportedly adopted the same format in Codex and ChatGPT. About 40
  adopters were listed by mid-2026 [UNVERIFIED:
  https://www.noqta.tn/en/news/skill-md-open-standard-30-ai-coding-tools-adoption-2026 ·
  https://atlan.com/know/ai-agent/ai-agent-skills/what-are-agent-skills/].
- A secondary source reports 341 malicious skills discovered by early 2026 [UNVERIFIED].
- Anthropic's Skills API is out of beta (`client.skills.*`) [V].
- **Implication for YouBank.** The 230 workflows are already a numbered method with named tools and an
  output contract, which is a skill. Exporting them as SKILL.md bundles, each pointing at YouBank's MCP
  tools, gives distribution into Claude and ChatGPT clients at little cost. Signing and provenance matter
  given the malicious-skill reports (Technique 13).

### 4.6 Computer-use and browser agents

| Benchmark | Latest found | Source | Status |
|---|---|---|---|
| OSWorld-Verified | Qwen3.8 Max 86.1%; Claude Mythos 5 85%; Claude Fable 5 85% (2026-08-22) | https://www.benchlm.ai/benchmarks/osWorldVerified | [UNVERIFIED] aggregator |
| OSWorld 2.0 (108 long-horizon workflows) | Claude Opus 5 70.6%; GPT-5.6 Sol 62.6% | https://www.benchlm.ai/benchmarks/osworld2 | [UNVERIFIED] |
| OSWorld 2.1 (strict) | Claude Sonnet 5.5 0.435 | https://llm-stats.com/benchmarks/osworld-2.1-strict | [UNVERIFIED] |

Anthropic now exposes `computer_toolset_20260801` and `browser_toolset_20260801`. The older
`computer_20251124` returns a 400 for Opus 5.5 and Sonnet 5.5 on the Claude API [V].

**Implication for YouBank.** Desktop-style tasks are close to saturated, but long workflows (OSWorld 2.x,
SpreadsheetBench 2) are not. Use a browser agent only as a **fallback data source** for sites with no API,
such as state business registries, court dockets and IR pages behind JavaScript. Restrict it to an
allowlist of domains and treat what it reads as untrusted (§6). Do not use browser agents to *act* on
financial sites such as brokerages and banks. The broker APIs YouBank already uses are safer and can be
audited.

---

## 5. Cost and latency

### 5.1 Model lineup and list prices (October 2026)

**Anthropic** [V: Claude API reference, cached 2026-10-06; https://platform.claude.com/docs], per MTok
input / output:

| Model | Price | Notes |
|---|---|---|
| Claude Fable 5.1 | $10 / $50 | Cache reads $0.25. Thinking always on. Forced `tool_choice` returns a 400. |
| Claude Opus 5.5 | $4 / $20 | Cache reads $0.20. Default effort `medium`. Fast mode $8 / $40. |
| Claude Opus 5 | $5 / $25 | |
| Claude Sonnet 5.5 | $2 / $10 | |
| Claude Sonnet 5 | $2 / $10 | |
| **Claude Haiku 5.5** | **$0.10 / $0.50** | Up to 100K-token prompts; $0.50 / $2.50 beyond |
| Claude Haiku 4.5 | $1 / $5 | |

The Batch API costs 50% of standard. Caches are scoped to one model, so a cascade gives up cache reuse.

**OpenAI** [UNVERIFIED: aggregators only; https://anotherwrapper.com/llm-pricing/gpt-6-astra ·
https://www.usagepricing.com/blueprint/activity/openai-2026-10-05-gpt-6-api-launch ·
https://tech-insider.org/gpt-6-astra-launch-how-to-try-2026/]:

| Model | Price | Notes |
|---|---|---|
| GPT-6 Astra | $10 / $50 | Cached input $1. Long-context tier reported at $20 / $75. One outlier lists $5 / $25. |
| GPT-6.1 Sol | $2 / $10 | |
| GPT-6 Luna | $0.10 / $0.50 | |

A usagepricing snapshot titled "OpenAI 2026-10-05 GPT-6 API launch" says OpenAI's pricing page replaced
the GPT-5.6 lineup.

**Google** [UNVERIFIED]:
- Gemini 3.5 Flash launched 2026-05-19 at $1.50 / $9.
- Gemini 3.8 Flash is listed at $0.75 / $3.75 (https://anotherwrapper.com/llm-pricing/gemini-3.8-flash).
- Gemini 3.5 Pro's release and pricing were not confirmed.

**Implication for YouBank.**
- `route.ts` sends classify/extract/summarize work to `claude-haiku-4-5` ($1 / $5) and `gpt-5.6-luna`.
  Haiku 5.5 is **10x cheaper at list price**, and GPT-6 Luna reportedly costs the same as Haiku 5.5.
- `DEFAULT_ANTHROPIC_MODEL` is `claude-opus-5` ($5 / $25). Opus 5.5 is 20% cheaper.
- `models.ts` and `pricing.ts` have none of the 5.5-generation Claude models and no GPT-6 Luna or 6.1 Sol.
- Swap them in behind an eval gate (Technique 2).

### 5.2 Routing, cascades and step-level routing

| Work | Date | Finding | URL |
|---|---|---|---|
| "Is Escalation Worth It? A Decision-Theoretic Characterization of LLM Cascades" (arXiv 2605.06350, ICML 2026) | May 2026 | A lightweight router that decides before generating beats the best cascade on 4 of 5 datasets. The cascade's handicap is paying for the cheap model's output first. | https://arxiv.org/abs/2605.06350 · https://icml.cc/virtual/2026/75267 |
| TwinRouterBench (arXiv 2605.18859) | May 2026 | Routing at each step of an agent run (970 router-visible prefixes plus a live track). A logistic router gives the best cost/success trade-off among those tested. | https://arxiv.org/html/2605.18859 |
| RouteNLP (arXiv 2604.23577) | Apr 2026 | Tiered routing with conformal escalation thresholds: 40–85% lower cost while keeping 96–100% of quality on structured tasks | https://arxiv.org/html/2604.23577 |
| Routing-headroom critique (arXiv 2605.07395) | May 2026 | Reported routing headroom is "substantially inflated" and depends on how correctness is judged | https://arxiv.org/html/2605.07395v1 |
| Cluster, Route, Escalate (arXiv 2606.27457) | Jun 2026 | A cost-aware cascade for serving | https://arxiv.org/pdf/2606.27457 |

Anthropic's own guidance [V] is to measure the strongest model at lower effort before building a cascade.
Lower effort on new models often matches older models at high effort, and one model keeps one cache.

**Implication for YouBank.** Keep the fixed per-task routes; the prior doc's finding stands. Add
**step-level routing inside agent loops** (TwinRouterBench). Turns that only gather data (tool-call
planning after the first turn) can run at `low` effort on the same model, which keeps the cache. The
final writing turn runs at the user's effort. Mid-conversation effort changes without a cache reset are
in beta on Claude Opus 5 / 5.5 and Fable 5.1 (`mid-conversation-output-config-2026-07-01`) [V].
(Technique 9.)

### 5.3 Distillation

Mint-Agent's on-policy distillation produced 9B and 27B finance models that compete with the frontier
(§3.5). No hosted fine-tuning route was confirmed for YouBank's two providers in this run. The prior doc
says OpenAI fine-tuning is closed to new customers. **Implication:** this is not near-term. Log
graded inputs and outputs now (`usage.ts`) so a distillation set exists if YouBank adds an open-weight
model later.

---

## 6. Safety for agents that act (email, trades)

| Work | Date | Finding | URL |
|---|---|---|---|
| CaMeL, "Defeating Prompt Injections by Design" (arXiv 2503.18813) | Mar 2025 | A layer around the model separates control flow from data flow, and every value carries where it came from and who may read it. 77% of AgentDojo tasks completed with provable security, against 84% undefended. About 2.82x the input tokens and 2.73x the output tokens. | https://api.emergentmind.com/papers/2503.18813 · https://www.themoonlight.io/review/defeating-prompt-injections-by-design |
| "Operationalizing CaMeL" | date not confirmed | Adds prompt screening for enterprise use and a small, formally specified language for the plan interpreter. Notes that CaMeL assumes the first prompt is benign. | https://www.themoonlight.io/review/operationalizing-camel-strengthening-llm-defenses-for-enterprise-deployment |
| "Design Patterns for Securing LLM Agents against Prompt Injections" (arXiv 2506.08837) | Jun 2025 | Six patterns, including action-selector, plan-then-execute and code-then-execute. "No magic solution"; each trades security against flexibility. | https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/ |
| Privilege separation for OpenClaw (arXiv 2603.13424) | Mar 2026 | A structurally separated pipeline: 0% attack success on the 649 LLMail attacks that beat the single-agent baseline. The separated step never sees the raw injected text. | https://arxiv.org/pdf/2603.13424 |
| Gray Swan IPI Arena | Mar 2026 | 13 frontier models, more than 272,000 attacks. Attack success ranged from 0.5% (Claude Opus 4.5) to 8.5% (Gemini 2.5 Pro), counting only attacks that act and hide it from the user. | https://www.grayswan.ai/blog/your-ai-agent-can-be-compromised-youd-never-know |
| LivePI (arXiv 2605.17986) | May 2026 | Indirect prompt-injection benchmark in an environment resembling production | https://arxiv.org/abs/2605.17986 |
| CommandSans (arXiv 2510.08829) | Oct 2025 | With no defence, 68.5% attack success on email QA (BIPIA). Removes instructions from tool outputs. | https://arxiv.org/pdf/2510.08829 |
| "Minimize & sanitize" (arXiv 2510.05244) | Oct 2025 | A defence at the agent–tool boundary that works with any model; about 0% attack success on four benchmarks (authors' own runs) | https://arxiv.org/html/2510.05244v1 |
| LLMail-Inject | 2025 | About 0.8% attack success in Phase 1 across 370,724 submissions [UNVERIFIED: secondary] | https://www.emergentmind.com/topics/llmail-inject-adaptive-prompt-injection-challenge |

Platform features [V]:
- Mid-conversation `role: "system"` messages on Claude 5-family models give operators a separate
  instruction channel that is safe from injection.
- Managed Agents permission policies (`always_allow` / `always_ask` / `auto`) gate tool calls on the
  server.

Regulatory direction [UNVERIFIED: secondary law-firm and vendor summaries; check the primary texts]:
- FINRA's 2026 Annual Regulatory Oversight Report reportedly recommends, for AI agents that act or
  transact, "a narrow scope, permissions, audit trails of actions, and explicit human checkpoints before
  execution" (https://www.shumaker.com/wp-content/themes/jrd-shumaker/inc/generate-insight-pdf.php?id=14837).
- Treasury's Financial Services AI Risk Management Framework (Feb 2026) reportedly has 230 control
  objectives (https://corsa.finance/blog/how-to-govern-ai-agents-aml-compliance/compliance-tooling).
- The EU AI Act's high-risk obligations, applying from August 2026, require competent human oversight and
  logs (https://openrouter.ai/blog/tutorials/human-oversight-eu-ai-act-compliance-agent-sdk/).
- Sources distinguish **hard gates** (blocked until approved) from **soft gates** (person notified, with
  a log), and record which kind applied.

**Implication for YouBank.**
- `algo/agent-gate.ts` is already a CaMeL / plan-then-execute design:
  - It plans before reading outside text.
  - A second call with no tools writes the answer.
  - A turn is tainted once outside text has been read.
  - An order must match the person's words.
- The **chat agent** (`agent.ts`) does not have this. It mixes untrusted filings, web pages and email
  with tools that write: Studio cell writes, and soon MCP actions.
- **Relationships autopilot** reads inbound email and drafts with access to the knowledge base, playbook
  and contacts. A planted instruction could steer what a reply discloses. `crm/send.ts` is correctly the
  only path that sends, but nothing checks where a draft's content came from.
- Generalise the agent gate into a shared policy layer (Technique 10) and add an audit trail of actions
  (Technique 11).

---

## Techniques to implement in YouBank

Ordered by expected value per unit of effort. "Gain" is an estimate; validate each item against the eval
set in item 12 before it ships.

1. **Tool search over the full catalogue (Anthropic BM25 or custom; OpenAI namespaces).**
   - *Evidence:* Anthropic docs: selection degrades past 30–50 tools, and definition tokens fall by more
     than 85% [V]. arXiv 2607.15593: naive selection drops to 78.2% at 640 tools, while retrieval holds
     about 82% at 3.6k.
   - *Gain:* chat can call the 328 workflows and calculators, which it cannot today. Fewer input tokens
     per turn and better tool choice.
   - *Changes:* `src/lib/ai/agent.ts`: add `defer_loading` in `runAnthropic`; add `tool_search` and
     namespaces in `runOpenAI`. `src/lib/ai/tools.ts`: tool-name prefixes and a hot set of 3–5 tools.
     New adapter in `src/lib/workflows/registry.ts` that exposes workflows and calculators as `ToolDef`s.
2. **Swap in the 5.5-generation small models and Opus 5.5 behind an eval gate.**
   - *Evidence:* Haiku 5.5 at $0.10 / $0.50 against $1 / $5 for Haiku 4.5. Opus 5.5 at $4 / $20 against
     $5 / $25 for Opus 5 [V]. GPT-6 Luna at $0.10 / $0.50 [UNVERIFIED].
   - *Gain:* about 90% less list-price cost on classify/extract/summarize (CRM triage, newsroom
     clustering), and 20% less on default Claude chat.
   - *Changes:* `src/lib/ai/route.ts` (ROUTES), `src/lib/ai/models.ts`, `src/lib/ai/pricing.ts`. Check
     `claudeThinking()` in `agent.ts` for the breaking changes: no disabled thinking, no forced
     `tool_choice`, and no sampling parameters under API version 2026-10-21.
3. **Post-hoc check of every number in an answer.**
   - *How:* after the final answer, extract each number and its [Sx] citation. Check it against the raw
     tool output for that source, allowing for rounding and unit scale (mm/bn/%). Recompute derived
     figures with `calc`. Flag, repair or caveat any mismatch.
   - *Evidence:* Deep FinResearch Bench factuality 53–86% [UNVERIFIED]; post-hoc-first attribution
     (arXiv 2509.21557); CiteAudit (2602.23452).
   - *Gain:* catches unsupported figures before the user sees them, and gives a measurable
     "verified-figure rate" to show in the UI.
   - *Changes:* new `src/lib/ai/verify.ts`; `src/lib/ai/tools.ts` (`ToolCtx.addSource` also stores the
     raw payload); `agent.ts` (`runChat` hook before `done`); the UI shows a verified badge.
4. **Arithmetic by reference (program of thought).**
   - *How:* let `calc` accept references such as `S3.ltm_usd_mm.revenue` that resolve to tool outputs,
     and require the system prompt to use `calc` for every derived figure.
   - *Evidence:* program of thought +12% over chain of thought on FinQA, ConvFinQA and TAT-QA
     (2211.12588). Financial-PoT (2601.21157) separates extraction from execution.
   - *Gain:* removes transcription errors and arithmetic hallucinations.
   - *Changes:* `src/lib/calc.ts` (a variable environment), `src/lib/ai/tools.ts` (`calcTool` and the
     source registry), `src/lib/ai/prompts.ts`.
5. **An asymmetric verifier for deep research.**
   - *How:* after a deep run, a verifier agent with the same tools, a cheaper model and low effort, checks
     each conclusion's stated conditions. It returns a confidence score, and low scores trigger one
     targeted re-search or an explicit "not verified".
   - *Evidence:* asymmetric verification: 18 tool calls to verify against 75 to solve; +10 points for
     about one fifth of the compute [UNVERIFIED: review site]. Multi-Agent Verification (ICLR 2025).
   - *Gain:* higher deep-research accuracy at less cost than more turns.
   - *Changes:* `src/lib/ai/deep.ts` (protocol and a second pass), `src/lib/ai/agent.ts`.
6. **Risk-controlled abstention for autopilot sends and workflow outputs.**
   - *How:* replace the self-reported confidence ("high") with a conformal threshold fitted on labelled
     outcomes. Edits, rejections and sends all count as labels. Escalate to a person when the calibrated
     risk is above α.
   - *Evidence:* "Judge, Retrieve, or Abstain" (2608.17994), SCOPE (2602.13110), Trust or Escalate
     (2407.18370).
   - *Gain:* a provable bound on the error rate of auto-sent emails, which complements the e-process
     autonomy certification.
   - *Changes:* `src/lib/crm/autopilot.ts`, `src/lib/crm/agent.ts` (emit a numeric score), new
     `src/lib/inference/conformal.ts`.
7. **Lossless context management for long runs.**
   - *How:* store full tool outputs in Postgres keyed by source ID, and give the model a summary plus an
     `expand(source_id, path)` tool. On Claude, turn on `clear_tool_uses_20250919` and use task budgets
     instead of the hand-rolled deadline nudge.
   - *Evidence:* ARC (2607.25066), Memex (2603.04257), AdaCoM (2605.30785). Anthropic context editing and
     task budgets [V].
   - *Gain:* fewer tokens on 30-turn deep runs and Studio builds, with no loss of evidence.
   - *Changes:* `src/lib/ai/agent.ts` (today it cuts results at 120k characters and resends everything),
     `src/lib/ai/tools.ts`, a new table in `src/db`.
8. **Programmatic tool calling for bulk data tools.**
   - *How:* on Claude, mark comps, XBRL series, screener and insider tools with
     `allowed_callers: ["code_execution_20260120"]`, so the model aggregates in code and sees only the
     final table.
   - *Evidence:* Anthropic API reference [V]; −24% to −37% tokens reported [UNVERIFIED].
   - *Gain:* fewer tokens on multi-ticker questions, and arithmetic done in code by construction.
   - *Changes:* `src/lib/ai/agent.ts` (`runAnthropic` tool mapping; these tools cannot also use
     `strict`), `src/lib/ai/tools.ts`.
9. **Step-level effort inside agent loops, with fast lookups at low effort.**
   - *How:* data-gathering turns after the first run at `low` effort (per-message effort beta on Claude
     Opus 5/5.5 and Fable 5.1, which keeps the cache). The final writing turn uses the user's effort.
     Add a `lookup` task route at low effort for quotes and simple facts.
   - *Evidence:* TwinRouterBench (2605.18859); FinSearchComp: thinking −7 points on simple fetching
     (2509.13160); "Is Escalation Worth It?" (2605.06350).
   - *Gain:* lower latency and cost on lookups, and better accuracy on simple fetches.
   - *Changes:* `src/lib/ai/route.ts` (new `lookup` task), `src/lib/ai/agent.ts` (per-turn effort).
10. **A shared capability and taint policy for every agent that acts (CaMeL-lite).**
    - *How:* generalise `algo/agent-gate.ts` into `src/lib/ai/policy.ts`.
      - Mark each tool as `reads: trusted | untrusted` and `acts`.
      - Mark a turn tainted after any untrusted read: `web_research`, `read_filing`, email bodies, news.
      - In a tainted turn, any action (sending email, Studio writes to a shared workbook, MCP actions)
        needs the person's words to match or a confirmation step.
      - Wrap outside text as data.
      - For CRM drafts, tag knowledge-base and playbook text by who may read it. Block a draft that
        quotes non-public knowledge to a recipient who is not an approved contact.
    - *Evidence:* CaMeL (2503.18813); Design Patterns (2506.08837); privilege separation, 0% on 649
      attacks (2603.13424); 68.5% attack success on email QA with no defence (2510.08829).
    - *Gain:* the trading gate's injection resistance, extended to email, Studio and the future MCP
      server.
    - *Changes:* new `src/lib/ai/policy.ts`, `src/lib/ai/agent.ts`, `src/lib/crm/autopilot.ts`,
      `src/lib/crm/agent.ts`, `src/lib/studio/*`.
11. **An audit trail of actions with hard and soft gates.**
    - *How:* for every action, record the tool inputs, sources read, taint state, model and effort, the
      gate type (hard: blocked until approved; soft: notified and logged), the approver and the outcome.
    - *Evidence:* FINRA 2026 report guidance on agents (audit trails, human checkpoints) and the EU AI Act
      oversight logs [UNVERIFIED: secondary summaries].
    - *Gain:* SOC 2 and enterprise readiness, and a compliance story for the Deal Team and Enterprise
      tiers.
    - *Changes:* `src/lib/ai/usage.ts` (extend the ledger), `src/lib/crm/send.ts`,
      `src/lib/algo/orders.ts`, `src/lib/copytrade/orders.ts`, a new Drizzle table.
12. **An internal finance eval harness that measures reliability, not single-run accuracy.**
    - *How:* build a golden set of checkable tasks: XBRL-recomputable figures, filing lookups,
      time-sensitive quotes, small SpreadsheetBench-2-style debugging, memo factuality. Score pass^k and
      decay by length (Beyond pass@1), track the verified-figure rate, and run nightly through the Batch
      API at half price.
    - *Evidence:* the benchmark failure taxonomies in §1.2; Beyond pass@1 (2603.29231); routing-headroom
      inflation (2605.07395).
    - *Gain:* the safety net for items 2, 7, 8 and 9, and a public "YouBank Finance Eval" for marketing.
    - *Changes:* new `scripts/eval-agents.ts` and `src/lib/ai/evals/`; reuses `structured()` and
      `runChat()`.
13. **A stateless MCP server with confirmation round-trips, Tasks and MCP Apps, plus SKILL.md export.**
    - *How:* build on the 2026-07-28 spec. Action tools return `input_required` to confirm in the user's
      client. Deep research runs as a Task. Workbook and comps render as MCP Apps (`ui://`). Export the
      230 workflows as signed SKILL.md bundles.
    - *Evidence:* MCP 2026-07-28 release [V]; MCP Apps (2026-01-26); Agent Skills open standard
      [UNVERIFIED adoption counts].
    - *Gain:* distribution inside Claude, ChatGPT and VS Code with no session state on Vercel.
    - *Changes:* new `src/app/api/mcp/route.ts`, `src/lib/workflows/registry.ts` (export), and the policy
      layer from item 10.
14. **Inspect-before-write and verify-after-write in Studio's spreadsheet agent.**
    - *How:* before any write, the agent must read the target range, its headers and the cells that
      depend on it. After writing, it must re-read and diff the values and check formulas for
      #REF!/#DIV/0! and broken links to other sheets.
    - *Evidence:* SpreadsheetBench 2: the dominant failures are insufficient inspection and the wrong
      target cell, and debugging scores only 12% (2606.29955).
    - *Gain:* fewer silent wrong-cell writes, the main way spreadsheet agents fail on real workbooks.
    - *Changes:* `src/lib/studio/*` (workbook tool definitions passed as `extraTools` to `runChat`), and
      the Excel add-in under `src/lib/office/`.

---

*Unconfirmed in this run, to re-check when `arxiv.org`, `developers.openai.com` and `vals.ai` are
reachable:*
- Official Vals FAB v2 standings.
- OpenAI GPT-6 pricing on OpenAI's own page.
- Gemini 3.5 Pro and 3.8 Flash pricing.
- Model scores on FrontierFinance.
- Deep FinResearch Bench's numbers and affiliation.
- The asymmetric-verification paper's arXiv ID.
- The primary texts of the FINRA and Treasury documents.
