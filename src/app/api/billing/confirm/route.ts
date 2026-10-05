import { NextResponse } from "next/server";
import { entitlements } from "@/lib/billing/entitlements";
import { billingRoute } from "@/lib/billing/route";
import { BILLING_OFF, BillingError, billingEnabled, forgetPlan, stripeCall, syncCheckoutSession } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Back from Checkout: `{ sessionId }`. Reads the session from Stripe and stores what it bought now (the
 * subscription, or a credit pack once paid), so the change shows at once even when the webhook is a few
 * seconds behind (or not set up yet). Only the person who started the session can confirm it. Doing it
 * twice, or racing the webhook, is harmless: both paths are idempotent. Answers the plan and `kind`.
 */
export async function POST(req: Request) {
  return billingRoute(async (user) => {
    if (!billingEnabled()) throw new BillingError(BILLING_OFF, 503);
    const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: unknown };
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new BillingError("That checkout link is not valid.");
    const session = await stripeCall("confirm", (s) => s.checkout.sessions.retrieve(sessionId));
    if (session.client_reference_id !== user.id) throw new BillingError("That checkout belongs to another account.", 403);
    if (session.status !== "complete") throw new BillingError("That checkout was not finished, so nothing was charged.", 409);
    await syncCheckoutSession(session);
    await forgetPlan(user.id);
    const kind = session.mode === "payment" ? "credits" : "plan";
    return NextResponse.json({ ...(await entitlements(user)), kind, paid: session.payment_status === "paid", pack: session.metadata?.pack ?? null });
  });
}
