/**
 * Stripe billing. Server only.
 *
 * - Prices live in Stripe; their ids come from the environment, one per plan and interval
 *   (STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_TEAM_YEARLY, ...) and one per credit pack
 *   (STRIPE_PRICE_PACK_AI10, ...). `scripts/stripe-setup.ts` creates them from PLANS and CREDIT_PACKS and
 *   prints the lines to set. A Team or Enterprise seat count is the line item's quantity. A pack whose
 *   price id is not set is sold with an inline price from CREDIT_PACKS, so packs work as soon as the key is.
 * - Without STRIPE_SECRET_KEY nothing here calls Stripe: the plan page shows prices and says billing is
 *   not switched on, and the routes answer with that sentence.
 * - The `subscriptions` row is only ever written from a subscription as Stripe holds it now (fetched
 *   fresh, never taken from an event's copy), so replayed, duplicated or out-of-order webhooks all
 *   converge on the same row. Credit packs are granted once per payment intent (a unique index), and taken
 *   back by refunds and disputes from the charge as Stripe holds it now. So the
 *   webhook is idempotent by construction.
 * - Every person who reaches Checkout gets one Stripe customer, created with an idempotency key and kept
 *   on their `subscriptions` row (status "none" until they subscribe). Checkout then never runs twice at
 *   once for them: an open session for the same purchase is reused, other open subscription sessions are
 *   expired, the create call carries an idempotency key per person, plan, interval and seats for ten
 *   minutes, and a second live subscription that still slips through is cancelled and refunded.
 */
import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { forgetAiCaps } from "@/lib/ai/limits";
import { logError, OUR_SIDE } from "@/lib/errors";
import { LEGAL, siteLink, siteUrl } from "@/lib/site";
import { grantPack, refundPack } from "./credits";
import { isPackId, packById, type CreditPack, type PackId } from "./packs";
import { seatHolders, trimSeats } from "./seats";
import { intervalsFor, isPlanId, LIVE_STATUSES, PLAN_ORDER, PLANS, type BillingInterval, type PlanId } from "./plans";

export const BILLING_OFF = "Billing isn't switched on yet.";

/** A message for the person and its status. Billing routes answer these directly (billingRoute in ./route), so a 5xx here is not logged twice. */
export class BillingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "BillingError"; }
}

export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY?.trim();

/** Stripe Tax on Checkout, once the owner has switched it on (`stripe-setup --tax`, then STRIPE_AUTOMATIC_TAX=1). */
export const automaticTax = () => /^(1|true|yes|on)$/i.test(process.env.STRIPE_AUTOMATIC_TAX?.trim() ?? "");

/**
 * Require ticking "I agree to the Terms of Service" in Checkout (STRIPE_TERMS_CONSENT=1). Stripe only
 * allows it once a terms URL is set in the dashboard (Settings, Public details), so it is off by default;
 * the terms and refund links are shown under the pay button either way.
 */
export const termsConsent = () => /^(1|true|yes|on)$/i.test(process.env.STRIPE_TERMS_CONSENT?.trim() ?? "");

