import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import type { AiPrefs } from "@/lib/ai/models";
import type { CampaignStep, Mode } from "./model";

/**
 * The writing half of nurture, campaigns and new emails.
 *
 * Every function here only returns text. None of them sends, schedules or stores anything: the callers
 * put the result in the review queue, where the autopilot settings decide whether it waits for a person.
 */

/* ---------------- Shared rules ---------------- */

const OUTBOUND_RULES = `Rules:
- You are drafting. The reader, or an autopilot the reader controls, decides whether it goes, so write something that can be sent exactly as written: no placeholders, no brackets.
- Use only facts given to you below. Never invent traction, customers, mutual contacts, prior meetings, prices or shared history. If you know little about them, write a shorter email rather than a vaguer one.
- Never commit to a meeting time, a price, an introduction or a deadline unless the reader's instructions or playbook authorise it. Otherwise put the decision in openQuestions.
- Plain text, no markdown, no signature block: one is added automatically.
- Short. Most good outreach is three to six sentences with one clear, small ask.
- No flattery that could be sent to anyone ("love what you're building"). If you compliment, name the specific thing.
- confidence is high only when every fact in the email is supported by what you were given and the reader would send it unchanged. sensitive is true when it commits to money, terms or legal matters beyond what the reader's playbook, knowledge or instructions state, or touches anything delicate. Quoting what the reader authorised is not sensitive.`;

const WHO: Record<Mode, string> = {
  deals: "a finance professional (an investor, banker or advisor) writing to founders, operators and other investors",
  sales: "a founder or business-development lead writing to potential customers, partners and investors",
};

const quality = {
  confidence: z.enum(["high", "medium", "low"]),
  sensitive: z.boolean(),
};

export type HistoryItem = { direction: "inbound" | "outbound"; sentAt: string | null; subject: string; body: string };

const renderHistory = (h: HistoryItem[]) => h.length === 0
  ? "No earlier emails with this person are on record."
  : h.map((m) => `--- ${m.direction === "inbound" ? "They wrote" : "The reader wrote"}${m.sentAt ? ` on ${m.sentAt}` : ""}: ${m.subject} ---\n${m.body.slice(0, 2500)}`).join("\n\n");

type Opts = { prefs?: AiPrefs | null };

/* ---------------- Nurture ---------------- */

export const NurtureResult = z.object({
  reachOut: z.boolean().describe("false when the history or the rule's instructions say this person should be left alone, or there is no honest reason to write now"),
  reason: z.string().describe("one sentence for the reader: why you are, or are not, reaching out"),
  subject: z.string().describe("empty when reachOut is false"),
  body: z.string().describe("empty when reachOut is false"),
  openQuestions: z.array(z.string()).describe("anything the reader must decide or fill in before sending"),
  ...quality,
});
export type NurtureResult = z.infer<typeof NurtureResult>;

const NURTURE_SYSTEM = `You help a professional keep relationships alive. You are given one person they have not been in touch with for a while, the history of their emails, anything new YouBank knows about them, and the reader's rule for reconnecting. Decide whether to reach out, and if so write the email.

Decide first:
- Do not reach out when the person said they were not interested, asked for no further contact, the relationship clearly ended badly, or the rule's instructions exclude them. Say so in reason.
- Do not reach out when the only thing you could say is "just checking in" with nothing behind it and nothing new is known. A reconnection needs a reason: something from the history worth picking up, or something new about them.
- When in doubt, reach out with a short, low-pressure note: the reader reviews it anyway.

Then write:
- Pick up the thread of the actual history: the last thing discussed, a promise to reconnect, where they were in their raise. Refer to it specifically.
- If there is news about them (a new filing, a raise), lead with it, stated exactly as given.

${OUTBOUND_RULES}`;

export async function writeNurture(input: {
  persona: string; orders: string; playbook?: string; ruleInstructions: string; daysQuiet: number;
  contact: { name: string; email: string; title: string; company: string; kind: string; notes: string };
  directory: unknown | null; signals: string[]; history: HistoryItem[];
}, opts?: Opts) {
  const prompt = [
    input.persona ? `The reader (write as them): ${input.persona}` : "",
    input.orders,
    input.playbook ?? "",
    input.ruleInstructions.trim() ? `The reader's rule for reconnecting:\n${input.ruleInstructions.trim()}` : "",
    `The person: ${JSON.stringify(input.contact)}`,
    `Days since the last email between them: ${input.daysQuiet}.`,
    input.directory ? `YouBank's directory record for their company (verified background):\n${JSON.stringify(input.directory)}` : "",
    input.signals.length ? `New since you last spoke (from SEC filings in YouBank):\n- ${input.signals.join("\n- ")}` : "Nothing new is known about them.",
    "",
    renderHistory(input.history),
  ].filter(Boolean).join("\n\n");
  return structured(NurtureResult, "nurture_decision", NURTURE_SYSTEM, prompt, { ...opts, task: "classify" });
}

/* ---------------- Lead qualification ---------------- */

