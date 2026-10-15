/**
 * What the Algo trading page reads: the hub (strategies, plan, switches, consents) and one strategy's
 * dashboard (equity against its benchmark, positions, orders and batches, decisions, risk usage and the
 * live checklist). Server only. Reads only: nothing here trades or calls a model.
 */
import type { CurrentUser } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { consentsOf, killState, liveEnabled, serverLimits, strategyCap } from "./access";
import { paperEquity, type PaperState } from "./brokers/paper";
import { brokerSetup, listConnections } from "./connections";
import { quotesFor } from "./data";
import { CONSENTS, NOT_ADVICE, autonomousPhrase } from "./disclosures";
import { lastBacktest } from "./live";
import { riskUsage } from "./risk";
import { batchesOf, decisionsOf, equityOf, listStrategies, liveCheck, ordersOf, specOf, type StrategyRow } from "./store";
import { TEMPLATES, type StrategySpec } from "./strategy";
import { liveFlows } from "./tick";

type Person = Pick<CurrentUser, "id" | "email">;

export async function hubView(user: Person) {
  const [rows, kill, consents, cap, live, agent, autonomous, more] = await Promise.all([
    listStrategies(user.id), killState(user.id), consentsOf(user.id), strategyCap(user),
    canUse(user, "algo.live"), canUse(user, "algo.agent"), canUse(user, "algo.autonomous"), canUse(user, "algo.more"),
  ]);
  return {
    strategies: rows.map((r) => {
      let spec: StrategySpec | null = null;
      try { spec = specOf(r); } catch { /* shown as invalid */ }
      const paper = r.paper as PaperState | null;
      return { id: r.id, name: r.name, mode: r.mode, status: r.status, kill: r.kill, signal: spec?.signal.type ?? "invalid", universe: spec?.universe ?? [], capitalUsd: spec?.capitalUsd ?? 0, assetClass: spec?.assetClass ?? "equity", paperCash: paper?.cash ?? null, peak: r.equityPeak, lastTickAt: r.lastTickAt?.toISOString() ?? null, nextTickAt: r.nextTickAt?.toISOString() ?? null, lastDecision: r.lastDecision };
    }),
    kill, consents, consentTexts: CONSENTS, notAdvice: NOT_ADVICE,
    plan: { live, agent, autonomous, more, cap },
    server: { liveEnabled: liveEnabled(), ...serverLimits(), brokers: brokerSetup() },
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, how: t.how, risks: t.risks, spec: t.spec })),
  };
}

export async function strategyView(user: Person, row: StrategyRow) {
  const spec = specOf(row);
  const paper = row.paper as PaperState | null;
  const held: Record<string, number> = row.mode === "paper" ? Object.fromEntries(Object.entries(paper?.positions ?? {}).map(([k, p]) => [k, p.units])) : row.managed ?? {};
  const quotes = await quotesFor([...new Set([...Object.keys(held), spec.benchmark])]).catch(() => ({} as Awaited<ReturnType<typeof quotesFor>>));
  const prices = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, q.last ?? 0]));
  const equity = row.mode === "paper" && paper ? paperEquity(paper, prices) : spec.capitalUsd + (row.accountId ? await liveFlows(row.id, row.accountId).catch(() => 0) : 0) + Object.entries(held).reduce((s, [k, u]) => s + u * (prices[k] ?? 0), 0);
  const [marks, batches, orders, decisions, backtest, connections, gateApproval, gateAuto] = await Promise.all([
    equityOf(row.id), batchesOf(user.id, row.id), ordersOf(user.id, row.id, 60), decisionsOf(row.id, 15), lastBacktest(user.id, row.id), listConnections(user),
    liveCheck(user, row, "live_approval", null, null).catch(() => null), liveCheck(user, row, "live_auto", autonomousPhrase(spec.name), null).catch(() => null),
  ]);
  const b0 = marks.find((m) => m.benchmark)?.benchmark ?? null;
  const e0 = marks[0]?.equity ?? spec.capitalUsd;
  const positions = Object.entries(held).map(([k, u]) => {
    const p = prices[k] ?? 0;
    return { symbol: k, units: u, price: p, value: u * p, weight: equity > 0 ? (u * p) / equity : 0, avgCost: row.mode === "paper" ? paper?.positions[k]?.avgCost ?? null : null };
  }).sort((a, b) => b.value - a.value);
  return {
    id: row.id, name: row.name, mode: row.mode, status: row.status, kill: row.kill, killReason: row.killReason, spec, connection: row.connection, accountId: row.accountId,
    riskConfirmedAt: row.riskConfirmedAt?.toISOString() ?? null, paperStartedAt: row.paperStartedAt?.toISOString() ?? null, backtests: row.backtests,
    equity, cash: row.mode === "paper" ? paper?.cash ?? null : null, realized: row.mode === "paper" ? paper?.realized ?? 0 : null,
    curve: marks.map((m) => ({ date: m.date, value: (100 * m.equity) / (e0 || 1) })),
    benchmarkCurve: b0 ? marks.filter((m) => m.benchmark).map((m) => ({ date: m.date, value: (100 * (m.benchmark ?? b0)) / b0 })) : [],
    positions, batches, decisions: decisions.map((d) => ({ id: d.id, at: d.createdAt.toISOString(), source: d.source, mode: d.mode, target: d.target, notes: d.notes, orders: d.orders })),
    orders: orders.map((o) => ({ id: o.id, at: o.createdAt.toISOString(), symbol: o.symbol, action: o.action, units: o.units, orderType: o.orderType, limitPrice: o.limitPrice, estValue: o.estValue, status: o.status, filledUnits: o.filledUnits, fillPrice: o.fillPrice, error: o.error, slice: o.slice, slices: o.slices, clientOrderId: o.clientOrderId })),
    risk: riskUsage(spec.risk, { equity, startOfDayEquity: row.equityDayStart ?? equity, peakEquity: Math.max(row.equityPeak ?? equity, equity), positions: held, prices, sentToday: { usd: orders.filter((o) => o.sentAt && o.sentAt.toDateString() === new Date().toDateString()).reduce((s, o) => s + o.estValue, 0), count: orders.filter((o) => o.sentAt && o.sentAt.toDateString() === new Date().toDateString()).length } }),
    backtest, connections,
    live: { approval: gateApproval?.unmet ?? [], autonomous: (gateAuto?.unmet ?? []).filter((u) => u.key !== "typed"), phrase: autonomousPhrase(spec.name), integrity: gateApproval?.integrity ?? null },
  };
}
