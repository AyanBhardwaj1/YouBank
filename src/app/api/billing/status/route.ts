import { NextResponse } from "next/server";
import { aiAllowance } from "@/lib/ai/limits";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";
import { seatBoard } from "@/lib/billing/seats";
import { billingEnabled, purchasable, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Everything the plan page shows: the plan and what it unlocks (and the seat it comes from, if someone
 * else's subscription gives it), the stored subscription (renewal or cancellation date), the seats a Deal
 * Team or Enterprise owner can give, whether billing is on and what can be bought, and the AI spend in
 * this allowance period against the allowance and any credits. Reads only; never calls Stripe, so the page loads (and
 * costs nothing) with or without billing.
 */
export async function GET() {
  return guarded(async (user) => {
    const [ent, row, ai, seats] = await Promise.all([entitlements(user), subscriptionOf(user.id).catch(() => null), aiAllowance(user.id, isAdmin(user)), seatBoard(user.id).catch(() => null)]);
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
      seats,
    });
  });
}
