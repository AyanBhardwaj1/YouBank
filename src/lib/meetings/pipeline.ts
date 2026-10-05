/**
 * A meeting from start to notes.
 *
 *   desktop:  start (after the consent prompt) → a chunk every ~30 s, transcribed as it arrives →
 *             end → notes → Relationships
 *   bot:      the person sends it (or an auto-join rule they switched on does) → the bot's webhooks or
 *             a status poll → its transcript → notes → Relationships
 *
 * What spends money, and why it may: transcription runs because the person started capture; notes run
 * on the meeting's own transcript when it ends, within the free monthly allowance or the plan
 * (`meetings.notes`), and only if the person left automatic notes on; the bot needs `meetings.bot`.
 */
import { after } from "next/server";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { recordUsage, runAsUser } from "@/lib/ai/usage";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { MEETINGS_FREE_NOTES } from "@/lib/billing/features/meetings";
import { getSettings as getCrmSettings, personaFor } from "@/lib/crm/settings";
import { describeFailure, logError } from "@/lib/errors";
import { lease, rateLimit } from "@/lib/locks";
import { botProvider } from "./bot";
import { applyMeetingToCrm, removeMeetingEntry, type CrmReport } from "./crm";
import { meetingContext } from "./context";
import { isMeetingUrl, isPlatform, platformOfUrl, type MeetingNotes, type Segment } from "./model";
import { NotesSchema, parseNotes } from "./notes";
import { labelSelf, renderTranscript, stitch, type Activity } from "./stitch";
import { createMeeting, deleteMeeting, getMeeting, getMeetingSettings, linkMeeting, loadChunks, meetingByBot, notesUsedThisMonth, putChunk, unlinkMeeting, updateMeeting, type MeetingRow } from "./store";
import { NO_TRANSCRIBER, pickTranscriber } from "./transcribe";

type User = { id: string; email: string; name: string };

/** Longest meeting the copilot will record, and the largest chunk it accepts (under the host's request limit). */
export const MAX_MEETING_SEC = 4 * 3600;
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });
const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50) : []);

/* ---------------- Desktop capture ---------------- */

export type StartInput = {
  title?: string; platform?: string; appTitle?: string;
  consent: { noticeCopied?: boolean; auto?: boolean };
  contactIds?: unknown; dealIds?: unknown;
};

/** A desktop meeting begins, once the person has agreed to the consent prompt (or set auto-start for this app). */
export async function startDesktopMeeting(user: User, deviceId: number | null, input: StartInput): Promise<MeetingRow> {
  if (!pickTranscriber()) throw status(NO_TRANSCRIBER, 503);
  await rateLimit(`meetings-start:${user.id}`, 30, 86_400_000, "Many meetings today already. The copilot will be available again tomorrow.");
  const platform = isPlatform(input.platform) ? input.platform : "other";
  const ctx = await meetingContext(user.id, new Date(), { title: input.appTitle, platform, contactIds: ids(input.contactIds), dealIds: ids(input.dealIds) });
  return createMeeting(user.id, {
    source: "desktop", platform, title: (input.title ?? "").trim() || ctx.title, deviceId,
    consent: { at: new Date().toISOString(), by: user.email, noticeCopied: !!input.consent.noticeCopied, auto: !!input.consent.auto },
    context: { ...ctx, appTitle: (input.appTitle ?? "").slice(0, 200) },
    participants: ctx.people.map((p) => ({ name: p.name, email: p.email })),
  });
}

export type ChunkInput = { seq: number; startSec: number; durationSec: number; bytes: Uint8Array; mime: string; activity: Activity | null };

/** Transcribe one chunk and keep its segments (a chunk sent twice replaces itself). The audio is not kept. */
export async function recordChunk(user: User, meetingId: number, c: ChunkInput): Promise<{ segments: Segment[]; engine: string }> {
  if (!Number.isInteger(c.seq) || c.seq < 0 || c.seq > 20_000) throw status("bad chunk number", 400);
  if (!(c.durationSec > 0 && c.durationSec <= 120) || !(c.startSec >= 0) || c.startSec > MAX_MEETING_SEC) throw status("bad chunk timing", 400);
  if (!c.bytes.length) throw status("empty chunk", 400);
  if (c.bytes.length > MAX_CHUNK_BYTES) throw status("That piece of audio is too large.", 413);
  const m = await getMeeting(user.id, meetingId);
  if (m.status === "cancelled" || m.status === "failed") throw status("This meeting was stopped.", 409);
  if (m.source !== "desktop") throw status("This meeting is recorded by the notetaker.", 409);
  await rateLimit(`meetings-chunk:${user.id}`, 400, 3_600_000, "Too much audio this hour. The app will retry shortly.");
  const engine = pickTranscriber();
  if (!engine) throw status(NO_TRANSCRIBER, 503);
  const r = await engine.transcribe({ bytes: c.bytes, mime: c.mime, durationSec: c.durationSec });
  const segments = labelSelf(r.segments, c.activity);
  await putChunk(m.id, { seq: c.seq, startSec: c.startSec, durationSec: c.durationSec, segments, engine: r.model });
  const end = Math.round(c.startSec + c.durationSec);
  if (end > m.durationSec || !m.transcriber) await updateMeeting(m.id, { durationSec: Math.max(end, m.durationSec), transcriber: r.model });
  return { segments: segments.map((s) => ({ ...s, start: s.start + c.startSec, end: s.end + c.startSec })), engine: r.engine };
}

