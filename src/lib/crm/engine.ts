import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import type { AutonomyScope } from "./autopilot-rules";
import {
  ANGLES, HOURS, REPLY_WINDOW_DAYS, SLEEPING_ANGLES, TRUST, auditRate, bucketOf, contextOf, criticalChange, eStep,
  hourSlotOf, parseVariant, replyArrived, scopeOfBucket, scoreSend, trustState,
  type Angle, type DraftLike, type HourSlot, type Scored,
} from "./engine-rules";
import { betaQuantile, editRatio, jaccard, mean, populationPrior, probabilityBest, thompson, type Posterior } from "./learning-math";

export * from "./engine-rules";

/**
 * The adaptive engine: three loops that make the agent better for one person the more it is used.
 *
 * 1. Earned autonomy. For each stratum of email (kind × audience × what it is about), the person's
 *    own decisions are labels: good when a draft goes out unchanged with no critical field altered,
 *    bad otherwise. Autopilot is offered for a stratum only when it is certified, 90% confident that at
 *    most 10% of sends would need edits, on at least 20 of the person's own labels with a flat prior.
 *    Spot checks keep labels coming after graduation; an anytime-valid e-process, a streak of
 *    cancelled sends, or a run of edits demotes it; counts decay with a 90-day half-life.
 *
 * 2. Lessons from edits (PRELUDE/CIPHER, Gao et al. 2024; refined by PROSE 2025): the model infers
 *    durable preferences from the difference between a draft and what the person sent. A lesson
 *    applies once seen twice or confirmed. Drafting also gets the person's own most similar emails as
 *    examples, which in PROSE's benchmark did far better than lessons alone.
 *
 * 3. Outreach experiments: Thompson sampling over opening angles and send slots. Rewards are human,
 *    non-negative replies (auto-replies excluded, opt-outs count against the angle). Pending sends count
 *    as a fraction of a failure by how long they have waited (Vernade et al. 2017), so the engine
 *    learns without a two-week lag. A new account starts from an empirical-Bayes prior fitted to other
 *    accounts. 10% of decisions explore uniformly and every decision logs its propensity, so policies
 *    can be evaluated offline (Li et al. 2011; Dudík et al. 2011).
 *
 * Only a person's own decisions train trust and lessons; autopilot never grades its own work. Every
 * signal is logged in crm_learning_events.
 */

async function event(userId: string, e: { draftId?: number | null; loop: string; key: string; outcome: string; editRatio?: number | null; reward?: number | null }) {
  await requireDb().insert(schema.crmLearningEvents).values({ userId, draftId: e.draftId ?? null, loop: e.loop, key: e.key, outcome: e.outcome, editRatio: e.editRatio ?? null, reward: e.reward ?? null });
}

/* ---------------- Loop 1: earned autonomy ---------------- */

const decayed = (col: unknown) => sql`${col} * power(0.5, greatest(0, extract(epoch from now() - ${schema.crmTrust.updatedAt})) / ${TRUST.halfLifeDays * 86400})`;

/** Add one label to a stratum: decay what was there, add the new label, advance the e-process. */
async function label(userId: string, bucket: string, good: boolean, opts: { unchanged: boolean; cancel?: boolean }) {
  const g = good ? 1 : 0, b = good ? 0 : 1;
  const eFactor = eStep(1, !good);
  await requireDb().insert(schema.crmTrust).values({
    userId, bucket, good: g, bad: b, observations: 1, unchanged: opts.unchanged ? 1 : 0, eprocess: eFactor, cancelStreak: opts.cancel ? 1 : 0,
  }).onConflictDoUpdate({
    target: [schema.crmTrust.userId, schema.crmTrust.bucket],
    set: {
      good: sql`${decayed(schema.crmTrust.good)} + ${g}`,
      bad: sql`${decayed(schema.crmTrust.bad)} + ${b}`,
      observations: sql`${schema.crmTrust.observations} + 1`,
      unchanged: sql`${schema.crmTrust.unchanged} + ${opts.unchanged ? 1 : 0}`,
      eprocess: sql`least(1e6, ${schema.crmTrust.eprocess} * ${eFactor})`,
      cancelStreak: opts.cancel ? sql`${schema.crmTrust.cancelStreak} + 1` : sql`0`,
      updatedAt: new Date(),
    },
  });
}

