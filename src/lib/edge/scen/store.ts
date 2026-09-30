/**
 * Saved scenarios: what was asked (the spec), the preview result, and after "Refine" the larger run.
 * Big results (a filled table of thousands of rows) go to R2; the row keeps a preview. Private to the
 * person unless shared with a team, like canvases and uploads.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { myTeamIds } from "@/lib/teams/db";
import { getJson, putJson, r2Ready } from "../infra/r2";

export type ScenarioRow = typeof schema.edgeScenarios.$inferSelect;
export type Kind = "market" | "company" | "gap" | "synthetic" | "practice";

const BIG = 200_000;

export async function saveScenario(userId: string, s: { kind: Kind; title: string; driver: string; spec: Record<string, unknown>; result: Record<string, unknown>; status?: string; teamId?: number | null }): Promise<ScenarioRow> {
  const json = JSON.stringify(s.result);
  let preview = s.result, resultKey = "";
  if (json.length > BIG && r2Ready()) {
    resultKey = `scen/results/${userId.slice(0, 12)}-${Date.now()}.json`;
    await putJson(resultKey, s.result);
    preview = { ...s.result, truncated: true, ...(Array.isArray((s.result as { table?: { rows?: unknown[] } }).table?.rows) ? { table: { ...(s.result as { table: Record<string, unknown> }).table, rows: ((s.result as { table: { rows: unknown[] } }).table.rows).slice(0, 200) } } : {}) };
  }
  const realism = (s.result as { realism?: Record<string, unknown> }).realism ?? {};
  const [row] = await requireDb().insert(schema.edgeScenarios).values({ ownerId: userId, teamId: s.teamId ?? null, title: s.title.slice(0, 200), kind: s.kind, driver: s.driver, spec: s.spec, status: s.status ?? "preview", preview, resultKey, realism }).returning();
  return row;
}

export async function updateScenario(id: number, set: { status?: string; result?: Record<string, unknown>; spec?: Record<string, unknown> }) {
  const patch: Partial<typeof schema.edgeScenarios.$inferInsert> = { updatedAt: new Date() };
  if (set.status) patch.status = set.status;
  if (set.spec) patch.spec = set.spec;
  if (set.result) {
    patch.preview = set.result;
    patch.realism = (set.result as { realism?: Record<string, unknown> }).realism ?? {};
    if (JSON.stringify(set.result).length > BIG && r2Ready()) { patch.resultKey = `scen/results/${id}-${Date.now()}.json`; await putJson(patch.resultKey, set.result); }
  }
  await requireDb().update(schema.edgeScenarios).set(patch).where(eq(schema.edgeScenarios.id, id));
}

/** A scenario the person can see (their own or their team's), with the full result when it was kept in R2. */
export async function getScenario(userId: string, id: number, full = false): Promise<(ScenarioRow & { result: Record<string, unknown> }) | null> {
  const [row] = await requireDb().select().from(schema.edgeScenarios).where(eq(schema.edgeScenarios.id, id));
  if (!row) return null;
  if (row.ownerId !== userId && !(row.teamId && (await myTeamIds(userId)).includes(row.teamId))) return null;
  const result = full && row.resultKey ? ((await getJson<Record<string, unknown>>(row.resultKey)) ?? row.preview) : row.preview;
  return { ...row, result };
}

export async function listScenarios(userId: string, limit = 40) {
  const teams = await myTeamIds(userId);
  return requireDb().select({ id: schema.edgeScenarios.id, title: schema.edgeScenarios.title, kind: schema.edgeScenarios.kind, driver: schema.edgeScenarios.driver, status: schema.edgeScenarios.status, realism: schema.edgeScenarios.realism, updatedAt: schema.edgeScenarios.updatedAt, ownerId: schema.edgeScenarios.ownerId })
    .from(schema.edgeScenarios).where(or(eq(schema.edgeScenarios.ownerId, userId), ...(teams.length ? [inArray(schema.edgeScenarios.teamId, teams)] : []))).orderBy(desc(schema.edgeScenarios.updatedAt)).limit(limit);
}

export async function deleteScenario(userId: string, id: number): Promise<boolean> {
  const res = await requireDb().delete(schema.edgeScenarios).where(and(eq(schema.edgeScenarios.id, id), eq(schema.edgeScenarios.ownerId, userId))).returning({ id: schema.edgeScenarios.id });
  return res.length > 0;
}
