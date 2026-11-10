/**
 * B3-0: is there enough label volume for certified autopilot? Reads the trust loop's learning events and
 * prints, per stratum (a person's kind of email), labels per week, the observed bad rate, the labels a
 * certificate needs at the pre-registered α and δ, the days to get there, and the go/no-go verdict.
 * Rules and thresholds are in src/lib/crm/label-volume.ts. Read-only. Person ids are shortened.
 *   pnpm exec tsx --env-file=.env.local scripts/label-volume.mts [weeks=8]
 */
import postgres from "postgres";
import { ALPHA, DELTA, HORIZON_DAYS, strata, verdict, type LabelEvent } from "../src/lib/crm/label-volume";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED)");
const weeks = Math.max(1, Math.min(52, Number(process.argv[2]) || 8));
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
const rows = await sql<{ user_id: string; key: string; outcome: string; edit_ratio: number | null; created_at: Date }[]>`
  select user_id, key, outcome, edit_ratio, created_at from crm_learning_events
  where loop = 'trust' and created_at >= now() - ${weeks * 7}::int * interval '1 day'`;
await sql.end();

const events: LabelEvent[] = rows.map((r) => ({ userId: r.user_id, bucket: r.key, outcome: r.outcome, editRatio: r.edit_ratio, at: r.created_at }));
const s = strata(events, new Date(), weeks).sort((a, b) => (a.daysToCertify ?? Infinity) - (b.daysToCertify ?? Infinity));
console.log(`Pre-registered: alpha ${ALPHA * 100}%, delta ${DELTA * 100}%, horizon ${HORIZON_DAYS} days, window ${weeks} weeks. Edits over 5% are bad; discards are not labels.\n`);
console.log("Person    Stratum                      Good  Bad  Discarded  Per week  Bad rate  Needed  Days");
for (const r of s) {
  console.log(`${r.userId.slice(0, 8).padEnd(9)} ${r.bucket.slice(0, 28).padEnd(28)} ${String(r.good).padStart(4)} ${String(r.bad).padStart(4)} ${String(r.discarded).padStart(10)} ${r.perWeek.toFixed(1).padStart(9)} ${`${(r.badRate * 100).toFixed(1)}%`.padStart(9)} ${String(r.needed ?? "never").padStart(7)} ${String(r.daysToCertify ?? "–").padStart(5)}`);
}
const v = verdict(s);
console.log(`\nActive strata ${v.activeStrata}, reachable within ${HORIZON_DAYS} days ${v.reachableStrata}, people with one ${v.peopleReachable}.`);
console.log(v.go ? "GO: build the certificate gate (plan B3)." : `NO-GO: ${v.reasons.join("; ")}. Keep autopilot as it is and record the negative.`);
