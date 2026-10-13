import { NextResponse } from "next/server";
import { billingRoute } from "@/lib/billing/route";
import { BILLING_OFF, BillingError, billingEnabled, portalSession, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe's billing portal for this person (`{ url }`): card, invoices and receipts, seats, plan changes,
 * cancelling. It opens with the configuration scripts/stripe-setup.ts made (STRIPE_PORTAL_CONFIGURATION)
 * and returns to the Plan tab on the site's own address.
 */
export async function POST() {
  return billingRoute(async (user) => {
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const customer = (await subscriptionOf(user.id))?.stripeCustomerId;
    if (!customer) throw new BillingError("There is no billing account for you yet. Choose a plan or buy credits first.", 404);
    return NextResponse.json({ url: (await portalSession(customer)).url });
  });
}
