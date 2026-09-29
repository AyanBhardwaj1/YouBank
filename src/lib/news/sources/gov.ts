/**
 * Regulation that moves deals and sectors: final and proposed rules from the Federal Register (public
 * domain), for the agencies each desk answers to. Routine notices are left out.
 */
import type { Tag } from "../desks";
import { canonicalUrl, keyOf, stripHtml } from "../normalize";
import { NEWS_UA, type FetchResult, type RawItem } from "../types";

const AGENCIES: { slug: string; short: string; tags: Tag[] }[] = [
  { slug: "federal-energy-regulatory-commission", short: "FERC", tags: ["energy", "infra", "policy"] },
  { slug: "energy-department", short: "DOE", tags: ["energy", "policy"] },
  { slug: "environmental-protection-agency", short: "EPA", tags: ["energy", "industrials", "policy"] },
  { slug: "food-and-drug-administration", short: "FDA", tags: ["healthcare", "policy"] },
  { slug: "centers-for-medicare-medicaid-services", short: "CMS", tags: ["healthcare", "policy"] },
  { slug: "securities-and-exchange-commission", short: "SEC", tags: ["accounting", "markets", "policy"] },
  { slug: "federal-reserve-system", short: "Federal Reserve", tags: ["financials", "policy"] },
  { slug: "federal-deposit-insurance-corporation", short: "FDIC", tags: ["financials", "policy"] },
  { slug: "comptroller-of-the-currency", short: "OCC", tags: ["financials", "policy"] },
  { slug: "consumer-financial-protection-bureau", short: "CFPB", tags: ["financials", "policy"] },
  { slug: "federal-communications-commission", short: "FCC", tags: ["media", "policy"] },
  { slug: "internal-revenue-service", short: "IRS", tags: ["accounting", "policy"] },
  { slug: "federal-trade-commission", short: "FTC", tags: ["ma", "policy"] },
];

type FrDoc = { title: string; abstract: string | null; html_url: string; publication_date: string; type: string; significant?: boolean | null; agencies?: { slug?: string; name?: string }[] };

export const federalRegisterUrl = () => {
  const q = new URLSearchParams({ order: "newest", per_page: "40" });
  for (const a of AGENCIES) q.append("conditions[agencies][]", a.slug);
  for (const t of ["RULE", "PRORULE"]) q.append("conditions[type][]", t);
  for (const f of ["title", "abstract", "html_url", "publication_date", "type", "significant", "agencies"]) q.append("fields[]", f);
  return `https://www.federalregister.gov/api/v1/documents.json?${q}`;
};

/** Federal Register documents as stories. Pure, for tests. */
export function federalRegisterItems(docs: FrDoc[]): RawItem[] {
  const out: RawItem[] = [];
  for (const d of docs) {
    const agency = AGENCIES.find((a) => d.agencies?.some((x) => x.slug === a.slug));
    if (!agency || !d.html_url) continue;
    const url = canonicalUrl(d.html_url);
    const kind = d.type === "Proposed Rule" ? "proposes" : "issues";
    out.push({
      key: keyOf(url), url, title: `${agency.short} ${kind} rule: ${d.title.replace(/\s+/g, " ").trim()}`.slice(0, 280),
      snippet: stripHtml(d.abstract ?? "", 420), source: "Federal Register", domain: "federalregister.gov", kind: "gov",
      publishedAt: new Date(`${d.publication_date}T12:00:00Z`), tags: agency.tags, tickers: [], tier: 1,
      meta: { agency: agency.short, docType: d.type, significant: !!d.significant, weight: d.significant ? 0.55 : 0.3, category: "policy" },
    });
  }
  return out;
}

export async function fetchFederalRegister(): Promise<FetchResult> {
  try {
    const res = await fetch(federalRegisterUrl(), { headers: { "User-Agent": NEWS_UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { status: "error", items: [], error: `HTTP ${res.status}` };
    const j = (await res.json()) as { results?: FrDoc[] };
    return { status: "ok", items: federalRegisterItems(j.results ?? []) };
  } catch (e) {
    return { status: "error", items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
