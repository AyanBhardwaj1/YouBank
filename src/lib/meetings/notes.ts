/**
 * The notes a meeting gets: the schema the model fills in, and the parser that turns its answer into
 * MeetingNotes. Parsing never trusts the model's shape: every list is capped, every string trimmed,
 * sentiment clamped, dates resolved against the meeting's own date, and an owner who is the person
 * themselves becomes "You". No server imports, so it is tested directly (scripts/test-meetings.ts).
 */
import { z } from "zod";
import type { ActionItem, FollowUp, Interest, MeetingNotes, ParticipantNotes, StatedDeal } from "./model";

export const NotesSchema = z.object({
  summary: z.string().describe("what the meeting was about and what came of it, in 3 to 6 plain sentences"),
  decisions: z.array(z.string()).describe("what was decided or agreed, one line each; empty if nothing was"),
  actionItems: z.array(z.object({
    text: z.string().describe("the task, starting with a verb"),
    owner: z.string().describe("who said they would do it: their name, 'You' for the person whose notes these are, or '' if nobody took it"),
    due: z.string().describe("the date it is due as YYYY-MM-DD, worked out from the meeting date when said relatively ('Friday', 'next week'); '' if no date was given"),
  })).describe("every commitment to do something"),
  openQuestions: z.array(z.string()).describe("questions raised and not answered"),
  speakers: z.array(z.object({
    label: z.string().describe("a speaker label exactly as it appears in the transcript, e.g. 'S3A'"),
    name: z.string().describe("that speaker's name, only when the transcript makes it clear (they introduce themselves, are addressed by name, or only one participant could be speaking)"),
  })).describe("names for anonymous speaker labels; leave a label out when unsure"),
  participants: z.array(z.object({
    name: z.string(),
    email: z.string().describe("only if stated or given in the participant list, else ''"),
    company: z.string(),
    title: z.string().describe("their role if stated, else ''"),
    sentiment: z.number().describe("-1 negative to 1 positive, about the subject of the meeting"),
    interest: z.enum(["high", "medium", "low", "unclear"]).describe("how interested they seemed in what the person wants (the deal, the product, the next step)"),
    signals: z.array(z.string()).describe("concrete buying, investing or hesitation signals they showed, with what they said"),
    facts: z.array(z.string()).describe("new durable facts about them or their company worth remembering (plans, constraints, timelines, numbers), as stated"),
    topics: z.array(z.string()).describe("2 to 5 short topic labels they discussed, e.g. 'pricing', 'security review'"),
    knows: z.array(z.string()).describe("topics they showed they already understand"),
    asks: z.array(z.string()).describe("topics they asked about"),
  })).describe("everyone in the meeting except the person whose notes these are"),
  deals: z.array(z.object({
    company: z.string(),
    stage: z.string().describe("a pipeline stage only if the meeting clearly moved the deal there, else ''"),
    round: z.string(), amount: z.string(), valuation: z.string(), sector: z.string(),
    nextStep: z.string(), nextStepDue: z.string().describe("YYYY-MM-DD or ''"),
    quote: z.string().describe("the words in the transcript that state these values"),
  })).describe("deal terms stated in the meeting, per company; leave a field '' unless it was said"),
  followUps: z.array(z.object({
    to: z.string().describe("who it is to (a participant's name)"),
    email: z.string().describe("their address if known, else ''"),
    subject: z.string(),
    body: z.string().describe("a short follow-up in the person's voice: thanks, the agreed next steps with owners and dates, and anything promised; no invented facts"),
  })).describe("follow-up emails worth sending to external participants; at most one per person"),
});

export type RawNotes = z.infer<typeof NotesSchema>;

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, max: number, len = 300) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter(Boolean))].slice(0, max) : []);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * A due date as YYYY-MM-DD: an ISO date as given, or a plain relative phrase ("tomorrow", "Friday",
 * "next Tuesday", "end of week", "in 2 weeks", "end of month") worked out from the meeting's date.
 * Anything else is no date. Pure.
 */
