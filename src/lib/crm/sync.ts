import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { AccountRow } from "./accounts";
import { ingestThreadDelta, processThread, supersedeReplies, type ThreadRow } from "./db";
import type { FetchedThread } from "./gmail";
import { openMailbox } from "./mailbox";
import { describeFailure } from "@/lib/errors";

export type SyncResult = { fetched: number; ingested: number; triaged: number; skipped: number; youReplied: number; errors: string[] };

/**
 * Find the thread we already have for what the provider just returned: by the provider's thread key,
 * or else by any Message-ID it references. The second path is how the reply to an email we sent is
 * matched even when the provider files it under a different thread key than we guessed at send time.
 */
export async function resolveThread(userId: string, fetched: FetchedThread): Promise<ThreadRow | null> {
  const db = requireDb();
  const [byKey] = await db.select().from(schema.crmThreads)
    .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.providerThreadId, fetched.providerThreadId)));
  if (byKey) return byKey;
  const refs = [...new Set(fetched.messages.flatMap((m) => [m.rfcMessageId ?? "", m.inReplyTo ?? "", ...(m.references ?? [])]).filter(Boolean))].slice(0, 50);
  if (refs.length === 0) return null;
  const [hit] = await db.select({ thread: schema.crmThreads }).from(schema.crmMessages)
    .innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
    .where(and(eq(schema.crmThreads.userId, userId), inArray(schema.crmMessages.rfcMessageId, refs)))
    .limit(1);
  return hit?.thread ?? null;
}

/**
 * Read what changed in one mailbox and bring the CRM up to date.
 *
 * New inbound mail is triaged (the model call), then handed to `onTriaged`, which is where the
 * autopilot decides whether to draft and send. A thread whose only news is the reader's own reply
 * (sent from their phone or Gmail) withdraws any reply the agent had waiting, so they never both answer.
 * The cursor only moves forward once everything read has been handled, so a pass cut short by the
 * time limit is picked up by the next one; already-handled threads are recognised and skipped cheaply.
 */
export async function syncAccount(userId: string, account: AccountRow, origin: string, opts: {
  max?: number; deadline?: number; onTriaged?: (threadId: number) => Promise<void>;
}): Promise<SyncResult> {
  const db = requireDb();
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const out: SyncResult = { fetched: 0, ingested: 0, triaged: 0, skipped: 0, youReplied: 0, errors: [] };
  const mailbox = await openMailbox(account, origin);
  try {
    let changes;
    try { changes = await mailbox.changes(account.cursor, { max: opts.max ?? 25 }); }
    catch (e) {
      const message = describeFailure(e, 502, "mail-sync").message;
      await db.update(schema.emailAccounts).set({ lastError: message.slice(0, 500) }).where(eq(schema.emailAccounts.id, account.id));
      throw e;
    }

    let finished = true;
    for (const fetched of changes.threads) {
      if (Date.now() > deadline) { finished = false; break; }
      out.fetched++;
      try {
        const known = await resolveThread(userId, fetched);
        // Mail that is only in Sent, or only in Promotions and the like, is tracked if we already follow the thread, and otherwise left alone.
        if (!known && fetched.inInbox === false) { out.skipped++; continue; }
        const delta = await ingestThreadDelta(userId, {
          providerThreadId: known?.providerThreadId ?? fetched.providerThreadId, accountId: account.id,
          subject: known?.subject || fetched.subject, messages: fetched.messages,
        });
        // Adopt the provider's own thread key once we know it, so the next lookup is direct.
        if (known && known.providerThreadId !== fetched.providerThreadId && !fetched.providerThreadId.startsWith("rfc:")) {
          await db.update(schema.crmThreads).set({ providerThreadId: fetched.providerThreadId }).where(eq(schema.crmThreads.id, known.id)).catch(() => undefined);
        }
        out.ingested++;
        const thread = delta.thread;
        const needsReading = delta.addedInbound > 0 || (!thread.triagedAt && fetched.messages.some((m) => m.direction === "inbound"));
        if (needsReading) {
          await processThread(userId, thread.id);
          out.triaged++;
          if (opts.onTriaged) await opts.onTriaged(thread.id);
        } else if (delta.addedOutbound > 0) {
          await db.update(schema.crmThreads).set({ needsReply: false }).where(eq(schema.crmThreads.id, thread.id));
          if (await supersedeReplies(userId, thread.id, "You replied yourself, so this draft was withdrawn.")) out.youReplied++;
        } else {
          out.skipped++;
        }
      } catch (e) {
        out.errors.push(`${fetched.subject || fetched.providerThreadId}: ${describeFailure(e, 502, "mail-sync").message}`);
      }
    }

    await db.update(schema.emailAccounts).set({
      ...(finished ? { cursor: changes.cursor } : {}),
      lastSyncAt: new Date(), lastError: out.errors[0]?.slice(0, 500) ?? "", status: "connected",
    }).where(eq(schema.emailAccounts.id, account.id));
    return out;
  } finally {
    await mailbox.close();
  }
}
