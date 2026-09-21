# Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-19 | First module: **Comps engine** (trading comps + precedent transactions) | Largest analyst time saver; creates the data core every other module needs |
| 2026-09-19 | UI: **dense terminal** style (Bloomberg-like) | Dark, information-dense grids, keyboard-driven, multi-panel |
| 2026-09-19 | Stack: **Next.js + TypeScript + Tailwind + Postgres (pgvector) + Claude API** | Single language end to end, fastest path to a polished app |
| 2026-09-19 | Data: **SEC EDGAR only** for v1 (filings + XBRL company facts) | Free, no key, covers US public company financials; prices added later |

## Consequences
- No live share prices in v1. Market cap and EV need a price source; until then, comps show
  fundamentals (revenue, growth, margins) and any multiples use a user-entered or cached price.
  Candidate later: Financial Modeling Prep or Polygon.
- EDGAR rate limit is 10 requests/second and requires a User-Agent header with contact info.
- Precedent transactions are not in EDGAR in structured form. v1 seeds them from 8-K/merger
  proxy filings plus a curated table; AI extraction from filings is a follow-up.

## Round 2 (2026-09-19)

| Decision | Detail |
|---|---|
| Database hosting | **Hosted Postgres (Neon or Supabase)**, pgvector enabled. Connection string in `.env`. |
| Peer selection | **AI suggests, user edits** + **saved peer groups** |
| Comps columns | **SaaS metrics block** (growth, GM, OpM, FCF margin, Rule of 40, NRR) + **valuation multiples block** (EV/Rev, EV/EBITDA, P/E, EV/FCF; LTM and NTM) |
| Navigation | **Command bar with functions** (`/` or Cmd+K, e.g. `SNOW COMPS`), tiled panels |
| AI in v1 | Suggest/tier peers, footnotes and outlier flags, chat over the sheet with citations, extract non-XBRL items from filing text |

Consequence: NTM multiples and prices have no free source in v1. Sheet supports user-entered
price and NTM estimates per row, marked as manual with a footnote, until a market data API is added.

## Round 3 (2026-09-19)

| Decision | Detail |
|---|---|
| Database | **Neon** hosted Postgres. `DATABASE_URL` in `.env.local`. |
| AI key | User has an Anthropic API key; `ANTHROPIC_API_KEY` in `.env.local`. |
| Order of work | 1) **UI overhaul**: polished, modern Bloomberg-style terminal with more visuals. 2) **EDGAR pipeline**. 3) Claude peer proposal and chat. 4) Schema and saved sheets. |
| Prices | **Add a market data API now** (Financial Modeling Prep) instead of manual inputs. `FMP_API_KEY` in `.env.local`. NTM estimates come from FMP analyst estimates where available. |

UI feedback verbatim: "more visuals, more visually appealing, this is too bare bones, a modern
upgraded Bloomberg terminal". Direction (dark, dense, terminal) is still right.

## Round 4 (2026-09-19, mid-build)

| Decision | Detail |
|---|---|
| AI providers | **OpenAI and Anthropic both supported**, chosen by `AI_PROVIDER`. User has OpenAI credits, so OpenAI is the default. Same tool definitions and prompts for both. |
| FMP | Key provided and stored in `.env.local`. |
| Neon | Project `rapid-breeze-52735422`, branch `production`, linked via the `neon` CLI. |

## Build log (2026-09-19)

- UI overhaul shipped: left rail with live watchlist, autocompleting command bar backed by the SEC ticker list, tiled panels with maximize, ticker tape, stat tiles, quarterly revenue columns, emphasis bar and scatter charts, column sets on the comps grid.
- EDGAR pipeline shipped: `src/lib/edgar/*` (client with throttle + disk cache, tickers, submissions, XBRL facts parser). LTM = FY + YTD - prior YTD; quarters from direct 3-month rows or YTD differencing; debt from LongTermDebt or Convertible* concepts; shares sum multi-class cover-page rows.
- FMP: free tier allows `profile` only. Prices and market cap live; no history, no estimates.
- AI layer shipped: `src/lib/ai/*` with OpenAI (Chat Completions, streaming, function calling) and Anthropic (Messages API streaming loop, default model `claude-opus-5`). Peer proposal uses structured JSON output on both.
- Confluent (CFLT) dropped from defaults: no longer an SEC registrant after its acquisition.
- Known gaps: NTM estimates, calendarization, share counts for some multi-class filers, precedent transactions still sample data, no persistence yet.

