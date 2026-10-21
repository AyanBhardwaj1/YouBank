/**
 * One strategy's tick: prices, a decision, orders, the risk engine, and then, by mode,
 * - paper: the orders go to the paper broker at once (same pipeline, same risk checks, simulated fills);
 * - live with approval: a batch is proposed and the person is told; nothing is sent until they tap;
 * - live autonomous: the live gate is checked again with everything read fresh, then the batch is sent.
 * Also on every tick: the paper broker re-checks resting orders, due TWAP slices of approved batches are
 * sent, live orders are reconciled with the broker (unknown outcomes included, never resent), the
 * strategy's own holdings are recounted from fills, and the day's equity is marked.
 *
 * Server only. Each tick holds a lease on its strategy, so two instances never tick it at once, and stops
 * before its deadline. Free strategies never open a premium scope, and nothing here calls a model.
 */
import { and, eq, gte, inArray, isNotNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireDb, schema } from "@/db";
import { canUseById } from "@/lib/billing/use";
import { isTradingDay, marketState, newYorkParts, nextTradingDay, type MarketState } from "@/lib/copytrade/markethours";
import { notify } from "@/lib/copytrade/ingest";
import { failureMessage } from "@/lib/errors";
import { lease } from "@/lib/locks";
import { audit, killState, liveEnabled, refuse, serverLimits } from "./access";
import { paperBroker, paperEquity, sweep, type PaperState } from "./brokers/paper";
import type { BrokerAdapter, BrokerQuote } from "./brokers/types";
import { liveAdapter } from "./connections";
import { copyTimeline, loadPanel, quotesFor } from "./data";
import { decide, historyWindow, isDecisionDay, needsTrade, type EvalState } from "./evaluate";
import { algoOrderId, FINAL, normaliseStatus, planOrders, sliceLimit, twap, type OrderState } from "./execution";
import { heldAtBroker, sendBatch, type RiskGate } from "./orders";
import { checkOrders, countDayTrades, type RiskState } from "./risk";
import { nextTickAt } from "./schedule";
import { pointInTime, quant, readSignals, targetWeights, tightenWithBudget } from "./signals";
import { dbStore, getStrategy, liveCheck, specOf, tickPolicy, type StrategyRow } from "./store";
import type { StrategySpec } from "./strategy";

const DAY = 86_400_000;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** A broker call takes at most 45 seconds; an order still "submitting" well after that lost its process mid-call. */
const STALE_SUBMIT_MS = 5 * 60_000;
const staleSubmitting = () => and(eq(schema.algoOrders.status, "submitting"), lt(schema.algoOrders.sentAt, new Date(Date.now() - STALE_SUBMIT_MS)));

export type TickResult = { strategyId: number; decided: boolean; orders: number; sent: number; proposed: boolean; skipped: string | null };

/** The strategies whose tick is due, oldest first. */
export async function dueStrategies(limit: number, now = new Date()): Promise<number[]> {
  const rows = await requireDb().select({ id: schema.algoStrategies.id }).from(schema.algoStrategies)
    .where(and(eq(schema.algoStrategies.status, "active"), inArray(schema.algoStrategies.mode, ["paper", "live_approval", "live_auto"]), lte(schema.algoStrategies.nextTickAt, now)))
    .orderBy(schema.algoStrategies.nextTickAt).limit(limit);
  return rows.map((r) => r.id);
}

/** The due strategies with their owners, oldest first (the tick loop runs different owners side by side). */
export async function dueStrategyOwners(limit: number, now = new Date()): Promise<{ id: number; userId: string }[]> {
  return requireDb().select({ id: schema.algoStrategies.id, userId: schema.algoStrategies.userId }).from(schema.algoStrategies)
    .where(and(eq(schema.algoStrategies.status, "active"), inArray(schema.algoStrategies.mode, ["paper", "live_approval", "live_auto"]), lte(schema.algoStrategies.nextTickAt, now)))
    .orderBy(schema.algoStrategies.nextTickAt).limit(limit);
}

/** Run one strategy's tick. `force` runs a decision now even when it is not a decision day (the person's "Run now"). */
export async function tickStrategy(id: number, deadline: number, opts: { force?: boolean; actor?: string } = {}): Promise<TickResult> {
  const release = await lease(`algo-tick:${id}`, 180_000);
  if (!release) return { strategyId: id, decided: false, orders: 0, sent: 0, proposed: false, skipped: "already ticking" };
  try {
    const [row] = await requireDb().select().from(schema.algoStrategies).where(eq(schema.algoStrategies.id, id));
    if (!row || row.status !== "active" || !["paper", "live_approval", "live_auto"].includes(row.mode)) return { strategyId: id, decided: false, orders: 0, sent: 0, proposed: false, skipped: "not active" };
    // A scheduled tick runs only while it is due: a retried Inngest step after a tick that finished does nothing.
    if (!opts.force && row.nextTickAt && row.nextTickAt.getTime() > Date.now()) return { strategyId: id, decided: false, orders: 0, sent: 0, proposed: false, skipped: "not due" };
    return await tick(row, deadline, opts);
  } catch (e) {
    const msg = failureMessage(e, "algo-tick");
    await audit({ userId: "system", actor: "system", action: "tick-failed", strategyId: id, payload: { message: msg } }).catch(() => undefined);
    await requireDb().update(schema.algoStrategies).set({ nextTickAt: new Date(Date.now() + 15 * 60_000) }).where(eq(schema.algoStrategies.id, id)).catch(() => undefined);
    return { strategyId: id, decided: false, orders: 0, sent: 0, proposed: false, skipped: msg };
  } finally {
    await release();
  }
}

