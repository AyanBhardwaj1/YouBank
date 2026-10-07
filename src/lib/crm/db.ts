import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { EmailAddress } from "@/db/schema";
import { loadUserContext } from "@/lib/ai/persona";
import type { AiOverride } from "@/lib/ai/config";
import { draftReply, enrichCompany, triageThread, type ThreadInput, type TriageResult } from "./agent";
import { audienceOf, renderPlaybook, selectPlaybook } from "./autopilot-rules";
import { contextOf, lessonsFor, ownExamples, recordCancel, settleOutreach } from "./engine";
import { knowledgeNote } from "./insights";
import { asEntries, listPlaybook, recordQuestions } from "./knowledge";
import { ENTRY_STAGES, STAGE_LABEL, companyDomain, isStage, stagesFor, statusForStage, type DraftKind, type Stage } from "./model";
import { getSettings, internalDomains, personaFor, standingOrders } from "./settings";
import { schedulingNote } from "@/lib/calendar/scheduling";

export type ThreadRow = typeof schema.crmThreads.$inferSelect;
export type MessageRow = typeof schema.crmMessages.$inferSelect;
export type DealRow = typeof schema.crmDeals.$inferSelect;
export type ContactRow = typeof schema.crmContacts.$inferSelect;
export type DraftRow = typeof schema.crmDrafts.$inferSelect;
export type ActionRow = typeof schema.crmActions.$inferSelect;

export type IncomingMessage = {
  providerMessageId?: string;
  direction?: "inbound" | "outbound";
  fromName?: string;
  fromAddress: string;
  toAddresses?: EmailAddress[];
  subject?: string;
  body: string;
  sentAt?: Date | null;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string[];
  /** Machine-sent: an auto-reply, a list, a no-reply sender. */
  automated?: boolean;
};

/* ---------------- Ingest ---------------- */

export type IngestDelta = { thread: ThreadRow; addedInbound: number; addedOutbound: number };

/**
 * Store a thread and its messages, keyed by the provider's thread id so re-syncing is idempotent.
 * Messages already present (same provider id, or same RFC Message-ID) are skipped rather than
 * duplicated. Returns what was new, which is what decides whether the agent has anything to do.
 */
export async function ingestThread(userId: string, input: Parameters<typeof ingestThreadDelta>[1]): Promise<ThreadRow> {
  return (await ingestThreadDelta(userId, input)).thread;
}

export async function ingestThreadDelta(userId: string, input: {
  providerThreadId: string; accountId?: number | null; subject?: string; messages: IncomingMessage[];
}): Promise<IngestDelta> {
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

  const existing = await db.select({ pid: schema.crmMessages.providerMessageId, rfc: schema.crmMessages.rfcMessageId })
    .from(schema.crmMessages).where(eq(schema.crmMessages.threadId, thread.id));
  const seen = new Set(existing.flatMap((e) => [e.pid, e.rfc]).filter(Boolean));
  const fresh = messages.filter((m) => !(m.providerMessageId && seen.has(m.providerMessageId)) && !(m.rfcMessageId && seen.has(m.rfcMessageId)));
  if (fresh.length) {
    await db.insert(schema.crmMessages).values(fresh.map((m) => ({
      threadId: thread.id, providerMessageId: m.providerMessageId ?? "",
      direction: m.direction ?? "inbound", fromName: m.fromName ?? "", fromAddress: m.fromAddress,
      toAddresses: m.toAddresses ?? [], subject: m.subject ?? subject, body: m.body ?? "", sentAt: m.sentAt ?? new Date(),
      rfcMessageId: m.rfcMessageId ?? "", inReplyTo: m.inReplyTo ?? "", automated: !!m.automated,
    })));
  }
  return {
    thread,
    addedInbound: fresh.filter((m) => (m.direction ?? "inbound") === "inbound").length,
    addedOutbound: fresh.filter((m) => m.direction === "outbound").length,
  };
}

