# Implementation plan (claim-first)
Problem anchor: see `PROBLEM_ANCHOR.md`. In short: make the numbers provably right and the autonomy provably earned, and measure both.
Capacity assumed: one engineer with an AI coding agent, about 8 weeks. Each block names the claim it lets YouBank make, how it's tested, and the result that would falsify it.

## Claim map

| # | Claim YouBank will be able to make | Block | Falsifying result |
|---|---|---|---|
| K0 | "Nothing YouBank does with your email, meetings or data creates legal exposure we know about." | M0 must-dos | Any must-do item still open at paid launch |
| K1 | "We measure our answers' accuracy and reliability on a reproducible finance test set, every night." | B1 eval harness | The harness can't tell the current model from a deliberately degraded one (pass^k gap < 10 pts) |
| K2 | "Every figure in an answer is checked against the source it cites; we show how many were verified." | B2 verify every figure | On the labelled set: < 85% precision on "unverified" flags, or < 70% recall of injected wrong numbers, or a verified rate that rises with payload size |
| K3 | "The agent only acts on its own after it has earned it from your own approvals, with a stated error bound." | B3 earned autonomy | The median active autopilot user can't reach certification within 30 days at current label volumes, or the bound is violated in replay |
| K4 | "Use YouBank's cited regulatory data inside Claude and ChatGPT." (distribution experiment) | B4 MCP connector | < 50 attributed sign-ups in 30 days after listing → stop investing |