async function tick(row: StrategyRow, deadline: number, opts: { force?: boolean; actor?: string }): Promise<TickResult> {
  const db = requireDb();
  const spec = specOf(row);
  const now = new Date();
  const crypto = spec.assetClass === "crypto";
  const market = marketState(now);
  const today = newYorkParts(now).date;
  const policy = await tickPolicy(row.userId);
  const res: TickResult = { strategyId: row.id, decided: false, orders: 0, sent: 0, proposed: false, skipped: null };
  const finish = async (patch: Partial<typeof schema.algoStrategies.$inferInsert> = {}) => {
    await db.update(schema.algoStrategies).set({ lastTickAt: now, nextTickAt: nextTickAt(spec, now, policy), updatedAt: now, ...patch }).where(eq(schema.algoStrategies.id, row.id));
    return res;
  };
  // Live modes need their plan now, not when they were switched on.
  if (row.mode !== "paper" && !(await canUseById(row.userId, "algo.live"))) {
    await db.update(schema.algoStrategies).set({ mode: "paper", updatedAt: now }).where(eq(schema.algoStrategies.id, row.id));
    await audit({ userId: row.userId, actor: "system", action: "strategy-mode", strategyId: row.id, payload: { from: row.mode, to: "paper", reason: "The plan no longer includes live trading." } });
    res.skipped = "plan lapsed";
    return finish();
  }
  const kill = await killState(row.userId);

  // Prices: history plus today's latest quote as today's provisional close.
  const window = historyWindow(spec);
  const from = new Date(now.getTime() - Math.ceil(window * 7 / 5 + 10) * DAY).toISOString().slice(0, 10);
  let targetSymbols: string[] = [];
  let targetInput: { weights: Record<string, number>; rationale: string } | { reason: string } | null = null;
  if (spec.signal.type === "target") {
    const t = await quant().targets.latestTarget(spec.signal.key).catch(() => null);
    if (t) {
      const w = targetWeights(t, now.toISOString(), { allowShort: false, maxGross: spec.risk.maxGross });
      targetInput = w.ok ? { weights: w.weights, rationale: w.rationale } : { reason: w.reason };
      if (w.ok) targetSymbols = Object.keys(w.weights);
    }
  }
  let copyWeights: Record<string, number> | null = null;
  const decisionDay = opts.force || isDecisionDay(spec.rebalance.every, today, crypto ? null : nextTradingDay(today, false));
  if (spec.signal.type === "copy13f" && decisionDay) copyWeights = (await copyTimeline(spec.signal.cik, spec.signal.top, 1).catch(() => [])).at(-1)?.weights ?? null;
  const symbols = [...new Set([...spec.universe, ...(spec.signal.type === "pairs" ? [spec.signal.a, spec.signal.b] : []), ...targetSymbols, ...Object.keys(copyWeights ?? {}), ...Object.keys(row.managed ?? {}), ...Object.keys((row.paper as PaperState | null)?.positions ?? {})])];
  const [loaded, quotes] = await Promise.all([loadPanel(symbols, spec.benchmark, from, { deadline: deadline - 20_000 }), quotesFor([...symbols, spec.benchmark])]);
  const panel = loaded.panel;
  if (!panel.dates.length) { res.skipped = "no prices"; return finish(); }
  if (panel.dates.at(-1)! < today && Object.keys(quotes).length) {
    panel.dates.push(today);
    for (const s of Object.keys(panel.closes)) panel.closes[s].push(quotes[s]?.last ?? panel.closes[s].at(-1)!);
  }
  const t = panel.dates.length - 1;
  const prices: Record<string, number> = Object.fromEntries(Object.entries(panel.closes).map(([k, xs]) => [k, xs[t]]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0));

  // Paper: re-check resting orders, then value the account.
  const paper = row.mode === "paper" ? ((row.paper as PaperState | null) ?? (await import("./brokers/paper")).newPaper(spec.capitalUsd)) : null;
  const quoteMap: Record<string, BrokerQuote> = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, quotes[k] ?? { symbol: k, bid: null, ask: null, last: v, at: now.toISOString() }]));
  if (paper) {
    sweep(paper, quoteMap, market.open, now); await syncPaperOrders(row.id, paper);
    // A paper send that died mid-way never saved its fill: it did not happen.
    await db.update(schema.algoOrders).set({ status: "rejected", error: "The paper order did not complete.", updatedAt: now }).where(and(eq(schema.algoOrders.strategyId, row.id), staleSubmitting(), inArray(schema.algoOrders.batchId, db.select({ id: schema.algoBatches.id }).from(schema.algoBatches).where(and(eq(schema.algoBatches.strategyId, row.id), eq(schema.algoBatches.accountId, "paper"))))));
  }

  // Live: the account, and reconciliation of what was sent.
  let live: { adapter: BrokerAdapter; accountId: string } | null = null;
  if (row.mode !== "paper" && row.connection && row.connection !== "paper" && row.accountId) {
    const a = await liveAdapter(row.userId, row.connection, row.accountId).catch(() => null);
    if (a) live = { adapter: a.adapter, accountId: row.accountId };
  }
  if (live) await reconcile(row, live.adapter, live.accountId, deadline);
  const managed = live ? await recountManaged(row.id, row.accountId!) : row.managed ?? {};
  const equity = paper ? paperEquity(paper, prices) : spec.capitalUsd + (row.accountId ? await liveFlows(row.id, row.accountId) : 0) + Object.entries(managed).reduce((s, [k, u]) => s + u * (prices[k] ?? 0), 0);

  // Equity marks: the day's start, the peak, today's close.
  const dayStart = row.equityDay === today ? row.equityDayStart ?? equity : equity;
  const peak = Math.max(row.equityPeak ?? equity, equity);
  await db.insert(schema.algoEquity).values({ strategyId: row.id, date: today, equity, benchmark: prices[spec.benchmark] ?? null }).onConflictDoUpdate({ target: [schema.algoEquity.strategyId, schema.algoEquity.date], set: { equity, benchmark: prices[spec.benchmark] ?? null } });
  const basePatch: Partial<typeof schema.algoStrategies.$inferInsert> = { equityPeak: peak, equityDayStart: dayStart, equityDay: today, ...(paper ? { paper } : {}) };

  // Due TWAP slices of batches already approved.
  if (live && !kill.global && !kill.user && !row.kill) res.sent += await sendDueSlices(row, spec, live.adapter, live.accountId, quoteMap, market, deadline);
  if (paper) res.sent += await sendDueSlices(row, spec, paperBroker(paper, { quotes: async () => quoteMap, isOpen: () => market.open, now: () => new Date() }), "paper", quoteMap, market, deadline, paper);

  if (!decisionDay) { res.skipped = "not a decision day"; return finish(basePatch); }
  if (!crypto && !market.open && !opts.force) { res.skipped = `market ${market.reason}`; return finish(basePatch); }
  if (Date.now() > deadline - 15_000) { res.skipped = "out of time"; return finish(basePatch); }

  // Decide.
  let external = null;
  if (spec.signal.type === "external") {
    const r = await readSignals({ producer: spec.signal.producer, symbols: spec.universe, live: true, asOf: now.toISOString(), from: new Date(now.getTime() - 365 * DAY).toISOString() });
    external = { signals: pointInTime(r.signals, now.toISOString(), { crypto }), refused: r.refused };
  }
  const d = decide(spec, panel, t, { state: row.state as EvalState, copyWeights, external, target: targetInput, equity });
  res.decided = true;
  const current = Object.fromEntries(Object.entries(paper ? Object.fromEntries(Object.entries(paper.positions).map(([k, p]) => [k, p.units])) : managed).map(([k, u]) => [k, equity > 0 ? (u * (prices[k] ?? 0)) / equity : 0]));
  const trade = d.ready && needsTrade(d.target.weights, current, spec.rebalance.drift);
  const [decision] = await db.insert(schema.algoDecisions).values({ strategyId: row.id, userId: row.userId, source: opts.actor ? "user" : "engine", mode: row.mode, target: d.target.weights, signals: d.signals.slice(0, 60), notes: d.notes.join(" ").slice(0, 4000) }).returning({ id: schema.algoDecisions.id });
  const patch = { ...basePatch, state: d.state as Record<string, unknown>, lastDecision: { at: now.toISOString(), id: decision.id, weights: d.target.weights, rationale: d.target.rationale.slice(0, 1500), trade } };
  if (!trade) { await audit({ userId: row.userId, actor: "engine", action: "decision", strategyId: row.id, payload: { decisionId: decision.id, target: d.target.weights, trade: false, notes: d.notes } }); return finish(patch); }

  // Orders.
  const account = paper
    ? { cash: paper.cash, positions: Object.entries(paper.positions).map(([k, p]) => ({ ticker: k, units: p.units, price: prices[k] ?? p.avgCost })), fractional: true, owned: Object.fromEntries(Object.entries(paper.positions).map(([k, p]) => [k, p.units])) }
    : live
      ? await (async () => {
        const [pos, bal] = await Promise.all([live!.adapter.positions(live!.accountId), live!.adapter.balances(live!.accountId)]);
        return { cash: bal.cash, positions: pos.map((p) => ({ ticker: p.symbol, units: p.units, price: p.price || prices[p.symbol] || 0 })), fractional: live!.adapter.capabilities().fractional, owned: managed };
      })()
      : null;
  if (!account) { res.skipped = "no connected account"; await audit({ userId: row.userId, actor: "engine", action: "decision", strategyId: row.id, payload: { decisionId: decision.id, trade: true, blocked: "The strategy's broker connection is missing." } }); return finish(patch); }
  const budget = paper ? equity : Math.max(0, Math.min(equity, account.cash + account.positions.reduce((s, p) => s + p.units * p.price, 0)));
  const plan = planOrders({ spec, weights: d.target.weights, budgetUsd: budget, cash: account.cash, positions: account.positions, managed: account.owned, prices, fractional: account.fractional });
  res.orders = plan.orders.length;
  await db.update(schema.algoDecisions).set({ orders: plan.orders.length }).where(eq(schema.algoDecisions.id, decision.id));
  await audit({ userId: row.userId, actor: "engine", action: "decision", strategyId: row.id, payload: { decisionId: decision.id, target: d.target.weights, notes: d.notes, orders: plan.orders, skipped: plan.skipped, warnings: plan.warnings } });
  if (!plan.orders.length) return finish(patch);
  if (kill.global || kill.user || row.kill) { res.skipped = "kill switch on"; return finish(patch); }
  // Orders from an earlier decision that may still fill (working limits, scheduled slices, unknown outcomes)
  // are not in the holdings yet: a new batch now would order the same shares twice. Wait for them.
  // (Slices of batches that were never approved, expired or were canceled do not count.)
  const [{ working }] = await db.select({ working: sql<number>`count(*)::int` }).from(schema.algoOrders).innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId))
    .where(and(eq(schema.algoOrders.strategyId, row.id), eq(schema.algoBatches.accountId, paper ? "paper" : live!.accountId), inArray(schema.algoOrders.status, ["submitting", "accepted", "partially_filled", "scheduled", "unknown"]), inArray(schema.algoBatches.status, ["placing", "placed", "partial"]), gte(schema.algoOrders.createdAt, new Date(now.getTime() - 4 * DAY))));
  if (working) {
    res.skipped = "earlier orders still working";
    await audit({ userId: row.userId, actor: "engine", action: "decision-deferred", strategyId: row.id, payload: { decisionId: decision.id, working, reason: "Earlier orders may still fill; no new orders until they settle." } });
    return finish(patch);
  }
  // An unapproved batch from an earlier decision is out of date now.
  await db.update(schema.algoBatches).set({ status: "expired", updatedAt: now }).where(and(eq(schema.algoBatches.strategyId, row.id), eq(schema.algoBatches.status, "proposed")));

  // The batch: one row per order or TWAP slice. Slices after the first wait for their time.
  const batchId = await createBatch(row, spec, decision.id, plan.orders, paper ? "paper" : live!.accountId, live?.adapter ?? null, "engine", now);
  if (paper) {
    const adapter = paperBroker(paper, { quotes: async () => quoteMap, isOpen: () => market.open, now: () => new Date() });
    res.sent += (await sendSafely(row, batchId, () => send(row, spec, batchId, adapter, "paper", market, true, { paper }))).sent;
    return finish({ ...patch, paper });
  }
  if (row.mode === "live_approval") {
    res.proposed = true;
    await notify(row.userId, { key: `algo:batch:${batchId}`, title: `Orders to review: ${row.name}`, body: `${plan.orders.length} order${plan.orders.length === 1 ? "" : "s"} from your strategy's rules. Nothing is sent until you approve; they expire in ${serverLimits().proposalMinutes} minutes.`, url: `/app/algo?strategy=${row.id}&tab=live`, reasons: ["Live strategy"] }).catch(() => false);
    return finish(patch);
  }
  // Autonomous: the gate again, with everything read fresh.
  const g = await liveCheck({ id: row.userId, email: "" }, row, "live_auto", null, null);
  if (!g.ok) {
    await requireDb().update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(eq(schema.algoBatches.id, batchId));
    await audit({ userId: row.userId, actor: "engine", action: "autonomous-blocked", strategyId: row.id, batchId, payload: { unmet: g.unmet } });
    await notify(row.userId, { key: `algo:blocked:${row.id}:${today}`, title: `${row.name} did not trade`, body: g.unmet[0]?.message ?? "A requirement for autonomous trading is no longer met.", url: `/app/algo?strategy=${row.id}`, reasons: ["Autonomous strategy"] }).catch(() => false);
    res.skipped = "gate";
    return finish(patch);
  }
  res.sent += (await sendSafely(row, batchId, () => send(row, spec, batchId, live!.adapter, live!.accountId, market, true))).sent;
  return finish(patch);
}