/**
 * Learn from a draft a person just sent. Runs after the response (next/server `after`), so the Send
 * button never waits on it. Autopilot's own sends, drafts written before the engine existed, and
 * anything already counted are skipped.
 */
export async function learnFromSend(userId: string, draftId: number, signature: string, infer: InferLessons = inferLessons): Promise<{ scored: Scored | null; lessons: number }> {
  const db = requireDb();
  const [d] = await db.update(schema.crmDrafts).set({ learned: true })
    .where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "sent"),
      eq(schema.crmDrafts.sentBy, "you"), eq(schema.crmDrafts.learned, false), ne(schema.crmDrafts.originalBody, ""))).returning();
  if (!d) return { scored: null, lessons: 0 };

  const sig = signature.trim();
  const final = sig && d.body.trimEnd().endsWith(sig) ? d.body.trimEnd().slice(0, -sig.length) : d.body;
  const ratio = editRatio(d.originalBody, final);
  const scored = scoreSend(ratio, criticalChange(d.originalBody, final));
  const bucket = bucketOf(d);
  await label(userId, bucket, scored.good, { unchanged: scored.outcome === "unchanged" });
  await event(userId, { draftId: d.id, loop: "trust", key: bucket, outcome: scored.outcome, editRatio: ratio, reward: scored.good ? 1 : 0 });

  // Any real edit carries a preference, a full rewrite often the clearest. The lesson model itself
  // declines to generalise from changes that only fix this one email's facts.
  const lessons = ratio > 0.05 ? await learnLessons(userId, d.id, contextOf(d), d.originalBody, final, infer).catch(() => 0) : 0;
  return { scored, lessons };
}

/** The person stopped an automatic send during its hold: a bad label, and a step towards demotion. */
export async function recordCancel(userId: string, d: DraftLike & { id: number }): Promise<void> {
  const bucket = bucketOf(d);
  await label(userId, bucket, false, { unchanged: false, cancel: true });
  await event(userId, { draftId: d.id, loop: "trust", key: bucket, outcome: "cancelled", reward: 0 });
}

async function trustRow(userId: string, bucket: string) {
  const [row] = await requireDb().select().from(schema.crmTrust).where(and(eq(schema.crmTrust.userId, userId), eq(schema.crmTrust.bucket, bucket)));
  return row ?? null;
}

/**
 * Autopilot's trust check for one draft: a reason to hand it to the person when this stratum is on
 * probation, or when this send is picked for a spot check; null when it may go.
 */
export async function trustGate(userId: string, d: DraftLike, rng: () => number = Math.random): Promise<string | null> {
  const row = await trustRow(userId, bucketOf(d));
  if (row) {
    const t = trustState(row);
    if (t.state === "probation") return `this kind of email is on probation: ${t.reason}, so autopilot waits for you until drafts improve`;
  }
  // Spot checks apply from the first send, so a person who switches autopilot on early still teaches it.
  const observations = row?.observations ?? 0;
  const override = process.env.AUTOPILOT_SPOT_CHECK_RATE;
  const rate = override != null && override !== "" ? Number(override) : auditRate(observations);
  if (rng() < rate) return `spot check: autopilot asks you to review about ${observations < TRUST.matureLabels ? "1 in 5" : "1 in 20"} of these so it keeps learning from you`;
  return null;
}

/** When the person accepts a graduation, the demotion evidence starts over. */
export async function resetDemotion(userId: string, scope: AutonomyScope): Promise<void> {
  const rows = await requireDb().select().from(schema.crmTrust).where(eq(schema.crmTrust.userId, userId));
  const ids = rows.filter((r) => scopeOfBucket(r.bucket) === scope).map((r) => r.id);
  if (ids.length) await requireDb().update(schema.crmTrust).set({ eprocess: 1, cancelStreak: 0 }).where(inArray(schema.crmTrust.id, ids));
}

/* ---------------- Loop 2: lessons from edits, and the person's own examples ---------------- */

