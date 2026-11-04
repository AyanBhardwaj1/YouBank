# Implementation status against EXPERIMENT_PLAN.md (revision 2)
Updated 2026-11-02. Branch `claude/practical-goldberg-84jmlh`. Nothing here is deployed.

## Before deploying
Apply the migrations first. CRM settings read `postal_address`, and Better Auth reads `two_factor_enabled` on every session, so both break without them:

```
DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0030_mail_compliance.sql drizzle/0031_two_factor.sql drizzle/0032_analytics.sql
```

## M0: internal launch gate

| Item | Status | Where |
|---|---|---|
| Fail-closed autopilot trust gate | Done | `src/lib/crm/autopilot-rules.ts` `holdOnError`; `scripts/test-autopilot.ts` |
| Landing copy matches what ships | Done | `Landing.tsx`, `app/layout.tsx` |
| Campaign and nurture compliance | Done | `src/lib/crm/compliance.ts`, `/api/unsubscribe/[token]`, `drizzle/0030`; `scripts/test-compliance.ts`. Covers postal address, unsubscribe line, RFC 8058 headers, signed one-click link, and SPF/DKIM/DMARC checks at launch |
| Meeting notice and host confirmation | Done | `src/lib/meetings/pipeline.ts` `consentProblem`, desktop pill and `meetings.rs`, Recall `chat.on_bot_join` notice. Recall's chat parameter has not been tested against the live API |
| Two-factor authentication and step-up | Done | Better Auth `twoFactor`, `/sign-in/two-factor`, Settings → Security, `src/lib/auth/step-up.ts`, `drizzle/0031`. A fresh code gates broker keys, Alpaca, SnapTrade, live and trading consent, and Gmail and IMAP connects. `scripts/test-step-up.ts`. The sign-in flow was run against a throwaway Postgres; the browser UI was not run |
| Separate Nasdaq.com switch | Done | `MARKET_NASDAQ`. Default on: FMP's free plan covers about 87 tickers. Turning it off is the owner's call once a licensed price plan is in place |
| Product analytics view | Done | `drizzle/0032_analytics.sql`, `scripts/analytics.mts`. Checked on seeded data |
| Owner decisions | Open | Gmail OAuth scope (CASA or send-only), Vercel Pro, FMP display licence with AI rights, counsel on copy and algo trading and on recording consent |

## Week 1 checks

| Item | Status | Where |
|---|---|---|
| B0: real-answer audit | Tooling done; the audit has not been run | `scripts/audit-answers.mts`, `scripts/audit-summary.mts`. Needs model keys and the database |
| B3-0: label-volume go/no-go | Tooling done; the check has not been run | `src/lib/crm/label-volume.ts`, `scripts/label-volume.mts` (α 10%, δ 5%, fixed in advance). Run it on production data |

## Blocks

| Block | Status | Notes |
|---|---|---|
| B1: eval harness | Done; not yet run | `src/lib/ai/evals/`, `scripts/eval-agent-build.mts`, `scripts/eval-agent.mts`, `.github/workflows/eval-agent.yml` (off until `EVAL_NIGHTLY=on`). The hand-checked slice (`hand-checked.json`) is empty: a person fills it |
| B2: figures checked against their cited source | Done for chat | `src/lib/ai/figures.ts`, the terminal AI screen, calc source references, the year-masking fix. Rendering figures from the store instead of the model's digits is not built (cut line). Workflow, memo and Studio surfaces are not yet covered. Edge's synthetic calibration fixture waits on B0 labels |
| B3: certified autopilot gate | Not started, by design | Waits for B3-0 to say go |
| B4: MCP connector | Not started | First to drop at the cut line |

## Verification on this branch
- **Typecheck and lint:** clean.
- **Test suites, passed / failed:**
  - test-autopilot 67/0
  - test-compliance 16/0
  - test-meetings 95/0
  - test-step-up 28/0
  - test-figures 31/0
  - test-evals 23/0
  - test-label-volume 15/0
  - test-prod 152/0
  - test-errors 220/0
  - test-normalize 179/0
  - test-learning 63/0
  - test-datasources 79/0
  - test-datalayer 94/0
  - test-edge 469/0
  - test-edge-next 377/0
