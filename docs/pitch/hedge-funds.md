# YouBank for hedge funds: what is new, and why it matters

Written November 2026 for a pitch to small hedge-fund managers. It covers what the market research says, what was built in response, how to demo it in about ten minutes, and what it does not do yet. Every outside claim links to its source. Figures we could not confirm are marked as such.

## 1. What the research says

**Nearly every fund uses AI, but few can show what it did.**
- In AIMA's generative-AI research, written up by Marex in December 2025, 95% of hedge funds surveyed already use the technology in some form, up from 86% in 2023 ([Marex](https://www.marex.com/news/2025/12/generative-ai-in-hedge-funds-from-experimentation-to-everyday-use/), [Markets Media](https://marketsmedia.com/86-of-hedge-funds-give-staff-access-to-gen-ai-tools)).
- The 2026 AIMA/Marex emerging-manager survey (180 managers, 50 investors) says AI is "increasingly embedded" across emerging managers ([AIMA](https://www.aima.org/article/stacking-up-emerging-managers-2026.html), [Marex](https://www.marex.com/news/2026/06/emerging-manager-survey-2026-hedge-funds)).
- The payoff is uneven. Academic work finds that hedge funds adopting generative AI earn roughly 2–4% higher annualised abnormal returns. Smaller, younger and less active funds show no significant gain ([Rutgers working paper](https://www.business.rutgers.edu/sites/default/files/documents/generative-ai-and-asset-management.pdf)).
- *Our read:* small funds are the ones not yet getting value from AI. The gap is workflow, not access to a model.

**Research is spread across too many vendors.**
- In a Bloomberg survey, half of respondents named managing multiple vendors as the main obstacle to scaling programmatic research. Another 44% named cutting platform complexity and cost as their top goal for the next 12–24 months ([Bloomberg Professional](https://www.bloomberg.com/professional/?p=134651)).

**AI tools are moving into the analyst's own AI app, through MCP.**
- FactSet launched what it called the industry's first production-grade MCP server in December 2025 ([FactSet](https://investor.factset.com/news-releases/news-release-details/factset-meets-demand-ai-ready-data-first-announce-mcp-sans)).
- M Science launched an MCP server for institutional clients on 2 June 2026 ([Barchart / Business Wire](https://www.barchart.com/story/news/2256147/m-science-launches-unified-data-model-and-mcp-server-to-power-data-first-ai-workflows-for-institutional-investors)).
- Intrinio followed in June 2026 ([Intrinio](https://intrinio.com/blog/what-is-a-financial-data-mcp-server)).
- Funds increasingly expect research to come to the tools they already use: Claude, ChatGPT, Cursor and in-house agents ([Dakota](https://www.dakota.com/reports-blog/the-mcp-server-is-the-future-of-the-data-feed)).

**Compliance applies to AI output too.**
- Advisers Act Rule 204-2 requires true, accurate and current books and records. AI does not change that duty, but it does raise the question of what must be kept, and in what form ([Troutman Pepper](https://www.troutman.com/insights/ai-heightens-old-compliance-risks-for-investment-advisers/), [eCFR 275.204-2](https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.204-2)).
- Practitioner guidance increasingly says to keep the prompt, the output and the human reviewer's sign-off ([JD Supra on AI notetakers](https://www.jdsupra.com/legalnews/ai-notetakers-and-the-books-and-records-5396585/)). That is guidance, not rule text.
- FINRA's 2026 oversight report has a generative-AI section. We have not reviewed its recordkeeping language directly.

**Agents that debate drift toward a shared, often biased answer.**
- Okawa (ICML 2026) shows that multi-agent LLM debates converge on collective, often biased norms. The settings tested include investment recommendations. Mixing agents with different behaviours reduces this lock-in ([PMLR](https://proceedings.mlr.press/v306/okawa26a.html)).
- *Our read:* the case against a position should come from an adversary working alone, not from a negotiated consensus.

## 2. What YouBank does about it

Three new capabilities, each a direct answer to a finding above, all live in the app on this branch.

### The Book: theses that can be proved wrong, checked automatically (`/app/book`)

- **What it is.** A fund enters its positions: ticker, long or short, weight as % of NAV, and entry price. Each position has a one-line thesis, its pillars, and **kill criteria**: the numbers that would prove the thesis wrong. Examples: revenue growth at least 20%, gross margin at least 70%, a price level, or a stop-loss from entry ("out if it falls 15% from where we bought", measured in the position's favour, so it works for shorts).
- **Checked on every load, against primary sources.** Each criterion is checked against the company's SEC XBRL filings and the price. YouBank shows the figure, its period and a link to the source. The thesis then reads *intact*, *on watch* (within 3 points of a percentage threshold, or 10% of any other) or *broken*, with the most urgent first. This costs no AI.
- **The book at a glance.** Gross, net, long and short exposure; how much of NAV sits in a thesis that is broken or on watch; P&L since entry; the headroom to every kill criterion ("+4.7 pts", "−3.2 pts"); how long each verdict has held; the next earnings date and other dated catalysts; and this week's news for each name.
- **Concentration.** Exposure by industry (long, short and net), so it is visible when a book is one sector bet.
- **Risk and stress tests.** From a year of daily closes and today's weights:
  - beta-adjusted net exposure, so a fall of 10% in the S&P 500 reads as a % of NAV;
  - volatility, and a one-day 95% value at risk and expected shortfall, taken from the book's own history rather than a normal curve;
  - each name's share of the book's risk, where a hedge shows as a negative share;
  - pairs that move together: two longs that are one bet in two tickets, or a short that really hedges a long;
  - today's book replayed through the COVID crash, the 2022 rate shock, SVB, the 2024 yen carry unwind and the April 2025 tariff shock, each name with its own move. A name that was not trading then is listed as left out, never counted as flat.
- **Before a trade.** Type a ticker, a side and a weight to see the book's beta, VaR and worst replay now and after the trade, plus which holdings the name moves with. That answers "is this a new idea or a second ticket on a bet we already have?" The same check runs on every position an AI app proposes, and over MCP (`book_risk` with `what_if`).
- **What the next report must show.** For a revenue criterion, YouBank works out the revenue the coming quarter needs for the criterion to hold once that quarter enters the twelve months. For example: "At least $1,140M next quarter (+14% y/y; last quarter +21%) keeps LTM growth at or above 20%." It comes from the last eight quarters on SEC XBRL and is said only when those quarters add up to the reported LTM. It appears on the position, in the day-before-earnings alert and in the report.
- **New filings, read for you.** When a held company files a 10-Q or 10-K, YouBank compares its risk factors with the previous filing and says what was added, removed or reworded. It shows on the position, and its holders get one alert.
- **Dates in your own calendar.** "Calendar" downloads every earnings date and catalyst in the book as an .ics file for Outlook, Google or Apple Calendar. Each event carries the thesis's state, what the report must show and a link back to the position.
- **The LP letter, drafted and checked.** "LP letter" drafts the quarter's letter from the Book: the book, theses under pressure, what closed and why, the track record, calibration, risk and how AI was used, all for the PM to rewrite. A compliance pass re-reads every edit for what the Marketing Rule and SEC exam staff look for: promises, superlatives, performance without a period, gross without net, hypothetical results, and AI claims the ledger can't back ("AI-washing"). A claim about how AI is supervised is checked against the ledger itself: "every AI output is reviewed" when the record shows 12% is flagged, as is "99% of figures verified" when it shows 91%. The SEC's 2026 exam priorities say staff will compare AI disclosures with what firms actually do. Figures written about a holding are checked against its filing too: "Snowflake's gross margin reached 75%" when XBRL shows 66.8% is flagged with the source, since finance-agent benchmarks find invented-but-plausible numbers are the common failure (Vals AI Finance Agent; FinGround, https://arxiv.org/abs/2604.23588, seen in a search summary). It is rule-based, deterministic, and labelled as a first read, not legal advice.
- **A report to hand over.** A printable one-pager for an investment committee or an LP letter: exposure, then every thesis with its evidence and the red team's case.
- **Red team.** One click runs an agent briefed as a short seller (or as a bull, for a short). It makes the strongest sourced case against the thesis, names the weakest pillar, and lists the signals that would prove the thesis wrong. It works alone, by design (see Okawa, above).
- **AI investment committee.** One click convenes a bull and a bear, who each write a sourced brief alone and in parallel. A chair then reads both against the kill criteria and recommends add, hold, trim or exit, with the strongest dissent and up to three signals to watch. The chair's 90-day forecast is scored in the track record beside the PM's own, so the fund learns whose calibration is better. Three chairs sit independently and are pooled in log-odds, with the majority's decision, because an ensemble of LLM forecasts is better calibrated than one (Schoenegger et al., "Wisdom of the Silicon Crowd", Science Advances 2024, https://arxiv.org/abs/2402.19379); the card shows their spread, so a split call reads as close. Advice only: nothing in the Book changes, and every sitting is kept in the research ledger.
- **AI due-diligence answers.** Nine questions LPs and consultants ask about AI (use, models and vendors, human review, accuracy, measuring AI's contribution, records, controls on AI apps, confidential data, governance), each answered from the research ledger, the AI-app permissions and the calibration record. What only the firm can say is left in brackets, a broken chain or a mismatched anchor is flagged rather than stated, and the letter's compliance pass reads every edit (`/report/ddq`).
- **Honest calibration.** Any position can carry a forecast ("70% that no kill criterion fails before 1 February"), from the PM, an AI app or the committee. YouBank resolves each one from the thesis's daily history and scores it with the Brier score. A forecast is stamped with the day it was made and must resolve after it, so it cannot be backdated over a known past. A forecast changed or removed on a later day stays scored at its own date, so a call going wrong cannot be quietly withdrawn. Once a forecaster has 20 resolved forecasts, a Platt correction fitted to their own record says what their stated chance has meant ("your 80% has behaved like 64%"); frontier models are reported to be overconfident, more so at high confidence (KalshiBench, https://arxiv.org/abs/2512.16030; seen in a search summary only).
- **Process checks.** The track record separates process from outcome: a win taken after holding a broken thesis counts as luck, a loss after a prompt exit as bad luck. Under the exposure strip, a sizing check flags a book whose biggest positions carry its lowest conviction (rank correlation of weight against forecast).
- **A base rate beside every price forecast.** For a position whose kill criteria include a price line (a floor, a ceiling or a stop from entry), the card shows the chance the price never touches it before the forecast's date, from the stock's own one-year volatility (a driftless random walk, reflection principle, with the continuity correction for daily checks; it matches a 20,000-path simulation within noise). Reference-class forecasting: start from the base rate, then adjust. It covers price lines only and says so.
- **A decision journal.** Each position keeps a dated record of why: YouBank writes an entry itself whenever the weight, the forecast, the kill criteria, the thesis or the side changes, and the PM adds notes ("added after the call: margins guided up"). It is written by the server, so it cannot be backfilled once the outcome is known, and it is kept through the close. LPs ask how decisions were made; this is the answer in the PM's own words, at the time.
- **A proposal card inside the AI app.** With MCP Apps (supported by Claude and ChatGPT since January 2026), a proposed position shows in the conversation as a card: the thesis, each kill criterion checked now, and "Review in YouBank". The card runs sandboxed with no network access and cannot approve anything; apps without MCP Apps get the same facts as text.
- **The week in your book.** A one-page Monday read (`/report/week`): theses that changed verdict and when, forecasts that resolved, what the AI committee said, what closed, the next two weeks' earnings and catalysts, and proposals waiting. A reason to open YouBank every week, even when no alert fired.
- **Always on.** Every weekday after the US close, YouBank re-checks every book. It tells the person the moment a thesis breaks (urgent, even in quiet hours), comes close to a kill criterion, or holds again, and when a catalyst is a day away. Alerts go to the bell, Home's "Waiting for you" and the person's own push, Slack or email. Each alert opens the position it is about.
- **For the whole team.** Each member chooses whether to share their book with their team. The team view (read-only) shows every shared position with its owner, each member's exposure, and any name one member holds long while another is short.
- **Say it in plain words.** "Long Snowflake: growth back above 20%, gross margin past 70%, out below $150" becomes a position with three kill criteria to check and change before saving. Thresholds the AI chose itself are marked "suggested", and the output passes the same validation as any saved position.
- **In minutes, not an afternoon.** Paste rows from a spreadsheet or an OMS export, in any column order. Each position starts with sensible kill criteria. For a demo, "Try a sample book" loads five well-known names.
- **Agents propose, the PM decides.** A connected AI app (Claude, ChatGPT, an in-house agent) can propose a position with its thesis, kill criteria and reasoning (`propose_position`). It lands on the Book page marked with the app that sent it, and nothing enters the book until the person reviews it in the editor and saves it. The proposal and the reasoning behind it are in the research ledger.
- **Why it is different.** Research tools answer questions and agents investigate. The Book holds the fund to what it said it believed, and flags the moment the numbers say otherwise. Templates (growth, compounder, value, short) take a new user from nothing to a monitored book in minutes. Multi-day agent investigations remain in Edge → Theses.

### YouBank inside the fund's own AI apps: an MCP server (`/api/mcp`, Settings → Connect AI apps)

- **What it offers.** Twenty-two tools over the Model Context Protocol, twenty-one of them read-only, (Streamable HTTP, versions 2025-03-26 through 2025-11-25):
  - SEC XBRL fundamentals and comps;
  - filing search and reading, EDGAR full text and recent filings;
  - XBRL time series and insider transactions;
  - "what changed in the 10-K";
  - Form D raises and startups;
  - a calculator and news for a ticker;
  - the person's **Book**, with every thesis checked;
  - `check_thesis`: any kill criteria checked against filings and the price on demand, without saving.
  - `book_risk`: the book's beta, VaR, stacked bets and stress replays;
  - `book_track_record`: the scorecard, process against outcome, and calibration by who forecast;
  - `book_week`: the last seven days of the book (verdict changes, resolved forecasts, the next two weeks);
  - `compliance_check`: the LP letter's compliance pass on any text the AI app drafts for investors, with AI claims checked against the ledger and figures against the filings;
  - `propose_position`: the one tool that writes, and all it writes is a proposal for the person to review (MCP marks it not read-only and not destructive).
- **Ready-made prompts.** *Review my book*, *Argue against a position*, *Investment committee*, *Draft LP commentary* (drafted, then run through `compliance_check`), *What changed in the latest filing*, *Earnings prep* and *Pre-trade check* (kill criteria, the risk what-if, the latest filing and insiders, then go or no-go, and a proposal if you say go) appear in the AI app's slash or prompt menu. Each tells the model which YouBank tools to use and to cite every figure.
- **Every figure is cited.** Each result carries source ids with links, so an answer written in Claude or ChatGPT can be checked like one written in YouBank. This answers vendor sprawl: one subscription, used from wherever the analyst already works.
- **One URL to connect.** Claude and ChatGPT custom connectors take just the server address. YouBank implements the MCP authorization flow: OAuth 2.1 with PKCE, Protected Resource Metadata, and both Client ID Metadata Documents and Dynamic Client Registration, for public and confidential clients. The person approves the app on a YouBank consent page, and the app receives its own revocable key.
- **Guardrails per app.** Each connected app can be paused at once (every call refused), kept from the Book, or kept from proposing positions, in Settings → Connect AI apps. Tools an app may not use are neither listed nor callable, and every change is written to the research ledger. That is the "limit what an agent can do, and watch it" control FINRA's 2026 oversight report asks of firms using AI agents.
- **Keys.** Per-person keys (up to ten, including connected apps') are shown once and stored only as a SHA-256 hash. Each key is named for the app it serves and can be revoked. Calls are limited to 600 an hour.
- **Set-up.** Ready-made set-up for Claude Code, mcpServers-file apps (Claude Desktop, Cursor, Windsurf), mcp-remote, and plain HTTP.
- **Tested.** Verified with the official MCP TypeScript SDK client (v1.32.2), which negotiated protocol 2025-11-25.

### A research ledger: AI governance a compliance officer can check (Settings → Research ledger)

- **What it records.** When it is on, every AI answer written for the person is appended with the prompt, model, sources and figure-check summary. That covers chat, deep research, workflows, red teams, desktop questions and background agents. Every call their AI apps make over MCP is recorded too.
- **Tamper-evident.** Each entry's SHA-256 hash covers its content and the hash of the entry before it. Editing, removing or reordering any entry breaks the chain, and "Check the chain" says exactly which entry broke.
- **Human review.** A reviewer can approve, reject or note any entry. The review is written as its own entry, so the record stays append-only.
- **Anchored outside YouBank.** The chain's latest hash can be kept where YouBank cannot change it: emailed automatically every day it moves (to the person, and to their compliance desk if they choose), kept in a compliance file, or notarized on Base from the person's own wallet. Pasting a saved line back proves that every entry up to it is unchanged. We tested the scenario this exists for: an operator rewrote one entry and recomputed every later hash. The chain alone still verified, and both kinds of anchor caught it.
- **Checkable without YouBank.** The export (JSON Lines) states the recipe for re-checking the chain without YouBank's code. The test suite proves that the recipe works on its own.
- **A report for compliance and DDQs.** "Governance report" prints a month (or the last 30 days) on one page:
  - whether the chain and every outside anchor still check, as of now;
  - when recording was off;
  - how much AI output there was, by kind, model, connected AI app and tool;
  - how much of it cites sources;
  - what share a person reviewed, and each rejection with its reviewer and reason.

  It uses metadata only, never the prompts or answers.
- **Why it matters.** Funds can now show *what the AI said, from which sources, and who signed off*. That is the evidence Rule 204-2 and current practitioner guidance point towards, and it is what makes AI use defensible to LPs and examiners.

### What was already in YouBank, and still matters for this pitch

- Answers cite every figure, and a figure check matches each number to the source it cites.
- Edge offers alternative data, agent-run multi-day theses, Deal Radar, Call Desk and a track record.
- Quant covers factors, risk, backtest integrity checks, sizing and costs.
- Also in the product: 13F fund copies, algorithmic paper trading behind step-up 2FA, the Newsroom, Studio models and decks, the CRM, and the desktop and Office apps.

## 3. A twelve-minute demo

1. **Home.** A markets user sees the Book widget: "1 broken · 1 on watch · 7.5% of NAV at risk", and the alert that came in after yesterday's close.
2. **The Book.**
   - Paste three rows from a spreadsheet, or press "Try a sample book".
   - Add a position from the *High-growth software* template and watch it check against the filings at once.
   - Open the broken one and show the failed criterion, the figure, its period, the headroom (how far past the line), and the link to the XBRL facts.
   - Point at "By industry" (the book's real sector bet) and at any "New 10-Q" card: what changed in the risk factors, read the evening it was filed.
   - Write a position in plain words ("Long Costco: comps hold above 5%, insiders not selling more than $20M") and press "Draft it".
   - Open "Risk and stress tests": the beta-adjusted net, the one-day VaR, the two longs that are really one bet, and what today's book would have lost in the COVID crash and the 2022 rate shock.
   - Under "Before a trade", try a long in a name that rhymes with one already held (AMD next to NVDA). Watch beta and VaR rise, and YouBank say it is more of the same bet.
   - On a name reporting soon, point at "What the next report must show": the revenue number to watch on the call.
   - Run the red team. While it works, point at the exposure strip.
   - Give the broken position a forecast ("70% that no kill criterion fails before February"), then press "Convene the committee". It takes two or three minutes, so start it early. A bull and a bear write alone, and the chair says trim, with the dissent and three signals to watch. Point out that its forecast will be scored against the PM's.
   - Open "Track record": process against outcome (a lucky win counts as luck), and calibration by who forecast. If the biggest position carries the lowest conviction, the note under the exposure strip already says so.
3. **Writing for LPs.**
   - From "Share & export", open "LP letter". Type "We guarantee strong returns. Every AI output is reviewed by a person. Snowflake's gross margin reached 75%." and watch the compliance pass flag all three: the promise, the AI claim the ledger contradicts, and the figure the filing contradicts (with the filing's number).
   - Open "The week in your book": the Monday read. Point out that it also arrives in the bell after Friday's close.
   - Open "AI due-diligence answers": nine LP questions answered from the ledger, with the firm-only facts left in brackets.
4. **Connect AI apps.**
   - In Claude, add a custom connector with the server URL, approve it on YouBank's consent page, and watch the new key appear in Settings. Or make a key and paste the Claude Code line.
   - In Claude, pick the *Review my book* prompt, or ask "Which of my positions is closest to breaking, and why?" Claude calls `book_status` and answers with the same figures and links.
   - Ask Claude to research a short idea and "propose it to my book". In Claude, the proposal shows as a card, with its kill criteria checked now and "Review in YouBank". Refresh the Book: the proposal is there, marked "from Claude", with its reasoning. Press "Review and add", change the weight, and save.
   - Pick the *Investment committee* prompt in Claude to run the same committee with Claude's own model, or ask "How good is my process?" (`book_track_record`).
   - Pick *Draft LP commentary*: Claude drafts from the book and the track record, runs YouBank's `compliance_check` on its own draft, and fixes what it flags before showing it.
5. **Research ledger.**
   - Turn it on and show the MCP call from step 3 already recorded.
   - Approve it, then press "Check the chain".
   - Copy the head line into an email to yourself. Then explain that pasting it back later proves nothing before it changed, even if someone with YouBank's database tried.
   - Export the ledger and explain that their compliance team can re-check it in five lines of code, without trusting us.
   - Open "Governance report": the page a CCO attaches to a DDQ answer about AI use.

## 4. Honest limits (say these before an investor asks)

- **Tamper-evident, not WORM.** The ledger shows that something changed. It is not SEC 17a-4 WORM storage. A consistent rewrite of the whole chain is caught only from the last anchor kept outside YouBank. Daily anchors by email make that automatic: they are sent from the person's own connected mailbox, optionally copied to a compliance address. A public timestamp service (such as OpenTimestamps) is a follow-up.
- **MCP sign-in is tested with the official MCP SDK, not yet with each vendor.** The OAuth flow (discovery, registration, PKCE, consent, token) passes end to end with the official MCP TypeScript SDK client. It has not yet been tried against Claude.ai's and ChatGPT's live connector UIs, so try it once on the deployed preview before the pitch. Tokens do not expire; they are revoked in Settings.
- **The Book checks LTM fundamentals, price and insider selling.** It does not check estimates, intra-quarter KPIs or alternative data yet. Insider selling (Form 4 open-market sales less purchases over 90 days) is shown only when every filing in the window was read; otherwise it reads as no data. It is worked out after each close and when such a position is saved, and 10b5-1 plan sales are not told apart.
- **Risk is historical.** VaR, beta and the stress replays use daily closes with today's weights. They are not a factor model and not a forecast, and they leave out names with under six months of prices. "What the next report must show" covers revenue criteria only; margins need more than revenue to project.
- **Not an order-management system.** Positions are entered by hand. There is no broker sync for the Book, and the Book places no trades.
- **The committee is one model in three roles.** The bull and the bear write independently, but on the same model with the same data, so their disagreement is narrower than two analysts'. Its forecasts are scored so the fund can see whether it helps. The proposal card in Claude and ChatGPT follows the MCP Apps spec and passes a simulated host, but has not been seen in either app yet.
- **The compliance pass is rules, not counsel.** It catches the common Marketing Rule and AI-washing problems in a letter or DDQ, deterministically. It is a first read before the CCO, not a substitute for one.
- **Research figures.** The 95% adoption figure is from AIMA's 2025 generative-AI research, not the 2026 emerging-manager survey. An often-repeated "17% credit AI with performance" figure could not be traced to a primary source and is not used here.

## 5. Technical notes

| Piece | Where | Notes |
|---|---|---|
| The Book: logic | `src/lib/book/position.ts`, `alerts.ts`, `insiders.ts`, `filings.ts`, `print.ts` (the next report), `proposals.ts`, `calendar.ts`, `journal.ts` (track record), `forecast.ts` (calibration), `committee.ts`, `sizing.ts`, `week.ts`, `baserate.ts`, `letter.ts` (LP letter and compliance pass) (pure; the `*-store.ts` siblings fetch) | Pure; 186 tests in `scripts/test-book.ts` (checks, headroom, stop-loss, import, drafting, alerts, history, earnings, insider selling, new filings, the next report, proposals, calendar, export, the track record, calibration and its integrity, the committee and pooled chairs, sizing, the week, base rates, the compliance pass and the figure check) |
| The Book: risk | `src/lib/book/risk.ts` (pure), `src/lib/book/risk-store.ts`, `src/app/api/book/risk` | Daily closes since 2020 from the market data layer; beta to SPY, historical VaR and ES, Euler risk shares, correlated pairs, five stress replays, and the pre-trade what-if (`?add=`); cached six hours per book and day (ten minutes when partial) and warmed when the Book loads; 28 tests in `scripts/test-risk.ts` |
| The Book: storage and checks | `src/lib/book/store.ts`, `src/app/api/book/**` | Stored in `profiles.extra.book` (max 25 positions); companies and earnings dates read six at a time; GET limited to 240 an hour, red team to 20 an hour, the committee to 10; team sharing in `profiles.extra.bookShare` |
| The Book: alerts | `src/lib/book/alerts.ts`, `src/lib/book/watch.ts`, `src/app/api/cron/book` | Pure transition rules (tested); the cron runs weekdays at 21:25 UTC, least recently checked first, and writes verdicts and daily history to `profiles.extra.bookState`; 102 books checked in about 2 s in a local load check |
| The Book: UI | `src/components/book/BookClient.tsx`, `src/app/app/book/`, `src/app/report/book`, Home widget `book` | Nav feature `book` (key G then K); on by default for markets and PE roles, and pinned for markets |
| MCP: protocol | `src/lib/mcp/protocol.ts` | Pure JSON-RPC 2.0 with tools, prompts and per-tool annotations (only `propose_position` is not read-only); 54 tests in `scripts/test-mcp.ts` (keys, protocol, prompts, guardrails, MCP Apps, OAuth) |
| MCP: OAuth | `src/lib/mcp/oauth.ts`, `src/lib/mcp/oauth-store.ts`, `src/app/.well-known/**`, `src/app/api/oauth/**`, `src/app/app/connect/authorize` | Pure checks are tested; clients and single-use codes are kept in `kv_cache`; the token is an MCP key |
| MCP: tools and keys | `src/lib/mcp/server.ts`, `src/lib/mcp/keys.ts`, `src/lib/mcp/store.ts`, `src/app/api/mcp`, `src/app/api/settings/mcp-keys` | 22 tools and 7 prompts; keys read `ybm_<account>.<secret>` and are kept in `profiles.extra.apiKeys` (max 10, one per connected app); proposals go to `profiles.extra.bookProposals` (max 10, 30 an hour) and the bell; web research is excluded because it spends AI allowance |
| Ledger: chain and governance | `src/lib/ledger/chain.ts`, `src/lib/ledger/governance.ts` | Pure; 43 tests in `scripts/test-ledger.ts`, including an independent re-check of an export, anchors, storable text, the governance summary, the AI use inventory and the DDQ answers |
| Ledger: storage and UI | `src/lib/ledger/store.ts`, `src/lib/ledger/anchor.ts`, `src/app/api/ledger/**`, `src/app/api/cron/ledger`, `src/components/settings/LedgerSettings.tsx`, `src/app/report/ledger` (governance report) | Table `research_ledger`, migration `drizzle/0033_research_ledger.sql`; recording is hooked into `runChat` and the MCP route; appends serialised per person; off until the person turns it on; daily email anchors at 23:35 UTC |

**End to end:** `scripts/e2e-funds.ts` runs 52 checks over the Book, its risk, the what-if, the calendar, team risk, the track record, forecasts that can't be backdated or forged, the committee's guard, MCP (including that only `propose_position` writes, guardrails, the MCP Apps card, `compliance_check`, `book_track_record` and `book_week`), proposals, OAuth sign-in, the LP letter, the DDQ, the ledger and the governance report against a local server (`pnpm exec tsx scripts/e2e-funds.ts --base http://localhost:3100`; see the script's header for set-up).

**Before deploying,** apply the migration to the production database:

```
DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0033_research_ledger.sql
```

Without it, the ledger tab reports "not set up yet" and nothing is recorded. The Book, its risk, proposals and MCP need no migration. `vercel.json` adds two crons, `/api/cron/book` and `/api/cron/ledger`; both use the existing `CRON_SECRET`. An independent security review of the MCP, OAuth and ledger code found no critical or high issues, and its medium and low findings are fixed. Four later reviews of everything added since found correctness issues (insider-selling counting, risk edge cases, report wording, calendar updates, prompt parsing); all are fixed and covered by tests.
