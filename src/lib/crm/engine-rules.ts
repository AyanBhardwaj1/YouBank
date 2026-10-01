/**
 * The adaptive engine's rules, with no server imports: vocabulary, buckets, labels, certification and
 * demotion. The engine (server) and the public site's live demonstration run exactly this code.
 *
 * The rules follow the research reviewed for YouBank in September 2026:
 * - Autonomy is certified on the person's own labels with a flat prior, at a stated error rate and
 *   confidence (Learn-then-Test, Angelopoulos et al., Ann. Appl. Stat. 2025; Trust-or-Escalate,
 *   ICLR 2025), not on the model's self-graded confidence, which recent work shows is poorly calibrated.
 * - A good draft is one sent unchanged with no critical field (number, date, link, address) altered
 *   ("strong acceptance", Ansible Lightspeed, 2024).
 * - Demotion is anytime-valid: an e-process over audited labels (Ville's inequality), plus a streak of
 *   cancellations, plus decay with a 90-day half-life (discounted Thompson sampling, Raj & Kalyani 2017).
 */
import type { AutonomyScope, SendWindow } from "./autopilot-rules";
import { betaQuantile, mean, type Posterior } from "./learning-math";

/* ---------------- Vocabulary ---------------- */

export const ANGLES = {
  insight: { label: "Specific observation", instruction: "Open with one specific, verifiable observation about their company taken from the record, then say why that is why you are writing." },
  question: { label: "Relevant question", instruction: "Open with one short question they would genuinely want to answer, grounded in their record, then make the ask." },
  outcome: { label: "Outcome first", instruction: "Open with the concrete outcome you deliver for companies like theirs, stated plainly and without hype, then make the ask." },
  brief: { label: "Very short", instruction: "Keep the whole email under 60 words: who you are, why them, one small ask." },
  why_now: { label: "Why now (fresh Form D)", instruction: "Open with their recent raise exactly as filed (the Form D date and amount given in the record), then say why that makes now a good moment. Never overstate it: a Form D is an amount sold to date, not necessarily a new round." },
} as const;
export type Angle = keyof typeof ANGLES;
/** Angles that are only available when their trigger exists ("sleeping" arms, Duolingo KDD 2020). */
export const SLEEPING_ANGLES: Angle[] = ["why_now"];

/** Local-time send slots. Each is intersected with the person's own sending hours. */
export const HOURS = {
  morning: { label: "Morning", start: 7, end: 11 },
  midday: { label: "Midday", start: 11, end: 14 },
  afternoon: { label: "Afternoon", start: 14, end: 19 },
} as const;
export type HourSlot = keyof typeof HOURS;

/** How long a first-touch email waits for a reply before it counts as unanswered. */
export const REPLY_WINDOW_DAYS = 14;

export const TRUST = {
  /** Probation in "ask me" terms: enough labels, and fewer than half were good. */
  probationMin: 3, probationMean: 0.5,
  /** Certification for autopilot: 90% confident at most 10% would need edits, on at least 20 own labels. */
  certifyMin: 20, certifyConfidence: 0.9, certifyBadRate: 0.1,
  /** Spot checks after graduation, so labels keep arriving: 1 in 5, then 1 in 20 once mature. */
  auditRate: 0.2, auditRateMature: 0.05, matureLabels: 60,
  /** Anytime-valid demotion: e-process against a 10% bad rate, alternative 20%, threshold 20 (δ = 5%). */
  eAlpha: 0.1, eAlpha1: 0.2, eThreshold: 20,
  /** Three cancelled autopilot sends in a row hands the kind back to the person. */
  cancelStreak: 3,
  halfLifeDays: 90,
};

/* ---------------- Buckets ---------------- */

export type DraftLike = { kind: string; meta: { audience?: string; category?: string; step?: number }; confidence: string };

/**
 * The stratum a draft's outcome counts towards: what kind of email, to whom, about what. The model's
 * own confidence is deliberately not part of it; it stays a hard gate on sending instead.
 */
export function bucketOf(d: DraftLike): string {
  if (d.kind === "reply") return `reply:${d.meta.audience === "internal" ? "internal" : "external"}:${d.meta.category || "other"}`;
  if (d.kind === "campaign") return `campaign:${(d.meta.step ?? 0) === 0 ? "first" : "follow"}`;
  return d.kind;
}

export function contextOf(d: Pick<DraftLike, "kind" | "meta">): string {
  return d.kind === "reply" ? `reply:${d.meta.audience === "internal" ? "internal" : "external"}` : d.kind;
}

/** The autonomy setting that governs a bucket, for graduation suggestions. */
export function scopeOfBucket(bucket: string): AutonomyScope | null {
  if (bucket.startsWith("reply:internal")) return "internal";
  if (bucket.startsWith("reply:external")) return "external";
  if (bucket.startsWith("campaign")) return "campaigns";
  if (bucket.startsWith("follow_up")) return "followUps";
  if (bucket.startsWith("nurture")) return "nurture";
  if (bucket.startsWith("intro")) return "intros";
  return null;
}

/* ---------------- Labels ---------------- */

const CRITICAL = /\$?\d[\d,]*(?:\.\d+)?%?|https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi;

/** Numbers, amounts, percentages, links, addresses, days and months: the facts an edit must not change silently. */
export function criticalFields(text: string): string[] {
  return (text.match(CRITICAL) ?? []).map((t) => t.toLowerCase().replace(/[.,;:)]+$/, "")).sort();
}

