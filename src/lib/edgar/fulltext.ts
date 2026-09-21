import { HOUR, edgarJson } from "./client";

/** EDGAR full-text search (efts.sec.gov): every filing and exhibit since 2001. */
export type FtsHit = { entity: string; cik: string; form: string; filed: string; period: string; description: string; url: string; index: string; accession: string };

type Raw = { hits: { total: { value: number }; hits: { _id: string; _source: { display_names?: string[]; ciks?: string[]; form?: string; root_forms?: string[]; file_date?: string; period_ending?: string; file_description?: string; file_type?: string } }[] } };

export async function fullTextSearch(opts: { q: string; forms?: string[]; from?: string; to?: string; entity?: string; ciks?: string[]; limit?: number }): Promise<{ total: number; hits: FtsHit[] }> {
  const p = new URLSearchParams({ q: opts.q });
  if (opts.forms?.length) p.set("forms", opts.forms.join(","));
  if (opts.from || opts.to) {
    // EDGAR ignores a half-open range, so both bounds are always sent.
    p.set("dateRange", "custom");
    p.set("startdt", opts.from ?? "2001-01-01");
    p.set("enddt", opts.to ?? new Date().toISOString().slice(0, 10));
  }
  if (opts.entity) p.set("entityName", opts.entity);
  if (opts.ciks?.length) p.set("ciks", opts.ciks.map((c) => c.padStart(10, "0")).join(","));
  const url = `https://efts.sec.gov/LATEST/search-index?${p.toString()}`;
  const res = await edgarJson<Raw>(url, `fts-${p.toString().replace(/[^a-z0-9]+/gi, "_").slice(0, 120)}.json`, 6 * HOUR);
  const hits = res.hits.hits.slice(0, opts.limit ?? 20).map((h) => {
    const [accession, doc] = h._id.split(":");
    const cik = h._source.ciks?.[0] ?? "";
    const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik || 0)}/${accession.replace(/-/g, "")}`;
    return {
      entity: (h._source.display_names?.[0] ?? "").replace(/\s+\(CIK.*$/, ""), cik, form: h._source.form ?? h._source.root_forms?.[0] ?? "", filed: h._source.file_date ?? "",
      period: h._source.period_ending ?? "", description: h._source.file_description ?? h._source.file_type ?? "", url: `${folder}/${doc}`, index: `${folder}/`, accession,
    };
  });
  return { total: res.hits.total.value, hits };
}
