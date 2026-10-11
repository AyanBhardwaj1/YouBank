/**
 * Apply hand-written migrations in order:
 *   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0004_outreach.sql drizzle/0005_autopilot.sql
 * Use the session pooler (port 5432) or a direct connection, not the transaction pooler.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => undefined });
for (const f of process.argv.slice(2)) {
  const text = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const stmts = text.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await sql.unsafe(s);
  console.log(f, "applied", stmts.length, "statements");
}
await sql.end();
