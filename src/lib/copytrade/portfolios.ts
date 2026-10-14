/**
 * Copies: a person's paper or live copy of one fund (or a blend). Server only, apart from `cleanCopy`,
 * which is pure. Paper copies are free and run here end to end; live copies only ever propose orders
 * (see live.ts), which the person approves batch by batch.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { audit, limits, liveCopyLimit, refuse, requireBroker, requireConsent } from "./access";
import { copyTargets } from "./analytics";
import { indexFrom, metrics, thin } from "./backtest";
import { curatedByCik, padCik } from "./funds";
import { paperCurve, paperRebalance, paperValue, type PaperState } from "./paper";
import { dailyCloses, latestPrices } from "./prices";
import { cleanRules, type CloneRules } from "./targets";

export type Sizing = { kind: "usd" | "pct"; amount: number };
export type TradingSettings = { orderType: "Limit" | "Market"; limitBandPct: number; maxOrderUsd: number; maxDayUsd: number; minOrderUsd: number; sellOutside: boolean; useSaleProceeds: boolean; cashBufferPct: number };
export type CopyInput = { name: string; mode: "paper" | "live"; funds: { cik: string; name: string; weight: number }[]; rules: CloneRules; sizing: Sizing; trading: TradingSettings; accountId: string | null };

export const DEFAULT_TRADING: TradingSettings = { orderType: "Limit", limitBandPct: 0.5, maxOrderUsd: 5_000, maxDayUsd: 10_000, minOrderUsd: 5, sellOutside: false, useSaleProceeds: true, cashBufferPct: 0.5 };

const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** A copy's settings from untrusted input, bounded. Pure, for tests and routes. */
export function cleanCopy(v: Record<string, unknown>, server = limits()): CopyInput {
  const mode = v.mode === "live" ? "live" : "paper";
  const fundsIn = Array.isArray(v.funds) ? v.funds : [];
  const funds = fundsIn.slice(0, 5).map((f) => { const o = (f ?? {}) as Record<string, unknown>; return { cik: padCik(String(o.cik ?? "")), name: String(o.name ?? "").slice(0, 120), weight: num(o.weight, 0, 100, 1) }; }).filter((f) => f.cik && f.weight > 0);
  if (!funds.length) throw refuse("Choose a fund to copy.");
  if (new Set(funds.map((f) => f.cik)).size !== funds.length) throw refuse("Each fund can be in a blend once.");
  const s = (v.sizing ?? {}) as Record<string, unknown>;
  const sizing: Sizing = s.kind === "pct" && mode === "live" ? { kind: "pct", amount: num(s.amount, 1, 100, 10) } : { kind: "usd", amount: num(s.amount, 100, 10_000_000, 10_000) };
  const t = (v.trading ?? {}) as Record<string, unknown>;
  const trading: TradingSettings = {
    orderType: t.orderType === "Market" ? "Market" : "Limit",
    limitBandPct: num(t.limitBandPct, 0.05, 5, DEFAULT_TRADING.limitBandPct),
    maxOrderUsd: num(t.maxOrderUsd, 10, server.maxOrderUsd, Math.min(DEFAULT_TRADING.maxOrderUsd, server.maxOrderUsd)),
    maxDayUsd: num(t.maxDayUsd, 10, server.maxDayUsd, Math.min(DEFAULT_TRADING.maxDayUsd, server.maxDayUsd)),
    minOrderUsd: num(t.minOrderUsd, 1, 10_000, DEFAULT_TRADING.minOrderUsd),
    sellOutside: t.sellOutside === true,
    useSaleProceeds: t.useSaleProceeds !== false,
    cashBufferPct: num(t.cashBufferPct, 0, 20, DEFAULT_TRADING.cashBufferPct),
  };
  const name = String(v.name ?? "").trim().slice(0, 80) || (funds.length === 1 ? `${curatedByCik(funds[0].cik)?.name ?? funds[0].name ?? "Fund"} copy` : "Fund blend");
  return { name, mode, funds, rules: cleanRules((v.rules ?? {}) as Record<string, unknown>), sizing, trading, accountId: mode === "live" && typeof v.accountId === "string" && v.accountId.trim() ? v.accountId.trim().slice(0, 100) : null };
}

type Person = Pick<CurrentUser, "id" | "email">;
export type CopyRow = typeof schema.copyPortfolios.$inferSelect;

async function activeCount(userId: string, mode: "paper" | "live", except?: number): Promise<number> {
  const [r] = await requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.copyPortfolios)
    .where(and(eq(schema.copyPortfolios.userId, userId), eq(schema.copyPortfolios.mode, mode), ne(schema.copyPortfolios.status, "closed"), except ? ne(schema.copyPortfolios.id, except) : undefined));
  return r?.n ?? 0;
}

