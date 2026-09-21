import { getCompanyFacts, normalize } from "./facts";

export type SeriesPoint = { end: string; value: number; form?: string; fy?: number };
export type ConceptSeries = { concept: string; unit: string; annual: SeriesPoint[]; quarterly: SeriesPoint[]; instants: SeriesPoint[]; error?: string };
export type ConceptMatch = { taxonomy: string; concept: string; unit: string; count: number; latest: string };

/** Time series for XBRL concepts (raw units) and a regex finder for concept names. */
export async function conceptSeries(cik: string, concepts: string[], periods = 8): Promise<ConceptSeries[]> {
  const cf = await getCompanyFacts(cik);
  return concepts.map((c) => {
    const [tax, name] = c.includes(":") ? c.split(":") : ["us-gaap", c];
    const units = cf.facts[tax]?.[name]?.units;
    if (!units) return { concept: c, unit: "", annual: [], quarterly: [], instants: [], error: "not reported" };
    const [unit, raw] = Object.entries(units)[0];
    const rows = normalize(raw);
    return {
      concept: c, unit,
      annual: rows.filter((r) => r.start && r.days >= 350 && r.days <= 380).slice(-periods).map((r) => ({ end: r.end, value: r.val, form: r.form, fy: r.fy })),
      quarterly: rows.filter((r) => r.start && r.days >= 60 && r.days <= 100).slice(-periods).map((r) => ({ end: r.end, value: r.val, form: r.form })),
      instants: rows.filter((r) => !r.start).slice(-periods).map((r) => ({ end: r.end, value: r.val, form: r.form })),
    };
  });
}

export async function findConcepts(cik: string, pattern: string, limit = 60): Promise<ConceptMatch[]> {
  const cf = await getCompanyFacts(cik);
  const re = new RegExp(pattern, "i");
  const out: ConceptMatch[] = [];
  for (const [tax, byConcept] of Object.entries(cf.facts)) for (const [concept, v] of Object.entries(byConcept)) {
    if (!re.test(concept)) continue;
    for (const [unit, raw] of Object.entries(v.units)) { const rows = normalize(raw); if (rows.length) out.push({ taxonomy: tax, concept, unit, count: rows.length, latest: rows[rows.length - 1].end }); }
  }
  return out.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : b.count - a.count)).slice(0, limit);
}

/** Sum of the last four quarterly values ending at or before `end`, or the latest annual value as a fallback. */
export function ltmFromSeries(s: ConceptSeries): { value: number; method: string } | null {
  const q = s.quarterly.slice(-4);
  if (q.length === 4) return { value: q.reduce((a, p) => a + p.value, 0), method: `sum of 4 quarters to ${q[3].end}` };
  const a = s.annual[s.annual.length - 1];
  return a ? { value: a.value, method: `fiscal year to ${a.end}` } : null;
}
