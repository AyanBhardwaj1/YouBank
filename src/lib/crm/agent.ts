import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import type { AiOverride } from "@/lib/ai/config";
import type { AiPrefs } from "@/lib/ai/models";
import { getStartup, searchStartups } from "@/lib/vc/directory";
import { CATEGORIES, CONTACT_KINDS, companyDomain, stagesFor, type Category, type ContactKind, type Mode, type Stage } from "./model";

/* ---------------- Shapes the model must return ---------------- */

export type TriageResult = {
  category: Category;
  priority: "high" | "medium" | "low";
  summary: string;
  needsReply: boolean;
  contact: { name: string; title: string; kind: ContactKind };
  company: { name: string; oneLiner: string; sector: string; round: string; amountUsd: number | null; valuationUsd: number | null } | null;
  suggestedStage: Stage;
  nextStep: string;
  claimsToVerify: string[];
  optOut: boolean;
};

/** The triage schema for a mode: the only difference is which pipeline's stages it may suggest. */
export function triageSchema(mode: Mode) {
  const stages = stagesFor(mode) as unknown as [Stage, ...Stage[]];
  return z.object({
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
      round: z.string().describe(mode === "sales" ? "empty unless a fundraising round is being discussed" : 'e.g. "pre-seed", "seed", "Series A"; empty if not stated'),
      amountUsd: z.number().nullable().describe(mode === "sales" ? "deal size or contract value in dollars, only if explicitly stated" : "amount being raised, in dollars, only if explicitly stated"),
      valuationUsd: z.number().nullable().describe("only if explicitly stated"),
    }).nullable().describe(mode === "sales"
      ? "the counterparty's company when this is a potential deal (a sale, partnership or investment into the reader's company); null for coworkers, newsletters and anything that is not a deal"
      : "null unless the email is about a specific company"),
    suggestedStage: z.enum(stages),
    nextStep: z.string().describe("one concrete action for the reader, or empty"),
    claimsToVerify: z.array(z.string()).describe("specific factual claims the sender makes that should be checked before acting on them"),
    optOut: z.boolean().describe("true only when the sender asks not to be contacted again, or says plainly they are not interested in hearing more"),
  });
}

