/**
 * Wikidata (CC0) for the crosswalk: from a company's SEC CIK (property P5531) to its official website
 * (P856, which gives the domain), its LEI (P1278), its English Wikipedia article and its item id. One
 * SPARQL query per company, cached for a month; Wikidata is community-edited, so its links are kept at
 * 0.97 rather than the registry's 1.
 */
import { cacheJson } from "@/lib/cache";
import { fetchJson } from "../http";

export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

export type WikidataIds = { qid: string; sites: string[]; lei: string | null; wikipedia: string | null; url: string };
type Binding = Record<string, { value: string } | undefined>;

/** The SPARQL query for one CIK (Wikidata stores it zero-padded to ten digits, sometimes not). Pure. */
export function wikidataQuery(cik: string): string {
  const n = cik.replace(/^0+/, "");
  return `SELECT ?item ?site ?lei ?article WHERE {
  VALUES ?cik { "${n.padStart(10, "0")}" "${n}" }
  ?item wdt:P5531 ?cik .
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P1278 ?lei }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} LIMIT 30`;
}

/** SPARQL JSON results as one company's ids (the first item when several share the CIK). Pure. */
export function parseWikidata(json: { results?: { bindings?: Binding[] } }): WikidataIds | null {
  const rows = json.results?.bindings ?? [];
  if (!rows.length || !rows[0].item) return null;
  const item = rows[0].item.value;
  const mine = rows.filter((r) => r.item?.value === item);
  const sites = [...new Set(mine.map((r) => r.site?.value).filter((s): s is string => !!s))];
  const lei = mine.map((r) => r.lei?.value).find((v) => !!v && /^[A-Z0-9]{20}$/.test(v)) ?? null;
  const article = mine.map((r) => r.article?.value).find((v) => !!v) ?? null;
  const wikipedia = article ? decodeURIComponent(article.split("/wiki/")[1] ?? "").replace(/ /g, "_") || null : null;
  return { qid: item.split("/").pop() ?? "", sites, lei, wikipedia, url: item };
}

export async function wikidataByCik(cik: string): Promise<WikidataIds | null> {
  const n = cik.replace(/^0+/, "");
  return cacheJson(`edge:wikidata:cik:v1:${n}`, 30 * 86_400_000, async () => {
    const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(wikidataQuery(n))}`;
    return parseWikidata(await fetchJson(url, { timeoutMs: 25_000, gapMs: 1_000, headers: { Accept: "application/sparql-results+json" } }));
  });
}
