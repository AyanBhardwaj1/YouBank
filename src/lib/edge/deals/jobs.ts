/**
 * The deal database's background work (E1, F4). Two parts, both platform data shared by every reader:
 * - discovery, free: the daily pass finds the day's new merger documents on EDGAR (about 2 to 10) and the
 *   backfill walks 2015 to today a month at a time, each document joining its deal or starting a stub;
 * - reading, which spends small-model tokens (about half a cent a deal): only while an administrator has it
 *   switched on, either by setting EDGE_BACKFILL_DAILY_USD (the day's ceiling) or from Edge, Deals (POST
 *   /api/edge/deals/backfill), and never beyond the day's ceiling (measured from the AI usage ledger: the
 *   features "edge-deals-…" with no person attached) or the app-wide AI caps. New deals are read first,
 *   then the backfill's oldest unread. It resumes where it stopped: the cursor lives in edge_job_state.
 * A person can always read one stub on demand (POST /api/edge/deals/[id]/read), counted in their own AI
 * allowance. Background work here never opens a premium scope.
 */
import { and, asc, eq, gte, isNull, like, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { failureMessage, logError } from "@/lib/errors";
import { findDocs, monthEnd, nextMonth } from "./discover";
import { readDeal } from "./extract";
import { upsertFromDoc } from "./store";

export const JOB = "deals.backfill";
export const BACKFILL_FROM = "2015-01";
/** The ceiling an administrator's switch uses when EDGE_BACKFILL_DAILY_USD is not set: about 50 deals a day. */
export const DEFAULT_DAILY_USD = 0.5;
/** Most deals read in one day, whatever the budget (the spec's slices of 50; raise with the budget). */
export const MAX_PER_DAY = 500;

export type BackfillState = { on?: boolean | null; cursor?: string; by?: string; switchedAt?: string; lastRun?: string; lastError?: string; discovered?: number; read?: number; finishedDiscovery?: string };

const envUsd = () => { const n = Number(process.env.EDGE_BACKFILL_DAILY_USD); return Number.isFinite(n) && n > 0 ? n : null; };

/** Whether reading is on and its ceiling: an administrator's switch wins; otherwise the environment's. Pure. */
export function readingPolicy(state: BackfillState, env: number | null): { on: boolean; dailyUsd: number; why: string } {
  if (state.on === false) return { on: false, dailyUsd: 0, why: "switched off by an administrator" };
  if (state.on === true) return { on: true, dailyUsd: env ?? DEFAULT_DAILY_USD, why: `switched on by an administrator${env ? "" : `; ceiling $${DEFAULT_DAILY_USD} a day (EDGE_BACKFILL_DAILY_USD not set)`}` };
  if (env) return { on: true, dailyUsd: env, why: "EDGE_BACKFILL_DAILY_USD is set" };
  return { on: false, dailyUsd: 0, why: "off: set EDGE_BACKFILL_DAILY_USD or switch it on from Edge, Deals" };
}

/** How many more deals today's remaining budget pays for, at about $0.01 a deal (a cautious figure). Pure. */
export const dealsLeft = (dailyUsd: number, spentUsd: number, perDeal = 0.01) => Math.max(0, Math.min(MAX_PER_DAY, Math.floor((dailyUsd - spentUsd) / perDeal + 1e-9)));

export async function getState(): Promise<BackfillState> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, JOB));
  return (r?.state ?? {}) as BackfillState;
}

export async function setState(patch: BackfillState): Promise<BackfillState> {
  const next = { ...(await getState()), ...patch };
  await requireDb().insert(schema.edgeJobState).values({ name: JOB, state: next }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: next, updatedAt: new Date() } });
  return next;
}

