# Triage, round 1: independent review of the 34 (actually 38) candidates

Reviewer: independent senior reviewer (product-minded staff engineer and fintech investor). I read BRIEF.md,
IDEA_REPORT.md, all seven research files, and the code paths cited below. I did not modify anything.
Budget assumed: one strong engineer with an AI coding agent for 6–8 weeks.

**Bottom line.** The research is broadly right that the moat is verified numbers, follow-through and price.
But the pool overstates how much of the "hard part" is already built. Edge's Calibrated Claims combiner was
fitted on synthetic, template-generated claims. Earned autonomy is advisory, not a gate. The 328 "tools" are
prompt recipes over the same 39 data tools. Build the measurement first (A4), then the per-figure check on
the main chat surface (A1), then distribution (C1) as the high-upside bet. Ship five small liability fixes
alongside these regardless.

---

## 0. Code claims checked (file:line)

| Claim (where) | Verdict | Evidence |
|---|---|---|
| Chat sends all 39 tools every turn (audit, ai-agents) | **Correct** | `CHAT_TOOLS` at `src/lib/ai/agent.ts:12`; used at `:94`; counts 14+7+11+7 in `tools.ts`, `inference-tools.ts`, `crypto/ai-tools.ts`, `quant/ai-tools.ts` |
| Tool results cut at 120k chars and resent (ai-agents §3.2) | **Correct** | `agent.ts:246`, `agent.ts:322` |
| Edge claims check used only inside Edge (audit) | **Correct** | only importers are `edge/docs/answer.ts`, `edge/agent/store.ts`, `edge/canvas/executors/outputs.ts` |
| "YouBank already built the hard parts (Edge's Calibrated Claims …)" (IDEA_REPORT exec summary) | **Overstated** | `src/lib/edge/claims/model.json:9`: calibration set is *"Template-generated claims with invented companies … to be replaced by labelled claims from real answers"* (468 synthetic claims). The deterministic number check is real. The calibrated probability and the Strict conformal guarantee rest on synthetic data. |
| Better Auth uses only `nextCookies()` (platform) | **Correct** | `src/lib/auth/server.ts:51` |
| No List-Unsubscribe on outbound mail (data-reg) | **Correct** | the only hit is inbound detection at `src/lib/crm/autopilot-rules.ts:174`. The single send path, `src/lib/crm/send.ts:95` (`mailbox.send({to, subject, body, inReplyTo, references, providerThreadId})`), adds no header, unsubscribe line or postal address. The opt-out *is* honoured (`send.ts:62-65`). |
| `gmail.readonly` restricted scope (data-reg) | **Correct** | `src/lib/crm/gmail.ts:15-17` |
| PatentsView still on old host (data-reg) | **Correct, low impact** | `edge/pulse/sources/patentsview.ts:25`. It only runs when `PATENTSVIEW_API_KEY` is set (`:10`, `:29`), so the call is likely dead rather than failing loudly. |
| 343 `force-dynamic`, 0 `"use cache"`, React Compiler off, no MCP code, no `manifest.ts`, stories `index:false` | **Correct** | grep counts match; `src/app/story/[slug]/page.tsx:20` |
| "Today a draft auto-sends when the model says confidence is 'high'" (ai-agents §2.4) | **Wrong as stated** | "high" is one of ~13 conditions in `autoSendVerdict` (`autopilot-rules.ts:211-227`). Drafts also pass an unapproved-link/address check (`autopilot.ts:96-99`), a probation gate and a 20% spot check (`engine.ts:112-124`). |
| "e-process anytime-valid autonomy certification" (BRIEF), "earns the right to send on its own" (`Landing.tsx:168`) | **Overstated** | The e-process only *demotes* (`engine-rules.ts:118-133`). Certification is a Bayesian 90% bound on decayed counts that is re-checked on every label, so it is not anytime-valid. Certification is also **advisory**: `trustGate` blocks only `probation` (`engine.ts:116`), so a user who sets a scope to "auto" sends in the `learning` state with zero labels (comment at `engine.ts:118`). "Trusted" is used only to *offer* graduation (`engine.ts:393`). |
| "models.ts and pricing.ts have none of the 5.5-generation Claude models" (ai-agents §5.1) | **Half wrong** | `pricing.ts:24,26` already price `claude-opus-5-5` and `claude-sonnet-5-5`. `models.ts` lacks them, and Haiku 5.5 is missing from both. |
| Haiku 5.5 $0.10/$0.50, Opus 5.5 $4/$20 [V] (ai-agents) | **Correct** | Matches Anthropic's model table (cached 2026-10-06). Caveats the report omits: the $0.10/$0.50 price holds only up to 100K-token prompts; Haiku 5.5 has thinking on by default at `medium` effort; it has no server-side refusal fallback. |
| "328 tools on SEC EDGAR/XBRL" (BRIEF, product-ux §4.3) | **Overstated** | 230 are AI workflows (prompt + whitelist of the same chat data tools + JSON schema; `api/tools/run/route.ts:66-71`) and 99 are pure calculators (`workflows/types.ts:2-5`, pack counts). The data surface is the 39 chat tools. |
| Studio needs "inspect before write, verify after write" (A8) | **Half done** | Verify-after-write already exists: `writeReport` returns formula results and `#ERR`s after every write (`studio/agent.ts:200-211, 343`). `audit_model`, `tie_out_deck` and `checkpoint` tools exist. What is missing is inspect-before-write: nothing detects overwriting non-empty cells that were not read. |
| B3 "10-minute undo window" | **Mostly built** | Autopilot already holds sends for `holdMinutes` (default 5, range 0–240): `autopilot-rules.ts:68,100`, `autopilot.ts:127`. |
| Desktop meeting consent | **Real gap** | `meetings/pipeline.ts:68-76` records only the host's agreement (`by: user.email`). `noticeCopied` is optional, and auto-start apps skip even that prompt. Desktop capture has no participant-visible bot, so this is the host-only-consent fact pattern in the Otter suits. |
| Nasdaq.com scrape is on by default | **Correct** | `market/nasdaq.ts:34-35`: `MARKET_BACKUP` defaults to "on". The file's own header calls it "not a licensed feed … personal use". |

