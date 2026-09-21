import { edgarJson, edgarText, HOUR, DAY } from "@/lib/edgar/client";

/** Form D: notices of exempt private offerings. Full-text search plus parsed primary_doc.xml for each hit. */
export type FormDPerson = { name: string; relationships: string[]; address: string };
export type FormDFiling = {
  accession: string; filed: string; form: string; issuer: string; cik: string; url: string; indexUrl: string;
  entityType: string; yearOfInc: string; jurisdiction: string; industry: string; issuerAddress: string; phone: string;
  city: string; state: string; stateDesc: string;
  offeringTotal: string; amountSold: string; remaining: string; dateOfFirstSale: string; minimumInvestment: string; investorsSoFar: string;
  hasNonAccredited: string; exemptions: string[]; revenueRange: string; isAmendment: boolean; persons: FormDPerson[];
};

type FtsHit = { _id: string; _source: { display_names?: string[]; file_date?: string; form?: string; ciks?: string[]; period_ending?: string } };

const tag = (x: string, t: string) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(x); return m ? m[1].trim() : ""; };
const tags = (x: string, t: string) => [...x.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);
const money = (v: string) => (/^\d+$/.test(v) ? `$${(Number(v) / 1e6).toFixed(Number(v) >= 1e7 ? 1 : 2)}M` : v || "");

export function parseFormD(xml: string): Omit<FormDFiling, "accession" | "filed" | "form" | "cik" | "url" | "indexUrl"> {
  const issuer = tag(xml, "primaryIssuer");
  const addr = tag(issuer, "issuerAddress");
  const offering = tag(xml, "offeringSalesAmounts");
  const persons = tags(xml, "relatedPersonInfo").map((p) => {
    const first = tag(p, "firstName"), last = tag(p, "lastName");
    const a = tag(p, "relatedPersonAddress");
    return {
      name: [first === "n/a" ? "" : first, last].filter(Boolean).join(" ").trim(),
      relationships: tags(p, "relationship"),
      address: [tag(a, "street1"), tag(a, "city"), tag(a, "stateOrCountry"), tag(a, "zipCode")].filter(Boolean).join(", "),
    };
  });
  return {
    issuer: tag(issuer, "entityName"),
    entityType: tag(issuer, "entityType"),
    yearOfInc: tag(tag(issuer, "yearOfInc"), "value") || (tag(issuer, "yearOfInc").includes("true") ? "within 5 years" : ""),
    jurisdiction: tag(issuer, "jurisdictionOfInc"),
    industry: tag(xml, "industryGroupType"),
    issuerAddress: [tag(addr, "street1"), tag(addr, "city"), tag(addr, "stateOrCountry"), tag(addr, "zipCode")].filter(Boolean).join(", "),
    city: tag(addr, "city"), state: tag(addr, "stateOrCountry"), stateDesc: tag(addr, "stateOrCountryDescription"),
    phone: tag(issuer, "issuerPhoneNumber"),
    offeringTotal: money(tag(offering, "totalOfferingAmount")),
    amountSold: money(tag(offering, "totalAmountSold")),
    remaining: money(tag(offering, "totalRemaining")),
    dateOfFirstSale: tag(tag(xml, "dateOfFirstSale"), "value") || (tag(xml, "dateOfFirstSale").includes("yetToOccur") ? "yet to occur" : ""),
    minimumInvestment: money(tag(xml, "minimumInvestmentAccepted")),
    investorsSoFar: tag(xml, "totalNumberAlreadyInvested"),
    hasNonAccredited: tag(xml, "hasNonAccreditedInvestors"),
    exemptions: tags(tag(xml, "federalExemptionsExclusions"), "item"),
    revenueRange: tag(xml, "revenueRange") || tag(xml, "aggregateNetAssetValueRange"),
    isAmendment: tag(xml, "submissionType").includes("/A"),
    persons,
  };
}

export async function searchFormD(query: string, limit = 8): Promise<{ total: number; filings: FormDFiling[] }> {
  const q = query.trim();
  if (!q) return { total: 0, filings: [] };
  type Fts = { hits: { total: { value: number }; hits: FtsHit[] } };
  const run = (term: string) => edgarJson<Fts>(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(term)}&forms=D,D/A`, `fts-${term.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}.json`, 6 * HOUR);
  // Exact phrase first; fall back to the significant words, then to the first word (e.g. "Anthropic PBC" -> "Anthropic").
  let res = await run(`"${q}"`);
  if (res.hits.total.value === 0) {
    const words = q.split(/\s+/).filter((w) => w.length > 2 && !/^(inc|llc|corp|ltd|pbc|co|the|company|holdings)\.?$/i.test(w));
    if (words.length && words.join(" ") !== q) res = await run(words.map((w) => `"${w}"`).join(" "));
    if (res.hits.total.value === 0 && words.length > 1) res = await run(`"${words[0]}"`);
  }
  const hits = res.hits.hits.slice(0, limit);
  const filings = await Promise.all(hits.map(async (h) => {
    const [accession, doc] = h._id.split(":");
    const cik = h._source.ciks?.[0] ?? "";
    const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
    const docUrl = `${folder}/${doc || "primary_doc.xml"}`;
    try {
      const xml = await edgarText(docUrl, `formd-${accession}.json`, 30 * DAY);
      return { ...parseFormD(xml), accession, filed: h._source.file_date ?? "", form: h._source.form ?? "D", cik, url: docUrl, indexUrl: `${folder}/` };
    } catch {
      return { accession, filed: h._source.file_date ?? "", form: h._source.form ?? "D", cik, url: docUrl, indexUrl: `${folder}/`, issuer: h._source.display_names?.[0]?.replace(/\s+\(CIK.*$/, "") ?? "", entityType: "", yearOfInc: "", jurisdiction: "", industry: "", issuerAddress: "", phone: "", city: "", state: "", stateDesc: "", offeringTotal: "", amountSold: "", remaining: "", dateOfFirstSale: "", minimumInvestment: "", investorsSoFar: "", hasNonAccredited: "", exemptions: [], revenueRange: "", isAmendment: false, persons: [] } satisfies FormDFiling;
    }
  }));
  return { total: res.hits.total.value, filings };
}
