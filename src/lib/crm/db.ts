import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { EmailAddress } from "@/db/schema";
import { loadUserContext } from "@/lib/ai/persona";
import type { AiOverride } from "@/lib/ai/config";
import { draftReply, enrichCompany, triageThread, type ThreadInput, type TriageResult } from "./agent";
import { companyDomain, isStage, type Stage } from "./model";

export type ThreadRow = typeof schema.crmThreads.$inferSelect;
export type MessageRow = typeof schema.crmMessages.$inferSelect;
export type DealRow = typeof schema.crmDeals.$inferSelect;
export type ContactRow = typeof schema.crmContacts.$inferSelect;
export type DraftRow = typeof schema.crmDrafts.$inferSelect;

export type IncomingMessage = {
  providerMessageId?: string;
  direction?: "inbound" | "outbound";
  fromName?: string;
  fromAddress: string;
  toAddresses?: EmailAddress[];
  subject?: string;
  body: string;
  sentAt?: Date | null;
};

/* ---------------- Ingest ---------------- */

/**
 * Store a thread and its messages, keyed by the provider's thread id so re-syncing is idempotent.
 * Messages already present (same provider id) are skipped rather than duplicated.
 */
export async function ingestThread(userId: string, input: {
  providerThreadId: string; accountId?: number | null; subject?: string; messages: IncomingMessage[];
}): Promise<ThreadRow> {
  const db = requireDb();
  const messages = input.messages.filter((m) => m.fromAddress);
  if (messages.length === 0) throw new Error("A thread needs at least one message");
  const last = messages[messages.length - 1];
  const participants: EmailAddress[] = [];
  for (const m of messages) {
    for (const a of [{ name: m.fromName ?? "", address: m.fromAddress }, ...(m.toAddresses ?? [])]) {
      if (a.address && !participants.some((p) => p.address.toLowerCase() === a.address.toLowerCase())) participants.push(a);
    }
  }
  const subject = input.subject ?? messages[0].subject ?? "";
  const [thread] = await db.insert(schema.crmThreads).values({
    userId, accountId: input.accountId ?? null, providerThreadId: input.providerThreadId,
    subject, snippet: (last.body ?? "").replace(/\s+/g, " ").slice(0, 300), participants,
    lastMessageAt: last.sentAt ?? new Date(),
  }).onConflictDoUpdate({
    target: [schema.crmThreads.userId, schema.crmThreads.providerThreadId],
    set: { subject, snippet: (last.body ?? "").replace(/\s+/g, " ").slice(0, 300), participants, lastMessageAt: last.sentAt ?? new Date() },
  }).returning();

  const existing = await db.select({ pid: schema.crmMessages.providerMessageId }).from(schema.crmMessages).where(eq(schema.crmMessages.threadId, thread.id));
  const seen = new Set(existing.map((e) => e.pid).filter(Boolean));
  const fresh = messages.filter((m) => !m.providerMessageId || !seen.has(m.providerMessageId));
  if (fresh.length) {
    await db.insert(schema.crmMessages).values(fresh.map((m) => ({
      threadId: thread.id, providerMessageId: m.providerMessageId ?? "",
      direction: m.direction ?? "inbound", fromName: m.fromName ?? "", fromAddress: m.fromAddress,
      toAddresses: m.toAddresses ?? [], subject: m.subject ?? subject, body: m.body ?? "", sentAt: m.sentAt ?? new Date(),
    })));
  }
  return thread;
}

export async function threadWithMessages(userId: string, threadId: number): Promise<{ thread: ThreadRow; messages: MessageRow[] } | null> {
  const db = requireDb();
  const [thread] = await db.select().from(schema.crmThreads).where(and(eq(schema.crmThreads.id, threadId), eq(schema.crmThreads.userId, userId)));
  if (!thread) return null;
  const messages = await db.select().from(schema.crmMessages).where(eq(schema.crmMessages.threadId, threadId)).orderBy(schema.crmMessages.sentAt);
  return { thread, messages };
}

const toThreadInput = (thread: ThreadRow, messages: MessageRow[]): ThreadInput => ({
  subject: thread.subject,
  messages: messages.map((m) => ({
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
    sentAt: m.sentAt ? m.sentAt.toISOString().slice(0, 10) : null,
    body: m.body,
  })),
});