/** The connected mailboxes' own addresses, which decide who counts as a coworker. */
export async function mailboxAddresses(userId: string): Promise<string[]> {
  const rows = await requireDb().select({ address: schema.emailAccounts.address }).from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, userId));
  return rows.map((r) => r.address);
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
  const [ctx, settings, mailboxes] = await Promise.all([loadUserContext(userId), getSettings(userId), mailboxAddresses(userId)]);
  const input = toThreadInput(thread, messages);

  const inbound = messages.find((m) => m.direction === "inbound") ?? messages[0];
  const latestInbound = [...messages].reverse().find((m) => m.direction === "inbound") ?? inbound;
  const audience = audienceOf(latestInbound.fromAddress, internalDomains(settings, mailboxes));

  const { data: triage } = await triageThread(input, {
    mode: settings.mode, persona: personaFor(ctx, settings), orders: standingOrders(settings, { forTriage: true }), audience,
    prefs: ctx.prefs, override: opts?.override,
  });
  // A company is a deal only when it is someone else's. Coworkers are never a pipeline entry.
  if (audience === "internal") triage.company = null;

  const directory = triage.company ? await enrichCompany(triage.company.name, companyDomain(inbound.fromAddress)).catch(() => null) : null;

  const contact = inbound.fromAddress && inbound.direction === "inbound"
    ? await upsertContact(userId, {
        email: inbound.fromAddress,
        name: triage.contact.name || inbound.fromName,
        title: triage.contact.title,
        company: triage.company?.name ?? "",
        kind: audience === "internal" ? "colleague" : triage.contact.kind,
        startupId: directory?.id ?? null,
      })
    : null;
  if (contact && triage.optOut) await optOutContact(userId, contact.id);

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
      // Instead, a stage change the thread implies becomes a suggestion for a person to approve.
      const to = triage.suggestedStage;
      if (isStage(to) && !ENTRY_STAGES.includes(to) && to !== existing.stage) {
        const newest = messages[messages.length - 1];
        await recordAction(userId, {
          kind: "move_stage",
          title: `Move ${existing.name} from ${STAGE_LABEL[existing.stage as Stage] ?? existing.stage} to ${STAGE_LABEL[to]}`,
          reasoning: [triage.summary, triage.nextStep ? `Next step: ${triage.nextStep}` : ""].filter(Boolean).join(" "),
          uncertainties: triage.claimsToVerify,
          payload: { dealId: existing.id, from: existing.stage, to },
          dedupeKey: `move_stage:${existing.id}:${to}:${newest?.id ?? 0}`,
          dealId: existing.id, contactId: contact.id, threadId: thread.id,
        });
      }
    } else {
      const stages = stagesFor(settings.mode);
      [deal] = await db.insert(schema.crmDeals).values({
        userId, contactId: contact.id, source: "inbound_email",
        stage: stages.includes(triage.suggestedStage) ? triage.suggestedStage : stages[0], ...values,
      }).returning();
    }
  }

  // Settled by the facts, not the model: nothing needs a reply when the reader wrote last, or when the
  // last message came from a machine. This is what keeps the agent from answering twice or answering bots.
  const newest = messages[messages.length - 1];
  const needsReply = triage.needsReply && newest?.direction === "inbound" && !newest.automated;
  const [updated] = await db.update(schema.crmThreads).set({
    category: audience === "internal" ? "colleague" : triage.category, priority: triage.priority, summary: triage.summary,
    needsReply, contactId: contact?.id ?? thread.contactId ?? null, dealId: deal?.id ?? thread.dealId ?? null, triagedAt: new Date(),
  }).where(eq(schema.crmThreads.id, thread.id)).returning();

  await recordReplies(userId, thread.id, messages, triage.optOut);

  return { thread: updated, triage, contact, deal, directoryMatch: directory?.name ?? null };
}

