import { and, desc, eq, ne } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getAccount, listAccounts } from "./accounts";
import { ingestThread, type DraftRow } from "./db";
import { openMailbox, type SentMail } from "./mailbox";
import { nextDueAfter, normalizeSteps } from "./model";
import { getSettings } from "./settings";
import { describeFailure } from "@/lib/errors";

export type SentBy = "you" | "autopilot";

/** The signature goes on at send time, once, so an edited draft never ends up with two. */
export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig || body.trimEnd().endsWith(sig)) return body;
  return `${body.trimEnd()}\n\n${sig}`;
}

/**
 * Send a draft.
 *
 * This is the only function in the codebase that sends email. It is reached from the Send button, and
 * from the autopilot, which calls it only for drafts that passed every autopilot check for a kind of
 * email the person set to send on its own. Either way it:
 *
 * - claims the draft first (pending → sending), so a double click or two overlapping runs cannot send
 *   it twice, and releases it with the error if the send fails;
 * - refuses outreach to anyone who asked not to be contacted (a reply to them is still allowed);
 * - sends the text the reviewer last had on screen when a person sends it, with the signature added;
 * - threads the reply under the conversation's last message on both Gmail and IMAP mailboxes.
 */
export async function sendDraft(userId: string, draftId: number, origin: string, edits?: { subject?: string; body?: string }, opts?: { by?: SentBy }) {
  const db = requireDb();
  const by: SentBy = opts?.by ?? "you";

  // decidedAt marks when sending began, so a send the host cut off can be found and handed back.
  const [draft] = await db.update(schema.crmDrafts).set({ status: "sending", decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"))).returning();
  if (!draft) {
    const [existing] = await db.select({ status: schema.crmDrafts.status }).from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId)));
    throw new Error(existing ? `This draft was already ${existing.status}` : "Draft not found");
  }

  try {
    return await deliver(userId, draft, origin, edits, by);
  } catch (e) {
    const message = describeFailure(e, 502, "send").message;
    await db.update(schema.crmDrafts).set({ status: "pending", lastError: message.slice(0, 500), attempts: draft.attempts + 1 })
      .where(eq(schema.crmDrafts.id, draft.id));
    throw e;
  }
}

async function deliver(userId: string, draft: DraftRow, origin: string, edits: { subject?: string; body?: string } | undefined, by: SentBy) {
  const db = requireDb();
  const to = draft.toAddresses.filter((a) => a.address);
  if (to.length === 0) throw new Error("This draft has no recipient");
  const subject = edits?.subject?.trim() || draft.subject;
  const text = edits?.body ?? draft.body;
  if (!text.trim()) throw new Error("This draft is empty");

  if (draft.contactId && draft.kind !== "reply") {
    const [c] = await db.select({ optedOutAt: schema.crmContacts.optedOutAt }).from(schema.crmContacts).where(eq(schema.crmContacts.id, draft.contactId));
    if (c?.optedOutAt) throw new Error("This person asked not to be contacted. Allow contact again on their Contacts card first.");
  }

  // Reply from the mailbox the thread arrived in, falling back to the first connected one.
  const [thread] = draft.threadId ? await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.id, draft.threadId)) : [];
  const account = (thread?.accountId ? await getAccount(userId, thread.accountId) : null) ?? (await listAccounts(userId))[0];
  if (!account) throw new Error("No mailbox is connected, so this cannot be sent from YouBank. Copy the draft into your mail client instead.");
  if (account.status === "needs_reauth") throw new Error(`${account.address} needs reconnecting before YouBank can send from it.`);

  const settings = await getSettings(userId);
  const body = withSignature(text, settings.signature);
  const mailbox = await openMailbox(account, origin);
  let sent: SentMail;
  try {
    // Thread under the newest message the mailbox knows about: usually their last email; for a
    // campaign's second step, our own first one, which is what keeps the sequence one conversation.
    let inReplyTo: string | undefined;
    const references: string[] = [];
    let providerThreadId: string | null = null;
    if (thread) {
      providerThreadId = thread.providerThreadId.startsWith("manual-") ? null : thread.providerThreadId;
      const history = await db.select().from(schema.crmMessages)
        .where(and(eq(schema.crmMessages.threadId, thread.id), ne(schema.crmMessages.providerMessageId, "")))
        .orderBy(desc(schema.crmMessages.sentAt)).limit(10);
      for (const m of [...history].reverse()) if (m.rfcMessageId) references.push(m.rfcMessageId);
      const last = history[0];
      if (last && providerThreadId) inReplyTo = last.rfcMessageId || (await mailbox.rfcIdOf(last.providerMessageId).catch(() => "")) || undefined;
      if (inReplyTo && !references.includes(inReplyTo)) references.push(inReplyTo);
    }
    sent = await mailbox.send({ to, subject, body, inReplyTo, references: references.length ? references : undefined, providerThreadId });
  } finally {
    await mailbox.close();
  }

  const now = new Date();
  await recordSent(userId, draft, { accountId: account.id, from: account.address, ...sent }, { subject, body }, thread ?? null, now, by);
  return { id: sent.providerMessageId, to: to.map((a) => a.address), subject, sentAt: now.toISOString(), from: account.address, by };
}

