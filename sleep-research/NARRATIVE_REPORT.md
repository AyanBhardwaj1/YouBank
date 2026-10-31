# YouBank frontier research: narrative report
Run `youbank-frontier-20261031` · 2026-10-31 · Reviewer route: **same-family Claude subagents (provisional)**. No other model family was available, so treat every verdict here as provisional.

## Problem and core claim
General finance research is being commoditised by the AI labs and by data vendors shipping MCP. Independent benchmarks still show finance agents failing on evidence extraction and arithmetic. YouBank's defensible position is **numbers that are provably right and autonomy that is provably earned, both measured, at a fraction of enterprise prices**. Today YouBank claims both on its landing page but implements them only partly (`PROBLEM_ANCHOR.md`).

## Method
1. Six web-research tracks (market, AI agents, quant/ML, platform, data and regulation, product/UX) and a read-only codebase audit. Each track was capped at about 11–38 web searches by a shared search budget, and arxiv.org, vals.ai and SEC pages were blocked from the sandbox. Many external figures are therefore from search summaries and tagged [UNVERIFIED] in `research/*.md`.
2. 38 candidate moves (`IDEA_REPORT.md`).
3. A fresh-reviewer triage with code checks (`traces/triage/round1_response.md`), and a fresh-reviewer novelty check (`traces/novelty/round1_response.md`).
4. Pilots: a seeded number-verification probe (`code/probe-verify.ts`, `code/probe-verify-v2.ts`; results in `runs/`), plus npm and network feasibility probes (`EXPERIMENT_TRACKER.md`).
5. A claim-first plan (`EXPERIMENT_PLAN.md`), reviewed for two rounds in hard mode (`AUTO_REVIEW.md`, 5/10 → 7/10, "almost").

## Results, with evidence per claim

**R1. Reusing Edge's number checker as-is on chat answers would pass many wrong figures.**
On synthetic chat-style payloads, wrong figures perturbed by 3–30% were accepted 52.3% of the time with 5 companies in context. Wrong-field figures were accepted 98.7% and 1000× scale errors 52.6%. Correct figures were accepted 99.0%.
- Evidence: `runs/probe-verify-v2.json` → `results.pool`.
- v1 shows the false-accept rate rising with payload size: mean 0.369 → 0.521 → 0.543 at 1 / 5 / 15 companies (`runs/probe-verify-pool.json`).
- Eval type synthetic_proxy, N = 300 trials per setting, one seed.

**R2. Post-hoc number matching cannot catch wrong-field or wrong-period errors. Typed, entity-scoped payloads fix perturbation and scale errors.**
- `entity_typed`: wrong-field accepted 1.000; perturbed 0.037; scale 0.008.
- `field_bound` reaches wrong-field 0.031, but only because the probe supplies the correct field. It shows that binding plus rendering from the source removes retyped-digit and scale errors, not that wrong-field choices are caught.
- Evidence: `runs/probe-verify-v2.json`; the honesty note is in `EXPERIMENT_PLAN.md` §B2.

**R3. Four bugs in the existing verifier, reproduced** (`src/lib/edge/claims/numbers.ts`):
- payload values 1900–2099 are masked as years;
- "1.2B" is not parsed as money;
- a SIC code "7372" backs a false "$7.4 billion";
- a 1000× scale error is accepted.

Evidence: `runs/verifier-bugs.txt` (from `code/verifier-bugs.ts`).

**R4. Liabilities in the shipped code** (checked by the triage reviewer and re-checked by the executor):
- The autopilot trust gate fails open on error (`src/lib/crm/autopilot.ts:101`).
- The only send path adds no unsubscribe header or footer (`src/lib/crm/send.ts:95`; the only List-Unsubscribe code reads inbound mail at `autopilot-rules.ts:174`).
- Auth uses only `nextCookies()` (`src/lib/auth/server.ts:51`).
- The Nasdaq.com scrape is on by default and shares a switch with the CoinGecko backup and the earnings calendar (`src/lib/market/nasdaq.ts:35`, `free.ts:29`, `news/calendar.ts:48`).
- Edge's claim calibration was fitted on 468 template-generated claims (`src/lib/edge/claims/model.json`).
- Landing copy promises figure-level sourcing and earned sending (`Landing.tsx:110,168`) beyond what the code enforces.

**R5. Market position.** The labs and data vendors now sell finance agents and MCP data:
- Anthropic finance agents, 5 May 2026;
- ChatGPT for Financial Services, 10 Sep 2026;
- FactSet, LSEG, PitchBook, Daloopa, S&P on MCP.

Published prices split into ~$0–359 a month and ~$10K+ a seat a year, with almost nothing in between. Evidence: `research/market.md`; several prices are tagged [UNVERIFIED] there.

**R6. Novelty of the chosen bets** (`traces/novelty/round1_response.md`, ~20 searches; "not found" ≠ "doesn't exist"):
- **Verify every figure: LOW.** Kepler already sells "every number validated".
- **Eval harness: LOW internally, MEDIUM if published with pass^k.** No vendor reporting pass^k was found.
- **MCP connector: LOW.** A hosted keyless EDGAR MCP server exists.
- **Earned autonomy: HIGH as a product.** No shipping product was found that gates agent actions on statistical guarantees from user labels. The closest research is arXiv 2605.20270.

**R7. Certification sample sizes** (exact one-sided binomial; `code/certification-n.py` → `runs/certification-n.txt`). The number of reviewed drafts a stratum needs before certification:

| α | δ | at 0% observed bad | at 3% | at 5% |
|---|---|---|---|---|
| 10% | 5% | 29 | 29 | 76 |
| 5% | 5% | 59 | 260 | never |

## Figure and table inventory
- **Exists:**
  - per-setting result JSON in `runs/`;
  - tables in `EXPERIMENT_TRACKER.md`, `EXPERIMENT_PLAN.md` §B2 and this report.
- **Needs making when implementing:**
  - the B0 audit table (natural error mix);
  - the B1 nightly eval dashboard;
  - the B3-0 label-volume table per stratum.

## Limitations
- **Provisional review.** All review is same-family. Rerun triage, novelty and plan review with a different model family if one becomes available.
- **Blocked sources.** Search budget and sandbox network blocks meant arXiv, Vals, SEC and vendor pages were mostly not read in full. Many external numbers are [UNVERIFIED] in `research/*.md`.
- **Synthetic pilot.** The verification pilot is synthetic_proxy only (one seed, generated payloads shaped like `get_company_financials`). It says nothing about natural error rates in real answers, which is what B0 measures.
- **Untested live.** PatentsView liveness, SEC reachability, CIMD support in Better Auth's OAuth provider and LLM behaviour could not be tested from this sandbox.
- **Not legal advice.** The regulatory findings are a research summary; counsel decides the copy and algo trading posture, CASA, and recording consent.

## Follow-ups (in plan order)
1. B0 real-answer audit and B3-0 label check (week 1).
2. M0 day-1 fixes (fail-closed gate, landing copy).
3. M0 internal launch gate.
4. B1 eval harness.
5. B2 field-and-period-cited figures.
6. B3 certified autonomy, if B3-0 says go.
7. B4 bounded MCP experiment.
