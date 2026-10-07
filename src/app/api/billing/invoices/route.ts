import { NextResponse } from "next/server";
import { billingRoute } from "@/lib/billing/route";
import { billingEnabled, stripeCall, subscriptionOf } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * This person's invoices and receipts, Stripe-hosted (`{ invoices, receipts }`): the latest 24 of each,
 * with links to Stripe's own pages and PDFs. Subscription charges come as invoices; credit packs as
 * receipts. Read only when the Plan tab asks for them, never on page load.
 */
export async function GET() {
  return billingRoute(async (user) => {
    const customer = billingEnabled() ? (await subscriptionOf(user.id).catch(() => null))?.stripeCustomerId : null;
    if (!customer) return NextResponse.json({ invoices: [], receipts: [] });
    const [inv, charges] = await Promise.all([
      stripeCall("invoices", (s) => s.invoices.list({ customer, limit: 24 })),
      stripeCall("receipts", (s) => s.charges.list({ customer, limit: 24 })),
    ]);
    return NextResponse.json({
      invoices: inv.data.filter((i) => i.status !== "draft").map((i) => ({
        id: i.id, number: i.number, status: i.status, created: new Date(i.created * 1000).toISOString(),
        amount: (i.status === "paid" ? i.amount_paid : i.amount_due) / 100, currency: i.currency,
        url: i.hosted_invoice_url ?? null, pdf: i.invoice_pdf ?? null,
      })),
      receipts: charges.data.filter((c) => c.paid && c.receipt_url).map((c) => ({
        id: c.id, description: c.description ?? "Payment", created: new Date(c.created * 1000).toISOString(),
        amount: c.amount / 100, refunded: c.amount_refunded / 100, currency: c.currency, url: c.receipt_url,
      })),
    });
  });
}
