/**
 * The copilot during a meeting.
 *
 * The brief is free: what Relationships and the research data already hold about the people and
 * companies in the meeting (who they are, the deal and its stage, recent emails, the company's numbers
 * from the terminal), read from the database and the cached company record, no model.
 *
 * Live suggestions are premium (`meetings.live`) and spend a small-model call about once a minute, so
 * they run only while the person keeps the switch on for that meeting: the switch is stored on the
 * meeting (server side), goes off when the meeting ends, and every call checks it and the plan.
 *
 * Asking about a meeting is an ordinary AI question over its transcript, inside the person's normal
 * daily AI allowance, like quick ask.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { requireFeature } from "@/lib/billing/entitlements";
import { getCompanyData } from "@/lib/company";
import { normalizeCompany, STAGE_LABEL } from "@/lib/crm/model";
import { searchTickers } from "@/lib/edgar/tickers";
import { rateLimit } from "@/lib/locks";
import type { MeetingNotes } from "./model";
import { renderTranscript } from "./stitch";
import { getMeeting, meetingLinks, transcriptOf, transcriptTail, updateMeeting, type MeetingRow } from "./store";

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

export type BriefPerson = {
  contactId: number; name: string; email: string; title: string; company: string; kind: string; notes: string;
  lastSeenAt: string | null; recentEmails: { subject: string; summary: string; at: string | null }[];
  deals: { id: number; name: string; stage: string; amountUsd: number | null; round: string; nextStep: string }[];
};
export type BriefCompany = { name: string; ticker: string | null; facts: string[] };
export type Brief = { people: BriefPerson[]; companies: BriefCompany[]; builtAt: string };

const fmtMm = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}B` : `$${Math.round(n)}M`);
const money = (n: number | null) => (n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`);

/** The contacts and deals a meeting is about so far: picked, linked, or matched from its participants. */
export async function meetingRefs(m: MeetingRow): Promise<{ contactIds: number[]; dealIds: number[] }> {
  const links = await meetingLinks(m.id);
  const ctx = m.context as { contactIds?: number[]; dealIds?: number[] };
  return {
    contactIds: [...new Set([...(ctx.contactIds ?? []), ...m.participants.map((p) => p.contactId ?? 0), ...links.filter((l) => l.kind === "contact").map((l) => l.refId)].filter((n) => n > 0))].slice(0, 12),
    dealIds: [...new Set([...(ctx.dealIds ?? []), ...links.filter((l) => l.kind === "deal").map((l) => l.refId)].filter((n) => n > 0))].slice(0, 6),
  };
}

/** A public company's headline numbers from the terminal's cached record, when the name matches a listed company exactly. */
async function companyFacts(name: string): Promise<BriefCompany> {
  const key = normalizeCompany(name);
  const hit = key ? (await searchTickers(name, 5).catch(() => [])).find((r) => normalizeCompany(r.name) === key) : undefined;
  if (!hit) return { name, ticker: null, facts: [] };
  const c = await getCompanyData(hit.ticker).catch(() => null);
  if (!c) return { name, ticker: hit.ticker, facts: [] };
  const growth = c.ltm.revenue && c.ltm.priorRevenue ? ` (${c.ltm.revenue >= c.ltm.priorRevenue ? "+" : ""}${Math.round((c.ltm.revenue / c.ltm.priorRevenue - 1) * 100)}% a year)` : "";
  const facts = [
    c.price ? `Market cap ${fmtMm(c.price.marketCap)}, shares at ${c.price.last.toFixed(2)} (${c.price.changePct >= 0 ? "+" : ""}${c.price.changePct.toFixed(1)}% today)` : "",
    c.ltm.revenue != null ? `Revenue over the last twelve months ${fmtMm(c.ltm.revenue)}${growth}` : "",
    c.ltm.ebitda != null ? `EBITDA ${fmtMm(c.ltm.ebitda)}` : "",
    c.balance.cash != null || c.balance.debt != null ? `Cash ${fmtMm(c.balance.cash) ?? "n/a"}, debt ${fmtMm(c.balance.debt) ?? "n/a"}` : "",
  ].filter(Boolean);
  return { name: c.name || name, ticker: c.ticker, facts };
}

