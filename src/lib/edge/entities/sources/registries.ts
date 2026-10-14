/**
 * Name lookups in the registries that do not know a company's CIK: USAspending's recipients (public
 * domain; matched to a UEI) and PatentsView's disambiguated assignees (CC BY 4.0; the PatentSearch API
 * needs a free key, PATENTSVIEW_API_KEY). Each returns candidates with their own names; the crosswalk
 * scores the names and keeps a match only at 0.9 or above (the rest wait for review).
 */
import { fetchJson } from "../http";

export type Candidate = { value: string; name: string; url: string };

/** USAspending recipients answering a name, from either of its search endpoints' shapes. Pure. */
export function parseRecipients(json: unknown): Candidate[] {
  const rows = ((json as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[];
  const out: Candidate[] = [];
  for (const r of rows) {
    const uei = String(r.uei ?? r.recipient_uei ?? "").trim().toUpperCase();
    const name = String(r.name ?? r.recipient_name ?? "").trim();
    if (!/^[A-Z0-9]{12}$/.test(uei) || !name) continue;
    const id = String(r.id ?? "");
    out.push({ value: uei, name, url: id ? `https://www.usaspending.gov/recipient/${id}/latest` : "https://www.usaspending.gov/search" });
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.value) && !!seen.add(c.value)).slice(0, 10);
}

export async function recipientsNamed(name: string): Promise<Candidate[]> {
  const json = await fetchJson("https://api.usaspending.gov/api/v2/recipient/", { method: "POST", body: JSON.stringify({ keyword: name.slice(0, 80), award_type: "all", limit: 10, page: 1, order: "desc", sort: "amount" }), timeoutMs: 20_000, gapMs: 500 });
  return parseRecipients(json);
}

export const patentsviewReady = () => !!process.env.PATENTSVIEW_API_KEY?.trim();

/** PatentsView assignees from a PatentSearch response. Pure. */
export function parseAssignees(json: unknown): Candidate[] {
  const rows = ((json as { assignees?: unknown[] })?.assignees ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({ value: String(r.assignee_id ?? "").trim(), name: String(r.assignee_organization ?? "").trim(), url: `https://datatool.patentsview.org/#search/assignee&asn_id=${encodeURIComponent(String(r.assignee_id ?? ""))}` }))
    .filter((c) => c.value && c.name).slice(0, 10);
}

export async function assigneesNamed(name: string): Promise<Candidate[]> {
  if (!patentsviewReady()) return [];
  const q = encodeURIComponent(JSON.stringify({ _text_phrase: { assignee_organization: name.slice(0, 80) } }));
  const f = encodeURIComponent(JSON.stringify(["assignee_id", "assignee_organization"]));
  const json = await fetchJson(`https://search.patentsview.org/api/v1/assignee/?q=${q}&f=${f}&o=${encodeURIComponent(JSON.stringify({ size: 10 }))}`, { headers: { "X-Api-Key": process.env.PATENTSVIEW_API_KEY!.trim() }, timeoutMs: 20_000, gapMs: 1_500 });
  return parseAssignees(json);
}
