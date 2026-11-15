/**
 * Deleting an account and everything it holds: Settings → Data and privacy → Delete my account, and the
 * founder's scripts/admin-delete-account.ts. Every table with a user_id or owner_id column is cleared of the
 * person's rows in one transaction, then the account itself (its sessions, sign-in methods, two-factor and
 * recovery key go with it by cascade), then their ledger copy on Cloudflare.
 *
 * Two things stop a deletion until the person deals with them, so nothing is left broken for anyone else:
 * - a team they own that has other people in it (someone else must own it first; a team that is only them is
 *   deleted with them);
 * - a paid plan still renewing (cancelling it first means Stripe never charges a deleted account).
 * Server only.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { logError } from "@/lib/errors";
import { purgeLedgerCopy } from "@/lib/ledger/store";

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export type Footprint = { table: string; column: string; n: number }[];
export type Blocker = { kind: "team"; team: string } | { kind: "plan"; plan: string };

/** Every table holding the person's rows, with how many. */
export async function accountFootprint(userId: string): Promise<Footprint> {
  const db = requireDb();
  const cols = (await db.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('user_id', 'owner_id') and c.data_type in ('text', 'character varying')
      and c.table_name not like 'auth_%' order by 1, 2`)).rows;
  const out: Footprint = [];
  for (const c of cols) {
    const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${ident(c.table_name)} where ${ident(c.column_name)} = ${lit(userId)}`));
    const n = Number(r.rows[0]?.n ?? 0);
    if (n) out.push({ table: c.table_name, column: c.column_name, n });
  }
  return out;
}

/** What must be dealt with before the account can go (nothing: it can go now). */
export async function deletionBlockers(userId: string): Promise<Blocker[]> {
  const db = requireDb();
  const blockers: Blocker[] = [];
  const teams = await db.execute<{ name: string; others: number }>(sql`
    select t.name, (select count(*)::int from team_members o where o.team_id = t.id and o.user_id <> ${userId}) as others
    from team_members m join teams t on t.id = m.team_id where m.user_id = ${userId} and m.role = 'owner'`).catch(() => ({ rows: [] as { name: string; others: number }[] }));
  for (const t of teams.rows) {
    if (Number(t.others) === 0) continue;
    // Another owner in the team means it is still looked after.
    const owners = await db.execute<{ n: number }>(sql`select count(*)::int as n from team_members m join teams t on t.id = m.team_id where t.name = ${t.name} and m.role = 'owner' and m.user_id <> ${userId}`).catch(() => ({ rows: [{ n: 0 }] }));
    if (!Number(owners.rows[0]?.n ?? 0)) blockers.push({ kind: "team", team: t.name });
  }
  const sub = await db.execute<{ plan: string; status: string; renewing: boolean }>(sql`
    select plan, status, (stripe_subscription_id is not null and not cancel_at_period_end) as renewing from subscriptions where user_id = ${userId}`).catch(() => ({ rows: [] as { plan: string; status: string; renewing: boolean }[] }));
  const s = sub.rows[0];
  if (s && s.renewing && ["active", "trialing", "past_due"].includes(s.status) && !["free", "campus"].includes(s.plan)) blockers.push({ kind: "plan", plan: s.plan });
  return blockers;
}

/** In plain words, what to do about each blocker. Pure. */
export function blockerMessage(b: Blocker[]): string {
  const parts = b.map((x) => (x.kind === "team" ? `make someone else an owner of the team “${x.team}” (Team page)` : `cancel your ${x.plan[0].toUpperCase()}${x.plan.slice(1)} plan in Settings → Plan, so you are not charged again`));
  return parts.length ? `Before your account can be deleted, ${parts.join(", and ")}.` : "";
}

/**
 * Delete the person's rows everywhere and the account. Teams that are only them go too. Returns how many rows
 * were removed. Throws if anything fails (the transaction leaves everything as it was).
 */
export async function deleteAccount(userId: string): Promise<{ rows: number; ledgerPurged: boolean }> {
  const db = requireDb();
  const footprint = await accountFootprint(userId);
  let rows = 0;
  await db.transaction(async (tx) => {
    // Teams where they are the only member (their members and invites go with them by cascade).
    await tx.execute(sql`delete from teams where id in (
      select m.team_id from team_members m where m.user_id = ${userId}
      and not exists (select 1 from team_members o where o.team_id = m.team_id and o.user_id <> ${userId}))`).catch(() => undefined);
    for (const c of footprint) {
      const r = await tx.execute(sql.raw(`delete from ${ident(c.table)} where ${ident(c.column)} = ${lit(userId)}`));
      rows += Number((r as { rowCount?: number }).rowCount ?? c.n);
    }
    await tx.execute(sql`delete from auth_users where id = ${userId}`);
  });
  const ledgerPurged = await purgeLedgerCopy(userId).catch((e) => { logError(e, { where: "account-delete-ledger" }); return false; });
  return { rows: rows + 1, ledgerPurged };
}
