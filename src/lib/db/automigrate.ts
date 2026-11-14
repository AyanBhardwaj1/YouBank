/**
 * A deploy sets up its own database, so the site never waits on someone running scripts by hand:
 *
 * - An empty database (no core tables: a new project, a new branch) gets the extensions and the whole schema
 *   (BASE_SQL, drizzle-kit's export of src/db/schema.ts), then every migration in drizzle/.
 * - A database behind the code gets the migrations it lacks (`schemaStatus`), in order.
 * - A deploy without BETTER_AUTH_SECRET gets one, generated once and kept in app_secrets (drizzle/0035), so
 *   sign-in works on a fresh deploy; a secret set in the environment always wins.
 *
 * Runs when a server instance starts (src/instrumentation.ts) and again from src/lib/setup.ts if anything is
 * still missing. One instance at a time: a transaction-scoped advisory lock, which works through Neon's
 * transaction pooler. Every migration is written to be safe twice; a statement whose object already exists is
 * skipped inside a savepoint, as scripts/db-setup.mts finish does. Inside the transaction an index is built
 * without CONCURRENTLY (it only runs where the index is missing). AUTO_MIGRATE=off turns it off. Server only.
 */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { BASE_SQL, MIGRATION_SQL } from "./migrations.gen";
import { shared } from "@/lib/shared";
import { logError } from "@/lib/errors";

/** Statements that may already exist: duplicate table, object, column, index, schema, constraint. */
const EXISTS = new Set(["42P07", "42710", "42701", "42P06", "42P16", "42P05", "23505"]);
/** pg_advisory_xact_lock key: "youbank:migrations". */
const LOCK = 7_216_034_812;

/** The database address, by every name a host may give it. */
export const databaseUrl = (env: Record<string, string | undefined> = process.env) =>
  env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || "";

/** The statements of a SQL file: comments dropped, split on semicolons (no migration uses function bodies). Pure. */
export function statementsOf(text: string): string[] {
  return text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
}

/** A statement as it runs inside the transaction: an index build cannot be CONCURRENTLY there. Pure. */
export const inTransaction = (stmt: string) => stmt.replace(/\bconcurrently\b\s*/gi, "");

/** Kept for callers and tests: every migration can now run here. */
export const autoApplicable = (text: string) => typeof text === "string";

export type AutoMigrateResult = { applied: string[]; base: boolean; error?: string };

const state = shared("automigrate", () => ({ running: null as Promise<AutoMigrateResult> | null, lastTry: 0 }));

/**
 * Apply the named migrations, and the whole schema first when `base` (an empty database). At most one run per
 * instance at a time, and not more than once a minute after a failure.
 */
export function autoMigrate(missing: string[], opts: { base?: boolean } = {}): Promise<AutoMigrateResult> {
  if (process.env.AUTO_MIGRATE === "off" || (!missing.length && !opts.base)) return Promise.resolve({ applied: [], base: false });
  if (state.running) return state.running;
  if (Date.now() - state.lastTry < 60_000) return Promise.resolve({ applied: [], base: false, error: "retrying shortly" });
  state.lastTry = Date.now();
  state.running = run(missing, !!opts.base).finally(() => { state.running = null; });
  return state.running;
}

const connect = (url: string) => postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => undefined, connection: { application_name: "youbank-migrate" } });

async function run(missing: string[], base: boolean): Promise<AutoMigrateResult> {
  // The direct address when there is one (DDL is happiest off the pooler); the pooled one works too.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || databaseUrl();
  if (!url) return { applied: [], base: false, error: "no database" };
  const want = new Set(missing);
  const todo = base ? MIGRATION_SQL : MIGRATION_SQL.filter(([name]) => want.has(name));
  const sql = connect(url);
  const applied: string[] = [];
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK})`;
      await tx`set local statement_timeout = 0`;
      let skippedStatements = 0;
      const exec = async (label: string, stmt: string) => {
        try {
          await tx.savepoint((sp) => sp.unsafe(inTransaction(stmt)));
        } catch (e) {
          if (EXISTS.has((e as { code?: string }).code ?? "")) return;
          // Setting up an empty database is best effort: a statement this database cannot run (an older
          // pgvector without halfvec, say) only costs the feature that needs it, never sign-in's own tables.
          if (base) { skippedStatements++; logError(Object.assign(new Error(`setup skipped a statement in ${label}`), { cause: e }), { where: "automigrate" }); return; }
          // Logged with the step's name; the whole transaction rolls back.
          throw Object.assign(new Error(`migration ${label} failed`), { cause: e });
        }
      };
      if (base) {
        // The schema's column types need them (halfvec, geometry). Neon and Supabase both allow these.
        for (const ext of ["vector", "postgis"]) {
          await tx.savepoint((sp) => sp.unsafe(`create extension if not exists ${ext}`)).catch(() => undefined);
        }
        for (const s of statementsOf(BASE_SQL)) await exec("base", s);
      }
      for (const [name, text] of todo) {
        for (const s of statementsOf(text)) await exec(name, s);
        applied.push(name);
      }
      if (skippedStatements) console.warn(JSON.stringify({ level: "warn", msg: "database set up with statements skipped", skipped: skippedStatements }));
    });
    console.info(JSON.stringify({ level: "info", msg: "database set up", base, applied }));
    return { applied, base };
  } catch (e) {
    const ref = logError(e, { where: "automigrate" });
    return { applied: [], base: false, error: `failed (ref ${ref})` };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

/**
 * The sign-in secret when none is set: made once (48 random bytes), kept in app_secrets, and put in this
 * process's environment, where src/lib/auth/server.ts reads it. Every instance reads the same row, so sessions
 * hold across instances and deploys. Returns whether a secret is now set.
 */
export async function provisionAuthSecret(): Promise<boolean> {
  if (process.env.BETTER_AUTH_SECRET?.trim()) return true;
  const url = databaseUrl();
  if (!url || process.env.AUTO_MIGRATE === "off") return false;
  const sql = connect(url);
  try {
    const fresh = randomBytes(48).toString("base64url");
    await sql`insert into app_secrets (name, value) values ('better_auth_secret', ${fresh}) on conflict (name) do nothing`;
    const [row] = await sql<{ value: string }[]>`select value from app_secrets where name = 'better_auth_secret'`;
    if (!row?.value) return false;
    process.env.BETTER_AUTH_SECRET = row.value;
    console.warn(JSON.stringify({ level: "warn", msg: "BETTER_AUTH_SECRET is not set: using the one kept in the database (set it in the environment to choose your own)" }));
    return true;
  } catch (e) {
    logError(e, { where: "auth-secret" });
    return false;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
