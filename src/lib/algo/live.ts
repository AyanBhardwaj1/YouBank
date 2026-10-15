/**
 * What a person does to a strategy's orders: approve a proposed batch, cancel it, cancel a sent order,
 * close all of a strategy's positions, run a tick now, and backtests on demand. Server only; each checks
 * the plan, the consents and the live gate again with fresh state, and writes the audit log.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { marketState } from "@/lib/copytrade/markethours";
import { audit, liveEnabled, refuse, requireConsent, type Meta } from "./access";
import { runBacktest, thinCurve, walkForward, type BacktestResult } from "./backtest";
import { paperBroker, type PaperState } from "./brokers/paper";
import { liveAdapter } from "./connections";
import { US_EQUITY, CRYPTO } from "./costs";
import { copyTimeline, loadPanel, quotesFor, windowFor } from "./data";
import { planOrders } from "./execution";
import { quant, readSignals } from "./signals";
import { getStrategy, liveCheck, specOf, type StrategyRow } from "./store";
import { parseStrategy, type StrategySpec } from "./strategy";
import { createBatch, send, tickStrategy } from "./tick";

type Person = Pick<CurrentUser, "id" | "email">;

async function adapterOf(row: StrategyRow) {
  if (row.mode === "paper" || row.connection === "paper") {
    const paper = row.paper as PaperState;
    const m = marketState();
    return { adapter: paperBroker(paper, { quotes: quotesFor, isOpen: () => m.open, now: () => new Date() }), accountId: "paper", paper };
  }
  if (!row.connection || !row.accountId) throw refuse("Choose the brokerage account this strategy trades in.", 409);
  const a = await liveAdapter(row.userId, row.connection, row.accountId);
  if (!a) throw refuse("This strategy's broker connection is gone. Reconnect it, or choose another.", 409);
  return { adapter: a.adapter, accountId: row.accountId, paper: undefined };
}

/** Approve a proposed live batch and send it, once (a repeat with the same key sends nothing). */
export async function approveAlgoBatch(user: Person, batchId: number, body: { idempotencyKey?: unknown; confirmation?: unknown }, meta: Meta) {
  const [b] = await requireDb().select().from(schema.algoBatches).where(and(eq(schema.algoBatches.id, batchId), eq(schema.algoBatches.userId, user.id)));
  if (!b) throw refuse("That batch of orders was not found.", 404);
  const row = await getStrategy(user.id, b.strategyId);
  if (row.mode === "paper") throw refuse("Paper strategies fill on their own; there is nothing to approve.");
  if (row.mode !== "live_approval" && row.mode !== "live_auto") throw refuse("This strategy is not in a live mode, so its orders cannot be sent.", 409);
  if (b.accountId !== row.accountId) throw refuse("This batch was made for another account. Review a fresh set.", 409);
  await requireFeature(user, "algo.live");
  if (!liveEnabled()) throw refuse("Real trading is switched off on this server, so orders cannot be sent. Paper trading keeps working.", 403);
  await requireConsent(user.id, "terms");
  await requireConsent(user.id, "live");
  if (b.status === "proposed") {
    const g = await liveCheck(user, row, "live_approval", null, null);
    if (!g.ok) throw refuse(g.unmet[0].message, 409);
  }
  const spec = specOf(row);
  const { adapter, accountId } = await adapterOf(row);
  return send(row, spec, batchId, adapter, accountId, marketState(), false, { user, approval: { idemKey: String(body.idempotencyKey ?? ""), confirmation: String(body.confirmation ?? ""), ip: meta.ip, userAgent: meta.userAgent } });
}

export async function cancelAlgoBatch(user: Person, batchId: number, meta: Meta): Promise<void> {
  const db = requireDb();
  const won = await db.update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoBatches.id, batchId), eq(schema.algoBatches.userId, user.id), eq(schema.algoBatches.status, "proposed"))).returning({ id: schema.algoBatches.id, s: schema.algoBatches.strategyId });
  if (!won.length) throw refuse("Only a batch that has not been approved can be canceled here. Orders already sent can be canceled one by one.", 409);
  await db.update(schema.algoOrders).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.algoOrders.batchId, batchId), sql`${schema.algoOrders.status} in ('pending','scheduled')`));
  await audit({ userId: user.id, actor: user.email, action: "batch-cancel", strategyId: won[0].s, batchId, payload: {}, ...meta });
}

