import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import type { PlaybookEntry } from "./autopilot-rules";

/**
 * What the agent has been taught, and what it is waiting to be taught.
 *
 * The playbook is the durable part: questions the agent will meet again and the person's answers,
 * put in front of the model whenever they are relevant. Questions are the live part: things a draft
 * could not settle, waiting for an answer that will finish it.
 */

export type QuestionRow = typeof schema.crmQuestions.$inferSelect;
export type PlaybookRow = typeof schema.crmPlaybook.$inferSelect;

/* ---------------- Playbook ---------------- */

export async function listPlaybook(userId: string): Promise<PlaybookRow[]> {
  return requireDb().select().from(schema.crmPlaybook).where(eq(schema.crmPlaybook.userId, userId)).orderBy(desc(schema.crmPlaybook.updatedAt));
}

export const asEntries = (rows: PlaybookRow[]): PlaybookEntry[] => rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer }));

export async function addPlaybookEntry(userId: string, input: { question: string; answer: string; source?: string }): Promise<PlaybookRow> {
  const question = input.question.trim().slice(0, 500);
  const answer = input.answer.trim().slice(0, 4000);
  if (!question || !answer) throw new Error("A playbook entry needs both a question and an answer");
  const [row] = await requireDb().insert(schema.crmPlaybook).values({ userId, question, answer, source: input.source ?? "you" }).returning();
  return row;
}

export async function updatePlaybookEntry(userId: string, id: number, input: { question?: string; answer?: string }): Promise<PlaybookRow> {
  const set: Partial<PlaybookRow> = { updatedAt: new Date() };
  if (input.question !== undefined) set.question = input.question.trim().slice(0, 500);
  if (input.answer !== undefined) set.answer = input.answer.trim().slice(0, 4000);
  if (set.question === "" || set.answer === "") throw new Error("A playbook entry needs both a question and an answer");
  const [row] = await requireDb().update(schema.crmPlaybook).set(set)
    .where(and(eq(schema.crmPlaybook.id, id), eq(schema.crmPlaybook.userId, userId))).returning();
  if (!row) throw new Error("Playbook entry not found");
  return row;
}

const General = z.object({
  question: z.string().describe("the kind of question this answers, with no names of the person or company who asked, e.g. 'Pricing for customers with up to 10 entities'"),
  answer: z.string().describe("the reader's answer with every fact, number, condition and limit kept exactly; only names and one-off details removed"),
});

/**
 * Turn an answer given about one email into a playbook entry that fits the next one. "What should we
 * quote PayDragon for 10 entities?" becomes "Pricing for customers with up to 10 entities", so the
 * next prospect with 8 entities is answered without asking again. Falls back to the words as given.
 */
export async function generalizeAnswer(userId: string, question: string, answer: string): Promise<{ question: string; answer: string }> {
  try {
    const ctx = await loadUserContext(userId);
    const { data } = await structured(General, "playbook_entry",
      "You turn a question a person answered about one specific email into a reusable playbook entry for their email assistant. Remove the names of the specific person and company and any one-off detail. Keep every fact, number, price, condition and limit exactly as the person wrote it; never add, round or soften anything. If the answer only makes sense for that one case, keep it specific.",
      `Question the assistant asked: ${question}\nThe person's answer: ${answer}`, { prefs: ctx.prefs });
    return data.question.trim() && data.answer.trim() ? { question: data.question.trim(), answer: data.answer.trim() } : { question, answer };
  } catch {
    return { question, answer };
  }
}

export async function deletePlaybookEntry(userId: string, id: number): Promise<void> {
  await requireDb().delete(schema.crmPlaybook).where(and(eq(schema.crmPlaybook.id, id), eq(schema.crmPlaybook.userId, userId)));
}

/* ---------------- Questions ---------------- */

/** Record what a draft needs from the person. Earlier open questions on the same thread are closed first. */
export async function recordQuestions(userId: string, draftId: number, threadId: number | null, items: { question: string; context: string }[]): Promise<QuestionRow[]> {
  const db = requireDb();
  if (threadId) {
    await db.update(schema.crmQuestions).set({ status: "dismissed" })
      .where(and(eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.threadId, threadId), eq(schema.crmQuestions.status, "open")));
  }
  const clean = items.map((q) => ({ question: q.question.trim().slice(0, 500), context: q.context.trim().slice(0, 1000) })).filter((q) => q.question).slice(0, 5);
  if (clean.length === 0) return [];
  return db.insert(schema.crmQuestions).values(clean.map((q) => ({ userId, draftId, threadId, ...q }))).returning();
}

export async function listOpenQuestions(userId: string) {
  const db = requireDb();
  const rows = await db.select().from(schema.crmQuestions)
    .where(and(eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.status, "open"))).orderBy(desc(schema.crmQuestions.createdAt)).limit(50);
  const threadIds = [...new Set(rows.map((r) => r.threadId).filter((x): x is number => x != null))];
  const threads = threadIds.length
    ? await db.select({ id: schema.crmThreads.id, subject: schema.crmThreads.subject, summary: schema.crmThreads.summary, participants: schema.crmThreads.participants })
      .from(schema.crmThreads).where(inArray(schema.crmThreads.id, threadIds))
    : [];
  const byId = new Map(threads.map((t) => [t.id, t]));
  return rows.map((r) => ({ ...r, thread: r.threadId ? byId.get(r.threadId) ?? null : null }));
}

export async function openQuestionsFor(draftId: number): Promise<QuestionRow[]> {
  return requireDb().select().from(schema.crmQuestions).where(and(eq(schema.crmQuestions.draftId, draftId), eq(schema.crmQuestions.status, "open")));
}
