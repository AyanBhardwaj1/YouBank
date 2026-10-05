import { NextResponse } from "next/server";
import { LIVE_STATUSES, PLANS } from "@/lib/billing/plans";
import { billingRoute } from "@/lib/billing/route";
import {
  BILLING_OFF, BillingError, billingEnabled, checkoutKey, checkoutRequest, checkoutTax, checkoutTerms, ensureCustomer, expireSessions,
  MAX_SEATS, openSessions, planOpenSessions, planPage, portalSession, priceId, sessionExpiry, stripeCall, subscriptionOf,
} from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Start buying a plan: `{ plan, interval: "monthly" | "yearly", seats }` answers `{ url }`, a Stripe
 * Checkout page. Nobody ends up holding two subscriptions:
 * - someone who already pays is sent to the billing portal instead (`portal: true`);
 * - an open Checkout for the same plan, interval and seats is reused (`reused: true`), and any other open
 *   subscription checkout of theirs is expired first, so only one can ever be paid;
 * - the create call carries an idempotency key per person, plan, interval and seats for ten minutes, so a
 *   double click or a retried request gets the same session back from Stripe.
 * The plan itself changes only when Stripe confirms the payment (the webhook, or /api/billing/confirm).
 */
export async function POST(req: Request) {
  return billingRoute(async (user) => {
    const { plan, interval, seats } = checkoutRequest(await req.json().catch(() => ({})));
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const price = priceId(plan, interval);
    if (!price) throw new BillingError(`${PLANS[plan].name} can't be bought online yet. Write to us and we will set it up.`, 503);
    const back = planPage();
    const row = await subscriptionOf(user.id);
    if (row?.stripeCustomerId && row.stripeSubscriptionId && LIVE_STATUSES.includes(row.status)) {
      return NextResponse.json({ url: (await portalSession(row.stripeCustomerId)).url, portal: true });
    }
    const customer = await ensureCustomer(user);
    const { reuse, expire } = planOpenSessions(await openSessions(customer), { mode: "subscription", plan, interval, seats });
    await expireSessions(expire);
    if (reuse?.url) return NextResponse.json({ url: reuse.url, reused: true });
    const meta = { userId: user.id, plan, interval, seats: String(seats) };
    const session = await stripeCall("checkout", (s) => s.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: seats, ...(PLANS[plan].minSeats > 1 ? { adjustable_quantity: { enabled: true, minimum: PLANS[plan].minSeats, maximum: MAX_SEATS } } : {}) }],
      client_reference_id: user.id,
      metadata: meta,
      subscription_data: { metadata: { userId: user.id, plan } },
      allow_promotion_codes: true,
      expires_at: sessionExpiry(),
      ...checkoutTerms(),
      ...checkoutTax(),
      success_url: `${back}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&checkout=canceled`,
    }, { idempotencyKey: checkoutKey(user.id, plan, interval, seats) }));
    if (!session.url) throw new BillingError("Stripe did not return a checkout page. Try again in a moment.", 502);
    return NextResponse.json({ url: session.url });
  });
}
