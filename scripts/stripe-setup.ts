/**
 * Set up YouBank's billing in a Stripe account, test or live, and print every environment variable to set.
 * Safe to run again: everything is found by a fixed id, lookup key or metadata and updated in place.
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm exec tsx scripts/stripe-setup.ts --webhook --domain https://<preview or tunnel>
 *   STRIPE_SECRET_KEY=sk_live_... NEXT_PUBLIC_SITE_URL=https://youbank.com pnpm exec tsx scripts/stripe-setup.ts --live --webhook [--tax]
 *   pnpm exec tsx scripts/stripe-setup.ts --dry-run        (no key needed: prints what it would do)
 *
 * What it does:
 * - Products and prices for every plan sold online (youbank_pro, ...; recurring, per seat) and every AI
 *   credit pack (youbank_pack_ai10, ...; one-time), all tax-exclusive with the SaaS tax code. A price is
 *   only created when its amount changed; the new one takes over the lookup key and people already on
 *   the old one keep it until they change plan.
 * - With --webhook [url]: the endpoint at <domain>/api/billing/webhook (or the url given) listening for
 *   exactly the events YouBank acts on. Its signing secret is printed when it is created (Stripe shows it
 *   only then); a rerun updates its events.
 * - The customer portal configuration: card, address and tax id updates, invoice history, switching
 *   between plans and intervals, seat quantity changes within each plan's limits, cancellation at period
 *   end with a reason, and links to the terms and privacy pages.
 * - With --tax: Stripe Tax defaults (exclusive prices, the SaaS tax code) and the head-office check;
 *   prints STRIPE_AUTOMATIC_TAX=1. Registrations (where you collect tax) are added in the dashboard.
 *
 * The domain comes from --domain, else NEXT_PUBLIC_SITE_URL (src/lib/site.ts). A live key needs --live,
 * --live needs a live key, and a live run refuses to point Stripe at the vercel.app fallback address.
 */
import Stripe from "stripe";
import { packPrices, packProductId, planPrices, portalConfig, PORTAL_MARK, productId, SAAS_TAX_CODE, webhookEvents, webhookUrl, envLines } from "@/lib/billing/setup";
import { PLANS } from "@/lib/billing/plans";
import { DEFAULT_SITE_URL, normaliseSiteUrl, resolveSiteUrl } from "@/lib/site";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
/** The value after --name, unless the next word is another flag. */
const value = (name: string) => { const i = args.indexOf(`--${name}`); const v = i >= 0 ? args[i + 1] : undefined; return v && !v.startsWith("--") ? v : undefined; };

const live = flag("live"), dry = flag("dry-run"), tax = flag("tax");

async function product(stripe: Stripe, id: string, name: string, description: string, metadata: Record<string, string>): Promise<string> {
  const fields = { name, description, metadata, tax_code: SAAS_TAX_CODE };
  try {
    await stripe.products.retrieve(id);
    await stripe.products.update(id, { ...fields, active: true });
    console.log(`  product ${id}: updated`);
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    await stripe.products.create({ id, ...fields });
    console.log(`  product ${id}: created`);
  }
  return id;
}

async function price(stripe: Stripe, p: { product: string; lookup: string; cents: number; recurring?: "month" | "year"; nickname: string; metadata: Record<string, string> }): Promise<string> {
  const { data } = await stripe.prices.list({ lookup_keys: [p.lookup], active: true, limit: 1 });
  const found = data[0];
  const same = found && found.unit_amount === p.cents && found.currency === "usd" && (found.recurring?.interval ?? undefined) === p.recurring && found.tax_behavior === "exclusive";
  const label = `$${p.cents / 100}${p.recurring ? ` per ${p.recurring} per seat` : " once"}`;
  if (same) { console.log(`  price ${p.lookup}: ${label} (unchanged)`); return found.id; }
  const created = await stripe.prices.create({
    product: p.product, currency: "usd", unit_amount: p.cents, lookup_key: p.lookup, transfer_lookup_key: true,
    nickname: p.nickname, metadata: p.metadata, tax_behavior: "exclusive", ...(p.recurring ? { recurring: { interval: p.recurring } } : {}),
  });
  console.log(`  price ${p.lookup}: ${label} (${found ? "replaces the old amount" : "created"})`);
  return created.id;
}

async function webhook(stripe: Stripe, url: string): Promise<string | null> {
  const enabled_events = webhookEvents() as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
  for await (const w of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (w.url === url) {
      await stripe.webhookEndpoints.update(w.id, { enabled_events, disabled: false });
      console.log(`  webhook ${url}: already there; its events are now ${enabled_events.join(", ")}`);
      return null;
    }
  }
  const w = await stripe.webhookEndpoints.create({ url, enabled_events, description: "YouBank plans, credit packs and seats" });
  console.log(`  webhook ${url}: created, listening for ${enabled_events.join(", ")}`);
  return w.secret ?? null;
}

async function portal(stripe: Stripe, site: string, prices: Record<string, string>): Promise<string> {
  const params = portalConfig(site, prices);
  for await (const c of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (c.metadata?.youbank === PORTAL_MARK.youbank) {
      const { metadata, ...rest } = params;
      await stripe.billingPortal.configurations.update(c.id, { ...rest, metadata, active: true });
      console.log(`  portal ${c.id}: updated`);
      return c.id;
    }
  }
  const c = await stripe.billingPortal.configurations.create(params);
  console.log(`  portal ${c.id}: created`);
  return c.id;
}

