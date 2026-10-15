import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { EmailAddress } from "@/db/schema";
import { isAutomatedMessage } from "./autopilot-rules";
import type { IncomingMessage } from "./db";
import { newMessageId, stripQuoted, type FetchedThread } from "./gmail";
import { logError } from "@/lib/errors";
import { resolvePublicHost, unsafeUrl } from "@/lib/net";

/**
 * Any mailbox over IMAP (reading) and SMTP (sending), signed in with an app password.
 *
 * This is the connection that needs no developer setup: no Google Cloud project, no OAuth client, no
 * verification review. The person creates an app password in their mail provider's security settings
 * and pastes it in. The password is encrypted at rest like the OAuth tokens.
 *
 * Gmail's IMAP has extensions (X-GM-EXT-1) that expose Gmail's own thread ids and an All Mail folder,
 * so Gmail threads come through whole, sent replies included. Other servers are threaded by the
 * References and In-Reply-To headers.
 */

export type ImapSettings = {
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  username: string; preset?: string;
};

type Preset = Omit<ImapSettings, "username" | "preset"> & { label: string; appPasswordUrl: string; note: string };

export const MAIL_PRESETS: Record<string, Preset> = {
  gmail: {
    label: "Gmail or Google Workspace", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    note: "Needs 2-Step Verification on the Google account. Create an app password, then paste its 16 letters here.",
  },
  icloud: {
    label: "iCloud Mail", imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false,
    appPasswordUrl: "https://account.apple.com/account/manage", note: "Create an app-specific password under Sign-In and Security.",
  },
  yahoo: {
    label: "Yahoo Mail", imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true,
    appPasswordUrl: "https://login.yahoo.com/account/security", note: "Generate an app password under Account security.",
  },
  zoho: {
    label: "Zoho Mail", imapHost: "imap.zoho.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.zoho.com", smtpPort: 465, smtpSecure: true,
    appPasswordUrl: "https://accounts.zoho.com/home#security/app_password", note: "Enable IMAP access in Zoho Mail settings, then create an app password.",
  },
  fastmail: {
    label: "Fastmail", imapHost: "imap.fastmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecure: true,
    appPasswordUrl: "https://app.fastmail.com/settings/security/apps", note: "Create an app password with IMAP and SMTP access.",
  },
};

const DAY = 86_400_000;

/** The ports mail servers listen on; anything else is refused, so the server cannot be aimed at other services. */
export const MAIL_PORTS = { IMAP: [993, 143], SMTP: [465, 587, 25, 2525] } as const;

/**
 * Where to connect for a server name people typed: a public address only (the same rule as links
 * people paste, src/lib/calendar/net.ts) on a mail port. The connection goes to the address that was
 * checked, with the typed name kept for TLS (SNI and the certificate check), so the name cannot
 * resolve to a private address between the check and the connection. Refusals are plain 400s.
 */
export async function mailEndpoint(stage: "IMAP" | "SMTP", host: string, port: number, resolve: (h: string) => Promise<string> = resolvePublicHost) {
  const ports: readonly number[] = MAIL_PORTS[stage];
  if (!ports.includes(port)) throw unsafeUrl(`${stage} must use a standard mail port (${ports.join(", ")}).`);
  const name = host.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const address = await resolve(name).catch(() => {
    throw unsafeUrl(`The ${stage} server "${name}" cannot be used: it could not be found, or it is on a private network. Check the server name.`);
  });
  return { address, servername: isIP(name) ? undefined : name };
}

export async function imapClient(s: ImapSettings, password: string): Promise<ImapFlow> {
  const at = await mailEndpoint("IMAP", s.imapHost, s.imapPort);
  return new ImapFlow({
    host: at.address, servername: at.servername, port: s.imapPort, secure: s.imapSecure, auth: { user: s.username, pass: password },
    logger: false, disableAutoIdle: true, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 90_000,
  });
}

export async function smtpTransport(s: ImapSettings, password: string) {
  const at = await mailEndpoint("SMTP", s.smtpHost, s.smtpPort);
  return nodemailer.createTransport({
    host: at.address, port: s.smtpPort, secure: s.smtpSecure, requireTLS: !s.smtpSecure,
    ...(at.servername ? { tls: { servername: at.servername } } : {}),
    auth: { user: s.username, pass: password }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 60_000,
  });
}

/** Explain the failures people actually hit, instead of a raw protocol error. */
export function friendlyMailError(e: unknown, stage: "IMAP" | "SMTP"): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const detail = `${msg} ${(e as { responseText?: string; response?: string })?.responseText ?? (e as { response?: string })?.response ?? ""}`;
  if (/auth|credential|password|login|535|534|AUTHENTICATIONFAILED|Invalid/i.test(detail)) {
    return new Error(`${stage} sign-in was refused. Use an app password, not your normal password, and check the address. For Gmail: 2-Step Verification must be on, then create one at myaccount.google.com/apppasswords.`);
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|EHOSTUNREACH/i.test(detail)) {
    return new Error(`Could not reach the ${stage} server. Check the host and port.`);
  }
  // Anything else is the server's own protocol text: logged under a reference, not shown.
  const ref = logError(e, { where: `mail-${stage.toLowerCase()}` });
  return new Error(`The ${stage} mail server did not accept the request (ref ${ref}). Check the mailbox settings, or try again later.`);
}

