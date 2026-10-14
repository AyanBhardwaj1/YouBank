/**
 * The LBO Stress Lab's (E6) validation: for sponsor deals in the deal database whose targets kept filing 10-Ks
 * after the buyout (high-yield issuers do), would the lab's operating paths, started at the deal date, have held
 * the realised EBITDA inside their 80% band? This script counts the deals that qualify and, once there are at
 * least ten, is where the backtest runs; until then it says so rather than print a coverage from a handful.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/eval-lbo.ts      (read-only, against the test branch)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  if (!db) { console.log("No DATABASE_URL: point it at the test branch to count the sponsor deals the backtest can use."); return; }
  const rows = (await db.execute(sql`select count(*)::int as n, count(*) filter (where target_cik <> '' and announced_at < current_date - interval '3 years')::int as old from edge_deals where owner_id is null and buyer_type = 'sponsor' and ev_ebitda is not null`)).rows as { n: number; old: number }[];
  const n = Number(rows[0]?.n ?? 0), old = Number(rows[0]?.old ?? 0);
  console.log(`Sponsor deals with an EV/EBITDA in the deal database: ${n}; announced over three years ago with a target CIK (candidates for a post-buyout EBITDA path): ${old}.`);
  if (old < 10) console.log("Coverage is not measured yet: fewer than ten candidates, so any number would mislead. It is measured once the backfill has read enough sponsor deals (docs/edge-next.md, E6).");
  else console.log("Enough candidates: run the backtest by starting the lab's operating model at each deal date and checking the realised EBITDA from the target's later 10-Ks against the 80% band (next round).");
}

main().catch((e) => { console.error(e); process.exit(1); });