**A defect nobody reported.** `src/lib/crm/autopilot.ts:101` reads `trustGate(...).catch(() => null)`. If the
trust lookup throws (a Neon timeout on a cron relay, say), the gate **fails open** and the draft schedules as
if it had no probation or spot check. The other gates fail closed. This is a one-line fix: on error, return a
hold reason. It is rare, but it is the gate that "earns the right to send".

**Bookkeeping.** IDEA_REPORT says 34 candidates but lists 38 IDs (A1–A9, B1–B5, C1–C7, D1–D7, E1–E7, F1–F3).
I rank all 38.

---

## 1. Per-candidate assessment

Format: **FOR** = best case that this defines YouBank · **AGAINST** = strongest objection · **FAIL** = most
likely failure mode · **PRIOR** = whether the prior work is a novelty problem.

### A. Verified intelligence

- **A1 Verify-every-figure.** FOR: makes the landing page's existing promise true. `Landing.tsx:110` says "the source link on every figure … if a number is derived, the method is stated", and today nothing checks chat text. A per-answer verified-figure rate is a concrete trust artifact that ChatGPT FS and Claude do not show. AGAINST: the reuse is smaller than claimed. `Source` carries only `{id,label,url}` (`tools.ts:22`), so raw payloads must be stored. `numbers.ts` was built for prose passages, not JSON. JSON percentages have no `%`, so they parse as `count` and never match a `%` claim directly. Derivations use only the first 40 numbers of the pool (`numbers.ts:86`), which is arbitrary for an XBRL series. A big payload makes accidental `count`/`usd` matches likely (`numbers.ts:63-66`), so the rate can read high for the wrong reason. The calibrated combiner must not be reused, because it was fitted on synthetic claims. FAIL: a badge that is green on large payloads and red on derived figures, which users learn to ignore. PRIOR: differentiable. Labs cite at the source level, and nobody publishes a per-figure check rate on general chat.
- **A2 Calc-by-reference.** FOR: prevents the transcription errors A1 can only detect; `calc` already supports variables (`tools.ts:238-246`). AGAINST: invisible to users, so it is not a flagship; the model can still pick the wrong reference. FAIL: the model ignores the references and keeps typing numbers. PRIOR: PoT is public; this is a correctness detail, not differentiation.
- **A3 Tool search over the catalogue.** FOR: puts 99 calculators into the chat box and trims definition tokens. AGAINST: the 230 workflows add no data reach (same 39 tools). Exposing them as tools means nested agent runs (`runChat` inside `runChat`) with their own budgets. 39 tools sits at the low edge of the 30–50 degradation range, and there is no eval showing selection errors today. FAIL: wrong-workflow picks and doubled latency, unmeasured. PRIOR: a native API feature; no differentiation.
- **A4 Finance eval harness.** FOR: every other AI change (A1, A5, A3, C7) is unmeasurable without it; only Edge has evals today (`scripts/eval-*.ts`). AGAINST: golden sets rot and are expensive to label well. FAIL: a 30-question set that everything passes. PRIOR: not differentiating in itself; the published results (C7) can be.
- **A5 Cheaper model swap behind the eval gate.** FOR: about 10x list-price cut on classify/extract/summarize (`route.ts:13-15`). AGAINST: Haiku 5.5's API surface changes (thinking on by default, no disabled thinking at `xhigh`/`max`, no refusal fallback), and the per-token saving only holds at low effort. FAIL: quality regressions on CRM triage that nobody sees without A4. PRIOR: pure cost; no differentiation, but direct margin.
- **A6 Lossless context / programmatic tool calling.** FOR: cheaper 30-turn deep runs. AGAINST: an optimisation without a measured cost problem, since there is a spend ledger but no evidence these runs dominate it. FAIL: a new storage layer that saves little. PRIOR: platform features; none.
- **A7 Asymmetric verifier.** FOR: buys deep-research accuracy cheaply. AGAINST: the core evidence is a review site with an unconfirmed arXiv ID, and it overlaps A1. FAIL: a second agent that agrees with the first. PRIOR: research idea; weak evidence.
- **A8 Studio inspect-before-write.** FOR: Studio is the flagship demo, and wrong-cell writes are the top failure mode. AGAINST: half built (see §0); the remaining piece is small. FAIL: none serious. PRIOR: Shortcut, Copilot and Claude for Excel all work on this; parity, not a moat.
- **A9 Generative answer components.** FOR: answers become actions and double as MCP App views. AGAINST: a UI investment before knowing which answers users act on. FAIL: components that only render Markdown more nicely. PRIOR: CopilotKit and MCP Apps make this standard.

