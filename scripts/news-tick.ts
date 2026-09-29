/**
 * Run one Newsroom pass by hand (what /api/cron/news does every ten minutes) and print its report.
 *   node --env-file=.env.local --import tsx scripts/news-tick.ts [origin] [budgetMs]
 */
import { tick } from "@/lib/news/pipeline";

async function main() {
  const origin = process.argv[2] ?? "http://localhost:3000";
  const budget = Number(process.argv[3] ?? 240_000);
  const r = await tick(origin, budget);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
void main();
