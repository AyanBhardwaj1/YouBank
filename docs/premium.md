# Premium features

Premium features are fully built but only run for people whose plan includes them. This page is the
contract every premium feature follows.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Plans | `src/lib/billing/plans.ts` | The plans in order (free, campus, pro, team, enterprise), their list prices, minimum seats and AI allowances; why they are what they are is in `docs/pricing.md` |
| Billing | `src/lib/billing/stripe.ts`, `/api/billing/{checkout,credits,confirm,portal,invoices,seats,webhook,status}` | Stripe Checkout (plans and credit packs), the billing portal, seats and the webhook that writes `subscriptions` and credit grants; Settings, under Plan |
| Feature registry | `src/lib/billing/features/*.ts` | One list per area (`premium.ts`, `maps.ts`, `crypto.ts`, `desktop.ts`); each feature names the least plan that includes it |
| Entitlements | `src/lib/billing/entitlements.ts` | `entitlements(user)`, `canUse(user, id)` and `requireFeature(user, id)` on the server; a seat on someone's Deal Team or Enterprise subscription counts |
| Plan API | `GET /api/billing/plan` | The signed-in person's plan and unlocked feature ids |
| UI | `src/components/billing/Premium.tsx`, `src/lib/client/plan.ts` | `PremiumBadge`, `PremiumGate`, `usePlan()`, `useFeature(id)` |
| Storage | `subscriptions` (`drizzle/0015_plans.sql`), `ai_credit_grants`, `ai_credit_draws`, `seat_assignments` (`drizzle/0022_credits.sql`) | One row per person with a paid plan or a billing account; no row means Free (Campus for .edu) |

## Rules

1. **Spend only on explicit use.** A premium feature calls a paid API, a large model or heavy compute only
   when a person deliberately starts it (a click, a submitted form). Never from a cron, a prefetch, a page
   load, a background refresh or a preview.
2. **The server decides.** Every route that starts paid work calls `requireFeature(user, id)` first. The
   badge and gate in the UI are hints; they are not the check.
3. **Administrators may always use it.** Anyone in `ADMIN_EMAILS` is treated as Enterprise.
4. **Locked, not hidden.** A locked feature shows its badge and a one-line description, so people can see
   what a plan adds.
5. **Free fallbacks stay.** Where a free method exists, a locked feature falls back to it rather than
   failing.

## Adding a feature

1. Add an entry to your area's file in `src/lib/billing/features/` with a stable `area.name` id. A new
   area (the calendar, the meeting copilot) can use an existing file (`premium.ts` for AI features) or add
   its own file and spread its list into `FEATURES` in `features/index.ts`. If it costs money per use,
   set `metered: true` and `costPerUseUsd`: `costToServe()` counts 4 uses a month at typical use and 20 at
   heavy on every plan that unlocks it, with no edit to `costs.ts`, and `scripts/test-billing.ts` fails if
   the cost is missing or pushes a plan below its margin target. The pricing page's comparison table and
   the Plan tab list the feature by themselves.
2. Call `requireFeature(user, "<id>")` in the route that starts it, before any paid call.
3. Wrap the control in `PremiumGate`, or put a `PremiumBadge` beside it.

## Upgrades that apply on their own, and background work

Some paid upgrades are not a separate action but a better way of doing one (premium reranking under a
question, a premium reader for an upload the person chose). They reach code far below the route, so the
route opens a **premium scope** (`src/lib/billing/use.ts`) and the code that could spend asks
`premiumOn(id)`:

- `premiumScope(user, { auto, require }, fn)`: `require` features were asked for (a 402 if the plan lacks
  one, before anything runs); `auto` features are used when the plan has them and silently skipped
  otherwise, so the free method runs.
- Outside a scope `premiumOn` is always false. Crons, monitors, Inngest passes and prefetches never open
  one, so they keep to the free methods without each job having to say so.
- Work a person started that continues in the background (an upload read by Inngest, a canvas run they
  pressed Run on, a GPU retraining they asked for) re-checks their plan by id (`canUseById`,
  `premiumScopeById`) before it spends, and never retries a paid step on its own.
- Edge's keyed upgrades (`src/lib/edge/premium.ts`) name their feature: `paidOn(upgrade)` is "the key is
  set and the scope holds the feature". `requireReady(feature)` answers a plain 409 when a person asks for
  one YouBank has not set up yet.

## Showing a refusal

`src/components/billing/PlanNotice.tsx` shows a failed request where it happened: a plan refusal (402, or
`requireFeature`'s message) gets a lock and a "See plans" link; anything else is a plain error line.
`isPlanError(e)` tells them apart. Fetch helpers keep the status on the error they throw.

## What the premium work registered

`src/lib/billing/features/premium.ts` lists each feature with `costPerUseUsd` and `perUse` (what one use
is, so the price can be read). The README's "Premium features" section has the same list by plan and
where each appears.
