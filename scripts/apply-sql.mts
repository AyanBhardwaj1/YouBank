/** Apply hand-written migrations in order: DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0004_outreach.sql drizzle/0005_autopilot.sql */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const sql = neon(process.env.DATABASE_URL!);
for (const f of process.argv.slice(2)) {
  const text = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const stmts = text.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await sql.query(s);
  console.log(f, "applied", stmts.length, "statements");
}
