/**
 * Keeping Edge inside the free tiers. Calls to Modal (compute dollars), Inngest (executions) and R2
 * (class A writes, class B reads) are counted per calendar month in edge_usage; stored bytes are the sum
 * of edge_files. Each service stops taking new work a little before its free allowance runs out. Counts
 * are gathered in memory and written in batches, so metering never adds a database write per operation.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { memo } from "@/lib/memo";

export type Service = "modal" | "inngest" | "r2";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** The ceilings, set below each free tier: Modal $30 of credits, Inngest 50,000 executions, R2 10 GB, 1M class A and 10M class B operations a month. */
export const limits = () => ({
  modalUsd: num(process.env.EDGE_MODAL_MONTHLY_USD, 25),
  inngestExecutions: num(process.env.EDGE_INNGEST_MONTHLY, 45_000),
  r2Bytes: num(process.env.EDGE_R2_MAX_GB, 9) * 1e9,
  r2ClassA: 900_000,
  r2ClassB: 9_000_000,
  docsDbBytes: num(process.env.EDGE_DOCS_DB_MB, 180) * 1e6,
});

export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/** When the month's counters reset: the first day of next month, UTC. Pure. */
export function resetsOn(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

const pending = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Count some use; written within a few seconds (or now, with flushUsage). */
export function addUsage(service: Service, metric: string, delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const key = `${monthOf()}|${service}|${metric}`;
  pending.set(key, (pending.get(key) ?? 0) + delta);
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flushUsage().catch(() => undefined); }, 5_000);
}

export async function flushUsage(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const batch = [...pending.entries()];
  pending.clear();
  if (!batch.length) return;
  const rows = batch.map(([k, v]) => { const [month, service, metric] = k.split("|"); return { month, service, metric, value: v }; });
  await requireDb().insert(schema.edgeUsage).values(rows)
    .onConflictDoUpdate({ target: [schema.edgeUsage.month, schema.edgeUsage.service, schema.edgeUsage.metric], set: { value: sql`${schema.edgeUsage.value} + excluded.value`, updatedAt: new Date() } });
}

/** This month's totals for a service (shared for 30 seconds per instance), including what has not been written yet. */
export async function monthUsage(service: Service): Promise<Record<string, number>> {
  const month = monthOf();
  const rows = await memo(`edge:usage:${month}:${service}`, 30_000, () => requireDb().select().from(schema.edgeUsage)
    .where(sql`${schema.edgeUsage.month} = ${month} and ${schema.edgeUsage.service} = ${service}`));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.metric] = r.value;
  for (const [k, v] of pending) { const [m, s, metric] = k.split("|"); if (m === month && s === service) out[metric] = (out[metric] ?? 0) + v; }
  return out;
}

/** Whether a service may take more work this month, and if not, a message that says when it resumes. Pure core for tests. */
export function allowance(service: Service, used: Record<string, number>, lim = limits(), now = new Date()): { ok: boolean; reason?: string } {
  const until = `resumes ${resetsOn(now)}`;
  if (service === "modal" && (used.usd ?? 0) >= lim.modalUsd) return { ok: false, reason: `The machine-learning service has used this month's free allowance; ${until}. Edge falls back to its built-in methods until then.` };
  if (service === "inngest" && (used.executions ?? 0) >= lim.inngestExecutions) return { ok: false, reason: `Background runs have used this month's free allowance; ${until}. Runs you start still work, a little slower.` };
  if (service === "r2" && ((used.bytes ?? 0) >= lim.r2Bytes || (used.class_a ?? 0) >= lim.r2ClassA || (used.class_b ?? 0) >= lim.r2ClassB)) return { ok: false, reason: `Edge's file storage is full for the beta; ${until} for operations, or when space is freed.` };
  return { ok: true };
}

/** Bytes stored in R2 now (every file Edge keeps), shared for a minute per instance. */
export const storedBytes = () => memo("edge:r2:stored", 60_000, async () => {
  const rows = await requireDb().execute(sql`select coalesce(sum(bytes), 0)::float8 as bytes from edge_files`);
  return Number((rows.rows[0] as { bytes: number } | undefined)?.bytes ?? 0);
});

export async function withinFreeTier(service: Service): Promise<{ ok: boolean; reason?: string }> {
  const used = await monthUsage(service);
  if (service === "r2") used.bytes = await storedBytes();
  return allowance(service, used);
}

/** Everything Edge has used this month against its ceilings, for the status panel. */
export async function usageReport() {
  const [modal, inngest, r2, bytes] = await Promise.all([monthUsage("modal"), monthUsage("inngest"), monthUsage("r2"), storedBytes()]);
  const lim = limits();
  return {
    month: monthOf(), resets: resetsOn(),
    modal: { usd: round(modal.usd ?? 0, 2), limitUsd: lim.modalUsd, calls: modal.calls ?? 0 },
    inngest: { executions: inngest.executions ?? 0, limit: lim.inngestExecutions },
    r2: { bytes, limitBytes: lim.r2Bytes, classA: r2.class_a ?? 0, classB: r2.class_b ?? 0 },
  };
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