/**
 * The meeting ended (or was stopped). Live suggestions go off; notes are written in the background.
 * `discard` throws the transcript away instead, for "stop and delete".
 */
export async function endMeeting(user: User, meetingId: number, opts: { discard?: boolean } = {}): Promise<MeetingRow> {
  const m = await getMeeting(user.id, meetingId);
  if (opts.discard) {
    await deleteMeeting(user.id, m.id);
    return { ...m, status: "cancelled" };
  }
  if (m.status !== "live" && m.status !== "joining") return m;
  const row = await updateMeeting(m.id, { status: "processing", endedAt: new Date(), live: { ...m.live, on: false } });
  later(user, () => finishMeeting(user, m.id), m.id);
  return row;
}

/** Run work after the response, as the person (so model calls are counted against them). */
function later(user: User, fn: () => Promise<unknown>, meetingId: number) {
  // A meeting left "writing notes" by a failure would look stuck forever: say what happened instead.
  const failed = (e: unknown) => updateMeeting(meetingId, { status: "failed", error: describeFailure(e, 502, "meetings").message }).then(() => undefined, () => undefined);
  const run = () => runAsUser(user.id, fn).then(() => undefined, (e) => (e as { status?: number })?.status === 409 ? undefined : failed(e));
  try { after(run); } catch { void run(); }
}

/* ---------------- Notes ---------------- */

/** Whether this person may have AI notes for one more meeting now: the plan, or the free allowance. */
export async function notesAllowance(user: Pick<User, "id" | "email">): Promise<{ allowed: boolean; used: number; free: number; unlimited: boolean }> {
  const [unlimited, used] = await Promise.all([canUse(user, "meetings.notes"), notesUsedThisMonth(user.id)]);
  return { allowed: unlimited || used < MEETINGS_FREE_NOTES, used, free: MEETINGS_FREE_NOTES, unlimited };
}

/** One model pass over the whole transcript: notes, signals, proposals and follow-up drafts. */
export async function writeNotes(user: User, m: MeetingRow, segments: Segment[]): Promise<MeetingNotes> {
  const [ctx, crm] = await Promise.all([loadUserContext(user.id), getCrmSettings(user.id)]);
  const people = m.participants.filter((p) => !p.self).map((p) => `- ${p.name}${p.email ? ` <${p.email}>` : ""}`).join("\n");
  const date = m.startedAt.toISOString().slice(0, 10);
  const weekday = m.startedAt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const system = [
    `You write meeting notes for ${user.name || "the person"} (shown as "You" in the transcript). About them: ${personaFor(ctx, crm) || "not given"}.`,
    "Write from the transcript only. Never invent names, numbers, dates or commitments; when the transcript is unclear, leave the field empty.",
    "Speaker labels like S3A are anonymous and restart every 30 seconds of audio; name one only when the transcript makes it clear who is speaking.",
    "Action items: every commitment, with who made it and the date it is due, worked out from the meeting date when said relatively.",
    "Follow-up emails go to external participants, in the person's voice" + (crm.voice.trim() ? ` (${crm.voice.trim().slice(0, 600)})` : "") + ", short, with the agreed next steps; no signature.",
  ].join("\n");
  const prompt = [
    `Meeting: ${m.title || "(no title)"} on ${weekday} ${date}${m.durationSec ? `, ${Math.round(m.durationSec / 60)} minutes` : ""}.`,
    people ? `Known participants:\n${people}` : "Participants: not listed; take them from the transcript.",
    `Transcript:\n${renderTranscript(segments)}`,
  ].join("\n\n");
  const { data } = await structured(NotesSchema, "meetings-notes", system, prompt, { prefs: ctx.prefs, task: "draft", maxTokens: 12_000, timeoutMs: 240_000 });
  return parseNotes(data, { meetingDate: m.startedAt, selfName: user.name });
}

/**
 * Finish a meeting: notes if allowed and wanted, then Relationships. `force` is a person clicking
 * "Write notes" (it still needs the allowance or the plan). Safe to call twice: a lease keeps two
 * runs from overlapping, and filing into Relationships does nothing twice.
 */