export function resolveDue(raw: string, meetingDate: Date): string | null {
  const s = raw.trim().toLowerCase().replace(/^(by|before|on|due)\s+/, "").replace(/[.,]$/, "");
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
  const base = new Date(Date.UTC(meetingDate.getUTCFullYear(), meetingDate.getUTCMonth(), meetingDate.getUTCDate()));
  if (s === "today" || s === "eod" || s === "end of day") return iso(base);
  if (s === "tomorrow") return iso(addDays(base, 1));
  const inN = /^in (\d{1,2}) (day|week)s?$/.exec(s);
  if (inN) return iso(addDays(base, Number(inN[1]) * (inN[2] === "week" ? 7 : 1)));
  if (s === "next week") return iso(addDays(base, 7));
  if (s === "end of week" || s === "end of the week" || s === "eow") return iso(addDays(base, (5 - base.getUTCDay() + 7) % 7));
  if (s === "end of month" || s === "end of the month" || s === "eom") return iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
  const wd = /^(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (wd) {
    // The coming one: "Friday" and "next Friday" said on a Monday both mean that week's Friday, as most
    // people use them; said on the day itself, a week on.
    const ahead = (DAYS.indexOf(wd[2]) - base.getUTCDay() + 7) % 7 || 7;
    return iso(addDays(base, ahead));
  }
  return null;
}

const SELF_OWNER = /^(you|me|i|myself|self|the user)$/i;
const INTERESTS: Interest[] = ["high", "medium", "low", "unclear"];

/** The model's answer as MeetingNotes, whatever shape it came in. `selfName` is the person's own name. Pure. */
export function parseNotes(raw: unknown, opts: { meetingDate: Date; selfName?: string }): MeetingNotes {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const selfName = str(opts.selfName).toLowerCase();
  const actionItems: ActionItem[] = arr(r.actionItems).map((a) => {
    const owner = str(a.owner, 80);
    const mine = SELF_OWNER.test(owner) || (!!selfName && owner.toLowerCase() === selfName);
    const dueText = str(a.due, 60);
    return { text: str(a.text, 300), owner: mine ? "You" : owner, due: resolveDue(dueText, opts.meetingDate), dueText, mine };
  }).filter((a) => a.text).slice(0, 30);
  const participants: ParticipantNotes[] = arr(r.participants).map((p) => {
    const sentiment = Number(p.sentiment);
    const interest = str(p.interest, 10).toLowerCase() as Interest;
    const email = str(p.email, 200).toLowerCase();
    return {
      name: str(p.name, 120), email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : "", company: str(p.company, 120), title: str(p.title, 120),
      sentiment: Number.isFinite(sentiment) ? Math.max(-1, Math.min(1, Math.round(sentiment * 100) / 100)) : 0,
      interest: INTERESTS.includes(interest) ? interest : "unclear",
      signals: list(p.signals, 6), facts: list(p.facts, 8), topics: list(p.topics, 6, 60).map((t) => t.toLowerCase()),
      knows: list(p.knows, 6, 60).map((t) => t.toLowerCase()), asks: list(p.asks, 6, 60).map((t) => t.toLowerCase()),
    };
  }).filter((p) => p.name && !SELF_OWNER.test(p.name) && p.name.toLowerCase() !== selfName).slice(0, 25);
  const deals: StatedDeal[] = arr(r.deals).map((d) => ({
    company: str(d.company, 120), stage: str(d.stage, 40), round: str(d.round, 60), amount: str(d.amount, 60), valuation: str(d.valuation, 60),
    sector: str(d.sector, 80), nextStep: str(d.nextStep, 300), nextStepDue: resolveDue(str(d.nextStepDue, 40), opts.meetingDate) ?? "", quote: str(d.quote, 400),
  })).filter((d) => d.company).slice(0, 5);
  const followUps: FollowUp[] = arr(r.followUps).map((f) => {
    const email = str(f.email, 200).toLowerCase();
    return { to: str(f.to, 120), email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : "", subject: str(f.subject, 200), body: typeof f.body === "string" ? f.body.trim().slice(0, 4000) : "" };
  }).filter((f) => f.to && f.body).slice(0, 10);
  return {
    summary: typeof r.summary === "string" ? r.summary.trim().slice(0, 3000) : "",
    decisions: list(r.decisions, 20), actionItems, openQuestions: list(r.openQuestions, 15),
    speakers: arr(r.speakers).map((s) => ({ label: str(s.label, 20), name: str(s.name, 120) })).filter((s) => /^S\d+[A-Z0-9]+$/.test(s.label) && s.name).slice(0, 60),
    participants, deals, followUps,
  };
}

/** Empty notes, for a meeting with nothing said. */
export const EMPTY_NOTES: MeetingNotes = { summary: "", decisions: [], actionItems: [], openQuestions: [], speakers: [], participants: [], deals: [], followUps: [] };
