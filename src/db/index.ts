import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

/** Drizzle over Neon's HTTP driver (one-shot queries, no pool to manage). null when DATABASE_URL is unset. */
export const db = url ? drizzle(neon(url), { schema }) : null;

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

export { schema };
