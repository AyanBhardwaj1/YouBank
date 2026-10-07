/**
 * AI credit packs, and the arithmetic of allowance periods and credit drawdown. Pure data and functions,
 * safe to import on the client; the database side is in ./credits.ts and the Stripe side in ./stripe.ts.
 *
 * How credits work:
 * - A pack is a one-time Stripe Checkout payment (`mode: "payment"`). It adds `creditUsd` of AI use, at
 *   the providers' list prices (the same dollars the allowance is measured in), to the buyer's balance.
 *   Credits do not expire and are personal: they never pass to a team.
 * - The plan's allowance is used first. Once a person's spend in the current allowance period passes the
 *   plan's monthly amount, each further dollar comes out of their credits, oldest pack first, until none
 *   are left; then AI pauses as before. The daily cap still guards against a runaway run, but while a
 *   person holds credits it is at least CREDIT_DAILY_USD, so a pack can actually be used.
 * - Credits used in a period are stored per period (`ai_credit_draws`) and settled from the usage ledger
 *   once the period ends, so the balance always matches what was spent.
 *
 * Packs give less AI value than their price: the difference pays Stripe and leaves a margin even when every
 * credit is used (PACK_MARGIN_TARGET, checked by scripts/test-billing.ts). Unused credits are all margin.
 */
import { STRIPE_FEES } from "./costs";

export type PackId = "ai10" | "ai25" | "ai50";

export type CreditPack = {
  id: PackId;
  name: string;
  /** What the person pays, in US dollars, before tax. */
  priceUsd: number;
  /** AI use it adds, in US dollars at list price. */
  creditUsd: number;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "ai10", name: "AI credits: $10 pack", priceUsd: 10, creditUsd: 6 },
  { id: "ai25", name: "AI credits: $25 pack", priceUsd: 25, creditUsd: 15 },
  { id: "ai50", name: "AI credits: $50 pack", priceUsd: 50, creditUsd: 32 },
];

export const PACK_IDS = CREDIT_PACKS.map((p) => p.id);

export const isPackId = (v: unknown): v is PackId => typeof v === "string" && (PACK_IDS as string[]).includes(v);
export const packById = (id: string): CreditPack | undefined => CREDIT_PACKS.find((p) => p.id === id);

/** The least a pack keeps of its price after Stripe's fees when every credit in it is used. */
export const PACK_MARGIN_TARGET = 0.3;

/** While someone holds credits their daily cap is at least this, so a pack is not stuck behind a small plan's daily cap. */
export const CREDIT_DAILY_USD = 10;

/** Stripe's fees on a one-time charge: card processing and Stripe Tax (Stripe Billing does not apply). */
export const packFees = (pack: CreditPack) => pack.priceUsd * (STRIPE_FEES.percent + STRIPE_FEES.taxPercent) + STRIPE_FEES.fixedUsd;

/** (price − fees − credit value) ÷ price: the margin when every credit is used. */
export const packMargin = (pack: CreditPack) => (pack.priceUsd - packFees(pack) - pack.creditUsd) / pack.priceUsd;

/* ---------------- Allowance periods ---------------- */

export type Period = { start: Date; end: Date };

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The anniversary in month `m` of year `y` (months may overflow): the anchor's day, clamped to the month's length, at the anchor's time. */
function anniversary(anchor: Date, y: number, m: number): Date {
  const first = new Date(Date.UTC(y, m, 1));
  const yy = first.getUTCFullYear(), mm = first.getUTCMonth();
  return new Date(Date.UTC(yy, mm, Math.min(anchor.getUTCDate(), daysIn(yy, mm)), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
}

/**
 * The allowance period `now` falls in. With a billing anchor (a subscription's `billing_cycle_anchor`, or
 * the owner's for an assigned seat) the period runs from one monthly anniversary to the next, the way
 * Stripe bills: an anchor on the 31st renews on the 30th in a 30-day month and on the 28th or 29th in
 * February. Yearly plans reset their allowance on the same monthly anniversary. Without an anchor it is
 * the calendar month in UTC.
 */
export function allowancePeriod(now: Date, anchor?: Date | null): Period {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (!anchor || Number.isNaN(anchor.getTime())) return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
  let start = anniversary(anchor, y, m);
  let offset = 0;
  if (start.getTime() > now.getTime()) { offset = -1; start = anniversary(anchor, y, m - 1); }
  return { start, end: anniversary(anchor, y, m + offset + 1) };
}

/* ---------------- Drawdown ---------------- */

/**
 * Where a period's spend came from: the plan's allowance first, then credits, and what is beyond both
 * (only ever a run already in flight when the last dollar went). Pure.
 */
export function splitSpend(spendUsd: number, allowanceUsd: number, creditsUsd: number): { allowance: number; credits: number; beyond: number } {
  const spend = Math.max(0, spendUsd);
  const allowance = Math.min(spend, Math.max(0, allowanceUsd));
  const credits = Math.min(spend - allowance, Math.max(0, creditsUsd));
  return { allowance, credits, beyond: spend - allowance - credits };
}

export type GrantLike = { id: number; pack: string; usd: number; refundedUsd: number; createdAt: Date };

/** What is left of each pack after `usedUsd` of credits, oldest pack first. Pure. */
export function remainingByGrant<G extends GrantLike>(grants: G[], usedUsd: number): (G & { leftUsd: number })[] {
  let used = Math.max(0, usedUsd);
  return [...grants].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).map((g) => {
    const value = Math.max(0, g.usd - g.refundedUsd);
    const take = Math.min(value, used);
    used -= take;
    return { ...g, leftUsd: value - take };
  });
}

/** Credits a person can draw on in a period: everything granted, less what earlier periods used. Pure. */
export const creditsAvailable = (grantedUsd: number, usedBeforeUsd: number) => Math.max(0, grantedUsd - usedBeforeUsd);

/** A finished period's credit use, from its final spend: beyond the allowance, up to what was available. Pure. */
export const settledUse = (row: { capUsd: number; availableUsd: number }, spendUsd: number) => splitSpend(spendUsd, row.capUsd, row.availableUsd).credits;
