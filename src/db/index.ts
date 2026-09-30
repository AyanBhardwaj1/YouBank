import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

/**
 * Every query is an HTTPS request to Neon, and the driver sets no timeout of its own, so a stalled
 * connection would hold its request (and function) until the platform killed it; in the load test one
 * hung for fifteen minutes. A query that has not answered in 30 seconds is abandoned.
 */
const QUERY_TIMEOUT_MS = 30_000;
neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(QUERY_TIMEOUT_MS)]) : AbortSignal.timeout(QUERY_TIMEOUT_MS) });

/** Drizzle over Neon's HTTP driver (one-shot queries, no pool to manage). null when DATABASE_URL is unset. */
export const db = url ? drizzle(neon(url), { schema }) : null;

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

export { schema };
