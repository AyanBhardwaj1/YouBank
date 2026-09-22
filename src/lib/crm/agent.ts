import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import type { AiOverride } from "@/lib/ai/config";
import type { AiPrefs } from "@/lib/ai/models";
import { searchStartups } from "@/lib/vc/directory";
import { CATEGORIES, CONTACT_KINDS, STAGES, companyDomain } from "./model";

/* ---------------- Shapes the model must return ---------------- */

export const TriageResult = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(["high", "medium", "low"]).describe("high only when a person is waiting on this reader specifically and delay costs something"),
  summary: z.string().describe("At most two sentences: what they want, and what is being asked of the reader."),
  needsReply: z.boolean().describe("true when a reply from this reader is what moves it forward"),
  contact: z.object({
    name: z.string().describe("empty string if not stated"),
    title: z.string().describe("empty string if not stated"),
    kind: z.enum(CONTACT_KINDS),
  }),
  company: z.object({
    name: z.string(),
    oneLiner: z.string(),
    sector: z.string(),
    round: z.string().describe('e.g. "pre-seed", "seed", "Series A"; empty if not stated'),
    amountUsd: z.number().nullable().describe("amount being raised, in dollars, only if explicitly stated"),
    valuationUsd: z.number().nullable().describe("only if explicitly stated"),
  }).nullable().describe("null unless the email is about a specific company"),
  suggestedStage: z.enum(STAGES),
  nextStep: z.string().describe("one concrete action for the reader, or empty"),
  claimsToVerify: z.array(z.string()).describe("specific factual claims the sender makes that should be checked before acting on them"),
});
export type TriageResult = z.infer<typeof TriageResult>;

export const DraftResult = z.object({
  subject: z.string(),
  body: z.string().describe("plain text, no markdown, no signature block"),
  rationale: z.string().describe("one or two sentences for the reviewer: why this reply, and anything deliberately left out"),
  openQuestions: z.array(z.string()).describe("things the reviewer must decide or fill in before sending"),
});
export type DraftResult = z.infer<typeof DraftResult>;

/* ---------------- Enrichment against YouBank's own data ---------------- */

export type DirectoryMatch = {
  id: number; name: string; oneLiner: string; website: string; program: string;
  founders: string; location: string; fundingStage: string; investors: string[]; raised: string;
};

/**
 * Find the sender's company in the startup directory.
 *
 * Tries the email domain first, since a match on it is near-certain, then the company name. Returns
 * null rather than a weak guess: a wrong match would put false facts in front of the model.
 */
export async function enrichCompany(name: string, domain: string): Promise<DirectoryMatch | null> {
  const asMatch = (r: Awaited<ReturnType<typeof searchStartups>>["rows"][number]): DirectoryMatch => ({
    id: r.id, name: r.name, oneLiner: r.oneLiner, website: r.website, program: r.program,
    founders: r.founders, location: r.location, fundingStage: r.fundingStage, investors: r.investors, raised: r.raised,
  });

  if (domain) {
    const bare = domain.replace(/^www\./, "");
    const { rows } = await searchStartups({ q: bare, pageSize: 25 }).catch(() => ({ rows: [], total: 0 }));
    const hit = rows.find((r) => r.website && r.website.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") === bare);
    if (hit) return asMatch(hit);
  }
  if (name.trim().length > 2) {
    const { rows } = await searchStartups({ q: name.trim(), pageSize: 10 }).catch(() => ({ rows: [], total: 0 }));
    const lower = name.trim().toLowerCase();
    const exact = rows.find((r) => r.name.toLowerCase() === lower);
    if (exact) return asMatch(exact);
  }
  return null;
}

/* ---------------- Prompts ---------------- */

const TRIAGE_SYSTEM = `You read a professional investor's inbox and decide what each thread is and what it needs.

Rules:
- Report only what the email says. Never infer a company, a raise, a valuation or a title that is not stated. Use empty strings and nulls freely; a blank field is correct when the email is silent.
- amountUsd and valuationUsd are in dollars. "$2M" is 2000000. Leave them null unless the sender states a figure.
- needsReply is about this reader. A newsletter, an automated notification or a thread where the sender said they would follow up does not need a reply.
- priority is high only when someone is blocked on this reader. Most founder pitches are medium.
- claimsToVerify lists concrete assertions the sender makes about traction, revenue, customers or backers. These are things to check, not accusations.
- suggestedStage describes where the company belongs in a venture pipeline today, based only on this thread. Threads that are not about a company being evaluated belong in "inbox".`;

const DRAFT_SYSTEM = `You draft email replies for a professional investor to review before sending. You are not sending anything: a person reads, edits and sends every draft.

Rules:
- Write in the reader's voice as described in their profile. Plain text, no markdown, no signature: they have their own.
- Never commit to anything the reader has not authorised. No meeting times, no investment interest, no amounts, no introductions, no promises about timing. Where a commitment is the natural next line, leave the decision to the reader and raise it in openQuestions instead.
- Use only facts present in the thread or in the supplied YouBank context. Never invent traction, mutual contacts, portfolio companies or prior conversations.
- Match the sender's register and keep it short. Most good replies are three to six sentences.
- A pass is a legitimate draft. If the thread warrants declining, write a clear, kind, specific decline rather than a vague one.
- openQuestions is where you put anything you could not decide: a date, a number, whether they actually want the meeting.`;

/* ---------------- Calls ---------------- */

export type ThreadInput = {
  subject: string;
  messages: { direction: "inbound" | "outbound"; from: string; sentAt?: string | null; body: string }[];
};

const renderThread = (t: ThreadInput) =>
  [`Subject: ${t.subject || "(none)"}`, "", ...t.messages.slice(-6).map((m) =>
    `--- ${m.direction === "inbound" ? "From" : "Reply from"} ${m.from}${m.sentAt ? ` on ${m.sentAt}` : ""} ---\n${m.body.slice(0, 6000)}`,
  )].join("\n");

export async function triageThread(thread: ThreadInput, opts?: { persona?: string; prefs?: AiPrefs | null; override?: AiOverride }) {
  const persona = opts?.persona ? `The reader: ${opts.persona}\n\n` : "";
  return structured(TriageResult, "email_triage", TRIAGE_SYSTEM, `${persona}${renderThread(thread)}`, { prefs: opts?.prefs, override: opts?.override });
}

export async function draftReply(
  thread: ThreadInput,
  ctx: { persona?: string; triage?: TriageResult | null; directory?: DirectoryMatch | null; instruction?: string },
  opts?: { prefs?: AiPrefs | null; override?: AiOverride },
) {
  const parts = [
    ctx.persona ? `The reader (write as them): ${ctx.persona}` : "",
    ctx.triage ? `Triage of this thread: ${ctx.triage.category}, priority ${ctx.triage.priority}. ${ctx.triage.summary}` : "",
    ctx.directory
      ? `YouBank's directory has this company. Treat as verified background, and do not repeat it back at them wholesale:\n${JSON.stringify(ctx.directory, null, 1)}`
      : "YouBank's directory has no record of this company. Do not imply any prior knowledge of them.",
    ctx.instruction ? `What the reader wants this reply to do: ${ctx.instruction}` : "",
    "",
    renderThread(thread),
  ].filter(Boolean);
  return structured(DraftResult, "email_draft", DRAFT_SYSTEM, parts.join("\n\n"), { prefs: opts?.prefs, override: opts?.override });
}

/** The company domain for a thread's inbound sender, used for enrichment and contact records. */
export function senderDomain(thread: ThreadInput): string {
  const inbound = thread.messages.find((m) => m.direction === "inbound");
  return inbound ? companyDomain(inbound.from) : "";
}