/** Sign in to both servers without reading or sending anything, so a bad password fails at connect time. */
export async function verifyMailbox(s: ImapSettings, password: string): Promise<void> {
  // Both servers are checked before either is contacted.
  await mailEndpoint("SMTP", s.smtpHost, s.smtpPort);
  const client = await imapClient(s, password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    lock.release();
  } catch (e) { throw friendlyMailError(e, "IMAP"); }
  finally { await client.logout().catch(() => undefined); }
  const smtp = await smtpTransport(s, password);
  try { await smtp.verify(); } catch (e) { throw friendlyMailError(e, "SMTP"); }
}

/* ---------------- Parsing ---------------- */

const flatten = (a: AddressObject | AddressObject[] | undefined): EmailAddress[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((o) => o.value).filter((v) => v.address).map((v) => ({ name: v.name ?? "", address: (v.address ?? "").toLowerCase() }));

const headerText = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(headerText).filter(Boolean).join(" ");
  if (typeof v === "object") {
    const o = v as { text?: string; value?: unknown; id?: string };
    return o.text ?? (typeof o.value === "string" ? o.value : undefined) ?? o.id ?? JSON.stringify(v);
  }
  return String(v);
};

const htmlToText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export type ParsedMessage = IncomingMessage & { threadRoot: string; draft: boolean };

/** One raw message as the CRM stores it. `self` decides which messages are the reader's own. */
export function toIncoming(parsed: ParsedMail, self: string, opts?: { draft?: boolean; uid?: number }): ParsedMessage {
  const from = flatten(parsed.from)[0] ?? { name: "", address: "" };
  const references = (Array.isArray(parsed.references) ? parsed.references : parsed.references ? parsed.references.split(/\s+/) : [])
    .map((r) => r.trim()).filter((r) => r.startsWith("<"));
  const inReplyTo = (parsed.inReplyTo ?? "").trim();
  const rfcMessageId = (parsed.messageId ?? "").trim();
  const text = parsed.text?.trim() ? parsed.text : parsed.html ? htmlToText(parsed.html) : "";
  const get = (name: string) => headerText(parsed.headers.get(name));
  return {
    providerMessageId: rfcMessageId || `uid-${opts?.uid ?? 0}`,
    direction: from.address && from.address === self.toLowerCase() ? "outbound" : "inbound",
    fromName: from.name,
    fromAddress: from.address,
    toAddresses: [...flatten(parsed.to), ...flatten(parsed.cc)],
    subject: parsed.subject ?? "",
    body: stripQuoted(text).slice(0, 20_000),
    sentAt: parsed.date ?? null,
    rfcMessageId,
    inReplyTo,
    references,
    automated: isAutomatedMessage(get, from.address),
    threadRoot: references[0] || inReplyTo || rfcMessageId,
    draft: !!opts?.draft,
  };
}

/* ---------------- Reading ---------------- */

type Cursor = { v: string; u: number };
const readCursor = (c: string): Cursor | null => { try { const x = JSON.parse(c) as Cursor; return x && typeof x.u === "number" ? x : null; } catch { return null; } };

async function specialFolder(client: ImapFlow, use: "\\All" | "\\Sent"): Promise<string | null> {
  const boxes = await client.list().catch(() => []);
  return boxes.find((b) => b.specialUse === use)?.path ?? null;
}

async function parseFetched(msgs: FetchMessageObject[], self: string): Promise<(ParsedMessage & { gmThread?: string })[]> {
  const out: (ParsedMessage & { gmThread?: string })[] = [];
  for (const m of msgs) {
    if (!m.source) continue;
    const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true }).catch(() => null);
    if (!parsed) continue;
    const p = toIncoming(parsed, self, { draft: m.flags?.has("\\Draft"), uid: m.uid });
    if (p.draft || !p.fromAddress) continue;
    out.push({ ...p, gmThread: m.threadId });
  }
  return out;
}

const byDate = (a: IncomingMessage, b: IncomingMessage) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0);

export type ImapChanges = { threads: FetchedThread[]; cursor: string; complete: boolean };

/**
 * New mail since the cursor (the INBOX's UIDVALIDITY and the last UID read), grouped into threads.
 * The first read takes the newest `max` messages of the last week and marks everything older as seen.
 */
