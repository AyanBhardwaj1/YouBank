import { NextResponse } from "next/server";
import { billingRoute } from "@/lib/billing/route";
import {
  BILLING_OFF, BillingError, billingEnabled, checkoutTax, checkoutTerms, ensureCustomer, openSessions, packCheckoutKey, packPriceId,
  packRequest, planOpenSessions, planPage, sessionExpiry, stripeCall,
} from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Buy an AI credit pack: `{ pack: "ai10" | "ai25" | "ai50" }` answers `{ url }`, a one-time Stripe
 * Checkout page (`mode: "payment"`). The credits are added when Stripe reports the payment (the webhook,
 * or /api/billing/confirm on the way back), once per payment intent. Anyone signed in may buy one, on any
 * plan. An open checkout for the same pack is reused, and a double click gets the same session.
 */
export async function POST(req: Request) {
  return billingRoute(async (user) => {
    const pack = packRequest(await req.json().catch(() => ({})));
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const customer = await ensureCustomer(user);
    const { reuse } = planOpenSessions(await openSessions(customer), { mode: "payment", pack: pack.id });
    if (reuse?.url) return NextResponse.json({ url: reuse.url, reused: true });
    const back = planPage();
    const meta = { userId: user.id, kind: "credits", pack: pack.id };
    const price = packPriceId(pack.id);
    const session = await stripeCall("checkout:pack", (s) => s.checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [price
        ? { price, quantity: 1 }
        : { quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(pack.priceUsd * 100), tax_behavior: "exclusive", product_data: { name: `YouBank ${pack.name}`, metadata: { pack: pack.id } } } }],
      client_reference_id: user.id,
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `YouBank ${pack.name}` },
      allow_promotion_codes: false,
      expires_at: sessionExpiry(),
      ...checkoutTerms(),
      ...checkoutTax(),
      success_url: `${back}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&checkout=canceled`,
    }, { idempotencyKey: packCheckoutKey(user.id, pack.id) }));
    if (!session.url) throw new BillingError("Stripe did not return a checkout page. Try again in a moment.", 502);
    return NextResponse.json({ url: session.url });
  });
}
