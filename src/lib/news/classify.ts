/**
 * First-pass reading of a story without a model: its category, extra desk tags from its words, and how
 * important it is. The model's reading (enrich.ts) refines these when the budget allows; without it,
 * the Newsroom still ranks sensibly. Pure functions, tested in scripts/test-news.ts.
 */
import type { Tag, Tier } from "./desks";

export const CATEGORIES = ["deals", "funding", "capital", "earnings", "markets", "policy", "legal", "people", "product", "research", "macro", "filings", "general"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  deals: "Deals", funding: "Funding", capital: "Capital markets", earnings: "Earnings", markets: "Markets", policy: "Policy", legal: "Legal & distress",
  people: "People", product: "Launches", research: "Research", macro: "Economy", filings: "Filings", general: "News",
};

const RULES: { re: RegExp; category?: Category; tags: Tag[] }[] = [
  { re: /\b(chapter 11|bankrupt\w*|insolven\w*|restructuring support agreement|debtor-in-possession|\bDIP\b|default(ed|s)? on|missed (a )?(coupon|interest) payment|going concern|receivership)\b/i, category: "legal", tags: ["rx", "credit"] },
  { re: /\b(take[- ]private|go(es|ing)? private|leveraged buyout|\bLBO\b|buyout firm|private[- ]equity)\b/i, category: "deals", tags: ["pe", "sponsors", "ma"] },
  { re: /\b(KKR|Blackstone|Apollo|Carlyle|TPG|Warburg Pincus|Thoma Bravo|Vista Equity|Silver Lake|Bain Capital|Advent International|CVC|Hellman & Friedman|Clayton,? Dubilier|Brookfield|Ares|Blue Owl|Permira|Leonard Green|General Atlantic)\b/, tags: ["sponsors", "pe"] },
  { re: /\b(acquir\w+|merg(er|es|ing|e)|takeover|to buy|to sell|agrees? to (buy|acquire|sell)|deal (for|to|worth)|bid for|tender offer|divest\w*|spin[- ]?off|combination)\b/i, category: "deals", tags: ["ma"] },
  { re: /\b(raises?|raised|funding round|series [a-h]\b|seed round|pre-seed|venture (round|funding)|valuation of|unicorn|backed by)\b/i, category: "funding", tags: ["vc"] },
  { re: /\b(fund (close|closes|closed)|closes? (its )?(fund|vehicle)|final close|hard cap|dry powder|limited partners|\bLPs?\b|continuation (fund|vehicle)|secondar(y|ies))\b/i, category: "funding", tags: ["pe", "vc"] },
  { re: /\b(IPO|initial public offering|goes public|listing|direct listing|prices (its )?(IPO|offering)|follow-on offering|secondary offering|share sale)\b/i, category: "capital", tags: ["ecm"] },
  { re: /\b(notes? offering|senior notes|bond (sale|deal|issue)|priced \$?[\d.]+ ?(billion|million) (of )?(notes|bonds)|term loan|credit facility|refinanc\w+|high[- ]yield|junk bond|investment[- ]grade|leveraged loan|CLO)\b/i, category: "capital", tags: ["dcm", "levfin", "credit"] },
  { re: /\b(private credit|direct lend\w*|BDC|business development compan\w+)\b/i, tags: ["privcredit", "credit"] },
  { re: /\b(buybacks?|share repurchases?|repurchase program|stock repurchase|special dividend|dividend (hike|increase|cut|raise))\b/i, category: "capital", tags: ["corpfin", "markets"] },
  { re: /\b(activist|stake in|13D|proxy fight|board seats?)\b/i, category: "deals", tags: ["event", "corpfin"] },
  { re: /\b(earnings|quarterly (results|profit|revenue)|beats? (estimates|expectations)|miss(es)? (estimates|expectations)|guidance|forecast (cut|raise)|outlook)\b/i, category: "earnings", tags: ["markets", "corpfin"] },
  { re: /\b(CEO|CFO|chief executive|chief financial|steps? down|resign\w*|appoint\w*|named (as )?(chief|president|chair)|layoffs?|job cuts)\b/i, category: "people", tags: ["corpfin"] },
  { re: /\b(SEC|FASB|PCAOB|IASB|restate\w*|auditor|accounting (rule|standard)|internal control|material weakness|enforcement action)\b/i, category: "policy", tags: ["accounting"] },
  { re: /\b(FDA|approv(al|es|ed)|clinical trial|phase (1|2|3|i|ii|iii)\b|biotech|drugmaker|pharma\w*|medicare|medicaid)\b/i, tags: ["healthcare"] },
  { re: /\b(oil|crude|natural gas|LNG|pipeline|OPEC|refiner\w*|drill\w*|shale|utility|utilities|power plant|grid|solar|wind farm|nuclear|renewable)\b/i, tags: ["energy"] },
  { re: /\b(bank(s|ing)?|lender|insurer|insurance|asset manager|wealth manager|fintech|payments?|credit card)\b/i, tags: ["financials"] },
  { re: /\b(REIT|real estate|property|office tower|multifamily|homebuilder|mortgage rates?)\b/i, tags: ["realestate"] },
  { re: /\b(retail\w*|restaurant|consumer|apparel|grocer\w*|e-commerce|brand)\b/i, tags: ["consumer"] },
  { re: /\b(aerospace|defense|industrial|manufactur\w*|railroad|trucking|freight|airline|automaker|machinery|construction)\b/i, tags: ["industrials"] },
  { re: /\b(streaming|studio|broadcast\w*|telecom|wireless|cable|media|box office)\b/i, tags: ["media"] },
  { re: /\b(AI|artificial intelligence|software|chip(maker)?s?|semiconductor|cloud|cyber\w*|startup|SaaS|data center)\b/i, tags: ["tech"] },
  { re: /\b(inflation|CPI|jobs report|payrolls|unemployment|GDP|Federal Reserve|the Fed|rate (cut|hike)|interest rates?|Treasury yields?|recession|tariffs?)\b/i, category: "macro", tags: ["macro"] },
  { re: /\b(rule|regulat\w+|antitrust|FTC|DOJ|lawsuit|sues?|court|ruling|settle\w*|probe|investigation|sanction\w*)\b/i, category: "policy", tags: ["policy"] },
];

