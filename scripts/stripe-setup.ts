/**
 * Create YouBank's products and prices in a Stripe account from PLANS, and print the environment lines to
 * set. Safe to run again: products have fixed ids (youbank_pro, ...), prices are found by lookup key
 * (youbank_pro_monthly, ...), and a price is only created when the amount in PLANS changed, in which case
 * the new price takes over the lookup key and the old one keeps billing the people already on it.
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm exec tsx scripts/stripe-setup.ts
 *   STRIPE_SECRET_KEY=sk_test_... pnpm exec tsx scripts/stripe-setup.ts --webhook https://<host>/api/billing/webhook
 *   STRIPE_SECRET_KEY=sk_live_... pnpm exec tsx scripts/stripe-setup.ts --live
 *
 * --webhook also creates the webhook endpoint (if none has that URL yet) and prints its signing secret,
 * which Stripe shows only once. A live key needs --live, so a test run can never touch real billing.
 */
import Stripe from "stripe";
import { intervalsFor, PLAN_ORDER, PLANS, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { priceEnv, WEBHOOK_EVENTS } from "@/lib/billing/stripe";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

/** Cents per billing period: a month's price, or twelve months of the yearly per-month price. */
export function amountCents(plan: PlanId, interval: BillingInterval): number {
  const p = PLANS[plan];
  const perMonth = interval === "monthly" ? p.monthlyUsd : p.yearlyMonthlyUsd;
  if (!perMonth) throw new Error(`${p.name} has no ${interval} price`);
  return Math.round(perMonth * 100 * (interval === "yearly" ? 12 : 1));
}

async function product(stripe: Stripe, plan: PlanId): Promise<string> {
  const id = `youbank_${plan}`;
  const fields = { name: `YouBank ${PLANS[plan].name}`, description: PLANS[plan].blurb, metadata: { plan } };
  try {
    await stripe.products.retrieve(id);
    await stripe.products.update(id, fields);
    console.log(`  product ${id}: updated`);
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    await stripe.products.create({ id, ...fields });
    console.log(`  product ${id}: created`);
  }
  return id;
}

async function price(stripe: Stripe, productId: string, plan: PlanId, interval: BillingInterval): Promise<string> {
  const lookup = `youbank_${plan}_${interval}`;
  const cents = amountCents(plan, interval);
  const recurring = { interval: interval === "monthly" ? "month" : "year" } as const;
  const { data } = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  const found = data[0];
  if (found && found.unit_amount === cents && found.recurring?.interval === recurring.interval && found.currency === "usd") {
    console.log(`  price ${lookup}: $${cents / 100} per ${recurring.interval} per seat (unchanged)`);
    return found.id;
  }
  const created = await stripe.prices.create({
    product: productId, currency: "usd", unit_amount: cents, recurring, lookup_key: lookup, transfer_lookup_key: true,
    nickname: `${PLANS[plan].name}, ${interval}, per seat`, metadata: { plan, interval }, tax_behavior: "exclusive",
  });
  console.log(`  price ${lookup}: $${cents / 100} per ${recurring.interval} per seat (${found ? "replaces the old amount" : "created"})`);
  return created.id;
}

async function webhook(stripe: Stripe, url: string): Promise<string | null> {
  for await (const w of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (w.url === url) {
      await stripe.webhookEndpoints.update(w.id, { enabled_events: [...WEBHOOK_EVENTS] });
      console.log(`  webhook ${url}: already there (its events updated). Its signing secret is in the Stripe dashboard.`);
      return null;
    }
  }
  const w = await stripe.webhookEndpoints.create({ url, enabled_events: [...WEBHOOK_EVENTS], description: "YouBank plans" });
  console.log(`  webhook ${url}: created`);
  return w.secret ?? null;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) { console.error("Set STRIPE_SECRET_KEY (a test key, sk_test_..., unless you mean to set up live billing)."); process.exit(1); }
  if (key.startsWith("sk_live_") && !flag("live")) { console.error("That is a live key. Run again with --live to set up real billing."); process.exit(1); }
  const stripe = new Stripe(key);
  const env: string[] = [];
  console.log(`Setting up ${key.startsWith("sk_live_") ? "LIVE" : "test"} billing`);
  for (const plan of PLAN_ORDER) {
    const intervals = intervalsFor(plan);
    if (!intervals.length) continue;
    const productId = await product(stripe, plan);
    for (const interval of intervals) env.push(`${priceEnv(plan, interval)}=${await price(stripe, productId, plan, interval)}`);
  }
  const url = value("webhook");
  const secret = url ? await webhook(stripe, url) : null;
  console.log("\nSet these in Vercel (Production; Preview with test keys) and in .env.local:\n");
  console.log(`STRIPE_SECRET_KEY=${key.slice(0, 8)}...   (the key you ran this with)`);
  if (secret) console.log(`STRIPE_WEBHOOK_SECRET=${secret}`);
  else console.log(`STRIPE_WEBHOOK_SECRET=whsec_...   (from the webhook endpoint for /api/billing/webhook${url ? "" : "; or run again with --webhook <url>"})`);
  for (const line of env) console.log(line);
  console.log("\nThen, in the Stripe dashboard: switch on the customer portal (Settings > Billing > Customer portal), and allow plan changes between these prices there if people should switch plans themselves.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