## M0 — must-dos (week 1–1.5, ship regardless)
Each is small and was confirmed against code by the triage reviewer and re-checked in this run:
1. **Campaign email compliance.** `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), a visible unsubscribe line and a postal address on campaign and nurture mail, opt-outs honoured within two days, and SPF/DKIM/DMARC pre-checks. The only send path is `src/lib/crm/send.ts:95`; today the only list-unsubscribe code reads inbound mail (`autopilot-rules.ts:174`).
2. **Autopilot trust gate fails closed.** `src/lib/crm/autopilot.ts:101` `.catch(() => null)` becomes a hold with a reason. Add a unit test in the existing `scripts/test-crm*.ts` style.
3. **Meeting consent by default.** All participants get notice by default and consent is stored per participant (`src/lib/meetings/pipeline.ts:68-76`). Auto-start does not skip the prompt. Recording stops when someone objects.
4. **Two-factor auth.** Enable the installed Better Auth `twoFactor` plugin (`src/lib/auth/server.ts:51`); require it for broker connections, live trading and Gmail send.
5. **Turn off the unlicensed Nasdaq.com scrape in production** (`src/lib/market/nasdaq.ts:34-35` defaults on). Evaluate IEX delayed TOPS as the licensed delayed backup.
6. **Make landing claims true or reword them** until B2/B3 ship (`Landing.tsx:110` "source link on every figure", `:168` "earns the right to send on its own").
7. **Decisions for the owner (not code):** Gmail OAuth scope strategy before 100 OAuth users (`gmail.readonly` is restricted → CASA, or send-only + IMAP path); move Vercel to Pro before charging (Hobby bans commercial use); FMP display licence with AI-use rights; counsel on copy and algo trading (publisher's exclusion vs RIA partner).
8. **Product analytics view.** A SQL view over existing tables (workflow_runs, ai_usage, crm_drafts, studio_runs, signups) for activation, D7/D30 and per-module use, so later blocks have metrics. The triage reviewer noted none exists.
9. **Fix PatentsView** (`src/lib/edge/pulse/sources/patentsview.ts:25` calls `search.patentsview.org`, which USPTO paused and migrated on 20 Mar 2026). Test live first; this sandbox could not reach it.

## B1 — Finance eval harness (weeks 1.5–3) → K1
- **Golden set**, built only from data where the right answer is computable:
  - (a) XBRL-recomputable figures, e.g. LTM revenue or margin for 40 tickers, computed by `src/lib/company.ts` itself at freeze time and stored with filing accession numbers;
  - (b) filing lookups (8-K items, Form 4 counts);
  - (c) time-sensitive quotes with an as-of tolerance;
  - (d) 10 Studio build/debug tasks with checkable cells.

  Freeze it in `scripts/fixtures/eval-agent/` with the snapshot date. No answer is graded by an LLM alone.
- **Runner** `scripts/eval-agent.ts`: drives `runChat`/workflows, k=3 repeats, scores pass@1 and pass^3, verified-figure rate (after B2), tokens and cost from the usage ledger. Runs nightly where keys exist (this sandbox has no SEC or OpenAI reach), via Batch API where possible.
- **Baselines:** the current default model; the routed small models; a deliberately degraded run (tools withheld) as the sanity floor.
- **Output:** `/accuracy` page (C7) only after 4 weeks of stable numbers, every figure linking to its run file.
- **Positioning:** vendors self-report one-shot scores (Fintool 90% on the Vals public subset; Rogo BigFinanceBench subset). We found no vendor reporting pass^k. That reporting, plus reproducibility, is the difference.

## B2 — Verify every figure, redesigned per pilot P1 (weeks 3–5) → K2
Pilot P1 (`runs/probe-verify-*.json`, synthetic_proxy) showed that reusing Edge's check as-is accepts wrong figures 37–54% of the time on average, rising with payload size, mostly through its pairwise arithmetic step. The variant that worked accepted correct figures ~99% of the time and wrong ones ~5%. It has three parts:
1. **Bind each figure to the cited entity's payload.** Record raw payloads per source id in `ToolCtx.addSource` (`src/lib/ai/tools.ts`), and check a figure only against the payload of the [Sx] it cites.
2. **Typed payloads.** Ratio fields carry units: serialise `gross_margin` etc. as "67.3%" and multiples as "2.5x" in `summarize()` (`tools.ts:42-61`), or attach a unit map.
3. **No free pairwise derivations.** A derived figure must come from a `calc` call with references (A2: `calc` already supports variables, `tools.ts:238-246`); the verifier re-runs that calc.

Plus:
- **UI:** "N of M figures verified", unverified ones underlined with the reason.
- **Surfaces:** chat first, then workflow outputs, memos and Studio tie-out.
- **Validation (real_gt):** 200 hand-labelled figures from real answers on the B1 golden set, plus injected wrong numbers. This also replaces Edge's synthetic calibration fixture (`src/lib/edge/claims/model.json`, 468 template claims) with real labels.
- **Positioning vs Kepler** (Claude-based; "every number validated", removes unverifiable values, Business Wire 21 May 2026): Kepler is an enterprise research platform. YouBank does this at $59, shows a numeric verified rate per answer (not found elsewhere), and carries verification into outreach and Studio.

## B3 — Earned autonomy, made real (weeks 5–7) → K3 (the high-upside slot)
Novelty check: HIGH as a shipped product. No product found that gates agent actions on a statistical guarantee from the user's own approvals. The closest research is Conformal Selective Acting (arXiv 2605.20270, May 2026). The triage reviewer found today's version is weaker than the marketing:
- the e-process only demotes (`engine-rules.ts:118-133`);
- certification is a Bayesian 90% bound re-checked on every label (not anytime-valid);
- it only offers autopilot rather than gating it (`engine.ts:393`).

Steps:
1. **Label-volume check first** (one day, from `crm_learning_events` in production): per active user and stratum, how many approve/edit/reject labels arrive per week? If the median user reaches the required n within 30 days, proceed. If not, stop at email and record it as a documented negative.
2. **Make certification gate auto-send for email.** Auto requires a current certificate. Certification uses an anytime-valid test (e.g. a betting e-process for "error rate ≤ α"), keeping the existing demotion.
3. **Generalise to one more action type only:** Studio writes to a shared workbook, or campaign sends, through a shared `src/lib/ai/policy.ts` modelled on `src/lib/algo/agent-gate.ts`. Trading stays on its existing gates and counsel's decision.
4. **Validation (simulation_only, then real):** replay historical labels; the realised error rate of auto-sent drafts must stay ≤ α at every stopping time in replay.

## B4 — MCP connector as a bounded distribution experiment (weeks 7–8, optional) → K4
Novelty is LOW. Free EDGAR MCP servers already exist, including a hosted keyless one (secedgar.caseyjhand.com/mcp, cyanheads/secedgar-mcp-server), plus an "SEC Funding Tracker" Form D server and paid SEC-API.io. Scope is therefore narrow:
- read-only Form D × precedents × Deal Radar tools that no free server has;
- deep links into YouBank;
- no licensed prices.

Build:
- **Server:** `mcp-handler` 2.3.0 (2026-07-28 spec, stateless, legacy fallback) on `@modelcontextprotocol/server` ^2.
- **Auth:** Better Auth OAuth provider. Pilot P2: the 1.6.33 provider is a patch bump; CIMD support is unconfirmed.

Kill criterion: < 50 attributed sign-ups in 30 days. B2's guarantee does not apply here, since the host model writes the answer.

## Deferred (backlog, ranked by the triage reviewer)
In priority order:
1. D2 onboarding to first value
2. A5 cheaper models behind B1
3. A8 inspect-before-write (verify-after-write already exists in `studio/agent.ts:200-211`)
4. D3 narrow the front door / Labs
5. D1 desk inbox
6. C4 email-the-desk
7. D4 PWA + push
8. A3 tool search (weakened: the 230 workflows add no data reach beyond the 39 tools)
9. E7 data hygiene
10. E1–E6 quant items
11. F3 platform items (React Compiler, OTel, Cache Components)

Not recommended: TSFM daily-return signals; LLM-emitted credit or M&A probabilities without trees and calibration; a shared cross-customer prospect database (GDPR and data-broker exposure).

## Run order and milestones
M0 must-dos → M1 B1 harness with baselines → M2 B2 verified figures on chat → M3 B3 label check, then the gate → M4 B4 if capacity remains.

## Risks
- Golden sets rot. Re-freeze quarterly, keep old sets for trend.
- B2 can still pass a wrong number that falls within the written rounding: about 5% in P1, worst for 1-decimal multiples. Show the tolerance.
- B3 label scarcity. The day-1 check decides whether to proceed.
- Sandbox limits: SEC, LLM and npm-provider docs were unreachable from here. Every live check above is marked for the owner's environment.
