/**
 * Limits on model spend, checked before every model call:
 * - AI_DISABLED=1 turns every model call off (the app keeps working without AI);
 * - AI_GLOBAL_DAILY_USD ($200 by default) caps everyone's spend per UTC day, background work included;
 * - each person's spend is capped per UTC day and per calendar month (UTC) by their plan's AI allowance
 *   (src/lib/billing/plans.ts: Free $1.50 a day and $5 a month, up to Enterprise), except administrators
 *   (ADMIN_EMAILS), who have none. AI_USER_DAILY_USD and AI_USER_MONTHLY_USD, when set, replace the
 *   plan amounts for everyone: the operator's lever when spend climbs;
 * - a person runs at most two long AI runs (chat, tools, the Studio agent) at once, so parallel runs
 *   cannot all start under the cap.
 * Spend is read from the usage ledger and cached briefly per instance; calls the ledger has not caught
 * up with are added as they happen (noteAiSpend), and long runs add their running cost between turns.
 * The plan is read once a minute per person, from the subscription and the profile's email (Campus
 * needs it), so background runs that carry no session (autopilot, the agent cron) get the same caps.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { entitlements } from "@/lib/billing/entitlements";
import { PLANS, planAtLeast, type PlanId } from "@/lib/billing/plans";
import { lease, type Release } from "@/lib/locks";
import { aiAdmin } from "./context";

export class AiLimitError extends Error {
  /** Read by `guarded()` so these surface as 429 rather than 500. */
  readonly status = 429;
  constructor(message: string) { super(message); this.name = "AiLimitError"; }
}

/** A dollar amount from the environment, or null when unset or not a number. */
const envUsd = (name: string): number | null => {
  const v = process.env[name];
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};
/** A person's daily AI cap on `plan`: AI_USER_DAILY_USD when set, else the plan's allowance. */
export const userDailyUsd = (plan: PlanId = "free") => envUsd("AI_USER_DAILY_USD") ?? PLANS[plan].ai.dailyUsd;
/** A person's monthly AI cap on `plan`: AI_USER_MONTHLY_USD when set, else the plan's allowance. */
export const userMonthlyUsd = (plan: PlanId = "free") => envUsd("AI_USER_MONTHLY_USD") ?? PLANS[plan].ai.monthlyUsd;
export const globalDailyUsd = () => envUsd("AI_GLOBAL_DAILY_USD") ?? 200;
export const aiDisabled = () => /^(1|true|yes|on)$/i.test(process.env.AI_DISABLED?.trim() ?? "");

export const PAUSED = "AI features are paused right now. Everything else keeps working.";
const USER_CAP = "You have reached today's AI limit. It resets at midnight UTC.";
const GLOBAL_CAP = "AI features have reached today's limit and come back at midnight UTC. Everything else keeps working.";
const BUSY = "You already have two AI runs going. Wait for one to finish, then try again.";

/** The message for a person at their monthly allowance. Pure, for tests. */
export function monthCapMessage(plan: PlanId, now = new Date()): string {
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });
  const more = planAtLeast(plan, "enterprise") ? "" : " Larger plans, in Settings under Plan, include more.";
  return `You have used this month's AI allowance on the ${PLANS[plan].name} plan. It resets on ${resets}.${more}`;
}