/**
 * A send from a tick: a refusal (a limit, a closed market) or a broker failure is recorded and the tick
 * carries on, so the decision and the strategy's state are still saved. Nothing is retried here.
 */
async function sendSafely(row: StrategyRow, batchId: number, fn: () => ReturnType<typeof send>): Promise<{ sent: number }> {
  try { return await fn(); } catch (e) {
    await audit({ userId: row.userId, actor: "engine", action: "send-failed", strategyId: row.id, batchId, payload: { message: failureMessage(e, "algo-send") } });
    await requireDb().update(schema.algoBatches).set({ status: "failed", updatedAt: new Date() }).where(and(eq(schema.algoBatches.id, batchId), eq(schema.algoBatches.status, "proposed")));
    return { sent: 0 };
  }
}

/** Store a batch and its orders (TWAP slices included). Returns the batch id. */
export async function createBatch(row: StrategyRow, spec: StrategySpec, decisionId: number, orders: ReturnType<typeof planOrders>["orders"], accountId: string, adapter: BrokerAdapter | null, source: "engine" | "agent" | "user", now: Date, assetClass: "equity" | "crypto" | "option" = spec.assetClass === "crypto" ? "crypto" : "equity"): Promise<number> {
  const db = requireDb();
  const buy = orders.filter((o) => o.action === "BUY").reduce((s, o) => s + o.estValue, 0), sell = orders.filter((o) => o.action === "SELL").reduce((s, o) => s + o.estValue, 0);
  const [b] = await db.insert(schema.algoBatches).values({ userId: row.userId, strategyId: row.id, decisionId, source, accountId, buyValue: buy, sellValue: sell, orderCount: orders.length, proposal: { orders }, expiresAt: new Date(now.getTime() + serverLimits().proposalMinutes * 60_000) }).returning({ id: schema.algoBatches.id });
  const values: (typeof schema.algoOrders.$inferInsert)[] = [];
  for (const [seq, o] of orders.entries()) {
    const symbolId = adapter?.resolveSymbol ? await adapter.resolveSymbol(accountId, o.ticker).catch(() => null) : null;
    const slices = twap(o.units, o.price, now, { thresholdUsd: spec.execution.twapThresholdUsd, slices: spec.execution.slices, minutes: spec.execution.minutes, fractional: !adapter || adapter.capabilities().fractional, limitPrice: o.limitPrice });
    for (const sl of slices) {
      const id = algoOrderId(row.id, decisionId, seq, sl.seq);
      values.push({ batchId: b.id, userId: row.userId, strategyId: row.id, seq, slice: sl.seq, slices: sl.of, clientOrderId: id.uuid, symbol: o.ticker, assetClass, symbolId, action: o.action, units: sl.units, orderType: spec.execution.orderType, limitPrice: sl.limitPrice, estValue: sl.units * o.price, status: sl.seq === 0 ? "pending" : "scheduled", notBefore: new Date(sl.notBefore) });
    }
  }
  if (values.length) await db.insert(schema.algoOrders).values(values);
  return b.id;
}

