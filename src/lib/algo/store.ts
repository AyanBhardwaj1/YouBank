/**
 * Strategies, their modes, batches and orders in the database. Server only. Every change is audited.
 *
 * Modes: backtest (does nothing on a schedule), paper (the default: the paper broker), live_approval (each
 * batch waits for the person's tap), live_auto (trades within its limits). Moving to a live mode runs the
 * live gate (live-gate.ts) with everything read fresh; leaving autonomous mode, or loosening a limit while
 * in it, withdraws the strategy's autonomous consent, so it must be given again with the typed phrase.
 */
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { canUseById } from "@/lib/billing/use";
import { confirmationPhrase, type BatchRow, type OrderRow } from "@/lib/copytrade/orders";
import { audit, consentsOf, giveConsent, killState, liveEnabled, refuse, serverLimits, strategyCap, withdrawAutonomous, type Meta } from "./access";
import { loosens } from "./agent-gate";
import { newPaper } from "./brokers/paper";
import { supports } from "./brokers/types";
import { liveAdapter } from "./connections";
import { normaliseStatus, type OrderState } from "./execution";
import { liveRequirements, type LiveMode, type Unmet } from "./live-gate";
import type { AlgoOrderRow, AlgoStore } from "./orders";
import { nextTickAt, type TickPolicy } from "./schedule";
import { quant, type IntegrityReport } from "./signals";
import { parseStrategy, type StrategySpec } from "./strategy";

type Person = Pick<CurrentUser, "id" | "email">;
export type StrategyRow = typeof schema.algoStrategies.$inferSelect;
export type Mode = "backtest" | "paper" | "live_approval" | "live_auto";
export const MODES: Mode[] = ["backtest", "paper", "live_approval", "live_auto"];

export const specOf = (r: StrategyRow): StrategySpec => {
  const p = parseStrategy(r.spec);
  if (!p.ok) throw refuse(`This strategy's settings are no longer valid: ${p.errors[0]}`, 409);
  return p.spec;
};

/** How often a person's strategies may tick; by id, so background ticks see the plan (and the administrator bypass) too. */
export async function tickPolicy(userId: string, _email = ""): Promise<TickPolicy> {
  void _email;
  return { intraday: await canUseById(userId, "algo.live"), minMinutes: (await canUseById(userId, "algo.more")) ? 15 : 60 };
}

export async function getStrategy(userId: string, id: number): Promise<StrategyRow> {
  const [r] = await requireDb().select().from(schema.algoStrategies).where(and(eq(schema.algoStrategies.id, id), eq(schema.algoStrategies.userId, userId)));
  if (!r || r.status === "archived") throw refuse("That strategy was not found.", 404);
  return r;
}

export async function listStrategies(userId: string): Promise<StrategyRow[]> {
  return requireDb().select().from(schema.algoStrategies).where(and(eq(schema.algoStrategies.userId, userId), notInArray(schema.algoStrategies.status, ["archived"]))).orderBy(desc(schema.algoStrategies.updatedAt));
}

/** Create a strategy from a full spec; it starts in paper mode (or backtest), with its own paper account. */
export async function createStrategy(user: Person, raw: unknown, meta: Meta, source: "user" | "agent" | "template" = "user"): Promise<StrategyRow> {
  const p = parseStrategy(raw);
  if (!p.ok) throw refuse(`Check the strategy: ${p.errors.join("; ")}`);
  const spec = p.spec;
  if (spec.risk.allowShort) spec.risk.allowShort = false;
  const db = requireDb();
  const n = await db.$count(schema.algoStrategies, and(eq(schema.algoStrategies.userId, user.id), notInArray(schema.algoStrategies.status, ["archived"])));
  const cap = await strategyCap(user);
  if (n >= cap) throw refuse(`You can keep ${cap} strategies on your plan. Archive one, or upgrade for more.`, 402);
  const now = new Date();
  const [row] = await db.insert(schema.algoStrategies).values({
    userId: user.id, name: spec.name, spec: spec as unknown as Record<string, unknown>, mode: "paper", status: "active", connection: "paper",
    paper: newPaper(spec.capitalUsd), paperStartedAt: now, equityPeak: spec.capitalUsd, equityDayStart: spec.capitalUsd,
    nextTickAt: nextTickAt(spec, now, await tickPolicy(user.id, user.email)),
  }).returning();
  await audit({ userId: user.id, actor: source === "agent" ? `agent for ${user.email}` : user.email, action: "strategy-create", strategyId: row.id, payload: { source, spec }, ...meta });
  return row;
}

