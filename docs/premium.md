# Premium features

Premium features are fully built but only run for people whose plan includes them. This page is the
contract every premium feature follows.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Plans | `src/lib/billing/plans.ts` | The plans in order (free, campus, pro, team, enterprise) and their list prices |
| Feature registry | `src/lib/billing/features/*.ts` | One list per area (`premium.ts`, `maps.ts`, `crypto.ts`, `desktop.ts`); each feature names the least plan that includes it |
| Entitlements | `src/lib/billing/entitlements.ts` | `entitlements(user)`, `canUse(user, id)` and `requireFeature(user, id)` on the server |
| Plan API | `GET /api/billing/plan` | The signed-in person's plan and unlocked feature ids |
| UI | `src/components/billing/Premium.tsx`, `src/lib/client/plan.ts` | `PremiumBadge`, `PremiumGate`, `usePlan()`, `useFeature(id)` |
| Storage | `subscriptions` table, `drizzle/0015_plans.sql` | One row per person with a paid or granted plan; no row means Free (Campus for .edu) |

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

1. Add an entry to your area's file in `src/lib/billing/features/` with a stable `area.name` id.
2. Call `requireFeature(user, "<id>")` in the route that starts it, before any paid call.
3. Wrap the control in `PremiumGate`, or put a `PremiumBadge` beside it.