/** Everything known about the meeting's people and companies. No model; at most two company lookups. */
export async function buildBrief(userId: string, refs: { contactIds: number[]; dealIds: number[] }): Promise<Brief> {
  const db = requireDb();
  const [contacts, pickedDeals] = await Promise.all([
    refs.contactIds.length ? db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), inArray(schema.crmContacts.id, refs.contactIds))) : [],
    refs.dealIds.length ? db.select().from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.id, refs.dealIds))) : [],
  ]);
  const ids = contacts.map((c) => c.id);
  const [contactDeals, threads] = await Promise.all([
    ids.length ? db.select().from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.contactId, ids))) : [],
    ids.length ? db.select({ contactId: schema.crmThreads.contactId, subject: schema.crmThreads.subject, summary: schema.crmThreads.summary, at: schema.crmThreads.lastMessageAt, category: schema.crmThreads.category })
      .from(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), inArray(schema.crmThreads.contactId, ids), isNotNull(schema.crmThreads.lastMessageAt)))
      .orderBy(desc(schema.crmThreads.lastMessageAt)).limit(60) : [],
  ]);
  const deals = [...new Map([...pickedDeals, ...contactDeals].map((d) => [d.id, d])).values()];
  const people: BriefPerson[] = contacts.map((c) => ({
    contactId: c.id, name: c.name, email: c.email, title: c.title, company: c.company, kind: c.kind, notes: c.notes.slice(0, 400),
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    recentEmails: threads.filter((t) => t.contactId === c.id && t.category !== "meeting").slice(0, 3).map((t) => ({ subject: t.subject, summary: t.summary.slice(0, 240), at: t.at?.toISOString() ?? null })),
    deals: deals.filter((d) => d.contactId === c.id || pickedDeals.some((p) => p.id === d.id && !d.contactId)).map((d) => ({ id: d.id, name: d.name, stage: d.stage, amountUsd: d.amountUsd, round: d.round, nextStep: d.nextStep })),
  }));
  const names = [...new Set([...deals.map((d) => d.name), ...contacts.map((c) => c.company)].filter(Boolean))].slice(0, 2);
  const companies = await Promise.all(names.map(companyFacts));
  return { people, companies: companies.filter((c) => c.facts.length || c.ticker), builtAt: new Date().toISOString() };
}

/** The brief as short lines, for the copilot window and for prompts. Pure. */
export function briefLines(b: Brief): string[] {
  const out: string[] = [];
  for (const p of b.people) {
    const who = [p.name || p.email, [p.title, p.company].filter(Boolean).join(" at ")].filter(Boolean).join(", ");
    const deals = p.deals.map((d) => `${d.name}: ${STAGE_LABEL[d.stage as keyof typeof STAGE_LABEL] ?? d.stage}${d.round || d.amountUsd ? ` (${[d.round, money(d.amountUsd)].filter(Boolean).join(" ")})` : ""}${d.nextStep ? `, next: ${d.nextStep}` : ""}`);
    out.push([who, deals.length ? `Deal ${deals.join("; ")}` : "", p.recentEmails[0] ? `Last email: “${p.recentEmails[0].subject}”${p.recentEmails[0].summary ? `: ${p.recentEmails[0].summary}` : ""}` : "", p.notes ? `Your notes: ${p.notes}` : ""].filter(Boolean).join(". "));
  }
  for (const c of b.companies) if (c.facts.length) out.push(`${c.name}${c.ticker ? ` (${c.ticker})` : ""}: ${c.facts.join("; ")}`);
  return out;
}

/** The brief for a meeting, built once and kept on it (it only reads, so rebuilding is cheap too). */
export async function meetingBrief(userId: string, m: MeetingRow, fresh = false): Promise<Brief> {
  const cached = (m.live as { brief?: Brief }).brief;
  if (cached && !fresh && Date.now() - Date.parse(cached.builtAt) < 10 * 60_000) return cached;
  const brief = await buildBrief(userId, await meetingRefs(m));
  await updateMeeting(m.id, { live: { ...m.live, brief } });
  return brief;
}

/* ---------------- Live suggestions (premium) ---------------- */

const Suggestions = z.object({
  questions: z.array(z.string()).describe("up to 3 questions the person could ask next, specific to what was just said and to what they know about these people; none if nothing useful"),
  facts: z.array(z.object({ about: z.string(), text: z.string() })).describe("up to 4 facts from the brief that matter right now (a number, a past promise, a deal term), each about a person or company"),
  watch: z.array(z.string()).describe("up to 2 things to be careful about (a claim that contradicts the brief, a commitment being made), or none"),
});
export type LiveSuggestions = z.infer<typeof Suggestions>;