/** Edit a strategy's spec, connection, account or status. Risk limits must be saved explicitly (riskConfirmed) before live trading. */
export async function updateStrategy(user: Person, id: number, body: { spec?: unknown; riskConfirmed?: boolean; connection?: string; accountId?: string | null; status?: string }, meta: Meta, actor = user.email): Promise<StrategyRow> {
  const row = await getStrategy(user.id, id);
  const cur = specOf(row);
  const patch: Partial<typeof schema.algoStrategies.$inferInsert> = { updatedAt: new Date() };
  const changes: Record<string, unknown> = {};
  if (body.spec !== undefined) {
    const p = parseStrategy(body.spec);
    if (!p.ok) throw refuse(`Check the strategy: ${p.errors.join("; ")}`);
    const next = p.spec;
    if (row.mode !== "backtest" && next.risk.allowShort) throw refuse("Paper and live strategies are long-only. Short selling is for backtests.");
    patch.spec = next as unknown as Record<string, unknown>;
    patch.name = next.name;
    const riskChanged = JSON.stringify(next.risk) !== JSON.stringify(cur.risk);
    if (riskChanged) patch.riskConfirmedAt = body.riskConfirmed ? new Date() : null;
    const loose = loosens(cur.risk, next.risk);
    if (row.mode === "live_auto" && (loose.length || next.capitalUsd > cur.capitalUsd)) {
      // Loosening an autonomous strategy's limits needs the typed consent again: it drops to approval mode.
      patch.mode = "live_approval";
      await withdrawAutonomous(user.id, id);
      changes.modeDropped = { to: "live_approval", because: [...loose, ...(next.capitalUsd > cur.capitalUsd ? ["capitalUsd"] : [])] };
    }
    patch.nextTickAt = nextTickAt(next, new Date(), await tickPolicy(user.id, user.email));
    changes.spec = { before: cur, after: next };
  } else if (body.riskConfirmed) { patch.riskConfirmedAt = new Date(); changes.riskConfirmed = true; }
  if (body.connection !== undefined) {
    if (!/^(paper|snaptrade|conn:\d+)$/.test(body.connection)) throw refuse("Choose a connection.");
    if (row.mode === "live_approval" || row.mode === "live_auto") throw refuse("Move the strategy to paper before changing its account.");
    patch.connection = body.connection; patch.accountId = body.accountId ?? null; patch.managed = {};
    changes.connection = { connection: body.connection, accountId: body.accountId ?? null };
  }
  if (body.status === "paused" || body.status === "active") {
    patch.status = body.status;
    changes.status = body.status;
    if (body.status === "paused") await requireDb().update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoBatches.strategyId, id), eq(schema.algoBatches.status, "proposed")));
  }
  const [out] = await requireDb().update(schema.algoStrategies).set(patch).where(eq(schema.algoStrategies.id, id)).returning();
  await audit({ userId: user.id, actor, action: "strategy-update", strategyId: id, payload: changes, ...meta });
  return out;
}

export async function archiveStrategy(user: Person, id: number, meta: Meta): Promise<void> {
  await getStrategy(user.id, id);
  await requireDb().update(schema.algoStrategies).set({ status: "archived", updatedAt: new Date() }).where(eq(schema.algoStrategies.id, id));
  await requireDb().update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoBatches.strategyId, id), eq(schema.algoBatches.status, "proposed")));
  await withdrawAutonomous(user.id, id);
  await audit({ userId: user.id, actor: user.email, action: "strategy-archive", strategyId: id, payload: {}, ...meta });
}

/** Turn a strategy's own kill switch on or off. */
export async function setStrategyKill(user: Person, id: number, on: boolean, reason: string | null, meta: Meta, actor = user.email): Promise<void> {
  await getStrategy(user.id, id);
  await requireDb().update(schema.algoStrategies).set({ kill: on, killReason: on ? reason : null, updatedAt: new Date() }).where(eq(schema.algoStrategies.id, id));
  if (on) await requireDb().update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoBatches.strategyId, id), eq(schema.algoBatches.status, "proposed")));
  await audit({ userId: user.id, actor, action: on ? "strategy-kill-on" : "strategy-kill-off", strategyId: id, payload: { reason }, ...meta });
}

/* ---------------- Live gate, read fresh ---------------- */

export async function integrityFor(spec: StrategySpec): Promise<IntegrityReport | null> {
  return quant().integrity.integrityCheck(`algo:${spec.signal.type}:${spec.name}`).catch(() => null);
}

