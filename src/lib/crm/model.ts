/**
 * The CRM vocabulary: workflow modes, pipeline stages, thread categories, contact kinds, and the
 * rules for when the agent may send on its own.
 *
 * Free of server imports so the UI and the agent's schemas share one definition of the words.
 */

/* ---------------- Modes ---------------- */

/**
 * What the mailbox is for. It decides the pipeline, and how the agent reads and writes: an investor
 * screening companies reads a pitch very differently from a founder selling to a prospect.
 */
export const MODES = ["deals", "sales"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = {
  deals: "Deal flow: investing in or advising companies",
  sales: "Business development: selling, partnering, fundraising",
};
export const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as readonly string[]).includes(v);

/* ---------------- Pipelines ---------------- */

export const DEAL_STAGES = ["inbox", "screening", "diligence", "partner", "term_sheet", "portfolio", "passed"] as const;
export const SALES_STAGES = ["lead", "contacted", "engaged", "meeting", "proposal", "won", "lost"] as const;
export type Stage = (typeof DEAL_STAGES)[number] | (typeof SALES_STAGES)[number];

/** Every stage either pipeline can hold. Deals keep their stage if the mode is switched later. */
export const STAGES: readonly Stage[] = [...DEAL_STAGES, ...SALES_STAGES];
export const stagesFor = (mode: Mode): readonly Stage[] => (mode === "sales" ? SALES_STAGES : DEAL_STAGES);

export const STAGE_LABEL: Record<Stage, string> = {
  inbox: "Inbox", screening: "Screening", diligence: "Diligence", partner: "Partner review",
  term_sheet: "Term sheet", portfolio: "Portfolio", passed: "Passed",
  lead: "Lead", contacted: "Contacted", engaged: "Engaged", meeting: "Meeting",
  proposal: "Proposal", won: "Won", lost: "Lost",
};

export const STAGE_BLURB: Record<Stage, string> = {
  inbox: "Arrived and not yet looked at.",
  screening: "Worth a first look: market, team, traction.",
  diligence: "Under real work — references, data, model.",
  partner: "In front of the partnership for a decision.",
  term_sheet: "Terms out or being negotiated.",
  portfolio: "Invested.",
  passed: "Declined, with the reason recorded.",
  lead: "Identified, not yet in conversation.",
  contacted: "You have written; no real answer yet.",
  engaged: "They replied and are talking.",
  meeting: "A call or meeting is set or has happened.",
  proposal: "Pricing, terms or a proposal are on the table.",
  won: "Closed: signed, bought or agreed.",
  lost: "Closed without a deal, with the reason recorded.",
};

/** Stages that count as still live, for pipeline totals and quiet-deal checks. */
export const OPEN_STAGES: Stage[] = ["inbox", "screening", "diligence", "partner", "term_sheet", "lead", "contacted", "engaged", "meeting", "proposal"];
/** The first look. A deal sitting here is not yet "quiet"; nothing has started. */
export const ENTRY_STAGES: Stage[] = ["inbox", "lead"];
export const WON_STAGES: Stage[] = ["portfolio", "won"];
export const LOST_STAGES: Stage[] = ["passed", "lost"];

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);
export const statusForStage = (s: Stage): "open" | "won" | "lost" => (WON_STAGES.includes(s) ? "won" : LOST_STAGES.includes(s) ? "lost" : "open");

/* ---------------- Email triage ---------------- */

export const CATEGORIES = [
  "prospect", "customer", "partner", "colleague", "founder_pitch", "intro_request", "portfolio_update",
  "lp_investor", "scheduling", "diligence_material", "vendor", "recruiting", "newsletter", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  prospect: "Prospect",
  customer: "Customer",
  partner: "Partner",
  colleague: "Colleague",
  founder_pitch: "Founder pitch",
  intro_request: "Intro request",
  portfolio_update: "Portfolio update",
  lp_investor: "Investor or LP",
  scheduling: "Scheduling",
  diligence_material: "Diligence material",
  vendor: "Selling to you",
  recruiting: "Recruiting",
  newsletter: "Newsletter",
  other: "Other",
};

/** Categories that usually deserve a considered reply rather than a skim. */
export const REPLY_WORTHY: Category[] = [
  "prospect", "customer", "partner", "colleague", "founder_pitch", "intro_request", "lp_investor", "diligence_material", "scheduling",
];

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

