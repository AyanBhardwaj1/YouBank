/**
 * Autopilot: when the agent may send on its own, and when it must hand an email to a person.
 *
 * Pure functions and vocabulary only, with no server imports, so the settings screen, the scheduler
 * and the tests all read the same rules.
 */

import { DAY_MS } from "./model";

/* ---------------- Autonomy ---------------- */

/** off: do nothing. approve: write it and wait for a person. auto: write it and send it. */
export const AUTONOMY_LEVELS = ["off", "approve", "auto"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_SCOPES = ["external", "internal", "campaigns", "followUps", "nurture"] as const;
export type AutonomyScope = (typeof AUTONOMY_SCOPES)[number];

export const SCOPE_LABEL: Record<AutonomyScope, string> = {
  external: "Replies to people outside your company",
  internal: "Replies to your coworkers",
  campaigns: "Cold email campaigns",
  followUps: "Follow-ups when nobody answers",
  nurture: "Reconnecting with quiet contacts",
};

export const SCOPE_HINT: Record<AutonomyScope, Record<Autonomy, string>> = {
  external: { off: "Nothing is drafted; reply yourself from the Inbox tab.", approve: "Every email that needs a reply gets a draft, waiting for you.", auto: "The agent answers on its own when it is confident." },
  internal: { off: "Nothing is drafted for coworkers.", approve: "Coworker emails get a draft, waiting for you.", auto: "The agent answers coworkers on its own when it is confident." },
  campaigns: { off: "Campaigns do not send.", approve: "Each campaign email waits for you.", auto: "Campaign emails go out on schedule. A campaign can override this." },
  followUps: { off: "Only suggested; you decide.", approve: "The follow-up is drafted, waiting for you.", auto: "The follow-up is written and sent." },
  nurture: { off: "Rules do not write.", approve: "Reconnection notes wait for you.", auto: "Reconnection notes go out. A rule can override this." },
};

export const AUTONOMY_LABEL: Record<Autonomy, string> = { off: "Off", approve: "Ask me", auto: "Autopilot" };

/** A campaign or nurture rule either follows the default for its kind or sets its own. */
export const SEND_MODES = ["default", "approve", "auto"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export type SendWindow = { tz: string; start: number; end: number; weekdays: boolean };

export type AutopilotSettings = {
  /** The master switch. Off means nothing is ever sent without a person, whatever the levels say. */
  enabled: boolean;
  /**
   * Regulated mode, for FINRA and SEC registrants who must supervise and archive communications:
   * autopilot cannot be switched on, and every email is sent by a person from their own mailbox.
   */
  regulated: boolean;
  autonomy: Record<AutonomyScope, Autonomy>;
  /** Minutes an automatic send waits in the queue, so it can be stopped. */
  holdMinutes: number;
  /** Automatic sends per rolling 24 hours, across everything. */
  dailyCap: number;
  /** Automatic sends only go out inside these local hours. */
  window: SendWindow;
  /** Read the mailbox every few minutes, not only when you press Sync. */
  autoSync: boolean;
};

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: false,
  regulated: false,
  autonomy: { external: "approve", internal: "approve", campaigns: "approve", followUps: "off", nurture: "approve" },
  holdMinutes: 5,
  dailyCap: 40,
  window: { tz: "UTC", start: 8, end: 19, weekdays: true },
  autoSync: true,
};

const isLevel = (v: unknown): v is Autonomy => typeof v === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(v);
export const isSendMode = (v: unknown): v is SendMode => typeof v === "string" && (SEND_MODES as readonly string[]).includes(v);

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Anything stored or posted becomes a complete, valid settings object. */
export function normalizeAutopilot(raw: unknown): AutopilotSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AutopilotSettings>;
  const a = (r.autonomy && typeof r.autonomy === "object" ? r.autonomy : {}) as Partial<Record<AutonomyScope, unknown>>;
  const w = (r.window && typeof r.window === "object" ? r.window : {}) as Partial<SendWindow>;
  const start = int(w.start, 0, 23, DEFAULT_AUTOPILOT.window.start);
  const end = int(w.end, 1, 24, DEFAULT_AUTOPILOT.window.end);
  const regulated = r.regulated === true;
  return {
    // Regulated mode wins: autopilot is off, whatever else was posted.
    enabled: r.enabled === true && !regulated,
    regulated,
    autonomy: Object.fromEntries(AUTONOMY_SCOPES.map((s) => [s, isLevel(a[s]) ? a[s] : DEFAULT_AUTOPILOT.autonomy[s]])) as Record<AutonomyScope, Autonomy>,
    holdMinutes: int(r.holdMinutes, 0, 240, DEFAULT_AUTOPILOT.holdMinutes),
    dailyCap: int(r.dailyCap, 1, 400, DEFAULT_AUTOPILOT.dailyCap),
    window: {
      tz: validTimeZone(w.tz) ? w.tz : DEFAULT_AUTOPILOT.window.tz,
      start, end: end > start ? end : Math.min(24, start + 1),
      weekdays: w.weekdays !== false,
    },
    autoSync: r.autoSync !== false,
  };
}

