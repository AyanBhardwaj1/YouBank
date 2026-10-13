/**
 * The pure half of scripts/stripe-setup.ts: what to create in Stripe for YouBank's plans and credit packs,
 * the customer portal's configuration and the webhook URL. No network, so scripts/test-billing.ts checks it.
 */
import type Stripe from "stripe";
import { LEGAL } from "@/lib/site";
import { CREDIT_PACKS, type CreditPack } from "./packs";
import { intervalsFor, PLAN_ORDER, PLANS, type BillingInterval, type PlanId } from "./plans";
import { MAX_SEATS, packPriceEnv, priceEnv, WEBHOOK_EVENTS } from "./stripe";

/** Stripe's tax code for software as a service sold to businesses. */
export const SAAS_TAX_CODE = "txcd_10103001";

/** Cents per billing period: a month's price, or twelve months of the yearly per-month price. */
export function amountCents(plan: PlanId, interval: BillingInterval): number {
  const p = PLANS[plan];
  const perMonth = interval === "monthly" ? p.monthlyUsd : p.yearlyMonthlyUsd;
  if (!perMonth) throw new Error(`${p.name} has no ${interval} price`);
  return Math.round(perMonth * 100 * (interval === "yearly" ? 12 : 1));
}

export const packCents = (pack: CreditPack) => Math.round(pack.priceUsd * 100);

/** Stable ids and lookup keys, so the script can run again and find what it made. */
export const productId = (plan: PlanId) => `youbank_${plan}`;
export const packProductId = (pack: CreditPack) => `youbank_pack_${pack.id}`;
export const lookupKey = (plan: PlanId, interval: BillingInterval) => `youbank_${plan}_${interval}`;
export const packLookupKey = (pack: CreditPack) => `youbank_pack_${pack.id}`;

/** Every plan price to create: the plans sold online and their intervals. */
export const planPrices = () => PLAN_ORDER.flatMap((plan) => intervalsFor(plan).map((interval) => ({ plan, interval, cents: amountCents(plan, interval), env: priceEnv(plan, interval), lookup: lookupKey(plan, interval) })));
/** Every credit pack price to create. */
export const packPrices = () => CREDIT_PACKS.map((pack) => ({ pack, cents: packCents(pack), env: packPriceEnv(pack.id), lookup: packLookupKey(pack) }));

/** The webhook endpoint for a site address. */
export const webhookUrl = (site: string) => `${site.replace(/\/$/, "")}/api/billing/webhook`;

/** The events the endpoint listens for: exactly what handleEvent acts on. */
export const webhookEvents = () => [...WEBHOOK_EVENTS];

/** Metadata that marks the portal configuration this script manages, so a rerun updates it instead of adding another. */
export const PORTAL_MARK = { youbank: "portal-v1" } as const;

/**
 * The customer portal: people update their card, billing address and tax id, see every invoice, switch
 * between Pro, Deal Team and Enterprise (and monthly or yearly), change the seat count within each plan's
 * limits, and cancel at the end of the period with a reason. Upgrades apply now with prorations; downgrades
 * (a cheaper plan, fewer seats or a shorter interval) wait for the period's end, so nobody is refunded a
 * part-month by accident. `prices` maps each env name to its Stripe price id.
 */
export function portalConfig(site: string, prices: Record<string, string>): Stripe.BillingPortal.ConfigurationCreateParams {
  const base = site.replace(/\/$/, "");
  const products = PLAN_ORDER.filter((plan) => intervalsFor(plan).length).map((plan) => {
    const ids = intervalsFor(plan).map((i) => prices[priceEnv(plan, i)]).filter((v): v is string => !!v);
    const seats = PLANS[plan].minSeats > 1;
    return { product: productId(plan), prices: ids, adjustable_quantity: seats ? { enabled: true, minimum: PLANS[plan].minSeats, maximum: MAX_SEATS } : { enabled: false } };
  }).filter((p) => p.prices.length);
  return {
    name: "YouBank",
    metadata: { ...PORTAL_MARK },
    business_profile: { headline: "YouBank: manage your plan, seats and invoices", privacy_policy_url: `${base}${LEGAL.privacy}`, terms_of_service_url: `${base}${LEGAL.terms}` },
    default_return_url: `${base}/app/settings?tab=plan`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true, mode: "at_period_end", proration_behavior: "none",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "too_complex", "low_quality", "customer_service", "other"] },
      },
      subscription_update: {
        enabled: products.length > 0,
        default_allowed_updates: ["price", "quantity", "promotion_code"],
        proration_behavior: "create_prorations",
        products,
        schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] },
      },
    },
  };
}

/** The lines to set in Vercel, in order. Secrets are shown only when known; the rest say where they come from. */
export function envLines(o: { site: string; keyPrefix: string; webhookSecret: string | null; prices: Record<string, string>; portal: string | null; tax: boolean }): string[] {
  return [
    `NEXT_PUBLIC_SITE_URL=${o.site}`,
    `STRIPE_SECRET_KEY=${o.keyPrefix}...   (the key you ran this with)`,
    o.webhookSecret ? `STRIPE_WEBHOOK_SECRET=${o.webhookSecret}` : "STRIPE_WEBHOOK_SECRET=whsec_...   (shown once when the endpoint is created; otherwise reveal it in the dashboard, Developers > Webhooks > the endpoint > Signing secret)",
    ...Object.entries(o.prices).map(([k, v]) => `${k}=${v}`),
    o.portal ? `STRIPE_PORTAL_CONFIGURATION=${o.portal}` : "STRIPE_PORTAL_CONFIGURATION=   (run without --dry-run to create it)",
    `STRIPE_AUTOMATIC_TAX=${o.tax ? "1" : "0"}${o.tax ? "" : "   (run again with --tax to switch Stripe Tax on)"}`,
    "STRIPE_TERMS_CONSENT=0   (set 1 once the terms URL is saved in Stripe: Settings > Business > Public details)",
  ];
}
