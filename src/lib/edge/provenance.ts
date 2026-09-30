/**
 * Edge's audit trail: for every finding, where each part came from, under what license, when it was
 * retrieved and by what method (with the model version when a model was involved). Compliance teams ask
 * for this before they allow alternative data; any card exports it as CSV.
 */
import { inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type Provenance = { sourceName: string; sourceUrl: string; license: string; method: string; modelVersion: string; retrievedAt: Date };

export async function record(subject: string, sources: Provenance[]) {
  if (!sources.length) return;
  await requireDb().insert(schema.edgeProvenance).values(sources.map((s) => ({
    subject, sourceName: s.sourceName.slice(0, 300), sourceUrl: s.sourceUrl.slice(0, 1000), license: s.license.slice(0, 300), method: s.method.slice(0, 300), modelVersion: s.modelVersion.slice(0, 120), retrievedAt: s.retrievedAt,
  })));
}

export async function trailFor(subjects: string[]) {
  if (!subjects.length) return [];
  return requireDb().select().from(schema.edgeProvenance).where(inArray(schema.edgeProvenance.subject, subjects)).orderBy(schema.edgeProvenance.id);
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The trail as CSV, one row per source. Pure, for tests. */
export function trailCsv(rows: { subject: string; sourceName: string; sourceUrl: string; license: string; method: string; modelVersion: string; retrievedAt: Date }[]): string {
  const head = ["subject", "source", "url", "license", "method", "model_version", "retrieved_at"];
  return [head.join(","), ...rows.map((r) => [r.subject, r.sourceName, r.sourceUrl, r.license, r.method, r.modelVersion, r.retrievedAt.toISOString()].map(cell).join(","))].join("\n");
}
