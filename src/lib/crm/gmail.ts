import { randomUUID } from "node:crypto";
import type { EmailAddress } from "@/db/schema";
import { isAutomatedMessage } from "./autopilot-rules";
import type { IncomingMessage } from "./db";

/**
 * Gmail connector over the Gmail API: OAuth, reading threads, and sending.
 *
 * Least privilege on purpose. `gmail.readonly` cannot modify or delete anything, and `gmail.send`
 * can only send — neither can empty a mailbox. Nothing here decides to send: sendMessage is called
 * only by sendDraft, for a draft a person sent or one their autopilot settings allow.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Reads the Google credentials, with a message that says exactly what is missing. */
export function googleConfig(origin: string): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and add this app's callback URL to the OAuth client in Google Cloud.");
  }
  return { clientId, clientSecret, redirectUri: process.env.GOOGLE_REDIRECT_URI || `${origin}/api/crm/gmail/callback` };
}

export function authUrl(cfg: GoogleConfig, state: string): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");     // we need a refresh token
  u.searchParams.set("prompt", "consent");          // and Google only re-issues one when asked
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => null)) as (TokenResponse & { error?: string; error_description?: string }) | null;
  if (!res.ok || !json?.access_token) {
    throw new Error(`Google rejected the token request: ${json?.error_description ?? json?.error ?? res.status}`);
  }
  return json;
}

