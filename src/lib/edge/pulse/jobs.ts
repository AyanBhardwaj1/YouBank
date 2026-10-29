/**
 * The Alt-Data Pulse's background work (E3). All of it reads free public sources:
 * - the daily pass refreshes the companies on people's daily lists (premium: edge.pulse-daily, up to 50
 *   each; the plan is re-checked by id, a perk with no spend) and watched companies not read for a week;
 * - an Inngest cron, edge/pulse.weekly, works through the rest of the universe (companies with a job board,
 *   a Wikipedia article, a federal UEI or a patent assignee in the crosswalk, watched companies, and the
 *   500 most recent startups in /app/vc) in batches of 25 a step, resuming from its cursor;
 * - the same cron measures each metric family's placebo false-alarm rate on stored histories.
 * Background work never opens a premium scope.
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { canUseById } from "@/lib/billing/use";
import { logError } from "@/lib/errors";
import { companyNode, privateNode } from "../entities/resolve";
import { placeboRate } from "../series/change";
import { seriesFor } from "../series/store";
import { loadWarn, refreshCompany } from "./ingest";

const DAY = 86_400_000;
export const DAILY_LIMIT = 50;
export const BATCH = 25;

/** A person's daily list (tickers), from profiles.extra.edge.pulseDaily. Pure. */
export const dailyListOf = (extra: unknown): string[] => {
  const v = ((extra as { edge?: { pulseDaily?: unknown } } | null)?.edge?.pulseDaily);
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, DAILY_LIMIT) : [];
};

export async function setDailyList(userId: string, tickers: string[]): Promise<string[]> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, DAILY_LIMIT);
  await requireDb().execute(sql`update profiles set extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{edge,pulseDaily}', ${JSON.stringify(list)}::jsonb, true) where user_id = ${userId}`);
  return list;
}

/** Nodes for tickers (created from SEC's list when Edge has not met them). */
async function nodesFor(tickers: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const t of [...new Set(tickers)]) { const n = await companyNode(t).catch(() => null); if (n) out.push(n.id); }
  return out;
}

/** The daily pass's part: daily lists (plan re-checked), then watched companies not read for a week, within the deadline. */
export async function pulseDaily(deadline: number): Promise<{ refreshed: number; created: number[]; skipped: number }> {
  const db = requireDb();
  const people = (await db.execute(sql`select user_id, extra from profiles where extra->'edge' ? 'pulseDaily' limit 500`)).rows as { user_id: string; extra: unknown }[];
  const daily: string[] = [];
  for (const p of people) if (await canUseById(p.user_id, "edge.pulse-daily").catch(() => false)) daily.push(...dailyListOf(p.extra));
  const watched = (await db.selectDistinct({ ticker: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId)).where(eq(schema.edgeWatches.kind, "company")).limit(400)).map((r) => r.ticker).filter(Boolean);
  const dailyNodes = await nodesFor(daily);
  const watchedNodes = (await nodesFor(watched)).filter((n) => !dailyNodes.includes(n));
  const stale = watchedNodes.length ? (await db.select({ id: schema.edgeNodes.id, attrs: schema.edgeNodes.attrs }).from(schema.edgeNodes).where(inArray(schema.edgeNodes.id, watchedNodes)))
    .filter((r) => { const at = (r.attrs as { pulseAt?: string }).pulseAt; return !at || Date.now() - Date.parse(at) > 7 * DAY - 3_600_000; }).map((r) => r.id) : [];
  const notices = await loadWarn().catch((e) => { logError(e, { where: "edge-pulse-warn" }); return []; });
  const created: number[] = [];
  let refreshed = 0, skipped = 0;
  for (const id of [...dailyNodes, ...stale]) {
    if (Date.now() > deadline - 20_000) { skipped++; continue; }
    try { const r = await refreshCompany(id, Math.min(deadline, Date.now() + 45_000), { notices }); created.push(...r.created); refreshed++; }
    catch (e) { logError(e, { where: "edge-pulse-daily" }); }
  }
  return { refreshed, created, skipped };
}

