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
