import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { knowledgeNote } from "./insights";
import { loadUserContext } from "@/lib/ai/persona";
import { directoryRecord, enrichCompany } from "./agent";
import { renderPlaybook, selectPlaybook } from "./autopilot-rules";
import { upsertContact, type DraftRow } from "./db";
import { lessonsFor, ownExamples } from "./engine";
import { asEntries, listPlaybook } from "./knowledge";
import { companyDomain } from "./model";
import { writeCompose, type HistoryItem } from "./outreach";
import { getSettings, personaFor, standingOrders } from "./settings";

/**
 * A new email to anyone, from a one-line brief: "ask Maya for a 20-minute call next week about the
 * pilot". The agent writes it from what YouBank knows about the person and their company; it lands in
 * the review queue like any draft. New emails are never sent by autopilot: a person asked for this one.
 */
export async function composeDraft(userId: string, input: { to: string; name?: string; company?: string; brief: string }): Promise<DraftRow> {
  const db = requireDb();
  const email = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new Error("That is not an email address");
  const brief = input.brief.trim().slice(0, 1500);
  if (!brief) throw new Error("Say what the email should do");

  const match = await enrichCompany(input.company ?? "", companyDomain(email)).catch(() => null);
  const contact = await upsertContact(userId, { email, name: input.name, company: input.company || match?.name || "", startupId: match?.id ?? null });
  const history = await db.select({ direction: schema.crmMessages.direction, sentAt: schema.crmMessages.sentAt, subject: schema.crmMessages.subject, body: schema.crmMessages.body })
    .from(schema.crmMessages).innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
    .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.contactId, contact.id)))
    .orderBy(desc(schema.crmMessages.sentAt)).limit(4);
  const [ctx, settings, playbook, directory] = await Promise.all([loadUserContext(userId), getSettings(userId), listPlaybook(userId), directoryRecord(contact.startupId)]);

  const [lessons, examples, known] = await Promise.all([lessonsFor(userId, "compose"), ownExamples(userId, brief), knowledgeNote(userId, contact.id)]);
  const { data, provider, model } = await writeCompose({
    mode: settings.mode, persona: personaFor(ctx, settings), orders: [standingOrders(settings), lessons, examples, known].filter(Boolean).join("\n\n"),
    playbook: renderPlaybook(selectPlaybook(asEntries(playbook), brief)), brief,
    to: { name: contact.name, email, company: contact.company, notes: contact.notes }, directory,
    history: history.reverse().map((m): HistoryItem => ({ direction: m.direction === "outbound" ? "outbound" : "inbound", sentAt: m.sentAt?.toISOString().slice(0, 10) ?? null, subject: m.subject, body: m.body })),
  }, { prefs: ctx.prefs });

  const [row] = await db.insert(schema.crmDrafts).values({
    userId, kind: "compose", contactId: contact.id, toAddresses: [{ name: contact.name, address: email }],
    subject: data.subject, body: data.body, originalBody: data.body, rationale: data.rationale, citations: data.openQuestions.map((q) => ({ label: q, url: "" })),
    confidence: data.confidence, sensitive: data.sensitive, provider, model,
  }).returning();
  return row;
}
