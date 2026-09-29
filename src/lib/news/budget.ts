/**
 * The Newsroom's AI budget: a monthly ceiling (NEWS_AI_BUDGET_USD, $25 by default) on everything the
 * pipeline spends on models, read from the usage ledger (features named "news-…"). Work is tiered so
 * the essentials outlast the extras: personal notes pause first, then research briefs, then the
 * morning brief; story summaries and deal parsing keep going to the cap. Past it, the Newsroom still
 * works: headlines, sources, filings and ranking need no model.
 */
import { and, gte, like, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type Tier = "essential" | "brief" | "research" | "personal";
/** The share of the month's budget each tier may use before it pauses. */
export const CEILING: Record<Tier, number> = { essential: 1, brief: 0.92, personal: 0.8, research: 0.7 };

export function newsBudgetUsd(): number {
  const v = Number(process.env.NEWS_AI_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 ? v : 25;
}

const monthStart = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

let memo: { at: number; usd: number } | null = null;

/** Month-to-date spend on news features, from the ledger (cached for two minutes). */
export async function newsSpend(): Promise<number> {
  if (memo && Date.now() - memo.at < 120_000) return memo.usd;
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)` }).from(schema.aiUsage)
    .where(and(like(schema.aiUsage.feature, "news-%"), gte(schema.aiUsage.createdAt, monthStart())));
  memo = { at: Date.now(), usd: Number(r?.usd ?? 0) };
  return memo.usd;
}

/** Whether work of this tier may run now. Pure, for tests: `spent` of `budget`. */
export function allowedAt(tier: Tier, spent: number, budget: number): boolean {
  return budget > 0 && spent < budget * CEILING[tier];
}

export async function allow(tier: Tier): Promise<boolean> {
  return allowedAt(tier, await newsSpend().catch(() => 0), newsBudgetUsd());
}

/** Count spend the ledger has not caught up with yet (its writes are asynchronous). */
export function noteSpend(usd: number) {
  if (memo && Number.isFinite(usd)) memo.usd += usd;
}

export async function budgetStatus(): Promise<{ spentUsd: number; budgetUsd: number; paused: Tier[] }> {
  const spent = await newsSpend().catch(() => 0), budget = newsBudgetUsd();
  return { spentUsd: spent, budgetUsd: budget, paused: (Object.keys(CEILING) as Tier[]).filter((t) => !allowedAt(t, spent, budget)) };
}