- **Desktop app:** `cargo check` and `cargo test` (27/0) pass.
- **Edge claims eval:** unchanged (AUROC 0.948).
- **Production build:** passes, with `NODE_OPTIONS=--max-old-space-size=6144` because the sandbox runs out of memory without it.
- **Migrations:** 0030–0032 apply twice cleanly to a local Postgres.

## Load test and hardening (2026-11-02)

**Setup:**
- a local production build on Postgres 16 under the offline sandbox (`scripts/load`), with 220 seeded users;
- the mixed load now includes the new endpoints: CRM settings and page, the Security tab, step-up and two-factor state, and both unsubscribe paths;
- it counts any response carrying raw error text.

**Results:**

| Run | Requests | Errors | p95 | Raw error text | Server errors logged |
|---|---|---|---|---|---|
| 100 users, 60 s | 2,914 | 0.00% | 68 ms | none | 0 |
| 200 users, 60 s | 5,723 | 0.00% | 244 ms | none | 0 |
| 150 users, expired session cookies, 30 s | 2,192 | 0.00% | 130 ms | none | 0 |

At 200 users, one local process used 85% of a core. Vercel runs many instances.

**Other checks:**
- **Browser sweep:** no page errors on 23 signed-in pages and 12 public pages. The only 503 was the dashboard watchlist under a simulated SEC outage, and it shows a calm message.
- **Two-factor in a real browser:** setup, backup codes, the sign-in challenge, wrong-code text and landing in the app all worked.

**Fixes from an independent review**, all re-tested:
1. Signed-in code checks now share the step-up attempt budget per person: 8 per 15 minutes across addresses.
2. Backup codes pass step-up, once each.
3. Turning 2FA on without a password needs a sign-in from the last 15 minutes.
4. DNS lookups have a 2-second timeout, and a failed lookup warns instead of blocking a launch.
5. An unanswered desktop recording confirmation no longer stops call detection, and the tick resets for each call.
6. The analytics views count only what people did themselves.
7. calc references handle very small and very large values.
8. The Alpaca callback no longer re-asks for a code.
9. A deploy ahead of migrations 0030 and 0031 shows "being set up" instead of breaking sign-in.
10. The unsubscribe page never returns a bare 500.

## Workspace, customization and flow (2026-11-04)

Asked for: a workspace that sets itself up for each person and stays theirs to change, a calm "homey" Home as an option, deep UI customization, and more that makes the product flow. No migration is needed: everything new is kept in `profiles.extra`.

**Set up for you, changeable by you**