/** Write a reply for review. The draft is stored pending; nothing is sent. */
export async function createDraft(userId: string, threadId: number, opts?: {
  instruction?: string; override?: AiOverride; kind?: DraftKind; meta?: DraftRow["meta"];
}): Promise<DraftRow> {
  const db = requireDb();
  const found = await threadWithMessages(userId, threadId);
  if (!found) throw new Error("Thread not found");
  const { thread, messages } = found;
  const [ctx, settings, playbook, mailboxes] = await Promise.all([loadUserContext(userId), getSettings(userId), listPlaybook(userId), mailboxAddresses(userId)]);
  const input = toThreadInput(thread, messages);

  const inbound = [...messages].reverse().find((m) => m.direction === "inbound") ?? messages[0];
  const audience = audienceOf(inbound.fromAddress, internalDomains(settings, mailboxes));
  const recent = `${thread.subject}\n${messages.slice(-3).map((m) => m.body).join("\n")}`;
  const [lessons, examples, known, availability] = await Promise.all([
    lessonsFor(userId, contextOf({ kind: opts?.kind ?? "reply", meta: { audience } })),
    ownExamples(userId, recent),
    audience === "internal" ? Promise.resolve("") : knowledgeNote(userId, thread.contactId),
    // Real free times from the calendar, when the thread is about meeting (premium; empty otherwise).
    schedulingNote(userId, recent, { category: thread.category }).catch(() => ""),
  ]);
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
    mode: settings.mode, persona: personaFor(ctx, settings), orders: [standingOrders(settings), lessons, examples, known, availability].filter(Boolean).join("\n\n"),
    playbook: renderPlaybook(selectPlaybook(asEntries(playbook), recent)), audience,
    triage, directory: audience === "internal" ? null : directory, instruction: opts?.instruction,
  }, { prefs: ctx.prefs, override: opts?.override });

  const to: EmailAddress[] = inbound.fromAddress ? [{ name: inbound.fromName ?? "", address: inbound.fromAddress }] : [];
  // Replies keep the conversation's subject, so they thread in every mail client.
  const subject = thread.subject ? `Re: ${thread.subject.replace(/^(re:\s*)+/i, "")}` : data.subject;
  const [row] = await db.insert(schema.crmDrafts).values({
    userId, threadId: thread.id, dealId: thread.dealId, contactId: thread.contactId, toAddresses: to,
    kind: opts?.kind ?? "reply", meta: { ...(opts?.meta ?? {}), audience, category: thread.category },
    subject, body: data.body, originalBody: data.body, rationale: data.rationale,
    citations: data.openQuestions.map((q) => ({ label: q, url: "" })),
    confidence: data.confidence, sensitive: data.sensitive,
    replyToMessageId: inbound.direction === "inbound" ? inbound.id : null,
    provider, model,
  }).returning();
  if (data.needsInput.length) await recordQuestions(userId, row.id, thread.id, data.needsInput);
  return row;
}

/**
 * The conversation moved on without this draft: the reader answered from their own mail client, or
 * the other side wrote again. Pending replies for the thread are withdrawn, with the reason kept.
 */
export async function supersedeReplies(userId: string, threadId: number, reason: string): Promise<number> {
  const db = requireDb();
  const rows = await db.update(schema.crmDrafts).set({ status: "superseded", scheduledFor: null, holdReason: reason, decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.threadId, threadId), eq(schema.crmDrafts.status, "pending"),
      inArray(schema.crmDrafts.kind, ["reply", "follow_up"]))).returning({ id: schema.crmDrafts.id });
  if (rows.length) {
    await db.update(schema.crmQuestions).set({ status: "dismissed" })
      .where(and(eq(schema.crmQuestions.userId, userId), inArray(schema.crmQuestions.draftId, rows.map((r) => r.id)), eq(schema.crmQuestions.status, "open")));
  }
  return rows.length;
}

/* ---------------- Suggestions, replies and opt-outs ---------------- */

/**
 * Record a suggestion for a person to approve. The dedupe key is unique per user, so a suggestion
 * that already exists, or was dismissed, is not raised again.
 */
