/**
 * What every Edge monitor in the Terminal says about its sources: each one's state (answered, answered
 * with nothing, down, or stale), as of when, and a plain note. A source that fails is logged and named as
 * down; its error text never reaches the screen (lib/errors). Server only.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";

export type SourceStatus = "ok" | "empty" | "down" | "stale";
export type SourceState = { id: string; name: string; status: SourceStatus; asOf: string | null; note?: string; url?: string };

/** Run one source's read; on failure log it and answer the fallback, with the source marked down. */
export async function attempt<T>(where: string, fallback: T, load: () => Promise<T>): Promise<{ value: T; ok: boolean }> {
  try {
    return { value: await load(), ok: true };
  } catch (e) {
    logError(e, { where: `terminal-edge-${where}` });
    return { value: fallback, ok: false };
  }
}

/** A source's state from whether it answered and what it held. Pure. */
export const stateOf = (id: string, name: string, ok: boolean, count: number, asOf: string | null, extra: { note?: string; url?: string; staleAfterMs?: number; now?: number } = {}): SourceState => {
  const stale = ok && !!asOf && !!extra.staleAfterMs && (extra.now ?? Date.now()) - Date.parse(asOf) > extra.staleAfterMs;
  return { id, name, status: !ok ? "down" : count === 0 ? "empty" : stale ? "stale" : "ok", asOf, ...(extra.note ? { note: extra.note } : {}), ...(extra.url ? { url: extra.url } : {}) };
};

/** The newest of some ISO times, or null. Pure. */
export const newest = (xs: (string | null | undefined)[]): string | null => xs.filter((x): x is string => !!x && Number.isFinite(Date.parse(x))).sort().pop() ?? null;

/** A company's name in the relationship graph (or null), and its node id. */
export async function nodeFor(ticker: string): Promise<{ id: number; name: string; attrs: Record<string, unknown> } | null> {
  const [n] = await requireDb().select({ id: schema.edgeNodes.id, name: schema.edgeNodes.name, attrs: schema.edgeNodes.attrs }).from(schema.edgeNodes)
    .where(sql`${schema.edgeNodes.kind} = 'company' and ${schema.edgeNodes.ticker} = ${ticker}`).orderBy(schema.edgeNodes.id).limit(1);
  return n ?? null;
}

/** The sources named in the provenance trail of some findings: each source once, with when it was last read. */
export async function trailSources(ids: number[]): Promise<{ name: string; url: string; license: string; retrievedAt: string }[]> {
  if (!ids.length) return [];
  const rows = (await requireDb().execute(sql`
    select source_name as name, max(split_part(source_url, ' ', 1)) as url, max(license) as license, max(retrieved_at) as at
    from edge_provenance where subject in (${sql.join(ids.slice(0, 300).map((id) => sql`${`detection:${id}`}`), sql`, `)})
    group by source_name order by max(retrieved_at) desc limit 12`)).rows as { name: string; url: string; license: string; at: string | Date }[];
  return rows.map((r) => ({ name: r.name, url: r.url ?? "", license: r.license ?? "", retrievedAt: new Date(r.at).toISOString() }));
}
