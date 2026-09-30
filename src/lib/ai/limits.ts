/**
 * Limits on model spend, checked before every model call:
 * - AI_DISABLED=1 turns every model call off (the app keeps working without AI);
 * - AI_GLOBAL_DAILY_USD ($200 by default) caps everyone's spend per UTC day, background work included;
 * - AI_USER_DAILY_USD ($5 by default) caps each person's;
 * - a person runs at most two long AI runs (chat, tools, the Studio agent) at once, so parallel runs
 *   cannot all start under the cap.
 * Spend is read from the usage ledger and cached briefly per instance; calls the ledger has not caught
 * up with are added as they happen (noteAiSpend), and long runs add their running cost between turns.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { lease, type Release } from "@/lib/locks";

export class AiLimitError extends Error {
  /** Read by `guarded()` so these surface as 429 rather than 500. */
  readonly status = 429;
  constructor(message: string) { super(message); this.name = "AiLimitError"; }
}

const usd = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};
export const userDailyUsd = () => usd(process.env.AI_USER_DAILY_USD, 5);
export const globalDailyUsd = () => usd(process.env.AI_GLOBAL_DAILY_USD, 200);
export const aiDisabled = () => /^(1|true|yes|on)$/i.test(process.env.AI_DISABLED?.trim() ?? "");

export const PAUSED = "AI features are paused right now. Everything else keeps working.";
const USER_CAP = "You have reached today's AI limit. It resets at midnight UTC.";
const GLOBAL_CAP = "AI features have reached today's limit and come back at midnight UTC. Everything else keeps working.";
const BUSY = "You already have two AI runs going. Wait for one to finish, then try again.";

const DAY_MS = 86_400_000;
const USER_TTL_MS = 20_000, GLOBAL_TTL_MS = 60_000;
type Memo = { day: number; usd: number; at: number };
const people = new Map<string, Memo>();
let everyone: Memo | null = null;
const today = () => Math.floor(Date.now() / DAY_MS);

/** Today's spend (UTC) for one person, or for everyone when `userId` is null. */
async function spentToday(userId: string | null): Promise<number> {
  const day = today();
  const memo = userId ? people.get(userId) : everyone;
  if (memo && memo.day === day && Date.now() - memo.at < (userId ? USER_TTL_MS : GLOBAL_TTL_MS)) return memo.usd;
  const since = new Date(day * DAY_MS);
  const where = userId ? and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, since)) : gte(schema.aiUsage.createdAt, since);
  const [r] = await requireDb().select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float` }).from(schema.aiUsage).where(where);
  // The ledger can trail spend noted here moments ago (its writes land after the response).
  const next = { day, usd: Math.max(Number(r?.usd ?? 0), memo?.day === day ? memo.usd : 0), at: Date.now() };
  if (userId) {
    if (people.size > 5_000) people.clear();
    people.set(userId, next);
  } else everyone = next;
  return next.usd;
}

/** Count spend now, before the ledger row lands. */
export function noteAiSpend(userId: string | null, cost: number) {
  if (!Number.isFinite(cost) || cost <= 0) return;
  const day = today();
  if (everyone?.day === day) everyone.usd += cost;
  const m = userId ? people.get(userId) : undefined;
  if (m?.day === day) m.usd += cost;
}

/**
 * Why a model call may not run now, or null when it may. `pendingUsd` is spend the caller has made
 * but not recorded yet (a long run's turns so far). A ledger that does not answer does not block.
 */
export async function aiBlocked(userId: string | null, pendingUsd = 0): Promise<string | null> {
  if (aiDisabled()) return PAUSED;
  const [all, mine] = await Promise.all([
    spentToday(null).catch(() => 0),
    userId ? spentToday(userId).catch(() => 0) : Promise.resolve(null),
  ]);
  return blockedAt({ disabled: false, everyone: all, mine, pending: pendingUsd, globalCap: globalDailyUsd(), userCap: userDailyUsd() });
}

/** The decision, pure for tests: `mine` is null for work that runs for no one (background passes). */
export function blockedAt(s: { disabled: boolean; everyone: number; mine: number | null; pending: number; globalCap: number; userCap: number }): string | null {
  if (s.disabled) return PAUSED;
  if (s.everyone + s.pending >= s.globalCap) return GLOBAL_CAP;
  if (s.mine !== null && s.mine + s.pending >= s.userCap) return USER_CAP;
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