/** Ask the broker to cancel one sent, open order (or drop a scheduled TWAP slice). */
export async function cancelAlgoOrder(user: Person, orderId: number, meta: Meta): Promise<void> {
  const db = requireDb();
  const [o] = await db.select().from(schema.algoOrders).where(and(eq(schema.algoOrders.id, orderId), eq(schema.algoOrders.userId, user.id)));
  if (!o) throw refuse("That order was not found.", 404);
  if (o.status === "scheduled" || o.status === "pending") {
    await db.update(schema.algoOrders).set({ status: "canceled", updatedAt: new Date() }).where(eq(schema.algoOrders.id, orderId));
  } else {
    if (!o.brokerOrderId || !["accepted", "partially_filled"].includes(o.status)) throw refuse("Only an open order can be canceled.", 409);
    const row = await getStrategy(user.id, o.strategyId);
    const { adapter, accountId, paper } = await adapterOf(row);
    await adapter.cancel(accountId, o.brokerOrderId);
    if (paper) await db.update(schema.algoStrategies).set({ paper }).where(eq(schema.algoStrategies.id, row.id));
    await db.update(schema.algoOrders).set({ status: "canceled", updatedAt: new Date() }).where(eq(schema.algoOrders.id, orderId));
  }
  await audit({ userId: user.id, actor: user.email, action: "order-cancel", strategyId: o.strategyId, orderId, payload: { clientOrderId: o.clientOrderId, brokerOrderId: o.brokerOrderId } }, );
  void meta;
}

/**
 * Sell everything a strategy holds (its own holdings only; never the person's other positions). Passes a
 * user or strategy kill switch (the person's own instruction), never the global one. Live: sent at once,
 * with the typed confirmation "CLOSE <name>" in place of a batch approval.
 */
export async function liquidate(user: Person, id: number, body: { confirmation?: unknown }, meta: Meta) {
  const row = await getStrategy(user.id, id);
  const spec = specOf(row);
  const live = row.mode !== "paper";
  if (live) {
    await requireFeature(user, "algo.live");
    if (!liveEnabled()) throw refuse("Real trading is switched off on this server.", 403);
    await requireConsent(user.id, "live");
    if (String(body.confirmation ?? "").trim().toUpperCase() !== `CLOSE ${row.name.toUpperCase()}`) throw refuse(`Type "CLOSE ${row.name.toUpperCase()}" to sell this strategy's positions.`, 400);
  }
  const { adapter, accountId, paper } = await adapterOf(row);
  const held: Record<string, number> = paper ? Object.fromEntries(Object.entries(paper.positions).map(([k, p]) => [k, p.units])) : row.managed ?? {};
  if (!Object.keys(held).length) throw refuse("This strategy holds nothing.", 409);
  const q = await quotesFor(Object.keys(held));
  const prices = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.last ?? 0]));
  const plan = planOrders({ spec: { ...spec, execution: { ...spec.execution, twapThresholdUsd: 10_000_000 }, risk: { ...spec.risk, maxOrderUsd: 1_000_000 } }, weights: {}, budgetUsd: 0, cash: 0, positions: Object.entries(held).map(([k, u]) => ({ ticker: k, units: u, price: prices[k] ?? 0 })), managed: held, prices, fractional: adapter.capabilities().fractional });
  const [d] = await requireDb().insert(schema.algoDecisions).values({ strategyId: id, userId: user.id, source: "user", mode: row.mode, target: {}, notes: "Close all positions (the person's instruction)." }).returning({ id: schema.algoDecisions.id });
  const batchId = await createBatch(row, { ...spec, execution: { ...spec.execution, twapThresholdUsd: 10_000_000 } }, d.id, plan.orders, accountId, paper ? null : adapter, "user", new Date());
  await requireDb().update(schema.algoBatches).set({ source: "liquidate" }).where(eq(schema.algoBatches.id, batchId));
  await audit({ userId: user.id, actor: user.email, action: "liquidate", strategyId: id, batchId, payload: { orders: plan.orders, skipped: plan.skipped }, ...meta });
  return send(row, spec, batchId, adapter, accountId, marketState(), true, { paper, user, approval: { idemKey: `liquidate-${batchId}-${Date.now().toString(36)}`, confirmation: "", ip: meta.ip, userAgent: meta.userAgent } });
}

/** Run a strategy's decision now ("Run now"): paper fills, approval proposes, autonomous sends, as on schedule. */
export async function runNow(user: Person, id: number, meta: Meta) {
  const row = await getStrategy(user.id, id);
  if (row.status !== "active") throw refuse("Resume the strategy first.", 409);
  if (row.mode === "backtest") throw refuse("Backtest-mode strategies do not trade. Switch to paper to run it.", 409);
  await audit({ userId: user.id, actor: user.email, action: "run-now", strategyId: id, payload: {}, ...meta });
  return tickStrategy(id, Date.now() + 50_000, { force: true, actor: user.email });
}

/* ---------------- Backtests ---------------- */