/* ---------------- People ---------------- */

export const CONTACT_KINDS = ["prospect", "customer", "partner", "colleague", "founder", "investor", "lp", "banker", "operator", "other", "unknown"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const KIND_LABEL: Record<ContactKind, string> = {
  prospect: "Prospect", customer: "Customer", partner: "Partner", colleague: "Colleague",
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

/* ---------------- Outbound: drafts, actions, nurture, campaigns ---------------- */

/**
 * What a draft is for. Every kind waits in the same review queue; it leaves when a person sends it,
 * or when autopilot sends it because that person turned autopilot on for that kind of email.
 */
export const DRAFT_KINDS = ["reply", "follow_up", "nurture", "campaign", "compose"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  reply: "Reply", follow_up: "Follow-up", nurture: "Reconnect", campaign: "Campaign", compose: "New email",
};

/**
 * Suggestions that change a record rather than send mail. Each carries the agent's reasoning and
 * what it was unsure of, and does nothing until approved.
 */
export const ACTION_KINDS = ["move_stage", "follow_up", "check_in", "reconnect"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  move_stage: "Move deal", follow_up: "Follow up", check_in: "Check in", reconnect: "Reconnect",
};

export const LEAD_STATUSES = ["sourced", "review", "qualified", "disqualified", "active", "replied", "finished", "opted_out"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  sourced: "Sourced", review: "Needs your call", qualified: "Qualified", disqualified: "Disqualified",
  active: "In sequence", replied: "Replied", finished: "Sequence done", opted_out: "Opted out",
};
export const isLeadStatus = (v: unknown): v is LeadStatus => typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** One touch in a sequence: when it goes, relative to the first, and what it should do. */
export type CampaignStep = { dayOffset: number; instruction: string };

export const DEFAULT_STEPS: CampaignStep[] = [
  { dayOffset: 0, instruction: "First touch. Say why them specifically, in one or two sentences grounded in what we know about the company, then make one clear, small ask." },
  { dayOffset: 4, instruction: "Short bump. Add one new, specific reason to talk that the first email did not use. Two to three sentences." },
  { dayOffset: 10, instruction: "Last note. Close the loop politely and make it easy to say not now. Two sentences." },
];

/** Validate and tidy a step list from a form: offsets ascending from zero, no blanks, at most six. */
export function normalizeSteps(raw: unknown): CampaignStep[] {
  if (!Array.isArray(raw)) return DEFAULT_STEPS;
  const steps = raw
    .map((s) => ({ dayOffset: Math.max(0, Math.round(Number((s as CampaignStep)?.dayOffset) || 0)), instruction: String((s as CampaignStep)?.instruction ?? "").trim().slice(0, 600) }))
    .filter((s) => s.instruction)
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .slice(0, 6);
  if (steps.length === 0) return DEFAULT_STEPS;
  steps[0].dayOffset = 0;
  return steps;
}

/** When the step after `sentStep` is due, or null when the sequence is over. */
export function nextDueAfter(steps: CampaignStep[], sentStep: number, sentAt: Date): Date | null {
  const next = steps[sentStep + 1];
  if (!next) return null;
  const gap = Math.max(1, next.dayOffset - (steps[sentStep]?.dayOffset ?? 0));
  return new Date(sentAt.getTime() + gap * DAY_MS);
}

export const DAY_MS = 86_400_000;

/* ---------------- Where cold email needs consent ---------------- */

/**
 * Country-code domains where unsolicited business email generally needs prior consent (the EU and
 * EEA under GDPR and national ePrivacy rules, Canada under CASL). Campaigns skip them unless the
 * person confirms a lawful basis. Generic domains (.com) cannot tell where someone is, so this is a
 * floor, not a guarantee; the UK's PECR allows business-to-business email and is not listed.
 */
export const CONSENT_TLDS = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro",
  "sk", "si", "es", "se", "is", "li", "no", "eu", "ca",
]);

export function needsConsent(email: string): boolean {
  const tld = (email.split("@")[1] ?? "").toLowerCase().split(".").pop() ?? "";
  return CONSENT_TLDS.has(tld);
}

/* ---------------- Matching companies across sources ---------------- */

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|pbc|lp|l\.p)\b\.?/g;

/** "Ledgerline, Inc." and "LEDGERLINE" compare equal; "Ledgerline Capital" does not. */
export function normalizeCompany(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(LEGAL_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