/** What stands between a strategy and a live mode now. */
export async function liveCheck(user: Person, row: StrategyRow, mode: LiveMode, typed: string | null, gradeOverride: string | null): Promise<{ ok: boolean; unmet: Unmet[]; integrity: IntegrityReport | null }> {
  const spec = specOf(row);
  const [plan, consents, kill, integrity] = await Promise.all([
    // By id when there is no email (a background tick), so the plan and the administrator bypass read the same as in a request.
    Promise.all(user.email ? [canUse(user, "algo.live"), canUse(user, "algo.autonomous")] : [canUseById(user.id, "algo.live"), canUseById(user.id, "algo.autonomous")]).then(([live, autonomous]) => ({ live, autonomous })),
    consentsOf(user.id, row.id), killState(user.id), integrityFor(spec),
  ]);
  let connection = { connected: false, tradingAllowed: false, supportsAsset: null as string | null };
  if (row.connection && row.connection !== "paper" && row.accountId) {
    const a = await liveAdapter(user.id, row.connection, row.accountId).catch(() => null);
    if (a) {
      const caps = a.adapter.capabilities();
      const accts = await a.adapter.accounts().catch(() => []);
      const acct = accts.find((x) => x.id === row.accountId);
      connection = { connected: !!acct, tradingAllowed: !!acct?.tradingAllowed && (caps.equities || caps.crypto), supportsAsset: supports(caps, { assetClass: spec.assetClass === "options" ? "option" : spec.assetClass, type: spec.execution.orderType === "Market" ? "market" : "limit", timeInForce: spec.assetClass === "crypto" ? "gtc" : "day", qty: 1 }) };
    }
  }
  const g = liveRequirements({
    mode, spec, envEnabled: liveEnabled(), plan, consents, connection, paperStartedAt: row.paperStartedAt, minPaperDays: serverLimits().minPaperDays,
    riskConfirmed: !!row.riskConfirmedAt, kill: { global: kill.global, user: kill.user, strategy: row.kill }, integrity, gradeOverride, typed, now: new Date(),
  });
  return { ...g, integrity };
}

/** Switch a strategy's mode. Live modes pass the gate first; autonomous stores the typed consent. */
export async function setMode(user: Person, id: number, body: { mode?: unknown; typed?: unknown; gradeOverride?: unknown }, meta: Meta): Promise<{ mode: Mode; unmet: Unmet[] }> {
  const row = await getStrategy(user.id, id);
  const mode = MODES.find((m) => m === body.mode);
  if (!mode) throw refuse("Choose backtest, paper, live with approval or live autonomous.");
  const typed = typeof body.typed === "string" ? body.typed : null;
  const gradeOverride = typeof body.gradeOverride === "string" ? body.gradeOverride : null;
  const patch: Partial<typeof schema.algoStrategies.$inferInsert> = { mode, updatedAt: new Date() };
  if (mode === "live_approval" || mode === "live_auto") {
    const g = await liveCheck(user, row, mode, mode === "live_auto" ? typed ?? "" : null, gradeOverride);
    if (!g.ok) return { mode: row.mode as Mode, unmet: g.unmet };
    if (g.integrity && gradeOverride) await audit({ userId: user.id, actor: user.email, action: "integrity-override", strategyId: id, payload: { grade: g.integrity.grade, typed: gradeOverride, report: g.integrity }, ...meta });
    if (mode === "live_auto") await giveConsent(user, "autonomous", id, typed, meta);
    if (row.mode === "paper" || row.mode === "backtest") patch.managed = {};
  }
  if (mode !== "live_auto" && row.mode === "live_auto") await withdrawAutonomous(user.id, id);
  if (mode === "paper" && !row.paperStartedAt) { patch.paperStartedAt = new Date(); patch.paper = newPaper(specOf(row).capitalUsd); }
  // Backtest mode trades nothing, so its time is not paper trading: the paper clock restarts when it returns to paper.
  if (mode === "backtest" && row.mode !== "backtest") patch.paperStartedAt = null;
  if (mode !== "live_approval" && mode !== "live_auto") await requireDb().update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoBatches.strategyId, id), eq(schema.algoBatches.status, "proposed")));
  // TWAP slices not yet sent belong to the mode that made them: a change of mode drops them.
  if (mode !== row.mode) await requireDb().update(schema.algoOrders).set({ status: "canceled", error: "The strategy's mode changed before this slice's time.", updatedAt: new Date() }).where(and(eq(schema.algoOrders.strategyId, id), eq(schema.algoOrders.status, "scheduled")));
  await requireDb().update(schema.algoStrategies).set(patch).where(eq(schema.algoStrategies.id, id));
  await audit({ userId: user.id, actor: user.email, action: "strategy-mode", strategyId: id, payload: { from: row.mode, to: mode, typed: mode === "live_auto" ? typed : null }, ...meta });
  return { mode, unmet: [] };
}