const DAY_MS = 86_400_000;
const USER_TTL_MS = 20_000, GLOBAL_TTL_MS = 60_000, PLAN_TTL_MS = 60_000;
type Period = "day" | "month";
/** The current period's key (UTC day number, or year*12+month) and when it began. */
function period(p: Period, now = new Date()): { key: number; since: Date } {
  if (p === "day") { const key = Math.floor(now.getTime() / DAY_MS); return { key, since: new Date(key * DAY_MS) }; }
  return { key: now.getUTCFullYear() * 12 + now.getUTCMonth(), since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
}
type Memo = { key: number; usd: number; at: number };
const memos: Record<Period, Map<string, Memo>> = { day: new Map(), month: new Map() };
let everyone: Memo | null = null;

/** This period's spend for one person, or today's for everyone when `userId` is null. */
async function spent(userId: string | null, p: Period = "day"): Promise<number> {
  const { key, since } = period(p);
  const memo = userId ? memos[p].get(userId) : everyone;
  if (memo && memo.key === key && Date.now() - memo.at < (userId ? USER_TTL_MS : GLOBAL_TTL_MS)) return memo.usd;
  const where = userId ? and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, since)) : gte(schema.aiUsage.createdAt, since);
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float` }).from(schema.aiUsage).where(where);
  // The ledger can trail spend noted here moments ago (its writes land after the response).
  const next = { key, usd: Math.max(Number(r?.usd ?? 0), memo?.key === key ? memo.usd : 0), at: Date.now() };
  if (userId) {
    if (memos[p].size > 5_000) memos[p].clear();
    memos[p].set(userId, next);
  } else everyone = next;
  return next.usd;
}

/** Count spend now, before the ledger row lands. */
export function noteAiSpend(userId: string | null, cost: number) {
  if (!Number.isFinite(cost) || cost <= 0) return;
  const day = period("day").key;
  if (everyone?.key === day) everyone.usd += cost;
  if (!userId) return;
  for (const p of ["day", "month"] as Period[]) {
    const m = memos[p].get(userId);
    if (m?.key === period(p).key) m.usd += cost;
  }
}

/** A person's plan and caps; null caps mean none (administrators). */
export type AiCaps = { plan: PlanId; admin: boolean; dailyUsd: number | null; monthlyUsd: number | null };
const plans = new Map<string, { at: number; caps: AiCaps }>();

/**
 * The caps for one person, read at most once a minute per instance. The email comes from the profile,
 * so work without a session (crons, Inngest) finds Campus and administrators too. When the lookup fails
 * the Free caps apply; the spend reads fail the same way and do not block, so nobody is locked out.
 */
export async function aiCaps(userId: string): Promise<AiCaps> {
  const hit = plans.get(userId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.caps;
  let plan: PlanId = "free", admin = false, ok = true;
  try {
    const [p] = await requireDb().select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
    const e = await entitlements({ id: userId, email: p?.email ?? "" });
    plan = e.plan; admin = e.admin;
  } catch { ok = false; /* Free caps; see above */ }
  const caps: AiCaps = { plan, admin, dailyUsd: admin ? null : userDailyUsd(plan), monthlyUsd: admin ? null : userMonthlyUsd(plan) };
  // A failed lookup is not remembered, so a paying person is not held to Free's caps for a minute after a blip.
  if (!ok) return caps;
  if (plans.size > 5_000) plans.clear();
  plans.set(userId, { at: Date.now(), caps });
  return caps;
}

/** Forget a person's cached plan (after billing changes it), so the next call reads it fresh on this instance. */
export function forgetAiCaps(userId: string) {
  plans.delete(userId);
}

/** What a person has spent and may spend, for the plan page. */
export async function aiAllowance(userId: string, admin = false): Promise<AiCaps & { todayUsd: number; monthUsd: number }> {
  const [caps, todayUsd, monthUsd] = await Promise.all([aiCaps(userId), spent(userId, "day").catch(() => 0), spent(userId, "month").catch(() => 0)]);
  return admin ? { ...caps, admin: true, dailyUsd: null, monthlyUsd: null, todayUsd, monthUsd } : { ...caps, todayUsd, monthUsd };
}

/**
 * Why a model call may not run now, or null when it may. `pendingUsd` is spend the caller has made
 * but not recorded yet (a long run's turns so far). A ledger that does not answer does not block.
 */
export async function aiBlocked(userId: string | null, pendingUsd = 0): Promise<string | null> {
  if (aiDisabled()) return PAUSED;
  const personal = userId && !aiAdmin() ? userId : null;
  // Everyone's spend does not depend on the plan, so it is read while the plan is looked up.
  const everyoneSpent = spent(null).catch(() => 0);
  const caps = personal ? await aiCaps(personal) : null;
  const capped = caps && !caps.admin ? personal : null;
  const [all, mine, mineMonth] = await Promise.all([
    everyoneSpent,
    capped ? spent(capped, "day").catch(() => 0) : Promise.resolve(null),
    capped ? spent(capped, "month").catch(() => 0) : Promise.resolve(null),
  ]);
  return blockedAt({
    disabled: false, everyone: all, mine, mineMonth, pending: pendingUsd, globalCap: globalDailyUsd(),
    userCap: caps?.dailyUsd ?? Infinity, monthCap: caps?.monthlyUsd ?? Infinity, plan: caps?.plan,
  });
}

/**
 * The decision, pure for tests: `mine` (and `mineMonth`) are null for work that runs for no one
 * (background passes) or for an administrator.
 */
export function blockedAt(s: { disabled: boolean; everyone: number; mine: number | null; pending: number; globalCap: number; userCap: number; mineMonth?: number | null; monthCap?: number; plan?: PlanId; now?: Date }): string | null {
  if (s.disabled) return PAUSED;
  if (s.everyone + s.pending >= s.globalCap) return GLOBAL_CAP;
  if (s.mine !== null && s.mine + s.pending >= s.userCap) return USER_CAP;
  if (s.mineMonth != null && s.monthCap !== undefined && s.mineMonth + s.pending >= s.monthCap) return monthCapMessage(s.plan ?? "free", s.now);
  return null;
}

/** Throw an AiLimitError (429) when a model call may not run now. */
export async function guardAi(userId: string | null, pendingUsd = 0): Promise<void> {
  const why = await aiBlocked(userId, pendingUsd);
  if (why) throw new AiLimitError(why);
}

/** Chat input sizes: enough for a pasted filing excerpt, not a megabyte on every turn. */
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_HISTORY_CHARS = 100_000;

/**
 * A conversation cut to size: each earlier message capped, then the oldest dropped until the whole fits,
 * starting on a person's message (Claude requires it). The newest message is kept whole; callers
 * reject it first when it is itself too long.
 */
export function fitMessages<M extends { role: "user" | "assistant"; content: string }>(messages: M[], perMessage = MAX_MESSAGE_CHARS, total = MAX_HISTORY_CHARS): M[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  const out: M[] = [last];
  let size = last.content.length;
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i].content.length > perMessage ? { ...messages[i], content: `${messages[i].content.slice(0, perMessage)}\n[…cut for length]` } : messages[i];
    if (size + m.content.length > total) break;
    size += m.content.length;
    out.unshift(m);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}

/** Longer than any route's 300 s limit, so a run whose function died frees its slot. */
const RUN_LEASE_MS = 330_000;
export const RUN_SLOTS = 2;

/**
 * Take one of a person's run slots for a long AI run. Returns the release, or a message when both
 * slots are busy. Work with no person (background passes) takes no slot.
 */
export async function takeRunSlot(userId: string | null): Promise<Release | string> {
  if (!userId) return async () => undefined;
  for (let i = 1; i <= RUN_SLOTS; i++) {
    const release = await lease(`ai-run:${userId}:${i}`, RUN_LEASE_MS);
    if (release) return release;
  }
  return BUSY;
}