/* ---------------- Contacts and deals ---------------- */

/** Create or update the contact for an address, never downgrading a known field back to blank. */
export async function upsertContact(userId: string, fields: {
  email: string; name?: string; title?: string; company?: string; kind?: string; startupId?: number | null;
}): Promise<ContactRow> {
  const db = requireDb();
  const email = fields.email.toLowerCase().trim();
  const domain = companyDomain(email);
  const [existing] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), eq(schema.crmContacts.email, email)));
  const merged = {
    name: fields.name?.trim() || existing?.name || "",
    title: fields.title?.trim() || existing?.title || "",
    company: fields.company?.trim() || existing?.company || "",
    kind: fields.kind && fields.kind !== "unknown" ? fields.kind : existing?.kind || "unknown",
    startupId: fields.startupId ?? existing?.startupId ?? null,
  };
  if (existing) {
    const [row] = await db.update(schema.crmContacts).set({ ...merged, domain, lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.crmContacts.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.crmContacts).values({ userId, email, domain, lastSeenAt: new Date(), ...merged }).returning();
  return row;
}

/** The open deal for a contact, if the agent already opened one, so a reply does not create a second. */
async function openDealFor(userId: string, contactId: number): Promise<DealRow | null> {
  const [row] = await requireDb().select().from(schema.crmDeals)
    .where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.contactId, contactId), eq(schema.crmDeals.status, "open")))
    .orderBy(desc(schema.crmDeals.createdAt));
  return row ?? null;
}

/* ---------------- The agent pass ---------------- */

export type ProcessResult = { thread: ThreadRow; triage: TriageResult; contact: ContactRow | null; deal: DealRow | null; directoryMatch: string | null };

/**
 * Read a thread, file it, and record what it is.
 *
 * Triage decides the category and priority; the sender becomes a contact; a thread about a company
 * opens or updates a pipeline deal. No email is written or sent here.
 */
export async function processThread(userId: string, threadId: number, opts?: { override?: AiOverride }): Promise<ProcessResult> {
  const db = requireDb();
  const found = await threadWithMessages(userId, threadId);
  if (!found) throw new Error("Thread not found");
  const { thread, messages } = found;
  const ctx = await loadUserContext(userId);
  const input = toThreadInput(thread, messages);

  const { data: triage } = await triageThread(input, { persona: ctx.persona, prefs: ctx.prefs, override: opts?.override });

  const inbound = messages.find((m) => m.direction === "inbound") ?? messages[0];
  const directory = triage.company ? await enrichCompany(triage.company.name, companyDomain(inbound.fromAddress)).catch(() => null) : null;

  const contact = inbound.fromAddress
    ? await upsertContact(userId, {
        email: inbound.fromAddress,
        name: triage.contact.name || inbound.fromName,
        title: triage.contact.title,
        company: triage.company?.name ?? "",
        kind: triage.contact.kind,
        startupId: directory?.id ?? null,
      })
    : null;

  let deal: DealRow | null = null;
  if (triage.company && contact) {
    const existing = await openDealFor(userId, contact.id);
    const values = {
      name: triage.company.name,
      startupId: directory?.id ?? null,
      sector: triage.company.sector,
      round: triage.company.round,
      amountUsd: triage.company.amountUsd,
      valuationUsd: triage.company.valuationUsd,
      nextStep: triage.nextStep,
      updatedAt: new Date(),
    };
    if (existing) {
      // A later email can add detail, but must not silently drag a deal backwards through the pipeline.
      [deal] = await db.update(schema.crmDeals).set(values).where(eq(schema.crmDeals.id, existing.id)).returning();
    } else {
      [deal] = await db.insert(schema.crmDeals).values({
        userId, contactId: contact.id, source: "inbound_email",
        stage: isStage(triage.suggestedStage) ? triage.suggestedStage : "inbox", ...values,
      }).returning();
    }
  }

  const [updated] = await db.update(schema.crmThreads).set({
    category: triage.category, priority: triage.priority, summary: triage.summary,
    needsReply: triage.needsReply, contactId: contact?.id ?? null, dealId: deal?.id ?? null, triagedAt: new Date(),
  }).where(eq(schema.crmThreads.id, thread.id)).returning();

  return { thread: updated, triage, contact, deal, directoryMatch: directory?.name ?? null };
}

