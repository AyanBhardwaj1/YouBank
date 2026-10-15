/**
 * Q5 on the server.
 *
 *   estimateCost(symbol, notionalUsd, side)  the pre-trade CostEstimate, also the algo engine's call before an order
 *   saveFills / fillsOf / deleteFills          the person's own fills (quant_fills), owner-scoped and deletable
 *   tcaReport(user)                            every fill against its day's bar, the annual cost, the broker's
 *                                              Rule 605/606 figures and the payment for order flow on their orders
 *   scorecard / setScorecard                   brokers' parsed reports (administrators load them; public data)
 * Fills are never pooled across people (open question 6 decided: no pooling in v1).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { newYorkParts } from "@/lib/copytrade/markethours";
import { std } from "../stats/core";
import { loadBars } from "../pit/bars";
import type { CostEstimate, Fill } from "../contracts";
import { validateFill } from "../validate";
import { DISCLOSURES, T } from "../words";
import { analyseFill, annualCost, costModel, shrinkY, spreadEstimate, type Bar, type FillAnalysis } from "./model";
import { pfofOnOrders, type Report606, type Summary605 } from "./rules";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

function toBars(b: { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }): Bar[] {
  return b.d.map((date, i) => ({ date, open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i] }));
}

/** σ (daily, 20 sessions), 20-day average dollar volume and a spread estimate from the last 60 sessions. Pure. */
export function marketStats(bars: Bar[]): { sigmaDaily: number; advUsd: number; spread: number; price: number } {
  const last = bars.slice(-61);
  const rets = last.slice(1).map((b, i) => b.close / last[i].close - 1).slice(-20);
  const adv = last.slice(-20).reduce((s, b) => s + b.close * b.volume, 0) / Math.max(1, Math.min(20, last.length));
  return { sigmaDaily: rets.length > 5 ? std(rets) : 0.02, advUsd: adv, spread: spreadEstimate(last).spread, price: last.at(-1)?.close ?? 0 };
}

/** The pre-trade cost estimate for an order of `notionalUsd` in `symbol` (round trip). */
export async function estimateCost(symbol: string, notionalUsd: number, side: Fill["side"], opts: { broker?: string; ownerId?: string; borrowBpsYear?: number } = {}): Promise<CostEstimate & { symbol: string; source: string; yShrunk: { y: number; n: number } }> {
  if (!(notionalUsd > 0) || notionalUsd > 1e9) throw Object.assign(new Error("Give an order size in dollars."), { status: 400 });
  const lb = await loadBars(symbol.toUpperCase().replace(/\./g, "-"), ago(120));
  if (!lb || lb.bars.c.length < 10) throw Object.assign(new Error(`No recent daily prices for ${symbol.toUpperCase()}.`), { status: 404 });
  const st = marketStats(toBars(lb.bars));
  let y = { y: 0.7, n: 0, weight: 0 };
  if (opts.ownerId) y = shrinkY(await observedY(opts.ownerId).catch(() => []));
  const est = costModel({ notionalUsd, price: st.price, sigmaDaily: st.sigmaDaily, advUsd: st.advUsd, spread: st.spread, side, broker: opts.broker, y: y.y, borrowBpsYear: opts.borrowBpsYear });
  return { ...est, symbol: symbol.toUpperCase(), source: `daily bars from ${lb.provider}${lb.from === "live" ? "" : " (YouBank store)"}`, yShrunk: { y: y.y, n: y.n } };
}

/** The person's implied impact coefficients, as measured by their latest cost report (saved in quant_runs). */
async function observedY(ownerId: string): Promise<number[]> {
  const [run] = await requireDb().select({ output: schema.quantRuns.output }).from(schema.quantRuns).where(and(eq(schema.quantRuns.ownerId, ownerId), eq(schema.quantRuns.kind, "tca"))).orderBy(desc(schema.quantRuns.createdAt)).limit(1);
  const ys = (run?.output as { observedY?: unknown } | undefined)?.observedY;
  return Array.isArray(ys) ? ys.map(Number).filter(Number.isFinite) : [];
}

