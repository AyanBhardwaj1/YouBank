/**
 * Stripe billing. Server only.
 *
 * - Prices live in Stripe; their ids come from the environment, one per plan and interval
 *   (STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_TEAM_YEARLY, ...). `scripts/stripe-setup.ts` creates them
 *   from PLANS and prints the lines to set. A Team or Enterprise seat count is the line item's quantity.
 * - Without STRIPE_SECRET_KEY nothing here calls Stripe: the plan page shows prices and says billing is
 *   not switched on, and the routes answer with that sentence.
 * - The `subscriptions` row is only ever written from a subscription as Stripe holds it now (fetched
 *   fresh, never taken from an event's copy), so replayed, duplicated or out-of-order webhooks all
 *   converge on the same row: the webhook is idempotent by construction.
 */
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { forgetAiCaps } from "@/lib/ai/limits";
import { logError, OUR_SIDE } from "@/lib/errors";
import { intervalsFor, isPlanId, LIVE_STATUSES, PLAN_ORDER, PLANS, type BillingInterval, type PlanId } from "./plans";

export const BILLING_OFF = "Billing isn't switched on yet.";

/** A message for the person and its status. Billing routes answer these directly (billingRoute in ./route), so a 5xx here is not logged twice. */
export class BillingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "BillingError"; }
}

export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY?.trim();

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

export function priceId(plan: PlanId, interval: BillingInterval): string | null {
  return process.env[priceEnv(plan, interval)]?.trim() || null;
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

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;
type RowValues = Omit<SubscriptionRow, "createdAt" | "updatedAt">;

/** The row a Stripe subscription means for a person. Pure, for tests. */
export function rowFromSubscription(userId: string, sub: Stripe.Subscription, env: Record<string, string | undefined> = process.env): RowValues {
  const items = sub.items?.data ?? [];
  const item = items.find((i) => planForPrice(i.price?.id, env)) ?? items[0];
  const metaPlan = sub.metadata?.plan;
  const plan = planForPrice(item?.price?.id, env) ?? (isPlanId(metaPlan) ? metaPlan : "pro");
  const ends = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return {
    userId, plan, status: sub.status, seats: Math.max(1, item?.quantity ?? 1),
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
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

/** Write a person's row from a subscription as Stripe holds it now. Idempotent. */
export async function applySubscription(userId: string, sub: Stripe.Subscription): Promise<RowValues | null> {
  const db = requireDb();
  const next = rowFromSubscription(userId, sub);
  const [existing] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  if (!shouldApply(existing, next)) return null;
  const { plan, status, seats, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd } = next;
  await db.insert(schema.subscriptions).values(next).onConflictDoUpdate({
    target: schema.subscriptions.userId, set: { plan, status, seats, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, updatedAt: new Date() },
  });
  forgetAiCaps(userId);
  return next;
}

/** The person a subscription belongs to: its metadata (set at checkout), else whoever holds its customer. */
export async function userForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.userId?.trim();
  if (fromMeta) return fromMeta;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customer) return null;
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

/** A finished Checkout Session: store its subscription for the person who started it. */
export async function syncCheckoutSession(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.mode !== "subscription" || !session.subscription) return null;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  return syncSubscription(subId, session.client_reference_id ?? session.metadata?.userId ?? null);
}

/** This person's stored row, if any. */
export async function subscriptionOf(userId: string): Promise<SubscriptionRow | null> {
  const [row] = await requireDb().select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  return row ?? null;
}

/** The webhook events that change a plan; everything else is acknowledged and ignored. */
export const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const;

/** Act on one verified webhook event. Returns the person whose row it touched, if any. */
export async function handleEvent(event: Stripe.Event): Promise<string | null> {
  switch (event.type) {
    case "checkout.session.completed":
      return syncCheckoutSession(event.data.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscription(event.data.object.id, event.data.object.metadata?.userId);
    default:
      return null;
  }
}
