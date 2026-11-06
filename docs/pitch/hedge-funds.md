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

- **What it is.** A fund enters its positions: ticker, long or short, weight as % of NAV, and entry price. Each position has a one-line thesis, its pillars, and **kill criteria**: the numbers that would prove the thesis wrong. Examples: revenue growth at least 20%, gross margin at least 70%, a price stop.
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
- **A report to hand over.** A printable one-pager for an investment committee or an LP letter: exposure, then every thesis with its evidence and the red team's case.
- **Red team.** One click runs an agent briefed as a short seller (or as a bull, for a short). It makes the strongest sourced case against the thesis, names the weakest pillar, and lists the signals that would prove the thesis wrong. It works alone, by design (see Okawa, above).
- **Always on.** Every weekday after the US close, YouBank re-checks every book. It tells the person the moment a thesis breaks (urgent, even in quiet hours), comes close to a kill criterion, or holds again, and when a catalyst is a day away. Alerts go to the bell, Home's "Waiting for you" and the person's own push, Slack or email. Each alert opens the position it is about.
- **For the whole team.** Each member chooses whether to share their book with their team. The team view (read-only) shows every shared position with its owner, each member's exposure, and any name one member holds long while another is short.
- **Say it in plain words.** "Long Snowflake: growth back above 20%, gross margin past 70%, out below $150" becomes a position with three kill criteria to check and change before saving. Thresholds the AI chose itself are marked "suggested", and the output passes the same validation as any saved position.
- **In minutes, not an afternoon.** Paste rows from a spreadsheet or an OMS export, in any column order. Each position starts with sensible kill criteria. For a demo, "Try a sample book" loads five well-known names.
- **Agents propose, the PM decides.** A connected AI app (Claude, ChatGPT, an in-house agent) can propose a position with its thesis, kill criteria and reasoning (`propose_position`). It lands on the Book page marked with the app that sent it, and nothing enters the book until the person reviews it in the editor and saves it. The proposal and the reasoning behind it are in the research ledger.
- **Why it is different.** Research tools answer questions and agents investigate. The Book holds the fund to what it said it believed, and flags the moment the numbers say otherwise. Templates (growth, compounder, value, short) take a new user from nothing to a monitored book in minutes. Multi-day agent investigations remain in Edge → Theses.

### YouBank inside the fund's own AI apps: an MCP server (`/api/mcp`, Settings → Connect AI apps)

- **What it offers.** Nineteen tools over the Model Context Protocol, eighteen of them read-only, (Streamable HTTP, versions 2025-03-26 through 2025-11-25):
  - SEC XBRL fundamentals and comps;
  - filing search and reading, EDGAR full text and recent filings;
  - XBRL time series and insider transactions;
  - "what changed in the 10-K";
  - Form D raises and startups;
  - a calculator and news for a ticker;
  - the person's **Book**, with every thesis checked;
  - `check_thesis`: any kill criteria checked against filings and the price on demand, without saving.
  - `book_risk`: the book's beta, VaR, stacked bets and stress replays;
  - `propose_position`: the one tool that writes, and all it writes is a proposal for the person to review (MCP marks it not read-only and not destructive).
- **Ready-made prompts.** *Review my book*, *Argue against a position*, *What changed in the latest filing* and *Earnings prep* appear in the AI app's slash or prompt menu. Each tells the model which YouBank tools to use and to cite every figure.
- **Every figure is cited.** Each result carries source ids with links, so an answer written in Claude or ChatGPT can be checked like one written in YouBank. This answers vendor sprawl: one subscription, used from wherever the analyst already works.
- **One URL to connect.** Claude and ChatGPT custom connectors take just the server address. YouBank implements the MCP authorization flow: OAuth 2.1 with PKCE, Protected Resource Metadata, and both Client ID Metadata Documents and Dynamic Client Registration, for public and confidential clients. The person approves the app on a YouBank consent page, and the app receives its own revocable key.
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

