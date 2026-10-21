/**
 * Running AI spend per UTC day, beside the ledger (ai_usage), in `ai_spend` (drizzle/0027_scale.sql): one
 * row per person per day, and everyone's total split over EVERYONE_SHARDS rows ('*:0' to '*:15'), so the
 * calls of hundreds of people do not all queue on one row's lock (measured: one shared row made the
 * statement wait 11 ms on average at 300 virtual users).
 *
 * Each recorded model call adds its cost to both rows in one atomic statement (INSERT ... ON CONFLICT DO
 * UPDATE SET usd = usd + cost ... RETURNING), so concurrent calls on any number of instances never lose an
 * update, and the new totals come straight back. The daily caps (./limits) read these two rows by primary
 * key instead of summing the ledger, which a few seconds' memo per instance keeps cheap. The ledger stays
 * the record (and the backstop: the limits take the larger of the two), so a counter row that is missing
 * (the migration not applied yet) or behind (it started mid-day) never lets anyone past a cap.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export const EVERYONE = "*";
export const EVERYONE_SHARDS = 16;
/** Everyone's rows: the shards, and the unsharded row in case one was written. */
const EVERYONE_SCOPES = [EVERYONE, ...Array.from({ length: EVERYONE_SHARDS }, (_, i) => `${EVERYONE}:${i}`)];
const shard = () => `${EVERYONE}:${Math.floor(Math.random() * EVERYONE_SHARDS)}`;

/** The UTC day a moment falls in, as the table keys it (YYYY-MM-DD). Pure. */
export const utcDay = (at: Date = new Date()) => at.toISOString().slice(0, 10);

export type DayTotals = { mine: number | null; everyone: number };

/**
 * Add `usd` to today's totals for the person (when there is one) and for everyone (one random shard),
 * atomically, and return the person's total after the addition with everyone's (the shards read in the same
 * statement). The rows are locked person first, shard second, in every call, so concurrent calls cannot
 * deadlock.
 */
export async function addSpend(userId: string | null, usd: number, at: Date = new Date()): Promise<DayTotals> {
  if (!Number.isFinite(usd) || usd <= 0) return readSpend(userId, at);
  const day = utcDay(at), s = shard();
  const rows = userId && !userId.startsWith(EVERYONE)
    ? sql`(${userId}, ${day}::date, ${usd}::float8, 1), (${s}, ${day}::date, ${usd}::float8, 1)`
    : sql`(${s}, ${day}::date, ${usd}::float8, 1)`;
  const others = sql.join(EVERYONE_SCOPES.filter((x) => x !== s).map((x) => sql`${x}`), sql`, `);
  // The other shards are read in the same statement (as of its start); the written rows come back new.
  const r = await requireDb().execute<{ scope: string; usd: number }>(sql`
    with added as (
      insert into ai_spend (scope, day, usd, calls) values ${rows}
      on conflict (scope, day) do update set usd = ai_spend.usd + excluded.usd, calls = ai_spend.calls + 1, updated_at = now()
      returning scope, usd
    )
    select scope, usd from added
    union all
    select scope, usd from ai_spend where day = ${day}::date and scope in (${others})`);
  return totalsOf(r.rows, userId);
}

/** Today's totals for the person and for everyone (0 where nothing was spent yet). One indexed read. */
export async function readSpend(userId: string | null, at: Date = new Date()): Promise<DayTotals> {
  const t = schema.aiSpend;
  const scopes = userId && !userId.startsWith(EVERYONE) ? [userId, ...EVERYONE_SCOPES] : EVERYONE_SCOPES;
  const rows = await requireDb().select({ scope: t.scope, usd: t.usd }).from(t).where(and(eq(t.day, utcDay(at)), inArray(t.scope, scopes)));
  return totalsOf(rows, userId);
}

/** The person's total and everyone's (the sum of the shards) from the returned rows. Pure. */
export function totalsOf(rows: { scope: string; usd: number | string }[], userId: string | null): DayTotals {
  const personal = userId && !userId.startsWith(EVERYONE) ? userId : null;
  let everyone = 0;
  for (const r of rows) if (r.scope === EVERYONE || r.scope.startsWith(`${EVERYONE}:`)) everyone += Number(r.usd);
  return { mine: personal ? Number(rows.find((r) => r.scope === personal)?.usd ?? 0) : null, everyone };
}
