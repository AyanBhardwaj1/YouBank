/**
 * A deploy applies its own pending migrations, so the site never waits on someone running scripts/apply-sql.mts
 * by hand. On the first request after a deploy (src/lib/setup.ts), the app asks which migrations in drizzle/
 * are missing (`schemaStatus`) and applies them, in order, from the copies embedded at build time
 * (migrations.gen.ts, made by scripts/gen-migrations.mts).
 *
 * - One instance at a time: a transaction-scoped advisory lock, which works through Neon's transaction
 *   pooler; an instance that does not get it waits for the one that did and then rechecks.
 * - Every migration is written to be safe to run twice (IF NOT EXISTS); a statement whose object already
 *   exists is skipped inside a savepoint, as scripts/db-setup.mts finish does.
 * - A migration with CREATE INDEX CONCURRENTLY cannot run in a transaction, so it is left to that script and
 *   reported by /api/health.
 * - AUTO_MIGRATE=off turns it off. Server only.
 */
import postgres from "postgres";
import { MIGRATION_SQL } from "./migrations.gen";
import { shared } from "@/lib/shared";
import { logError } from "@/lib/errors";

/** Statements that may already exist: duplicate table, object, column, index, schema, constraint. */
const EXISTS = new Set(["42P07", "42710", "42701", "42P06", "42P16"]);
/** pg_advisory_xact_lock key: "youbank:migrations". */
const LOCK = 7_216_034_812;

/** The statements of a migration file: comments dropped, split on semicolons (no migration uses function bodies). Pure. */
export function statementsOf(text: string): string[] {
  return text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
}

/** Whether a migration can be applied inside a transaction. Pure. */
export const autoApplicable = (text: string) => !/\bconcurrently\b/i.test(text);

export type AutoMigrateResult = { applied: string[]; skipped: string[]; error?: string };

const state = shared("automigrate", () => ({ running: null as Promise<AutoMigrateResult> | null, lastTry: 0 }));

/**
 * Apply the named migrations (those `schemaStatus` reports missing). At most one run per instance at a time,
 * and not more than once a minute after a failure.
 */
export function autoMigrate(missing: string[]): Promise<AutoMigrateResult> {
  if (process.env.AUTO_MIGRATE === "off" || !missing.length) return Promise.resolve({ applied: [], skipped: missing });
  if (state.running) return state.running;
  if (Date.now() - state.lastTry < 60_000) return Promise.resolve({ applied: [], skipped: missing, error: "retrying shortly" });
  state.lastTry = Date.now();
  state.running = run(missing).finally(() => { state.running = null; });
  return state.running;
}

async function run(missing: string[]): Promise<AutoMigrateResult> {
  // The direct address when there is one (DDL is happiest off the pooler); the pooled one works too.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) return { applied: [], skipped: missing, error: "no database" };
  const want = new Set(missing);
  const todo = MIGRATION_SQL.filter(([name]) => want.has(name));
  const skipped = [...want].filter((n) => !todo.some(([name]) => name === n));
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => undefined, connection: { application_name: "youbank-migrate" } });
  const applied: string[] = [];
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK})`;
      await tx`set local statement_timeout = 0`;
      for (const [name, text] of todo) {
        if (!autoApplicable(text)) { skipped.push(name); continue; }
        for (const s of statementsOf(text)) {
          try {
            await tx.savepoint((sp) => sp.unsafe(s));
          } catch (e) {
            if (EXISTS.has((e as { code?: string }).code ?? "")) continue;
            // Logged with the migration's name; the whole transaction rolls back.
            throw Object.assign(new Error(`migration ${name} failed`), { cause: e });
          }
        }
        applied.push(name);
      }
    });
    console.info(JSON.stringify({ level: "info", msg: "migrations applied", applied, skipped }));
    return { applied, skipped };
  } catch (e) {
    const ref = logError(e, { where: "automigrate" });
    return { applied: [], skipped: missing, error: `failed (ref ${ref})` };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