/**
 * The bookkeeping after a message has left: mark the draft sent (and by whom), record the message on
 * its thread (creating one for outreach that started a conversation, so the reply is recognised), and
 * move a campaign lead on to its next step. Separate from sending so it can be tested without a mailbox.
 */
export async function recordSent(
  userId: string,
  draft: DraftRow,
  sent: { accountId: number; from: string; providerMessageId: string; providerThreadId: string; rfcMessageId?: string },
  text: { subject: string; body: string },
  thread: typeof schema.crmThreads.$inferSelect | null,
  now: Date,
  by: SentBy = "you",
) {
  const db = requireDb();
  const { subject, body } = text;
  await db.update(schema.crmDrafts).set({ status: "sent", subject, body, decidedAt: now, sentAt: now, sentBy: by, scheduledFor: null, lastError: "" })
    .where(eq(schema.crmDrafts.id, draft.id));

  if (thread) {
    // Record what went out, so the thread and the next triage both reflect it.
    await db.insert(schema.crmMessages).values({
      threadId: thread.id, providerMessageId: sent.providerMessageId, rfcMessageId: sent.rfcMessageId ?? "", direction: "outbound",
      fromName: "", fromAddress: sent.from, toAddresses: draft.toAddresses, subject, body, sentAt: now,
    });
    await db.update(schema.crmThreads).set({ needsReply: false, lastMessageAt: now }).where(eq(schema.crmThreads.id, thread.id));
  }

  // Outreach that started a conversation gets a thread of its own, so the reply is recognised when it lands.
  let threadId = thread?.id ?? null;
  if (!thread) {
    const created = await ingestThread(userId, {
      providerThreadId: sent.providerThreadId, accountId: sent.accountId, subject,
      messages: [{ providerMessageId: sent.providerMessageId, rfcMessageId: sent.rfcMessageId, direction: "outbound", fromAddress: sent.from, toAddresses: draft.toAddresses, subject, body, sentAt: now }],
    });
    threadId = created.id;
    await db.update(schema.crmThreads).set({ contactId: draft.contactId, dealId: draft.dealId }).where(eq(schema.crmThreads.id, created.id));
    await db.update(schema.crmDrafts).set({ threadId }).where(eq(schema.crmDrafts.id, draft.id));
  }

  // A campaign step went out: move the lead along to the next one.
  if (draft.campaignLeadId) {
    const [lead] = await db.select().from(schema.crmCampaignLeads).where(eq(schema.crmCampaignLeads.id, draft.campaignLeadId));
    const [campaign] = lead ? await db.select().from(schema.crmCampaigns).where(eq(schema.crmCampaigns.id, lead.campaignId)) : [];
    if (lead && campaign && (lead.status === "active" || lead.status === "qualified")) {
      const sentStep = draft.meta.step ?? lead.step;
      const due = nextDueAfter(normalizeSteps(campaign.steps), sentStep, now);
      await db.update(schema.crmCampaignLeads).set({
        status: due ? "active" : "finished", step: sentStep + 1, lastSentAt: now, nextDueAt: due, threadId: lead.threadId ?? threadId,
      }).where(eq(schema.crmCampaignLeads.id, lead.id));
    }
  }
}