const LessonResult = z.object({
  lessons: z.array(z.object({
    rule: z.string().describe("one durable preference as an imperative rule for future drafts, e.g. 'Never give a timeline in a first reply' or 'Sign off with just the first name'"),
    same_as: z.number().nullable().describe("the id of a known lesson that states this same preference, even in other words; null when the preference is new"),
  })).describe("zero to three, one per preference; empty when the edits only correct facts specific to this one email"),
});

const LESSON_SYSTEM = `You compare an email draft an assistant wrote with the version the person actually sent, and infer what the person prefers so future drafts need fewer edits.

Rules:
- Infer durable preferences about tone, length, structure, what to include or leave out, how to open and close. Not one-off facts ("the meeting is on Tuesday"), and never a price, number or commitment.
- Each lesson is one short imperative rule that would apply to other emails of this kind.
- Only infer what the edits clearly show. Return an empty list when the edits are small factual corrections or when no pattern is visible.
- You are shown the lessons already known for this kind of email, with their ids. When the edit shows a preference a known lesson already states, even in different words, return that lesson's id in same_as and its rule unchanged. Only a preference no known lesson covers is new.
- One lesson per preference: never return two lessons that say the same thing.`;

export type KnownLesson = { id: number; rule: string };
export type InferredLesson = { rule: string; sameAs: number | null };
export type InferLessons = (userId: string, context: string, original: string, final: string, known: KnownLesson[]) => Promise<InferredLesson[]>;

/**
 * Ask the model what an edit says about the person's preferences. It sees only the draft, the
 * person's own words, and the lessons already known, so a preference restated in new words is
 * matched to its lesson by id rather than learned twice.
 */
export const inferLessons: InferLessons = async (userId, context, original, final, known) => {
  const ctx = await loadUserContext(userId);
  const knownText = known.length ? known.map((k) => `#${k.id}: ${k.rule}`).join("\n") : "(none yet)";
  const { data } = await structured(LessonResult, "edit_lessons", LESSON_SYSTEM,
    `Context: ${context}\n\n--- Known lessons ---\n${knownText}\n\n--- The assistant's draft ---\n${original.slice(0, 4000)}\n\n--- What the person sent ---\n${final.slice(0, 4000)}`, { prefs: ctx.prefs, task: "extract" });
  return data.lessons.map((l) => ({ rule: l.rule, sameAs: l.same_as }));
};

/**
 * Infer lessons from one edit and merge them into the person's lessons, reinforcing repeats. The
 * inference is injectable so the merge logic can be tested without a model.
 */
export async function learnLessons(userId: string, draftId: number, context: string, original: string, final: string, infer: InferLessons = inferLessons): Promise<number> {
  const db = requireDb();
  const existing = await db.select().from(schema.crmLessons).where(and(eq(schema.crmLessons.userId, userId), eq(schema.crmLessons.active, true)))
    .orderBy(desc(schema.crmLessons.evidence), desc(schema.crmLessons.updatedAt));
  const applies = (e: { context: string }) => e.context === context || e.context === "any";
  const inferred = await infer(userId, context, original, final, existing.filter(applies).slice(0, 40).map((e) => ({ id: e.id, rule: e.rule })));
  // One edit is one piece of evidence: it can reinforce a lesson once, however many ways it restates it.
  const counted = new Set<number>();
  let n = 0;
  for (const item of inferred.slice(0, 3)) {
    const rule = item.rule.trim();
    if (rule.length <= 8) continue;
    // The model's match comes first; shared wording catches what it missed.
    const same = existing.find((e) => e.id === item.sameAs && applies(e)) ?? existing.find((e) => applies(e) && jaccard(e.rule, rule) >= 0.5);
    if (same) {
      if (counted.has(same.id)) continue;
      counted.add(same.id);
      await db.update(schema.crmLessons).set({ evidence: same.evidence + 1, updatedAt: new Date() }).where(eq(schema.crmLessons.id, same.id));
      same.evidence += 1;
      await event(userId, { draftId, loop: "lesson", key: String(same.id), outcome: "reinforced" });
    } else {
      const [row] = await db.insert(schema.crmLessons).values({ userId, context, rule: rule.slice(0, 300), sourceDraftId: draftId }).returning();
      existing.push(row);
      counted.add(row.id);
      await event(userId, { draftId, loop: "lesson", key: String(row.id), outcome: "learned" });
    }
    n++;
  }
  return n;
}