/** The level that applies, after a campaign's or rule's own override. */
export function levelFor(settings: AutopilotSettings, scope: AutonomyScope, override?: string | null): Autonomy {
  if (override === "approve") return "approve";
  if (override === "auto") return "auto";
  return settings.autonomy[scope];
}

/* ---------------- When a send may go out ---------------- */

function localParts(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "numeric", minute: "numeric" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24; // some engines render midnight as 24
  return { weekday: get("weekday"), hour, minute: Number(get("minute")) };
}

export function insideWindow(at: Date, w: SendWindow): boolean {
  const { weekday, hour } = localParts(at, w.tz);
  if (w.weekdays && (weekday === "Sat" || weekday === "Sun")) return false;
  return hour >= w.start && hour < w.end;
}

/**
 * The first moment at or after `from` that falls inside the sending window, in the window's own
 * time zone. Steps to the next local hour boundary and then an hour at a time, which is exact for
 * any whole-hour window and handles half-hour zones and daylight-saving changes.
 */
export function nextSendTime(from: Date, w: SendWindow): Date {
  if (insideWindow(from, w)) return from;
  const { minute } = localParts(from, w.tz);
  let t = new Date(from.getTime() + (60 - minute) * 60_000);
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 24 * 9; i++) {
    if (insideWindow(t, w)) return t;
    t = new Date(t.getTime() + 3_600_000);
  }
  return t; // a window that never opens; unreachable with a valid window
}

/* ---------------- What the agent must never send on its own ---------------- */

/** Brackets, mustaches and TBDs mean the model left a gap for a person to fill. */
export function hasPlaceholder(text: string): boolean {
  return /\[[^\]\n]{1,60}\]|\{\{[^}\n]{1,60}\}\}|<\s*(insert|your|name|date|time|company)[^>]{0,40}>|\bTBD\b|\bXX+\b/i.test(text);
}

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|automated|auto-?confirm|system|daemon)([+._-]|$)/i;

/** Addresses no person reads. Replying to them is pointless at best and a mail loop at worst. */
export function isAutomatedAddress(address: string): boolean {
  const local = address.split("@")[0] ?? "";
  return AUTOMATED_LOCAL.test(local);
}

/**
 * Headers that mark a message as machine-sent: auto-replies, bulk mail, mailing lists.
 * `get` returns a header's value, or undefined when it is absent.
 */