const prevTradingDay = (d: string) => { let p = d; for (let i = 0; i < 10; i++) { p = new Date(Date.parse(`${p}T12:00:00Z`) - DAY).toISOString().slice(0, 10); if (isTradingDay(p)) return p; } return p; };

/** The risk state for a strategy now, read fresh. */
export async function riskStateFor(row: StrategyRow, spec: StrategySpec, prices: Record<string, number>, refPrices: Record<string, number>, positions: Record<string, number>, equity: number, market: MarketState | null, account: { type: "cash" | "margin" | "unknown"; equity: number; dayTradeCount?: number | null; pdt?: boolean | null }): Promise<RiskState> {
  const db = requireDb();
  const kill = await killState(row.userId);
  const today = newYorkParts(new Date()).date;
  const since = new Date(Date.now() - 31 * DAY);
  const orders = await db.select({ s: schema.algoOrders.strategyId, v: schema.algoOrders.estValue, at: schema.algoOrders.sentAt, status: schema.algoOrders.status, symbol: schema.algoOrders.symbol, action: schema.algoOrders.action, filled: schema.algoOrders.filledUnits, fill: schema.algoOrders.fillPrice, account: schema.algoBatches.accountId })
    .from(schema.algoOrders).innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId))
    .where(and(eq(schema.algoOrders.userId, row.userId), isNotNull(schema.algoOrders.sentAt), gte(schema.algoOrders.sentAt, since)));
  const sentToday = orders.filter((o) => o.at && newYorkParts(o.at).date === today && !["rejected", "blocked"].includes(o.status));
  const mine = sentToday.filter((o) => o.s === row.id);
  const todaySides: Record<string, ("buy" | "sell")[]> = {};
  for (const o of mine) (todaySides[o.symbol] ??= []).push(o.action === "BUY" ? "buy" : "sell");
  // Day trades in the last five business days (the broker's own count when it reports one).
  const days = [today];
  while (days.length < 5) days.push(prevTradingDay(days.at(-1)!));
  const sameAccount = orders.filter((o) => o.account === (row.mode === "paper" ? "paper" : row.accountId) && o.filled > 0 && o.at);
  const dayTrades = account.dayTradeCount ?? countDayTrades(sameAccount.map((o) => ({ symbol: o.symbol, side: o.action === "BUY" ? "buy" as const : "sell" as const, date: newYorkParts(o.at!).date })), days);
  // Sales at a loss in the last 30 days: a fill below the average price this strategy paid (wash-sale warnings).
  const lossSales: Record<string, string> = {};
  const cost = new Map<string, { u: number; c: number }>();
  for (const o of [...orders].filter((x) => x.s === row.id && x.filled > 0 && x.fill).sort((x, y) => (x.at!.getTime() - y.at!.getTime()))) {
    const k = cost.get(o.symbol) ?? { u: 0, c: 0 };
    if (o.action === "BUY") { k.c += o.filled * o.fill!; k.u += o.filled; }
    else { const avg = k.u > 0 ? k.c / k.u : o.fill!; if (o.fill! < avg) lossSales[o.symbol] = newYorkParts(o.at!).date; k.c -= avg * Math.min(o.filled, k.u); k.u = Math.max(0, k.u - o.filled); }
    cost.set(o.symbol, k);
  }
  // Unknown outcomes, and sends whose process died mid-call (still "submitting" long after): either may have reached the broker.
  const unknown = await db.$count(schema.algoOrders, and(eq(schema.algoOrders.strategyId, row.id), or(eq(schema.algoOrders.status, "unknown"), staleSubmitting())));
  const live = row.mode !== "paper";
  return {
    now: new Date(), market: spec.assetClass === "crypto" ? null : market, extendedHoursNow: false,
    kill: { global: kill.global, user: kill.user, strategy: row.kill },
    equity, startOfDayEquity: row.equityDay === today ? row.equityDayStart ?? equity : equity, peakEquity: Math.max(row.equityPeak ?? equity, equity),
    positions, prices, refPrices,
    sentToday: { usd: mine.reduce((s, o) => s + o.v, 0), count: mine.length },
    // The server's daily ceiling counts real orders across the person's strategies; a paper strategy only its own.
    userSentTodayUsd: live ? sentToday.filter((o) => o.account !== "paper").reduce((s, o) => s + o.v, 0) : mine.reduce((s, o) => s + o.v, 0),
    recentOrderTimes: mine.map((o) => o.at!.getTime()).filter((x) => Date.now() - x < 60_000), unknownOrders: unknown,
    server: serverLimits(), account: { type: account.type, equity: account.equity, dayTradesLast5: dayTrades, pdtFlagged: account.pdt ?? false }, todaySides, lossSales,
  };
}