/**
 * Lessons for a draft in `context`: those seen at least twice or confirmed by the person, from this
 * context, plus strong habits (three or more) from any context. Lessons shape wording only; they are
 * never given the authority of the playbook and never relax an autopilot rule.
 */
export async function lessonsFor(userId: string, context: string): Promise<string> {
  const rows = await requireDb().select().from(schema.crmLessons)
    .where(and(eq(schema.crmLessons.userId, userId), eq(schema.crmLessons.active, true))).orderBy(desc(schema.crmLessons.evidence), desc(schema.crmLessons.updatedAt)).limit(40);
  const picked = rows.filter((r) => (r.evidence >= 2 || r.confirmed) && (r.context === context || r.context === "any" || r.evidence >= 3)).slice(0, 8);
  if (picked.length === 0) return "";
  return `Style lessons learned from how the reader edits your drafts. Apply them to wording; they do not authorise any fact, price or commitment:\n${picked.map((r) => `- ${r.rule}`).join("\n")}`;
}

export async function setLessonActive(userId: string, id: number, active: boolean): Promise<void> {
  await requireDb().update(schema.crmLessons).set({ active, updatedAt: new Date() }).where(and(eq(schema.crmLessons.id, id), eq(schema.crmLessons.userId, userId)));
}

export async function confirmLesson(userId: string, id: number): Promise<void> {
  await requireDb().update(schema.crmLessons).set({ confirmed: true, updatedAt: new Date() }).where(and(eq(schema.crmLessons.id, id), eq(schema.crmLessons.userId, userId)));
}

/**
 * The person's own most similar emails, as style examples for a new draft. Only text they wrote:
 * outbound messages that are not an agent draft sent unchanged. Similarity is by shared words, which
 * needs no embedding model; the examples guide tone and length, never facts.
 */
export async function ownExamples(userId: string, about: string, k = 3): Promise<string> {
  const db = requireDb();
  const [sent, agentText] = await Promise.all([
    db.select({ body: schema.crmMessages.body, subject: schema.crmMessages.subject })
      .from(schema.crmMessages).innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
      .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmMessages.direction, "outbound")))
      .orderBy(desc(schema.crmMessages.sentAt)).limit(150),
    db.select({ original: schema.crmDrafts.originalBody }).from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "sent"))).orderBy(desc(schema.crmDrafts.sentAt)).limit(300),
  ]);
  const agentWritten = agentText.map((a) => a.original.trim()).filter(Boolean);
  const mine = sent.filter((m) => m.body.trim().length > 40 && !agentWritten.some((a) => m.body.includes(a) || editRatio(a, m.body) <= 0.05));
  const ranked = mine.map((m) => ({ m, s: jaccard(about, `${m.subject} ${m.body}`) })).sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0.02);
  if (ranked.length === 0) return "";
  return `Emails the reader wrote themselves, for tone and length only. Match how they write; take no facts from these:\n${ranked.map(({ m }, i) => `--- Example ${i + 1} ---\n${m.body.slice(0, 900)}`).join("\n\n")}`;
}

/* ---------------- Loop 3: outreach experiments ---------------- */

const ARMS: Record<"angle" | "hour", readonly string[]> = { angle: Object.keys(ANGLES), hour: Object.keys(HOURS) };
/** How strongly the crowd's rate shapes a new account's prior, in pseudo-sends. */
const CROWD_STRENGTH = 20;
/** Share of decisions made uniformly at random, for exploration and unbiased offline evaluation. */
export const EXPLORE = 0.1;

type ArmPost = Posterior & { pulls: number; rewards: number; negatives: number; pending: number; prior: Posterior; crowdRate: number | null };

/**
 * Each arm's posterior: an empirical-Bayes prior from everyone else's settled outcomes on that arm
 * (leave-one-user-out, once there are 30 or more), updated with this person's own settled replies and
 * non-replies, and with each still-pending send counted as the fraction of a failure its waiting time
 * implies.
 */