/** The plan and limit checks for a copy's settings; throws a plain 402/400 when they do not fit. */
async function checkAllowed(user: Person, c: CopyInput, except?: number): Promise<void> {
  await requireConsent(user.id, "terms");
  if (c.funds.length > 1) await requireFeature(user, "copytrade.blends");
  if (c.mode === "live") {
    await requireBroker(user);
    if (!c.accountId) throw refuse("Choose the brokerage account this copy trades in.");
    const max = await liveCopyLimit(user);
    if ((await activeCount(user.id, "live", except)) >= max) {
      if (max < limits().liveCopiesMulti) await requireFeature(user, "copytrade.multi");
      throw refuse(`You can run up to ${max} live copies at once. Close one first.`);
    }
  } else if ((await activeCount(user.id, "paper", except)) >= limits().paperCopies) {
    throw refuse(`You can keep up to ${limits().paperCopies} paper copies. Close one first.`);
  }
}

/** Start (or restart) a paper copy at today's prices. */
async function startPaper(c: CopyInput, prior: PaperState | null, label: string): Promise<{ paper: PaperState; accession: string | null }> {
  const t = await copyTargets(c.funds, c.rules, true);
  if (!t.targets.length) throw refuse("This fund has no holdings we can copy yet. Open its page first so its 13F filings are read.", 409);
  const { prices } = await latestPrices(t.targets.map((x) => x.ticker));
  const today = new Date().toISOString().slice(0, 10);
  const accession = t.funds.map((f) => f.accession).filter(Boolean).join(",") || null;
  return { paper: paperRebalance(prior, t.targets, prices, today, accession, label, c.sizing.amount), accession };
}

export async function createCopy(user: Person, input: Record<string, unknown>, meta: { ip: string | null; userAgent: string | null }): Promise<CopyRow> {
  const c = cleanCopy(input);
  await checkAllowed(user, c);
  let paper: PaperState | null = null, accession: string | null = null;
  if (c.mode === "paper") ({ paper, accession } = await startPaper(c, null, "Started"));
  const [row] = await requireDb().insert(schema.copyPortfolios).values({ userId: user.id, name: c.name, mode: c.mode, funds: c.funds, rules: c.rules, sizing: c.sizing, trading: c.trading, accountId: c.accountId, paper: paper ?? {}, lastAccession: accession }).returning();
  await audit({ userId: user.id, actor: user.email, action: "copy-create", portfolioId: row.id, payload: { ...c }, ...meta });
  return row;
}

export async function updateCopy(user: Person, id: number, input: Record<string, unknown>, meta: { ip: string | null; userAgent: string | null }): Promise<CopyRow> {
  const row = await getCopy(user.id, id);
  if (input.status === "paused" || input.status === "active") {
    const [u] = await requireDb().update(schema.copyPortfolios).set({ status: input.status, updatedAt: new Date() }).where(and(eq(schema.copyPortfolios.id, id), eq(schema.copyPortfolios.userId, user.id))).returning();
    await audit({ userId: user.id, actor: user.email, action: `copy-${input.status === "paused" ? "pause" : "resume"}`, portfolioId: id, payload: {}, ...meta });
    return u;
  }
  const c = cleanCopy({ name: row.name, funds: row.funds, rules: row.rules, sizing: row.sizing, trading: row.trading, accountId: row.accountId, ...input, mode: row.mode });
  await checkAllowed(user, c, id);
  let paper = row.paper as PaperState | Record<string, never>, accession = row.lastAccession;
  const changedHoldings = JSON.stringify([c.funds, c.rules]) !== JSON.stringify([row.funds, cleanRules(row.rules as Record<string, unknown>)]);
  if (c.mode === "paper" && changedHoldings) ({ paper, accession } = await startPaper(c, "events" in paper ? (paper as PaperState) : null, "Settings changed"));
  const [u] = await requireDb().update(schema.copyPortfolios).set({ name: c.name, funds: c.funds, rules: c.rules, sizing: c.sizing, trading: c.trading, accountId: c.accountId, paper, lastAccession: accession, updatedAt: new Date() })
    .where(and(eq(schema.copyPortfolios.id, id), eq(schema.copyPortfolios.userId, user.id))).returning();
  await audit({ userId: user.id, actor: user.email, action: "copy-update", portfolioId: id, payload: { before: { funds: row.funds, rules: row.rules, sizing: row.sizing, trading: row.trading, accountId: row.accountId }, after: c }, ...meta });
  return u;
}

export async function closeCopy(user: Person, id: number, meta: { ip: string | null; userAgent: string | null }): Promise<void> {
  await getCopy(user.id, id);
  const db = requireDb();
  await db.update(schema.copyPortfolios).set({ status: "closed", updatedAt: new Date() }).where(and(eq(schema.copyPortfolios.id, id), eq(schema.copyPortfolios.userId, user.id)));
  await db.update(schema.copyBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.copyBatches.portfolioId, id), eq(schema.copyBatches.status, "proposed")));
  await audit({ userId: user.id, actor: user.email, action: "copy-close", portfolioId: id, payload: { note: "Unsent proposals canceled. Orders already sent stay with the broker; the shares stay in the account." }, ...meta });
}