export function criticalChange(original: string, final: string): boolean {
  const a = criticalFields(original), b = criticalFields(final);
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

export type Scored = { outcome: "unchanged" | "edited" | "rewritten" | "critical"; good: boolean };

/**
 * A person's decision on a draft, as a label. Good means sent unchanged (edit ratio ≤ 5%) with no
 * critical field altered. Everything else is bad for certification: a light edit is still an email
 * autopilot would have sent wrong. Discards are not labels: "no reply needed" and "wrong reply" look
 * the same from outside.
 */
export function scoreSend(ratio: number, critical = false): Scored {
  if (critical) return { outcome: "critical", good: false };
  if (ratio <= 0.05) return { outcome: "unchanged", good: true };
  if (ratio <= 0.25) return { outcome: "edited", good: false };
  return { outcome: "rewritten", good: false };
}

/* ---------------- Certification and demotion ---------------- */

/** Counts decay with a half-life, so trust earned long ago counts for less than recent behaviour. */
export const decayFactor = (days: number, halfLife = TRUST.halfLifeDays) => Math.pow(0.5, Math.max(0, days) / halfLife);

/** One step of the e-process for "the bad rate is at most α": grows when bad labels come too often. */
export const eStep = (e: number, bad: boolean) =>
  e * (bad ? TRUST.eAlpha1 / TRUST.eAlpha : (1 - TRUST.eAlpha1) / (1 - TRUST.eAlpha));

export type TrustState = "learning" | "trusted" | "probation";
export type TrustCounts = { good: number; bad: number; observations: number; eprocess?: number; cancelStreak?: number };

export function trustState(c: TrustCounts): { state: TrustState; mean: number; lower: number; upper: number; certifiedBadRate: number; reason: string } {
  const post: Posterior = { alpha: 1 + c.good, beta: 1 + c.bad }; // flat prior: only the person's own labels
  const m = mean(post);
  const lower = betaQuantile(0.05, post.alpha, post.beta);
  const upper = betaQuantile(0.95, post.alpha, post.beta);
  const certifiedBadRate = 1 - betaQuantile(1 - TRUST.certifyConfidence, post.alpha, post.beta);
  const base = { mean: m, lower, upper, certifiedBadRate };
  if ((c.cancelStreak ?? 0) >= TRUST.cancelStreak) return { state: "probation", ...base, reason: `you stopped the last ${c.cancelStreak} automatic sends` };
  if ((c.eprocess ?? 1) >= TRUST.eThreshold) return { state: "probation", ...base, reason: "recent drafts needed edits more often than autopilot allows" };
  if (c.observations >= TRUST.probationMin && m < TRUST.probationMean) return { state: "probation", ...base, reason: "you change most drafts like this before sending" };
  if (c.observations >= TRUST.certifyMin && certifiedBadRate <= TRUST.certifyBadRate) return { state: "trusted", ...base, reason: "" };
  return { state: "learning", ...base, reason: "" };
}

/** How often a would-be automatic send is routed to the person instead, so labels keep arriving. */
export const auditRate = (observations: number) => (observations < TRUST.matureLabels ? TRUST.auditRate : TRUST.auditRateMature);

/* ---------------- Outreach delay model ---------------- */

/**
 * The chance a reply that will come has already come, t hours after sending. Until YouBank has 200
 * replies to fit its own curve, 1 − exp(−t/36h): half of replies within a day, 86% within three.
 * A pending send counts as this fraction of a failure (Vernade, Cappé & Perchet, UAI 2017), so the
 * engine learns now instead of waiting out the reply window.
 */
export const replyArrived = (hours: number) => 1 - Math.exp(-Math.max(0, hours) / 36);

/* ---------------- Variants and send slots ---------------- */

export const parseVariant = (v: string) => Object.fromEntries(v.split(";").map((p) => p.split(":")).filter((p) => p.length === 2)) as { angle?: Angle; hour?: HourSlot; p?: string; explore?: string };
export const formatVariant = (v: { angle?: string; hour?: string; p?: string; explore?: string }) => Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k}:${x}`).join(";");

/** The send slot an actual send time fell in, in the person's zone. */
export function hourSlotOf(at: Date, tz: string): HourSlot {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "numeric" }).format(at)) % 24;
  return hour < HOURS.morning.end ? "morning" : hour < HOURS.midday.end ? "midday" : "afternoon";
}

/** Narrow the person's sending hours to one slot; if they do not overlap, keep the person's hours. */
export function slotWindow(w: SendWindow, slot: HourSlot): SendWindow {
  const s = HOURS[slot];
  const start = Math.max(w.start, s.start), end = Math.min(w.end, s.end);
  return end > start ? { ...w, start, end } : w;
}

/* ---------------- The security veto ---------------- */

const LINKISH = /https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b\d{8,}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;

/**
 * Links, email addresses and account-like numbers in a draft that the person never gave the agent
 * themselves. An automatic send may only contain ones from the person's own settings, playbook or
 * signature: anything else could have come from an inbound email trying to steer the agent (the
 * Trojan Hippo and EchoLeak attacks, 2025–2026), so a person has to see it.
 */
export function unapprovedDetails(body: string, approvedText: string): string[] {
  const approved = new Set((approvedText.match(LINKISH) ?? []).map((x) => x.toLowerCase().replace(/[.,;:]+$/, "")));
  return [...new Set((body.match(LINKISH) ?? []).map((x) => x.toLowerCase().replace(/[.,;:]+$/, "")))].filter((x) => !approved.has(x));
}