### B. Trusted autonomy

- **B1 CaMeL-lite shared policy.** FOR: a structural injection defence across email, Studio and MCP. AGAINST: no current defect requires a framework. Chat tools are read-only except Studio writes to the user's own workbook. Email already has unapproved-detail and sensitivity gates. The one real exposure (disclosure to the wrong recipient) is what B3 targets. FAIL: a framework that slows every agent and protects nothing in use yet. PRIOR: research; becomes relevant when C1 adds action tools.
- **B2 Earned autonomy everywhere.** FOR: a statistically grounded autonomy ladder would be unique. AGAINST: the email version is advisory and its certification is not anytime-valid (§0). Studio and MCP actions have no label stream to certify on. FAIL: L effort for a badge nobody earns. PRIOR: differentiable in principle, but the claim must first be true in email.
- **B3 Confidential-deal outbound guard.** FOR: the Zoho-style leak is the incident that ends a boutique's trust, and the guard is cheap. AGAINST: codename detection is fuzzy, and the undo window already exists. FAIL: false holds that train users to override. PRIOR: no competitor advertises this; differentiable and on-message.
- **B4 Compliance action ledger.** FOR: unblocks Enterprise questionnaires. AGAINST: no enterprise pipeline yet; `copy_audit`, `algo_audit` and the CRM audit CSV already exist. FAIL: an export nobody downloads. PRIOR: Rogo has it; parity.
- **B5 Two-factor auth.** FOR: password-only accounts can hold Gmail send tokens and broker links, which is table stakes and SOC 2 evidence. AGAINST: none. FAIL: shipped but not required where it matters. PRIOR: none; a must-do.