/* ---------------- The database store for sendBatch ---------------- */

const SETTLED_STATUSES = ["rejected", "skipped", "blocked", "scheduled", "canceled", "expired"];

function toRow(r: typeof schema.algoOrders.$inferSelect): AlgoOrderRow {
  return { id: r.id, batchId: r.batchId, seq: r.seq * 100 + r.slice, clientOrderId: r.clientOrderId, ticker: r.symbol, symbolId: r.symbolId, action: r.action as "BUY" | "SELL", units: r.units, orderType: r.orderType as "Limit" | "Market", limitPrice: r.limitPrice, estValue: r.estValue, status: r.status, brokerageOrderId: r.brokerOrderId, error: r.error, assetClass: (r.assetClass as AlgoOrderRow["assetClass"]) ?? "equity" };
}

/** Copy trading's store contract over the algo tables. `broker` names whose status words to normalise. */
export function dbStore(broker: string): AlgoStore {
  const db = () => requireDb();
  return {
    async batch(id, userId): Promise<BatchRow | null> {
      const [b] = await db().select().from(schema.algoBatches).where(and(eq(schema.algoBatches.id, id), eq(schema.algoBatches.userId, userId)));
      return b ? { id: b.id, userId: b.userId, portfolioId: b.strategyId, accountId: b.accountId, status: b.status as BatchRow["status"], idemKey: b.idemKey, buyValue: b.buyValue, sellValue: b.sellValue, orderCount: b.orderCount, expiresAt: b.expiresAt } : null;
    },
    async claimBatch(id, userId, idemKey, at) {
      const won = await db().update(schema.algoBatches).set({ status: "placing", idemKey, approvedAt: at, updatedAt: at })
        .where(and(eq(schema.algoBatches.id, id), eq(schema.algoBatches.userId, userId), eq(schema.algoBatches.status, "proposed"), sql`${schema.algoBatches.expiresAt} > ${at}`)).returning({ id: schema.algoBatches.id });
      return won.length === 1;
    },
    async releaseBatch(id, idemKey) {
      await db().update(schema.algoBatches).set({ status: "proposed", idemKey: null, approvedAt: null, updatedAt: new Date() }).where(and(eq(schema.algoBatches.id, id), eq(schema.algoBatches.status, "placing"), eq(schema.algoBatches.idemKey, idemKey)));
    },
    async orders(batchId): Promise<OrderRow[]> { return (await this.algoOrders(batchId)); },
    async algoOrders(batchId) {
      return (await db().select().from(schema.algoOrders).where(eq(schema.algoOrders.batchId, batchId)).orderBy(schema.algoOrders.seq, schema.algoOrders.slice)).map(toRow);
    },
    async claimOrder(orderId) {
      const won = await db().update(schema.algoOrders).set({ status: "submitting", sentAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.algoOrders.id, orderId), eq(schema.algoOrders.status, "pending"))).returning({ id: schema.algoOrders.id });
      return won.length === 1;
    },
    async updateOrder(orderId, patch) {
      const status = patch.status ? (["unknown", "rejected"].includes(patch.status) ? patch.status : normaliseStatus(broker, patch.status)) : undefined;
      await db().update(schema.algoOrders).set({ ...(status ? { status } : {}), ...(patch.brokerageOrderId !== undefined ? { brokerOrderId: patch.brokerageOrderId } : {}), ...(patch.error !== undefined ? { error: patch.error } : {}), ...(patch.impact !== undefined ? { impact: patch.impact } : {}), ...(patch.response !== undefined ? { response: patch.response } : {}), updatedAt: new Date() }).where(eq(schema.algoOrders.id, orderId));
    },
    async finishBatch(id, status) { await db().update(schema.algoBatches).set({ status, updatedAt: new Date() }).where(eq(schema.algoBatches.id, id)); },
    async committedValueSince(userId, since) {
      const [r] = await db().select({ v: sql<number>`coalesce(sum(${schema.algoOrders.estValue}), 0)::float8` }).from(schema.algoOrders)
        .innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId))
        .where(and(eq(schema.algoBatches.userId, userId), gte(schema.algoBatches.approvedAt, since), notInArray(schema.algoOrders.status, SETTLED_STATUSES), sql`${schema.algoBatches.accountId} <> 'paper'`));
      return Number(r?.v ?? 0);
    },
    async audit(e) { await audit({ userId: e.userId, actor: e.actor, action: e.action, strategyId: e.portfolioId ?? null, batchId: e.batchId ?? null, orderId: e.orderId ?? null, payload: e.payload, ip: e.ip, userAgent: e.userAgent }); },
    async blockOrder(orderId, reason) { await db().update(schema.algoOrders).set({ status: "blocked", error: reason.slice(0, 500), updatedAt: new Date() }).where(and(eq(schema.algoOrders.id, orderId), eq(schema.algoOrders.status, "pending"))); },
    async tripKill(batchId, reason) {
      const [b] = await db().select({ s: schema.algoBatches.strategyId, u: schema.algoBatches.userId }).from(schema.algoBatches).where(eq(schema.algoBatches.id, batchId));
      if (!b) return;
      await db().update(schema.algoStrategies).set({ kill: true, killReason: reason, updatedAt: new Date() }).where(eq(schema.algoStrategies.id, b.s));
      await audit({ userId: b.u, actor: "risk-engine", action: "strategy-kill-on", strategyId: b.s, batchId, payload: { reason } });
    },
  };
}

