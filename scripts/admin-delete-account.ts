/**
 * For the founder, when someone asks for their account and data to be deleted (until Settings has its own
 * button). Finds every table with a user_id or owner_id column and the person's rows in each, shows the counts,
 * and only deletes with --confirm, in one transaction: their rows everywhere, then the account itself (its
 * sessions, sign-in methods and recovery key go with it), then their ledger copy on Cloudflare if that is on.
 *
 *   DATABASE_URL=<production database> pnpm exec tsx scripts/admin-delete-account.ts person@example.com            (preview)
 *   DATABASE_URL=<production database> pnpm exec tsx scripts/admin-delete-account.ts person@example.com --confirm  (delete)
 *
 * The same deletion as Settings → Data and privacy → Delete my account (src/lib/account/delete.ts), including
 * what must be done first: another owner for a team with other people in it, and a paid plan cancelled.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { accountFootprint, blockerMessage, deleteAccount, deletionBlockers } from "@/lib/account/delete";

(async () => {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const confirm = process.argv.includes("--confirm");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("usage: pnpm exec tsx scripts/admin-delete-account.ts person@example.com [--confirm]");
  const user = (await requireDb().execute<{ id: string; name: string | null }>(sql`select id, name from auth_users where lower(email) = ${email} limit 1`)).rows[0];
  if (!user) throw new Error(`No account uses ${email}.`);
  const [footprint, blockers] = await Promise.all([accountFootprint(user.id), deletionBlockers(user.id)]);
  console.log(`${email}${user.name ? ` (${user.name})` : ""}, account ${user.id}`);
  for (const c of footprint) console.log(`  delete ${String(c.n).padStart(6)}  ${c.table}.${c.column}`);
  console.log("  delete      1  the account (its sessions, sign-in methods, two-factor and recovery key go with it)");
  if (blockers.length) console.log(`\nFirst: ${blockerMessage(blockers)}`);
  if (!confirm || blockers.length) { console.log(confirm ? "\nNot deleted." : "\nPreview only. Run again with --confirm to delete."); process.exit(blockers.length && confirm ? 1 : 0); }
  const r = await deleteAccount(user.id);
  console.log(`\nDeleted ${r.rows} rows. ${r.ledgerPurged ? "" : "The ledger copy on Cloudflare could not be reached: run this again later. "}Reply to ${email} to confirm.`);
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
