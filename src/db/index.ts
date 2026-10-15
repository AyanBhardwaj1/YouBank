import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SQLWrapper } from "drizzle-orm";
import * as schema from "./schema";
import { mayRetry } from "./transient";

const url = process.env.DATABASE_URL;

/**
 * The app's connection: Neon's pooled address (the `-pooler` host, PgBouncer in transaction mode), which
 * is what serverless functions should use. Migrations and scripts/db-setup.mts use the direct address
 * (DATABASE_URL_UNPOOLED) instead.
 *
 * - `prepare: false`: in transaction mode a connection is lent per transaction, so a statement prepared
 *   on one would be missing on the next.
 * - `max` (DB_POOL_MAX, 6 by default): enough for a request's parallel reads; Fluid compute serves many
 *   requests per instance, and the pooler takes thousands of client connections.
 * - `idle_timeout` 20 s: a quiet instance holds nothing, so Neon can scale to zero.
 * - `connect_timeout` 15 s: a compute waking from zero answers in a second or two; this is the ceiling.
 * - `max_lifetime` 10 min: connections are renewed, so a pooler restart or failover is picked up.
 * Queries are cut off server-side after 30 seconds (the role's statement_timeout, set by
 * scripts/db-setup.mts finish).
 */
const poolMax = Math.min(Math.max(Number(process.env.DB_POOL_MAX) || 6, 1), 20);
const raw = url
  ? postgres(url, {
      prepare: false, max: poolMax, idle_timeout: 20, connect_timeout: 15, max_lifetime: 600,
      connection: { application_name: "youbank" }, onnotice: () => undefined,
    })
  : null;

/**
 * One retry for a statement that failed on the connection rather than on its own: any statement when
 * it never reached the server (the compute was waking, the connection was refused), and a plain read
 * when the connection broke while it was out (src/db/transient.ts). Transactions are untouched: they run
 * on their own connection (`begin`), never through this.
 */
function withRetry(sql: postgres.Sql): postgres.Sql {
  const unsafe = ((text: string, args?: unknown[], options?: postgres.UnsafeQueryOptions) => {
    // postgres.js queries are lazy: nothing is sent until the query is awaited, so each attempt builds its own.
    let values = false;
    const make = () => { const q = sql.unsafe(text, args as postgres.ParameterOrJSON<never>[], options); return values ? q.values() : q; };
    const run = async () => {
      try { return await make(); } catch (e) {
        if (!mayRetry(text, e)) throw e;
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
        return await make();
      }
    };
    const pending = {
      values() { values = true; return pending; },
      then<A, B>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) { return run().then(ok, no); },
      catch<B>(no?: ((e: unknown) => B | PromiseLike<B>) | null) { return run().catch(no); },
      finally(fn?: (() => void) | null) { return run().finally(fn); },
    };
    return pending;
  }) as unknown as postgres.Sql["unsafe"];
  return new Proxy(sql, { get: (target, prop, receiver) => (prop === "unsafe" ? unsafe : Reflect.get(target, prop, receiver)) });
}

const client = raw ? withRetry(raw) : null;

type Rows<T> = { rows: T[]; rowCount: number };

/**
 * Drizzle, with raw `execute` answering `{ rows, rowCount }` as it did on Neon's HTTP driver (where the
 * app was written), not postgres.js's bare array, so raw-SQL callers read `.rows` either way.
 */
export type Db = Omit<PostgresJsDatabase<typeof schema>, "execute"> & {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: SQLWrapper | string): Promise<Rows<T>>;
};

function withRows(d: PostgresJsDatabase<typeof schema>): Db {
  const run = d.execute.bind(d);
  return Object.assign(d, {
    async execute<T extends Record<string, unknown>>(query: SQLWrapper | string): Promise<Rows<T>> {
      const r = await run<T>(query);
      return { rows: [...r] as T[], rowCount: r.count ?? r.length };
    },
  }) as unknown as Db;
}

/** null when DATABASE_URL is unset. */
export const db: Db | null = client ? withRows(drizzle(client, { schema })) : null;

/**
 * The error every database caller gets while DATABASE_URL is unset: a 503 whose message is written for
 * people (guarded() and the error pages pass it through), and `code` for code that wants to tell.
 */
export const NOT_CONFIGURED = "YouBank is still being set up. Try again in a few minutes.";
export const notConfigured = () => Object.assign(new Error(NOT_CONFIGURED), { status: 503, code: "DB_NOT_CONFIGURED" });

export function requireDb(): Db {
  if (!db) throw notConfigured();
  return db;
}

export { schema };

/** The underlying postgres.js client, for scripts that need the driver itself (scripts/eval-docs.ts). */
export { raw as pgClient };