export async function armPosteriors(userId: string, dimension: "angle" | "hour", tz = "UTC"): Promise<Record<string, ArmPost>> {
  const db = requireDb();
  const [own, crowd, pending] = await Promise.all([
    db.select().from(schema.crmArms).where(and(eq(schema.crmArms.userId, userId), eq(schema.crmArms.dimension, dimension))),
    db.select({ arm: schema.crmArms.arm, pulls: sql<number>`sum(${schema.crmArms.pulls})`, rewards: sql<number>`sum(${schema.crmArms.rewards})` })
      .from(schema.crmArms).where(and(eq(schema.crmArms.dimension, dimension), ne(schema.crmArms.userId, userId))).groupBy(schema.crmArms.arm),
    db.select({ variant: schema.crmDrafts.variant, sentAt: schema.crmDrafts.sentAt }).from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.kind, "campaign"), eq(schema.crmDrafts.status, "sent"), eq(schema.crmDrafts.learned, false),
        isNotNull(schema.crmDrafts.sentAt), sql`coalesce((${schema.crmDrafts.meta}->>'step')::int, 0) = 0`)).limit(500),
  ]);
  const pendingBy: Record<string, number> = {};
  for (const p of pending) {
    const v = parseVariant(p.variant);
    const arm = dimension === "angle" ? v.angle : v.hour ?? hourSlotOf(p.sentAt!, tz);
    if (arm) pendingBy[arm] = (pendingBy[arm] ?? 0) + replyArrived((Date.now() - p.sentAt!.getTime()) / 3_600_000);
  }
  // An arm nobody has tried yet is centred on the pooled rate across all arms and accounts, not on a
  // flat prior whose 50% mean would dwarf real reply rates and claim a chance of being best it has not earned.
  const allPulls = own.reduce((n, r) => n + r.pulls, 0) + crowd.reduce((n, r) => n + Number(r.pulls), 0);
  const allRewards = own.reduce((n, r) => n + r.rewards, 0) + crowd.reduce((n, r) => n + Number(r.rewards), 0);
  const pooledRate = allPulls >= 30 ? allRewards / allPulls : null;
  const out: Record<string, ArmPost> = {};
  for (const arm of ARMS[dimension]) {
    const c = crowd.find((x) => x.arm === arm);
    const crowdRate = c && Number(c.pulls) >= 30 ? Number(c.rewards) / Number(c.pulls) : pooledRate;
    const prior = populationPrior(crowdRate, CROWD_STRENGTH);
    const mine = own.find((x) => x.arm === arm);
    const pulls = mine?.pulls ?? 0, rewards = mine?.rewards ?? 0, negatives = mine?.negatives ?? 0;
    const waiting = pendingBy[arm] ?? 0;
    out[arm] = { alpha: prior.alpha + rewards, beta: prior.beta + Math.max(0, pulls - rewards) + waiting, pulls, rewards, negatives, pending: waiting, prior, crowdRate };
  }
  return out;
}

export type ArmChoice<A extends string> = { arm: A; propensity: number; explore: boolean };

/**
 * Choose an arm among those available: with probability EXPLORE uniformly, otherwise by Thompson
 * sampling. The propensity (the chance this arm had of being chosen) is estimated from posterior
 * draws and returned for logging.
 */
export async function chooseArm<A extends string>(userId: string, dimension: "angle" | "hour", available?: readonly A[], rng: () => number = Math.random): Promise<ArmChoice<A>> {
  const all = await armPosteriors(userId, dimension);
  const keys = (available ?? (Object.keys(all) as A[])).filter((k) => all[k]);
  const posts = Object.fromEntries(keys.map((k) => [k, { alpha: all[k].alpha, beta: all[k].beta }])) as Record<A, Posterior>;
  const pBest = probabilityBest(posts, 1000);
  const explore = rng() < EXPLORE;
  const arm = explore ? keys[Math.floor(rng() * keys.length) % keys.length] : thompson(posts, rng).arm;
  return { arm, explore, propensity: EXPLORE / keys.length + (1 - EXPLORE) * (pBest[arm] ?? 0) };
}

