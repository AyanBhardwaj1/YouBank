/**
 * Who may do what in algo trading, the server switches and ceilings, consents, kill switches and the
 * audit log. Server only.
 *
 * - Strategies, templates, backtests and paper trading (3 strategies): everyone signed in, free.
 * - Live with approval (`algo.live`) and the agent (`algo.agent`): Pro. Autonomous (`algo.autonomous`) and
 *   more strategies with 15-minute decisions (`algo.more`): Deal Team. Administrators may use every plan
 *   feature; the safety gates (ALGO_LIVE_ENABLED, consents, the paper period, limits) apply to them too.
 * - Real orders need ALGO_LIVE_ENABLED=1 on the server. Off by default.
 * - Routes that change anything accept only JSON from YouBank's own pages (copy trading's sameSiteJson).
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { csvRow } from "@/lib/csv";
import { CONSENTS, consentText, type ConsentKind } from "./disclosures";

export { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/copytrade/access";

type Person = Pick<CurrentUser, "id" | "email">;
export type Meta = { ip: string | null; userAgent: string | null };

export const liveEnabled = () => process.env.ALGO_LIVE_ENABLED?.trim() === "1";
const envNum = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

/** Server-wide ceilings and caps; a strategy's own limits can only be lower. */
export const serverLimits = () => ({
  maxOrderUsd: envNum("ALGO_MAX_ORDER_USD", 25_000),
  maxDayUsd: envNum("ALGO_MAX_DAY_USD", 50_000),
  minPaperDays: envNum("ALGO_MIN_PAPER_DAYS", 14),
  strategies: { free: 3, pro: 10, more: 25 },
  /** Minutes a proposed batch stays approvable. */
  proposalMinutes: 15,
  agentPerMinute: 10,
});

export const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** How many strategies this person may keep (not archived). */
export async function strategyCap(user: Person): Promise<number> {
  const l = serverLimits().strategies;
  if (await canUse(user, "algo.more")) return l.more;
  if (await canUse(user, "algo.live")) return l.pro;
  return l.free;
}

/* ---------------- Consents ---------------- */

export const consentHash = (k: ConsentKind) => createHash("sha256").update(consentText(k)).digest("hex").slice(0, 32);

export async function consentsOf(userId: string, strategyId = 0): Promise<{ terms: boolean; live: boolean; autonomous: boolean }> {
  const rows = await requireDb().select().from(schema.algoConsents).where(and(eq(schema.algoConsents.userId, userId), inArray(schema.algoConsents.strategyId, [0, strategyId])));
  const has = (k: ConsentKind, sid = 0) => rows.some((r) => r.kind === k && r.version === CONSENTS[k].version && r.strategyId === sid);
  return { terms: has("terms"), live: has("live"), autonomous: strategyId > 0 && has("autonomous", strategyId) };
}

export async function requireConsent(userId: string, kind: "terms" | "live"): Promise<void> {
  const c = await consentsOf(userId);
  if (!c[kind]) throw Object.assign(refuse(kind === "live" ? "Read and accept the risks of real orders first." : "Read and accept how algo trading works first.", 428), { consent: kind });
}

export async function giveConsent(user: Person, kind: ConsentKind, strategyId: number, typed: string | null, meta: Meta): Promise<void> {
  const c = CONSENTS[kind];
  await requireDb().insert(schema.algoConsents).values({ userId: user.id, kind, strategyId, version: c.version, textHash: consentHash(kind), typed, ip: meta.ip, userAgent: meta.userAgent }).onConflictDoNothing();
  await audit({ userId: user.id, actor: user.email, action: `consent-${kind}`, strategyId: strategyId || null, payload: { version: c.version, textHash: consentHash(kind), text: consentText(kind), typed }, ...meta });
}

/** Withdraw a strategy's autonomous consent (when it leaves autonomous mode or its limits loosen). */
export async function withdrawAutonomous(userId: string, strategyId: number): Promise<void> {
  await requireDb().delete(schema.algoConsents).where(and(eq(schema.algoConsents.userId, userId), eq(schema.algoConsents.kind, "autonomous"), eq(schema.algoConsents.strategyId, strategyId)));
}

/* ---------------- Kill switches ---------------- */

export const GLOBAL = "__global__";

export async function killState(userId: string): Promise<{ global: boolean; user: boolean; globalReason: string | null }> {
  const rows = await requireDb().select().from(schema.algoSettings).where(inArray(schema.algoSettings.userId, [userId, GLOBAL]));
  const g = rows.find((r) => r.userId === GLOBAL), u = rows.find((r) => r.userId === userId);
  return { global: !!g?.kill || process.env.ALGO_KILL?.trim() === "1", user: !!u?.kill, globalReason: g?.killReason ?? (process.env.ALGO_KILL?.trim() === "1" ? "ALGO_KILL is set on the server." : null) };
}

/** Turn a kill switch on or off (the person's, or with userId GLOBAL the administrators'). Turning one on also cancels unsent batches. */
export async function setKill(userId: string, on: boolean, by: string, reason: string | null, meta: Meta): Promise<void> {
  const db = requireDb();
  await db.insert(schema.algoSettings).values({ userId, kill: on, killReason: reason, killBy: by, killAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.algoSettings.userId, set: { kill: on, killReason: reason, killBy: by, killAt: new Date(), updatedAt: new Date() } });
  if (on) {
    const where = userId === GLOBAL ? eq(schema.algoBatches.status, "proposed") : and(eq(schema.algoBatches.userId, userId), eq(schema.algoBatches.status, "proposed"));
    await db.update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(where);
  }
  await audit({ userId, actor: by, action: on ? "kill-on" : "kill-off", payload: { scope: userId === GLOBAL ? "global" : "user", reason }, ...meta });
}

/* ---------------- Audit ---------------- */

export type AlgoAudit = { userId: string; actor: string; action: string; strategyId?: number | null; batchId?: number | null; orderId?: number | null; payload: Record<string, unknown>; ip?: string | null; userAgent?: string | null };

export async function audit(e: AlgoAudit): Promise<void> {
  await requireDb().insert(schema.algoAudit).values({ userId: e.userId, actor: e.actor.slice(0, 200), action: e.action.slice(0, 80), strategyId: e.strategyId ?? null, batchId: e.batchId ?? null, orderId: e.orderId ?? null, payload: e.payload, ip: e.ip ?? null, userAgent: e.userAgent ?? null });
}

export async function auditLog(userId: string, opts: { strategyId?: number; limit?: number } = {}) {
  const where = opts.strategyId ? and(eq(schema.algoAudit.userId, userId), eq(schema.algoAudit.strategyId, opts.strategyId)) : eq(schema.algoAudit.userId, userId);
  return requireDb().select().from(schema.algoAudit).where(where).orderBy(desc(schema.algoAudit.createdAt)).limit(opts.limit ?? 1000);
}

/** The audit log as CSV, formula-leading cells neutralised (lib/csv). Pure. */
export function auditCsv(rows: { createdAt: Date; actor: string; action: string; strategyId: number | null; batchId: number | null; orderId: number | null; ip: string | null; payload: unknown }[]): string {
  return ["time,actor,action,strategy,batch,order,ip,details", ...rows.map((r) => csvRow([r.createdAt.toISOString(), r.actor, r.action, r.strategyId, r.batchId, r.orderId, r.ip, r.payload]))].join("\n");
}
