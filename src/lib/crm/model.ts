/**
 * The CRM vocabulary: pipeline stages, thread categories and contact kinds.
 *
 * Free of server imports so the UI and the agent's schemas share one definition of the words.
 */

/* ---------------- Pipeline ---------------- */

export const STAGES = ["inbox", "screening", "diligence", "partner", "term_sheet", "portfolio", "passed"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  inbox: "Inbox",
  screening: "Screening",
  diligence: "Diligence",
  partner: "Partner review",
  term_sheet: "Term sheet",
  portfolio: "Portfolio",
  passed: "Passed",
};

export const STAGE_BLURB: Record<Stage, string> = {
  inbox: "Arrived and not yet looked at.",
  screening: "Worth a first look: market, team, traction.",
  diligence: "Under real work — references, data, model.",
  partner: "In front of the partnership for a decision.",
  term_sheet: "Terms out or being negotiated.",
  portfolio: "Invested.",
  passed: "Declined, with the reason recorded.",
};

/** Stages that count as still live, for pipeline totals. */
export const OPEN_STAGES: Stage[] = ["inbox", "screening", "diligence", "partner", "term_sheet"];

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

/* ---------------- Email triage ---------------- */

export const CATEGORIES = [
  "founder_pitch", "intro_request", "portfolio_update", "lp_investor",
  "scheduling", "diligence_material", "newsletter", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  founder_pitch: "Founder pitch",
  intro_request: "Intro request",
  portfolio_update: "Portfolio update",
  lp_investor: "LP or investor",
  scheduling: "Scheduling",
  diligence_material: "Diligence material",
  newsletter: "Newsletter",
  other: "Other",
};

/** Categories that usually deserve a considered reply rather than a skim. */
export const REPLY_WORTHY: Category[] = ["founder_pitch", "intro_request", "lp_investor", "diligence_material", "scheduling"];

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

/* ---------------- People ---------------- */

export const CONTACT_KINDS = ["founder", "investor", "lp", "banker", "operator", "other", "unknown"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const KIND_LABEL: Record<ContactKind, string> = {
  founder: "Founder", investor: "Investor", lp: "LP", banker: "Banker",
  operator: "Operator", other: "Other", unknown: "Unknown",
};

export type Priority = "high" | "medium" | "low";
export const PRIORITIES: Priority[] = ["high", "medium", "low"];

/** Personal domains never identify a company, so the agent must not infer one from them. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "fastmail.com", "hey.com",
]);

/** The company domain from an email address, or "" when it is a personal mailbox. */
export function companyDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  const domain = email.slice(at + 1).toLowerCase().trim();
  return PUBLIC_EMAIL_DOMAINS.has(domain) ? "" : domain;
}