export async function recordAction(userId: string, a: {
  kind: string; title: string; reasoning?: string; uncertainties?: string[]; payload?: Record<string, unknown>;
  dedupeKey: string; contactId?: number | null; dealId?: number | null; threadId?: number | null;
}): Promise<ActionRow | null> {
  const [row] = await requireDb().insert(schema.crmActions).values({
    userId, kind: a.kind, title: a.title.slice(0, 300), reasoning: a.reasoning ?? "", uncertainties: a.uncertainties ?? [],
    payload: a.payload ?? {}, dedupeKey: a.dedupeKey, contactId: a.contactId ?? null, dealId: a.dealId ?? null, threadId: a.threadId ?? null,
  }).onConflictDoNothing().returning();
  return row ?? null;
}

/**
 * Someone asked not to be contacted. Record it, take them out of every campaign, and withdraw any
 * outreach still waiting for review. A reply to something they asked is left alone.
 */
export async function optOutContact(userId: string, contactId: number): Promise<void> {
  const db = requireDb();
  const [c] = await db.update(schema.crmContacts).set({ optedOutAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.userId, userId))).returning();
  if (!c) return;
  await db.update(schema.crmCampaignLeads).set({ status: "opted_out" })
    .where(and(eq(schema.crmCampaignLeads.userId, userId), eq(schema.crmCampaignLeads.email, c.email),
      inArray(schema.crmCampaignLeads.status, ["sourced", "review", "qualified", "active"])));
  await db.update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.contactId, contactId), eq(schema.crmDrafts.status, "pending"),
      inArray(schema.crmDrafts.kind, ["nurture", "campaign", "follow_up"])));
}

/**
 * A lead in a live sequence wrote back. Stop the sequence: mark them replied (or opted out) and
 * withdraw the next step if one was waiting. Matching is by address, so a reply in a new thread counts.
 */
export async function recordReplies(userId: string, threadId: number, messages: MessageRow[], optOut: boolean): Promise<number> {
  const db = requireDb();
  // An out-of-office or other auto-reply is not an answer: it neither stops a sequence nor rewards an angle.
  const inbound = messages.filter((m) => m.direction === "inbound" && m.fromAddress && m.sentAt && !m.automated);
  if (inbound.length === 0) return 0;
  const addresses = [...new Set(inbound.map((m) => m.fromAddress.toLowerCase()))];
  const leads = await db.select().from(schema.crmCampaignLeads)
    .where(and(eq(schema.crmCampaignLeads.userId, userId), inArray(schema.crmCampaignLeads.email, addresses), eq(schema.crmCampaignLeads.status, "active")));
  let n = 0;
  for (const lead of leads) {
    const reply = inbound.find((m) => m.fromAddress.toLowerCase() === lead.email && lead.lastSentAt && m.sentAt! > lead.lastSentAt);
    if (!reply) continue;
    await db.update(schema.crmCampaignLeads).set({
      status: optOut ? "opted_out" : "replied", repliedAt: reply.sentAt, repliedAtStep: Math.max(0, lead.step - 1), threadId: lead.threadId ?? threadId,
    }).where(eq(schema.crmCampaignLeads.id, lead.id));
    await db.update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
      .where(and(eq(schema.crmDrafts.campaignLeadId, lead.id), eq(schema.crmDrafts.status, "pending")));
    n++;
  }
  // A reply is the reward the outreach experiments wait for: credit the angle and hour that earned it.
  if (n) {
    const settings = await getSettings(userId);
    await settleOutreach(userId, settings.autopilot.window.tz).catch(() => undefined);
  }
  return n;
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
    .orderBy(status === "sent" ? desc(schema.crmDrafts.sentAt) : desc(schema.crmDrafts.createdAt))
    .limit(status === "sent" ? 40 : 200);
}

export async function moveDeal(userId: string, dealId: number, stage: Stage): Promise<DealRow> {
  const [row] = await requireDb().update(schema.crmDeals)
    .set({ stage, status: statusForStage(stage), updatedAt: new Date() })
    .where(and(eq(schema.crmDeals.id, dealId), eq(schema.crmDeals.userId, userId))).returning();
  if (!row) throw new Error("Deal not found");
  return row;
}

/**
 * Save a reviewer's edits without sending. Editing takes the draft off the autopilot schedule: once a
 * person has touched it, a person sends it.
 */
