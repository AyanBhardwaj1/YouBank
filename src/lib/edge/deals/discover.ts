/**
 * Finding merger documents on EDGAR (E1, F4), free: SEC full-text search (efts) by form and date, through
 * the shared SEC throttle and User-Agent (edgarFetch, under ten requests a second). What it finds:
 * - definitive merger proxies and information statements (DEFM14A, DEFM14C), filed by the target;
 * - tender offer recommendations (SC 14D9), filed by the target; the bidder's SC TO-T accompanies each and
 *   is recognised but not needed (the 14D-9 carries the terms and the background);
 * - registration statements for stock deals (S-4), filed by the buyer;
 * - merger agreements filed as exhibit 2.1 to an 8-K under Item 1.01, the earliest public record of a deal,
 *   with the announcement press release (exhibit 99.1) beside it.
 * Each document becomes a deal stub (or joins the deal it belongs to: same target within nine months), so
 * the database grows even when no model reads it; reading is a separate, budgeted step (deals/extract.ts).
 */
import { edgarFetch } from "@/lib/edgar/client";
import { docKindOf, type DocKind } from "./sections";

export type EftsHit = { _id: string; _source: { display_names?: string[]; ciks?: string[]; form?: string; root_forms?: string[]; file_date?: string; file_type?: string; items?: string[]; sics?: string[] } };

/** One merger document found on EDGAR, with every party the search names. */
export type FoundDoc = {
  accession: string; form: string; kind: DocKind; filed: string; url: string; fileType: string;
  parties: { cik: string; name: string }[]; sic: string;
  /** The filer is the target (proxies, information statements, 14D-9s). */
  filerIsTarget: boolean;
  /** Another document of the same filing (the press release beside a merger agreement). */
  press?: string;
};

const CIK_IN_NAME = /\s*\((?:[A-Z0-9.\-, ]+\)\s*\()?CIK\s*\d+\)\s*$/;
/** "KINDER MORGAN, INC.  (KMI)  (CIK 0001506307)" as "KINDER MORGAN, INC.". Pure. */
export const cleanName = (s: string) => s.replace(CIK_IN_NAME, "").replace(/\s+\([A-Z0-9.\-, ]+\)\s*$/, "").replace(/\s{2,}/g, " ").trim();

const docUrl = (accession: string, doc: string, cik: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik || 0)}/${accession.replace(/-/g, "")}/${doc}`;

/**
 * Search hits as merger documents: one per filing, its main document (or, for an 8-K, its exhibit 2.1 with
 * the exhibit 99.1 beside it), the parties it names and its kind. Exhibits other than the agreement and the
 * release, and 8-Ks without a merger agreement, are left out. Pure.
 */
export function docsFromHits(hits: EftsHit[]): FoundDoc[] {
  const byFiling = new Map<string, EftsHit[]>();
  for (const h of hits) { const acc = h._id.split(":")[0]; byFiling.set(acc, [...(byFiling.get(acc) ?? []), h]); }
  const out: FoundDoc[] = [];
  for (const [accession, list] of byFiling) {
    const first = list[0]._source;
    const form = (first.form ?? first.root_forms?.[0] ?? "").toUpperCase();
    const pick = /^8-K/.test(form)
      ? list.find((h) => /^EX-2\.1/i.test(h._source.file_type ?? ""))
      : list.find((h) => (h._source.file_type ?? "").toUpperCase() === form) ?? list.find((h) => !/^EX-/i.test(h._source.file_type ?? "")) ?? list[0];
    if (!pick) continue;
    const s = pick._source;
    if (/^8-K/.test(form) && s.items?.length && !s.items.some((i) => i.startsWith("1.01"))) continue;
    const kind = docKindOf(form, /^8-K/.test(form) ? s.file_type ?? "" : "");
    if (!kind) continue;
    const ciks = (s.ciks ?? []).map((c) => c.replace(/^0+/, ""));
    const names = (s.display_names ?? []).map(cleanName);
    const doc = pick._id.split(":")[1] ?? "";
    const press = /^8-K/.test(form) ? list.find((h) => /^EX-99\.1/i.test(h._source.file_type ?? "")) : undefined;
    out.push({
      accession, form, kind, filed: (s.file_date ?? "").slice(0, 10), url: docUrl(accession, doc, ciks[0] ?? ""), fileType: s.file_type ?? form,
      parties: ciks.map((cik, i) => ({ cik, name: names[i] ?? "" })).filter((p) => p.cik), sic: s.sics?.[0] ?? "",
      filerIsTarget: kind === "proxy" || kind === "tender",
      ...(press ? { press: docUrl(accession, press._id.split(":")[1] ?? "", ciks[0] ?? "") } : {}),
    });
  }
  return out.sort((a, b) => a.filed.localeCompare(b.filed));
}

/** One page-run of an efts search, as raw hits. */
async function efts(params: Record<string, string>, pages = 3): Promise<EftsHit[]> {
  const out: EftsHit[] = [];
  for (let page = 0; page < pages; page++) {
    const p = new URLSearchParams({ ...params, from: String(page * 100) });
    const res = await edgarFetch(`https://efts.sec.gov/LATEST/search-index?${p}`);
    if (!res.ok) throw Object.assign(new Error(`EDGAR full-text search answered ${res.status}`), { status: 502 });
    const j = (await res.json()) as { hits: { total: { value: number }; hits: EftsHit[] } };
    out.push(...j.hits.hits);
    if (j.hits.hits.length < 100 || out.length >= j.hits.total.value) break;
  }
  return out;
}

/** The searches that find each kind of document. */
const SEARCHES: { forms: string; q: string; kind: string }[] = [
  { forms: "DEFM14A,DEFM14C", q: "\"merger\"", kind: "proxy" },
  { forms: "SC 14D9", q: "\"offer\"", kind: "tender" },
  { forms: "S-4", q: "\"agreement and plan of merger\"", kind: "s4" },
  { forms: "8-K", q: "\"agreement and plan of merger\"", kind: "agreement" },
];

/**
 * Merger documents filed between two dates. `kinds` narrows the searches (the backfill reads proxies and
 * 14D-9s, the documents that carry every term; the daily pass adds merger agreements and S-4s, which come
 * first). Results are cached by EDGAR's own fetch layer for the day.
 */
export async function findDocs(from: string, to: string, kinds: string[] = ["proxy", "tender", "agreement", "s4"]): Promise<FoundDoc[]> {
  const hits: EftsHit[] = [];
  for (const s of SEARCHES.filter((x) => kinds.includes(x.kind))) {
    hits.push(...await efts({ q: s.q, forms: s.forms, dateRange: "custom", startdt: from, enddt: to }, s.kind === "agreement" ? 5 : 3));
  }
  return docsFromHits(hits);
}

/** The month after a YYYY-MM month, and its last day. Pure. */
export function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
export const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