/** A live strategy's cash flows from fills in an account: sells in, buys out. Equity = capital + flows + holdings at market. */
export async function liveFlows(strategyId: number, accountId: string): Promise<number> {
  const [r] = await requireDb().select({ v: sql<number>`coalesce(sum(case when ${schema.algoOrders.action} = 'SELL' then 1 else -1 end * ${schema.algoOrders.filledUnits} * coalesce(${schema.algoOrders.fillPrice}, 0)), 0)::float8` })
    .from(schema.algoOrders).innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId))
    .where(and(eq(schema.algoOrders.strategyId, strategyId), eq(schema.algoBatches.accountId, accountId), sql`${schema.algoOrders.filledUnits} > 0`));
  return Number(r?.v ?? 0);
}

/** Send a stored batch through the risk engine and the broker (the claim makes it once-only). For paper, `paper` is the account the adapter fills into; it is saved afterwards. */
export async function send(row: StrategyRow, spec: StrategySpec, batchId: number, adapter: BrokerAdapter, accountId: string, market: MarketState, autonomous: boolean, opts: { paper?: PaperState; user?: { id: string; email: string }; approval?: { idemKey: string; confirmation: string; ip: string | null; userAgent: string | null } } = {}): Promise<{ sent: number; message: string; blocked: { ticker: string; reasons: string[] }[]; status: string }> {
  // Every real order passes here (ticks, TWAP slices, approvals, close-outs, the agent's): the server switch first.
  if (adapter.id !== "paper" && !liveEnabled()) throw refuse("Real trading is switched off on this server, so orders cannot be sent. Paper trading keeps working.", 403);
  const store = dbStore(adapter.id);
  const fresh = await getStrategy(row.userId, row.id);
  // Crypto trades around the clock: the exchange calendar does not apply to it.
  const mkt: MarketState = spec.assetClass === "crypto" ? { ...market, open: true, reason: "open" } : market;
  const [batch] = await requireDb().select({ source: schema.algoBatches.source }).from(schema.algoBatches).where(eq(schema.algoBatches.id, batchId));
  const liquidation = batch?.source === "liquidate";
  const rows = await store.algoOrders(batchId);
  const symbols = [...new Set([...rows.map((o) => o.ticker), spec.benchmark])];
  const quotes = await quotesFor(symbols);
  const prices = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, q.last ?? 0]).filter(([, v]) => (v as number) > 0));
  // The fat-finger reference: the last daily close from the price history, not the quote the order is priced from.
  const hist = await loadPanel(symbols, spec.benchmark, new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10)).catch(() => null);
  const today = newYorkParts(new Date()).date;
  const refPrices: Record<string, number> = {};
  for (const s of symbols) { const xs = hist?.panel.closes[s] ?? []; const ds = hist?.panel.dates ?? []; for (let i = ds.length - 1; i >= 0; i--) if (ds[i] < today && xs[i] > 0) { refPrices[s] = xs[i]; break; } }
  const accounts = await adapter.accounts().catch(() => []);
  const acct = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const paper = opts.paper ?? (adapter.id === "paper" ? (fresh.paper as PaperState | null) : null);
  const positions = paper ? Object.fromEntries(Object.entries(paper.positions).map(([k, p]) => [k, p.units])) : fresh.managed ?? {};
  const equity = paper ? paperEquity(paper, prices) : spec.capitalUsd + (fresh.accountId ? await liveFlows(fresh.id, fresh.accountId) : 0) + Object.entries(positions).reduce((s, [k, u]) => s + u * (prices[k] ?? 0), 0);
  // What the risk engine may sell: the strategy's own units, but never more than the broker reports now
  // (shares sold outside YouBank, or a fill not yet reconciled), so a sell can never open a short.
  const sellable = paper ? positions : await heldAtBroker(adapter, accountId, positions);
  const limits = tightenWithBudget(spec.risk, await quant().budgets.riskBudget(row.userId, row.accountId).catch(() => null)).limits;
  const risk: RiskGate = async (orders) => {
    const px = { ...prices, ...Object.fromEntries(orders.filter((o) => !prices[o.row.ticker]).map((o) => [o.row.ticker, o.order.price])) };
    const st = await riskStateFor(fresh, spec, px, refPrices, sellable, equity, market, { type: acct?.type ?? "unknown", equity: acct?.equity ?? equity, dayTradeCount: acct?.dayTradeCount, pdt: acct?.patternDayTrader });
    return checkOrders(limits, st, orders.map((o) => ({ ...o.order, price: o.row.assetClass === "option" ? o.order.price : px[o.row.ticker] || o.order.price, manualLiquidation: liquidation && o.order.side === "sell" })));
  };
  const r = await sendBatch(store, adapter, accountId, risk, {
    batchId, user: opts.user ?? { id: row.userId, email: "engine" }, idemKey: opts.approval?.idemKey ?? `auto-${batchId}-${randomUUID().slice(0, 8)}`, confirmation: opts.approval?.confirmation ?? "", now: new Date(), market: mkt,
    // A close-out only reduces risk: the notional checks inside the approval step stand aside for it (0 = off), as the risk engine's do.
    maxDayUsd: liquidation ? 0 : Math.min(limits.maxDayUsd, serverLimits().maxDayUsd), maxOrderUsd: liquidation ? 0 : Math.min(limits.maxOrderUsd, serverLimits().maxOrderUsd), autonomous, ip: opts.approval?.ip ?? null, userAgent: opts.approval?.userAgent ?? null,
  });
  if (paper) await requireDb().update(schema.algoStrategies).set({ paper, updatedAt: new Date() }).where(eq(schema.algoStrategies.id, row.id));
  // The paper broker fills at once: record the fills on the orders, as reconciliation does for real brokers.
  if (paper) for (const o of await store.algoOrders(batchId)) {
    if (!o.brokerageOrderId) continue;
    const po = paper.orders.find((x) => x.id === o.brokerageOrderId);
    if (po) await requireDb().update(schema.algoOrders).set({ status: normaliseStatus("paper", po.status === "resting" ? "accepted" : po.status), filledUnits: po.filledQty, fillPrice: po.avgPrice, error: po.reason ?? o.error, updatedAt: new Date() }).where(eq(schema.algoOrders.id, o.id));
  }
  return { sent: r.orders.filter((o) => !["pending", "blocked", "scheduled", "rejected", "unknown"].includes(o.status)).length, message: r.message, blocked: r.blocked, status: r.status };
}

