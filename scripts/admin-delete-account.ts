/**
 * For the founder, when someone asks for their account and data to be deleted (until Settings has its own
 * button). Finds every table with a user_id or owner_id column and the person's rows in each, shows the counts,
 * and only deletes with --confirm, in one transaction: their rows everywhere, then the account itself (its
 * sessions, sign-in methods and recovery key go with it), then their ledger copy on Cloudflare if that is on.
 *
 *   DATABASE_URL=<production database> pnpm exec tsx scripts/admin-delete-account.ts person@example.com            (preview)
 *   DATABASE_URL=<production database> pnpm exec tsx scripts/admin-delete-account.ts person@example.com --confirm  (delete)
 *
 * A team the person owns is not deleted (other people may be in it): the preview names it, so ownership can be
 * moved or the team removed by hand first. Rows they only created or invited in shared tables are left.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { purgeLedgerCopy } from "@/lib/ledger/store";

const SKIP = new Set(["teams"]);
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

(async () => {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const confirm = process.argv.includes("--confirm");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("usage: pnpm exec tsx scripts/admin-delete-account.ts person@example.com [--confirm]");
  const db = requireDb();
  const user = (await db.execute<{ id: string; name: string | null }>(sql`select id, name from auth_users where lower(email) = ${email} limit 1`)).rows[0];
  if (!user) throw new Error(`No account uses ${email}.`);
  const cols = (await db.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('user_id', 'owner_id') and c.data_type in ('text', 'character varying')
      and c.table_name not like 'auth_%' order by 1, 2`)).rows;
  const counts: { table: string; column: string; n: number }[] = [];
  for (const c of cols) {
    const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${ident(c.table_name)} where ${ident(c.column_name)} = '${user.id.replace(/'/g, "''")}'`));
    const n = Number(r.rows[0]?.n ?? 0);
    if (n) counts.push({ table: c.table_name, column: c.column_name, n });
  }
  console.log(`${email}${user.name ? ` (${user.name})` : ""}, account ${user.id}`);
  for (const c of counts) console.log(`  ${SKIP.has(c.table) ? "KEEP  " : "delete"} ${String(c.n).padStart(6)}  ${c.table}.${c.column}${SKIP.has(c.table) ? "  (a team they own: move ownership or remove it by hand)" : ""}`);
  console.log(`  delete      1  the account (its sessions, sign-in methods, two-factor and recovery key go with it)`);
  if (!confirm) { console.log("\nPreview only. Run again with --confirm to delete."); process.exit(0); }
  await db.transaction(async (tx) => {
    for (const c of counts) if (!SKIP.has(c.table)) await tx.execute(sql.raw(`delete from ${ident(c.table)} where ${ident(c.column)} = '${user.id.replace(/'/g, "''")}'`));
    await tx.execute(sql`delete from auth_users where id = ${user.id}`);
  });
  const purged = await purgeLedgerCopy(user.id).catch(() => false);
  console.log(`\nDeleted. ${purged ? "" : "The ledger copy on Cloudflare could not be reached: run this again later, or purge it there. "}Reply to ${email} to confirm.`);
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
