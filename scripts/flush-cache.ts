/** Flush the assembled-company cache so records are rebuilt with current parsing logic. */
import { db, schema } from "../src/db";

async function main() {
  if (!db) throw new Error("DATABASE_URL not set");
  await db.delete(schema.companyCache);
  console.log("company_cache flushed");
}
main().catch((e) => { console.error(e); process.exit(1); });