/** Send TWAP slices whose time has come, for batches the person approved (or autonomous/paper ones), each re-priced and risk-checked. */
async function sendDueSlices(row: StrategyRow, spec: StrategySpec, adapter: BrokerAdapter, accountId: string, quotes: Record<string, BrokerQuote>, market: MarketState, deadline: number, paper?: PaperState): Promise<number> {
  const db = requireDb();
  const due = await db.select({ o: schema.algoOrders, b: schema.algoBatches }).from(schema.algoOrders).innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId))
    // Only slices of batches made for this account: a paper batch's slices never reach a real broker (or a
    // live batch's the paper account) after the strategy's mode or account changes.
    .where(and(eq(schema.algoOrders.strategyId, row.id), eq(schema.algoBatches.accountId, accountId), eq(schema.algoOrders.status, "scheduled"), lte(schema.algoOrders.notBefore, new Date()), inArray(schema.algoBatches.status, ["placed", "partial"]))).limit(20);
  if (!due.length) return 0;
  if (adapter.id !== "paper" && !liveEnabled()) {
    await db.update(schema.algoOrders).set({ status: "expired", error: "Real trading was switched off on this server before this slice's time.", updatedAt: new Date() }).where(inArray(schema.algoOrders.id, due.map((d) => d.o.id)));
    return 0;
  }
  if (spec.assetClass !== "crypto" && !market.open) {
    await db.update(schema.algoOrders).set({ status: "expired", error: "The market closed before this slice's time.", updatedAt: new Date() }).where(inArray(schema.algoOrders.id, due.map((d) => d.o.id)));
    return 0;
  }
  const [child] = await db.insert(schema.algoBatches).values({ userId: row.userId, strategyId: row.id, decisionId: due[0].b.decisionId, source: "twap", accountId, buyValue: 0, sellValue: 0, orderCount: due.length, proposal: { parent: due[0].b.id }, expiresAt: new Date(Date.now() + 10 * 60_000) }).returning({ id: schema.algoBatches.id });
  for (const { o } of due) {
    const px = quotes[o.symbol]?.last;
    const limit = o.orderType === "Limit" && px ? sliceLimit(px, o.action as "BUY" | "SELL", spec.execution.limitBandBps) : o.limitPrice;
    await db.update(schema.algoOrders).set({ batchId: child.id, status: "pending", limitPrice: limit, estValue: px ? o.units * px : o.estValue, updatedAt: new Date() }).where(and(eq(schema.algoOrders.id, o.id), eq(schema.algoOrders.status, "scheduled")));
  }
  if (Date.now() > deadline - 10_000) return 0;
  return (await sendSafely(row, child.id, () => send(row, spec, child.id, adapter, accountId, market, true, { paper }))).sent;
}

