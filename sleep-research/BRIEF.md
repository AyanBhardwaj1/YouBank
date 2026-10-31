# Research brief: YouBank frontier research (run youbank-frontier-20261031)

Today is 2026-10-31. Direction from the owner: "extensive market, product, software, technical, AI, extremely
cutting-edge research pertaining to this product. You will be asked to implement your findings later."

## The product (read /home/user/YouBank/README.md and docs/ for detail)
YouBank (https://youbank-nu.vercel.app, repo /home/user/YouBank) is "the AI deal desk that does the work, and
learns how you do it": a financial research terminal + agents for people whose work is deals. Free beta; Stripe
plans prepared: Free, Campus (.edu), Pro $59/mo, Deal Team $149/seat, Enterprise $299/seat.
Users: 8 careers — investment banking, PE, VC, public markets, corporate finance, consulting, accounting, students.
Target: boutique advisors, emerging VC/PE managers, founders, students ("the firms in between" Capital IQ budgets
and $20 general chatbots).

Modules already built (very broad): research terminal (35+ functions, 328 tools on SEC EDGAR/XBRL, Form D,
Treasury, BLS, market prices via FMP + free-source fallback layer with provenance), AI assistant (OpenAI Responses +
Anthropic Messages, task routing, prompt caching, usage ledger), tool packs per role, Studio (live workbook + deck
built by agent cell by cell, Excel/PowerPoint add-in), Relationships (email agent: IMAP/Gmail, triage, drafts in
your voice, campaigns, nurture), Autopilot + adaptive engine (Thompson sampling, e-process anytime-valid autonomy
certification), Calendar + AI briefs, Meetings copilot, Teams + live collaboration, desktop app, Newsroom (news
clustering, alerts, briefs), Edge (alt data: satellite change detection, deal what-if map, precedents, Deal Radar
sale-odds model, Pulse alt signals, Call Desk earnings-call evasion scoring, LBO stress lab, theses agent, canvases
= node-graph agent workflows), Quant desk (factor models, backtests), Fund copies (13F copy trading via SnapTrade),
Algo trading (Alpaca/Webull/Robinhood Crypto), Crypto.

Stack: Next.js 16.3 App Router (React 19.2), Vercel (cle1, crons), Neon Postgres + Drizzle, Better Auth, Inngest,
OpenAI + Anthropic SDKs, Neon Functions schedule triggers. Roadmap items already listed in README: remote MCP server
connector for Claude/ChatGPT (stateless 2026-07-28 MCP spec, MCP Apps), Microsoft 365 mailboxes, AppSource listing,
SOC 2 Type I, licensed market data, cold-email compliance.

Prior research already in repo (do NOT just repeat it): docs/research/ai-inference.md (Sept 2026: model routing,
prompt caching, effort levels, financial ML, knowledge tracing, Bloomberg-function mapping),
docs/research/studio-competitive-landscape.md (Sept 2026: AI Excel/deck agents — Copilot, Claude for Excel,
ChatGPT for FS, Shortcut, Endex, Tracelight...), docs/research/*.md per persona.

## What we want from research
Findings that are (1) current — prioritise mid-2025 to Oct 2026, especially the last 6 months, (2) verifiable —
every claim with a URL from a search result or fetched page; anything you could not confirm is tagged
[UNVERIFIED]; never invent citations, numbers, product names or dates, (3) actionable for THIS product — each finding
ends with "Implication for YouBank" naming what to build/change, and roughly which part of the codebase it touches.
