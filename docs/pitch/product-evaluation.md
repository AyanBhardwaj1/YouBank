# YouBank for funds: product evaluation (Nov 6, 2026)

This is an honest look at YouBank as a startup selling to small hedge funds. It covers who the product is for, why they would pay, where it is strong, where it is weak, and what this round of work changed because of it. It is written to be argued with before the pitch, not to be shown to investors as-is.

## 1. The customer and the job

**Who it is for.** Funds with 2–20 people and roughly $50M–$1B of AUM: a PM or two, an analyst, and a COO who doubles as the compliance officer. They have no in-house risk system, no data team and no IT team. They already pay for a terminal or data seat, and every analyst uses ChatGPT or Claude.

**Their jobs, in their words:**
1. "Tell me when one of my theses is breaking, before the price does."
2. "Let me use AI on my book without a compliance problem."
3. "Give me something to show LPs that proves we have a process."
4. "Don't make me learn another terminal."

## 2. What YouBank says, and whether the product backs it

| Promise | Backed by | Verdict |
|---|---|---|
| Every thesis held to its numbers | Kill criteria checked against SEC XBRL and prices after every close, with headroom, history, alerts and the next report's revenue bar | Strong and unusual. No competitor we found sells accountability for theses. |
| Risk a small fund doesn't have | Beta-adjusted net, historical VaR and ES, stacked bets, five stress replays, a pre-trade what-if, risk per team member | Good for the segment. It is historical, not a factor model, and the product says so. |
| AI inside the apps you already use | An MCP server with 21 tools and 6 prompts, OAuth so one URL connects, proposals the PM approves, a pause switch per app | Ahead of the market on control. It needs a live test with Claude.ai and ChatGPT before the pitch. |
| Every AI answer on the record | A hash-chained ledger anchored outside YouBank, reviews, a governance report, the AI-use line in the LP report | Strong. It is the best answer to "how do you supervise AI?" from a DDQ. |
| A track record of process | The track record (hit rate, payoff, exit discipline, the cost of holding past a break, process against outcome) and calibration (Brier scores, a correction once 20 forecasts resolve), with forecasts that can't be backdated, farmed or withdrawn | New this round. It is the piece LPs ask for, and it builds itself as positions close. Integrity matters more than features here: two reviews found ways to game it, now closed. |
| An AI committee, kept score | Independent bull and bear briefs, three pooled chairs, a 90-day forecast scored beside the PM's, run in the background with a bell | New this round. Its value is only provable over months of resolved forecasts; until then it is a structured second opinion. |
| Investor writing that passes compliance | LP letter and DDQ drafted from the record; a deterministic pass for Marketing Rule language, AI claims checked against the ledger, and figures checked against the filings | New this round. It turns the ledger into something the COO uses every quarter. |

## 3. Strengths, from an investor's point of view

- **One story, three proofs.** "We hold theses to their numbers, we let AI help under control, and we can show it." The Book, MCP and the ledger each prove one third of it, and they feed each other. For example, an AI app proposes a position, the proposal is scored for calibration, and the call is in the ledger.
- **Low data cost.** Everything runs on SEC EDGAR, free price feeds and the customer's own AI app. Gross margins can stay software-like.
- **Distribution through AI apps.** As an MCP server, YouBank lives inside Claude and ChatGPT. That rides the shift that FactSet, Bloomberg (ASKB) and others are making, without competing with them on data.
- **Timing with regulators.** The SEC's 2026 exam priorities and FINRA's 2026 oversight report both focus on what firms say about AI and how they supervise it (see §6). The ledger and the per-app guardrails map directly onto that.

## 4. Weaknesses and risks, said plainly

1. **Breadth dilutes the pitch.** YouBank also has a CRM, Studio decks, a newsroom, copy-trading, 13F clones and a desktop app. For a fund buyer that reads as unfocused. *Mitigation:* the fund role already pins the Book. This round made the Book and an AI app the first steps of Home's checklist for fund roles. The pitch should lead with the Book and treat the rest as "also included".
2. **Demo risk from live data.** The Book's "aha" moments (verdicts, risk, the next report) need SEC and price data. If EDGAR is slow during the pitch, the sample book reads "No data". *Mitigation:* risk is now warmed when the Book loads and after each close, but run the demo on an account whose book was warmed that morning.
3. **No audited performance and no OMS link.** Positions are entered by hand and returns are unweighted price moves. This is fine for process evidence, but an LP must never read it as a track record of returns. The UI and report say "not audited performance".
4. **AI features untested against a live model in this environment.** Drafting, the red team and the AI apps' end of MCP have only been exercised through the SDK and stubs here. Test them live before the pitch.
5. **Single founder, wide surface.** Breadth means many places to break. 48 test suites and a 40-check end-to-end run help, but the fund surface is what must be flawless.
6. **The moat is process, not data.** A large vendor could copy kill criteria. The defensible parts are the accumulating ledger, calibration and track record per customer (switching cost) and being the controlled AI layer over the customer's book.

## 5. A UX walkthrough as a new fund user (findings, then fixes)

