import type Stripe from "stripe";
import { logError, OUR_SIDE } from "@/lib/errors";
import { BILLING_OFF, BillingError, billingEnabled, handleEvent, stripe } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe's webhook. The signature is checked against the raw body with STRIPE_WEBHOOK_SECRET before
 * anything is read; then plan-changing events rewrite the person's `subscriptions` row from the
 * subscription as Stripe holds it now, so a retried or out-of-order delivery changes nothing extra.
 * A failure answers 500, and Stripe retries for up to three days. No session: the proxy lets it through.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !billingEnabled()) return Response.json({ error: BILLING_OFF }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    await handleEvent(event);
  } catch (e) {
    // Stripe failures were logged where they happened; log anything else here.
    const message = e instanceof BillingError ? e.message : `${OUR_SIDE} (ref ${logError(e, { status: 500, where: `billing:webhook:${event.type}` })})`;
    return Response.json({ error: message }, { status: 500 });
  }
  return Response.json({ received: true });
}
