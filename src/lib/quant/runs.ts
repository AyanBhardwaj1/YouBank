/**
 * Saved analyses (quant_runs): every integrity report, factor run, risk run, TCA report, risk budget, drill
 * session and live-gate override, with its inputs, outputs, sources and model version, so each is
 * reproducible and the person can see their own history. Owner-scoped.
 */
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type RunKind = "integrity" | "integrity_override" | "factors" | "risk" | "sizing" | "risk_budget" | "tca" | "drill" | "drill_session" | "events";

export type SourceRef = { label: string; url?: string; licence?: string; retrievedAt?: string };

export async function saveRun(ownerId: string, kind: RunKind, input: Record<string, unknown>, output: Record<string, unknown>, sources: SourceRef[], modelVersion: string): Promise<number> {
  const [row] = await requireDb().insert(schema.quantRuns).values({ ownerId, kind, input, output, sources, modelVersion }).returning({ id: schema.quantRuns.id });
  return row.id;
}

/** Best effort: an analysis is still shown when its audit row could not be written (logged by the caller's guard). */
export async function trySaveRun(...args: Parameters<typeof saveRun>): Promise<number | null> {
  try { return await saveRun(...args); } catch { return null; }
}

export async function runsOf(ownerId: string, kind?: RunKind, limit = 50) {
  return requireDb().select().from(schema.quantRuns).where(and(eq(schema.quantRuns.ownerId, ownerId), kind ? eq(schema.quantRuns.kind, kind) : undefined)).orderBy(desc(schema.quantRuns.createdAt)).limit(Math.min(limit, 500));
}

export async function getRun(ownerId: string, id: number) {
  const [row] = await requireDb().select().from(schema.quantRuns).where(and(eq(schema.quantRuns.ownerId, ownerId), eq(schema.quantRuns.id, id)));
  return row ?? null;
}