/** Angles available for a lead: the always-on ones, plus "why now" when their Form D is fresh. */
export function availableAngles(directory: { listedIn?: string; listedOn?: string } | null, now = Date.now()): Angle[] {
  const fresh = directory?.listedIn === "formd" && directory.listedOn && now - new Date(directory.listedOn).getTime() < 90 * 86_400_000;
  return (Object.keys(ANGLES) as Angle[]).filter((a) => !SLEEPING_ANGLES.includes(a) || (a === "why_now" && fresh));
}

async function resolveArm(userId: string, dimension: "angle" | "hour", arm: string, outcome: "positive" | "negative" | "none", draftId: number) {
  if (!ARMS[dimension].includes(arm)) return;
  const reward = outcome === "positive" ? 1 : 0, negative = outcome === "negative" ? 1 : 0;
  const d = sql`power(0.5, greatest(0, extract(epoch from now() - ${schema.crmArms.updatedAt})) / ${TRUST.halfLifeDays * 86400})`;
  await requireDb().insert(schema.crmArms).values({ userId, dimension, arm, pulls: 1, rewards: reward, negatives: negative })
    .onConflictDoUpdate({
      target: [schema.crmArms.userId, schema.crmArms.dimension, schema.crmArms.arm],
      set: {
        pulls: sql`${schema.crmArms.pulls} * ${d} + 1`, rewards: sql`${schema.crmArms.rewards} * ${d} + ${reward}`,
        negatives: sql`${schema.crmArms.negatives} * ${d} + ${negative}`, updatedAt: new Date(),
      },
    });
  await event(userId, { draftId, loop: "arm", key: `${dimension}:${arm}`, outcome: outcome === "positive" ? "replied" : outcome === "negative" ? "opted_out" : "no_reply", reward });
}

/**
 * Settle a campaign's first-touch emails. A human reply that did not opt out rewards the email's angle
 * and send slot; an opt-out counts against them; an email that waited out the reply window without an
 * answer is a plain failure. Each email is settled exactly once. Until then it counts as a fractional
 * failure in armPosteriors.
 */
export async function settleOutreach(userId: string, tz: string): Promise<{ replied: number; negative: number; unanswered: number }> {
  const db = requireDb();
  const out = { replied: 0, negative: 0, unanswered: 0 };
  const firsts = await db.select({ draft: schema.crmDrafts, lead: schema.crmCampaignLeads })
    .from(schema.crmDrafts).innerJoin(schema.crmCampaignLeads, eq(schema.crmCampaignLeads.id, schema.crmDrafts.campaignLeadId))
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.kind, "campaign"), eq(schema.crmDrafts.status, "sent"),
      eq(schema.crmDrafts.learned, false), isNotNull(schema.crmDrafts.sentAt), sql`coalesce((${schema.crmDrafts.meta}->>'step')::int, 0) = 0`))
    .limit(200);
  const windowMs = REPLY_WINDOW_DAYS * 86_400_000;
  for (const { draft, lead } of firsts) {
    const answered = !!lead.repliedAt && lead.repliedAt.getTime() - draft.sentAt!.getTime() <= windowMs;
    const optedOut = lead.status === "opted_out" && (!lead.repliedAt || answered);
    if (!answered && !optedOut && Date.now() - draft.sentAt!.getTime() < windowMs) continue; // still waiting
    const [claimed] = await db.update(schema.crmDrafts).set({ learned: true })
      .where(and(eq(schema.crmDrafts.id, draft.id), eq(schema.crmDrafts.learned, false))).returning({ id: schema.crmDrafts.id });
    if (!claimed) continue;
    const outcome = optedOut ? "negative" : answered ? "positive" : "none";
    const v = parseVariant(draft.variant);
    if (v.angle) await resolveArm(userId, "angle", v.angle, outcome, draft.id);
    await resolveArm(userId, "hour", v.hour ?? hourSlotOf(draft.sentAt!, tz), outcome, draft.id);
    out[outcome === "positive" ? "replied" : outcome === "negative" ? "negative" : "unanswered"]++;
  }
  return out;
}

/* ---------------- What the person sees ---------------- */

