/**
 * Premium: on-chain SQL from Dune ("crypto.dune"). Server only, and only from a route that has called
 * requireFeature, when a person asks for a query's results.
 *
 * Reads the latest stored results of a saved Dune query (DUNE_API_KEY): Dune bills credits by the
 * data returned, so rows are capped at 500. It does not start new executions, which cost far more and
 * can run for minutes; a person who needs fresh numbers re-runs the query on Dune and loads it here.
 * Results are cached ten minutes per query, so a reload costs nothing.
 */
import { cacheJson } from "@/lib/cache";
import { arr, CryptoDataError, fetchJson, MIN, str } from "./http";
import type { Cite } from "./sources";

export type DuneResult = { queryId: number; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executedAt: string | null; source: Cite };

/** Dune's /results payload, normalised. Pure, for tests. */
export function parseDune(raw: unknown, queryId: number): DuneResult {
  const r = (raw ?? {}) as { result?: { rows?: unknown; metadata?: { column_names?: unknown; total_row_count?: unknown; row_count?: unknown } }; execution_ended_at?: unknown; state?: unknown };
  const rows = arr<Record<string, unknown>>(r.result?.rows);
  const columns = arr<unknown>(r.result?.metadata?.column_names).map(str).filter(Boolean);
  return {
    queryId, columns: columns.length ? columns : Object.keys(rows[0] ?? {}), rows, rowCount: Number(r.result?.metadata?.total_row_count ?? r.result?.metadata?.row_count ?? rows.length) || rows.length,
    executedAt: str(r.execution_ended_at) || null, source: { name: `Dune query ${queryId}`, url: `https://dune.com/queries/${queryId}` },
  };
}

export const duneConfigured = () => !!process.env.DUNE_API_KEY?.trim();

export async function duneResults(queryId: number): Promise<DuneResult> {
  const key = process.env.DUNE_API_KEY?.trim();
  if (!key) throw new CryptoDataError("Dune is not connected for this workspace (an administrator sets DUNE_API_KEY).", 503);
  if (!Number.isInteger(queryId) || queryId <= 0) throw new CryptoDataError("Give a Dune query number, e.g. 3237721.", 400);
  return cacheJson(`crypto:dune:${queryId}`, 10 * MIN, async () => {
    const raw = await fetchJson<unknown>(`https://api.dune.com/api/v1/query/${queryId}/results?limit=500`, { source: "Dune", headers: { "X-Dune-API-Key": key }, timeoutMs: 30_000 });
    return parseDune(raw, queryId);
  });
}