### C. Distribution

- **C1 Remote MCP server and ChatGPT/Claude app.** FOR: the highest-upside move in the pool. Finance users now live in Claude and ChatGPT, and a free cited-filings/Form D connector is an acquisition channel that costs YouBank **no LLM tokens** (the host model reasons). AGAINST (three objections). (1) The A1 synergy is weaker than the report implies: in MCP the host writes the prose, so YouBank cannot verify the figures in the final answer, only return provenance-tagged values. (2) Free EDGAR MCP servers are already plentiful (open-source), and the pool's prior_work lists only paid data vendors. (3) Prices via FMP/Nasdaq must not flow through MCP to third-party AI hosts (redistribution plus "third-party AI tool" use under the Nasdaq policy). It must be EDGAR, government and YouBank-derived data only. FAIL: listed, used as a free EDGAR proxy, near-zero conversion; directory approval timing is outside YouBank's control. PRIOR: the MCP layer is commoditised; differentiation must come from Form D + directory + precedents + the follow-through deep link.
- **C2 BYO-licence MCP client.** FOR: workflow layer over licensed data with no redistribution cost. AGAINST: the stated target users ("firms in between") are the ones *without* FactSet or PitchBook seats, and vendor terms on third-party agents are unread. FAIL: built for a buyer who is not the customer. PRIOR: ASKB and Claude already do this for licence holders.
- **C3 Public `/c/[ticker]` pages.** FOR: organic acquisition on free, substantive data. AGAINST: Google's 2026 scaled-content action, and public price display needs a display licence. FAIL: thin pages, deindexed. PRIOR: crowded (Investing.com and others).
- **C4 "Email the desk".** FOR: reuses the mailbox stack and is the lowest-friction async surface for bankers. AGAINST: inbound mail triggering paid agent runs is an injection and cost-abuse surface (sender allowlist needed), and Rogo already ships it. FAIL: slow, partial memos by email that users stop forwarding. PRIOR: Rogo Felix; YouBank's price point differentiates, the feature does not.
- **C5 Campus programme.** FOR: a long-run distribution engine. AGAINST: mostly operations and content, not engineering; it earns no revenue inside the pilot window. FAIL: a certificate nobody shares. PRIOR: Bloomberg and WSP own this.
- **C6 Activation-triggered referral credits.** FOR: cheap. AGAINST: premature with no paying users and no activation instrumentation. FAIL: rewards nobody claims. PRIOR: none.
- **C7 Public accuracy page.** FOR: an answer to AI-washing scrutiny and a trust asset. AGAINST: only worth it after A4 and A1 produce honest numbers, and it publicly commits to a figure. FAIL: a low score published without context. PRIOR: vendor-only benchmarks industry-wide; differentiable if honest.

### D. Product shape

- **D1 Desk inbox.** FOR: a daily habit loop. AGAINST: a UI merge of five queues; value depends on agent output quality. FAIL: an inbox of noise. PRIOR: a common pattern; differentiation comes from what flows into it.
- **D2 Onboarding to a cited deliverable in under 2 minutes.** FOR: six choices sit before any value today (`OnboardingWizard.tsx:25`), and Day-0 conversion matters. AGAINST: the deliverable is only as good as A1 makes it. FAIL: a generic tear sheet. PRIOR: none needed; high EV per effort.
- **D3 Narrow the front door.** FOR: focus, and a smaller trust and regulatory surface next to the mailbox agent. AGAINST: a business decision more than engineering; it hides modules that may be the actual draw. FAIL: no data to decide with (see §5 on instrumentation). PRIOR: n/a.
- **D4 Morning brief + PWA + push.** FOR: cheap habit surface; the manifest is missing. AGAINST: iOS PWA push is weak. FAIL: low opt-in. PRIOR: Pulse.
- **D5 Cost preview / outcome pricing.** FOR: avoids a Cursor-style backlash. AGAINST: the product is a free beta with no charges yet. FAIL: none; it is just early. PRIOR: n/a.
- **D6 Always-on coverage agent.** FOR: a "SuperAnalyst for one" at boutique price. AGAINST: AlphaSense, Perplexity and ASKB ship it, and it needs E1. FAIL: alert fatigue. PRIOR: crowded.
- **D7 Warm-intro path finder over the team mail graph.** FOR: Affinity's headline agent at a boutique price. AGAINST: team mail-graph mining raises GDPR and data-broker questions the data-reg file itself flags. FAIL: a privacy complaint. PRIOR: Affinity owns it.