const CATEGORY_WORD: Record<string, string> = {
  prospect: "prospects", customer: "customers", partner: "partners", colleague: "coworkers", founder_pitch: "founder pitches",
  intro_request: "intro requests", lp_investor: "investors", scheduling: "scheduling", diligence_material: "diligence", other: "other email",
};
const BUCKET_LABEL = (bucket: string) => {
  const [kind, audience, category] = bucket.split(":");
  if (kind === "reply") return audience === "internal" ? "Replies to coworkers" : `Replies about ${CATEGORY_WORD[category] ?? category}`;
  if (kind === "campaign") return audience === "first" ? "First campaign emails" : "Campaign follow-ups";
  return ({ follow_up: "Follow-ups", nurture: "Reconnections", compose: "New emails" } as Record<string, string>)[kind] ?? kind;
};

export async function engineOverview(userId: string, autonomy: Record<AutonomyScope, string>) {
  const db = requireDb();
  const [trustRows, lessons, angles, hours, recent, autoWeek] = await Promise.all([
    db.select().from(schema.crmTrust).where(eq(schema.crmTrust.userId, userId)).orderBy(desc(schema.crmTrust.observations)),
    db.select().from(schema.crmLessons).where(and(eq(schema.crmLessons.userId, userId), eq(schema.crmLessons.active, true))).orderBy(desc(schema.crmLessons.evidence), desc(schema.crmLessons.updatedAt)).limit(30),
    armPosteriors(userId, "angle"),
    armPosteriors(userId, "hour"),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmLearningEvents).where(and(eq(schema.crmLearningEvents.userId, userId), gte(schema.crmLearningEvents.createdAt, new Date(Date.now() - 30 * 86_400_000)))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.sentBy, "autopilot"), gte(schema.crmDrafts.sentAt, new Date(Date.now() - 7 * 86_400_000)))),
  ]);
  const trust = trustRows.map((r) => {
    const t = trustState(r);
    return { bucket: r.bucket, label: BUCKET_LABEL(r.bucket), observations: r.observations, unchanged: r.unchanged, ...t, scope: scopeOfBucket(r.bucket) };
  });
  const suggestions = trust
    .filter((t) => t.state === "trusted" && t.scope && autonomy[t.scope] !== "auto")
    .map((t) => ({
      scope: t.scope!, bucket: t.bucket,
      text: `${t.label}: ${t.unchanged} of your last ${t.observations} went out exactly as the agent wrote them. On that record we are 90% confident at most ${Math.max(1, Math.ceil(t.certifiedBadRate * 100))}% would need your edits. Put this kind on autopilot? About 1 in 5 will still come to you as a spot check.`,
    }));
  const arm = (posts: Record<string, ArmPost>, labels: Record<string, { label: string }>) => {
    // A sleeping arm that has never been used is left out of the ranking: its prior alone says nothing about this person's audience.
    const ranked = Object.entries(posts).filter(([k, v]) => !(SLEEPING_ANGLES as string[]).includes(k) || v.pulls > 0 || v.pending > 0);
    const best = probabilityBest(Object.fromEntries(ranked.map(([k, v]) => [k, { alpha: v.alpha, beta: v.beta }])), 2000);
    return Object.entries(posts).map(([k, v]) => ({
      arm: k, label: labels[k]?.label ?? k, pulls: v.pulls, rewards: v.rewards, negatives: v.negatives, pending: v.pending, mean: mean(v),
      lower: betaQuantile(0.05, v.alpha, v.beta), upper: betaQuantile(0.95, v.alpha, v.beta), pBest: k in best ? best[k] : null, crowdRate: v.crowdRate,
    }));
  };
  // The error budget: at the certified bad rate, how many of last week's automatic sends could have needed edits.
  const worst = trust.filter((t) => t.state === "trusted").reduce((m, t) => Math.max(m, t.certifiedBadRate), 0);
  return {
    trust, suggestions, lessons, angles: arm(angles, ANGLES), hours: arm(hours, HOURS), signals30d: recent[0]?.n ?? 0,
    errorBudget: { autoSends7d: autoWeek[0]?.n ?? 0, worstCertifiedBadRate: worst },
  };
}

export type { Angle, HourSlot };
