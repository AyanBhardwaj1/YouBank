import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SQLWrapper } from "drizzle-orm";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

/**
 * Postgres on Supabase, through its transaction pooler (Supavisor, port 6543): connections are lent per
 * transaction, so the driver must not prepare statements. A few per instance lets a request's parallel
 * reads run together; idle ones close after 20 seconds so a quiet instance holds nothing. Queries are
 * cut off server-side after 30 seconds (the role's statement_timeout, set by scripts/supabase-setup.mts);
 * before that, a stalled query held its function until the platform killed it.
 */
const client = url ? postgres(url, { prepare: false, max: 6, idle_timeout: 20, connect_timeout: 10 }) : null;

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

export function requireDb(): Db {
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

export { schema };

/** The underlying postgres.js client, for scripts that need the driver itself (scripts/eval-docs.ts). */
export { client as pgClient };