## Persistence (2026-09-19)

- Drizzle ORM over `@neondatabase/serverless` (HTTP driver) for route handlers; schema in `src/db/schema.ts`, pushed with
  `drizzle-kit push` using the direct (non-pooled) URL. App traffic uses the pooled `DATABASE_URL`.
- Tables: `peer_groups` + `peer_group_members`, `comps_sheets` (member snapshot, view state, computed snapshot), `manual_inputs`
  (append-only; latest per ticker+field wins; null clears), `footnotes`.
- No auth yet: the browser stores a display name sent as `x-user` and recorded on saved rows. Neon Auth is enabled in `neon.ts`
  for when real sign-in is added.
- OpenAI default model `gpt-5.5`. Chat Completions rejects `reasoning_effort` together with function tools on this model, so the
  chat loop omits it; the structured peer proposal (no tools) uses `OPENAI_REASONING_EFFORT`.

## Accounts, roles, and hosting (2026-09-20)

- **Auth**: Neon Auth (managed Better Auth) with Google. Shared Google credentials work in development; production needs the
  user's own Google OAuth client registered in Neon (`neon neon-auth oauth-provider add --provider-id google ...`) with redirect
  URI `{NEON_AUTH_BASE_URL}/callback/google`. Pages under `/app` and `/onboarding` are protected by `src/proxy.ts`; every API
  route checks the session and returns 401.
- **Onboarding survey**: role (banker, corporate finance, consultant, accountant, student, VC), specialty, seniority, firm type,
  firm/ticker, sectors, goals. Stored in `profiles`. `src/lib/roles.ts` turns a profile into a workspace config: watchlist,
  initial panels, suggested prompts, and an AI persona appended to the system prompt.
- **Venture workspace** (`/app/vc`): YC public directory synced into `yc_companies` (about 6,200 companies), SEC Form D
  full-text search with parsed amounts and related persons, and an assistant with `web_research` (OpenAI Responses web search)
  and `form_d_search` tools. Growth-stage public comps reuse the terminal with a recent-IPO watchlist.
- **Serverless caching**: `src/lib/cache.ts` layers memory, disk (local only), and the `kv_cache` table; assembled companies are
  cached in `company_cache` for 6 hours with prices refreshed from FMP.
