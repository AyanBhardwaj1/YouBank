/**
 * The machine slice of the eval set (sleep-research/EXPERIMENT_PLAN.md, B1): figures read straight from SEC
 * XBRL company facts, pinned to one annual report by period and accession number. Deliberately not via
 * getCompanyData, which is the agent's own tool path and has no as-of date: this slice should catch the
 * app's derivations being wrong, not just the agent relaying them. Pure.
 */
import type { Question } from "./score";

type Fact = { end: string; start?: string; val: number; accn: string; fy?: number; fp?: string; form?: string; frame?: string; filed?: string };
export type CompanyFactsJson = { cik?: number; entityName?: string; facts?: { "us-gaap"?: Record<string, { units?: Record<string, Fact[]> }> } };

/** What each question asks, the concepts that may answer it (first found wins), and whether it is a balance. */
const ITEMS: { key: string; label: string; concepts: string[]; instant?: boolean }[] = [
  { key: "revenue", label: "total revenue", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"] },
  { key: "net_income", label: "net income (loss)", concepts: ["NetIncomeLoss"] },
  { key: "cfo", label: "net cash provided by (used in) operating activities", concepts: ["NetCashProvidedByUsedInOperatingActivities"] },
  { key: "assets", label: "total assets at year end", concepts: ["Assets"], instant: true },
  { key: "equity", label: "total stockholders' equity at year end", concepts: ["StockholdersEquity"], instant: true },
];

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** The latest fiscal year's figures from the company's own 10-K, one question per item found. */
export function annualQuestions(cf: CompanyFactsJson, ticker: string): Question[] {
  const gaap = cf.facts?.["us-gaap"] ?? {};
  const name = cf.entityName ?? ticker;
  const out: Question[] = [];
  // Pin every question to the same, latest annual report: the accession that reported revenue for the latest year.
  let pin: { end: string; accn: string } | null = null;
  for (const item of ITEMS) {
    const facts = item.concepts.flatMap((c) => (gaap[c]?.units?.USD ?? []).map((f) => ({ ...f, concept: c })))
      .filter((f) => f.form === "10-K" && f.fp === "FY" && (item.instant ? !f.start : !!f.start && days(f.start, f.end) > 350 && days(f.start, f.end) < 380));
    if (!facts.length) continue;
    // A fact reported in its own year's 10-K (the end falls in the filing's fiscal year), latest year first.
    const own = facts.filter((f) => !pin || (f.end === pin.end && f.accn === pin.accn)).sort((a, b) => b.end.localeCompare(a.end) || (b.filed ?? "").localeCompare(a.filed ?? ""));
    const f = own[0];
    if (!f) continue;
    pin ??= { end: f.end, accn: f.accn };
    out.push({
      id: `xbrl:${ticker}:${item.key}:${f.end}`,
      kind: "xbrl", ticker,
      period: `fiscal year ended ${f.end}, 10-K ${f.accn}`,
      question: `In ${name}'s annual report for the fiscal year ended ${f.end} (Form 10-K, accession ${f.accn}), what was ${item.label}? Give the figure in US dollars and cite the filing.`,
      expected: [{ label: item.label, value: f.val, unit: "usd" }],
      provenance: `xbrl:${f.accn}:${f.concept}`,
    });
  }
  return out;
}