export function exchangeCode(cfg: GoogleConfig, code: string) {
  return tokenRequest({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" });
}

export function refreshAccessToken(cfg: GoogleConfig, refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" });
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Gmail API ${res.status}: ${detail.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function profile(token: string) {
  return call<{ emailAddress: string; historyId: string }>(token, "/profile");
}

/* ---------------- Reading ---------------- */

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId: string; internalDate?: string; payload?: GmailPart; snippet?: string; labelIds?: string[] };
type GmailThread = { id: string; messages?: GmailMessage[] };

const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");

const header = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** Prefer text/plain; fall back to stripping tags out of the HTML alternative. */
function bodyOf(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = bodyOf(p);
    if (found) return found;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decode(part.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * "Maya Ruiz <maya@x.io>, bob@y.io" -> structured addresses.
 *
 * Split by hand rather than by regex: a display name may itself contain a comma, as in
 * `"Ruiz, Maya" <maya@x.io>`, and only commas outside quotes and angle brackets separate addresses.
 */
export function parseAddresses(raw: string): EmailAddress[] {
  if (!raw) return [];
  const chunks: string[] = [];
  let buf = "", inQuotes = false, inAngle = false;
  for (const ch of raw) {
    if (ch === '"') { inQuotes = !inQuotes; buf += ch; continue; }
    if (!inQuotes && ch === "<") inAngle = true;
    if (!inQuotes && ch === ">") inAngle = false;
    if (ch === "," && !inQuotes && !inAngle) { chunks.push(buf); buf = ""; continue; }
    buf += ch;
  }
  chunks.push(buf);
  return chunks.map((chunk) => {
    const m = chunk.trim().match(/^(.*?)\s*<([^>]+)>$/);
    if (m) return { name: m[1].trim().replace(/^["']|["']$/g, "").trim(), address: m[2].trim().toLowerCase() };
    return { name: "", address: chunk.trim().toLowerCase() };
  }).filter((a) => a.address.includes("@"));
}

/**
 * Quoted history repeats the whole conversation in every reply, which wastes the model's attention
 * and its context. Keep the new text.
 */
export function stripQuoted(body: string): string {
  // Only cut when the marker is genuinely below some new text; at index 0 the whole body is the quote.
  const cut = body.search(/^[ \t]*(On .+ wrote:|-----Original Message-----|_{10,}|From: .+@)/m);
  const trimmed = cut > 0 ? body.slice(0, cut) : body;
  return trimmed.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

/** `inInbox` is false for a thread that only exists in Sent, or only in Promotions, Social and the like. */
export type FetchedThread = { providerThreadId: string; subject: string; messages: IncomingMessage[]; inInbox?: boolean };

const HIDDEN = new Set(["DRAFT", "SPAM", "TRASH"]);
const NOT_PRIMARY = /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS|UPDATES)$/;
const refsOf = (raw: string) => raw.split(/\s+/).map((r) => r.trim()).filter((r) => r.startsWith("<"));

/** Recent threads worth reading. Defaults to the primary inbox, newest first. */
export async function listThreadIds(token: string, opts?: { query?: string; max?: number }): Promise<string[]> {
  const q = opts?.query ?? "in:inbox category:primary newer_than:30d";
  const res = await call<{ threads?: { id: string }[] }>(token, `/threads?q=${encodeURIComponent(q)}&maxResults=${Math.min(opts?.max ?? 15, 50)}`);
  return (res.threads ?? []).map((t) => t.id);
}

export async function fetchThread(token: string, threadId: string, selfAddress: string): Promise<FetchedThread | null> {
  const t = await call<GmailThread>(token, `/threads/${threadId}?format=full`);
  const visible = (t.messages ?? []).filter((m) => !(m.labelIds ?? []).some((l) => HIDDEN.has(l)));
  const messages = visible.map((m): IncomingMessage => {
    const from = parseAddresses(header(m, "From"))[0] ?? { name: "", address: "" };
    const raw = bodyOf(m.payload) || m.snippet || "";
    const get = (name: string) => header(m, name) || undefined;
    return {
      providerMessageId: m.id,
      direction: from.address && from.address === selfAddress.toLowerCase() ? "outbound" : "inbound",
      fromName: from.name,
      fromAddress: from.address,
      toAddresses: parseAddresses(header(m, "To")),
      subject: header(m, "Subject"),
      body: stripQuoted(raw).slice(0, 20_000),
      sentAt: m.internalDate ? new Date(Number(m.internalDate)) : null,
      rfcMessageId: header(m, "Message-ID"),
      inReplyTo: header(m, "In-Reply-To"),
      references: refsOf(header(m, "References")),
      automated: isAutomatedMessage(get, from.address),
    };
  }).filter((m) => m.fromAddress);
  if (messages.length === 0) return null;
  const inInbox = visible.some((m) => (m.labelIds ?? []).includes("INBOX") && !(m.labelIds ?? []).some((l) => NOT_PRIMARY.test(l)));
  return { providerThreadId: t.id, subject: messages[0].subject ?? "", messages, inInbox };
}

type HistoryPage = {
  history?: { id: string; messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
  historyId?: string; nextPageToken?: string;
};

/**
 * Threads that gained a message since `startHistoryId`, oldest change first, and the history id to
 * resume from. Stops collecting at `max` threads and returns the id of the last change it fully
 * covered, so a large backlog is worked through in order rather than re-read from the top.
 * Returns null when Gmail no longer has history that old; the caller then starts afresh.
 */
export async function historyChanges(token: string, startHistoryId: string, max: number): Promise<{ threadIds: string[]; historyId: string; complete: boolean } | null> {
  const threadIds: string[] = [];
  let cursor = startHistoryId;
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    let res: HistoryPage;
    try {
      res = await call<HistoryPage>(token, `/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    for (const h of res.history ?? []) {
      const fresh = (h.messagesAdded ?? []).map((a) => a.message)
        .filter((m) => !(m.labelIds ?? []).some((l) => HIDDEN.has(l)) && (m.labelIds ?? []).some((l) => l === "INBOX" || l === "SENT"))
        .map((m) => m.threadId).filter((id) => !threadIds.includes(id));
      if (threadIds.length + new Set(fresh).size > max && threadIds.length > 0) return { threadIds, historyId: cursor, complete: false };
      for (const id of fresh) if (!threadIds.includes(id)) threadIds.push(id);
      cursor = h.id;
    }
    if (!res.nextPageToken) return { threadIds, historyId: res.historyId ?? cursor, complete: true };
    pageToken = res.nextPageToken;
  }
  return { threadIds, historyId: cursor, complete: false };
}

/** The RFC Message-ID of a message, needed so a reply threads correctly in the recipient's client. */
export async function messageIdHeader(token: string, gmailMessageId: string): Promise<string> {
  const m = await call<GmailMessage>(token, `/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`);
  return header(m, "Message-ID");
}

/* ---------------- Sending ---------------- */

/** A fresh RFC Message-ID on the sender's domain, so our own sends can be recognised when replies arrive. */
export function newMessageId(fromAddress: string): string {
  return `<${randomUUID()}@${fromAddress.split("@")[1] || "youbank.local"}>`;
}

/** RFC 2822 with UTF-8 subjects encoded, base64url for the Gmail API. */
export function buildRaw(msg: { to: string[]; subject: string; body: string; inReplyTo?: string; references?: string[]; messageId?: string }): string {
  const subject = /[^\x20-\x7E]/.test(msg.subject)
    ? `=?UTF-8?B?${Buffer.from(msg.subject, "utf8").toString("base64")}?=`
    : msg.subject;
  const references = [...(msg.references ?? []), ...(msg.inReplyTo && !(msg.references ?? []).includes(msg.inReplyTo) ? [msg.inReplyTo] : [])];
  const lines = [
    `To: ${msg.to.join(", ")}`,
    `Subject: ${subject}`,
    ...(msg.messageId ? [`Message-ID: ${msg.messageId}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`] : []),
    ...(references.length ? [`References: ${references.join(" ")}`] : []),
    "",
    msg.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** Send one message. Called only from sendDraft, which enforces who may send what. */
export async function sendMessage(token: string, msg: { to: string[]; subject: string; body: string; threadId?: string | null; inReplyTo?: string; references?: string[]; messageId?: string }) {
  return call<{ id: string; threadId: string }>(token, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: buildRaw(msg), ...(msg.threadId ? { threadId: msg.threadId } : {}) }),
  });
}