/* ---------------- Fills ---------------- */

export async function saveFills(ownerId: string, fills: (Fill & { raw?: Record<string, string>; timeKnown?: boolean })[]): Promise<{ added: number; rejected: { extId: string; errors: string[] }[] }> {
  const ok: typeof fills = [], rejected: { extId: string; errors: string[] }[] = [];
  for (const f of fills) { const v = validateFill(f); if (v.ok) ok.push(f); else rejected.push({ extId: f.extId, errors: v.errors }); }
  let added = 0;
  for (let k = 0; k < ok.length; k += 200) {
    const res = await requireDb().insert(schema.quantFills).values(ok.slice(k, k + 200).map((f) => ({
      ownerId, source: f.source, accountRef: f.accountRef, symbol: f.symbol, side: f.side, qty: f.qty, price: f.price, executedAt: new Date(f.executedAt), placedAt: f.placedAt ? new Date(f.placedAt) : null,
      orderType: f.orderType ?? null, limitPrice: f.limitPrice ?? null, broker: f.broker ?? null, fees: f.fees ?? null, extId: f.extId, raw: { ...(f.raw ?? {}), timeKnown: f.timeKnown === false ? "false" : "true" },
    }))).onConflictDoNothing().returning({ id: schema.quantFills.id });
    added += res.length;
  }
  return { added, rejected };
}

export async function fillsOf(ownerId: string, limit = 2_000) {
  return requireDb().select().from(schema.quantFills).where(eq(schema.quantFills.ownerId, ownerId)).orderBy(desc(schema.quantFills.executedAt)).limit(Math.min(limit, 5_000));
}

export async function deleteFills(ownerId: string, ids?: number[]): Promise<number> {
  const res = await requireDb().delete(schema.quantFills).where(and(eq(schema.quantFills.ownerId, ownerId), ids?.length ? inArray(schema.quantFills.id, ids.slice(0, 5_000)) : undefined)).returning({ id: schema.quantFills.id });
  return res.length;
}

/* ---------------- Broker scorecards (public disclosures) ---------------- */

export type BrokerCard = { broker: string; r606?: Report606; r605?: Summary605[]; source: string; loadedAt: string };

export async function scorecard(): Promise<BrokerCard[]> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "quant.brokers"));
  return ((r?.state as { cards?: BrokerCard[] } | undefined)?.cards ?? []);
}

export async function setScorecard(card: BrokerCard): Promise<number> {
  const cards = (await scorecard()).filter((c) => c.broker.toLowerCase() !== card.broker.toLowerCase() || !!card.r606 !== !!c.r606);
  cards.push(card);
  await requireDb().insert(schema.edgeJobState).values({ name: "quant.brokers", state: { cards } as unknown as Record<string, unknown> }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: { cards } as unknown as Record<string, unknown>, updatedAt: new Date() } });
  return cards.length;
}

/* ---------------- The report ---------------- */

export type TcaReport = {
  fills: FillAnalysis[]; annual: ReturnType<typeof annualCost>; headline: string; expensive: FillAnalysis[];
  byHour: { hour: number; n: number; avgBps: number | null }[]; brokers: string[]; scorecard: BrokerCard[];
  pfof: { broker: string; usd: number | null; basis: string }[]; missingBars: string[]; disclosures: string[]; sources: string[];
  /** Implied impact coefficients of fills with a bar: (slippage against the typical price - half the spread) / (σ·√(Q/ADV)). */
  observedY: number[];
};