/** Paper fills happen inside the paper account (on later sweeps too): copy them onto the stored orders. */
async function syncPaperOrders(strategyId: number, paper: PaperState): Promise<void> {
  const db = requireDb();
  const open = await db.select().from(schema.algoOrders).where(and(eq(schema.algoOrders.strategyId, strategyId), inArray(schema.algoOrders.status, ["accepted", "partially_filled"]), isNotNull(schema.algoOrders.brokerOrderId)));
  for (const o of open) {
    const po = paper.orders.find((x) => x.id === o.brokerOrderId);
    if (!po || po.status === "resting") continue;
    await db.update(schema.algoOrders).set({ status: normaliseStatus("paper", po.status), filledUnits: po.filledQty, fillPrice: po.avgPrice, error: po.reason ?? o.error, updatedAt: new Date() }).where(eq(schema.algoOrders.id, o.id));
  }
}

/** Ask the broker about this strategy's sent orders that are not final (and those with unknown outcomes, by client id where the broker can look one up). */
async function reconcile(row: StrategyRow, adapter: BrokerAdapter, accountId: string, deadline: number): Promise<void> {
  const db = requireDb();
  // A send that died mid-call (the instance stopped) left its order "submitting": it may have reached the
  // broker, so it is "unknown" from now on, never resent, and asked about by client id where possible.
  const stale = await db.update(schema.algoOrders).set({ status: "unknown", error: "The broker did not confirm this order. It may or may not have been placed: check your broker before trying again.", updatedAt: new Date() })
    .where(and(eq(schema.algoOrders.strategyId, row.id), staleSubmitting(), inArray(schema.algoOrders.batchId, db.select({ id: schema.algoBatches.id }).from(schema.algoBatches).where(and(eq(schema.algoBatches.strategyId, row.id), eq(schema.algoBatches.accountId, accountId)))))).returning({ id: schema.algoOrders.id, batchId: schema.algoOrders.batchId });
  for (const o of stale) await audit({ userId: row.userId, actor: "system", action: "order-unknown", strategyId: row.id, batchId: o.batchId, orderId: o.id, payload: { stage: "place", reason: "The send stopped before the broker answered." } });
  const open = await db.select().from(schema.algoOrders).where(and(eq(schema.algoOrders.strategyId, row.id), isNotNull(schema.algoOrders.sentAt), gte(schema.algoOrders.sentAt, new Date(Date.now() - 4 * DAY)), notInArray(schema.algoOrders.status, [...FINAL, "blocked", "scheduled", "pending"]))).limit(40);
  const byClient = adapter.capabilities().clientOrderId !== "none" && adapter.id !== "snaptrade";
  for (const o of open) {
    if (Date.now() > deadline - 20_000) break;
    if (!o.brokerOrderId && !(o.status === "unknown" && byClient)) continue;
    const info = await adapter.orderStatus(accountId, { brokerOrderId: o.brokerOrderId, clientOrderId: o.clientOrderId }).catch(() => null);
    if (!info) continue;
    const status: OrderState = normaliseStatus(adapter.id, info.status);
    await db.update(schema.algoOrders).set({ status, brokerOrderId: info.brokerOrderId || o.brokerOrderId, filledUnits: info.filledQty, fillPrice: info.avgFillPrice ?? o.fillPrice, updatedAt: new Date() }).where(eq(schema.algoOrders.id, o.id));
    if (status !== o.status) await audit({ userId: row.userId, actor: "system", action: o.status === "unknown" ? "order-reconciled" : "order-status", strategyId: row.id, batchId: o.batchId, orderId: o.id, payload: { from: o.status, to: status, filled: info.filledQty, price: info.avgFillPrice } });
  }
}

/** A live strategy's own holdings: filled buys less filled sells in the account it trades in now. */
async function recountManaged(strategyId: number, accountId: string): Promise<Record<string, number>> {
  const db = requireDb();
  const rows = await db.select({ s: schema.algoOrders.symbol, a: schema.algoOrders.action, f: schema.algoOrders.filledUnits }).from(schema.algoOrders)
    .innerJoin(schema.algoBatches, eq(schema.algoBatches.id, schema.algoOrders.batchId)).where(and(eq(schema.algoOrders.strategyId, strategyId), eq(schema.algoBatches.accountId, accountId), sql`${schema.algoOrders.filledUnits} > 0`));
  const m: Record<string, number> = {};
  for (const r of rows) m[r.s] = (m[r.s] ?? 0) + (r.a === "BUY" ? r.f : -r.f);
  for (const k of Object.keys(m)) if (m[k] <= 1e-6) delete m[k]; else m[k] = r6(m[k]);
  await db.update(schema.algoStrategies).set({ managed: m }).where(eq(schema.algoStrategies.id, strategyId));
  return m;
}