## 3. A ten-minute demo

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
3. **Connect AI apps.**
   - In Claude, add a custom connector with the server URL, approve it on YouBank's consent page, and watch the new key appear in Settings. Or make a key and paste the Claude Code line.
   - In Claude, pick the *Review my book* prompt, or ask "Which of my positions is closest to breaking, and why?" Claude calls `book_status` and answers with the same figures and links.
   - Ask Claude to research a short idea and "propose it to my book". Refresh the Book: the proposal is there, marked "from Claude", with its reasoning. Press "Review and add", change the weight, and save.
4. **Research ledger.**
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
- **Research figures.** The 95% adoption figure is from AIMA's 2025 generative-AI research, not the 2026 emerging-manager survey. An often-repeated "17% credit AI with performance" figure could not be traced to a primary source and is not used here.

## 5. Technical notes

| Piece | Where | Notes |
|---|---|---|
| The Book: logic | `src/lib/book/position.ts`, `src/lib/book/alerts.ts`, `src/lib/book/insiders.ts`, `src/lib/book/filings.ts` (pure; their `*-store.ts` siblings fetch) | Pure; 77 tests in `scripts/test-book.ts` (checks, headroom, import, drafting, alerts, history, earnings, insider selling, new filings, concentration, export) |
| The Book: storage and checks | `src/lib/book/store.ts`, `src/app/api/book/**` | Stored in `profiles.extra.book` (max 25 positions); companies and earnings dates read six at a time; GET limited to 240 an hour, red team to 20 an hour; team sharing in `profiles.extra.bookShare` |
| The Book: alerts | `src/lib/book/alerts.ts`, `src/lib/book/watch.ts`, `src/app/api/cron/book` | Pure transition rules (tested); the cron runs weekdays at 21:25 UTC, least recently checked first, and writes verdicts and daily history to `profiles.extra.bookState`; 102 books checked in about 2 s in a local load check |
| The Book: UI | `src/components/book/BookClient.tsx`, `src/app/app/book/`, `src/app/report/book`, Home widget `book` | Nav feature `book` (key G then K); on by default for markets and PE roles, and pinned for markets |
| MCP: protocol | `src/lib/mcp/protocol.ts` | Pure JSON-RPC 2.0 with tools and prompts; 40 tests in `scripts/test-mcp.ts` (keys, protocol, prompts, OAuth) |
| MCP: OAuth | `src/lib/mcp/oauth.ts`, `src/lib/mcp/oauth-store.ts`, `src/app/.well-known/**`, `src/app/api/oauth/**`, `src/app/app/connect/authorize` | Pure checks are tested; clients and single-use codes are kept in `kv_cache`; the token is an MCP key |
| MCP: tools and keys | `src/lib/mcp/server.ts`, `src/lib/mcp/keys.ts`, `src/lib/mcp/store.ts`, `src/app/api/mcp`, `src/app/api/settings/mcp-keys` | Keys read `ybm_<account>.<secret>` and are kept in `profiles.extra.apiKeys` (max 10, one per connected app); web research is excluded because it spends AI allowance |
| Ledger: chain | `src/lib/ledger/chain.ts` | Pure; 27 tests in `scripts/test-ledger.ts`, including an independent re-check of an export, anchors and storable text |
| Ledger: storage and UI | `src/lib/ledger/store.ts`, `src/lib/ledger/anchor.ts`, `src/app/api/ledger/**`, `src/app/api/cron/ledger`, `src/components/settings/LedgerSettings.tsx` | Table `research_ledger`, migration `drizzle/0033_research_ledger.sql`; recording is hooked into `runChat` and the MCP route; appends serialised per person; off until the person turns it on; daily email anchors at 23:35 UTC |

**End to end:** `scripts/e2e-funds.ts` runs 24 checks over the Book, MCP, OAuth sign-in and the ledger against a local server (`pnpm exec tsx scripts/e2e-funds.ts --base http://localhost:3100`; see the script's header for set-up).

**Before deploying,** apply the migration to the production database:

```
DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0033_research_ledger.sql
```

Without it, the ledger tab reports "not set up yet" and nothing is recorded. The Book and MCP need no migration. `vercel.json` adds two crons, `/api/cron/book` and `/api/cron/ledger`; both use the existing `CRON_SECRET`. An independent security review of the MCP, OAuth and ledger code found no critical or high issues, and its medium and low findings are fixed.
