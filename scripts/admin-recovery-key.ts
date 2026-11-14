/**
 * For the founder, when someone emails because they cannot get back into their account: make a fresh recovery
 * key for their email and print it once. Send it only to the account's own email address (reply to their
 * message from it); they enter it with a new password at /sign-in/reset, which signs every other device out
 * and replaces the key again. The old key stops working at once.
 *
 *   DATABASE_URL=<production database> pnpm exec tsx scripts/admin-recovery-key.ts person@example.com
 *
 * The key is checked against BETTER_AUTH_SECRET: run this with the same secret as the site (from Vercel), or
 * none at all if the site uses the one it generated and keeps in the database (it is read from there).
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { issueRecoveryKey } from "@/lib/auth/recovery";
import { provisionAuthSecret } from "@/lib/db/automigrate";

(async () => {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("usage: pnpm exec tsx scripts/admin-recovery-key.ts person@example.com");
  if (!(await provisionAuthSecret())) throw new Error("No BETTER_AUTH_SECRET: set the site's, or point DATABASE_URL at the site's database.");
  const [user] = await requireDb().select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1);
  if (!user) throw new Error(`No account uses ${email}.`);
  const key = await issueRecoveryKey(user.id);
  console.log(`Recovery key for ${email}${user.name ? ` (${user.name})` : ""}:\n\n  ${key}\n\nReply to them at ${email} only. They go to https://youbank.dev/sign-in/reset, enter their email, this key and a new password.`);
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
