import type { EmailAddress } from "@/db/schema";
import type { IncomingMessage } from "./db";

/**
 * Gmail connector: OAuth, reading threads, and sending an approved draft.
 *
 * Least privilege on purpose. `gmail.readonly` cannot modify or delete anything, and `gmail.send`
 * can only send — neither can empty a mailbox. Nothing here sends by itself: sendMessage runs only
 * from the route a person triggers by approving a draft.
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
  return call<{ emailAddress: string }>(token, "/profile");
}

/* ---------------- Reading ---------------- */

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId: string; internalDate?: string; payload?: GmailPart; snippet?: string };
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

export type FetchedThread = { providerThreadId: string; subject: string; messages: IncomingMessage[] };

/** Recent threads worth reading. Defaults to the primary inbox, newest first. */
export async function listThreadIds(token: string, opts?: { query?: string; max?: number }): Promise<string[]> {
  const q = opts?.query ?? "in:inbox category:primary newer_than:30d";
  const res = await call<{ threads?: { id: string }[] }>(token, `/threads?q=${encodeURIComponent(q)}&maxResults=${Math.min(opts?.max ?? 15, 50)}`);
  return (res.threads ?? []).map((t) => t.id);
}

export async function fetchThread(token: string, threadId: string, selfAddress: string): Promise<FetchedThread | null> {
  const t = await call<GmailThread>(token, `/threads/${threadId}?format=full`);
  const messages = (t.messages ?? []).map((m): IncomingMessage => {
    const from = parseAddresses(header(m, "From"))[0] ?? { name: "", address: "" };
    const raw = bodyOf(m.payload) || m.snippet || "";
    return {
      providerMessageId: m.id,
      direction: from.address && from.address === selfAddress.toLowerCase() ? "outbound" : "inbound",
      fromName: from.name,
      fromAddress: from.address,
      toAddresses: parseAddresses(header(m, "To")),
      subject: header(m, "Subject"),
      body: stripQuoted(raw).slice(0, 20_000),
      sentAt: m.internalDate ? new Date(Number(m.internalDate)) : null,
    };
  }).filter((m) => m.fromAddress);
  if (messages.length === 0) return null;
  return { providerThreadId: t.id, subject: messages[0].subject ?? "", messages };
}

/** The RFC Message-ID of a message, needed so a reply threads correctly in the recipient's client. */
export async function messageIdHeader(token: string, gmailMessageId: string): Promise<string> {
  const m = await call<GmailMessage>(token, `/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`);
  return header(m, "Message-ID");
}

/* ---------------- Sending ---------------- */

/** RFC 2822 with UTF-8 subjects encoded, base64url for the Gmail API. */
function buildRaw(msg: { to: string[]; subject: string; body: string; inReplyTo?: string }): string {
  const subject = /[^\x20-\x7E]/.test(msg.subject)
    ? `=?UTF-8?B?${Buffer.from(msg.subject, "utf8").toString("base64")}?=`
    : msg.subject;
  const lines = [
    `To: ${msg.to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`, `References: ${msg.inReplyTo}`] : []),
    "",
    msg.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * Send one message.
 *
 * Only ever called from the route behind a person approving a draft. There is no scheduler, cron or
 * agent path into this function.
 */
export async function sendMessage(token: string, msg: { to: string[]; subject: string; body: string; threadId?: string | null; inReplyTo?: string }) {
  return call<{ id: string; threadId: string }>(token, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: buildRaw(msg), ...(msg.threadId ? { threadId: msg.threadId } : {}) }),
  });
}
