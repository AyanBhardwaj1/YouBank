/**
 * Schema checks at a provider boundary. Each client keeps zod schemas for the answers it reads
 * (`z.looseObject`, so new fields pass and missing or renamed required ones fail) and runs them through
 * `parseOrThrow`. A mismatch is provider drift: it is logged once per process and field path, and thrown
 * as SourceError(kind "schema"), which the data layer treats like any other source failure (next source,
 * or the last good copy). Nothing downstream ever sees a NaN, 0 or undefined in place of a missing field.
 */
import type { z } from "zod";
import { SourceError } from "./source-error";

const logged = new Set<string>();

/** Log a drift event once per source, endpoint and set of issue paths. */
function logDrift(source: string, endpoint: string, issues: z.core.$ZodIssue[]) {
  // Row numbers are folded ("#.close"), so one bad row at a different index per symbol is still one event.
  const paths = [...new Set(issues.slice(0, 8).map((i) => `${i.path.map((p) => (typeof p === "number" ? "#" : String(p))).join(".") || "(root)"}: ${i.code}`))];
  const key = `${source}|${endpoint}|${paths.join(",")}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(JSON.stringify({ level: "warn", event: "schema-drift", source, endpoint, issues: paths }));
}

/** `data` as the schema's output, or SourceError(source, "schema") after logging the issue paths once. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown, source: string, endpoint: string): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  logDrift(source, endpoint, r.error.issues);
  throw new SourceError(source, "schema", `${source} sent data in a shape we do not recognise. Try again later.`);
}

/** An empty answer where data was expected. */
export const emptyAnswer = (source: string, what: string) => new SourceError(source, "empty", `${source} has no ${what} right now.`);