export async function imapChanges(client: ImapFlow, self: string, cursor: string, max: number): Promise<ImapChanges> {
  const gmail = client.capabilities.has("X-GM-EXT-1");
  let fetched: (ParsedMessage & { gmThread?: string })[] = [];
  let next: Cursor;
  let complete = true;

  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) throw new Error("INBOX could not be opened");
    const validity = String(box.uidValidity);
    const cur = readCursor(cursor);
    let uids: number[];
    if (!cur || cur.v !== validity) {
      const recent = (await client.search({ since: new Date(Date.now() - 7 * DAY) }, { uid: true })) || [];
      uids = recent.slice(-max);
      next = { v: validity, u: Math.max(box.uidNext - 1, ...uids, 0) };
    } else {
      const found = ((await client.search({ uid: `${cur.u + 1}:*` }, { uid: true })) || []).filter((u) => u > cur.u).sort((a, b) => a - b);
      uids = found.slice(0, max);
      complete = found.length <= max;
      next = { v: validity, u: uids.length ? uids[uids.length - 1] : cur.u };
    }
    if (uids.length) {
      const msgs = await client.fetchAll(uids, { uid: true, source: { maxLength: 400_000 }, flags: true, threadId: gmail }, { uid: true });
      fetched = await parseFetched(msgs, self);
    }
  } finally { lock.release(); }

  // Group into threads, then fill each in with what the mailbox knows beyond the INBOX.
  const groups = new Map<string, (ParsedMessage & { gmThread?: string })[]>();
  for (const m of fetched) {
    const key = gmail && m.gmThread ? `gm:${m.gmThread}` : `rfc:${m.threadRoot}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const threads: FetchedThread[] = [];
  for (const [key, msgs] of groups) {
    const full = await imapThread(client, self, key, msgs).catch(() => msgs);
    const sorted = [...full].sort(byDate);
    threads.push({ providerThreadId: key, subject: sorted[0]?.subject ?? "", messages: sorted, inInbox: true });
  }
  return { threads, cursor: JSON.stringify(next), complete };
}

/**
 * Everything the mailbox has for one thread. Gmail: the whole conversation from All Mail, sent
 * replies included. Elsewhere: what we were given, plus any of the reader's own replies found in Sent,
 * which is how a reply sent from their phone is noticed before the agent answers too.
 */
export async function imapThread(client: ImapFlow, self: string, key: string, known: ParsedMessage[] = []): Promise<ParsedMessage[]> {
  if (key.startsWith("gm:")) {
    const all = await specialFolder(client, "\\All");
    if (!all) return known;
    const lock = await client.getMailboxLock(all, { readOnly: true });
    try {
      const uids = ((await client.search({ threadId: key.slice(3) }, { uid: true })) || []).slice(-20);
      if (!uids.length) return known;
      return parseFetched(await client.fetchAll(uids, { uid: true, source: { maxLength: 400_000 }, flags: true }, { uid: true }), self);
    } finally { lock.release(); }
  }
  const ids = [...new Set([key.slice(4), ...known.map((m) => m.rfcMessageId ?? "")].filter(Boolean))].slice(0, 6);
  const sent = await specialFolder(client, "\\Sent");
  if (!sent || !ids.length) return known;
  const lock = await client.getMailboxLock(sent, { readOnly: true });
  try {
    const uids = new Set<number>();
    for (const id of ids) for (const u of ((await client.search({ header: { "in-reply-to": id } }, { uid: true })) || [])) uids.add(u);
    if (!uids.size) return known;
    const mine = await parseFetched(await client.fetchAll([...uids].slice(-10), { uid: true, source: { maxLength: 400_000 }, flags: true }, { uid: true }), self);
    const seen = new Set(known.map((m) => m.rfcMessageId));
    return [...known, ...mine.filter((m) => !seen.has(m.rfcMessageId))];
  } finally { lock.release(); }
}

/* ---------------- Sending ---------------- */

export type ImapSend = {
  from: EmailAddress; to: EmailAddress[]; subject: string; body: string;
  inReplyTo?: string; references?: string[]; providerThreadId?: string | null;
};

/**
 * Send over SMTP, then file a copy in Sent where the server does not do it itself (Gmail does), so the
 * reader's own mail client shows what went out. Returns the ids the CRM threads replies by.
 */
export async function smtpSend(s: ImapSettings, password: string, client: ImapFlow | null, mail: ImapSend) {
  const messageId = newMessageId(mail.from.address);
  const message = {
    from: mail.from, to: mail.to, subject: mail.subject, text: mail.body, messageId,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
    ...(mail.references?.length ? { references: mail.references } : {}),
  };
  const smtp = await smtpTransport(s, password);
  try { await smtp.sendMail(message); } catch (e) { throw friendlyMailError(e, "SMTP"); }

  const gmail = /gmail\.com$|googlemail\.com$/i.test(s.smtpHost);
  if (!gmail && client) {
    try {
      const sent = await specialFolder(client, "\\Sent");
      if (sent) {
        const raw = await new MailComposer(message).compile().build();
        await client.append(sent, raw, ["\\Seen"]);
      }
    } catch { /* a missing Sent copy is cosmetic; the email itself went */ }
  }
  const root = mail.references?.[0] || mail.inReplyTo || messageId;
  return { providerMessageId: messageId, providerThreadId: mail.providerThreadId || `rfc:${root}`, rfcMessageId: messageId };
}
