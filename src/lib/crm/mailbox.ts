import type { EmailAddress } from "@/db/schema";
import { accessTokenFor, type AccountRow } from "./accounts";
import { decryptToken } from "./crypto";
import { fetchThread, historyChanges, listThreadIds, messageIdHeader, newMessageId, profile, sendMessage, type FetchedThread } from "./gmail";
import { imapChanges, imapClient, imapThread, smtpSend, type ImapSettings } from "./imap";

/**
 * One interface over every kind of connected mailbox: the Gmail API (OAuth) and IMAP/SMTP (app
 * password). Sync, the autopilot and sendDraft only ever talk to this.
 */
export type OutgoingMail = {
  to: EmailAddress[]; subject: string; body: string;
  inReplyTo?: string; references?: string[]; providerThreadId?: string | null;
};
export type SentMail = { providerMessageId: string; providerThreadId: string; rfcMessageId: string };

export interface Mailbox {
  address: string;
  /** Threads with new mail since `cursor`, the cursor to resume from, and whether that was all of it. */
  changes(cursor: string, opts: { max: number }): Promise<{ threads: FetchedThread[]; cursor: string; complete: boolean }>;
  /** The whole thread as the provider has it now, used to check nothing changed before a send. */
  thread(providerThreadId: string): Promise<FetchedThread | null>;
  send(mail: OutgoingMail): Promise<SentMail>;
  /** The RFC Message-ID for a provider message id, for older rows stored before we kept it. */
  rfcIdOf(providerMessageId: string): Promise<string>;
  close(): Promise<void>;
}

const FIRST_QUERY = "in:inbox category:primary newer_than:7d";

function gmailMailbox(account: AccountRow, token: string): Mailbox {
  const self = account.address;
  const fetchAll = async (ids: string[]) => {
    const out: FetchedThread[] = [];
    for (const id of ids) {
      const t = await fetchThread(token, id, self).catch(() => null);
      if (t) out.push(t);
    }
    return out;
  };
  const fresh = async (max: number, query: string) => {
    const ids = await listThreadIds(token, { query, max });
    const { historyId } = await profile(token);
    return { threads: await fetchAll(ids), cursor: historyId, complete: true };
  };
  return {
    address: self,
    async changes(cursor, { max }) {
      if (!cursor) return fresh(max, FIRST_QUERY);
      const h = await historyChanges(token, cursor, max);
      if (!h) return fresh(max, "in:inbox category:primary newer_than:2d");
      return { threads: await fetchAll(h.threadIds), cursor: h.historyId, complete: h.complete };
    },
    thread: (id) => fetchThread(token, id, self),
    async send(mail) {
      const messageId = newMessageId(self);
      const threadId = mail.providerThreadId && !mail.providerThreadId.includes(":") && !mail.providerThreadId.startsWith("manual-") ? mail.providerThreadId : null;
      const sent = await sendMessage(token, {
        to: mail.to.map((a) => (a.name ? `"${a.name.replace(/"/g, "")}" <${a.address}>` : a.address)),
        subject: mail.subject, body: mail.body, threadId, inReplyTo: mail.inReplyTo, references: mail.references, messageId,
      });
      return { providerMessageId: sent.id, providerThreadId: sent.threadId, rfcMessageId: messageId };
    },
    rfcIdOf: (id) => messageIdHeader(token, id),
    close: async () => undefined,
  };
}

function imapMailbox(account: AccountRow, settings: ImapSettings, password: string): Mailbox {
  const self = account.address;
  let client: ReturnType<typeof imapClient> | null = null;
  const connected = async () => {
    if (!client) { client = imapClient(settings, password); await client.connect(); }
    return client;
  };
  return {
    address: self,
    async changes(cursor, { max }) {
      return imapChanges(await connected(), self, cursor, max);
    },
    async thread(key) {
      const messages = await imapThread(await connected(), self, key);
      return messages.length ? { providerThreadId: key, subject: messages[0].subject ?? "", messages, inInbox: true } : null;
    },
    async send(mail) {
      // Gmail files what SMTP sends in Sent by itself; other servers need a copy appended over IMAP.
      const gmail = /gmail\.com$|googlemail\.com$/i.test(settings.smtpHost);
      const c = gmail ? null : await connected().catch(() => null);
      return smtpSend(settings, password, c, { from: { name: account.displayName, address: self }, ...mail });
    },
    rfcIdOf: async (id) => (id.startsWith("<") ? id : ""),
    async close() { if (client) await client.logout().catch(() => undefined); client = null; },
  };
}

/** Open the right kind of mailbox for an account. Throws a readable error when it needs reconnecting. */
export async function openMailbox(account: AccountRow, origin: string): Promise<Mailbox> {
  if (account.provider === "imap") {
    const s = account.settings as ImapSettings;
    if (!s.imapHost || !s.smtpHost || !account.secret) throw new Error("This mailbox is missing its server settings. Reconnect it.");
    return imapMailbox(account, s, decryptToken(account.secret));
  }
  return gmailMailbox(account, await accessTokenFor(account, origin));
}
