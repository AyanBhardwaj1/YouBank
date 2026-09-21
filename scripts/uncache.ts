/** Drop cached company records: pnpm exec tsx --env-file=.env.local scripts/uncache.ts FIX SNOW */
import { inArray } from "drizzle-orm";
import { db, schema } from "../src/db";

async function main() {
  const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
  if (!db || tickers.length === 0) { console.error("usage: uncache.ts TICKER..."); process.exit(1); }
  await db.delete(schema.companyCache).where(inArray(schema.companyCache.ticker, tickers));
  console.log(`cleared ${tickers.join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