export async function finishMeeting(user: User, meetingId: number, opts: { force?: boolean } = {}): Promise<{ meeting: MeetingRow; crm: CrmReport | null }> {
  const release = await lease(`meeting-finish:${meetingId}`, 5 * 60_000);
  if (!release) throw status("These notes are already being written.", 409);
  try {
    let m = await getMeeting(user.id, meetingId);
    const segments = stitch(await loadChunks(m.id));
    const settings = await getMeetingSettings(user.id);
    let notes: MeetingNotes | null = (m.notes as MeetingNotes | null) ?? null;
    let error = "";
    if (!segments.length) {
      error = "Nothing was transcribed in this meeting.";
    } else if (opts.force || (!notes && settings.autoNotes)) {
      const allowance = await notesAllowance(user);
      if (!allowance.allowed) {
        if (opts.force) await requireFeature(user, "meetings.notes");
        error = `You have used this month's ${allowance.free} free meeting notes. The transcript is saved; notes for every meeting are part of the Pro plan.`;
      } else {
        try {
          notes = await writeNotes(user, m, segments);
        } catch (e) {
          if (opts.force) throw e;
          error = `Notes could not be written: ${describeFailure(e, 502, "meetings-notes").message}`;
        }
      }
    } else if (!notes) {
      error = "Automatic notes are off. Choose “Write notes” to get them for this meeting.";
    }
    m = await updateMeeting(m.id, {
      status: "ready", error, ...(notes && notes !== m.notes ? { notes: notes as unknown as Record<string, unknown>, notesAt: new Date() } : {}),
      ...(m.endedAt ? {} : { endedAt: new Date() }),
    });
    const crm = await applyMeetingToCrm(user, m, notes).catch((e) => { logError(e, { where: "meetings-crm" }); return null; });
    return { meeting: await getMeeting(user.id, m.id), crm };
  } finally {
    await release();
  }
}

/* ---------------- The notetaker bot ---------------- */

const BOT_USD_PER_HOUR = 0.65;

/** Send the notetaker to a meeting link: a person's click (or an auto-join rule they switched on). */
export async function sendBot(user: User, input: { meetingUrl: string; title?: string; contactIds?: unknown; dealIds?: unknown }, how: "click" | "auto" = "click"): Promise<MeetingRow> {
  await requireFeature(user, "meetings.bot");
  const provider = botProvider();
  if (!provider.ready()) throw status("The notetaker is not set up on this YouBank yet.", 503);
  const url = input.meetingUrl.trim();
  if (!isMeetingUrl(url)) throw status("Paste the meeting's Zoom, Teams, Google Meet or Webex link.", 400);
  await rateLimit(`meetings-bot:${user.id}`, 12, 86_400_000, "The notetaker has joined many meetings today. Try again tomorrow.");
  const settings = await getMeetingSettings(user.id);
  const ctx = await meetingContext(user.id, new Date(), { meetingUrl: url, platform: platformOfUrl(url) ?? "other", contactIds: ids(input.contactIds), dealIds: ids(input.dealIds) });
  const m = await createMeeting(user.id, {
    source: "bot", status: "joining", platform: platformOfUrl(url) ?? "other", meetingUrl: url, title: (input.title ?? "").trim() || ctx.title,
    consent: { at: new Date().toISOString(), by: user.email, auto: how === "auto" }, context: { ...ctx },
    participants: ctx.people.map((p) => ({ name: p.name, email: p.email })),
  });
  try {
    const bot = await provider.createBot({ meetingUrl: url, botName: settings.botName, meetingId: m.id });
    return updateMeeting(m.id, { botId: bot.botId, bot: { provider: provider.id, status: bot.code, statusAt: new Date().toISOString() } });
  } catch (e) {
    await updateMeeting(m.id, { status: "failed", error: describeFailure(e, 502, "meetings-bot").message });
    throw e;
  }
}

/** Take the notetaker out of the call; its transcript so far still becomes notes. */
export async function stopBot(user: User, meetingId: number): Promise<MeetingRow> {
  const m = await getMeeting(user.id, meetingId);
  if (m.source !== "bot" || !m.botId) throw status("This meeting has no notetaker.", 409);
  if (m.status === "joining" || m.status === "live") await botProvider().leave(m.botId);
  return syncBot(user, m, true);
}

/**
 * Bring a bot meeting up to date with the provider: its status and, once the transcript is ready, the
 * transcript and participants, then notes. From a webhook or a poll; idempotent.
 */
