/**
 * Product metrics from the analytics views (drizzle/0032_analytics.sql): sign-ups, activation within 24
 * hours, D7 and D30 retention by sign-up week, and weekly people per module. Read-only.
 *   pnpm exec tsx --env-file=.env.local scripts/analytics.mts [weeks=12]
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED)");
const weeks = Math.max(1, Math.min(104, Number(process.argv[2]) || 12));
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

const cohorts = await sql<{ signup_week: Date; signups: number; activated_24h: number; d7_eligible: number; d7_active: number; d30_eligible: number; d30_active: number }[]>`
  select * from analytics_cohorts where signup_week >= current_date - ${weeks * 7}::int order by signup_week`;
console.log("Sign-up week   Sign-ups  Activated(24h)  D7         D30");
for (const c of cohorts) {
  console.log(`${c.signup_week.toISOString().slice(0, 10)}   ${String(c.signups).padStart(8)}  ${pct(c.activated_24h, c.signups).padStart(14)}  ${`${pct(c.d7_active, c.d7_eligible)} of ${c.d7_eligible}`.padEnd(10)} ${pct(c.d30_active, c.d30_eligible)} of ${c.d30_eligible}`);
}
const modules = await sql<{ week: Date; module: string; people: number }[]>`
  select * from analytics_modules where week >= current_date - ${weeks * 7}::int order by week desc, people desc`;
console.log("\nWeek          Module          People");
for (const m of modules) console.log(`${m.week.toISOString().slice(0, 10)}    ${m.module.padEnd(15)} ${m.people}`);
await sql.end();