- **Hosting**: Vercel project `youbank` (team of the user's account), env vars uploaded for production and preview.
- Dev-only bypass: `YOUBANK_DEV_USER=<name>` in `.env.local` fakes a session for local API testing. Never set in production.
- Production: https://youbank-nu.vercel.app. Known data gap: filers that tag statements with custom XBRL extensions
  (Exxon) have sparse standardized facts, so LTM can be empty; banks resolve via `RevenuesNetOfInterestExpense`.
- Debug scripts: `pnpm exec tsx --env-file=.env.local scripts/company.ts XOM` and `scripts/facts.ts XOM Revenues`.

## Startup directory sources (2026-09-20)

One table, `startups`, keyed by (source, source_id). Ingesters in `src/lib/vc/sources/`:

| Source | How | Coverage |
|---|---|---|
| `yc` | YC public API, all pages | ~6,200 companies, batches, industries, hiring |
| `a16z` | `window.a16z_portfolio_companies` parsed from a16z.com/portfolio | ~860 companies with founders, stage, exits |
| `thiel` | Wikipedia Thiel Fellowship article bullets | ~20 notable fellows; extend with web discovery |
| `hn` | Algolia HN API, Show HN posts with 3+ points | ~9,700 launches per 180 days, global, mostly unfunded |
| `formd` | SEC daily index form.YYYYMMDD.idx, new Form D only, pooled funds excluded | ~50-120 operating companies per business day, US, with officers and amounts |
| `web` | AI web discovery (OpenAI Responses web_search + JSON schema) on demand | Anything: "fintech startups in Nigeria", "Thiel Fellows 2025" |

Nightly Vercel cron (`vercel.json`, `/api/cron/sync`, bearer `CRON_SECRET`) refreshes hn and formd for 3 days and re-syncs yc, a16z, thiel.
Backfill locally with `pnpm exec tsx --env-file=.env.local scripts/backfill.ts`. Techstars only pre-renders its unicorn list behind an
Airtable embed, and Product Hunt needs a developer token, so both are reachable through web discovery rather than ingesters.

## Full-site overhaul (2026-09-20 → 2026-09-21)

Verbatim brief: "make a full-fledged end to end website ... cool demos, description of the product ... then when u sign in u can do what the website has now ... the user can pick from a list of styles for the UI ... do extensive extensive market research for all of the available jobs ... overhaul the tools and features make new features more and more that tailor it specifically to that market research ... for the openai API key use gpt 5.6 astra as the model but make the model used changeable ... make the UI have cool animations as well".

| Decision | Detail |
|---|---|
| Marketing site | `/` is now a full landing page for signed-out visitors: animated hero, auto-playing terminal demo, three live demos (comps, AI with citations, startup directory), per-career sections, the style gallery, data-and-method section, FAQ. Per-role pages at `/for/<role>` are statically generated from the research. Signed-in users are redirected to `/app`. |
| Demo data | `scripts/snapshot.ts` freezes real production data (12 companies of SEC XBRL fundamentals + prices, 24 startups, directory count) into `src/lib/demo/snapshot.json` so the demos are real numbers and work signed out. `DEMO_ANSWERS` in `src/lib/demo/index.ts` replays four scripted assistant answers with their tool calls and citations. |
| Theme system | 14 themes in `src/lib/themes.ts` (single source of truth) across six families: Terminal, Modern dark, Cutting edge, Soft light, Bright modern, Playful. Each sets colors **and** radius, glass blur, glow, shadow and an optional gradient mesh. `scripts/gen-themes.ts` emits `src/app/themes.css`; the active theme is an attribute on `<html>`, chosen from a cookie server-side (no flash) and persisted to `profiles.extra.theme` for signed-in users. Switching uses the View Transitions API for a crossfade. `--accent-fg` was added so accent buttons stay legible on light themes. |
| Animations | CSS-first (`globals.css`): rise, fade, shimmer skeletons, pulse rings, typing caret, drifting gradient mesh, grow-x/grow-y bar growth, SVG stroke draw, staggered lists, hover lift, gradient text, scroll reveal via `Reveal`/`CountUp`/`Typewriter` in `src/components/motion/Reveal.tsx`. Panel open/close uses `motion/react` layout springs. Everything is disabled under `prefers-reduced-motion`. |
| Model layer | Default model is **gpt-6-astra** (the account has no `gpt-5.6-astra`; the 5.6 family ships as Sol, Luna and Terra, all selectable). `src/lib/ai/models.ts` is the catalogue (21 models, cost bands, effort support); `resolveAi()` picks override → account preference → env → default. Reasoning effort is low/medium/high/xhigh (`none` is rejected by the API). Users switch model and effort per run from the AI panel, the tool runner, or Settings; `/api/ai/models` filters the catalogue against the live `/v1/models` list. |
| OpenAI transport | Moved from Chat Completions to the **Responses API**: function tools plus reasoning effort together (Chat Completions rejects that combination), reasoning summaries streamed as `thinking` events, native `web_search` with url citations folded into our source list, `previous_response_id` for the tool loop, and JSON-schema structured output for workflows. Anthropic stays on the Messages API with extended thinking. |
| Data tools | Added `read_document` (any sec.gov URL), `edgar_fulltext_search` (every filing and exhibit since 2001), `get_recent_filings` (with 8-K item codes), `get_xbrl_series` (any concept, plus regex tag discovery), `get_insider_transactions` (Form 4 parsing), and `calc` (a safe expression evaluator in `src/lib/calc.ts`, used for every non-trivial number). |
| Tool system | `src/lib/workflows/*`: a tool is either an **AI workflow** (methodology in `instructions`, streams tool calls, returns structured `WorkflowOutput`) or a **calculator** (pure TypeScript, same output shape, live as you type, prefilled from SEC data). 19 output block types render through `OutputBlocks` (kpis, tables, bridges, sensitivity grids, timelines, risk registers, checklists, Q&A banks, drafted emails, scored rubrics). Runs save to `workflow_runs` with inputs, output and sources. Packs live in `src/lib/workflows/packs/<role>.ts`; `docs/05-tool-pack-authoring.md` is the authoring spec and `scripts/test-pack.ts` / `scripts/run-workflow.ts` are the harnesses. |
| Roles | Eight: banker, **pe** (new), vc, **markets** (new), corpfin, consultant, accountant, student. Each carries specialties, seniorities, firm types, a default theme, jobs-to-be-done and marketing copy. `functionsForProfile()` picks the terminal function strip per seat (a restructuring banker gets CAP before COMPS; an accountant gets XBRL). |
| Terminal | New screens: CAP (capital structure, leverage, coverage, maturity ladder), EVT (filing timeline with 8-K item codes decoded), INS (Form 4 insider activity), XBRL (concept explorer), TOOLS/TOOL (run any workflow or calculator inside a panel). Command bar understands `TICKER TOOL <id>` with autocomplete over the user's tool set. |
| App shell | `/app` is a dashboard (watchlist table, movers, starter tools, recent runs, suggested prompts). New routes: `/app/tools`, `/app/tools/[id]`, `/app/library`, `/app/settings`. Onboarding gained a style step and writes the theme preference. |
| Research | Eight market-research reports in `docs/research/` (67,000 words total) covering M&A and coverage banking, restructuring, capital markets, private equity and VC, public markets, corporate finance, consulting, accounting, and students. Each carries day-in-the-life by seniority, data sources, exact methodology, glossaries, feature proposals and prompt libraries; the packs are authored from them. |

## Tool packs delivered (2026-09-21)

321 tools: 230 AI workflows and 91 calculators, authored from the eight research reports and validated by
`scripts/test-pack.ts` (schema, ids, examples, empty-input behaviour) plus at least two live end-to-end runs per pack.

| Pack | Tools | Notable verification |
|---|---|---|
| Core (shared) | 8 | Company one-pager run end to end on the Responses API: 12 tool calls, 10 sources, 72s |
| Investment banking | 46 | Capital structure, merger proxy mining, ECM/DCM; 14 specialties each with three or more tools |
| Private equity | 35 | Leveraged buyout attribution ties to sponsor proceeds to four decimals; management incentive plan catch-up lands on exactly 10% |
| Venture capital | 37 | Cap table, SAFE conversion, exit waterfall; sourcing map across the 18,000-startup directory |
| Public markets | 36 | Yield-to-worst takes the lower of maturity and call; beta-neutral pair leaves 0.00% net beta |
| Corporate finance | 37 | Price-volume-mix reconciles to the total variance across 389 randomized test cubes |
| Consulting | 42 | Market sizing reconciliation, add-back taxonomy, 13-week cash |
| Accounting | 47 | AS 2105 materiality, attribute and monetary-unit sampling, ASC 606 allocation, ASC 842 schedule, ASC 740 rate reconciliation, EPS, relief-from-royalty, goodwill, section 382 |
| Students | 33 | Paper leveraged buyout reproduces the canonical case at 2.31x and 18.2%; recruiting calendar carries real dated cycles |

### Fixes that came out of building them

- **XBRL trust scoring.** Comfort Systems tagged a first-quarter revenue figure with a full-year context in a
  10-Q. "Latest filing wins" let it overwrite the real annual figure from the 10-K, so last-twelve-month revenue
  read $3,958mm instead of $11,228mm and one quarter came out negative. `normalize()` now scores each row by
  whether the form should carry that period (an annual duration in a 10-Q loses to a 10-K), `ltmAt()` rejects an
  annual row smaller than a year-to-date row inside the same year, and it falls back to summing four quarters.
- **Calculator lexer.** A comma was consumed as a thousands separator even when it was an argument separator, so
  `irr(-100, 20, 30)` failed. A comma now only joins a number when followed by exactly three digits.
- **Form 4 parsing.** `primaryDocument` points at the XSL-rendered HTML, so the raw XML is the same path with the
  `xslF345X0n/` segment stripped. The cache key had to change with it, since a cached body outlives a URL change.
- **EDGAR full-text dates.** A half-open custom range is silently ignored; both `startdt` and `enddt` are now always sent.
- **Time budget.** The agent loop takes a `deadline`. Past it, tools are withdrawn and the model is told to answer
  from what it has and list gaps in caveats, so a slow run returns partial cited output instead of a dead request.
  Defaults: 235s, overridable with `WORKFLOW_BUDGET_MS` and `CHAT_BUDGET_MS`.
- **Measured function limits.** `/api/health/duration` (cron-secret protected) confirmed 120-second streaming
  responses complete in production, so `maxDuration = 300` on the streaming routes is honoured.
