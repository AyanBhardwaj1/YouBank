# Implementation plan (claim-first), revision 2
Problem anchor: `PROBLEM_ANCHOR.md`. Make the numbers provably right and the autonomy provably earned, and measure both.
Capacity assumed: one engineer with an AI coding agent, about 8 weeks.
Revision 2 addresses the plan review (`traces/plan/round1_response.md`, memory in `REVIEWER_MEMORY.md`) and pilot P1 v2 (`runs/probe-verify-v2.json`).

## Claim map

| # | Claim YouBank will make | Block | Falsifying result |
|---|---|---|---|
| G0 | *(internal launch gate, not a public claim)* Known legal exposures in email, meetings, data licensing and auth are closed before charging | M0 | Any M0 item open at paid launch |
| K1 | "We measure our answers' accuracy and run-to-run reliability on a reproducible, period-pinned finance test set, every night, against a raw frontier model with a free EDGAR connector." | B1 | (a) Two identical nightly runs differ by more than binomial noise (about ±6 pts at n≈200), so the harness can't be trusted; or it can't separate the default model from the routed small model; or (b) YouBank does not beat the frontier model + free EDGAR MCP baseline on the figure-level tasks |
| K2 | "Every figure from structured data is shown from the source value, with the field and period it cites; you can see which ones. Figures from filing text are marked 'cited, not checked'." (Not "correct": choosing the right field and period stays the model's job.) | B2 | Recall on *injected* errors below thresholds fixed **before** building (wrong-id citations ≥ 0.6 caught by the field/period chip review set, retyped-digit and scale errors ≥ 0.95 prevented by rendering from the store, fallback matcher false accept ≤ 0.10 on perturbations), measured on fresh answers, not on B0; or a checked rate that rises with payload size |
| K3 | "The agent sends on its own only after a certificate earned from your own approvals, with a stated error bound (on drafts you reviewed; discarded drafts are not counted)." | B3 | B3-0 says no-go (below); or the false-certification rate exceeds δ in replay **and** in a simulation with a known bad rate |
| K4 | *(distribution experiment)* "YouBank's Form D × precedents × Deal Radar tools inside Claude and ChatGPT." | B4 | < 50 attributed sign-ups in the 30 days after the first public install path (not directory listing) → stop |

## Week 1, day 1–2 — the two most informative checks (before building anything)
- **B0. Real-answer audit (1–2 days, in the owner's environment, with tool payloads logged).** Take 30–50 real chat answers from the default model on typical questions (comps, a company's LTM, a margin, EV/revenue, growth). Label every figure:
  - correct or wrong;
  - error type: perturbed, wrong field/period, scale, arithmetic, or filing-text misread;
  - origin: a payload value, a `calc` result, a free derivation, or filing text.

  Output: the natural error rate and error mix, with confidence intervals (expect only ~10–20 natural errors, so treat the mix as rough). It decides B2's *emphasis*: wrong-field/period errors call for the field-and-period chip and reviewable citations; retyped-digit and scale errors call for rendering from the store. B0 does **not** set or test K2's thresholds; those are fixed in advance on injected errors (see the claim map). Store it as `scripts/fixtures/eval-agent/audit-v1.json`.
- **B3-0. Label-volume check (½ day, from `crm_learning_events` in production).**
  - Per active autopilot user and stratum, report per week: approve-unchanged, edited (any edit >5% counts as bad), rejected, and discarded (discards are not labels).
  - Pre-register α = 10% (matches today's code) and δ = 5%. Exact one-sided binomial test (certify when P(X ≤ observed bad | p = α) ≤ δ) needs n = 29 labels at a 0% observed bad rate, 29 at 3% and 76 at 5% (computed in this run). At α = δ = 5% it needs 59 / 260 / never, so almost no stratum would certify. The plan reviewer's earlier "22 / 65 / 140" were at α = δ = 10% by its own method. An anytime-valid test will need somewhat more; recompute with the chosen test before the check.
  - Go needs both enough volume and an observed bad rate clearly below α, in at least 3 strata across at least 5 users.
  - State whether certification counts the 90-day decayed counts or raw counts.
  - **Go/no-go:** go if the median active stratum reaches n within 30 days. Otherwise stop B3 at email and document the negative.

**Cut line, if time runs short:** drop B4 first, then B3's second action type. B2 on chat comes before anything in B3 beyond email. Inside B2, ship the fixed fallback matcher (and its "matches a number in the cited source" label) before rendering from the store.

## M0 — internal launch gate (weeks 1–3, in parallel with B1)
**Day 1:**
- **Fail-closed trust gate.** `src/lib/crm/autopilot.ts:101` `trustGate(...).catch(() => null)` becomes a hold with a reason. Add a test beside the existing ones in `scripts/test-autopilot.ts` / `scripts/test-learning.ts`.
- **Landing copy.** Reword `src/components/marketing/Landing.tsx:110` ("source link on every figure" → e.g. "a source on every figure; structured figures checked" once B2 ships; until then "cited to the filing") and `:168` ("earns the right to send on its own" → describe today's probation, spot check and hold accurately).

**Weeks 1–3:**
1. **Campaign and nurture email compliance.** RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, a visible unsubscribe line and a postal address, opt-outs within two days, SPF/DKIM/DMARC pre-checks. Single send path: `src/lib/crm/send.ts:95`.
2. **Meeting notice.** A mandatory participant notice (bot announcement or a posted notice) plus the host's attestation, stored per meeting. Auto-start can no longer skip it (`src/lib/meetings/pipeline.ts:68-76`). Per-participant consent has no mechanism in desktop capture, so this is the feasible bar. Counsel reviews speaker labelling (BIPA).
3. **Two-factor auth** with the installed Better Auth `twoFactor` plugin (`src/lib/auth/server.ts:51`), required for broker connections, live trading and Gmail send.
4. **A separate switch for the Nasdaq.com scrape.** Today `MARKET_BACKUP` (`src/lib/market/nasdaq.ts:35`) also gates the CoinGecko backup (`free.ts:29`) and the earnings calendar (`news/calendar.ts:48`). Split it, turn the Nasdaq scrape off in production, and evaluate IEX delayed TOPS.
5. **Product analytics view** (SQL over workflow_runs, ai_usage, crm_drafts, studio_runs and sign-ups): activation, D7/D30, per-module use.
6. **Owner decisions, not code:**
   - Gmail OAuth scope before 100 OAuth users (`gmail.readonly` is restricted, so it needs CASA; or go send-only plus IMAP).
   - Vercel Pro before charging.
   - FMP display licence with AI-use rights.
   - Counsel on copy and algo trading (publisher's exclusion vs RIA partner).

## B1 — Finance eval harness (weeks 1–3) → K1
- **Ground truth that is not the agent's own code path:**
  - (a) **Hand-checked slice.** 40 figures for 10 tickers, pinned to a named fiscal period and filing accession, checked by a person against the filing.
  - (b) **Machine slice.** 200+ figures read from SEC XBRL company facts *by accession and period*, not via `getCompanyData` (which has no as-of date and is the agent's own tool path).
  - (c) **Filing lookups.** 8-K items, Form 4 counts.
  - (d) **Studio tasks.** 10 build or debug tasks with checkable cells.
  - (e) **The B0 audit set.**

  Every question names its period. Freeze in `scripts/fixtures/eval-agent/` with the snapshot date.
- **Runner** `scripts/eval-agent.ts`: runs the chat agent and workflows with k = 3 repeats; reports pass@1, pass^3, figure-level accuracy by error type, and tokens and cost from the usage ledger. Runs nightly where keys and network exist (this sandbox has neither).
- **Comparators:**
  - the default model;
  - the routed small model (A5's gate);
  - **the raw frontier model with only a free EDGAR MCP server**, the baseline a buyer will ask about;
  - run-to-run stability, as the pass@1 vs pass^3 gap.
- **Publishing:** the `/accuracy` page comes only after 4 weeks of stable numbers, each linked to its run file.
- **Positioning:** we found no vendor reporting pass^k; vendors self-report one-shot subsets (Fintool, Rogo).

## B2 — Field-bound figures (weeks 3–5) → K2
P1 v2 (`runs/probe-verify-v2.json`, synthetic_proxy, 5 companies in context) shows how much each variant catches. The true-accept rate for correct figures is 0.990 / 1.000 / 1.000 by row (high by construction):

| Variant | Wrong field/period accepted | Perturbed accepted | Scale error accepted | Correct accepted |
|---|---|---|---|---|
| Edge check as-is | 0.987 | 0.523 | 0.526 | — |
| Entity-scoped + typed | **1.000** | 0.037 | 0.008 | — |
| Bound to the claimed field | **0.031** | 0.023 | 0.003 | 1.000 |

**How to read this honestly:**
- The field_bound row is true by construction: the probe hands the verifier the correct field from its own answer key (`probe-verify-v2.ts:69`).
- In the real design the model chooses the field id. A wrong-field error then becomes the model citing `prior_ltm_revenue` under the words "LTM revenue", which binding accepts every time, exactly like `entity_typed`.
- What the table does show: post-hoc matching cannot catch wrong-field errors at all, and binding plus rendering from the store removes retyped-digit and scale errors.
- `entity_typed`'s good scale result comes from the probe writing money as "$… million" (typed payloads), not from a verifier fix.
- The 0.526 scale figure in the pool row hides an asymmetry: writing "million" for "billion" is accepted about 100% of the time (per the reviewer's breakdown, not re-run here).

So the design is prevention for what prevention can fix, and a visible field-and-period chip for what it can't:
1. **Structured tool results carry a figure registry.** Each value has an id like `S3.revenue@FY2026Q2` with its unit, its scale and the entity it belongs to. Bind by tool result and company, not by the `addSource` id, which today is issued before the payload exists and merges FMP sources by URL.
2. **Answers cite figures by id.** The renderer shows the value from the registry, not the model's retyped digits, and every chip shows the field name and period ("Revenue, LTM to Jun 2026"), so a wrong-field choice is visible to the reader. Derived figures come from `calc` with id references, so `calc` needs to resolve `S3.revenue` and return a citable result id.
3. **Fallback detection for figures without an id:** entity-scoped matching on unit-typed values (money only against money at its declared scale). Before reuse, fix four verifier bugs in `src/lib/edge/claims/numbers.ts`:
   - payload values 1900–2099 masked as years (`:26`);
   - "1.2B" not parsed as money;
   - SIC-code collisions;
   - the 1000× scale tries in `sameNumber` (`:66`).

   The UI says "matches a number in the cited source" for these figures, not "verified".
4. **v1 scope:** chat answers citing structured tools. Figures from filing text are shown as "cited, not checked".
5. **Validation:**
   - Pre-registered recall thresholds (claim map K2) are measured on injected errors in fresh answers: wrong-id citations, retyped digits and scale slips.
   - Natural errors are counted on fresh answers, not on B0.
   - Precision is reported only on natural figures, with the base rate stated.
   - The "checked rate" for id-cited figures will read about 100% by construction, so the UI must not present it as accuracy.
6. **Calibration data.** Replace Edge's synthetic fixture (`src/lib/edge/claims/model.json`, 468 template claims) with B0 and B2 labels.

Positioning vs Kepler (Claude-based; "every number validated", Business Wire 21 May 2026): figure-level binding at $59 with a numeric checked rate, carried into outreach and Studio.

## B3 — Earned autonomy, made real (weeks 5–7, only if B3-0 says go) → K3
Today, per the triage review:
- the e-process only demotes (`engine-rules.ts:118-133`);
- certification is a Bayesian 90% bound re-checked on every label;
- it only offers autopilot, it doesn't gate it (`engine.ts:393`).

Steps:
1. **Auto-send requires a current certificate** from an anytime-valid test of "bad rate ≤ α" at level δ, as pre-registered in B3-0. Keep the existing demotion.
2. **Generalise to one more action type,** shared Studio workbook writes or campaign sends, through `src/lib/ai/policy.ts`, modelled on `src/lib/algo/agent-gate.ts`. Trading keeps its own gates.
3. **Replay validation:** the false-certification rate across users and strata at any stopping time must stay ≤ δ.

Novelty: HIGH as a product. Closest research: Conformal Selective Acting (arXiv 2605.20270).

## B4 — MCP connector, bounded (weeks 7–8, optional) → K4
Novelty is LOW. A hosted keyless EDGAR MCP server exists (cyanheads/secedgar-mcp-server), plus open-source ones, SEC-API.io and an "SEC Funding Tracker" Form D server.

**Scope:**
- read-only Form D × precedents × Deal Radar tools;
- deep links into YouBank;
- no licensed prices;
- B2's guarantee does not apply, because the host model writes the answer.

**Build:** `mcp-handler` 2.3.0 (2026-07-28 spec plus legacy fallback) on `@modelcontextprotocol/server` ^2. Auth through Better Auth's OAuth provider. CIMD support is unconfirmed (P2), so check it before starting.

## Deferred backlog (triage ranking)
In order:
1. D2 onboarding
2. A5 cheaper models (behind B1)
3. A8 inspect-before-write
4. D3 Labs / narrow front door
5. D1 desk inbox
6. C4 email-the-desk
7. D4 PWA + push
8. A3 tool search (weakened: the 230 workflows add no data reach)
9. E7 data hygiene, including PatentsView (only runs with `PATENTSVIEW_API_KEY`, so low impact)
10. E1–E6 quant
11. F3 platform

Not recommended:
- TSFM daily-return signals;
- LLM-emitted credit or M&A probabilities without trees and calibration;
- a shared cross-customer prospect database;
- naive reuse of Edge's number check (P1).

## Run order
B0 + B3-0 (week 1) → M0 day-1 items → B1 + M0 rest (weeks 1–3) → B2 (weeks 3–5) → B3 if go (weeks 5–7) → B4 if capacity remains.

## Risks
- Golden sets rot: re-freeze quarterly.
- B0 may show figures are mostly right already. Then B2 is mainly a trust surface, and its UI claim stays "checked", not "correct".
- B3 label scarcity: decided by B3-0.
- Sandbox limits: SEC, LLM APIs and some npm docs were unreachable here, so every live check is flagged for the owner's environment.