export function isAutomatedMessage(get: (name: string) => string | undefined, fromAddress: string): boolean {
  const autoSubmitted = (get("auto-submitted") ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = (get("precedence") ?? "").trim().toLowerCase();
  if (["bulk", "list", "junk", "auto_reply"].includes(precedence)) return true;
  if (get("list-id") || get("list-unsubscribe")) return true;
  if (get("x-autoreply") || get("x-autorespond")) return true;
  // Exchange marks its own out-of-office notices, meeting responses and bounces this way.
  if (/\b(all|oof|autoreply)\b/i.test(get("x-auto-response-suppress") ?? "")) return true;
  if ((get("x-autogenerated") ?? "").toLowerCase() === "reply") return true;
  return isAutomatedAddress(fromAddress);
}

/** Internal means someone at your own company, judged by email domain. */
export function audienceOf(address: string, internalDomains: string[]): "internal" | "external" {
  const domain = (address.split("@")[1] ?? "").toLowerCase();
  return domain && internalDomains.some((d) => domain === d || domain.endsWith(`.${d}`)) ? "internal" : "external";
}

export type SendCheck = {
  enabled: boolean;
  level: Autonomy;
  kind: string;
  confidence: string;
  sensitive: boolean;
  openQuestions: number;
  needsInput: number;
  body: string;
  subject: string;
  recipients: string[];
  recipientOptedOut: boolean;
  /** The message being answered was machine-sent (an auto-reply, a list mail). */
  replyingToAutomated: boolean;
  /** How many emails autopilot already sent in this conversation in the last day. */
  autoSentInThread: number;
};

/**
 * Whether autopilot may send this draft. Every reason it may not is returned, so the review queue can
 * say exactly why an email is waiting for a person. Anything doubtful goes to a person: an email not
 * sent costs a few minutes; a wrong one sent cannot be taken back.
 */
export function autoSendVerdict(c: SendCheck): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!c.enabled) reasons.push("Autopilot is off");
  if (c.level !== "auto") reasons.push("This kind of email is set to ask you first");
  if (c.confidence !== "high") reasons.push(`The agent's confidence is ${c.confidence || "unknown"}, not high`);
  if (c.sensitive) reasons.push("It touches money, terms, legal or something sensitive");
  if (c.needsInput > 0) reasons.push(`It needs ${c.needsInput === 1 ? "an answer" : `${c.needsInput} answers`} from you`);
  if (c.openQuestions > 0) reasons.push("It has decisions left for you");
  if (hasPlaceholder(`${c.subject}\n${c.body}`)) reasons.push("It contains a blank to fill in");
  if (!c.body.trim()) reasons.push("It is empty");
  if (c.recipients.length === 0) reasons.push("It has no recipient");
  if (c.recipients.some(isAutomatedAddress)) reasons.push("The recipient is an automated address");
  if (c.recipientOptedOut && c.kind !== "reply") reasons.push("The recipient asked not to be contacted");
  if (c.replyingToAutomated) reasons.push("It answers an automated message");
  if (c.autoSentInThread >= 2) reasons.push("Autopilot already sent twice in this conversation today");
  return { ok: reasons.length === 0, reasons };
}

/** Rolling-day count of automatic sends against the cap. */
export function capReached(sentTimes: Date[], now: Date, cap: number): boolean {
  return sentTimes.filter((t) => now.getTime() - t.getTime() < DAY_MS).length >= cap;
}

/* ---------------- The playbook ---------------- */

export type PlaybookEntry = { id: number; question: string; answer: string };

const STOP = new Set("about above after again against also been before being below between both could does doing down during each from further have having here hers herself himself into itself just more most myself once only other ours ourselves over same should some such than that their theirs them themselves then there these they this those through under until very what when where which while whom will with would your yours yourself yourselves please thanks thank hello regards best".split(" "));
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$%]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

/**
 * The playbook answers worth putting in front of the model for this email. All of them when they fit
 * the budget; otherwise the ones that share the most words with the email, so a pricing question
 * brings the pricing answer.
 */
export function selectPlaybook(entries: PlaybookEntry[], text: string, budget = 6000): PlaybookEntry[] {
  const size = (e: PlaybookEntry) => e.question.length + e.answer.length + 10;
  if (entries.reduce((n, e) => n + size(e), 0) <= budget) return entries;
  const have = words(text);
  const scored = entries.map((e) => {
    const w = words(`${e.question} ${e.answer}`);
    let score = 0;
    for (const x of w) if (have.has(x)) score++;
    return { e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const out: PlaybookEntry[] = [];
  let used = 0;
  for (const { e } of scored) {
    if (used + size(e) > budget) continue;
    out.push(e); used += size(e);
  }
  return out;
}

export function renderPlaybook(entries: PlaybookEntry[]): string {
  if (entries.length === 0) return "";
  return `Answers the reader has given before. They are authoritative and apply to anyone in the same situation, not only to whoever first asked: use them, in the reader's words where they fit, and never contradict them. When a request falls inside what an answer covers (8 entities under a price for "up to 10"), answer it:\n${entries.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n")}`;
}