### E. Quant and data

- **E1 Filing-change detector.** FOR: "what changed" in seconds. AGAINST: no 2025–26 out-of-sample replication was found. FAIL: noisy diffs. PRIOR: known factor; differentiable as UX only.
- **E2 LLM contamination guard.** FOR: honest backtests. AGAINST: serves the quant module the pool wants moved to Labs. FAIL: few users. PRIOR: research lane.
- **E3 HAR / TTM vol.** FOR: cheap, evidence-backed. AGAINST: irrelevant to the deal-desk wedge. FAIL: unused. PRIOR: standard econometrics.
- **E4 Form D "next raise" hazard model.** FOR: an open academic lane and a unique data asset that feeds the existing `why_now` outreach angle (`engine-rules.ts:25`). AGAINST: labels are noisy. A later Form D or amendment is often an annual amendment or an amount-sold update, not a new round, which `engine-rules.ts:25` itself acknowledges. FAIL: a model that predicts amendment cadence, not fundraising. PRIOR: FilingFlow claims it; differentiable if evaluated honestly.
- **E5 Calibrate AI probabilities.** FOR: correct in principle. AGAINST: few settled ledger rows to fit on. FAIL: isotonic on tiny n. PRIOR: research.
- **E6 LEI/FIGI identity layer.** FOR: future joins under FDTA. AGAINST: agency rules land in 2027–28, with little user value now. FAIL: plumbing with no consumer. PRIOR: none.
- **E7 Data-source hygiene.** FOR: one part is a liability, not hygiene: the unlicensed Nasdaq scrape is on by default (`nasdaq.ts:34-35`). AGAINST: PatentsView only matters with a key; WARN 50-state is low value. FAIL: n/a. PRIOR: n/a.

### F. Must-do gates

- **F1 Campaign email compliance.** Real and cheap. Scope it to campaign and nurture kinds (commercial mail), not 1:1 replies. CAN-SPAM's postal address and in-message opt-out apply at any volume. The Gmail/Microsoft 5,000-a-day bulk rules rarely bind for a single user's mailbox.
- **F2 Gmail scope, meeting consent, copy/algo kept impersonal.** The meeting-consent part is the most urgent (§0). The Gmail part blocks growth past 100 OAuth test users. Copy/algo is already behind env switches (`env.ts:133`), so no new work is needed there beyond keeping them off.
- **F3 Platform bundle.** Five unrelated items bundled together is itself a smell. Vercel Pro is a must-do before charging (Hobby bans commercial use). OTel or Sentry is cheap and useful. Cache Components is L effort with no user-visible need yet, so defer it.

---

## 2. Ranked by expected value ÷ effort

EV = user value × differentiation × evidence strength. Effort assumes one engineer plus an agent.

