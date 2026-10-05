/**
 * The notetaker bot: a participant that joins a meeting link, records, and hands back a transcript
 * with each speaker's name. Behind a provider interface so another service can replace the first one,
 * Recall.ai (RECALL_API_KEY; RECALL_REGION, default us-west-2; RECALL_WEBHOOK_SECRET for its webhooks).
 *
 * Spending: a bot bills per hour from the moment it joins, so one is only ever created by a person's
 * click ("Send the notetaker") or an auto-join rule the person switched on, and the route checks the
 * `meetings.bot` feature first. Its progress arrives by webhook (verified with the Svix scheme Recall
 * signs with); when webhooks are not configured, opening the meeting polls the bot's status instead,
 * which is free.
 *
 * The pure parts (signature checks, event and transcript parsing) are tested with fixtures in
 * scripts/test-meetings.ts; nothing here is called against the live service in tests.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Person } from "./match";
import type { MeetingStatus, Segment } from "./model";

export type BotState = {
  /** The provider's latest status code, e.g. "in_call_recording". */
  code: string;
  status: MeetingStatus;
  /** Where the finished transcript and participant list can be fetched, once ready. */
  transcriptUrl: string | null;
  participantsUrl: string | null;
  error: string | null;
};

export type BotEvent = { botId: string; code: string; event: string };

export interface MeetingBotProvider {
  id: string;
  ready(): boolean;
  createBot(input: { meetingUrl: string; botName: string; meetingId: number }): Promise<{ botId: string; code: string }>;
  getBot(botId: string): Promise<BotState>;
  leave(botId: string): Promise<void>;
  fetchTranscript(state: BotState): Promise<{ segments: Segment[]; participants: Person[] }>;
  verifyWebhook(headers: Headers, body: string, nowSec?: number): boolean;
  parseWebhook(body: unknown): BotEvent | null;
}

/* ---------------- Pure: statuses, events, transcripts, signatures ---------------- */

/** A Recall status code as a meeting status. Pure. */
export function recallStatus(code: string): MeetingStatus {
  const c = code.toLowerCase();
  if (/fatal|permission_denied|error/.test(c)) return "failed";
  if (/^(call_ended|recording_done|done|analysis_done|media_expired|transcript\.done|transcript_done)$/.test(c)) return "processing";
  if (/^in_call|recording_permission_allowed/.test(c)) return "live";
  return "joining";
}

/** The bot and status a Recall webhook is about: the current `bot.*` events and the older `bot.status_change`. Pure. */
export function parseRecallEvent(body: unknown): BotEvent | null {
  const b = (body && typeof body === "object" ? body : {}) as { event?: unknown; data?: Record<string, unknown> };
  const event = typeof b.event === "string" ? b.event : "";
  const d = b.data ?? {};
  const bot = (d.bot && typeof d.bot === "object" ? d.bot : {}) as { id?: unknown };
  const botId = typeof d.bot_id === "string" ? d.bot_id : typeof bot.id === "string" ? bot.id : "";
  if (!event || !botId) return null;
  const status = (d.status && typeof d.status === "object" ? d.status : d.data && typeof d.data === "object" ? d.data : {}) as { code?: unknown };
  const code = typeof status.code === "string" ? status.code : event.startsWith("bot.") ? event.slice(4) : event;
  return { botId, code, event };
}

type RecallWord = { text?: unknown; start_timestamp?: { relative?: unknown } | null; end_timestamp?: { relative?: unknown } | null };
type RecallEntry = { participant?: { name?: unknown; email?: unknown } | null; words?: RecallWord[] };

