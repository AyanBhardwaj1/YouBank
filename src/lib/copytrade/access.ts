/**
 * Who may do what with copies, the safety switches and limits, consents and the audit log. Server only.
 *
 * - Browsing funds, backtests, paper copies (up to 10) and alerts: everyone signed in, free.
 * - Connecting a broker and live orders: `copytrade.broker` (Pro and up; administrators always).
 * - A copy of several funds: `copytrade.blends`. More than 2 live copies: `copytrade.multi`.
 * - Real orders also need COPYTRADE_TRADING_ENABLED=1 on the server. Without it, everything else works
 *   (connecting and seeing positions included) and Approve explains that real trading is switched off.
 * - Every route that changes anything writes the audit log, which the database keeps append-only.
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { csvRow } from "@/lib/csv";
import { CONSENTS, consentText, type ConsentKind } from "./disclosures";
import type { AuditEntry } from "./orders";

export const tradingEnabled = () => process.env.COPYTRADE_TRADING_ENABLED?.trim() === "1";

const envUsd = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

/** Server-wide ceilings; a copy's own limits can only be lower. */
export const limits = () => ({
  maxOrderUsd: envUsd("COPYTRADE_MAX_ORDER_USD", 25_000),
  maxDayUsd: envUsd("COPYTRADE_MAX_DAY_USD", 50_000),
  paperCopies: 10,
  liveCopies: 2,
  liveCopiesMulti: 10,
  /** Minutes a proposal stays approvable before prices are too old. */
  proposalMinutes: 15,
});

type Person = Pick<CurrentUser, "id" | "email">;

/** How many live copies this person may run. */
export async function liveCopyLimit(user: Person): Promise<number> {
  return (await canUse(user, "copytrade.multi")) ? limits().liveCopiesMulti : limits().liveCopies;
}

export async function requireBroker(user: Person): Promise<void> {
  await requireFeature(user, "copytrade.broker");
}

export const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

/* ---------------- Consents ---------------- */

export const consentHash = (k: ConsentKind) => createHash("sha256").update(consentText(k)).digest("hex").slice(0, 32);

export async function hasConsent(userId: string, kind: ConsentKind): Promise<boolean> {
  const [row] = await requireDb().select({ v: schema.copyConsents.version }).from(schema.copyConsents)
    .where(and(eq(schema.copyConsents.userId, userId), eq(schema.copyConsents.kind, kind), eq(schema.copyConsents.version, CONSENTS[kind].version)));
  return !!row;
}

export async function requireConsent(userId: string, kind: ConsentKind): Promise<void> {
  if (!(await hasConsent(userId, kind))) throw Object.assign(refuse(kind === "trading" ? "Read and accept the risks of placing real orders first." : "Read and accept how copies work first.", 428), { consent: kind });
}

export async function giveConsent(user: Person, kind: ConsentKind, ctx: { ip: string | null; userAgent: string | null }): Promise<void> {
  const c = CONSENTS[kind];
  await requireDb().insert(schema.copyConsents).values({ userId: user.id, kind, version: c.version, textHash: consentHash(kind), ip: ctx.ip, userAgent: ctx.userAgent }).onConflictDoNothing();
  await audit({ userId: user.id, actor: user.email, action: `consent-${kind}`, payload: { version: c.version, textHash: consentHash(kind), text: consentText(kind) }, ip: ctx.ip, userAgent: ctx.userAgent });
}

export async function consentsOf(userId: string): Promise<Record<ConsentKind, boolean>> {
  const rows = await requireDb().select().from(schema.copyConsents).where(eq(schema.copyConsents.userId, userId));
  const has = (k: ConsentKind) => rows.some((r) => r.kind === k && r.version === CONSENTS[k].version);
  return { terms: has("terms"), trading: has("trading") };
}

/* ---------------- Audit ---------------- */

export async function audit(e: AuditEntry): Promise<void> {
  await requireDb().insert(schema.copyAudit).values({ userId: e.userId, actor: e.actor, action: e.action, portfolioId: e.portfolioId ?? null, batchId: e.batchId ?? null, orderId: e.orderId ?? null, payload: e.payload, ip: e.ip ?? null, userAgent: e.userAgent ?? null });
}

export async function auditLog(userId: string, limit = 500) {
  return requireDb().select().from(schema.copyAudit).where(eq(schema.copyAudit.userId, userId)).orderBy(desc(schema.copyAudit.createdAt)).limit(limit);
}

/** The audit log as CSV, for the person's records or their adviser. Pure. */
export function auditCsv(rows: { createdAt: Date; actor: string; action: string; portfolioId: number | null; batchId: number | null; orderId: number | null; ip: string | null; payload: unknown }[]): string {
  // Formula-leading cells are neutralised (lib/csv): a broker's message or a payload could start with "=".
  return ["time,actor,action,copy,batch,order,ip,details", ...rows.map((r) => csvRow([r.createdAt.toISOString(), r.actor, r.action, r.portfolioId, r.batchId, r.orderId, r.ip, r.payload]))].join("\n");
}

/**
 * Whether a request that changes copies, consents, connections or orders came from YouBank's own pages.
 * The session cookie rides along on any request the browser makes, so a page elsewhere (or on a sibling
 * subdomain, which SameSite=Lax does not stop) could otherwise post to these routes. Browsers mark
 * cross-site requests in Sec-Fetch-Site, and a JSON body cannot be sent cross-origin without a CORS
 * preflight, which these routes never answer. Our pages always send JSON. Pure.
 */
export function sameSiteJson(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export const CROSS_SITE = { error: "Make this change on YouBank itself." } as const;

/** The caller's address and browser, for consents and approvals. */
export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return { ip, userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null };
}
