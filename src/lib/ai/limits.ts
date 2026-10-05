/**
 * Limits on model spend, checked before every model call:
 * - AI_DISABLED=1 turns every model call off (the app keeps working without AI);
 * - AI_GLOBAL_DAILY_USD ($200 by default) caps everyone's spend per UTC day, background work included;
 * - each person's spend is capped per UTC day and per allowance month by their plan's AI allowance
 *   (src/lib/billing/plans.ts: Free $0.75 a day and $3 a month, up to Enterprise), except administrators
 *   (ADMIN_EMAILS), who have none. The allowance month runs from the billing anniversary for someone with
 *   a subscription or an assigned seat, and from the 1st (UTC) otherwise. AI_USER_DAILY_USD and
 *   AI_USER_MONTHLY_USD, when set, replace the plan amounts for everyone: the operator's lever;
 * - once the month's allowance is used, AI credit packs (src/lib/billing/packs.ts) carry on until they
 *   are used up: the allowance first, then credits, oldest pack first. While someone holds credits their
 *   daily cap is at least CREDIT_DAILY_USD;
 * - a person runs at most two long AI runs (chat, tools, the Studio agent) at once, so parallel runs
 *   cannot all start under the cap.
 * Spend is read from the usage ledger and cached briefly per instance; calls the ledger has not caught
 * up with are added as they happen (noteAiSpend), and long runs add their running cost between turns.
 * The plan is read every 15 seconds per person (and dropped at once on this instance when billing changes
 * it), from the subscription, an assigned seat and the profile's email (Campus needs it), so background
 * runs that carry no session (autopilot, the agent cron) get the same caps.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { creditState, noteDraw, NO_CREDITS, packsLeft, type CreditState } from "@/lib/billing/credits";
import { entitlements } from "@/lib/billing/entitlements";
import { allowancePeriod, CREDIT_DAILY_USD, splitSpend, type Period } from "@/lib/billing/packs";
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

/**
 * The message for a person at their monthly allowance (and their credits, when they had some). `resetsOn`
 * is the end of their allowance period; without it, the next 1st. Pure, for tests.
 */
export function monthCapMessage(plan: PlanId, now = new Date(), resetsOn?: Date, hadCredits = false): string {
  const end = resetsOn ?? allowancePeriod(now).end;
  const date = end.toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });
  const used = hadCredits ? "this month's AI allowance and your AI credits" : "this month's AI allowance";
  const more = planAtLeast(plan, "enterprise") ? " An AI credit pack, in Settings under Plan, adds more now." : " An AI credit pack or a larger plan, in Settings under Plan, adds more now.";
  return `You have used ${used} on the ${PLANS[plan].name} plan. It resets on ${date}.${more}`;
}

/** The daily cap that applies: the plan's, raised to CREDIT_DAILY_USD while the person has credits left. Pure. */
export const dailyCapWith = (planDailyUsd: number, creditsLeftUsd: number) => (creditsLeftUsd > 0 ? Math.max(planDailyUsd, CREDIT_DAILY_USD) : planDailyUsd);

const DAY_MS = 86_400_000;
/** Spend is re-read from the ledger this often; plans and credits are re-read as often (billing also drops them at once). */
const USER_TTL_MS = 20_000, GLOBAL_TTL_MS = 60_000, PLAN_TTL_MS = 15_000, CREDIT_TTL_MS = 15_000;
type Window = "day" | "month";
const dayStart = (now = new Date()) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);

/** Spend memo: `key` is when its window began (ms), so a new day or allowance month reads afresh. */
type Memo = { key: number; usd: number; at: number };
const memos: Record<Window, Map<string, Memo>> = { day: new Map(), month: new Map() };
let everyone: Memo | null = null;