| Feature | Where | Tests |
|---|---|---|
| The desk sets itself up from the survey on first profile completion, or from a sentence in Settings → My desk. A model call, checked against fixed vocabularies, falls back to rules. Features, Home layout and widgets stay switchable. Named features are pinned first. | `src/lib/desk/{desk,setup}.ts`, `/api/desk/setup`, `DeskSettings.tsx` | `test-desk` |
| Home in three layouts: Focus (one question box), Home (calm, roomy cards), Desk (dense, two columns), switchable on the page | `HomeDashboard.tsx`, `home/Widgets.tsx` | browser |
| Arrange Home on the page: drag to reorder (or across Desk's columns), wide or narrow, add or remove, reset | `home/Arrange.tsx`, `moveWidget` / `nudgeWidget` / `toggleWidget` | `test-desk`, browser drag |
| Your own watchlist, used by Home, the terminal, comps, the palette and the Newsroom's ranking | `src/lib/desk/watchlist.ts`, `WatchlistEditor.tsx`, `news/reader.ts` | `test-watchlist`, browser |

**Customization**

| Feature | Where |
|---|---|
| Make it yours: size (whole-app zoom), corners, typeface, accent (swatches or any colour), background (glow, grid, dots), motion, contrast. Applied at once, and in the first paint through a cookie | `LookSettings.tsx`, `lookAttrs`, `app/layout.tsx`, `globals.css` |
| Looks: six built in, save your own, share as a `yb1.` code | `BUILTIN_LOOKS`, `lookCode` / `readLookCode` |
| Match my system: a light and a dark style that follow the device | `SystemTheme.tsx` |
| Home wallpapers: Dawn, Dusk, Ocean, Forest, Aurora, Paper | `WALLPAPERS`, `globals.css` |

**Flow**

| Feature | Where | Tests |
|---|---|---|
| ⌘K command palette: go anywhere (features, pages, 328 tools, settings), open a ticker, add it to the watchlist, ask the AI, change layout, look or style | `CommandPalette.tsx`, `src/lib/palette.ts` | `test-palette` |
| Desk inbox (research item D1): the agent's questions, drafts (autopilot's about-to-send first, with Stop), follow-ups and alerts, decided in place through the endpoints that own them | `/api/desk/inbox`, `src/lib/desk/inbox.ts`, `home/Inbox.tsx` | `test-inbox` |
| Getting started checklist, ticked from the account itself, with an in-place Install | `/api/desk/checklist`, `src/lib/desk/checklist.ts`, `src/lib/client/install.ts` | `test-desk` |
| Installable app (D4, without push): manifest, maskable icons, shortcuts | `src/app/manifest.ts` | |
| Keyboard: G then a letter to go, ? for the sheet | `Shortcuts.tsx` | browser |
| World markets and Quick calc widgets | `src/lib/desk/markets.ts`, `home/MoreWidgets.tsx` | `test-markets` |
| Jump back in: the last pages, tools and tickers opened (this browser only) | `src/lib/client/recent.ts`, `RecentWidget` | `test-recent` |
| Star tools: starred first on Home and in Tools | `normalizeStarred`, `ToolCard.tsx` | `test-watchlist`, browser |
| A badge on Home's tab counting what waits in the inbox | `src/lib/client/waiting.ts`, `/api/desk/inbox?counts=1` | browser, load |
| Coming up shows contacts, deals, outside guests, and Join now | `home/Widgets.tsx` | browser |
| Onboarding asks how YouBank should feel: Home layout, style, wallpaper | `OnboardingWizard.tsx` | browser, new account |
| Share your setup: Home, features, style and look as a `yb2.` code (never notes) | `setupCode` / `readSetupCode` | `test-desk`, two accounts |
| "New in YouBank": once per release, each feature tried in one click | `src/lib/whats-new.ts`, `WhatsNew.tsx` | browser |

**AI**

| Feature | Where | Tests |
|---|---|---|
| Tool search (A3): the chat's `find_tools` searches the catalogue and links the right workflow or calculator | `src/lib/ai/catalog-tool.ts` | `test-palette` |
| Answers become actions (part of A9): copy with sources, copy a table as spreadsheet cells, save to Home's notes, download | `src/lib/ai/answer-actions.ts`, `AiScreen.tsx` | `test-answer-actions` |
| Follow-up questions under the latest answer, from the tools it used (no model call) | `followUps` | `test-answer-actions` |
| B2 extended to workflows: every figure in a workflow's result checked against its cited source, saved with the run | `/api/tools/run`, `src/lib/workflows/markdown.ts`, `components/ai/FigureCheck.tsx` | `test-figures` |

**Bugs found and fixed along the way**
- Preferences were read-modify-write, so two saves sent together (a style and a look in one click) lost one. `/api/prefs` and the desk setup now merge under a row lock (`src/lib/prefs/extra.ts`). Ten concurrent saves all land.
- Home's greeting and date were rendered in the server's time zone, so everyone outside UTC hit React error 418 (hydration mismatch). `useNow` keeps time-dependent text for the browser. A sweep of every page in four time zones finds none.
- The normalize test pointed at Home's old file.
- An independent review of the evening's work found seven more, all fixed: editing a profile re-ran the desk setup and replaced existing desks and top bars; quick successive saves could be stored out of order (saves now queue per tab); Desk's arrange arrows crossed columns; the setup button re-saved stale notes; a look left in the cookie by another account; Quick calc reached object built-ins; an inbox rollback restored decided items.

**Checks:** every `scripts/test-*.ts` passes. A second load run at 150 users with the badge, inbox, checklist and saves: p95 179 ms, no raw error text, errors only the two stale load-test sessions. Production build, typecheck and lint are clean. A load run at 120 users (desk inbox, checklist and preference saves included) had p95 109 ms and no raw error text; its only errors were stale cookies of two load-test users with 2FA turned on.