/** The universe's next batch after a node id (ascending), and the cursor after it. */
export async function universeBatch(after: number, size = BATCH): Promise<number[]> {
  const db = requireDb();
  const linked = await db.selectDistinct({ id: schema.edgeEntityIds.nodeId }).from(schema.edgeEntityIds)
    .where(and(gt(schema.edgeEntityIds.nodeId, after), eq(schema.edgeEntityIds.status, "active"), inArray(schema.edgeEntityIds.scheme, ["greenhouse", "lever", "ashby", "wikipedia", "uei", "patentsview"])))
    .orderBy(asc(schema.edgeEntityIds.nodeId)).limit(size);
  return linked.map((r) => r.id);
}

/** Bring the 500 most recent /app/vc startups with a website into the graph as private companies (their crosswalk follows). */
export async function seedStartups(limit = 500): Promise<number> {
  const rows = await requireDb().select({ name: schema.startups.name, website: schema.startups.website }).from(schema.startups)
    .where(sql`${schema.startups.website} <> ''`).orderBy(sql`${schema.startups.sourceDate} desc nulls last`).limit(limit);
  let n = 0;
  for (const r of rows) { if (await privateNode(r.name, r.website).catch(() => null)) n++; }
  return n;
}

/** One weekly step: the next batch of the universe from the cursor. Returns the next cursor (0 when done). */
export async function weeklyStep(after: number, deadline: number): Promise<{ next: number; refreshed: number; created: number[] }> {
  const ids = await universeBatch(after);
  if (!ids.length) return { next: 0, refreshed: 0, created: [] };
  const notices = await loadWarn().catch(() => []);
  const created: number[] = [];
  let refreshed = 0, last = after;
  for (const id of ids) {
    if (Date.now() > deadline - 15_000) break;
    try { const r = await refreshCompany(id, Math.min(deadline, Date.now() + 40_000), { notices }); created.push(...r.created); refreshed++; }
    catch (e) { logError(e, { where: "edge-pulse-weekly" }); }
    last = id;
  }
  return { next: last, refreshed, created };
}

/** The families whose false-alarm rate is measured, with the metric that represents each and the cadence's minimum history. */
export const PLACEBO_FAMILIES: { family: string; metric: string; minPoints: number }[] = [
  { family: "jobs", metric: "jobs.open", minPoints: 40 }, { family: "jobs.dept", metric: "jobs.dept.engineering", minPoints: 40 },
  { family: "attention", metric: "wiki.views", minPoints: 60 }, { family: "patents", metric: "patents.grants", minPoints: 30 },
];

/** Measure each family's placebo false-alarm rate on up to 20 stored histories and keep it (edge_job_state 'pulse.placebo'). */
export async function measurePlacebo(): Promise<Record<string, { perYear: number; years: number; companies: number }>> {
  const db = requireDb();
  const out: Record<string, { perYear: number; years: number; companies: number }> = {};
  for (const f of PLACEBO_FAMILIES) {
    const ids = ((await db.execute(sql`select node_id from edge_series where metric = ${f.metric} group by node_id having count(*) >= ${f.minPoints} limit 20`)).rows as { node_id: number }[]).map((r) => Number(r.node_id));
    if (!ids.length) continue;
    const hist = await seriesFor(ids, f.metric, new Date(Date.now() - 6 * 365 * DAY).toISOString().slice(0, 10));
    let alarms = 0, years = 0;
    for (const pts of hist.values()) { const r = placeboRate(pts.map((p) => p.value), { copies: 5 }); if (r.years) { alarms += r.alarms; years += r.years; } }
    if (years > 0) out[f.family] = { perYear: alarms / years, years: Math.round(years * 10) / 10, companies: hist.size };
  }
  await db.insert(schema.edgeJobState).values({ name: "pulse.placebo", state: out }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: out, updatedAt: new Date() } });
  return out;
}

export async function weeklyCursor(): Promise<{ after: number; startedAt?: string }> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "pulse.weekly"));
  return (r?.state ?? { after: 0 }) as { after: number; startedAt?: string };
}
export async function setWeeklyCursor(state: { after: number; startedAt?: string; finishedAt?: string }): Promise<void> {
  await requireDb().insert(schema.edgeJobState).values({ name: "pulse.weekly", state }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state, updatedAt: new Date() } });
}
