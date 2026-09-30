/**
 * Deployed canvases. A monitor re-runs its canvas daily or weekly; when a run finishes, every signal
 * block in it is checked against its line, and a crossing alerts the owner straight away or in the
 * daily digest, as they chose. Three monitors per person during the beta.
 */
import { and, asc, eq, lte, ne, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { logError } from "@/lib/errors";
import { MONITOR_LIMIT } from "./access";
import { alertLater, alertNow } from "./alerts";
import type { Graph } from "./canvas/catalog";
import { onRunFinished, reapStuckRuns, startRun } from "./canvas/engine";
import { canvasAccess } from "./canvas/store";
import type { Signal } from "./canvas/values";

const DAY = 86_400_000;
const intervalOf = (schedule: string) => (schedule === "weekly" ? 7 * DAY : DAY);

export async function deployMonitor(user: CurrentUser, canvasId: number, opts: { schedule?: string; alert?: string }) {
  const { row } = await canvasAccess(user, canvasId, "edit");
  const db = requireDb();
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from edge_monitors where owner_id = ${user.id} and active and canvas_id <> ${canvasId}`)).rows as { n: number }[];
  if (n >= MONITOR_LIMIT) throw Object.assign(new Error(`The beta allows ${MONITOR_LIMIT} deployed canvases each. Stop one to deploy another.`), { status: 429 });
  const schedule = opts.schedule === "weekly" ? "weekly" : "daily";
  const alert = opts.alert === "immediate" ? "immediate" : "digest";
  const hasSignal = (row.graph as Graph).nodes.some((x) => x.type === "out.signal");
  const [m] = await db.insert(schema.edgeMonitors).values({ canvasId, ownerId: user.id, schedule, alert, active: true, nextRunAt: new Date(Date.now() + intervalOf(schedule)) })
    .onConflictDoUpdate({ target: schema.edgeMonitors.canvasId, set: { ownerId: user.id, schedule, alert, active: true, nextRunAt: new Date(Date.now() + intervalOf(schedule)) } }).returning();
  const runId = await startRun(user, canvasId, "monitor");
  await db.update(schema.edgeMonitors).set({ lastRunId: runId }).where(eq(schema.edgeMonitors.id, m.id));
  return { monitor: m, runId, hasSignal };
}

export async function stopMonitor(user: CurrentUser, canvasId: number) {
  await canvasAccess(user, canvasId, "edit");
  await requireDb().update(schema.edgeMonitors).set({ active: false }).where(eq(schema.edgeMonitors.canvasId, canvasId));
}

export async function monitorOf(canvasId: number) {
  const [m] = await requireDb().select().from(schema.edgeMonitors).where(eq(schema.edgeMonitors.canvasId, canvasId));
  return m ?? null;
}

/** Start the runs that are due (and mark runs that died as failed). */
export async function tickMonitors(deadline: number): Promise<{ started: number; reaped: number }> {
  const db = requireDb();
  const reaped = await reapStuckRuns();
  const due = await db.select({ m: schema.edgeMonitors, owner: schema.profiles.email, name: schema.profiles.name, extra: schema.profiles.extra })
    .from(schema.edgeMonitors).innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeMonitors.ownerId))
    .where(and(eq(schema.edgeMonitors.active, true), lte(schema.edgeMonitors.nextRunAt, new Date()), sql`${schema.profiles.extra}->'edge'->>'beta' = 'true'`))
    .orderBy(asc(schema.edgeMonitors.nextRunAt)).limit(20);
  let started = 0;
  for (const { m, owner, name } of due) {
    if (Date.now() > deadline) break;
    try {
      const runId = await startRun({ id: m.ownerId, email: owner, name }, m.canvasId, "monitor");
      await db.update(schema.edgeMonitors).set({ lastRunId: runId, nextRunAt: new Date(Date.now() + intervalOf(m.schedule)) }).where(eq(schema.edgeMonitors.id, m.id));
      started++;
    } catch (e) {
      logError(e, { where: "edge-monitor-start" });
      // A canvas that cannot run (a block removed, a limit) waits a day rather than retrying every hour.
      await db.update(schema.edgeMonitors).set({ nextRunAt: new Date(Date.now() + DAY) }).where(eq(schema.edgeMonitors.id, m.id));
    }
  }
  return { started, reaped };
}

/** After a monitor's run: compare its signals and alert. */
onRunFinished(async (runId) => {
  const db = requireDb();
  const [run] = await db.select().from(schema.edgeRuns).where(eq(schema.edgeRuns.id, runId));
  if (!run || run.trigger !== "monitor") return;
  const [m] = await db.select().from(schema.edgeMonitors).where(eq(schema.edgeMonitors.canvasId, run.canvasId));
  const [canvas] = await db.select({ title: schema.edgeCanvases.title }).from(schema.edgeCanvases).where(eq(schema.edgeCanvases.id, run.canvasId));
  if (!m || !canvas) return;
  const signalNodes = new Set((run.graph as Graph).nodes.filter((n) => n.type === "out.signal").map((n) => n.id));
  const steps = await db.select().from(schema.edgeRunSteps).where(and(eq(schema.edgeRunSteps.runId, runId), eq(schema.edgeRunSteps.status, "done"), ne(schema.edgeRunSteps.nodeId, "")));
  const signals = steps.filter((s) => signalNodes.has(s.nodeId)).map((s) => (s.output as { signal?: Signal } | null)?.signal).filter((s): s is Signal => !!s);
  const crossedOnes = signals.filter((s) => s.triggered);
  await db.update(schema.edgeMonitors).set({ lastSignal: Object.fromEntries(signals.map((s, i) => [String(i), s.value])) }).where(eq(schema.edgeMonitors.id, m.id));
  if (!crossedOnes.length) return;
  const title = `${canvas.title}: ${crossedOnes.map((s) => `${s.metric} ${s.previous !== null && s.previous !== undefined ? `${s.previous} → ` : ""}${s.value}`).join("; ")}`;
  const url = `/app/edge?view=canvases&canvas=${run.canvasId}&run=${runId}`;
  if (m.alert === "immediate") await alertNow(m.ownerId, { subject: `run:${runId}`, title, body: crossedOnes.map((s) => s.detail).filter(Boolean).join(" "), url, reasons: ["Your deployed canvas"], urgent: false });
  else await alertLater(m.ownerId, `run:${runId}`);
});
