# Idea Report — YouBank frontier research
Run: youbank-frontier-20261031 · Reviewer route: **same-family (provisional)**. No Codex or Gemini CLI or MCP was available, so fresh Claude subagents reviewed using file paths only.
Mode: product and engineering research. `compute: none` for ML experiments. Pilots are cheap feasibility probes against the codebase, not model training.

## Executive summary
Six research tracks (market, AI agents, quant/ML, platform, data and regulation, product/UX) plus a codebase audit
fed 34 deduplicated candidate moves. The research points the same way throughout: the general research layer is being
commoditised by the AI labs (Anthropic finance agents May 2026, ChatGPT for Financial Services Sept 2026) and by data
vendors shipping MCP. Independent benchmarks still put finance agents near 60% (Vals Finance Agent v2) and spreadsheet
agents at 35% (SpreadsheetBench 2). The defensible ground is therefore **verified numbers + follow-through + price**,
distributed where users already are (MCP, ChatGPT/Claude). The codebase audit shows YouBank already built the hard
parts (Edge's Calibrated Claims, hybrid retrieval, e-process autonomy, a trading capability gate) but only inside single
modules. Most of the highest-value moves *generalise what exists* rather than add new surface. Triage and the chosen
roadmap follow below.

## Literature / market landscape (condensed; full reports in `research/`)

| Track | File | Load-bearing findings |
|---|---|---|
| Market | `research/market.md` | Rogo ~$2B (Apr 2026), AlphaSense $7.5B (Jun 2026); Anthropic 10 finance agent templates (5 May 2026); ChatGPT for FS (10 Sep 2026, quote-only); Bloomberg ASKB GA 15 Oct 2026; data vendors all on MCP (FactSet, LSEG 150+ customers, PitchBook, Daloopa, Quartr, S&P); Affinity Ascend agents (Meeting Prep, Warm Intros); price gap between ~$360/mo prosumer and ~$10K+/seat enterprise |
| AI agents | `research/ai-agents.md` | Vals FAB v2 top ~58–61% [mirrors disagree]; SpreadsheetBench 2 best 34.89%, failures = insufficient inspection + wrong target cell (2606.29955); verification ≪ solving cost; tool search native on both APIs (selection degrades >30–50 tools) [V]; Haiku 5.5 $0.10/$0.50 vs Haiku 4.5 $1/$5 [V]; MCP 2026-07-28 stateless spec [V]; CaMeL-style capability separation |
| Quant/ML | `research/quant-ml.md` | TSFMs fail on daily returns (R² < 0); TTM+Log-HAR best for vol; LLM backtests before training cutoff are contaminated (Profit Mirage 2510.07920); boosted trees > LLMs for credit, LLM PDs uncalibrated; Form D "next raise" is an open lane; verbal LLM probabilities overconfident |
| Platform | `research/platform.md` | 0 `"use cache"`, 343 `force-dynamic` (re-verified: 343); React Compiler off; Better Auth `twoFactor`/`mcp`/`organization` plugins installed but unused (only `nextCookies()`, re-verified); Neon Lakebase BM25; Vercel Workflow GA, Queues beta |
| Data/regulation | `research/data-regulation.md` | FDTA joint standards effective 1 Oct 2026 (LEI, CFI); Nasdaq Data AI Policy (AI use licensed separately); PatentsView paused/migrated 20 Mar 2026 (code still calls old host, re-verified; liveness not testable from sandbox); no List-Unsubscribe in code (re-verified); `gmail.readonly` = restricted scope → CASA (re-verified); copy/algo trading → publisher's exclusion or RIA partner |
| Product/UX | `research/product-ux.md` | Agent inbox pattern; AI apps retain 21.1% at 12 mo vs 30.7% non-AI (RevenueCat 2026); trust = source attribution (32%) + error checks (30%); email-agent public failures (OpenClaw, Zoho deal leak); no `/c/[ticker]` pages, published stories noindex, no web manifest; recommendation: narrow the front door |
| Codebase | `research/codebase-audit.md` | Verification, retrieval and evals exist only in Edge; chat sends all 39 tools each turn and cannot reach the 328 workflows; no LLM-quality evals for chat/workflows; no MCP code; no OTel; Sentry not configured |

Structural gaps (where the field and YouBank both fall short):
1. **Numbers are the failure mode.** Every finance benchmark fails on evidence extraction and arithmetic. Nobody ships a per-figure verification guarantee on general chat.
2. **Autonomy is not measured.** Competitors gate agent actions with fixed approval switches. YouBank's e-process certification is statistically grounded but only covers email.
3. **Distribution moved into the assistants.** MCP and ChatGPT apps are where finance users are now, and YouBank has no presence there.
4. **Trust surfaces are thin across the industry.** Benchmarks are vendor-reported and accuracy pages are absent.

## Candidate pool (34; deduped mechanically by core hypothesis; none dropped for taste)
Format: **ID. Title** — lens/source · prior_work · so_what · effort_note

### A. Verified intelligence (AI core)
- **A1. Verify-every-figure pass for chat, workflows, Studio and memos.** Generalise Edge `claims/numbers.ts` and `verify.ts` into `src/lib/ai/verify.ts`, run after each answer, and show a per-answer "verified-figure rate" badge. *method-transfer (Edge→everything); ai-agents #3, market #7, product #8* · prior: Edge Calibrated Claims (in-repo); CiteAudit 2602.23452; Perplexity "auditable financials" · so_what: turns the #1 failure mode into a measured, displayed metric, and the claim stays honest whatever the score turns out to be · effort: M (1–2 wk), the core logic already exists.
- **A2. Calc-by-reference (program-of-thought).** `calc` resolves `S3.revenue`-style references to raw tool payloads, so no figure is retyped. *ai-agents #4* · prior: PoT +12% FinQA (2211.12588), Financial-PoT 2601.21157 · so_what: removes transcription errors by construction · effort: S–M.
- **A3. Tool search over the full catalogue (chat reaches all 328 workflows/calculators).** *scaling-regime; ai-agents #1; audit gap 3* · prior: Anthropic tool search docs [V], OpenAI tool_search namespaces · so_what: unlocks the product's breadth from one chat box and cuts per-turn tokens · effort: M.
- **A4. Finance eval harness (golden set, pass^k, verified-figure rate, nightly Batch API).** *diagnostic; ai-agents #12; audit gap 2* · prior: Vals FAB, FinSearchComp, Beyond pass@1 2603.29231; in-repo Edge evals · so_what: the safety net for every other AI change and the evidence base for a public accuracy page · effort: M.
- **A5. Cheaper-model swap behind the eval gate (Haiku 5.5, Opus 5.5, per-step effort, `lookup` route).** *ai-agents #2, #9* · prior: Anthropic pricing [V]; FinSearchComp thinking −7pts on lookups · so_what: about 90% less list cost on background tasks, which changes the pricing margins in `docs/pricing.md` · effort: S (after A4).
- **A6. Lossless context + programmatic tool calling for long runs.** *ai-agents #7, #8* · prior: ARC 2607.25066, Memex; Anthropic context editing [V] · so_what: deep runs and Studio builds get cheaper without losing evidence · effort: M.
- **A7. Asymmetric verifier for deep research.** *ai-agents #5* · prior: Multi-Agent Verification (ICLR 2025); asymmetric verification [UNVERIFIED id] · so_what: buys accuracy cheaper than more search turns · effort: M.
- **A8. Studio inspect-before-write / verify-after-write protocol.** *ai-agents #14* · prior: SpreadsheetBench 2 failure taxonomy · so_what: targets the dominant spreadsheet-agent failure; Studio is the flagship demo · effort: S–M.
- **A9. Generative answer components (typed comps table, football field, filing excerpt) reusable as MCP App views.** *product #7* · prior: MCP Apps standard, CopilotKit · so_what: answers become actions (export, add to Studio) · effort: M.

### B. Trusted autonomy and safety
- **B1. Shared capability/taint policy (CaMeL-lite) for every acting agent.** Generalise `src/lib/algo/agent-gate.ts` to `src/lib/ai/policy.ts`, covering email, Studio, MCP and trading. *method-transfer; ai-agents #10* · prior: CaMeL 2503.18813; privilege separation 0% ASR 2603.13424 · so_what: prompt injection through email, filings or the web becomes structurally contained · effort: M.
- **B2. Earned-autonomy everywhere: extend the e-process certification + conformal risk control from email to Studio writes, campaign sends, MCP actions and paper→live trading.** *method-transfer + untested-assumption ("fixed approval switches are enough")* · prior: in-repo crm/engine.ts; "Judge, Retrieve, or Abstain" 2608.17994; Trust or Escalate 2407.18370 · so_what: a statistically certified autonomy ladder that no competitor has, and the best answer to FINRA-style "human checkpoints" · effort: M–L.
- **B3. Confidential-deal outbound guard + 10-minute undo window + plain-English action log.** *product #9, #10; data-reg #7* · prior: Zoho deal-leak incident; OpenClaw incident · so_what: prevents the incident class that kills trust in email agents · effort: S–M.
- **B4. Compliance-grade agent action ledger (exportable; hard/soft gates; approver; taint state).** *market #12; ai-agents #11* · prior: Rogo Felix audit trail; FINRA 2026 report · so_what: unblocks Deal Team and Enterprise sales and SOC 2 · effort: M.
- **B5. Two-factor auth (installed plugin) + passkeys, required for broker connections and live trading.** *platform #2* · prior: Better Auth twoFactor installed · so_what: table stakes for anything that touches money · effort: S.

### C. Distribution and growth
- **C1. Remote MCP server + ChatGPT/Claude app (stateless 2026-07-28 spec, `input_required` confirmations, MCP Apps views, free cited-filings tier).** *market #1, platform #4, ai-agents #13, product #6* · prior: every data vendor ships MCP; README roadmap · so_what: an acquisition channel where finance users already work; YouBank's free-data provenance is the differentiator · effort: M–L.
- **C2. Bring-your-own-licence MCP client (attach your firm's FactSet, PitchBook, Daloopa or Quartr MCP to YouBank's agent).** *market #9, data-reg (a)4* · prior: ASKB BYO; vendor MCPs need the customer's licence · so_what: YouBank becomes the workflow layer over licensed data with no redistribution cost · effort: M.
- **C3. Public `/c/[ticker]` company pages + indexable shareable artifacts with "Remix in YouBank".** *product #4, #5* · prior: Investing.com programmatic SEO; Google March 2026 thin-content action · so_what: organic acquisition built on free data · effort: M.
- **C4. "Email the desk": forward a CIM, 10-K or list to a YouBank address and get back a memo, comps and a Studio link.** *market #2* · prior: Rogo Felix by email · so_what: the lowest-friction agent surface for bankers · effort: M.
- **C5. Campus programme: interview "explain and defend this model" drills, a certificate and club chapters.** *market #11, product #13* · prior: Bloomberg certificates, WSP chapters · so_what: the distribution engine for the student segment · effort: M.
- **C6. Activation-triggered referral credits.** *product #14* · effort: S.
- **C7. Public accuracy/trust page backed by A4 and benchmark-routed models.** *market #6, product #15* · prior: vendor-only benchmarks industry-wide · so_what: answers SEC "AI-washing" scrutiny and builds buyer trust at once · effort: S after A4.

### D. Product shape and UX
- **D1. Desk inbox: one queue of proposed actions from all agents (CRM review, autopilot holds, alerts, meeting follow-ups, thesis triggers).** *product #1* · prior: LangChain agent inbox, Linear, Superhuman (60% unedited, company-reported) · so_what: the daily habit loop and the surface for B2 · effort: M.
- **D2. Onboarding to a cited first deliverable in under 2 minutes (role + one ticker → tear sheet + comps).** *product #2* · prior: RevenueCat Day-0 conversion · effort: S–M.
- **D3. Narrow the front door: lead with research → outreach; move Quant, 13F copy, algo and crypto to Labs.** *product #15; untested-assumption ("breadth is a moat")* · prior: Rogo and Harvey focus · so_what: focus for activation · effort: S.
- **D4. Morning brief + PWA manifest + push, with each card ending in a proposed action.** *product #3* · effort: S–M.
- **D5. Cost preview before expensive runs; outcome-priced add-on pilot.** *product #11, #12* · effort: S / M.
- **D6. Always-on coverage agent: diff each new 10-Q/8-K/Form 4, score the change, drop a one-slide update into Studio and the brief.** *market #4; overlaps quant #3* · effort: M.
- **D7. Relationship agents: warm-intro path finder over the team mail graph + contact hygiene.** *market #3* · prior: Affinity Ascend · effort: M.

### E. Quant, data and models
- **E1. Filing-change detector (Lazy Prices, Q8 DIFF), point-in-time.** *quant #3* · prior: Cohen–Malloy–Nguyen; ChronoBERT · effort: M.
- **E2. LLM contamination guard (model-cutoff registry + memorisation probe) in the backtest integrity checker; paper-sleeve league for agent strategies.** *contradiction (agent-trading hype vs results); quant #2, #15* · prior: Profit Mirage, StockBench, FINSABER · effort: S–M.
- **E3. HAR-RV / Log-HAR + TTM vol ensemble with skill shown on screen; adaptive conformal intervals.** *quant #1, #13* · effort: S–M.
- **E4. Form D "next raise" hazard model.** *quant #9 (open lane)* · prior: none academic found; FilingFlow vendor · effort: M.
- **E5. Calibrate every AI probability (forecast ledger isotonic + market comparison); typed LLM event features feeding Deal Radar.** *quant #7, #14* · effort: M.
- **E6. Identity layer: GLEIF LEI + parents, FIGI as instrument key, Companies House.** *data-reg (a)2,3,7; FDTA* · effort: M.
- **E7. Data-source hygiene: fix PatentsView (USPTO ODP), IEX delayed instead of Nasdaq scrape, `aiUse` licence field read by `forModel()`, WARN 50-state.** *data-reg (a)1,5,8,10* · effort: S each.

### F. Compliance and platform must-dos (gates rather than features; listed so triage can rank urgency)
- **F1. Campaign email compliance: List-Unsubscribe + One-Click (RFC 8058), postal address, SPF/DKIM/DMARC pre-checks.** *data-reg (b)1* · effort: S.
- **F2. Gmail scope strategy (send-only sensitive scope or a CASA budget); meeting-bot consent by default; copy/algo kept impersonal until counsel decides.** *data-reg (b)2,3,6* · effort: S–M.
- **F3. Platform: React Compiler, OTel spans per model/tool call, Vercel Pro + retire Neon relays, Cache Components phase 1, Playwright CI.** *platform #1,5,6,8,9* · effort: S→L.

## Triage (reviewer)
See `traces/triage/round1.md`. Filled in after the review.

## Novelty
See `traces/novelty/`. Filled in after the review.

## Pilots (feasibility probes)
Filled in after triage.

## Chosen roadmap
Filled in after triage and probes.