export async function updateDraft(userId: string, draftId: number, fields: { subject?: string; body?: string }): Promise<DraftRow> {
  const [row] = await requireDb().update(schema.crmDrafts).set({
    ...(fields.subject !== undefined ? { subject: fields.subject } : {}),
    ...(fields.body !== undefined ? { body: fields.body } : {}),
    scheduledFor: null, holdReason: "",
  }).where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"))).returning();
  if (!row) throw new Error("Draft not found, or already decided");
  return row;
}

/**
 * Stop autopilot from sending a draft. It stays in the queue for the person, and counts as a cancel
 * for earned autonomy: three in a row hand that kind of email back to the person.
 */
export async function unscheduleDraft(userId: string, draftId: number): Promise<DraftRow> {
  const [before] = await requireDb().select({ scheduledFor: schema.crmDrafts.scheduledFor }).from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId)));
  const [row] = await requireDb().update(schema.crmDrafts).set({ scheduledFor: null, holdReason: "You stopped autopilot on this one; it waits for you." })
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"))).returning();
  if (!row) throw new Error("Draft not found, or already decided");
  if (before?.scheduledFor) await recordCancel(userId, row).catch(() => undefined);
  return row;
}

/**
 * Discard a draft. For a campaign email that also takes the lead out of the sequence; otherwise
 * the next run would simply write it again.
 */
export async function discardDraft(userId: string, draftId: number): Promise<void> {
  const db = requireDb();
  const [draft] = await db.update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"))).returning();
  if (draft) {
    await db.update(schema.crmQuestions).set({ status: "dismissed" })
      .where(and(eq(schema.crmQuestions.draftId, draft.id), eq(schema.crmQuestions.status, "open")));
  }
  if (draft?.campaignLeadId) {
    const [lead] = await db.select().from(schema.crmCampaignLeads).where(eq(schema.crmCampaignLeads.id, draft.campaignLeadId));
    if (lead && (lead.status === "qualified" || lead.status === "active")) {
      await db.update(schema.crmCampaignLeads).set({
        status: lead.lastSentAt ? "finished" : "disqualified",
        fitReason: `${lead.fitReason} (Taken out of the sequence when you discarded its draft.)`.trim(),
      }).where(eq(schema.crmCampaignLeads.id, lead.id));
    }
  }
}

/** Per thread: the latest draft's state and open questions, so the inbox can say what the agent did. */
export async function threadActivity(userId: string, threadIds: number[]) {
  if (threadIds.length === 0) return {};
  const db = requireDb();
  const drafts = await db.select({
    threadId: schema.crmDrafts.threadId, status: schema.crmDrafts.status, scheduledFor: schema.crmDrafts.scheduledFor,
    sentBy: schema.crmDrafts.sentBy, sentAt: schema.crmDrafts.sentAt, holdReason: schema.crmDrafts.holdReason, createdAt: schema.crmDrafts.createdAt,
  }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, userId), inArray(schema.crmDrafts.threadId, threadIds))).orderBy(desc(schema.crmDrafts.createdAt));
  const questions = await db.select({ threadId: schema.crmQuestions.threadId, n: sql<number>`count(*)::int` }).from(schema.crmQuestions)
    .where(and(eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.status, "open"), inArray(schema.crmQuestions.threadId, threadIds)))
    .groupBy(schema.crmQuestions.threadId);
  const out: Record<number, { draft: (typeof drafts)[number] | null; questions: number }> = {};
  for (const id of threadIds) out[id] = { draft: drafts.find((d) => d.threadId === id) ?? null, questions: questions.find((q) => q.threadId === id)?.n ?? 0 };
  return out;
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
  const [actions] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmActions)
    .where(and(eq(schema.crmActions.userId, userId), eq(schema.crmActions.status, "pending")));
  return {
    threads: threads?.n ?? 0, pendingDrafts: pending?.n ?? 0, needsReply: needsReply?.n ?? 0, pendingActions: actions?.n ?? 0,
    byStage: Object.fromEntries(stages.map((s) => [s.stage, s.n])),
  };
}

export { inArray };