export const QualifyResult = z.object({
  leads: z.array(z.object({
    id: z.number(),
    verdict: z.enum(["qualified", "disqualified", "unsure"]),
    fit: z.number().describe("0 to 100: how well this lead matches the profile, on the evidence given"),
    reason: z.string().describe("one sentence citing the evidence; for unsure, say what is missing"),
  })),
});
export type QualifyResult = z.infer<typeof QualifyResult>;

const QUALIFY_SYSTEM = `You qualify leads against an ideal customer profile (ICP) for an outreach campaign.

Rules:
- Judge only on the evidence given for each lead. Do not use outside knowledge of a company; it may be a different company with the same name.
- "qualified" needs positive evidence for the ICP's key criteria. "disqualified" needs evidence against one. When the record is too thin to tell, say "unsure" and name what is missing: a person will decide.
- The fit score reflects evidence, not optimism. Thin records score in the middle at most.
- Return one entry for every lead id you were given, in any order.`;

export async function qualifyLeads(input: {
  icp: string; goal: string; orders: string;
  leads: { id: number; name: string; company: string; email: string; notes: string; directory: unknown | null }[];
}, opts?: Opts) {
  const prompt = [
    `Ideal customer profile:\n${input.icp.trim() || "(none given: judge only on whether the lead fits the goal)"}`,
    `Campaign goal: ${input.goal.trim() || "(not stated)"}`,
    input.orders,
    "Leads:",
    ...input.leads.map((l) => JSON.stringify(l)),
  ].filter(Boolean).join("\n\n");
  return structured(QualifyResult, "lead_qualification", QUALIFY_SYSTEM, prompt, { ...opts, task: "classify" });
}

/* ---------------- Campaign steps ---------------- */

export const StepResult = z.object({
  subject: z.string().describe("for a follow-up step this is ignored and the thread's subject is kept"),
  body: z.string(),
  personalization: z.array(z.string()).describe("the specific facts about this lead the email uses, so the reviewer can check them"),
  openQuestions: z.array(z.string()),
  ...quality,
});
export type StepResult = z.infer<typeof StepResult>;

const stepSystem = (mode: Mode) => `You write one email in an outbound sequence for ${WHO[mode]}.

- Ground the email in this lead's record. Say why them, specifically. If the record is thin, be brief and honest about why you are writing rather than padding it.
- On the first step, end with one short line that makes it easy to say no ("If the timing's wrong, just say so and I won't follow up."). A reply like that ends the sequence.
- On a later step, do not repeat the earlier email. Add something new, or close the loop.

${OUTBOUND_RULES}`;

export async function writeStep(input: {
  mode?: Mode; persona: string; orders: string; playbook?: string; goal: string; campaignInstructions: string;
  steps: CampaignStep[]; stepIndex: number;
  lead: { name: string; email: string; company: string; notes: string; fitReason: string };
  directory: unknown | null; earlier: { subject: string; body: string }[];
}, opts?: Opts) {
  const step = input.steps[input.stepIndex];
  const prompt = [
    input.persona ? `The reader (write as them): ${input.persona}` : "",
    input.orders,
    input.playbook ?? "",
    `Campaign goal: ${input.goal || "(not stated)"}`,
    input.campaignInstructions.trim() ? `Campaign instructions from the reader:\n${input.campaignInstructions.trim()}` : "",
    `This is step ${input.stepIndex + 1} of ${input.steps.length}. What this step should do: ${step.instruction}`,
    `The lead: ${JSON.stringify(input.lead)}`,
    input.directory ? `YouBank's directory record for their company (verified background):\n${JSON.stringify(input.directory)}` : "YouBank has no directory record for this company. Do not imply you know anything about it beyond the lead details.",
    input.earlier.length ? `Emails already sent to them in this sequence (no reply yet):\n${input.earlier.map((e, i) => `--- Step ${i + 1}: ${e.subject} ---\n${e.body}`).join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return structured(StepResult, "campaign_step", stepSystem(input.mode ?? "deals"), prompt, { ...opts, task: "draft" });
}

/* ---------------- A new email ---------------- */

export const ComposeResult = z.object({
  subject: z.string(),
  body: z.string(),
  rationale: z.string().describe("one sentence for the reader on the approach taken"),
  openQuestions: z.array(z.string()),
  ...quality,
});

/** One new email to one person, from the reader's own brief. */
export async function writeCompose(input: {
  mode: Mode; persona: string; orders: string; playbook?: string; brief: string;
  to: { name: string; email: string; company: string; notes: string }; directory: unknown | null; history: HistoryItem[];
}, opts?: Opts) {
  const system = `You write a single new email for ${WHO[input.mode]}, from the reader's brief.\n\n${OUTBOUND_RULES}`;
  const prompt = [
    input.persona ? `The reader (write as them): ${input.persona}` : "",
    input.orders,
    input.playbook ?? "",
    `What the reader wants this email to do: ${input.brief}`,
    `To: ${JSON.stringify(input.to)}`,
    input.directory ? `YouBank's directory record for their company (verified background):\n${JSON.stringify(input.directory)}` : "",
    input.history.length ? `Earlier emails with this person:\n${renderHistory(input.history)}` : "",
  ].filter(Boolean).join("\n\n");
  return structured(ComposeResult, "compose_email", system, prompt, { ...opts, task: "draft" });
}
