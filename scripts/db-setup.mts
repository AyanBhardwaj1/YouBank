/**
 * One-time (re-runnable) setup of a new Postgres database for YouBank, on Neon or Supabase:
 *
 *   1. pnpm exec tsx scripts/db-setup.mts extensions
 *   2. pnpm exec drizzle-kit push --force          (DATABASE_URL_UNPOOLED: a direct/session connection)
 *   3. pnpm exec tsx scripts/db-setup.mts finish
 *
 * Connects with DATABASE_URL_UNPOOLED (Neon's direct host, or Supabase's session pooler on port 5432).
 * On Supabase (it has Vault), `finish` also needs NEXT_PUBLIC_SITE_URL and AUTOPILOT_SECRET for the
 * heartbeats; on Neon the heartbeats are Neon Functions (neon/*.ts). Prints no secret.
 *
 * `extensions`: pgvector and PostGIS; on Supabase in its `extensions` schema (on the search path), with
 * pg_cron and pg_net for the heartbeats.
 * `finish`, after the schema push:
 * - replays drizzle/*.sql for what the schema file does not describe (GIN, GiST and HNSW indexes); the
 *   files are idempotent, and an "already exists" answer is skipped;
 * - turns on row level security for every table in `public`: the app connects as the tables' owner,
 *   which RLS does not restrict, while Supabase's public Data API (anon key) then sees nothing;
 * - cuts any query off after 30 seconds (the role's statement_timeout);
 * - numbers new rows from 100,000,000 (see below);
 * - on Supabase, schedules the heartbeats: autopilot every five minutes, the Newsroom every ten, each a
 *   pg_net POST to the site with AUTOPILOT_SECRET read from Supabase Vault.
 */
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (a direct or session connection to the new database)");
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
await sql`set statement_timeout = 0`;
const [{ supabase }] = await sql`select exists (select 1 from pg_namespace where nspname = 'vault') as supabase`;

const step = process.argv[2];

if (step === "extensions") {
  if (supabase) {
    await sql`create extension if not exists vector with schema extensions`;
    await sql`create extension if not exists postgis with schema extensions`;
    await sql`create extension if not exists pg_cron with schema pg_catalog`;
    await sql`create extension if not exists pg_net with schema extensions`;
  } else {
    await sql`create extension if not exists vector`;
    await sql`create extension if not exists postgis`;
  }
  const ext = await sql`select extname, extversion from pg_extension where extname in ('vector', 'postgis', 'pg_cron', 'pg_net') order by 1`;
  console.log("extensions:", ext.map((e) => `${e.extname} ${e.extversion}`).join(", "));
} else if (step === "finish") {

  // Statements that may already exist after the push: duplicate table, object, column, index, schema.
  const EXISTS = new Set(["42P07", "42710", "42701", "42P06", "42P16"]);
  let applied = 0, skipped = 0;
  for (const f of readdirSync("drizzle").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) {
    const text = readFileSync(`drizzle/${f}`, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of text.split(";").map((x) => x.trim()).filter(Boolean)) {
      try { await sql.unsafe(s); applied++; } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        if (EXISTS.has(code)) { skipped++; continue; }
        throw new Error(`${f}: ${(e as Error).message}\n${s.slice(0, 300)}`);
      }
    }
  }
  console.log(`migrations replayed: ${applied} statements, ${skipped} already there`);

  const tables = await sql`select tablename from pg_tables where schemaname = 'public' order by 1`;
  for (const t of tables) await sql.unsafe(`alter table public."${t.tablename}" enable row level security`);
  console.log(`row level security on for ${tables.length} tables`);

  // Rows made here before the Neon data is copied in (after Neon's monthly reset) number from 100,000,000,
  // so the copy keeps every old id, and the references between old rows, without a collision.
  const seqs = await sql`select sequencename, coalesce(last_value, 0) as last from pg_sequences where schemaname = 'public'`;
  for (const q of seqs) if (Number(q.last) < 100_000_000) await sql`select setval(${`public."${q.sequencename}"`}::regclass, 100000000, false)`;
  console.log(`${seqs.length} id sequences start at 100,000,000`);

  const [{ role }] = await sql`select current_user as role`;
  await sql.unsafe(`alter role "${role}" set statement_timeout = '30s'`);
  console.log("statement_timeout 30s for the app's role");

  if (!supabase) { console.log("Neon: heartbeats are Neon Functions (neon/autopilot.ts, neon/news.ts)"); await sql.end(); process.exit(0); }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.AUTOPILOT_SECRET;
  if (!/^https:\/\//.test(site) || !secret) throw new Error("Set NEXT_PUBLIC_SITE_URL (https) and AUTOPILOT_SECRET");

  const [existing] = await sql`select id from vault.secrets where name = 'youbank_cron_secret'`;
  if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${secret})`;
  else await sql`select vault.create_secret(${secret}, 'youbank_cron_secret', 'Bearer token for /api/cron/autopilot and /api/cron/news')`;

  // pg_net returns at once and waits in the background; the long timeout keeps the request open for the
  // whole pass (up to 300 s), as the Neon Functions did, in case the platform stops work on disconnect.
  const job = (path: string) => `select net.http_post(
      url := '${site}${path}',
      headers := jsonb_build_object('authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'youbank_cron_secret')),
      timeout_milliseconds := 300000)`;
  await sql`select cron.schedule('youbank-autopilot', '*/5 * * * *', ${job("/api/cron/autopilot")})`;
  await sql`select cron.schedule('youbank-news', '*/10 * * * *', ${job("/api/cron/news")})`;
  const jobs = await sql`select jobname, schedule, active from cron.job where jobname like 'youbank-%' order by 1`;
  console.log("heartbeats:", jobs.map((j) => `${j.jobname} ${j.schedule}${j.active ? "" : " (inactive)"}`).join(", "));
} else {
  console.log("Usage: db-setup.mts extensions | finish");
}
await sql.end();
