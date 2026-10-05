import { NextResponse } from "next/server";
import { aiAllowance } from "@/lib/ai/limits";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";
import { billingEnabled, purchasable, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Everything the plan page shows: the plan and what it unlocks, the stored subscription (renewal or
 * cancellation date), whether billing is on and what can be bought, and the AI spend in this allowance
 * period against the allowance and any credits. Reads only; never calls Stripe, so the page loads (and
 * costs nothing) with or without billing.
 */
export async function GET() {
  return guarded(async (user) => {
    const [ent, row, ai] = await Promise.all([entitlements(user), subscriptionOf(user.id).catch(() => null), aiAllowance(user.id, isAdmin(user))]);
    const on = billingEnabled();
    return NextResponse.json({
      ...ent,
      billing: { enabled: on, purchasable: purchasable(), packs: on },
      subscription: row ? {
        plan: row.plan, status: row.status, seats: row.seats,
        currentPeriodEnd: row.currentPeriodEnd, cancelAtPeriodEnd: row.cancelAtPeriodEnd, cancelAt: row.cancelAt,
        manageable: !!row.stripeCustomerId && on,
      } : null,
      ai,
    });
  });
}
