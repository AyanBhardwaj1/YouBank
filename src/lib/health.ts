/**
 * The health verdict from its checks, pure so scripts/test-prod.ts can check it. /api/health gathers
 * the checks; this decides `ok`, `degraded` or `down` and what the public may see.
 *
 * - down (503, monitors alert): the database is missing or unreachable, a setting every page needs is
 *   missing, or the core tables are missing (pages show "being set up").
 * - degraded (200): the app serves, but something is not right: a feature migration not applied, a
 *   production setting missing or malformed, background jobs misconfigured.
 * - ok (200).
 *
 * Visitors see the verdict and which checks passed; names of settings, migrations and features only go
 * to operators. No value is ever read into the response.
 */
import type { SchemaStatus } from "./setup";

export type DbCheck = { ok: boolean; ms: number; reason?: string; schema?: SchemaStatus };
export type HealthInput = {
  db: DbCheck;
  env: { missing: string[]; invalid: string[]; fatal: string[] };
  jobs: { on: boolean };
  operator: boolean;
};

export function healthVerdict(i: HealthInput) {
  const core = i.db.schema?.core ?? [];
  const migrations = i.db.schema?.migrations ?? [];
  const status: "ok" | "degraded" | "down" = !i.db.ok || i.env.fatal.length || core.length ? "down"
    : migrations.length || i.env.missing.length || i.env.invalid.length ? "degraded" : "ok";
  const schemaOk = i.db.ok && i.db.schema ? !core.length && !migrations.length : undefined;
  return {
    status,
    httpStatus: status === "down" ? 503 : 200,
    checks: {
      database: { ok: i.db.ok, ms: i.db.ms, ...(i.db.reason ? { reason: i.db.reason } : {}) },
      ...(schemaOk === undefined ? {} : {
        migrations: {
          ok: schemaOk,
          ...(i.operator
            ? { ...(core.length ? { coreTablesMissing: core } : {}), ...(migrations.length ? { missing: migrations.map((m) => ({ migration: m.name, objects: m.missing.slice(0, 12) })), fix: "pnpm exec tsx scripts/db-setup.mts finish (with DATABASE_URL_UNPOOLED)" } : {}) }
            : { problems: core.length + migrations.length }),
        },
      }),
      env: { ok: !i.env.missing.length && !i.env.invalid.length, ...(i.operator ? { missing: i.env.missing, invalid: i.env.invalid } : { problems: i.env.missing.length + i.env.invalid.length }) },
      jobs: { on: i.jobs.on },
    },
  };
}