/** Every stored fill against its day's bar (at most `limit`, newest first), with the annual cost. */
export async function tcaReport(ownerId: string, opts: { portfolioUsd?: number | null; limit?: number } = {}): Promise<TcaReport> {
  const rows = await fillsOf(ownerId, opts.limit ?? 500);
  const syms = [...new Set(rows.map((r) => r.symbol))].slice(0, 150);
  const oldest = rows.map((r) => r.executedAt.toISOString().slice(0, 10)).sort()[0] ?? ago(30);
  const bars = new Map<string, Bar[]>();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, syms.length) }, async () => {
    while (i < syms.length) { const s = syms[i++]; const b = await loadBars(s, new Date(Date.parse(oldest) - 120 * DAY).toISOString().slice(0, 10)).catch(() => null); if (b?.bars.c.length) bars.set(s, toBars(b.bars)); }
  }));
  const observed: number[] = [];
  const fills: FillAnalysis[] = rows.map((r) => {
    const f: Fill & { timeKnown: boolean } = { source: r.source as Fill["source"], accountRef: r.accountRef, broker: r.broker ?? undefined, extId: r.extId, symbol: r.symbol, side: r.side as Fill["side"], qty: r.qty, price: r.price, executedAt: r.executedAt.toISOString(), ...(r.placedAt ? { placedAt: r.placedAt.toISOString() } : {}), orderType: (r.orderType ?? undefined) as Fill["orderType"], ...(r.limitPrice ? { limitPrice: r.limitPrice } : {}), fees: r.fees ?? undefined, timeKnown: (r.raw as Record<string, string>)?.timeKnown !== "false" };
    const bs = bars.get(r.symbol) ?? [];
    const day = newYorkParts(r.executedAt).date;
    const k = bs.findIndex((b) => b.date === day);
    const est = k >= 0 ? marketStats(bs.slice(Math.max(0, k - 60), k + 1)) : null;
    const at = r.placedAt ?? r.executedAt;
    const a = analyseFill(f, k >= 0 ? bs[k] : null, est, f.timeKnown ? newYorkParts(at).minutes : null);
    if (est && a.vsTypicalBps !== null) { const denom = est.sigmaDaily * Math.sqrt(est.advUsd > 0 ? a.notionalUsd / est.advUsd : 1); if (denom > 1e-6) observed.push(Math.max(0, a.vsTypicalBps / 1e4 - est.spread / 2) / denom); }
    return a;
  });
  const annual = annualCost(fills, opts.portfolioUsd ?? null);
  const byHourMap = new Map<number, number[]>();
  for (const f of fills) { if ((f.fill as { timeKnown?: boolean }).timeKnown === false || f.vsTypicalBps === null) continue; const h = Math.floor(newYorkParts(new Date(f.fill.executedAt)).minutes / 60); byHourMap.set(h, [...(byHourMap.get(h) ?? []), f.vsTypicalBps]); }
  const cards = await scorecard().catch(() => []);
  const brokers = [...new Set(rows.map((r) => r.broker).filter((b): b is string => !!b))];
  const pfof = brokers.map((b) => {
    const card = cards.find((c) => c.r606 && c.broker.toLowerCase().includes(b.toLowerCase()));
    if (!card?.r606) return { broker: b, usd: null, basis: "No Rule 606 report for this broker is loaded yet." };
    const sh = fills.filter((f) => f.fill.broker === b && f.fill.orderType === "market").reduce((s, f) => s + f.fill.qty, 0);
    return { broker: b, ...pfofOnOrders(0, sh, card.r606) };
  });
  return {
    fills, annual, headline: T.annualCost(annual.perYearUsd, annual.pctOfPortfolio, annual.tradesPerMonth),
    expensive: [...fills].filter((f) => f.modelledCostUsd !== null).sort((a, b) => (b.modelledCostUsd ?? 0) - (a.modelledCostUsd ?? 0)).slice(0, 10),
    byHour: [...byHourMap.entries()].sort((a, b) => a[0] - b[0]).map(([hour, xs]) => ({ hour, n: xs.length, avgBps: xs.reduce((s, v) => s + v, 0) / xs.length })),
    brokers, scorecard: cards, pfof, missingBars: syms.filter((s) => !bars.has(s)), observedY: observed.slice(0, 500),
    disclosures: [DISCLOSURES.daily_bar_tca, DISCLOSURES.not_advice],
    sources: ["Your fills (imported or synced; yours only)", "Daily bars: FMP, then Nasdaq (beta)", "Spread estimates: Corwin-Schultz (2012) and Abdi-Ranaldo (2017) on daily bars", "Brokers' Rule 605 and 606 reports, where loaded"],
  };
}
