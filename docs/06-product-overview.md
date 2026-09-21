# YouBank product overview

An AI copilot and financial database for eight finance careers. Free public data (SEC EDGAR, XBRL, Form D, public
startup directories) plus a market-price API, an assistant that holds the same tools the user does, and a tool
system that produces the actual deliverable.

## Routes

| Route | Who | What |
|---|---|---|
| `/` | signed out | Landing page: hero, auto-playing terminal demo, live demos (comps, AI, directory), role sections, style gallery, data and method, FAQ |
| `/for/<role>` | signed out | Per-career page: the day by level, what the tools replace, the data behind it, the full toolkit by category |
| `/sign-in` | signed out | Google OAuth through Neon Auth |
| `/onboarding` | new user | Six-step survey: role, specialty, level and firm, sectors, style, goals |
| `/app` | signed in | Dashboard: watchlist, movers, starter tools, recent runs, suggested prompts |
| `/app/terminal` | signed in | Multi-panel terminal, command bar, role-specific function strip |
| `/app/tools`, `/app/tools/[id]` | signed in | Tool gallery and runner (AI workflows and calculators) |
| `/app/vc` | vc, pe | Startup directory, Form D raises, venture assistant |
| `/app/library` | signed in | Saved runs, comps sheets, peer groups |
| `/app/settings` | signed in | Style, model and reasoning depth, desk summary, data and privacy |
| `/app/profile` | signed in | Retake the survey |

## Terminal functions

`DES` description · `FA` financials · `COMPS` trading comps · `PREC` precedents · `CAP` capital structure ·
`FIL` filings · `EVT` events (8-K items decoded) · `INS` insiders (Form 4) · `XBRL` concept explorer ·
`AI` assistant · `PG` peer groups · `TOOLS` tool shelf · `TOOL <id>` run a tool in a panel.

Command bar: `SNOW COMPS`, `CCL CAP`, `DDOG TOOL dcf`, or a bare ticker or function. `/` or Cmd+K focuses it.

## The tool system

```
src/lib/workflows/
  types.ts      contract: Field, OutputBlock (19 kinds), WorkflowOutput, WorkflowDef, CalculatorDef, helpers
  prompt.ts     builds the model's system prompt from a workflow's description + instructions + output contract
  registry.ts   every pack, de-duped by id; toolsFor(profile) ranks specialty matches first
  packs/        core.ts (shared) + one file per role
```

- **AI workflow**: `instructions` is a numbered method naming the exact data tools and search phrases; the model
  streams tool calls and returns JSON matching `WorkflowOutput`, which renders as blocks.
- **Calculator**: pure `compute(inputs)` returning the same shape, recomputed as the user types, optionally
  prefilled from the loaded company's SEC data.
- Every run is saved to `workflow_runs` with inputs, output, sources, model and duration, and is reopenable from
  the library at `/app/tools/<id>?run=<n>`.

Authoring spec: `docs/05-tool-pack-authoring.md`. Harnesses: `scripts/test-pack.ts` (schema and example
validation, id collisions) and `scripts/run-workflow.ts` (one live end-to-end run).

## AI layer

- `src/lib/ai/models.ts` catalogue and per-user preferences; default **gpt-6-astra**, switchable per run.
- `src/lib/ai/config.ts` resolution order: request override → account preference → environment → default.
- `src/lib/ai/agent.ts` OpenAI Responses API (streaming, function tools, reasoning summaries, native web search,
  structured output) and Anthropic Messages API (extended thinking) behind one interface.
- `src/lib/ai/tools.ts` fourteen data tools over EDGAR, XBRL, filings, Form D, the startup directory, the web, and
  an exact calculator.
- Modes in the AI panel: analyst, research, draft, critique, coach (mock interviews).

## Theming

`src/lib/themes.ts` holds 14 themes; `scripts/gen-themes.ts` regenerates `src/app/themes.css` after any edit.
Components only use tokens (`bg`, `panel`, `elevated`, `line`, `fg`, `muted`, `accent`, `accent-fg`, `pos`, `neg`,
`chart-1`, `chart-emphasis`, `--radius`, `--glass`, `--glow`, `--shadow-lg`). Never hard-code a color.

## Commands

```bash
pnpm dev                                                   # local
pnpm exec tsx scripts/gen-themes.ts                        # after editing themes
pnpm exec tsx --env-file=.env.local scripts/snapshot.ts    # refresh landing demo data
pnpm exec tsx scripts/test-pack.ts all                     # validate every tool pack
pnpm exec tsx --env-file=.env.local scripts/run-workflow.ts <id>   # one live workflow run
pnpm exec tsx --env-file=.env.local scripts/backfill.ts    # startup directory backfill
pnpm exec drizzle-kit push                                 # schema to Neon (needs env loaded)
vercel --prod --yes                                        # deploy
```
