/**
 * Q4's risk budgets: saved as versions in quant_runs (kind risk_budget) and announced to the algo engine with
 * quant/riskbudget.updated, which may adopt a budget or tighten it, never loosen it. Owner-scoped.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { RiskBudget } from "../contracts";
import { emit, QUANT_EVENTS } from "../jobs";
import { saveRun } from "../runs";
import { validateRiskBudget } from "../validate";
import { SIZING_VERSION } from "./governor";

export async function saveRiskBudget(budget: RiskBudget, input: Record<string, unknown>): Promise<{ id: number; event: boolean }> {
  const v = validateRiskBudget(budget);
  if (!v.ok) throw Object.assign(new Error(`The budget is not valid: ${v.errors.slice(0, 3).join("; ")}`), { status: 422 });
  const id = await saveRun(budget.ownerId, "risk_budget", input, budget as unknown as Record<string, unknown>, [], SIZING_VERSION);
  const e = await emit(QUANT_EVENTS.riskBudgetUpdated, { ownerId: budget.ownerId, accountRef: budget.accountRef, runId: id }, `quant-budget-${id}`);
  return { id, event: e.sent };
}

/** The person's latest budget for an account (null account = their default). */
export async function latestRiskBudget(ownerId: string, accountRef: string | null = null): Promise<(RiskBudget & { version: number }) | null> {
  const [row] = await requireDb().select().from(schema.quantRuns)
    .where(and(eq(schema.quantRuns.ownerId, ownerId), eq(schema.quantRuns.kind, "risk_budget"), accountRef ? sql`${schema.quantRuns.output}->>'accountRef' = ${accountRef}` : sql`${schema.quantRuns.output}->>'accountRef' is null`))
    .orderBy(desc(schema.quantRuns.createdAt)).limit(1);
  return row ? { ...(row.output as unknown as RiskBudget), version: row.id } : null;
}
