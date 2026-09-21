/** One-time directory backfill: pnpm exec tsx --env-file=.env.local scripts/backfill.ts [yc a16z thiel hn formd] */
import { runSync, type SyncSource } from "@/lib/vc/sync";

(async () => {
  const wanted = (process.argv.slice(2).length ? process.argv.slice(2) : ["yc", "a16z", "thiel", "hn", "formd"]) as SyncSource[];
  for (const s of wanted) {
    const days = s === "hn" ? 180 : s === "formd" ? 30 : 0;
    try { const r = await runSync(s, days); console.log(`${s}: ${r.written} rows in ${(r.ms / 1000).toFixed(0)}s`); }
    catch (e) { console.error(`${s}: ERROR`, e instanceof Error ? e.message : e); }
  }
})();
