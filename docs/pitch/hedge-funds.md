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
- **The book at a glance.** Gross, net, long and short exposure; how much of NAV sits in a thesis that is broken or on watch; P&L since entry; dated catalysts; and this week's news for each name.
- **Red team.** One click runs an agent briefed as a short seller (or as a bull, for a short). It makes the strongest sourced case against the thesis, names the weakest pillar, and lists the signals that would prove the thesis wrong. It works alone, by design (see Okawa, above).
- **Why it is different.** Research tools answer questions and agents investigate. The Book holds the fund to what it said it believed, and flags the moment the numbers say otherwise. Templates (growth, compounder, value, short) take a new user from nothing to a monitored book in minutes. Multi-day agent investigations remain in Edge → Theses.

### YouBank inside the fund's own AI apps: an MCP server (`/api/mcp`, Settings → Connect AI apps)

- **What it offers.** Sixteen read-only tools over the Model Context Protocol (Streamable HTTP, versions 2025-03-26 through 2025-11-25):
  - SEC XBRL fundamentals and comps;
  - filing search and reading, EDGAR full text and recent filings;
  - XBRL time series and insider transactions;
  - "what changed in the 10-K";
  - Form D raises and startups;
  - a calculator and news for a ticker;
  - the person's **Book**, with every thesis checked.
- **Every figure is cited.** Each result carries source ids with links, so an answer written in Claude or ChatGPT can be checked like one written in YouBank. This answers vendor sprawl: one subscription, used from wherever the analyst already works.
- **Keys.** Per-person keys, shown once and stored only as a SHA-256 hash. Each key is named for the app it serves and can be revoked. Calls are limited to 600 an hour.
- **Set-up.** Ready-made set-up for Claude Code, mcpServers-file apps (Claude Desktop, Cursor, Windsurf), mcp-remote, and plain HTTP.
- **Tested.** Verified with the official MCP TypeScript SDK client (v1.32.2), which negotiated protocol 2025-11-25.

### A research ledger: AI governance a compliance officer can check (Settings → Research ledger)

- **What it records.** When it is on, every AI answer written for the person is appended with the prompt, model, sources and figure-check summary. That covers chat, deep research, workflows, red teams, desktop questions and background agents. Every call their AI apps make over MCP is recorded too.
- **Tamper-evident.** Each entry's SHA-256 hash covers its content and the hash of the entry before it. Editing, removing or reordering any entry breaks the chain, and "Check the chain" says exactly which entry broke.
- **Human review.** A reviewer can approve, reject or note any entry. The review is written as its own entry, so the record stays append-only.
- **Checkable without YouBank.** The export (JSON Lines) states the recipe for re-checking the chain without YouBank's code. The test suite proves that the recipe works on its own.
- **Why it matters.** Funds can now show *what the AI said, from which sources, and who signed off*. That is the evidence Rule 204-2 and current practitioner guidance point towards, and it is what makes AI use defensible to LPs and examiners.

### What was already in YouBank, and still matters for this pitch

- Answers cite every figure, and a figure check matches each number to the source it cites.
- Edge offers alternative data, agent-run multi-day theses, Deal Radar, Call Desk and a track record.
- Quant covers factors, risk, backtest integrity checks, sizing and costs.
- Also in the product: 13F fund copies, algorithmic paper trading behind step-up 2FA, the Newsroom, Studio models and decks, the CRM, and the desktop and Office apps.

## 3. A ten-minute demo

1. **Home.** A markets user sees the Book widget: "1 broken · 1 on watch · 7.5% of NAV at risk".
2. **The Book.**
   - Add a position from the *High-growth software* template and watch it check against the filings at once.
   - Open the broken one and show the failed criterion, the figure, its period, and the link to the XBRL facts.
   - Run the red team. While it works, point at the exposure strip.
3. **Connect AI apps.**
   - Make a key and paste the Claude Code line.
   - In Claude, ask "Which of my positions is closest to breaking, and why?" Claude calls `book_status` and answers with the same figures and links.
4. **Research ledger.**
   - Turn it on and show the MCP call from step 3 already recorded.
   - Approve it, then press "Check the chain".
   - Export the ledger and explain that their compliance team can re-check it in five lines of code, without trusting us.

## 4. Honest limits (say these before an investor asks)

- **Tamper-evident, not WORM.** The ledger shows that something changed. It is not SEC 17a-4 WORM storage, and anyone with database access could rewrite the whole chain consistently. The mitigation is to export the ledger regularly or anchor its latest hash somewhere external. Anchoring the head hash with Crypto → Notarize is the natural next step; it is not built yet.
- **MCP sign-in uses bearer keys, not OAuth.** Clients that only support OAuth discovery need `mcp-remote` or a header-capable configuration. OAuth 2.1 support is a follow-up.
- **The Book checks LTM fundamentals and price only.** It does not check estimates, intra-quarter KPIs or alternative data yet. Criteria are limited to ten metrics.
- **Not an order-management system.** Positions are entered by hand. There is no broker sync for the Book, and the Book places no trades.
- **Research figures.** The 95% adoption figure is from AIMA's 2025 generative-AI research, not the 2026 emerging-manager survey. An often-repeated "17% credit AI with performance" figure could not be traced to a primary source and is not used here.

## 5. Technical notes

| Piece | Where | Notes |
|---|---|---|
| The Book: logic | `src/lib/book/position.ts` | Pure; 32 tests in `scripts/test-book.ts` |
| The Book: storage and checks | `src/lib/book/store.ts`, `src/app/api/book/**` | Stored in `profiles.extra.book` (max 25 positions); companies read six at a time; GET limited to 240 an hour, red team to 20 an hour |
| The Book: UI | `src/components/book/BookClient.tsx`, `src/app/app/book/`, Home widget `book` | Nav feature `book` (key G then K); on by default for markets and PE roles, and pinned for markets |
| MCP: protocol | `src/lib/mcp/protocol.ts` | Pure JSON-RPC 2.0; 24 tests in `scripts/test-mcp.ts` |
| MCP: tools and keys | `src/lib/mcp/server.ts`, `src/lib/mcp/keys.ts`, `src/lib/mcp/store.ts`, `src/app/api/mcp`, `src/app/api/settings/mcp-keys` | Keys read `ybm_<account>.<secret>` and are kept in `profiles.extra.apiKeys` (max 5); web research is excluded because it spends AI allowance |
| Ledger: chain | `src/lib/ledger/chain.ts` | Pure; 19 tests in `scripts/test-ledger.ts`, including an independent re-check of an export |
| Ledger: storage and UI | `src/lib/ledger/store.ts`, `src/app/api/ledger/**`, `src/components/settings/LedgerSettings.tsx` | Table `research_ledger`, migration `drizzle/0033_research_ledger.sql`; recording is hooked into `runChat` and the MCP route; off until the person turns it on |

**Before deploying,** apply the migration to the production database:

```
DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0033_research_ledger.sql
```

Without it, the ledger tab reports "not set up yet" and nothing is recorded. The Book and MCP need no migration.