| # | ID | Why it sits here |
|---|---|---|
| 1 | F1 | S effort, verified defect, statutory exposure on every campaign mail |
| 2 | B5 | S, plugin already installed, guards Gmail-send and broker tokens |
| 3 | F2 | S–M, meeting consent is a live litigation pattern; Gmail scope blocks growth |
| 4 | A4 | M, gates every AI change; nothing measures chat or workflows today |
| 5 | A1 | M, makes an existing marketing claim true; core of the trust thesis |
| 6 | D2 | S–M, activation with no new tech |
| 7 | B3 | S–M, undo already exists; the guard targets the M&A nightmare case |
| 8 | A5 | S after A4, direct margin |
| 9 | A2 | S–M, prevention half of A1 |
| 10 | E7 | S, the Nasdaq-scrape part is licensing liability |
| 11 | A8 | S, the remaining inspect-before-write piece |
| 12 | C1 | M–L, highest upside, with real differentiation risk |
| 13 | D3 | S engineering, a business call |
| 14 | C7 | S after A4/A1 |
| 15 | D1 | M |
| 16 | C4 | M |
| 17 | D4 | S–M |
| 18 | A3 | M, overstated reach |
| 19 | E4 | M, open lane, noisy labels |
| 20 | A9 | M |
| 21 | D6 | M, crowded |
| 22 | C3 | M, SEO and licensing risk |
| 23 | E1 | M |
| 24 | B4 | M, no buyer yet |
| 25 | F3 | Mixed bundle; split out Vercel Pro |
| 26 | D5 | S, premature |
| 27 | C6 | S, premature |
| 28 | A6 | M, unmeasured problem |
| 29 | B1 | M, framework without a current defect |
| 30 | E2 | S–M, Labs-bound |
| 31 | A7 | M, weak evidence |
| 32 | B2 | M–L, the base claim is not yet true |
| 33 | C5 | M, operations-heavy |
| 34 | E5 | M, too little data |
| 35 | C2 | M, wrong buyer |
| 36 | D7 | M, privacy risk |
| 37 | E3 | S–M, off-wedge |
| 38 | E6 | M, no consumer until 2027–28 |

One line: F1 > B5 > F2 > A4 > A1 > D2 > B3 > A5 > A2 > E7 > A8 > C1 > D3 > C7 > D1 > C4 > D4 > A3 > E4 > A9 > D6 > C3 > E1 > B4 > F3 > D5 > C6 > A6 > B1 > E2 > A7 > B2 > C5 > E5 > C2 > D7 > E3 > E6

---

## 3. The three flagship bets

Rough split of the 8 weeks: about 1.5 weeks of must-dos (§4), A4 about 1.5 weeks, A1 about 2 weeks, C1 about 3
weeks. That is tight but feasible, because A1's math and C1's auth plugin already exist.

1. **A4: finance eval harness.** Build it first, because without it A1's rate, A5's swap and any accuracy
   claim are unfalsifiable. The set should be XBRL-recomputable figures, filing lookups and derived ratios,
   each with a known answer, run on chat and the top 10 workflows. *It worked if* it runs nightly, a
   deliberately degraded prompt or model fails it, and pass^k is reported, not just pass@1.
2. **A1: verify every figure on chat, workflows and memos.** Use the deterministic number check only. Do not
   reuse the synthetic-calibrated combiner or claim calibration. Store raw tool payloads per source. Named
   risks: the JSON unit mismatch and large-payload false matches described in §1. *It worked if*, on 200
   hand-labelled figures from the A4 set and on injected errors: the "unverified" flag's precision is ≥ 85%,
   recall on injected wrong numbers is ≥ 70%, and the verified rate does not rise with payload size.
3. **C1: MCP server and ChatGPT/Claude app.** This is the highest-upside slot, and it is risky. Make it
   read-only, EDGAR/Form D/government data only, with provenance on every value and "Open in YouBank" links.
   No prices from licensed feeds, and no action tools in v1 (which also defers B1). Named risks: commoditised
   EDGAR MCP servers, directory approval timing, and the fact that host-written prose escapes A1. *It worked
   if*, within 30 days of directory listing, ≥ 300 sign-ups are attributed to the connector and ≥ 10% of them
   save a cited artifact in YouBank. If attributed sign-ups stay under about 50, treat it as a free data proxy
   and stop investing.

If any one slot must be swapped for something lower-risk, swap C1 for D2 (onboarding), not for B2.

---

## 4. Must-do items regardless (liability, compliance, correctness)

1. **Campaign mail compliance (F1).** Postal address, in-message opt-out and `List-Unsubscribe` /
   `List-Unsubscribe-Post` on campaign and nurture kinds. *Checked:* `src/lib/crm/send.ts:95` sends without
   them, and the only list-unsubscribe code is inbound detection at `autopilot-rules.ts:174`.