export async function getCopy(userId: string, id: number): Promise<CopyRow> {
  const [row] = await requireDb().select().from(schema.copyPortfolios).where(and(eq(schema.copyPortfolios.id, id), eq(schema.copyPortfolios.userId, userId)));
  if (!row || row.status === "closed") throw refuse("That copy was not found.", 404);
  return row;
}

export async function listCopies(userId: string): Promise<CopyRow[]> {
  return requireDb().select().from(schema.copyPortfolios).where(and(eq(schema.copyPortfolios.userId, userId), ne(schema.copyPortfolios.status, "closed"))).orderBy(desc(schema.copyPortfolios.createdAt));
}

/** A paper copy's record: its daily value since it started against SPY, its current holdings and its rebalances. */
export async function paperPerformance(row: CopyRow) {
  const st = row.paper as PaperState;
  if (!st?.events?.length) return null;
  const tickers = [...new Set(st.events.flatMap((e) => Object.keys(e.units)))];
  const px = await dailyCloses([...tickers, "SPY"], st.startedAt, { max: 120, deadline: Date.now() + 25_000 });
  const cal = (px.prices.SPY ?? []).map((x) => x.date);
  const curve = paperCurve(st, px.prices, cal);
  const spy = indexFrom(px.prices.SPY ?? [], st.startedAt).map((p) => ({ date: p.date, value: (p.value / 100) * st.startCash }));
  const last = st.events.at(-1)!;
  const { prices } = await latestPrices(Object.keys(last.units));
  const lastClose = Object.fromEntries(Object.entries(px.prices).map(([t, xs]) => [t, xs.at(-1)?.close ?? 0]));
  const value = paperValue(last, prices, lastClose);
  return {
    startCash: st.startCash, startedAt: st.startedAt, value, gain: value - st.startCash, gainPct: st.startCash > 0 ? value / st.startCash - 1 : 0,
    curve: thin(curve), spy: thin(spy), metrics: curve.length > 2 ? metrics(curve, spy) : null,
    holdings: Object.entries(last.units).map(([ticker, units]) => ({ ticker, units, price: prices[ticker] ?? lastClose[ticker] ?? null, value: units * (prices[ticker] ?? lastClose[ticker] ?? 0) })).sort((a, b) => b.value - a.value),
    cash: last.cash,
    events: st.events.map((e) => ({ date: e.date, label: e.label, accession: e.accession, positions: Object.keys(e.units).length })).reverse(),
    providers: px.providers,
  };
}

/** Rebalance active paper copies that follow a fund after a new filing. Free work, run by the cron. */
export async function rebalancePaperCopies(cik: string): Promise<{ copyId: number; userId: string; name: string }[]> {
  const db = requireDb();
  const rows = await db.select().from(schema.copyPortfolios).where(and(eq(schema.copyPortfolios.mode, "paper"), eq(schema.copyPortfolios.status, "active"), sql`${schema.copyPortfolios.funds} @> ${JSON.stringify([{ cik: padCik(cik) }])}::jsonb`));
  const done: { copyId: number; userId: string; name: string }[] = [];
  for (const row of rows) {
    const c = cleanCopy({ name: row.name, mode: "paper", funds: row.funds, rules: row.rules, sizing: row.sizing, trading: row.trading });
    const t = await copyTargets(c.funds, c.rules, false);
    const accession = t.funds.map((f) => f.accession).filter(Boolean).join(",") || null;
    if (!t.targets.length || accession === row.lastAccession) continue;
    const { prices } = await latestPrices(t.targets.map((x) => x.ticker));
    const paper = paperRebalance(row.paper as PaperState, t.targets, prices, new Date().toISOString().slice(0, 10), accession, `New 13F (${t.funds.map((f) => f.period).filter(Boolean).join(", ")})`, c.sizing.amount);
    await db.update(schema.copyPortfolios).set({ paper, lastAccession: accession, updatedAt: new Date() }).where(eq(schema.copyPortfolios.id, row.id));
    await audit({ userId: row.userId, actor: "system", action: "paper-rebalance", portfolioId: row.id, payload: { accession, targets: t.targets.map((x) => [x.ticker, Math.round(x.weight * 10_000) / 10_000]) } });
    done.push({ copyId: row.id, userId: row.userId, name: row.name });
  }
  return done;
}

/** Live copies that follow a fund (the cron tells their owners a new filing is ready to review; it never trades). */
export async function liveCopiesOf(cik: string): Promise<CopyRow[]> {
  return requireDb().select().from(schema.copyPortfolios).where(and(eq(schema.copyPortfolios.mode, "live"), eq(schema.copyPortfolios.status, "active"), sql`${schema.copyPortfolios.funds} @> ${JSON.stringify([{ cik: padCik(cik) }])}::jsonb`));
}