const specHash = (s: StrategySpec) => createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 24);

/**
 * Backtest a saved strategy or an unsaved spec over `years`, optionally with walk-forward. Every run is a
 * trial (contract rule 3): it is logged through Quant's trial logger and counted on the strategy, and the
 * deflated Sharpe uses that count.
 */
export async function backtestFor(user: Person, body: { strategyId?: unknown; spec?: unknown; years?: unknown; walkForward?: unknown }, deadline: number) {
  let spec: StrategySpec, row: StrategyRow | null = null;
  if (body.strategyId) { row = await getStrategy(user.id, Number(body.strategyId)); spec = specOf(row); }
  else { const p = parseStrategy(body.spec); if (!p.ok) throw refuse(`Check the strategy: ${p.errors.join("; ")}`); spec = p.spec; }
  const years = [1, 3, 5, 10].includes(Number(body.years)) ? Number(body.years) : 5;
  const w = windowFor(spec, years);
  const timeline = spec.signal.type === "copy13f" ? await copyTimeline(spec.signal.cik, spec.signal.top, years + 1).catch(() => []) : null;
  const symbols = [...new Set([...w.symbols, ...(timeline ?? []).flatMap((e) => Object.keys(e.weights))])].slice(0, 40);
  const data = await loadPanel(symbols, spec.benchmark, w.from, { deadline: deadline - 25_000 });
  if (data.panel.dates.length < 60) throw refuse("Daily prices are not available right now, so the backtest cannot run. Try again later.", 503);
  const external = spec.signal.type === "external" ? (await readSignals({ producer: spec.signal.producer, symbols: spec.universe, live: false, asOf: new Date().toISOString(), from: w.from })).signals : undefined;
  const targets = spec.signal.type === "target" ? await quant().targets.targetVersions(spec.signal.key, w.from, new Date().toISOString()).catch(() => []) : undefined;
  const trials = (row?.backtests ?? 0) + 1;
  const costs = spec.assetClass === "crypto" ? CRYPTO : US_EQUITY;
  const startIdx = Math.max(0, data.panel.dates.findIndex((d) => d >= new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10)));
  const result = runBacktest({ spec, panel: data.panel, opens: Object.keys(data.opens).length ? data.opens : undefined, costs, copyTimeline: timeline ?? undefined, external, targets, trials, from: Math.max(startIdx, 1) });
  const wf = body.walkForward === true && Date.now() < deadline - 20_000 ? walkForward({ spec, panel: data.panel, opens: Object.keys(data.opens).length ? data.opens : undefined, costs, copyTimeline: timeline ?? undefined, external, targets }, { deadline: deadline - 10_000 }) : null;
  if (wf) result.warnings = [...new Set([...result.warnings, ...wf.warnings])];
  // Rule 3: every run is a trial.
  await quant().trials.logTrial({ family: `algo:${spec.signal.type}:${spec.name}`, params: spec as unknown as Record<string, unknown>, returns: result.returns }).catch(() => undefined);
  if (row) await requireDb().update(schema.algoStrategies).set({ backtests: sql`${schema.algoStrategies.backtests} + 1` }).where(eq(schema.algoStrategies.id, row.id));
  const view = backtestView(result, wf, data.missing, data.providers);
  await requireDb().insert(schema.algoBacktests).values({ userId: user.id, strategyId: row?.id ?? null, specHash: specHash(spec), result: view as unknown as Record<string, unknown> });
  if (row) await audit({ userId: user.id, actor: user.email, action: "backtest", strategyId: row.id, payload: { years, trials, sharpe: result.stats?.sharpe ?? null, dsr: result.deflated.dsr, walkForward: !!wf } });
  return view;
}

/** What the page shows: curves thinned for charts, the returns left out. */
export function backtestView(r: BacktestResult, wf: ReturnType<typeof walkForward>, missing: string[], providers: string[]) {
  const { returns: _returns, ...rest } = r;
  void _returns;
  return {
    ...rest, curve: thinCurve(r.curve), benchmark: thinCurve(r.benchmark), drawdown: thinCurve(r.drawdown), exposure: thinCurve(r.exposure, 200),
    walkForward: wf ? { ...wf, oosCurve: thinCurve(wf.oosCurve) } : null, missing, providers,
  };
}

export async function lastBacktest(userId: string, strategyId: number) {
  const [r] = await requireDb().select().from(schema.algoBacktests).where(and(eq(schema.algoBacktests.userId, userId), eq(schema.algoBacktests.strategyId, strategyId))).orderBy(desc(schema.algoBacktests.createdAt)).limit(1);
  return r ? { at: r.createdAt.toISOString(), result: r.result } : null;
}
