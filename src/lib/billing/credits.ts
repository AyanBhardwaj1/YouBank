/**
 * AI credit balances. Server only. The arithmetic is in ./packs.ts; this file reads and writes
 * `ai_credit_grants` (one row per pack bought) and `ai_credit_draws` (credits used per allowance period).
 *
 * A person's credits for the current period are everything granted (less refunds) minus what earlier
 * periods used. The current period uses credits once its spend passes the plan's allowance; limits.ts
 * records that use as it happens (`noteDraw`), and when a period has ended its row is settled once from
 * the usage ledger, so a call that finished after the last check is still counted.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { creditsAvailable, packById, remainingByGrant, settledUse, splitSpend, type PackId, type Period } from "./packs";

export type CreditGrant = { id: number; pack: string; usd: number; refundedUsd: number; createdAt: Date };
export type CreditState = {
  /** Granted, less refunds. */
  grantedUsd: number;
  /** Used in periods before the current one. */
  usedBeforeUsd: number;
  /** What the current period may draw on (granted less earlier use). */
  availableUsd: number;
  grants: CreditGrant[];
};

export const NO_CREDITS: CreditState = { grantedUsd: 0, usedBeforeUsd: 0, availableUsd: 0, grants: [] };

async function spendBetween(userId: string, start: Date, end: Date): Promise<number> {
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float` }).from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, start), lt(schema.aiUsage.createdAt, end)));
  return Number(r?.usd ?? 0);
}

/**
 * When a draw row's period really ended: its own end, or sooner if a later period began first (someone who
 * subscribed mid-month moves from the calendar month to their billing anniversary). Pure, for tests.
 */
export function effectiveEnd(row: { periodStart: Date; periodEnd: Date }, laterStarts: Date[]): Date {
  const next = laterStarts.filter((d) => d.getTime() > row.periodStart.getTime()).sort((a, b) => a.getTime() - b.getTime())[0];
  return next && next.getTime() < row.periodEnd.getTime() ? next : row.periodEnd;
}

/** A person's credits for `period`, settling any period that has ended. One or two small queries; none without grants. */
export async function creditState(userId: string, period: Period, now = new Date()): Promise<CreditState> {
  const db = requireDb();
  const grants = await db.select({ id: schema.aiCreditGrants.id, pack: schema.aiCreditGrants.pack, usd: schema.aiCreditGrants.usd, refundedUsd: schema.aiCreditGrants.refundedUsd, createdAt: schema.aiCreditGrants.createdAt })
    .from(schema.aiCreditGrants).where(eq(schema.aiCreditGrants.userId, userId));
  if (!grants.length) return NO_CREDITS;
  const draws = await db.select().from(schema.aiCreditDraws).where(eq(schema.aiCreditDraws.userId, userId));
  const starts = [period.start, ...draws.map((d) => d.periodStart)];
  for (const d of draws) {
    if (d.settled || d.periodStart.getTime() === period.start.getTime()) continue;
    const end = effectiveEnd(d, starts);
    if (end.getTime() > now.getTime()) continue;
    const used = settledUse(d, await spendBetween(userId, d.periodStart, end));
    await db.update(schema.aiCreditDraws).set({ usedUsd: used, settled: true, updatedAt: new Date() })
      .where(and(eq(schema.aiCreditDraws.userId, userId), eq(schema.aiCreditDraws.periodStart, d.periodStart)));
    d.usedUsd = used;
  }
  const grantedUsd = grants.reduce((s, g) => s + Math.max(0, g.usd - g.refundedUsd), 0);
  const usedBeforeUsd = draws.filter((d) => d.periodStart.getTime() !== period.start.getTime()).reduce((s, d) => s + d.usedUsd, 0);
  return { grantedUsd, usedBeforeUsd, availableUsd: creditsAvailable(grantedUsd, usedBeforeUsd), grants };
}

/** What is left of each pack once this period's `usedNowUsd` is counted, oldest first. */
export const packsLeft = (state: CreditState, usedNowUsd: number) => remainingByGrant(state.grants, state.usedBeforeUsd + usedNowUsd);

/**
 * Record this period's credit use so far: spend beyond the allowance, up to what was available. Only ever
 * raises the stored amount, so out-of-order calls from several instances are harmless.
 */
export async function noteDraw(userId: string, period: Period, capUsd: number, availableUsd: number, spendUsd: number): Promise<void> {
  const used = splitSpend(spendUsd, capUsd, availableUsd).credits;
  if (used <= 0) return;
  const t = schema.aiCreditDraws;
  await requireDb().insert(t).values({ userId, periodStart: period.start, periodEnd: period.end, capUsd, availableUsd, usedUsd: used })
    .onConflictDoUpdate({ target: [t.userId, t.periodStart], set: { periodEnd: period.end, capUsd, availableUsd, usedUsd: sql`greatest(${t.usedUsd}, ${used})`, updatedAt: new Date() } });
}

/**
 * Add a pack bought through Stripe. Idempotent on the payment intent: a webhook delivered twice, or one
 * racing the return from Checkout, grants it once. Returns whether this call added it.
 */
export async function grantPack(g: { userId: string; pack: PackId; paymentIntentId: string; sessionId?: string | null; paidCents: number; currency?: string | null }): Promise<boolean> {
  const pack = packById(g.pack);
  if (!pack) throw new Error(`Unknown credit pack: ${g.pack}`);
  const rows = await requireDb().insert(schema.aiCreditGrants).values({
    userId: g.userId, pack: pack.id, usd: pack.creditUsd, paidCents: g.paidCents, currency: g.currency ?? "usd",
    stripePaymentIntentId: g.paymentIntentId, stripeCheckoutSessionId: g.sessionId ?? null,
  }).onConflictDoNothing({ target: schema.aiCreditGrants.stripePaymentIntentId }).returning({ id: schema.aiCreditGrants.id });
  return rows.length > 0;
}

/** A refund or dispute on a pack's payment takes back the same share of its credits (set, not added: the caller passes the whole share). Returns the person, if a pack was found. */
export async function refundPack(paymentIntentId: string, refundedShare: number): Promise<string | null> {
  const share = Math.min(1, Math.max(0, refundedShare));
  const [row] = await requireDb().update(schema.aiCreditGrants).set({ refundedUsd: sql`${schema.aiCreditGrants.usd} * ${share}` })
    .where(eq(schema.aiCreditGrants.stripePaymentIntentId, paymentIntentId)).returning({ userId: schema.aiCreditGrants.userId });
  return row?.userId ?? null;
}