let client: Stripe | null = null;
/** The Stripe client, created on first use; the SDK pins its own API version. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new BillingError(BILLING_OFF, 503);
  client ??= new Stripe(key, { appInfo: { name: "YouBank" }, maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

/** The environment variable that holds a plan's Stripe price id for an interval. */
export const priceEnv = (plan: PlanId, interval: BillingInterval) => `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
/** The environment variable that holds a credit pack's Stripe price id. */
export const packPriceEnv = (pack: PackId) => `STRIPE_PRICE_PACK_${pack.toUpperCase()}`;

export function priceId(plan: PlanId, interval: BillingInterval): string | null {
  return process.env[priceEnv(plan, interval)]?.trim() || null;
}

/** A credit pack's Stripe price id, or null to sell it with an inline price from CREDIT_PACKS. */
export function packPriceId(pack: PackId): string | null {
  return process.env[packPriceEnv(pack)]?.trim() || null;
}

/** Which plan a Stripe price id sells, from the same environment variables. */
export function planForPrice(id: string | null | undefined, env: Record<string, string | undefined> = process.env): PlanId | null {
  if (!id) return null;
  for (const plan of PLAN_ORDER) for (const interval of intervalsFor(plan)) if (env[priceEnv(plan, interval)]?.trim() === id) return plan;
  return null;
}

/** Which plans and intervals can be bought right now (billing on and the price id set). */
export function purchasable(): Record<PlanId, BillingInterval[]> {
  const on = billingEnabled();
  return Object.fromEntries(PLAN_ORDER.map((p) => [p, on ? intervalsFor(p).filter((i) => !!priceId(p, i)) : []])) as Record<PlanId, BillingInterval[]>;
}

export const MAX_SEATS = 500;

/** Check a checkout request; returns the clean values or throws a BillingError. Pure apart from the environment. */
export function checkoutRequest(body: unknown): { plan: PlanId; interval: BillingInterval; seats: number } {
  const b = (body ?? {}) as { plan?: unknown; interval?: unknown; seats?: unknown };
  if (!isPlanId(b.plan) || !PLANS[b.plan].selfServe) throw new BillingError("Choose Pro, Deal Team or Enterprise.");
  const plan = b.plan;
  const interval = b.interval === "yearly" || b.interval === "monthly" ? b.interval : intervalsFor(plan)[0];
  if (!intervalsFor(plan).includes(interval)) throw new BillingError(`${PLANS[plan].name} is not sold ${interval === "monthly" ? "month to month" : "by the year"}.`);
  const min = PLANS[plan].minSeats;
  const seats = b.seats === undefined ? min : Math.floor(Number(b.seats));
  if (!Number.isFinite(seats) || seats < min) throw new BillingError(`${PLANS[plan].name} starts at ${min} seat${min === 1 ? "" : "s"}.`);
  if (seats > MAX_SEATS) throw new BillingError(`For more than ${MAX_SEATS} seats, write to us and we will set it up.`);
  return { plan, interval, seats: plan === "pro" ? 1 : seats };
}

/** Check a credit pack request. Pure. */
export function packRequest(body: unknown): CreditPack {
  const id = (body as { pack?: unknown } | null)?.pack;
  if (!isPackId(id)) throw new BillingError("Choose a credit pack.");
  return packById(id)!;
}

/** Run a Stripe call; a Stripe failure is logged and becomes the usual "on our side" sentence with its reference. */
export async function stripeCall<T>(where: string, fn: (s: Stripe) => Promise<T>): Promise<T> {
  const s = stripe();
  try {
    return await fn(s);
  } catch (e) {
    if (e instanceof BillingError) throw e;
    const ref = logError(e, { status: 502, where: `billing:${where}` });
    throw new BillingError(`${OUR_SIDE} (ref ${ref}). Try again, and if it keeps happening, quote the reference.`, 502);
  }
}

/* ---------------- Return pages and terms ---------------- */

/** Where Checkout and the portal send people back to: the Plan tab, on the site's own address. */
export const planPage = () => siteLink("/app/settings?tab=plan");

/** A billing portal session for a customer, with the configuration stripe-setup made (STRIPE_PORTAL_CONFIGURATION) when set. */
export function portalSession(customer: string) {
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION?.trim() || undefined;
  return stripeCall("portal", (s) => s.billingPortal.sessions.create({ customer, return_url: planPage(), ...(configuration ? { configuration } : {}) }));
}

/** The terms and refund links under Checkout's pay button, and the consent box when switched on. */
export function checkoutTerms(): Pick<Stripe.Checkout.SessionCreateParams, "custom_text" | "consent_collection"> {
  const base = siteUrl();
  return {
    custom_text: { submit: { message: `By paying you agree to the [Terms of Service](${base}${LEGAL.terms}) and the [Refund policy](${base}${LEGAL.refunds}). Prices exclude tax unless shown.` } },
    ...(termsConsent() ? { consent_collection: { terms_of_service: "required" as const } } : {}),
  };
}

/** Stripe Tax on a Checkout Session for an existing customer: compute tax and save the address it needs. */
export function checkoutTax(): Pick<Stripe.Checkout.SessionCreateParams, "automatic_tax" | "customer_update" | "tax_id_collection"> {
  return automaticTax() ? { automatic_tax: { enabled: true }, customer_update: { address: "auto", name: "auto" }, tax_id_collection: { enabled: true } } : {};
}

/* ---------------- Rows ---------------- */

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;
type RowValues = Omit<SubscriptionRow, "createdAt" | "updatedAt">;

const at = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? new Date(n * 1000) : null);

/** The row a Stripe subscription means for a person. Pure, for tests. */
export function rowFromSubscription(userId: string, sub: Stripe.Subscription, env: Record<string, string | undefined> = process.env): RowValues {
  const items = sub.items?.data ?? [];
  const item = items.find((i) => planForPrice(i.price?.id, env)) ?? items[0];
  const metaPlan = sub.metadata?.plan;
  const plan = planForPrice(item?.price?.id, env) ?? (isPlanId(metaPlan) ? metaPlan : "pro");
  const ends = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  const starts = items.map((i) => i.current_period_start).filter((n): n is number => typeof n === "number");
  const currentPeriodEnd = ends.length ? new Date(Math.max(...ends) * 1000) : null;
  // A cancellation the person asked for in the portal is either "at period end" or a set date; both end it then.
  const cancelAt = at(sub.cancel_at) ?? (sub.cancel_at_period_end ? currentPeriodEnd : null);
  return {
    userId, plan, status: sub.status, seats: Math.max(1, item?.quantity ?? 1),
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd,
    currentPeriodStart: starts.length ? new Date(Math.min(...starts) * 1000) : null,
    billingAnchor: at(sub.billing_cycle_anchor),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || (!!cancelAt && LIVE_STATUSES.includes(sub.status)),
    cancelAt: LIVE_STATUSES.includes(sub.status) ? cancelAt : null,
  };
}

/**
 * Whether an incoming subscription should replace the stored row. It always may, except that a
 * subscription that has ended never overwrites a different one that is still live (someone who
 * switched plans by buying anew, whose old subscription's cancellation arrives afterwards). Pure.
 */
export function shouldApply(existing: Pick<SubscriptionRow, "status" | "stripeSubscriptionId"> | undefined, incoming: Pick<RowValues, "status" | "stripeSubscriptionId">): boolean {
  if (!existing?.stripeSubscriptionId || existing.stripeSubscriptionId === incoming.stripeSubscriptionId) return true;
  return LIVE_STATUSES.includes(incoming.status) || !LIVE_STATUSES.includes(existing.status);
}

/**
 * A second live subscription for someone who already has one: the double checkout this module tries to
 * prevent. True when `incoming` is live, differs from the stored one, and the stored one is live. Pure.
 */
export function isDuplicate(existing: Pick<SubscriptionRow, "status" | "stripeSubscriptionId"> | undefined | null, incoming: Pick<RowValues, "status" | "stripeSubscriptionId">): boolean {
  return !!existing?.stripeSubscriptionId && existing.stripeSubscriptionId !== incoming.stripeSubscriptionId
    && LIVE_STATUSES.includes(existing.status) && LIVE_STATUSES.includes(incoming.status);
}

/**
 * Write a person's row from a subscription as Stripe holds it now. Idempotent. When it would be a second
 * live subscription beside the stored one (two checkouts that both went through), the newer of the two is
 * cancelled and refunded and the older one stays, whichever event arrives first.
 */
export async function applySubscription(userId: string, sub: Stripe.Subscription): Promise<RowValues | null> {
  const db = requireDb();
  let next = rowFromSubscription(userId, sub);
  const [existing] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  if (existing?.stripeSubscriptionId && isDuplicate(existing, next)) {
    const other = await stripeCall("subscription", (s) => s.subscriptions.retrieve(existing.stripeSubscriptionId!));
    if (LIVE_STATUSES.includes(other.status)) {
      const [keep, drop] = other.created <= sub.created ? [other, sub] : [sub, other];
      await cancelDuplicate(userId, drop);
      if (keep.id === existing.stripeSubscriptionId) return null;
      next = rowFromSubscription(userId, keep);
    }
  }
  if (!shouldApply(existing, next)) return null;
  const { plan, status, seats, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, currentPeriodStart, billingAnchor, cancelAtPeriodEnd, cancelAt } = next;
  await db.insert(schema.subscriptions).values(next).onConflictDoUpdate({
    target: schema.subscriptions.userId,
    set: { plan, status, seats, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, currentPeriodStart, billingAnchor, cancelAtPeriodEnd, cancelAt, updatedAt: new Date() },
  });
  forgetAiCaps(userId);
  // A lower seat count (or a move off a team plan) takes the newest seats back.
  for (const id of await trimSeats(userId, next.plan, next.status, next.seats).catch(() => [] as string[])) forgetAiCaps(id);
  return next;
}

/** The person a subscription belongs to: its metadata (set at checkout), else whoever holds its customer. */
export async function userForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.userId?.trim();
  if (fromMeta) return fromMeta;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  return customer ? userForCustomer(customer) : null;
}

export async function userForCustomer(customer: string): Promise<string | null> {
  const [row] = await requireDb().select({ userId: schema.subscriptions.userId }).from(schema.subscriptions).where(eq(schema.subscriptions.stripeCustomerId, customer)).limit(1);
  return row?.userId ?? null;
}

/** Fetch a subscription fresh and store it for its person. Returns the person, or null when unknown. */
export async function syncSubscription(subscriptionId: string, userHint?: string | null): Promise<string | null> {
  const sub = await stripeCall("subscription", (s) => s.subscriptions.retrieve(subscriptionId));
  const userId = userHint?.trim() || (await userForSubscription(sub));
  if (!userId) return null;
  await applySubscription(userId, sub);
  return userId;
}

/**
 * Cancel a duplicate subscription at once and refund what its first invoice took. Logged, so the owner
 * sees it happened. Best effort: a failed refund is logged with the payment to refund by hand.
 */
async function cancelDuplicate(userId: string, sub: Stripe.Subscription): Promise<void> {
  await stripeCall("duplicate:cancel", (s) => s.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false }));
  const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  let refunded = false;
  if (invoiceId) {
    try {
      const inv = await stripe().invoices.retrieve(invoiceId, { expand: ["payments"] });
      for (const p of inv.payments?.data ?? []) {
        const pi = typeof p.payment.payment_intent === "string" ? p.payment.payment_intent : p.payment.payment_intent?.id;
        if (pi && p.status === "paid") { await stripe().refunds.create({ payment_intent: pi, reason: "duplicate" }, { idempotencyKey: `yb-dup-refund-${pi}` }); refunded = true; }
      }
    } catch (e) {
      logError(e, { status: 500, where: "billing:duplicate:refund" });
    }
  }
  logError(new Error(`Duplicate subscription ${sub.id} for ${userId} cancelled${refunded ? " and refunded" : "; refund its first payment by hand"}`), { status: 409, where: "billing:duplicate" });
}

/** A finished Checkout Session: a subscription is stored for its person; a credit pack is granted once it is paid. */
export async function syncCheckoutSession(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.mode === "payment") return grantFromSession(session);
  if (session.mode !== "subscription" || !session.subscription) return null;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  return syncSubscription(subId, session.client_reference_id ?? session.metadata?.userId ?? null);
}

/** Grant the credit pack a paid Checkout Session bought. Idempotent on its payment intent. Returns the person. */
export async function grantFromSession(session: Stripe.Checkout.Session, grant: typeof grantPack = grantPack): Promise<string | null> {
  if (session.mode !== "payment" || session.metadata?.kind !== "credits") return null;
  const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
  const pack = session.metadata?.pack;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  // Card payments are paid at completion; slower methods arrive later as checkout.session.async_payment_succeeded.
  if (!userId || !isPackId(pack) || !pi || session.payment_status !== "paid") return null;
  await grant({ userId, pack, paymentIntentId: pi, sessionId: session.id, paidCents: session.amount_total ?? 0, currency: session.currency });
  forgetAiCaps(userId);
  return userId;
}

/** Dispute outcomes that leave the money with us: won, an inquiry closed, or one prevented by a refund (counted as a refund). */
const DISPUTE_RETURNED = ["won", "warning_closed", "prevented"];

/**
 * The share of a payment taken back: what was refunded, plus what an open or lost dispute holds (a won
 * one gives it back). Pure, for tests.
 */
export function reversedShare(charge: { amount: number; amount_refunded: number }, disputes: { amount: number; status: string }[] = []): number {
  if (!charge.amount) return 0;
  const held = disputes.filter((d) => !DISPUTE_RETURNED.includes(d.status)).reduce((s, d) => s + d.amount, 0);
  return Math.min(1, Math.max(0, (charge.amount_refunded + held) / charge.amount));
}

/**
 * A refund or dispute on a credit pack's payment takes back the same share of its credits, and a won
 * dispute gives it back. The charge and its disputes are read fresh, so events arriving twice or out of
 * order converge. Subscription payments change nothing here.
 */
export async function reverseFromCharge(chargeId: string): Promise<string | null> {
  const charge = await stripeCall("charge", (s) => s.charges.retrieve(chargeId));
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi || !charge.amount) return null;
  const disputes = charge.disputed ? (await stripeCall("disputes", (s) => s.disputes.list({ charge: charge.id, limit: 10 }))).data : [];
  const userId = await refundPack(pi, reversedShare(charge, disputes));
  if (userId) forgetAiCaps(userId);
  return userId;
}

/** This person's stored row, if any. */
export async function subscriptionOf(userId: string): Promise<SubscriptionRow | null> {
  const [row] = await requireDb().select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  return row ?? null;
}

/* ---------------- Customers and Checkout ---------------- */

/**
 * This person's Stripe customer, created once (an idempotency key per person stops two at once) and kept
 * on their `subscriptions` row. A row created here has status "none": a billing account, no plan.
 */
export async function ensureCustomer(user: { id: string; email: string; name?: string }): Promise<string> {
  const row = await subscriptionOf(user.id);
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const customer = await stripeCall("customer", (s) => s.customers.create(
    { email: user.email || undefined, name: user.name || undefined, metadata: { userId: user.id } },
    { idempotencyKey: `yb-customer-${user.id}` },
  ));
  const db = requireDb();
  await db.insert(schema.subscriptions).values({ userId: user.id, plan: "free", status: "none", stripeCustomerId: customer.id })
    .onConflictDoNothing({ target: schema.subscriptions.userId });
  await db.update(schema.subscriptions).set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(and(eq(schema.subscriptions.userId, user.id), isNull(schema.subscriptions.stripeCustomerId)));
  return (await subscriptionOf(user.id))?.stripeCustomerId ?? customer.id;
}

/** Ten-minute window for checkout idempotency keys. */
export const CHECKOUT_WINDOW_MS = 10 * 60_000;

/**
 * The idempotency key for creating a subscription Checkout Session: the same person, plan, interval and
 * seats within the same ten minutes get the same session back from Stripe, however many times the button
 * is pressed or the request is retried. Pure.
 */
export const checkoutKey = (userId: string, plan: PlanId, interval: BillingInterval, seats: number, now = Date.now()) =>
  `yb-checkout-${userId}-${plan}-${interval}-${seats}-${Math.floor(now / CHECKOUT_WINDOW_MS)}`;

/** The same for a credit pack, over one minute (a double click), so a second pack can be bought right after the first. */
export const PACK_WINDOW_MS = 60_000;
export const packCheckoutKey = (userId: string, pack: PackId, now = Date.now()) => `yb-pack-${userId}-${pack}-${Math.floor(now / PACK_WINDOW_MS)}`;

type OpenSession = Pick<Stripe.Checkout.Session, "id" | "url" | "mode" | "metadata" | "status">;

/**
 * Given a person's open Checkout Sessions, which one to send them back to (the same purchase) and which to
 * expire (any other open subscription checkout, so two can never both be paid). Pure.
 */
export function planOpenSessions(open: OpenSession[], want: { mode: "subscription" | "payment"; plan?: string; interval?: string; seats?: number; pack?: string }): { reuse: OpenSession | null; expire: string[] } {
  const live = open.filter((s) => s.status === "open" && s.mode === want.mode);
  const same = (s: OpenSession) => want.mode === "payment"
    ? s.metadata?.pack === want.pack
    : s.metadata?.plan === want.plan && s.metadata?.interval === want.interval && s.metadata?.seats === String(want.seats);
  const reuse = live.find((s) => same(s) && !!s.url) ?? null;
  const expire = want.mode === "subscription" ? live.filter((s) => s.id !== reuse?.id).map((s) => s.id) : [];
  return { reuse, expire };
}

/** A person's open Checkout Sessions, reused or expired by planOpenSessions. */
export async function openSessions(customer: string): Promise<OpenSession[]> {
  const { data } = await stripeCall("checkout:list", (s) => s.checkout.sessions.list({ customer, status: "open", limit: 20 }));
  return data;
}

export async function expireSessions(ids: string[]): Promise<void> {
  // An already completed or expired session cannot be expired; that is fine.
  await Promise.all(ids.map((id) => stripe().checkout.sessions.expire(id).catch(() => undefined)));
}

/**
 * When a Checkout Session expires: about half an hour (Stripe's minimum is 30 minutes), so an abandoned one
 * is not left open for a day. Fixed per idempotency window, because a retried create must send exactly the
 * same parameters as the first or Stripe refuses it. Pure.
 */
export const sessionExpiry = (windowMs = CHECKOUT_WINDOW_MS, now = Date.now()) => Math.floor(((Math.floor(now / windowMs) + 1) * windowMs) / 1000) + 31 * 60;

/**
 * Create a Checkout Session under an idempotency key. The same key within its window returns the session
 * made first: still open, it is the page to send the person to; already paid, the purchase went through
 * (the plan or credits show once Stripe confirms); expired (they chose something else meanwhile), a new
 * one is made under a fresh key.
 */
export async function createCheckout(where: string, params: Stripe.Checkout.SessionCreateParams, key: string): Promise<string> {
  let session = await stripeCall(where, (s) => s.checkout.sessions.create(params, { idempotencyKey: key }));
  if (session.status === "expired") session = await stripeCall(where, (s) => s.checkout.sessions.create(params, { idempotencyKey: `${key}-${Date.now()}` }));
  if (session.status === "complete") throw new BillingError("That payment has already gone through. It shows here as soon as Stripe confirms it; reload this page in a moment.", 409);
  if (!session.url) throw new BillingError("Stripe did not return a checkout page. Try again in a moment.", 502);
  return session.url;
}

/* ---------------- Webhook ---------------- */

/** The webhook events YouBank acts on; scripts/stripe-setup.ts registers exactly these. */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;

/** Drop the cached plan and credits of a person and of everyone holding one of their seats. */
export async function forgetPlan(userId: string): Promise<void> {
  forgetAiCaps(userId);
  for (const id of await seatHolders(userId).catch(() => [] as string[])) forgetAiCaps(id);
}

/** Act on one verified webhook event. Returns the person whose row it touched, if any. */
export async function handleEvent(event: Stripe.Event): Promise<string | null> {
  let userId: string | null = null;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      userId = await syncCheckoutSession(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      userId = await syncSubscription(event.data.object.id, event.data.object.metadata?.userId);
      break;
    case "charge.refunded":
      userId = await reverseFromCharge(event.data.object.id);
      break;
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const charge = event.data.object.charge;
      userId = await reverseFromCharge(typeof charge === "string" ? charge : charge.id);
      break;
    }
    default:
      return null;
  }
  if (userId) await forgetPlan(userId);
  return userId;
}