/** Spend since `since` for one person (in the day or month window), or today's for everyone when `userId` is null. */
async function spent(userId: string | null, w: Window, since: Date): Promise<number> {
  const key = since.getTime();
  const memo = userId ? memos[w].get(userId) : everyone;
  if (memo && memo.key === key && Date.now() - memo.at < (userId ? USER_TTL_MS : GLOBAL_TTL_MS)) return memo.usd;
  const where = userId ? and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, since)) : gte(schema.aiUsage.createdAt, since);
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float` }).from(schema.aiUsage).where(where);
  // The ledger can trail spend noted here moments ago (its writes land after the response).
  const next = { key, usd: Math.max(Number(r?.usd ?? 0), memo?.key === key ? memo.usd : 0), at: Date.now() };
  if (userId) {
    if (memos[w].size > 5_000) memos[w].clear();
    memos[w].set(userId, next);
  } else everyone = next;
  return next.usd;
}

/** Count spend now, before the ledger row lands. */
export function noteAiSpend(userId: string | null, cost: number) {
  if (!Number.isFinite(cost) || cost <= 0) return;
  const today = dayStart().getTime();
  if (everyone?.key === today) everyone.usd += cost;
  if (!userId) return;
  const d = memos.day.get(userId);
  if (d?.key === today) d.usd += cost;
  // A month memo from an earlier window is ignored when read (its key no longer matches), so adding is safe.
  const m = memos.month.get(userId);
  if (m) m.usd += cost;
}

/** A person's plan and caps; null caps mean none (administrators). `anchor` sets their allowance month. */
export type AiCaps = { plan: PlanId; admin: boolean; dailyUsd: number | null; monthlyUsd: number | null; anchor: Date | null };
const plans = new Map<string, { at: number; caps: AiCaps }>();

/**
 * The caps for one person, read at most every 15 seconds per instance. The email comes from the profile,
 * so work without a session (crons, Inngest) finds Campus and administrators too. When the lookup fails
 * the Free caps apply; the spend reads fail the same way and do not block, so nobody is locked out.
 */
export async function aiCaps(userId: string): Promise<AiCaps> {
  const hit = plans.get(userId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.caps;
  let plan: PlanId = "free", admin = false, ok = true, anchor: Date | null = null;
  try {
    const [p] = await requireDb().select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
    const e = await entitlements({ id: userId, email: p?.email ?? "" });
    plan = e.plan; admin = e.admin; anchor = e.anchor ? new Date(e.anchor) : null;
  } catch { ok = false; /* Free caps; see above */ }
  const caps: AiCaps = { plan, admin, dailyUsd: admin ? null : userDailyUsd(plan), monthlyUsd: admin ? null : userMonthlyUsd(plan), anchor };
  // A failed lookup is not remembered, so a paying person is not held to Free's caps after a blip.
  if (!ok) return caps;
  if (plans.size > 5_000) plans.clear();
  plans.set(userId, { at: Date.now(), caps });
  return caps;
}

const credits = new Map<string, { at: number; key: number; state: CreditState }>();

/** A person's credits for `period`, read at most every 15 seconds per instance. A failed read means none. */
async function creditsFor(userId: string, period: Period): Promise<CreditState> {
  const key = period.start.getTime();
  const hit = credits.get(userId);
  if (hit && hit.key === key && Date.now() - hit.at < CREDIT_TTL_MS) return hit.state;
  const state = await creditState(userId, period).catch(() => null);
  if (!state) return NO_CREDITS;
  if (credits.size > 5_000) credits.clear();
  credits.set(userId, { at: Date.now(), key, state });
  return state;
}

/**
 * Forget a person's cached plan and credits on this instance (billing calls it from the webhook, the
 * return from Checkout and seat changes), so the next call reads them fresh. Other instances catch up
 * within 15 seconds.
 */
export function forgetAiCaps(userId: string) {
  plans.delete(userId);
  credits.delete(userId);
}

/** The last credit use written per person and period, so a draw is only written when it grows by a cent. */
const drawn = new Map<string, number>();
function recordDraw(userId: string, period: Period, cap: number, available: number, spend: number) {
  const used = splitSpend(spend, cap, available).credits;
  const k = `${userId}:${period.start.getTime()}`;
  if (used <= 0 || used - (drawn.get(k) ?? 0) < 0.01) return;
  if (drawn.size > 5_000) drawn.clear();
  drawn.set(k, used);
  void noteDraw(userId, period, cap, available, spend).catch(() => drawn.delete(k));
}

export type AiAllowance = AiCaps & {
  todayUsd: number;
  monthUsd: number;
  /** The allowance period now (ISO): it resets at `periodEnd`. */
  periodStart: string;
  periodEnd: string;
  /** The daily cap that applies now (raised while the person holds credits). */
  dailyNowUsd: number | null;
  credits: { availableUsd: number; usedUsd: number; leftUsd: number; packs: { pack: string; usd: number; leftUsd: number; boughtAt: string }[] };
};

/** What a person has spent and may spend, for the plan page. */
export async function aiAllowance(userId: string, admin = false): Promise<AiAllowance> {
  const caps = await aiCaps(userId);
  const period = allowancePeriod(new Date(), caps.anchor);
  const [todayUsd, monthUsd, state] = await Promise.all([spent(userId, "day", dayStart()).catch(() => 0), spent(userId, "month", period.start).catch(() => 0), creditsFor(userId, period)]);
  const uncapped = admin || caps.admin;
  const usedUsd = caps.monthlyUsd === null || uncapped ? 0 : splitSpend(monthUsd, caps.monthlyUsd, state.availableUsd).credits;
  const leftUsd = Math.max(0, state.availableUsd - usedUsd);
  const packs = packsLeft(state, usedUsd).map((g) => ({ pack: g.pack, usd: g.usd - g.refundedUsd, leftUsd: g.leftUsd, boughtAt: g.createdAt.toISOString() }));
  const base = uncapped ? { ...caps, admin: true, dailyUsd: null, monthlyUsd: null } : caps;
  return {
    ...base, todayUsd, monthUsd, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(),
    dailyNowUsd: base.dailyUsd === null ? null : dailyCapWith(base.dailyUsd, leftUsd),
    credits: { availableUsd: state.availableUsd, usedUsd, leftUsd, packs },
  };
}

/**
 * Why a model call may not run now, or null when it may. `pendingUsd` is spend the caller has made
 * but not recorded yet (a long run's turns so far). A ledger that does not answer does not block.
 */
export async function aiBlocked(userId: string | null, pendingUsd = 0): Promise<string | null> {
  if (aiDisabled()) return PAUSED;
  const personal = userId && !aiAdmin() ? userId : null;
  // Everyone's spend does not depend on the plan, so it is read while the plan is looked up.
  const everyoneSpent = spent(null, "day", dayStart()).catch(() => 0);
  const caps = personal ? await aiCaps(personal) : null;
  const capped = caps && !caps.admin ? personal : null;
  const period = allowancePeriod(new Date(), caps?.anchor);
  const [all, mine, mineMonth, state] = await Promise.all([
    everyoneSpent,
    capped ? spent(capped, "day", dayStart()).catch(() => 0) : Promise.resolve(null),
    capped ? spent(capped, "month", period.start).catch(() => 0) : Promise.resolve(null),
    capped && caps?.monthlyUsd != null ? creditsFor(capped, period) : Promise.resolve(NO_CREDITS),
  ]);
  if (capped && mineMonth !== null && caps?.monthlyUsd != null && state.availableUsd > 0 && mineMonth > caps.monthlyUsd) {
    recordDraw(capped, period, caps.monthlyUsd, state.availableUsd, mineMonth);
  }
  return blockedAt({
    disabled: false, everyone: all, mine, mineMonth, pending: pendingUsd, globalCap: globalDailyUsd(),
    userCap: caps?.dailyUsd ?? Infinity, monthCap: caps?.monthlyUsd ?? Infinity, plan: caps?.plan,
    credits: state.availableUsd, resetsOn: period.end,
  });
}

/**
 * The decision, pure for tests: `mine` (and `mineMonth`) are null for work that runs for no one
 * (background passes) or for an administrator. `credits` is what the person may draw on this period once
 * the monthly allowance is used (the allowance always goes first); while any are left the daily cap is at
 * least CREDIT_DAILY_USD.
 */
export function blockedAt(s: { disabled: boolean; everyone: number; mine: number | null; pending: number; globalCap: number; userCap: number; mineMonth?: number | null; monthCap?: number; plan?: PlanId; now?: Date; credits?: number; resetsOn?: Date }): string | null {
  if (s.disabled) return PAUSED;
  if (s.everyone + s.pending >= s.globalCap) return GLOBAL_CAP;
  const credits = Math.max(0, s.credits ?? 0);
  const creditsLeft = s.mineMonth != null && s.monthCap !== undefined ? credits - splitSpend(s.mineMonth, s.monthCap, credits).credits : credits;
  if (s.mine !== null && s.mine + s.pending >= dailyCapWith(s.userCap, creditsLeft)) return USER_CAP;
  if (s.mineMonth != null && s.monthCap !== undefined && s.mineMonth + s.pending >= s.monthCap + credits) return monthCapMessage(s.plan ?? "free", s.now, s.resetsOn, credits > 0);
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
