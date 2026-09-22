# YouBank

An AI copilot and financial database for finance careers. Public regulatory data (SEC EDGAR filings and
XBRL, Form D, public startup directories) plus live prices, an assistant that holds the same data tools the
user does, and a tool system that produces the deliverable: the comps sheet, the capital structure, the
quality-of-earnings flags, the investment memo, the audit memo, the outreach email. Every figure cites the
filing it came from.

Production: **https://youbank-nu.vercel.app**

## What it does

- **Marketing site** at `/` for signed-out visitors: animated hero, an auto-playing terminal demo, three live
  demos (trading comps, an assistant answer with citations, the startup directory), per-career pages at
  `/for/<role>`, a 14-style theme gallery, and a plain-spoken data-and-method section.
- **Terminal** at `/app/terminal`: multi-panel, keyboard-driven. Functions are picked per seat, for example
  `DES` `FA` `COMPS` `PREC` `CAP` `FIL` `EVT` `INS` `XBRL` `AI` `PG` `TOOLS`. Type `SNOW COMPS`, `CCL CAP`, or
  `DDOG TOOL dcf`.
- **Tools** at `/app/tools`: AI workflows that research and draft, and calculators that compute exactly, both
  rendering into the same structured blocks (headline numbers, tables, bridges, sensitivity grids, risk
  registers, checklists, timelines, question banks, drafted emails). Runs save to your library with sources.
- **Private markets** at `/app/vc`: 18,000+ startups from Y Combinator, a16z, Thiel Fellows, Show HN, SEC
  Form D and AI web discovery, plus Form D raises with amounts and officers.
- **Eight careers**: investment banking, private equity, venture capital, public markets, corporate finance,
  consulting, accounting, and students. Each has its own research, tool pack, watchlists, prompt library and
  default style.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · Neon Postgres with Drizzle ·
Neon Auth (Google) · OpenAI Responses API (default **gpt-6-astra**, model and reasoning depth switchable per
run) with Anthropic as an alternate provider · Vercel.

## Docs

| Doc | What |
|---|---|
| [docs/06-product-overview.md](docs/06-product-overview.md) | Routes, terminal functions, the tool system, the AI layer, theming, commands |
| [docs/03-decisions.md](docs/03-decisions.md) | Every decision and its rationale, in order |
| [docs/05-tool-pack-authoring.md](docs/05-tool-pack-authoring.md) | How to add tools for a role |
| [docs/04-comps-engine-spec.md](docs/04-comps-engine-spec.md) | Comps engine spec |
| [docs/01-tech-ma-personas.md](docs/01-tech-ma-personas.md) | The original persona study |
| [docs/research/](docs/research/) | Eight market-research reports (67,000 words) behind the tool packs |

## Run

```bash
pnpm install
cp .env.example .env.local     # then fill in the keys
pnpm dev
```

Open http://localhost:3000. Required environment: `DATABASE_URL` (Neon, pooled), `DATABASE_URL_UNPOOLED`,
`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`), `FMP_API_KEY`,
`EDGAR_USER_AGENT` (SEC asks for a contact email), `CRON_SECRET`.

## Connecting a mailbox

The Relationships agent reads pasted email with no setup. To let it read a real inbox and send the
replies you approve, connect Gmail:

1. In Google Cloud, enable the **Gmail API**, then create an **OAuth client ID** of type *Web
   application*.
2. Add `https://<your-domain>/api/crm/gmail/callback` as an authorised redirect URI (and the same on
   `http://localhost:3000` for local work).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `EMAIL_TOKEN_SECRET` (`openssl rand -base64 32`)
   in the environment. On Vercel these go in the project's environment variables, not `.env.local`.
4. Open **Relationships** and press *Connect Gmail*.

The agent asks for `gmail.readonly` and `gmail.send` only: it cannot modify or delete anything in the
mailbox. Refresh tokens are encrypted with AES-256-GCM before they are stored, and disconnecting
deletes the row rather than flagging it.

Google classes both scopes as **restricted**. Your own account and a test list of up to 100 users work
immediately; serving anyone else requires Google's verification review.

Nothing is sent without a person pressing Send. `sendDraft()` in `src/lib/crm/send.ts` is the only
function that sends, and the only path to it is that button.

## Layout

```
YouBank/
  docs/                        product thinking, decisions, specs, market research
  scripts/                     snapshot, theme generation, pack tests, live workflow runs, directory backfill
  src/app/                     routes: marketing, /for/<role>, /app/*, /api/*
  src/components/
    marketing/                 landing, role pages, demos
    terminal/                  command bar, panels, screens (DES FA COMPS PREC CAP FIL EVT INS XBRL AI PG TOOLS)
    workflows/                 tool gallery, runner, form, output blocks
    theme/                     theme provider, picker, menu
    charts/ motion/ ui/        sparkline, bars, columns, scatter, waterfall, line, sensitivity; reveal; icons
  src/lib/
    edgar/                     client, tickers, submissions, XBRL facts and series, filing text, full-text, insiders
    ai/                        models, config, agent (OpenAI Responses + Anthropic), tools, prompts, research
    workflows/                 tool contract, prompt builder, registry, packs per role
    vc/                        startup directory sources, sync, Form D
    themes.ts calc.ts roles.ts metrics.ts company.ts
```
