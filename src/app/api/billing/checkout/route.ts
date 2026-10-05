import { NextResponse } from "next/server";
import { LIVE_STATUSES, PLANS } from "@/lib/billing/plans";
import { billingRoute } from "@/lib/billing/route";
import { BILLING_OFF, BillingError, billingEnabled, checkoutRequest, MAX_SEATS, priceId, stripeCall, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Start buying a plan: `{ plan, interval: "monthly" | "yearly", seats }` answers `{ url }`, a Stripe
 * Checkout page. Someone who already pays is sent to the billing portal instead (`portal: true`), so
 * nobody ends up holding two subscriptions. The plan itself changes only when Stripe confirms the
 * payment (the webhook, or /api/billing/confirm on the way back).
 */
export async function POST(req: Request) {
  return billingRoute(async (user) => {
    const { plan, interval, seats } = checkoutRequest(await req.json().catch(() => ({})));
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const price = priceId(plan, interval);
    if (!price) throw new BillingError(`${PLANS[plan].name} can't be bought online yet. Write to us and we will set it up.`, 503);
    const origin = new URL(req.url).origin;
    const back = `${origin}/app/settings?tab=plan`;
    const row = await subscriptionOf(user.id);
    if (row?.stripeCustomerId && row.stripeSubscriptionId && LIVE_STATUSES.includes(row.status)) {
      const customer = row.stripeCustomerId;
      const portal = await stripeCall("portal", (s) => s.billingPortal.sessions.create({ customer, return_url: back }));
      return NextResponse.json({ url: portal.url, portal: true });
    }
    const meta = { userId: user.id, plan };
    const session = await stripeCall("checkout", (s) => s.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: seats, ...(PLANS[plan].minSeats > 1 ? { adjustable_quantity: { enabled: true, minimum: PLANS[plan].minSeats, maximum: MAX_SEATS } } : {}) }],
      client_reference_id: user.id,
      ...(row?.stripeCustomerId ? { customer: row.stripeCustomerId } : user.email ? { customer_email: user.email } : {}),
      metadata: meta,
      subscription_data: { metadata: meta },
      allow_promotion_codes: true,
      success_url: `${back}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&checkout=canceled`,
    }));
    if (!session.url) throw new BillingError("Stripe did not return a checkout page. Try again in a moment.", 502);
    return NextResponse.json({ url: session.url });
  });
}
