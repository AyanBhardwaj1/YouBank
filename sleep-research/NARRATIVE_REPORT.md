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

**R1. In a synthetic probe, Edge's number checker reused as-is on chat-style payloads accepts many wrong figures. Most of the leak is its pairwise arithmetic step.**
- **Rates:** with 5 companies in context, figures perturbed by 3–30% were accepted 52.3% of the time and 1000× scale errors 52.6%. Correct figures were accepted 99.0% (`runs/probe-verify-v2.json` → `results.pool`).
- **Wrong-field errors (98.7%) are true by design, not a measurement.** The probe always puts the wrong field's value in the payload, so any value-matching check accepts it.
- **Payload size matters less than the arithmetic step.** The mean false-accept rate is 0.369 → 0.521 → 0.543 at 1 / 5 / 15 companies (`runs/probe-verify-pool.json`): it rises from 1 to 5 companies and barely moves after that. Restricting to the cited company alone leaves ~36% (`runs/probe-verify-entity.json`); removing the arithmetic step drops it to ~3–4% (`runs/probe-verify-entity_direct.json`).
- **Scope:** synthetic_proxy, generated payloads shaped like `get_company_financials`, 300 trials per setting, one seed. This shows the mechanism, not a natural error rate.

**R2. Matching numbers after the fact can't tell which field a value came from. When the wrong value is present in the cited payload (as it was in every wrong-field case tested), the check accepts it.**
- **Entity-scoped, unit-typed payloads with the arithmetic step off** (`entity_typed`) accept 1.000 of wrong-field errors, 0.037 of perturbed figures and 0.008 of scale errors.
- **Most of that gain comes from turning the arithmetic step off.** That has an untested cost: correct computed figures in real answers would be rejected unless they come from `calc`.
- **The 0.037 overstates the leak.** Of the 78 accepted perturbed figures, 45 printed identically to the true figure after rounding (`traces/claims/audit-v2-identical.ts`), so the real residual is about 1.6%.
- **Wrong-period was tested with a single swap** (prior-year revenue).
- **`field_bound`'s 0.031 is true by construction,** because the probe supplies the correct field. It shows that binding plus rendering from the source removes retyped-digit and scale errors, not that wrong-field choices are caught.
- **Evidence:** `runs/probe-verify-v2.json`; the honesty note is in `EXPERIMENT_PLAN.md` §B2.

**R3. Four bugs in the existing verifier, reproduced** (`src/lib/edge/claims/numbers.ts`; `runs/verifier-bugs.txt` from `code/verifier-bugs.ts`):
1. Payload values 1900–2099 are masked as years.
2. "1.2B" is not parsed as money. The code documents this as intended (`numbers.ts:41`).
3. SIC code "7372" backs a false "$7.4 billion". This is realistic, because real payloads carry `sic`.
4. A 1000× scale error is accepted.

Bugs 1–2 wrongly reject correct figures, which is the safe direction. Bugs 3–4 accept wrong ones.

**R4. Liabilities in the shipped code** (checked by the triage reviewer, the executor and the claims auditor):
- **Autopilot fails open.** The trust gate lets a draft through when its own check errors (`src/lib/crm/autopilot.ts:101`).
- **No unsubscribe on CRM mail.** The CRM send path adds no unsubscribe header or footer (`src/lib/crm/send.ts:94`). The only List-Unsubscribe code reads inbound mail (`autopilot-rules.ts:174`). Opt-outs are honoured once recorded. `news/deliver.ts:29` also sends mail, but only to the user's own address.
- **No second factor.** Auth configures only `nextCookies()` (`src/lib/auth/server.ts:51`): no 2FA, passkeys, organizations or SSO, on accounts that can hold Gmail send and broker tokens.
- **Unlicensed scrape on by default.** The Nasdaq.com scrape is on by default and shares a switch with the CoinGecko backup and the earnings calendar (`src/lib/market/nasdaq.ts:35`, `free.ts:29`, `news/calendar.ts:48`).
- **Synthetic calibration.** Edge's claim calibration was fitted on 468 template-generated claims (`src/lib/edge/claims/model.json`).
- **Landing copy overpromises.** It promises figure-level sourcing and earned sending (`Landing.tsx:110,168`) beyond what the code enforces.

**R5. Market position.** The labs and data vendors now sell finance agents and MCP data:
- Anthropic finance agents, 5 May 2026;
- ChatGPT for Financial Services, 10 Sep 2026;
- FactSet, LSEG, PitchBook, Daloopa and S&P on MCP.

Published list prices cluster at ~$0–359 a month (Koyfin, TIKR, Perplexity) and at an estimated ~$10K+ a seat a year (AlphaSense, Grata, Bloomberg). **Every price in the enterprise band is tagged [UNVERIFIED] in `research/market.md`.** The same file lists estimates in between, such as Rogo at ~$3.3K a seat a year (Sacra estimate) and Axial at $5–15K. So "a gap in published prices" is the defensible reading, not "nothing in between".

**R6. Novelty of the chosen bets** (`traces/novelty/round1_response.md`; ~20 searches across all four bets; "not found" ≠ "doesn't exist"):
- **Verify every figure: LOW.** Kepler markets that every number is validated and unverifiable values are removed (the novelty file's paraphrase of its materials).
- **Eval harness: LOW internally.** MEDIUM only as a *fully reproducible* public page; no vendor reporting pass^k was found.
- **MCP connector: LOW.** A hosted keyless EDGAR MCP server exists.
- **Earned autonomy: HIGH as a shipped product only.** The method is published (closest: arXiv 2605.20270). The product rating rests on about 4 searches, and Lindy, Fyxer, Superhuman and Agentforce were not checked, so it needs confirming before it is used in marketing.

**R7. Certification sample sizes.** α is the target bad-send rate and δ the chance of wrongly certifying a stratum that misses it. The table gives the reviewed drafts a stratum needs under a single-look exact one-sided binomial test, with the bad count rounded up so a stratum really runs at that rate (`code/certification-n.py` → `runs/certification-n.txt`):

| α | δ | 0 bad | stratum at 3% bad | stratum at 5% bad |
|---|---|---|---|---|
| 10% | 5% | 29 | 61 | 116 |
| 5% | 5% | 59 | 361 | never |

The plan requires an anytime-valid test, which needs more labels at non-zero bad rates. These are lower bounds.

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