/** Write a reply for review. The draft is stored pending; nothing is sent. */
export async function createDraft(userId: string, threadId: number, opts?: { instruction?: string; override?: AiOverride }): Promise<DraftRow> {
  const db = requireDb();
  const found = await threadWithMessages(userId, threadId);
  if (!found) throw new Error("Thread not found");
  const { thread, messages } = found;
  const ctx = await loadUserContext(userId);
  const input = toThreadInput(thread, messages);

  const inbound = [...messages].reverse().find((m) => m.direction === "inbound") ?? messages[0];
  const directory = thread.dealId
    ? await (async () => {
        const [d] = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.id, thread.dealId!));
        return d ? enrichCompany(d.name, companyDomain(inbound.fromAddress)).catch(() => null) : null;
      })()
    : null;

  const triage = thread.triagedAt
    ? ({ category: thread.category, priority: thread.priority, summary: thread.summary } as TriageResult)
    : null;

  const { data, provider, model } = await draftReply(input, {
    persona: ctx.persona, triage, directory, instruction: opts?.instruction,
  }, { prefs: ctx.prefs, override: opts?.override });

  const to: EmailAddress[] = inbound.fromAddress ? [{ name: inbound.fromName ?? "", address: inbound.fromAddress }] : [];
  const [row] = await db.insert(schema.crmDrafts).values({
    userId, threadId: thread.id, dealId: thread.dealId, toAddresses: to,
    subject: data.subject, body: data.body, rationale: data.rationale,
    citations: data.openQuestions.map((q) => ({ label: q, url: "" })),
    provider, model,
  }).returning();
  return row;
}

/* ---------------- Reads and queue decisions ---------------- */

export async function listThreads(userId: string, limit = 50) {
  return requireDb().select().from(schema.crmThreads).where(eq(schema.crmThreads.userId, userId))
    .orderBy(desc(schema.crmThreads.lastMessageAt)).limit(limit);
}

export async function listDeals(userId: string) {
  return requireDb().select().from(schema.crmDeals).where(eq(schema.crmDeals.userId, userId)).orderBy(desc(schema.crmDeals.updatedAt));
}

export async function listContacts(userId: string, limit = 200) {
  return requireDb().select().from(schema.crmContacts).where(eq(schema.crmContacts.userId, userId))
    .orderBy(desc(schema.crmContacts.lastSeenAt)).limit(limit);
}

export async function listDrafts(userId: string, status = "pending") {
  return requireDb().select().from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, status)))
    .orderBy(desc(schema.crmDrafts.createdAt));
}

export async function moveDeal(userId: string, dealId: number, stage: Stage): Promise<DealRow> {
  const [row] = await requireDb().update(schema.crmDeals)
    .set({ stage, status: stage === "passed" ? "lost" : stage === "portfolio" ? "won" : "open", updatedAt: new Date() })
    .where(and(eq(schema.crmDeals.id, dealId), eq(schema.crmDeals.userId, userId))).returning();
  if (!row) throw new Error("Deal not found");
  return row;
}

/** Save a reviewer's edits without sending. */
export async function updateDraft(userId: string, draftId: number, fields: { subject?: string; body?: string }): Promise<DraftRow> {
  const [row] = await requireDb().update(schema.crmDrafts).set({
    ...(fields.subject !== undefined ? { subject: fields.subject } : {}),
    ...(fields.body !== undefined ? { body: fields.body } : {}),
  }).where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"))).returning();
  if (!row) throw new Error("Draft not found, or already decided");
  return row;
}

export async function discardDraft(userId: string, draftId: number): Promise<void> {
  await requireDb().update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId)));
}

/** Counts for the dashboard header. */
export async function crmCounts(userId: string) {
  const db = requireDb();
  const [threads] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmThreads).where(eq(schema.crmThreads.userId, userId));
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending")));
  const [needsReply] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmThreads)
    .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.needsReply, true)));
  const stages = await db.select({ stage: schema.crmDeals.stage, n: sql<number>`count(*)::int` })
    .from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.status, "open")))
    .groupBy(schema.crmDeals.stage);
  return { threads: threads?.n ?? 0, pendingDrafts: pending?.n ?? 0, needsReply: needsReply?.n ?? 0, byStage: Object.fromEntries(stages.map((s) => [s.stage, s.n])) };
}

export { inArray };