/** Switch live suggestions on or off for one meeting. On needs the plan and a meeting still running. */
export async function setLive(user: { id: string; email: string }, meetingId: number, on: boolean): Promise<{ on: boolean }> {
  const m = await getMeeting(user.id, meetingId);
  if (on) {
    await requireFeature(user, "meetings.live");
    if (m.status !== "live") throw status("Live suggestions work while a meeting is running.", 409);
  }
  await updateMeeting(m.id, { live: { ...m.live, on, ...(on ? { since: new Date().toISOString() } : {}) } });
  return { on };
}

/**
 * One round of suggestions from the last few minutes. Refused unless the person switched them on for
 * this meeting, the meeting is running and the plan includes them; at most two a minute.
 */
export async function liveSuggestions(user: { id: string; email: string; name: string }, meetingId: number): Promise<LiveSuggestions & { minutes: number }> {
  const m = await getMeeting(user.id, meetingId);
  if (!m.live.on) throw status("Live suggestions are off for this meeting. Switch them on to get them.", 403);
  if (m.status !== "live") throw status("This meeting has ended.", 409);
  await requireFeature(user, "meetings.live");
  await rateLimit(`meetings-live:${m.id}`, 2, 60_000, "Suggestions refresh about once a minute.");
  const tail = (await transcriptTail(m.id, 8)).filter((s) => s.end >= Math.max(0, (m.durationSec || 0) - 240));
  if (!tail.length) return { questions: [], facts: [], watch: [], minutes: m.live.minutes ?? 0 };
  const [brief, ctx] = await Promise.all([meetingBrief(user.id, m), loadUserContext(user.id)]);
  const { data } = await structured(Suggestions, "meetings-live",
    `You help ${user.name || "the person"} during a live meeting${m.title ? ` (“${m.title}”)` : ""}. Suggest what to ask and what to remember, drawing only on the brief and the transcript. Be brief and concrete; never invent facts. "You" in the transcript is the person you help.`,
    `Brief:\n${briefLines(brief).map((l) => `- ${l}`).join("\n") || "- nothing on file"}\n\nThe last few minutes:\n${renderTranscript(tail, 12_000)}`,
    { prefs: ctx.prefs, task: "extract", maxTokens: 1500, timeoutMs: 45_000 });
  const minutes = (m.live.minutes ?? 0) + 1;
  await updateMeeting(m.id, { live: { ...m.live, minutes, lastAt: new Date().toISOString() } });
  return {
    questions: data.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3),
    facts: data.facts.filter((f) => f.text.trim()).slice(0, 4),
    watch: data.watch.map((w) => w.trim()).filter(Boolean).slice(0, 2),
    minutes,
  };
}

/* ---------------- Ask about a meeting ---------------- */

const Answer = z.object({
  answer: z.string().describe("a direct answer in a few sentences, from the transcript and notes only; say plainly when they do not say"),
  quotes: z.array(z.object({ at: z.string().describe("the [mm:ss] time of the line"), speaker: z.string(), text: z.string() })).describe("up to 3 lines from the transcript that support the answer"),
});

export async function askMeeting(user: { id: string; name: string }, meetingId: number, question: string) {
  const q = question.trim().slice(0, 1000);
  if (!q) throw status("Ask a question about the meeting.", 400);
  await rateLimit(`meetings-ask:${user.id}`, 40, 3_600_000, "Many questions this hour; try again later.");
  const m = await getMeeting(user.id, meetingId);
  const [segments, ctx] = await Promise.all([transcriptOf(m), loadUserContext(user.id)]);
  if (!segments.length) throw status(m.purgedAt ? "This meeting's transcript was deleted under your retention setting." : "Nothing has been transcribed yet.", 409);
  const notes = m.notes as MeetingNotes | null;
  const { data } = await structured(Answer, "meetings-ask",
    `You answer questions about one meeting for ${user.name || "the person"} ("You" in the transcript). Use only the transcript and notes. Quote exactly.`,
    `${notes?.summary ? `Summary: ${notes.summary}\n\n` : ""}Transcript:\n${renderTranscript(segments, 100_000)}\n\nQuestion: ${q}`,
    { prefs: ctx.prefs, task: "summarize", maxTokens: 1500, timeoutMs: 60_000 });
  return { answer: data.answer.trim(), quotes: data.quotes.slice(0, 3) };
}
