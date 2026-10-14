/**
 * Patents (E3) from USPTO's PatentsView PatentSearch API (CC BY 4.0, attributed in provenance; a free key,
 * PATENTSVIEW_API_KEY): grants and pre-grant publications by the company's disambiguated assignee (from
 * the crosswalk), as monthly counts. Without the key the Pulse leaves patents out and says so. Parsing is
 * pure and tolerant of either endpoint's field names.
 */
import { fetchJson } from "../../entities/http";
import { monthStart } from "../../series/change";

export const patentsviewReady = () => !!process.env.PATENTSVIEW_API_KEY?.trim();

/** Monthly counts from a PatentSearch response (patents or publications). Pure. */
export function monthlyCounts(json: unknown, dateField: "patent_date" | "publication_date"): { period: string; value: number }[] {
  const rows = (((json as { patents?: unknown[]; publications?: unknown[] })?.patents ?? (json as { publications?: unknown[] })?.publications ?? []) as Record<string, unknown>[]);
  const n = new Map<string, number>();
  for (const r of rows) { const d = String(r[dateField] ?? ""); if (/^\d{4}-\d{2}-\d{2}/.test(d)) n.set(monthStart(d), (n.get(monthStart(d)) ?? 0) + 1); }
  return [...n.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value }));
}

/** The PatentSearch query URL for an assignee's grants or publications since a date. Pure. */
export function patentQueryUrl(kind: "patent" | "publication", assigneeId: string, from: string): string {
  const date = kind === "patent" ? "patent_date" : "publication_date";
  const q = { _and: [{ "assignees.assignee_id": assigneeId }, { _gte: { [date]: from } }] };
  const f = kind === "patent" ? ["patent_id", "patent_date"] : ["document_number", "publication_date"];
  return `https://search.patentsview.org/api/v1/${kind}/?q=${encodeURIComponent(JSON.stringify(q))}&f=${encodeURIComponent(JSON.stringify(f))}&o=${encodeURIComponent(JSON.stringify({ size: 1000 }))}`;
}

export async function readPatents(assigneeId: string, years = 3): Promise<{ grants: { period: string; value: number }[]; apps: { period: string; value: number }[]; url: string } | null> {
  if (!patentsviewReady()) return null;
  const from = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
  const headers = { "X-Api-Key": process.env.PATENTSVIEW_API_KEY!.trim() };
  const grants = monthlyCounts(await fetchJson(patentQueryUrl("patent", assigneeId, from), { headers, timeoutMs: 30_000, gapMs: 1_500 }), "patent_date");
  const apps = await fetchJson(patentQueryUrl("publication", assigneeId, from), { headers, timeoutMs: 30_000, gapMs: 1_500 }).then((j) => monthlyCounts(j, "publication_date")).catch(() => []);
  return { grants, apps, url: `https://datatool.patentsview.org/#search/assignee&asn_id=${encodeURIComponent(assigneeId)}` };
}