/** Recall's transcript (one entry per stretch of one participant's speech) as named segments. Pure. */
export function segmentsFromRecall(transcript: unknown): Segment[] {
  if (!Array.isArray(transcript)) return [];
  const out: Segment[] = [];
  for (const e of transcript as RecallEntry[]) {
    const words = (e?.words ?? []).filter((w) => typeof w?.text === "string" && w.text.trim());
    if (!words.length) continue;
    const t = (x: { relative?: unknown } | null | undefined) => Math.max(0, Number(x?.relative) || 0);
    const name = typeof e.participant?.name === "string" && e.participant.name.trim() ? e.participant.name.trim() : "Speaker";
    out.push({ start: t(words[0].start_timestamp), end: t(words[words.length - 1].end_timestamp ?? words[words.length - 1].start_timestamp), text: words.map((w) => String(w.text).trim()).join(" ").replace(/\s+([,.!?;:])/g, "$1"), speaker: name });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Who the bot saw in the call, from its participant list or, failing that, the transcript's speakers. Pure. */
export function participantsFromRecall(list: unknown, transcript: unknown): Person[] {
  const seen = new Map<string, Person>();
  const take = (p: { name?: unknown; email?: unknown } | null | undefined) => {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    const email = typeof p?.email === "string" && /@/.test(p.email) ? p.email.trim().toLowerCase() : "";
    const key = email || name.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.set(key, { name, ...(email ? { email } : {}) });
  };
  if (Array.isArray(list)) for (const p of list) take(p as { name?: unknown; email?: unknown });
  if (Array.isArray(transcript)) for (const e of transcript as RecallEntry[]) take(e?.participant);
  return [...seen.values()];
}

/**
 * Whether a webhook was signed with `secret` under the Svix scheme (also the Standard Webhooks one):
 * HMAC-SHA256 of "<id>.<timestamp>.<body>" with the base64 key after "whsec_", sent as one or more
 * "v1,<base64>" in `svix-signature` (or `webhook-signature`), within five minutes of now. Pure.
 */
export function verifySvix(secret: string, headers: Headers, body: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const sigs = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!secret || !id || !ts || !sigs || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(/\s+/).some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/* ---------------- Recall.ai ---------------- */

type RecallBot = {
  id: string;
  status_changes?: { code?: string; sub_code?: string | null; message?: string | null }[];
  recordings?: { media_shortcuts?: { transcript?: { status?: { code?: string }; data?: { download_url?: string } } | null; participant_events?: { data?: { participants_download_url?: string } } | null } }[];
};

/** A bot's state from Recall's bot record. Pure. */
export function recallState(bot: RecallBot): BotState {
  const last = bot.status_changes?.[bot.status_changes.length - 1];
  const code = last?.code ?? "ready";
  const rec = bot.recordings?.[bot.recordings.length - 1]?.media_shortcuts;
  const transcriptDone = rec?.transcript?.status?.code === "done";
  const status = recallStatus(code);
  return {
    code, status,
    transcriptUrl: transcriptDone ? rec?.transcript?.data?.download_url ?? null : null,
    participantsUrl: rec?.participant_events?.data?.participants_download_url ?? null,
    error: status === "failed" ? [last?.sub_code, last?.message].filter(Boolean).join(": ") || "The notetaker could not record this meeting." : null,
  };
}

const RECALL_TIMEOUT_MS = 20_000;

export function recallProvider(env: Record<string, string | undefined> = process.env): MeetingBotProvider {
  const key = env.RECALL_API_KEY?.trim() ?? "";
  const base = (env.RECALL_API_URL?.trim() || `https://${env.RECALL_REGION?.trim() || "us-west-2"}.recall.ai`).replace(/\/+$/, "");
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${base}/api/v1${path}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(RECALL_TIMEOUT_MS),
      headers: { authorization: key.startsWith("Token ") ? key : `Token ${key}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(res.status === 400 ? "The notetaker could not use that meeting link. Check it opens the meeting." : "The notetaker service did not answer. Try again in a moment."), { status: res.status === 400 ? 400 : 502, detail: text.slice(0, 300) });
    return (text ? JSON.parse(text) : {}) as T;
  };
  const download = async (url: string): Promise<unknown> => {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`The notetaker's transcript could not be downloaded (${res.status})`);
    return res.json();
  };
  return {
    id: "recall",
    ready: () => !!key,
    async createBot({ meetingUrl, botName, meetingId }) {
      const bot = await call<RecallBot>("/bot/", {
        method: "POST",
        body: JSON.stringify({
          meeting_url: meetingUrl, bot_name: botName,
          recording_config: { transcript: { provider: { recallai_streaming: { mode: "prioritize_accuracy" } } }, participant_events: {} },
          metadata: { youbank_meeting: String(meetingId) },
        }),
      });
      return { botId: bot.id, code: recallState(bot).code };
    },
    async getBot(botId) {
      return recallState(await call<RecallBot>(`/bot/${encodeURIComponent(botId)}/`));
    },
    async leave(botId) {
      await call(`/bot/${encodeURIComponent(botId)}/leave_call/`, { method: "POST" });
    },
    async fetchTranscript(state) {
      if (!state.transcriptUrl) return { segments: [], participants: [] };
      const transcript = await download(state.transcriptUrl);
      const list = state.participantsUrl ? await download(state.participantsUrl).catch(() => null) : null;
      return { segments: segmentsFromRecall(transcript), participants: participantsFromRecall(list, transcript) };
    },
    verifyWebhook: (headers, body, nowSec) => verifySvix(env.RECALL_WEBHOOK_SECRET?.trim() ?? "", headers, body, nowSec),
    parseWebhook: parseRecallEvent,
  };
}

/** The provider in use. One today; the interface is where another would plug in. */
export function botProvider(): MeetingBotProvider {
  return recallProvider();
}