/* ---------------- Reading for the dashboards ---------------- */

export async function unknownOrders(strategyId: number): Promise<number> {
  return requireDb().$count(schema.algoOrders, and(eq(schema.algoOrders.strategyId, strategyId), eq(schema.algoOrders.status, "unknown")));
}

/** Today's sent value and count for a strategy, and the person's sent value across live strategies. */
export async function sentToday(userId: string, strategyId: number, since: Date): Promise<{ strategy: { usd: number; count: number }; userUsd: number; recent: number[] }> {
  const db = requireDb();
  const rows = await db.select({ s: schema.algoOrders.strategyId, v: schema.algoOrders.estValue, at: schema.algoOrders.sentAt, status: schema.algoOrders.status, batch: schema.algoOrders.batchId })
    .from(schema.algoOrders).where(and(eq(schema.algoOrders.userId, userId), gte(schema.algoOrders.sentAt, since), notInArray(schema.algoOrders.status, ["rejected", "blocked"])));
  const mine = rows.filter((r) => r.s === strategyId);
  return { strategy: { usd: mine.reduce((t, r) => t + r.v, 0), count: mine.length }, userUsd: rows.reduce((t, r) => t + r.v, 0), recent: mine.map((r) => r.at?.getTime() ?? 0).filter((t) => Date.now() - t < 60_000) };
}

export async function ordersOf(userId: string, strategyId: number, limit = 100) {
  return requireDb().select().from(schema.algoOrders).where(and(eq(schema.algoOrders.userId, userId), eq(schema.algoOrders.strategyId, strategyId))).orderBy(desc(schema.algoOrders.createdAt)).limit(limit);
}

export async function batchesOf(userId: string, strategyId: number, limit = 10) {
  const db = requireDb();
  const batches = await db.select().from(schema.algoBatches).where(and(eq(schema.algoBatches.userId, userId), eq(schema.algoBatches.strategyId, strategyId))).orderBy(desc(schema.algoBatches.createdAt)).limit(limit);
  const orders = batches.length ? await db.select().from(schema.algoOrders).where(inArray(schema.algoOrders.batchId, batches.map((b) => b.id))).orderBy(schema.algoOrders.seq, schema.algoOrders.slice) : [];
  return batches.map((b) => ({ id: b.id, status: b.status, open: b.status === "proposed" && b.expiresAt.getTime() > Date.now(), source: b.source, confirmation: b.source === "engine" || b.source === "agent" ? confirmationPhrase(b) : null, createdAt: b.createdAt.toISOString(), approvedAt: b.approvedAt?.toISOString() ?? null, expiresAt: b.expiresAt.toISOString(), buyValue: b.buyValue, sellValue: b.sellValue, orderCount: b.orderCount, proposal: b.proposal, orders: orders.filter((o) => o.batchId === b.id).map((o) => ({ id: o.id, symbol: o.symbol, action: o.action, units: o.units, orderType: o.orderType, limitPrice: o.limitPrice, estValue: o.estValue, status: o.status as OrderState | string, filledUnits: o.filledUnits, fillPrice: o.fillPrice, error: o.error, slice: o.slice, slices: o.slices, notBefore: o.notBefore?.toISOString() ?? null, clientOrderId: o.clientOrderId })) }));
}

export async function decisionsOf(strategyId: number, limit = 20) {
  return requireDb().select().from(schema.algoDecisions).where(eq(schema.algoDecisions.strategyId, strategyId)).orderBy(desc(schema.algoDecisions.createdAt)).limit(limit);
}

export async function equityOf(strategyId: number) {
  return requireDb().select().from(schema.algoEquity).where(eq(schema.algoEquity.strategyId, strategyId)).orderBy(schema.algoEquity.date);
}