/** Category and extra tags read from the words of a headline and snippet. */
export function readWords(title: string, snippet = ""): { category: Category; tags: Tag[] } {
  const text = `${title} ${snippet}`;
  const tags = new Set<Tag>();
  let category: Category | null = null;
  for (const r of RULES) {
    // The headline decides the category; the snippet only adds tags.
    if (r.re.test(title)) { if (r.category && !category) category = r.category; for (const t of r.tags) tags.add(t); }
    else if (r.re.test(text)) for (const t of r.tags) tags.add(t);
  }
  return { category: category ?? "general", tags: [...tags] };
}

/** "$4.1 billion", "$750M", "€2bn": the largest dollar-ish amount in a headline, in dollars. */
export function amountIn(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/(?:US)?[$€£]\s?([\d,.]+)\s?(trillion|tn|billion|bn|b|million|mn|m)\b/gi)) {
    const v = Number(m[1].replace(/,/g, "")) * (/^t/i.test(m[2]) ? 1e12 : /^b/i.test(m[2]) ? 1e9 : 1e6);
    if (Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

const TIER_WEIGHT: Record<Tier, number> = { 1: 0.5, 2: 0.35, 3: 0.2 };
const CATEGORY_WEIGHT: Partial<Record<Category, number>> = { deals: 0.15, legal: 0.15, capital: 0.1, funding: 0.08, earnings: 0.05, policy: 0.05, macro: 0.08 };

/**
 * How important a story is, 0 to 1, before any model reads it: the best source's standing, how many
 * outlets carry it, what kind of event it is, its size, and the filing's own weight.
 */
export function importanceOf(s: { tiers: Tier[]; sourceCount: number; category: Category; amountUsd: number | null; filingWeight: number | null }): number {
  const best = s.tiers.length ? Math.max(...s.tiers.map((t) => TIER_WEIGHT[t])) : 0.2;
  const breadth = Math.min(0.25, Math.log2(Math.max(1, s.sourceCount)) * 0.1);
  const size = s.amountUsd ? Math.min(0.2, Math.max(0, Math.log10(s.amountUsd / 1e8)) * 0.08) : 0;
  const base = best + breadth + (CATEGORY_WEIGHT[s.category] ?? 0) + size;
  return Math.max(0, Math.min(1, s.filingWeight !== null ? Math.max(base, s.filingWeight) : base));
}