2. **Meeting consent by default (F2).** Per-participant notice on desktop capture, and no silent auto-start.
   *Checked:* `src/lib/meetings/pipeline.ts:68-76` stores only the host's consent; `noticeCopied` is optional
   and auto-start skips the prompt.
3. **2FA (B5)**, required for mailbox connection, broker links and any real-money switch. *Checked:*
   `src/lib/auth/server.ts:51`.
4. **Turn off the unlicensed Nasdaq backup in production (E7, licensing part).** *Checked:*
   `src/lib/market/nasdaq.ts:34-35` defaults to on.
5. **Fail the autopilot trust gate closed.** *Checked:* `src/lib/crm/autopilot.ts:101`.
6. **Make the product's own claims true, or reword them (AI-washing exposure).** "Source link on every figure"
   (`Landing.tsx:110`) is unenforced until A1 ships. "Earns the right to send on its own" (`Landing.tsx:168`)
   is untrue while `learning` scopes can auto-send (`engine.ts:116-118`). Either require certification before
   auto, or change the copy.
7. **Gmail scope decision (F2)** before more than 100 users: budget CASA or ship send-only.
8. **Vercel Pro before charging (F3, that one item).**

---

## 5. Claims that look wrong or overstated

- **Calibrated Claims as a ready asset** (IDEA_REPORT summary): calibrated on synthetic claims (`model.json:9`). Only the deterministic number check transfers.
- **"Anytime-valid autonomy certification"** (BRIEF, B2 premise): the e-process is demotion-only; certification is a repeatedly checked Bayesian bound and is advisory (§0).
- **"A draft auto-sends when confidence is high"** (ai-agents §2.4): wrong; there are many gates (§0).
- **"pricing.ts has none of the 5.5 models"** (ai-agents §5.1): `pricing.ts:24,26` has two of them.
- **"328 tools on EDGAR/XBRL"** (BRIEF, product-ux): 230 prompt recipes plus 99 calculators over 39 data tools; A3's "unlocks breadth" inherits this overstatement.
- **"Spreadsheet agents at 35%"** (IDEA_REPORT, ai-agents): SpreadsheetBench 2's best is Claude Opus 4.6 on a March 2026 board, while the same reports cite Vals EMB at 76.7% for Fable 5.1 in October. 35% describes an older generation, not the current state.
- **Retention 21.1% vs 30.7%** (product-ux): RevenueCat's data covers *mobile subscription apps*, not B2B web prosumer tools. It is directional at best.
- **The Haiku 5.5 "90% cheaper" margin claim** omits the 100K-prompt price tier, thinking on by default and no refusal fallback.
- **"34 candidates"**: the pool lists 38 IDs.
- **Correct, and worth saying so:** the 39-tool count, the 120k truncation, no MCP code, no List-Unsubscribe, `gmail.readonly`, `nextCookies()`-only auth, the 343 `force-dynamic` count, no `manifest.ts`, story `noindex`, and the Haiku 5.5 and Opus 5.5 prices.

---

## 6. What the pool missed

1. **Host-written prose escapes verification.** In C1, YouBank cannot check the figures Claude or ChatGPT writes from its tool results. The "verified numbers, distributed through MCP" thesis needs this stated as a limit.
2. **Free EDGAR MCP servers already exist.** C1's prior_work lists only paid vendors; the commodity competitor is open source.
3. **Licensing of distribution surfaces.** C1 and C3 would put FMP/Nasdaq-derived prices on public pages and into third-party AI hosts. Restrict both to EDGAR, government and YouBank-derived data until the FMP agreement exists.
4. **No activation or retention instrumentation.** There is no product-analytics dependency or event table beyond the AI usage ledger and module logs (`ai_usage`, `studio_events`, `workflow_runs`). Every success metric in D1, D2, C1 and D3 is unmeasurable as things stand. A SQL view over existing tables is enough; no new vendor is needed.
5. **The autopilot fail-open** at `autopilot.ts:101` and the advisory certification. The safety story the pool wants to generalise (B2) has gaps in its home module.
6. **The marketing copy as compliance exposure.** The SEC exam-priority point in data-reg (b)5 is generic; the concrete instances are in `Landing.tsx:110,168`.