async function stripeTax(stripe: Stripe): Promise<void> {
  const s = await stripe.tax.settings.update({ defaults: { tax_behavior: "exclusive", tax_code: SAAS_TAX_CODE } });
  if (s.status === "active") console.log("  Stripe Tax: active (exclusive prices, SaaS tax code)");
  else console.log(`  Stripe Tax: ${s.status}. Missing: ${s.status_details?.pending?.missing_fields?.join(", ") || "see the dashboard"}. Add your head-office address in Settings > Tax, then rerun with --tax.`);
  const regs = await stripe.tax.registrations.list({ status: "active", limit: 1 });
  if (!regs.data.length) console.log("  Stripe Tax: no registrations yet, so no tax is collected anywhere. Add where you are registered in the dashboard, Tax > Registrations.");
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const siteRaw = value("domain") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const site = normaliseSiteUrl(siteRaw) ?? resolveSiteUrl(process.env);
  if (!dry) {
    if (!key) { console.error("Set STRIPE_SECRET_KEY (a test key, sk_test_..., unless you mean to set up live billing with --live)."); process.exit(1); }
    // Restricted keys (rk_live_) are live too: they need --live like a secret key does.
    const liveKey = /^(sk|rk)_live_/.test(key);
    if (liveKey && !live) { console.error("That is a live key. Run again with --live to set up real billing."); process.exit(1); }
    if (live && !liveKey) { console.error("--live needs a live key (sk_live_... or rk_live_...). Copy it from the Stripe dashboard once the account is activated."); process.exit(1); }
    if (live && (site === DEFAULT_SITE_URL || !normaliseSiteUrl(siteRaw))) { console.error(`Set NEXT_PUBLIC_SITE_URL (or pass --domain https://<your domain>) for a live run; it would otherwise use ${site}.`); process.exit(1); }
  }
  const hook = flag("webhook") ? value("webhook") ?? webhookUrl(site) : null;
  console.log(`${dry ? "Dry run: what would be set up" : `Setting up ${live ? "LIVE" : "test"} billing`} for ${site}`);

  const prices: Record<string, string> = {};
  if (dry) {
    for (const p of planPrices()) { console.log(`  price ${p.lookup}: $${p.cents / 100} per ${p.interval === "monthly" ? "month" : "year"} per seat`); prices[p.env] = "price_..."; }
    for (const p of packPrices()) { console.log(`  price ${p.lookup}: $${p.cents / 100} once, adds $${p.pack.creditUsd} of AI`); prices[p.env] = "price_..."; }
    if (hook) console.log(`  webhook ${hook}: ${webhookEvents().join(", ")}`);
    const cfg = portalConfig(site, prices);
    console.log(`  portal: plan switches between ${(cfg.features.subscription_update?.products || []).map((p) => p.product).join(", ")}; seat changes; cancel at period end; terms ${cfg.business_profile?.terms_of_service_url}`);
    if (tax) console.log("  Stripe Tax: exclusive prices, SaaS tax code");
    console.log(`\nWould print:\n\n${envLines({ site, keyPrefix: "sk_live_", webhookSecret: null, prices, portal: null, tax }).join("\n")}`);
    return;
  }

  const stripe = new Stripe(key);
  for (const p of planPrices()) {
    const prod = await product(stripe, productId(p.plan), `YouBank ${PLANS[p.plan].name}`, PLANS[p.plan].blurb, { plan: p.plan });
    prices[p.env] = await price(stripe, { product: prod, lookup: p.lookup, cents: p.cents, recurring: p.interval === "monthly" ? "month" : "year", nickname: `${PLANS[p.plan].name}, ${p.interval}, per seat`, metadata: { plan: p.plan, interval: p.interval } });
  }
  for (const p of packPrices()) {
    const prod = await product(stripe, packProductId(p.pack), `YouBank ${p.pack.name}`, `Adds $${p.pack.creditUsd} of AI use at the providers' list prices, used after the plan's monthly allowance. Never expires.`, { pack: p.pack.id });
    prices[p.env] = await price(stripe, { product: prod, lookup: p.lookup, cents: p.cents, nickname: p.pack.name, metadata: { pack: p.pack.id } });
  }
  const secret = hook ? await webhook(stripe, hook) : null;
  const portalId = await portal(stripe, site, prices);
  if (tax) await stripeTax(stripe);

  console.log("\nSet these in Vercel (Production; use a test key and test prices for Preview) and in .env.local, then redeploy:\n");
  console.log(envLines({ site, keyPrefix: key.slice(0, 8), webhookSecret: secret, prices, portal: portalId, tax }).join("\n"));
  if (!hook) console.log("\nNo webhook endpoint was set up: run again with --webhook (it uses <domain>/api/billing/webhook).");
  console.log("\nIn the dashboard: Settings > Business > Public details (terms and privacy URLs, support email), Settings > Customer emails (send receipts for successful payments and refunds), and Radar rules. docs/launch-billing.md has the full list.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