| Step | Found | Done |
|---|---|---|
| First visit to Home | "Getting started" asked for mail, calendar, 2FA and a style, but never the Book | For fund roles, the first two steps are now "Put your book in" and "Connect an AI app" |
| Empty Book | Clear: add one, paste a sheet, or try the sample | Kept |
| Editing a position | Kill-criterion rows stacked every control full width | Fixed earlier today: one row each |
| Risk panel | Faint text failed WCAG AA contrast | Fixed: axe now reports no violations on the new screens |
| Closing a position | It vanished, with no record and no reason | It now closes into the track record, with exit, reason and note |
| Conviction | No way to say how sure we are, or to learn from it | Conviction plus scored calibration, with a break before the forecast never counting against it |
| AI app access | All or nothing: revoke the key | Pause, keep from the Book, or keep from proposing, each noted in the ledger |
| The committee | It blocked the page for three minutes and was lost if you left | It sits in the background; the bell says when it is done; a split of chairs reads as close |
| The sample book | No forecasts, so calibration and sizing looked empty in a demo | Sample forecasts (labelled, never scored) make the sizing note appear at once |
| Track record | One position could read both "exited late" and "sound process" | One rule: only a break still in force at the close, timed from its start |
| A data source down | Some screens said "something went wrong on our side" (a 500) | A 503 that says a data source is not answering, for every route |
| Weekly habit | Nothing to open when no alert fired | "The week in your book": changes, resolved forecasts, committee calls, the next two weeks |

## 6. What the research says to build (Nov 2026)

A research pass (via web search; sec.gov and arxiv.org were blocked here, so most sources are confirmed only through search summaries) ranked these. ✓ marks shipped in this PR.

1. **A thesis forecast ledger with Brier scores.** ✓ Calibration (this round). LLM forecasters are reported near superforecaster level on ForecastBench, e.g. the Bridgewater AIA Forecaster (https://arxiv.org/html/2511.07678v1). YouBank sets the PM's calibration beside the AI's.
2. **Claim-level verification of AI answers.** Partly there: every figure is checked against the source it cites. Next: a per-answer "share of claims verified" stored in the ledger. On finance-agent benchmarks, top models still score about half (https://arxiv.org/abs/2508.00828), so a measured error rate sells.
3. **Guardrails for agents.** ✓ Per-app pause and scopes (this round). FINRA's 2026 report names agents acting beyond their mandate as a risk (summary: https://www.debevoise.com/insights/publications/2025/12/finras-2026-regulatory-oversight-report-continued). A proposal card inside the AI app via MCP Apps ✓ (this round; https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/). Next: a listing in the MCP Registry.
4. **A point-in-time "honest replay".** Re-run a thesis check as of a past date using only filings accepted by then, to avoid look-ahead bias (https://www.nber.org/papers/w35247). Feasible on EDGAR's acceptance timestamps.
5. **A structured investment committee.** ✓ (this round). A bull and a bear write sourced briefs alone and in parallel; a chair decides add, hold, trim or exit, records the dissent and gives a 90-day forecast that is scored beside the PM's. Independent briefs rather than a debate, because debating agents drift to a shared consensus (see the Okawa note in hedge-funds.md).
6. **An exam-readiness pack and AI-washing check.** The AI-washing check on letters ✓ (this round). It turns the ledger into the binder an examiner asks for, and checks a deck or letter's AI claims against it. The SEC's FY2026 priorities focus on the accuracy of AI claims (summary: https://www.debevoise.com/insights/publications/2025/11/2026-sec-division-of-examinations-priorities).
7. **A DDQ drafter and an investor-letter drafter.** Both ✓ (this round). They write from the Book, the track record and the ledger, with a Marketing Rule check.
8. **Earnings-call "say-do" tracking.** Needs transcripts, which EDGAR doesn't carry.

## 7. Metrics that would prove it works

- **Activation:** a book with at least 3 positions and kill criteria within the first session; an AI app connected within the first week.
- **Habit:** opening the Book after an alert (alert → open rate); weekly active PMs; the week report opened on Mondays.
- **Proof:** positions closed into the track record; forecasts resolved (and the share of positions carrying one); committee sittings; governance reports and DDQ pages printed.
- **Trust:** the share of AI figures verified; proposals approved versus dismissed per app.

## 8. Next, in order

1. Test MCP sign-in, proposals and the pre-trade prompt live in Claude.ai and ChatGPT on the preview.
2. ✓ The per-answer figure check is now summed in the governance report and the LP letter.
3. ✓ A proposal card inside the AI app (MCP Apps). Still to do: a registry listing, and a live test of the card in Claude and ChatGPT.
4. A point-in-time replay of a thesis.
5. ✓ The investor-letter drafter with a Marketing Rule pass.
6. ✓ A DDQ drafter that answers the standard AI questions from the ledger.
7. Adopt the MCP 2026-07-28 spec once final (stateless core, tasks for long runs such as the committee, a confirmation step for proposals), seen so far only as a release candidate.
8. Verification against XBRL for any figure, not only the Book's criteria metrics, using the full company facts.
9. A point-in-time replay, and a live check of every AI path on the preview with a real key.
