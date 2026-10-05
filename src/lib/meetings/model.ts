/**
 * The meeting copilot's shared vocabulary: meeting apps, statuses, the settings a person keeps, and the
 * shape of a meeting's notes. Pure data and pure functions, safe on the client and in tests.
 */

/** A piece of transcript. Times are seconds; `speaker` is a name, "You", or a diarizer's label. */
export type Segment = { start: number; end: number; text: string; speaker?: string };

export const PLATFORMS = ["zoom", "teams", "meet", "webex", "slack", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = {
  zoom: "Zoom", teams: "Microsoft Teams", meet: "Google Meet", webex: "Webex", slack: "Slack huddle", other: "Meeting",
};
export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

/** Which app a meeting link belongs to, from its host. Pure. */
export function platformOfUrl(url: string): Platform | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)zoom\.(us|com)$|(^|\.)zoomgov\.com$/.test(host)) return "zoom";
  if (/(^|\.)teams\.(microsoft|live)\.com$/.test(host)) return "teams";
  if (host === "meet.google.com") return "meet";
  if (/(^|\.)webex\.com$/.test(host)) return "webex";
  if (/(^|\.)slack\.com$/.test(host)) return "slack";
  return null;
}

/** A meeting link a notetaker bot can join: https on a known meeting host. Pure. */
export function isMeetingUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && platformOfUrl(u.toString()) !== null && platformOfUrl(u.toString()) !== "slack";
  } catch {
    return false;
  }
}

export const STATUSES = ["joining", "live", "processing", "ready", "failed", "cancelled"] as const;
export type MeetingStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<MeetingStatus, string> = {
  joining: "Notetaker joining", live: "Listening", processing: "Writing notes", ready: "Notes ready", failed: "Failed", cancelled: "Stopped",
};

/* ---------------- Settings ---------------- */

/**
 * What a person chose for the copilot, kept on the server so every computer follows it. The desktop
 * app keeps its own switches for what happens on that computer (whether it listens for meetings,
 * records system audio, keeps a local copy of the audio).
 */
export type MeetingSettings = {
  /** The text the person can paste into the meeting chat before recording. */
  noticeText: string;
  /** Apps never to offer or record. */
  neverApps: Platform[];
  /** Never offer or record a meeting whose title or window contains one of these (case-insensitive). */
  neverKeywords: string[];
  /** Apps whose calls start the copilot without asking (the indicator still shows). Off by default. */
  autoStartApps: Platform[];
  /** Delete transcripts this many days after the meeting; 0 keeps them. Notes stay. */
  retentionDays: number;
  /** Write notes as soon as a meeting ends (within the plan's allowance). */
  autoNotes: boolean;
  /** Draft follow-up emails into the review queue with the notes. */
  followUps: boolean;
  /** The name the notetaker bot joins with. */
  botName: string;
  /**
   * Send the notetaker to calendar meetings on its own. Needs a calendar source (see docs/meetings.md)
   * and the plan; off until the person switches it on.
   */
  autoJoin: boolean;
};

export const DEFAULT_NOTICE = "Heads up: I'm using YouBank to take notes on this call. It records audio to make a transcript and notes for me. Tell me if you'd rather I didn't.";

export const DEFAULT_SETTINGS: MeetingSettings = {
  noticeText: DEFAULT_NOTICE, neverApps: [], neverKeywords: [], autoStartApps: [], retentionDays: 0,
  autoNotes: true, followUps: true, botName: "YouBank Notetaker", autoJoin: false,
};

const strings = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, len)).filter(Boolean))].slice(0, max) : [];

/** Settings from storage or a form, with every value in range. Pure. */
export function normalizeSettings(raw: unknown): MeetingSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const days = Number(r.retentionDays);
  return {
    noticeText: typeof r.noticeText === "string" && r.noticeText.trim() ? r.noticeText.trim().slice(0, 600) : d.noticeText,
    neverApps: strings(r.neverApps, 10, 20).filter(isPlatform),
    neverKeywords: strings(r.neverKeywords, 30, 60),
    autoStartApps: strings(r.autoStartApps, 10, 20).filter(isPlatform),
    retentionDays: Number.isFinite(days) ? Math.max(0, Math.min(3650, Math.round(days))) : 0,
    autoNotes: typeof r.autoNotes === "boolean" ? r.autoNotes : d.autoNotes,
    followUps: typeof r.followUps === "boolean" ? r.followUps : d.followUps,
    botName: typeof r.botName === "string" && r.botName.trim() ? r.botName.replace(/\p{Cc}/gu, "").trim().slice(0, 40) : d.botName,
    autoJoin: r.autoJoin === true,
  };
}

/** Why a meeting must not be recorded under these settings, or null. Pure. */
export function refusedBy(settings: Pick<MeetingSettings, "neverApps" | "neverKeywords">, platform: string, title: string): string | null {
  if (isPlatform(platform) && settings.neverApps.includes(platform)) return `You chose never to record ${PLATFORM_LABEL[platform]} meetings.`;
  const t = title.toLowerCase();
  const hit = settings.neverKeywords.find((k) => k && t.includes(k.toLowerCase()));
  return hit ? `You chose never to record meetings that mention “${hit}”.` : null;
}

/* ---------------- Notes ---------------- */

export type ActionItem = { text: string; owner: string; due: string | null; dueText: string; mine: boolean };
export type Interest = "high" | "medium" | "low" | "unclear";
export type ParticipantNotes = {
  name: string; email: string; company: string; title: string;
  /** -1 (negative) to 1 (positive). */
  sentiment: number;
  interest: Interest;
  signals: string[];
  /** New facts about them worth remembering (their role, plans, constraints), as stated. */
  facts: string[];
  topics: string[]; knows: string[]; asks: string[];
};
export type StatedDeal = {
  company: string; stage: string; round: string; amount: string; valuation: string; sector: string;
  nextStep: string; nextStepDue: string; quote: string;
};
export type FollowUp = { to: string; email: string; subject: string; body: string };

/** What the copilot writes after a meeting, parsed and normalized (see notes.ts). */
export type MeetingNotes = {
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
  /** Diarizer labels the transcript made clear, mapped to names ("S3B" is "Maya Chen"). */
  speakers: { label: string; name: string }[];
  participants: ParticipantNotes[];
  deals: StatedDeal[];
  followUps: FollowUp[];
};

export const INTEREST_LABEL: Record<Interest, string> = { high: "High interest", medium: "Some interest", low: "Low interest", unclear: "Interest unclear" };

/** A whole-second duration as "1 h 05 min" or "12 min" or "40 s". Pure. */
export function durationLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "00:12:05" or "12:05" for a time in the meeting. Pure. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
