/**
 * Federal contract awards (E3) from USAspending.gov (public domain, no key): awards whose recipient is the
 * company's UEI (from the crosswalk), as monthly counts and amounts by the award's start date, plus the
 * awards themselves so a new award over $10 million can become a finding. Parsing is pure.
 */
import { fetchJson } from "../../entities/http";
import { monthStart } from "../../series/change";

export type Award = { id: string; recipient: string; amount: number; start: string; agency: string; description: string; url: string };

/** spending_by_award results as awards. Pure. */
export function parseAwards(json: unknown): Award[] {
  return (((json as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[]).map((r) => {
    const internal = String(r.generated_internal_id ?? "");
    return {
      id: String(r["Award ID"] ?? internal), recipient: String(r["Recipient Name"] ?? ""), amount: Number(r["Award Amount"] ?? 0), start: String(r["Start Date"] ?? "").slice(0, 10),
      agency: String(r["Awarding Agency"] ?? ""), description: String(r.Description ?? "").slice(0, 200), url: internal ? `https://www.usaspending.gov/award/${encodeURIComponent(internal)}` : "https://www.usaspending.gov/search",
    };
  }).filter((a) => a.id && /^\d{4}-\d{2}-\d{2}$/.test(a.start) && Number.isFinite(a.amount));
}

/** Awards as monthly points: the number started and the amount obligated on them. Pure. */
export function monthlyAwards(awards: Award[]): { obligated: { period: string; value: number }[]; count: { period: string; value: number }[] } {
  const sum = new Map<string, number>(), n = new Map<string, number>();
  for (const a of awards) { const m = monthStart(a.start); sum.set(m, (sum.get(m) ?? 0) + a.amount); n.set(m, (n.get(m) ?? 0) + 1); }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value }));
  return { obligated: sorted(sum), count: sorted(n) };
}

export const AWARDS_API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";

/** The request body for a recipient's contract awards since a date. Pure. */
export const awardsBody = (uei: string, from: string, to: string, page: number) => ({
  filters: { award_type_codes: ["A", "B", "C", "D"], recipient_search_text: [uei], time_period: [{ start_date: from, end_date: to }] },
  fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "Awarding Agency", "generated_internal_id", "Description"],
  limit: 100, page, sort: "Award Amount", order: "desc",
});

export async function readAwards(uei: string, years = 3): Promise<Award[]> {
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
  const out: Award[] = [];
  for (let page = 1; page <= 5; page++) {
    const json = await fetchJson<{ results?: unknown[]; page_metadata?: { hasNext?: boolean } }>(AWARDS_API, { method: "POST", body: JSON.stringify(awardsBody(uei, from, to, page)), timeoutMs: 30_000, gapMs: 500 });
    out.push(...parseAwards(json));
    if (!json.page_metadata?.hasNext) break;
  }
  return out;
}