/** Today's platform spend on reading deals (no person attached), from the AI usage ledger. */
export async function spentToday(): Promise<number> {
  const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)` }).from(schema.aiUsage)
    .where(and(like(schema.aiUsage.feature, "edge-deals-%"), isNull(schema.aiUsage.userId), gte(schema.aiUsage.createdAt, day)));
  return Number(r?.usd ?? 0);
}

export async function backfillStatus() {
  const state = await getState();
  const policy = readingPolicy(state, envUsd());
  const spent = await spentToday().catch(() => 0);
  const [q] = (await requireDb().execute(sql`select count(*) filter (where extracted_at is null)::int as unread, count(*)::int as deals from edge_deals where owner_id is null`)).rows as { unread: number; deals: number }[];
  return { ...policy, state, spentTodayUsd: Math.round(spent * 10000) / 10000, leftToday: policy.on ? dealsLeft(policy.dailyUsd, spent) : 0, unread: Number(q?.unread ?? 0), deals: Number(q?.deals ?? 0), from: BACKFILL_FROM };
}

/** The day's new merger documents into the database (free: no model). Returns the deals touched. */
export async function discoverRecent(days = 3): Promise<{ docs: number; created: number; added: number }> {
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const docs = await findDocs(from, to);
  let created = 0, added = 0;
  for (const d of docs) { try { const r = await upsertFromDoc(d); if (r.created) created++; if (r.added) added++; } catch (e) { logError(e, { where: "edge-deals-upsert" }); } }
  return { docs: docs.length, created, added };
}

/** One month of the backfill's discovery: proxies and 14D-9s filed that month. Advances the cursor. */
export async function discoverMonth(state: BackfillState): Promise<{ month: string; docs: number; created: number } | null> {
  const month = state.cursor ?? BACKFILL_FROM;
  if (month > new Date().toISOString().slice(0, 7)) return null;
  const docs = await findDocs(`${month}-01`, monthEnd(month), ["proxy", "tender"]);
  let created = 0;
  for (const d of docs) { try { if ((await upsertFromDoc(d)).created) created++; } catch (e) { logError(e, { where: "edge-deals-upsert" }); } }
  await setState({ cursor: nextMonth(month), discovered: (state.discovered ?? 0) + docs.length, ...(nextMonth(month) > new Date().toISOString().slice(0, 7) ? { finishedDiscovery: new Date().toISOString() } : {}) });
  return { month, docs: docs.length, created };
}

/** The next deals to read: unread ones, newest announced first (so today's deals come before 2015's). */
async function unread(limit: number): Promise<number[]> {
  const rows = await requireDb().select({ id: schema.edgeDeals.id }).from(schema.edgeDeals).where(and(isNull(schema.edgeDeals.ownerId), isNull(schema.edgeDeals.extractedAt)))
    .orderBy(sql`${schema.edgeDeals.announcedAt} >= current_date - 30 desc`, asc(schema.edgeDeals.announcedAt)).limit(limit);
  return rows.map((r) => r.id);
}

/**
 * A slice of the backfill within the deadline: discover months until a few are done, then read unread deals
 * while the day's budget lasts. Does nothing while reading is off except discovery (which is free).
 */
export async function backfillSlice(deadline: number, opts: { discoverMonths?: number } = {}): Promise<{ on: boolean; why: string; months: string[]; read: number; budgetLeft: number; error?: string }> {
  const state = await getState();
  const policy = readingPolicy(state, envUsd());
  const months: string[] = [];
  let read = 0, error: string | undefined;
  if (policy.on) {
    for (let i = 0; i < (opts.discoverMonths ?? 3) && Date.now() < deadline - 60_000; i++) {
      const r = await discoverMonth(await getState()).catch((e) => { logError(e, { where: "edge-deals-discover" }); return null; });
      if (!r) break;
      months.push(r.month);
    }
    let left = dealsLeft(policy.dailyUsd, await spentToday());
    for (const id of await unread(Math.min(left, 60))) {
      if (Date.now() > deadline - 70_000 || left <= 0) break;
      try {
        const r = await readDeal(id, { deadline: Math.min(deadline, Date.now() + 90_000) });
        read++;
        if (r.error) { error = r.error; break; }
      } catch (e) { error = failureMessage(e, "edge-deals-backfill"); await requireDb().update(schema.edgeDeals).set({ extractedAt: new Date() }).where(eq(schema.edgeDeals.id, id)); }
      left = dealsLeft(policy.dailyUsd, await spentToday());
    }
  }
  await setState({ lastRun: new Date().toISOString(), read: (state.read ?? 0) + read, ...(error ? { lastError: error.slice(0, 200) } : {}) });
  return { on: policy.on, why: policy.why, months, read, budgetLeft: Math.max(0, policy.dailyUsd - (await spentToday().catch(() => 0))), ...(error ? { error } : {}) };
}

/** The daily pass's part: new documents found (free), and read when reading is on. */
export async function dealsDaily(deadline: number, opts: { slice?: boolean } = {}): Promise<{ discovered: { docs: number; created: number; added: number } | null; slice: Awaited<ReturnType<typeof backfillSlice>> | null }> {
  const discovered = await discoverRecent(3).catch((e) => { logError(e, { where: "edge-deals-daily" }); return null; });
  // With Inngest set up, reading is the backfill function's job (edge/deals.backfill); without it, the pass reads a little.
  const slice = opts.slice !== false && Date.now() < deadline - 80_000 ? await backfillSlice(deadline, { discoverMonths: 1 }).catch((e) => { logError(e, { where: "edge-deals-daily-slice" }); return null; }) : null;
  return { discovered, slice };
}
