/**
 * The signal store (F2) in Postgres: one compact row per company, metric and week (or month), upserted
 * as sources are read, pruned to three years of weekly and five of monthly points so year one stays near
 * 50 MB (about 1,000 companies, a dozen metrics). Raw pulls (the postings, the award lists) go to R2 as
 * JSON, kept 400 days for re-audit by a bucket lifecycle rule; moving whole series to R2 later, with only
 * the latest year here, is the documented next step if Postgres space gets tight (docs/edge-next.md).
 *
 * Interface for other features (the Deal Radar, the Thesis Agent, Management Track Record):
 *   putPoints(points)                       write or refresh points
 *   readSeries(nodeId, { metrics, prefix }) a company's series, oldest first
 *   seriesFor(nodeIds, metric)             one metric across companies (boards, sparklines)
 *   noteSeriesSource(nodeId, metric, ...)   provenance, subject `series:<node>:<metric>`, once a month
 */
import { and, gte, inArray, like, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { putJson, r2Ready } from "../infra/r2";
import { record } from "../provenance";
import { metricDef, RETAIN_DAYS, SOURCES } from "./metrics";

export type Point = { nodeId: number; metric: string; period: string; value: number; source: string };
export type SeriesPoint = { period: string; value: number };

/** Write or refresh points (one row per company, metric and period; the newest reading wins). */
export async function putPoints(points: Point[]): Promise<number> {
  const ok = points.filter((p) => p.nodeId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.period) && Number.isFinite(p.value) && p.metric.length <= 60);
  const db = requireDb();
  for (let i = 0; i < ok.length; i += 500) {
    const values = sql.join(ok.slice(i, i + 500).map((p) => sql`(${p.nodeId}, ${p.metric}, ${p.period}::date, ${p.value}, ${p.source.slice(0, 24)})`), sql`, `);
    await db.execute(sql`insert into edge_series (node_id, metric, period, value, source) values ${values}
      on conflict (node_id, metric, period) do update set value = excluded.value, source = excluded.source, retrieved_at = now()`);
  }
  return ok.length;
}

/** A company's series, oldest first: the metrics named, or every metric under a prefix ("jobs."). */
export async function readSeries(nodeId: number, opts: { metrics?: string[]; prefix?: string; since?: string } = {}): Promise<Record<string, SeriesPoint[]>> {
  const conds = [sql`${schema.edgeSeries.nodeId} = ${nodeId}`];
  if (opts.metrics?.length) conds.push(inArray(schema.edgeSeries.metric, opts.metrics));
  if (opts.prefix) conds.push(like(schema.edgeSeries.metric, `${opts.prefix}%`));
  if (opts.since) conds.push(gte(schema.edgeSeries.period, opts.since));
  const rows = await requireDb().select({ metric: schema.edgeSeries.metric, period: schema.edgeSeries.period, value: schema.edgeSeries.value })
    .from(schema.edgeSeries).where(and(...conds)).orderBy(schema.edgeSeries.metric, schema.edgeSeries.period).limit(20_000);
  const out: Record<string, SeriesPoint[]> = {};
  for (const r of rows) (out[r.metric] ??= []).push({ period: String(r.period), value: r.value });
  return out;
}

/** One metric for many companies since a date, by company. */
export async function seriesFor(nodeIds: number[], metric: string, since: string): Promise<Map<number, SeriesPoint[]>> {
  const out = new Map<number, SeriesPoint[]>();
  if (!nodeIds.length) return out;
  const rows = await requireDb().select({ nodeId: schema.edgeSeries.nodeId, period: schema.edgeSeries.period, value: schema.edgeSeries.value }).from(schema.edgeSeries)
    .where(and(inArray(schema.edgeSeries.nodeId, [...new Set(nodeIds)].slice(0, 5000)), sql`${schema.edgeSeries.metric} = ${metric}`, gte(schema.edgeSeries.period, since)))
    .orderBy(schema.edgeSeries.period);
  for (const r of rows) { const list = out.get(r.nodeId) ?? []; list.push({ period: String(r.period), value: r.value }); out.set(r.nodeId, list); }
  return out;
}

/** Drop points older than each cadence keeps (three years weekly, five monthly). Returns rows removed. */
export async function pruneSeries(now = new Date()): Promise<number> {
  const db = requireDb();
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
  const monthly = "(metric like 'usasp.%' or metric like 'warn.%' or metric like 'patents.%')";
  const a = await db.execute(sql`delete from edge_series where period < ${day(RETAIN_DAYS.weekly)}::date and not ${sql.raw(monthly)}`);
  const b = await db.execute(sql`delete from edge_series where period < ${day(RETAIN_DAYS.monthly)}::date and ${sql.raw(monthly)}`);
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}

/** Rows and an estimate of the table's size, for the status line and the storage guard. */
export async function seriesSize(): Promise<{ rows: number; mb: number }> {
  const [r] = (await requireDb().execute(sql`select count(*)::int as rows, coalesce(pg_total_relation_size('edge_series'), 0)::float8 / 1e6 as mb from edge_series`)).rows as { rows: number; mb: number }[];
  return { rows: Number(r?.rows ?? 0), mb: Math.round(Number(r?.mb ?? 0) * 10) / 10 };
}

/**
 * The audit trail for a series: where its points come from, under what licence and by what method. Written
 * once a month per company, metric and source (the points themselves carry their source code and time).
 */
export async function noteSeriesSource(nodeId: number, metric: string, sourceKey: string, url: string, method: string): Promise<void> {
  const subject = `series:${nodeId}:${metric}`;
  const once = `edge:series-prov:${subject}:${sourceKey}:${new Date().toISOString().slice(0, 7)}`;
  if (await cacheGet(once)) return;
  const s = SOURCES[sourceKey] ?? { name: sourceKey, url: "", license: "" };
  await record(subject, [{ sourceName: `${s.name}${metricDef(metric) ? `: ${metricDef(metric)!.label}` : ""}`, sourceUrl: url || s.url, license: s.license, method, modelVersion: "", retrievedAt: new Date() }]);
  await cacheSet(once, "1", 32 * 86_400_000);
}

/** Keep a raw pull in R2 for re-audit (kept 400 days by the bucket's lifecycle rule); a no-op without R2. */
export async function archiveRaw(source: string, nodeId: number, payload: unknown): Promise<string | null> {
  if (!r2Ready()) return null;
  const key = `pulse/raw/${new Date().toISOString().slice(0, 10)}/${source}/${nodeId}.json`;
  await putJson(key, payload).catch(() => undefined);
  return key;
}
