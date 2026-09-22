import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { accessTokenFor, getAccount, listAccounts } from "./accounts";
import { messageIdHeader, sendMessage } from "./gmail";

/**
 * Send a draft that a person has approved.
 *
 * This is the only function in the codebase that sends email, and the only caller is the route
 * behind the Send button. It refuses anything not currently pending, so a draft cannot go twice.
 * The text sent is whatever the reviewer last saw: `edits` carries the on-screen version.
 */
export async function sendDraft(userId: string, draftId: number, origin: string, edits?: { subject?: string; body?: string }) {
  const db = requireDb();

  const [draft] = await db.select().from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId)));
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "pending") throw new Error(`This draft was already ${draft.status}`);

  const to = draft.toAddresses.map((a) => a.address).filter(Boolean);
  if (to.length === 0) throw new Error("This draft has no recipient");

  const subject = edits?.subject?.trim() || draft.subject;
  const body = edits?.body ?? draft.body;
  if (!body.trim()) throw new Error("This draft is empty");

  // Reply from the mailbox the thread arrived in, falling back to the only connected one.
  const [thread] = draft.threadId
    ? await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.id, draft.threadId))
    : [];
  const account = (thread?.accountId ? await getAccount(userId, thread.accountId) : null) ?? (await listAccounts(userId))[0];
  if (!account) throw new Error("No mailbox is connected, so this cannot be sent from YouBank. Copy the draft into your mail client instead.");

  const token = await accessTokenFor(account, origin);

  // Thread it against the newest inbound message, when there is one.
  let inReplyTo: string | undefined;
  let providerThreadId: string | null = null;
  if (thread) {
    providerThreadId = thread.providerThreadId.startsWith("manual-") ? null : thread.providerThreadId;
    const [last] = await db.select().from(schema.crmMessages)
      .where(and(eq(schema.crmMessages.threadId, thread.id), eq(schema.crmMessages.direction, "inbound")))
      .orderBy(desc(schema.crmMessages.sentAt));
    if (last?.providerMessageId) inReplyTo = await messageIdHeader(token, last.providerMessageId).catch(() => undefined);
  }

  const sent = await sendMessage(token, { to, subject, body, threadId: providerThreadId, inReplyTo });

  const now = new Date();
  await db.update(schema.crmDrafts).set({ status: "sent", subject, body, decidedAt: now, sentAt: now })
    .where(eq(schema.crmDrafts.id, draft.id));

  if (thread) {
    // Record what went out, so the thread and the next triage both reflect it.
    await db.insert(schema.crmMessages).values({
      threadId: thread.id, providerMessageId: sent.id, direction: "outbound",
      fromName: "", fromAddress: account.address,
      toAddresses: draft.toAddresses, subject, body, sentAt: now,
    });
    await db.update(schema.crmThreads).set({ needsReply: false, lastMessageAt: now }).where(eq(schema.crmThreads.id, thread.id));
  }

  return { id: sent.id, to, subject, sentAt: now.toISOString(), from: account.address };
}