export async function syncBot(user: User, m: MeetingRow, force = false): Promise<MeetingRow> {
  if (m.source !== "bot" || !m.botId || m.status === "ready" || m.status === "failed" || m.status === "cancelled") return m;
  const polled = m.bot.polledAt ? Date.parse(m.bot.polledAt) : 0;
  if (!force && Date.now() - polled < 20_000) return m;
  const provider = botProvider();
  const state = await provider.getBot(m.botId);
  const bot = { ...m.bot, status: state.code, statusAt: m.bot.status === state.code ? m.bot.statusAt : new Date().toISOString(), polledAt: new Date().toISOString(),
    ...(state.status === "live" && !m.bot.joinedAt ? { joinedAt: new Date().toISOString() } : {}) };
  if (state.status === "failed") return updateMeeting(m.id, { status: "failed", bot: { ...bot, error: state.error ?? "" }, error: state.error ?? "The notetaker could not record this meeting." });
  if (state.status !== "processing" || !state.transcriptUrl) return updateMeeting(m.id, { status: state.status === "processing" ? "processing" : state.status, bot });
  // The recording is done and its transcript is ready: keep it, then notes.
  const { segments, participants } = await provider.fetchTranscript(state);
  const duration = Math.round(segments.reduce((mx, s) => Math.max(mx, s.end), 0));
  await putChunk(m.id, { seq: 0, startSec: 0, durationSec: duration, segments, engine: `${provider.id} transcript` });
  const known = new Map(m.participants.map((p) => [(p.email || p.name).toLowerCase(), p]));
  for (const p of participants) if (!known.has((p.email || p.name).toLowerCase())) known.set((p.email || p.name).toLowerCase(), { name: p.name, email: p.email });
  const joined = bot.joinedAt ? Date.parse(bot.joinedAt) : m.startedAt.getTime();
  const hours = Math.max(duration, (Date.now() - joined) / 1000) / 3600;
  recordUsage({ feature: "meetings-bot", provider: provider.id, model: "notetaker", usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: Math.round(hours * BOT_USD_PER_HOUR * 1000) / 1000 });
  const row = await updateMeeting(m.id, { status: "processing", bot: { ...bot, endedAt: new Date().toISOString() }, participants: [...known.values()], durationSec: duration, endedAt: m.endedAt ?? new Date(), transcriber: `${provider.id} transcript` });
  later(user, () => finishMeeting(user, m.id), m.id);
  return row;
}

/** A verified webhook from the bot provider: find the meeting and bring it up to date. */
export async function onBotWebhook(event: { botId: string; code: string }, owner: (userId: string) => Promise<User | null>): Promise<void> {
  const m = await meetingByBot(event.botId);
  if (!m) return;
  const user = await owner(m.userId);
  if (!user) return;
  await runAsUser(user.id, () => syncBot(user, m, true));
}

/* ---------------- Corrections ---------------- */

/**
 * The person renames a meeting, or says who and what it was about: picked contacts and deals are
 * added; an unpicked contact loses the link and its meeting entry. A finished meeting is filed again
 * with the notes it has (no model call).
 */
export async function updatePicks(user: User, meetingId: number, input: { title?: unknown; contactIds?: unknown; dealIds?: unknown; removeContactId?: unknown }): Promise<MeetingRow> {
  let m = await getMeeting(user.id, meetingId);
  const ctx = m.context as { contactIds?: number[]; dealIds?: number[]; excludedContactIds?: number[] };
  const set: Partial<MeetingRow> = {};
  if (typeof input.title === "string") set.title = input.title.replace(/\p{Cc}/gu, "").trim().slice(0, 200);
  const remove = Number(input.removeContactId);
  const added = ids(input.contactIds);
  const contactIds = [...new Set([...(ctx.contactIds ?? []), ...added])].filter((n) => n !== remove);
  const dealIds = [...new Set([...(ctx.dealIds ?? []), ...ids(input.dealIds)])];
  // An unlinked contact stays unlinked when the meeting is filed again, even if a name still fits.
  const excludedContactIds = [...new Set([...(ctx.excludedContactIds ?? []), ...(remove > 0 ? [remove] : [])])].filter((n) => !added.includes(n));
  set.context = { ...m.context, contactIds, dealIds, excludedContactIds };
  if (Number.isInteger(remove) && remove > 0) {
    await unlinkMeeting(user.id, m.id, "contact", remove);
    await removeMeetingEntry(user.id, m.id, remove);
    set.participants = m.participants.map((p) => (p.contactId === remove ? { ...p, contactId: null, how: "none" } : p));
  }
  m = await updateMeeting(m.id, set);
  if (m.status === "ready") await applyMeetingToCrm(user, m, (m.notes as MeetingNotes | null) ?? null);
  else if (ids(input.contactIds).length || ids(input.dealIds).length) {
    await linkMeeting(user.id, m.id, "contact", ids(input.contactIds), "manual");
    await linkMeeting(user.id, m.id, "deal", ids(input.dealIds), "manual");
  }
  return getMeeting(user.id, m.id);
}
