/**
 * The deal terms the Precedent Engine reads (E1, F4), one definition each: what it is, how its value is
 * read back from the quote, which family it is calibrated with, and which sections of which documents it
 * is looked for in. One registry, so extraction, checks, confidence, the deal page and the exports agree.
 * Pure, safe on the client.
 */

/** How a field's value is re-read from its quote (deals/parse.ts). */
export type ValueKind = "money_mm" | "per_share" | "percent" | "days" | "count" | "date" | "ratio" | "range" | "text" | "list" | "enum";
/** Fields are calibrated in families: fields of one family behave alike under the checks. */
export type Family = "price" | "size" | "protection" | "advisers" | "fairness" | "process" | "projections" | "approvals" | "parties";
/** Where in a merger document a field is stated. */
export type SectionKey = "summary" | "parties" | "consideration" | "background" | "reasons" | "opinion" | "projections" | "financing" | "termination" | "approvals" | "agreement_parties" | "press";

export type FieldDef = { field: string; label: string; family: Family; kind: ValueKind; sections: SectionKey[]; ask: string; options?: string[] };

const F = (field: string, label: string, family: Family, kind: ValueKind, sections: SectionKey[], ask: string, options?: string[]): FieldDef => ({ field, label, family, kind, sections, ask, ...(options ? { options } : {}) });

export const FIELDS: FieldDef[] = [
  F("target_name", "Target", "parties", "text", ["parties", "agreement_parties", "summary"], "the company being acquired, as named"),
  F("acquirer_name", "Buyer", "parties", "text", ["parties", "agreement_parties", "summary"], "the company or fund acquiring it, as named"),
  F("buyer_type", "Buyer type", "parties", "enum", ["parties", "summary", "financing"], "strategic (an operating company), sponsor (a private-equity fund or its vehicle) or sponsor_backed (a company a sponsor owns)", ["strategic", "sponsor", "sponsor_backed"]),
  F("consideration", "Consideration", "price", "enum", ["consideration", "summary", "press"], "cash, stock or mixed", ["cash", "stock", "mixed"]),
  F("per_share", "Price per share", "price", "per_share", ["consideration", "summary", "press"], "the value per target share in US dollars (the cash amount, or the stated value of a stock deal)"),
  F("exchange_ratio", "Exchange ratio", "price", "ratio", ["consideration", "summary"], "the shares of the buyer each target share receives"),
  F("cvr", "Contingent value right", "price", "text", ["consideration", "summary"], "any contingent value right and what triggers it"),
  F("premium_unaffected", "Premium to the unaffected price", "price", "percent", ["summary", "press", "reasons", "opinion"], "the premium to the unaffected share price, as stated"),
  F("equity_value", "Equity value", "size", "money_mm", ["summary", "press", "consideration"], "the total equity value of the deal"),
  F("enterprise_value", "Enterprise value", "size", "money_mm", ["summary", "press"], "the enterprise value, including debt assumed"),
  F("termination_fee", "Termination fee", "protection", "money_mm", ["termination", "summary"], "the fee the target pays if the agreement is terminated (for example for a superior proposal)"),
  F("reverse_termination_fee", "Reverse termination fee", "protection", "money_mm", ["termination", "summary"], "the fee the buyer pays if it fails to close (financing or regulatory)"),
  F("go_shop_days", "Go-shop period", "protection", "days", ["termination", "summary", "background"], "the length of any go-shop period in days"),
  F("financing", "Financing", "protection", "text", ["financing", "summary"], "how the buyer pays: committed debt, cash on hand, equity commitment; whether there is a financing condition"),
  F("lenders", "Lenders", "protection", "list", ["financing"], "the banks providing committed financing"),
  F("advisers_target", "Target's financial advisers", "advisers", "list", ["opinion", "summary", "press"], "the target's financial advisers"),
  F("advisers_acquirer", "Buyer's financial advisers", "advisers", "list", ["press", "summary", "financing"], "the buyer's financial advisers"),
  F("adviser_fee", "Adviser's fee", "advisers", "money_mm", ["opinion"], "the fee the target's financial adviser is paid on completion"),
  F("fairness_dcf", "Fairness: DCF range", "fairness", "range", ["opinion"], "the per-share range from the discounted cash flow analysis"),
  F("fairness_comps", "Fairness: selected companies range", "fairness", "range", ["opinion"], "the per-share range from the selected public companies analysis"),
  F("fairness_precedents", "Fairness: selected transactions range", "fairness", "range", ["opinion"], "the per-share range from the selected precedent transactions analysis"),
  F("selected_precedents", "Precedents the bankers chose", "fairness", "list", ["opinion"], "the precedent transactions listed in the selected transactions analysis, as 'Acquirer / Target'"),
  F("first_contact", "First contact", "process", "date", ["background"], "the date of the first contact between the parties about a transaction"),
  F("parties_contacted", "Parties contacted", "process", "count", ["background"], "how many potential buyers were contacted"),
  F("ndas", "NDAs signed", "process", "count", ["background"], "how many parties signed confidentiality agreements"),
  F("iois", "Indications of interest", "process", "count", ["background"], "how many indications of interest (first-round bids) were received"),
  F("final_bids", "Final bids", "process", "count", ["background"], "how many final or best-and-final bids were received"),
  F("sign_date", "Signed", "process", "date", ["background", "summary", "press"], "the date the merger agreement was signed"),
  F("proj_revenue", "Projected revenue (next year)", "projections", "money_mm", ["projections"], "management's projected revenue for the next fiscal year"),
  F("proj_ebitda", "Projected EBITDA (next year)", "projections", "money_mm", ["projections"], "management's projected EBITDA for the next fiscal year"),
  F("synergies", "Synergies announced", "projections", "money_mm", ["press", "reasons", "summary"], "the annual run-rate synergies announced"),
  F("approvals", "Regulatory approvals", "approvals", "list", ["approvals", "summary"], "the regulatory approvals required (HSR, CFIUS, FERC, state commissions, foreign antitrust)"),
  F("second_request", "HSR second request", "approvals", "enum", ["approvals", "background"], "whether the FTC or DOJ issued a second request", ["yes", "no"]),
];

export const FIELD: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.field, f]));
export const FAMILIES: Family[] = ["price", "size", "protection", "advisers", "fairness", "process", "projections", "approvals", "parties"];
export const FAMILY_LABEL: Record<Family, string> = {
  price: "Price and consideration", size: "Size", protection: "Deal protection and financing", advisers: "Advisers", fairness: "Fairness opinion",
  process: "Sale process", projections: "Projections and synergies", approvals: "Approvals", parties: "Parties",
};

/** Whether a field is numeric (so its value must be re-parsed from the quote or it is dropped). Pure. */
export const isNumeric = (k: ValueKind) => k === "money_mm" || k === "per_share" || k === "percent" || k === "days" || k === "count" || k === "ratio" || k === "range" || k === "date";

/** The fields to look for in a section, in registry order. Pure. */
export const fieldsFor = (section: SectionKey) => FIELDS.filter((f) => f.sections.includes(section));