export const DraftResult = z.object({
  subject: z.string(),
  body: z.string().describe("plain text, no markdown, no signature block, no placeholders"),
  rationale: z.string().describe("one or two sentences for the reviewer: why this reply, and anything deliberately left out"),
  openQuestions: z.array(z.string()).describe("small judgement calls the reviewer may want to make; empty when there are none"),
  needsInput: z.array(z.object({
    question: z.string().describe("one question for the reader, answerable in a sentence, e.g. 'What is the price for 50 seats?'"),
    context: z.string().describe("what in the email makes this necessary"),
  })).describe("facts or decisions only the reader has, without which this email cannot be answered properly. Empty when the reply can go as written."),
  confidence: z.enum(["high", "medium", "low"]).describe("high only when every fact and commitment in the reply is supported by the thread, the reader's knowledge, playbook or standing instructions, and nothing in it would surprise the reader"),
  sensitive: z.boolean().describe("true when the email commits to money, pricing, discounts, contracts or legal terms beyond what the reader's playbook, knowledge or standing instructions state, or involves hiring or firing, a complaint, bad news, or anything the reader would want to see before it goes. Quoting a price or term exactly as the reader authorised it is not sensitive."),
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

/**
 * Everything the directory knows about one company, trimmed for a prompt. Used to ground outreach:
 * a campaign email may only use facts that are in here or in the lead's own notes.
 */
export async function directoryRecord(id: number | null | undefined) {
  if (!id) return null;
  const r = await getStartup(id).catch(() => null);
  if (!r) return null;
  return {
    name: r.name, oneLiner: r.oneLiner, description: r.description.slice(0, 700), website: r.website, program: r.program,
    founders: r.founders, location: r.location, industries: r.industries, teamSize: r.teamSize, fundingStage: r.fundingStage,
    investors: r.investors, raised: r.raised, hiring: r.isHiring === 1, listedIn: r.source, listedOn: r.sourceDate,
  };
}

/* ---------------- Prompts ---------------- */

const TRIAGE_COMMON = `Rules:
- Report only what the email says. Never infer a company, an amount, a valuation or a title that is not stated. Use empty strings and nulls freely; a blank field is correct when the email is silent.
- amountUsd and valuationUsd are in dollars. "$2M" is 2000000. Leave them null unless the sender states a figure.
- needsReply is about this reader. A newsletter, an automated notification, a receipt, or a thread where the sender said they would follow up does not need a reply. When the reader wrote the last message, it does not need a reply.
- priority is high only when someone is blocked on this reader and delay costs something.
- claimsToVerify lists concrete assertions about traction, revenue, customers or backers. These are things to check, not accusations.
- optOut is for a clear request to stop ("please remove me", "not interested, thanks"). A pass on timing ("not right now, try us next year") is not an opt-out.
- When you are told the sender works at the reader's company, the category is "colleague" and company is null.`;

const TRIAGE_SYSTEM: Record<Mode, string> = {
  deals: `You read a professional investor's inbox and decide what each thread is and what it needs.

- suggestedStage describes where the company belongs in a venture pipeline today, based only on this thread. Threads that are not about a company being evaluated belong in "inbox".
- Use founder_pitch, intro_request, portfolio_update, lp_investor, diligence_material and scheduling for deal-flow mail.

${TRIAGE_COMMON}`,
  sales: `You read the inbox of a founder or business-development lead and decide what each thread is and what it needs.

Categories for this reader:
- prospect: someone who might buy, partner or invest in the reader's company, including any reply to the reader's outreach
- customer: already buys from the reader
- partner: an existing or potential partnership
- colleague: works at the reader's own company
- lp_investor: the reader's own investors, or the reader's fundraising
- vendor: someone selling something to the reader
- recruiting, scheduling, intro_request, newsletter and other as usual

suggestedStage places the deal in a sales pipeline, from this thread alone:
- lead: identified, no real conversation yet (also for anything that is not a deal)
- contacted: the reader reached out and has had no substantive answer
- engaged: they replied with interest or questions
- meeting: a call or meeting is proposed, booked or has happened
- proposal: pricing, terms, a pilot or a proposal is being discussed
- won: they agreed to buy, sign or proceed
- lost: they declined

${TRIAGE_COMMON}`,
};

const WRITING_RULES = `Rules:
- You are drafting. The reader, or an autopilot the reader controls, decides whether it is sent, so write something that can go exactly as written: no placeholders, no brackets, no "[your name]". Plain text, no markdown, no signature (one is added automatically).
- Use only facts in the thread, the reader's knowledge, the playbook and the standing instructions. Never invent traction, prices, dates, mutual contacts, customers or prior conversations.
- Never commit to anything the reader has not authorised: meetings at a specific time, prices, discounts, deadlines, introductions, contract terms. The standing instructions and playbook count as authorisation. When the right reply needs such a commitment and you do not have it, write the best reply you can without it and put the question in needsInput.
- needsInput is for what only the reader knows. Ask the fewest questions that would let the email be finished, each answerable in a sentence.
- Match the sender's register and keep it short. Most good replies are three to six sentences.
- A decline is a legitimate reply. Make it clear, kind and specific rather than vague.
- confidence: high only when the email could go out unread and the reader would agree with every word. medium when it is probably right but you are guessing at tone or intent. low when you are missing something that matters.
- The playbook and the reader's answers are how the reader teaches you. A price, a term or a policy stated there is authorised: use it plainly, and it does not make the email sensitive. Anything beyond it (a different price, a discount, a new term) does.`;

const DRAFT_ROLE: Record<Mode, string> = {
  deals: "You draft email replies for a professional investor or advisor.",
  sales: "You draft email replies for a founder or business-development lead. The aim of every reply is to move a real conversation forward: answer what was asked, propose the next concrete step, and keep momentum without pressure.",
};

const COLLEAGUE_NOTE = "This email is from the reader's coworker. Write as a colleague: direct, brief, no sales tone, no formal sign-off. If it asks the reader to approve, decide or supply something only they have, put that in needsInput rather than deciding it.";

/* ---------------- Calls ---------------- */

export type ThreadInput = {
  subject: string;
  messages: { direction: "inbound" | "outbound"; from: string; sentAt?: string | null; body: string }[];
};

const renderThread = (t: ThreadInput) =>
  [`Subject: ${t.subject || "(none)"}`, "", ...t.messages.slice(-6).map((m) =>
    `--- ${m.direction === "inbound" ? "From" : "Reply from the reader,"} ${m.from}${m.sentAt ? ` on ${m.sentAt}` : ""} ---\n${m.body.slice(0, 6000)}`,
  )].join("\n");

export async function triageThread(thread: ThreadInput, opts?: {
  mode?: Mode; persona?: string; orders?: string; audience?: "internal" | "external"; prefs?: AiPrefs | null; override?: AiOverride;
}) {
  const mode = opts?.mode ?? "deals";
  const parts = [
    opts?.persona ? `The reader: ${opts.persona}` : "",
    opts?.orders ?? "",
    opts?.audience === "internal" ? "The sender works at the reader's company." : "",
    renderThread(thread),
  ].filter(Boolean);
  const res = await structured(triageSchema(mode), "email_triage", TRIAGE_SYSTEM[mode], parts.join("\n\n"), { prefs: opts?.prefs, override: opts?.override });
  return { ...res, data: res.data as TriageResult };
}

export async function draftReply(
  thread: ThreadInput,
  ctx: {
    mode?: Mode; persona?: string; orders?: string; playbook?: string; audience?: "internal" | "external";
    triage?: Pick<TriageResult, "category" | "priority" | "summary"> | null; directory?: DirectoryMatch | null; instruction?: string;
  },
  opts?: { prefs?: AiPrefs | null; override?: AiOverride },
) {
  const mode = ctx.mode ?? "deals";
  const system = [DRAFT_ROLE[mode], ctx.audience === "internal" ? COLLEAGUE_NOTE : "", WRITING_RULES].filter(Boolean).join("\n\n");
  const parts = [
    ctx.persona ? `The reader (write as them): ${ctx.persona}` : "",
    ctx.orders ?? "",
    ctx.playbook ?? "",
    ctx.triage ? `Triage of this thread: ${ctx.triage.category}, priority ${ctx.triage.priority}. ${ctx.triage.summary}` : "",
    ctx.audience === "internal" ? "" : ctx.directory
      ? `YouBank's directory has this company. Treat as verified background, and do not repeat it back at them wholesale:\n${JSON.stringify(ctx.directory, null, 1)}`
      : "YouBank's directory has no record of this company. Do not imply any prior knowledge of them.",
    ctx.instruction ? `What the reader wants this reply to do: ${ctx.instruction}` : "",
    "",
    renderThread(thread),
  ].filter(Boolean);
  return structured(DraftResult, "email_draft", system, parts.join("\n\n"), { prefs: opts?.prefs, override: opts?.override });
}

/** The company domain for a thread's inbound sender, used for enrichment and contact records. */
export function senderDomain(thread: ThreadInput): string {
  const inbound = thread.messages.find((m) => m.direction === "inbound");
  return inbound ? companyDomain(inbound.from) : "";
}
