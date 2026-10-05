import { NextResponse } from "next/server";
import { billingRoute } from "@/lib/billing/route";
import { BILLING_OFF, BillingError, billingEnabled, stripeCall, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/** Stripe's billing portal for this person (`{ url }`): card, invoices, seats, plan changes, cancelling. */
export async function POST(req: Request) {
  return billingRoute(async (user) => {
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const customer = (await subscriptionOf(user.id))?.stripeCustomerId;
    if (!customer) throw new BillingError("There is no billing account for you yet. Choose a plan first.", 404);
    const portal = await stripeCall("portal", (s) => s.billingPortal.sessions.create({ customer, return_url: `${new URL(req.url).origin}/app/settings?tab=plan` }));
    return NextResponse.json({ url: portal.url });
  });
}
