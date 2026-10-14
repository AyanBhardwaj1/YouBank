/**
 * Live copies through SnapTrade: connect a broker, read accounts and positions, propose a batch of orders,
 * approve it once, track fills. Server only. Every entry point checks `copytrade.broker` first (Pro and
 * up; administrators always), and placing orders also needs COPYTRADE_TRADING_ENABLED=1 and both consents.
 *
 * YouBank never places an order the person did not approve in that batch, never holds money, and never
 * runs a live copy from a schedule: a new 13F only produces a notice that a fresh proposal is ready.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { decryptToken, encryptionReady, encryptToken } from "@/lib/crm/crypto";
import { siteLink } from "@/lib/site";
import { audit, limits, refuse, requireBroker, requireConsent, tradingEnabled } from "./access";
import { copyTargets } from "./analytics";
import { brokerTicker } from "./cusip";
import { marketState } from "./markethours";
import { approveBatch, clientOrderId, confirmationPhrase, type BatchRow, type CopyStore, type OrderBroker, type OrderRow } from "./orders";
import { checkAllowed, cleanCopy, getCopy } from "./portfolios";
import { latestPrices } from "./prices";
import { proposeOrders, type Proposal } from "./rebalance";
import { FINAL_STATUSES, positionsOf, snaptrade, snaptradeReady, type SnapAccount, type SnapSymbol, type SnapUser, type TradeForm } from "./snaptrade";

type Person = Pick<CurrentUser, "id" | "email">;
type Meta = { ip: string | null; userAgent: string | null };

/** Our id for a person at SnapTrade: opaque, stable, and not their email. */
export const snapUserId = (userId: string) => `yb-${createHash("sha256").update(`youbank-snaptrade:${userId}`).digest("hex").slice(0, 24)}`;

/** What the brokerage panel shows before anything else: whether it can work here at all. */
export function brokerSetup(): { ready: boolean; trading: boolean; reason: string | null } {
  if (!snaptradeReady()) return { ready: false, trading: false, reason: "Not set up yet" };
  if (!encryptionReady()) return { ready: false, trading: false, reason: "Not set up yet" };
  return { ready: true, trading: tradingEnabled(), reason: tradingEnabled() ? null : "Real trading is switched off on this server. You can connect and see your positions; orders cannot be sent." };
}

async function snapUser(userId: string): Promise<SnapUser | null> {
  const [row] = await requireDb().select().from(schema.copyBrokers).where(eq(schema.copyBrokers.userId, userId));
  return row ? { userId: row.snaptradeUser, userSecret: decryptToken(row.secretEnc) } : null;
}

async function requireSnapUser(userId: string): Promise<SnapUser> {
  const u = await snapUser(userId);
  if (!u) throw refuse("Connect a brokerage account first.", 409);
  return u;
}

/** A link to SnapTrade's connection portal, registering the person with SnapTrade on first use (when SnapTrade's monthly charge for them starts). */
export async function connectLink(user: Person, meta: Meta, reconnect?: string): Promise<string> {
  await requireBroker(user);
  const setup = brokerSetup();
  if (!setup.ready) throw refuse("Brokerage connections are not set up yet.", 503);
  await requireConsent(user.id, "terms");
  let u = await snapUser(user.id);
  if (!u) {
    const id = snapUserId(user.id);
    const r = await snaptrade.registerUser(id);
    if (!r.userSecret) throw new Error("SnapTrade registered the user without a secret");
    await requireDb().insert(schema.copyBrokers).values({ userId: user.id, snaptradeUser: id, secretEnc: encryptToken(r.userSecret) }).onConflictDoNothing();
    u = await requireSnapUser(user.id);
    await audit({ userId: user.id, actor: user.email, action: "broker-register", payload: { snaptradeUser: id }, ...meta });
  }
  const link = await snaptrade.loginUrl(u, siteLink("/app/copy?tab=broker&connected=1"), reconnect);
  if (!link.redirectURI) throw new Error("SnapTrade returned no connection link");
  await audit({ userId: user.id, actor: user.email, action: "broker-connect-start", payload: { reconnect: reconnect ?? null }, ...meta });
  return link.redirectURI;
}

/** Delete the person at SnapTrade (every connection, and the monthly charge) and pause their live copies. */
export async function disconnect(user: Person, meta: Meta): Promise<void> {
  const u = await snapUser(user.id);
  if (u) await snaptrade.deleteUser(u.userId).catch((e) => { if ((e as { status?: number }).status !== 400) throw e; });
  const db = requireDb();
  await db.delete(schema.copyBrokers).where(eq(schema.copyBrokers.userId, user.id));
  await db.update(schema.copyPortfolios).set({ status: "paused", updatedAt: new Date() }).where(and(eq(schema.copyPortfolios.userId, user.id), eq(schema.copyPortfolios.mode, "live"), eq(schema.copyPortfolios.status, "active")));
  await db.update(schema.copyBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(schema.copyBatches.userId, user.id), eq(schema.copyBatches.status, "proposed")));
  await audit({ userId: user.id, actor: user.email, action: "broker-disconnect", payload: { snaptradeUser: u?.userId ?? null }, ...meta });
}

export type AccountView = { id: string; name: string; number: string; institution: string; paper: boolean; total: number | null; currency: string; trading: boolean; fractional: boolean; brokerage: string; restrictions: string[] };

/** The person's connected accounts with the broker's trading and fractional-share support. */
export async function accounts(user: Person): Promise<{ connected: boolean; accounts: AccountView[] }> {
  await requireBroker(user);
  const u = await snapUser(user.id);
  if (!u) return { connected: false, accounts: [] };
  const [accts, auths] = await Promise.all([snaptrade.accounts(u), snaptrade.authorizations(u).catch(() => [])]);
  const byAuth = new Map(auths.map((a) => [a.id, a]));
  await requireDb().update(schema.copyBrokers).set({ lastSyncedAt: new Date() }).where(eq(schema.copyBrokers.userId, user.id));
  return { connected: true, accounts: accts.map((a) => accountView(a, byAuth.get(a.brokerage_authorization)?.brokerage)) };
}

function accountView(a: SnapAccount, b?: { display_name?: string; name?: string; allows_trading?: boolean | null; allows_fractional_units?: boolean | null }): AccountView {
  return {
    id: a.id, name: a.name ?? a.institution_name, number: a.number ? `…${a.number.slice(-4)}` : "", institution: a.institution_name, paper: !!a.is_paper,
    total: a.balance?.total?.amount ?? null, currency: a.balance?.total?.currency ?? "USD",
    trading: b?.allows_trading !== false, fractional: b?.allows_fractional_units === true, brokerage: b?.display_name ?? b?.name ?? a.institution_name, restrictions: a.cash_restrictions ?? [],
  };
}

/** The broker's id for a ticker in this account (exact symbol match, tradable equity or ETF). */
async function symbolId(u: SnapUser, accountId: string, ticker: string): Promise<string | null> {
  for (const q of [...new Set([brokerTicker(ticker), ticker])]) {
    const hits: SnapSymbol[] = await snaptrade.symbolSearch(u, accountId, q).catch(() => []);
    const want = q.toUpperCase();
    const hit = hits.find((s) => [s.symbol, s.raw_symbol].some((x) => x?.toUpperCase().replace(/[/-]/g, ".") === want.replace(/[/-]/g, ".")));
    if (hit) return hit.id;
  }
  return null;
}

/** Order statuses after which nothing more will happen at the broker (or nothing was ever sent). */
const SETTLED = [...FINAL_STATUSES, "pending", "rejected", "skipped"];
const OPEN_DAYS = 4;

/**
 * Refuse a new proposal while an earlier one of this copy may still trade: a sent limit order that has not
 * filled, or an order whose placement got no answer. Its shares are not in the account or in the copy's
 * count yet, so a new proposal would order them a second time. Statuses are asked of the broker first.
 */
async function refuseWhileOpen(userId: string, copyId: number): Promise<void> {
  const open = () => requireDb().select({ batchId: schema.copyOrders.batchId, ticker: schema.copyOrders.ticker, status: schema.copyOrders.status, brokerageOrderId: schema.copyOrders.brokerageOrderId }).from(schema.copyOrders)
    .where(and(eq(schema.copyOrders.portfolioId, copyId), eq(schema.copyOrders.userId, userId), isNotNull(schema.copyOrders.sentAt), gte(schema.copyOrders.sentAt, new Date(Date.now() - OPEN_DAYS * 86_400_000)), notInArray(schema.copyOrders.status, SETTLED)));
  let rows = await open();
  const ask = [...new Set(rows.filter((r) => r.brokerageOrderId).map((r) => r.batchId))];
  if (ask.length) { for (const id of ask) await refreshBatch(userId, id).catch(() => undefined); rows = await open(); }
  if (!rows.length) return;
  const tickers = [...new Set(rows.map((r) => r.ticker))].join(", ");
  throw refuse(rows.some((r) => !r.brokerageOrderId)
    ? `An earlier order (${tickers}) got no answer from your broker, so it may have been placed. Check your broker; new orders for this copy can be reviewed once that is settled, or after ${OPEN_DAYS} days.`
    : `Earlier orders (${tickers}) are still open at your broker. New orders for this copy can be reviewed once they fill, are canceled or expire.`, 409);
}

/**
 * Build a batch of orders for a live copy from its account and the latest filings, for the person to
 * review. Nothing is sent. The batch expires after a few minutes, because prices move.
 */
export async function propose(user: Person, copyId: number, meta: Meta): Promise<{ batchId: number; proposal: Proposal; confirmation: string | null; expiresAt: string; market: ReturnType<typeof marketState>; trading: boolean; account: AccountView | null; targets: { ticker: string; weight: number; name: string }[]; unresolved: string[] }> {
  await requireBroker(user);
  await requireConsent(user.id, "terms");
  const row = await getCopy(user.id, copyId);
  if (row.mode !== "live") throw refuse("Paper copies rebalance on their own; there are no orders to review.");
  if (row.status !== "active") throw refuse("This copy is paused. Resume it to review orders.");
  if (!row.accountId) throw refuse("Choose the brokerage account this copy trades in.");
  const c = cleanCopy({ ...row, mode: "live" } as unknown as Record<string, unknown>);
  // The plan as it is today (a blend, more live copies), not as it was when the copy was made.
  await checkAllowed(user, c, copyId);
  const u = await requireSnapUser(user.id);
  await refuseWhileOpen(user.id, copyId);
  const { accounts: list } = await accounts(user);
  const account = list.find((a) => a.id === row.accountId) ?? null;
  if (!account) throw refuse("That brokerage account is no longer connected. Reconnect it, or choose another account in the copy's settings.", 409);
  if (!account.trading) throw refuse(`${account.brokerage} does not allow trading through SnapTrade, so this copy can only be followed on paper there.`, 409);
  const [holdings, t] = await Promise.all([snaptrade.holdings(u, row.accountId), copyTargets(c.funds, c.rules, true)]);
  if (!t.targets.length) throw refuse("This fund has no holdings we can copy yet.", 409);
  const acct = positionsOf(holdings);
  const managed = await recountManaged(copyId);
  const scope = [...new Set([...t.targets.map((x) => x.ticker), ...Object.keys(managed)])];
  const quotes = await latestPrices(scope);
  const budget = c.sizing.kind === "pct" ? (acct.total * c.sizing.amount) / 100 : c.sizing.amount;
  const proposal = proposeOrders({
    targets: t.targets, budgetUsd: budget, cash: acct.cash, positions: acct.positions, managed, prices: quotes.prices, fractional: account.fractional,
    minOrderUsd: c.trading.minOrderUsd, sellOutside: c.trading.sellOutside, cashBufferPct: c.trading.cashBufferPct / 100, useSaleProceeds: c.trading.useSaleProceeds,
    orderType: c.trading.orderType, limitBand: c.trading.limitBandPct / 100, maxOrderUsd: Math.min(c.trading.maxOrderUsd, limits().maxOrderUsd),
  });
  // The broker's own id for each ticker; a ticker it cannot find is left out, with the reason.
  const unresolved: string[] = [];
  const ids = new Map<string, string>();
  for (const o of proposal.orders) { const id = await symbolId(u, row.accountId, o.ticker); if (id) ids.set(o.ticker, id); else unresolved.push(o.ticker); }
  if (unresolved.length) {
    proposal.skipped.push(...unresolved.map((ticker) => ({ ticker, reason: `${account.brokerage} could not find this ticker` })));
    proposal.orders = proposal.orders.filter((o) => ids.has(o.ticker));
  }
  const buyValue = proposal.orders.filter((o) => o.action === "BUY").reduce((s, o) => s + o.estValue, 0);
  const sellValue = proposal.orders.filter((o) => o.action === "SELL").reduce((s, o) => s + o.estValue, 0);
  const db = requireDb();
  await db.update(schema.copyBatches).set({ status: "expired", updatedAt: new Date() }).where(and(eq(schema.copyBatches.portfolioId, copyId), eq(schema.copyBatches.status, "proposed")));
  const expiresAt = new Date(Date.now() + limits().proposalMinutes * 60_000);
  const accession = t.funds.map((f) => f.accession).filter(Boolean).join(",") || null;
  const [batch] = await db.insert(schema.copyBatches).values({
    userId: user.id, portfolioId: copyId, accountId: row.accountId, buyValue, sellValue, orderCount: proposal.orders.length, expiresAt, accession,
    proposal: { ...proposal, targets: t.targets, funds: t.funds, budget, account: { cash: acct.cash, total: acct.total }, prices: quotes.prices, priceSources: quotes.providers },
  }).returning({ id: schema.copyBatches.id });
  if (proposal.orders.length) {
    await db.insert(schema.copyOrders).values(proposal.orders.map((o, seq) => ({
      batchId: batch.id, userId: user.id, portfolioId: copyId, seq, clientOrderId: clientOrderId(batch.id, seq, user.id), ticker: o.ticker, symbolId: ids.get(o.ticker) ?? null,
      action: o.action, units: o.units, orderType: c.trading.orderType, limitPrice: o.limitPrice, estValue: o.estValue,
    })));
  }
  await audit({ userId: user.id, actor: user.email, action: "propose", portfolioId: copyId, batchId: batch.id, payload: { accession, budget, orders: proposal.orders, skipped: proposal.skipped, warnings: proposal.warnings }, ...meta });
  return {
    batchId: batch.id, proposal, confirmation: confirmationPhrase({ buyValue, sellValue, orderCount: proposal.orders.length }), expiresAt: expiresAt.toISOString(), market: marketState(), trading: tradingEnabled(), account,
    targets: t.targets.map((x) => ({ ticker: x.ticker, weight: x.weight, name: x.name })), unresolved,
  };
}

/* ---------------- The database store and the SnapTrade broker for approveBatch ---------------- */

const toOrder = (r: typeof schema.copyOrders.$inferSelect): OrderRow => ({ id: r.id, batchId: r.batchId, seq: r.seq, clientOrderId: r.clientOrderId, ticker: r.ticker, symbolId: r.symbolId, action: r.action as "BUY" | "SELL", units: r.units, orderType: r.orderType as "Limit" | "Market", limitPrice: r.limitPrice, estValue: r.estValue, status: r.status, brokerageOrderId: r.brokerageOrderId, error: r.error });

export const dbStore: CopyStore = {
  async batch(id, userId) {
    const [b] = await requireDb().select().from(schema.copyBatches).where(and(eq(schema.copyBatches.id, id), eq(schema.copyBatches.userId, userId)));
    return b ? { id: b.id, userId: b.userId, portfolioId: b.portfolioId, accountId: b.accountId, status: b.status as BatchRow["status"], idemKey: b.idemKey, buyValue: b.buyValue, sellValue: b.sellValue, orderCount: b.orderCount, expiresAt: b.expiresAt } : null;
  },
  async claimBatch(id, userId, idemKey, at) {
    const won = await requireDb().update(schema.copyBatches).set({ status: "placing", idemKey, approvedAt: at, updatedAt: at })
      .where(and(eq(schema.copyBatches.id, id), eq(schema.copyBatches.userId, userId), eq(schema.copyBatches.status, "proposed"), gt(schema.copyBatches.expiresAt, at))).returning({ id: schema.copyBatches.id });
    return won.length === 1;
  },
  async releaseBatch(id, idemKey) {
    await requireDb().update(schema.copyBatches).set({ status: "proposed", idemKey: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.copyBatches.id, id), eq(schema.copyBatches.status, "placing"), eq(schema.copyBatches.idemKey, idemKey)));
  },
  async orders(batchId) {
    return (await requireDb().select().from(schema.copyOrders).where(eq(schema.copyOrders.batchId, batchId)).orderBy(schema.copyOrders.seq)).map(toOrder);
  },
  async claimOrder(orderId) {
    const won = await requireDb().update(schema.copyOrders).set({ status: "submitting", sentAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.copyOrders.id, orderId), eq(schema.copyOrders.status, "pending"))).returning({ id: schema.copyOrders.id });
    return won.length === 1;
  },
  async updateOrder(orderId, patch) {
    await requireDb().update(schema.copyOrders).set({ ...(patch.status ? { status: patch.status } : {}), ...(patch.brokerageOrderId !== undefined ? { brokerageOrderId: patch.brokerageOrderId } : {}), ...(patch.error !== undefined ? { error: patch.error } : {}), ...(patch.impact !== undefined ? { impact: patch.impact } : {}), ...(patch.response !== undefined ? { response: patch.response } : {}), updatedAt: new Date() })
      .where(eq(schema.copyOrders.id, orderId));
  },
  async finishBatch(id, status) {
    await requireDb().update(schema.copyBatches).set({ status, updatedAt: new Date() }).where(eq(schema.copyBatches.id, id));
  },
  async committedValueSince(userId, since) {
    const [r] = await requireDb().select({ v: sql<number>`coalesce(sum(${schema.copyOrders.estValue}), 0)::float8` }).from(schema.copyOrders)
      .innerJoin(schema.copyBatches, eq(schema.copyBatches.id, schema.copyOrders.batchId))
      .where(and(eq(schema.copyBatches.userId, userId), gte(schema.copyBatches.approvedAt, since), notInArray(schema.copyOrders.status, ["rejected", "skipped"])));
    return Number(r?.v ?? 0);
  },
  audit,
};

function snapBroker(u: SnapUser, accountId: string): OrderBroker {
  const form = (o: OrderRow): TradeForm => ({ account_id: accountId, action: o.action, universal_symbol_id: o.symbolId ?? "", order_type: o.orderType, time_in_force: "Day", price: o.orderType === "Limit" ? o.limitPrice : null, units: o.units });
  return {
    async impact(o) {
      if (!o.symbolId) throw Object.assign(new Error("The broker could not find this ticker."), { status: 400 });
      const r = await snaptrade.orderImpact(u, form(o));
      const imp = r.trade_impacts?.[0];
      return { tradeId: r.trade?.id ?? null, commission: imp?.estimated_commission ?? null, remainingCash: imp?.remaining_cash ?? null, raw: r };
    },
    async placeChecked(tradeId) {
      const r = await snaptrade.placeChecked(u, tradeId);
      return { brokerageOrderId: r.brokerage_order_id ?? "", status: r.status ?? "placed", raw: r };
    },
    async placeForce(o) {
      const r = await snaptrade.placeForce(u, { ...form(o), client_order_id: o.clientOrderId });
      return { brokerageOrderId: r.brokerage_order_id ?? "", status: r.status ?? "placed", raw: r };
    },
  };
}

/**
 * The account as it is now must still hold every share a batch sells. The proposal was built from the
 * holdings minutes ago; a sale made since (at the broker, or by another copy) would otherwise turn a sell
 * into one for more than the account holds, which a margin account can fill as a short sale.
 */
async function checkSellsStillHeld(u: SnapUser, b: BatchRow): Promise<void> {
  const sells = (await dbStore.orders(b.id)).filter((o) => o.status === "pending" && o.action === "SELL");
  if (!sells.length) return;
  const held = new Map<string, number>();
  for (const p of positionsOf(await snaptrade.holdings(u, b.accountId)).positions) held.set(p.ticker, (held.get(p.ticker) ?? 0) + p.units);
  const short = sells.filter((o) => o.units > (held.get(o.ticker.toUpperCase().replace(/[./]/g, "-")) ?? 0) + 1e-6);
  if (!short.length) return;
  await requireDb().update(schema.copyBatches).set({ status: "expired", updatedAt: new Date() }).where(and(eq(schema.copyBatches.id, b.id), eq(schema.copyBatches.status, "proposed")));
  throw refuse(`Your account no longer holds the shares this batch would sell (${short.map((o) => o.ticker).join(", ")}). Nothing was sent. Review a fresh set.`, 409);
}

/** Approve a reviewed batch and send it, once. */
export async function approve(user: Person, batchId: number, body: { idempotencyKey?: unknown; confirmation?: unknown }, meta: Meta) {
  await requireBroker(user);
  if (!tradingEnabled()) throw refuse("Real trading is switched off on this server, so orders cannot be sent. Paper copies keep working.", 403);
  await requireConsent(user.id, "terms");
  await requireConsent(user.id, "trading");
  const b = await dbStore.batch(batchId, user.id);
  if (!b) throw refuse("That batch of orders was not found.", 404);
  const copy = await getCopy(user.id, b.portfolioId);
  if (copy.status !== "active") throw refuse("This copy is paused. Resume it before placing orders.", 409);
  const u = await requireSnapUser(user.id);
  const c = cleanCopy({ ...copy, mode: "live" } as unknown as Record<string, unknown>);
  if (b.status === "proposed") await checkSellsStillHeld(u, b);
  const result = await approveBatch(dbStore, snapBroker(u, b.accountId), {
    batchId, user, idemKey: String(body.idempotencyKey ?? ""), confirmation: String(body.confirmation ?? ""), now: new Date(), ip: meta.ip, userAgent: meta.userAgent,
    maxDayUsd: Math.min(c.trading.maxDayUsd, limits().maxDayUsd), maxOrderUsd: Math.min(c.trading.maxOrderUsd, limits().maxOrderUsd), market: marketState(),
  });
  return result;
}

/** Ask the broker about every sent order of a batch that is not final, then recount the copy's holdings. */
export async function refreshBatch(userId: string, batchId: number): Promise<OrderRow[]> {
  const b = await dbStore.batch(batchId, userId);
  if (!b) throw refuse("That batch of orders was not found.", 404);
  const u = await snapUser(userId);
  const db = requireDb();
  const rows = await db.select().from(schema.copyOrders).where(eq(schema.copyOrders.batchId, batchId));
  if (u) {
    for (const r of rows) {
      if (!r.brokerageOrderId || FINAL_STATUSES.has(r.status)) continue;
      const o = await snaptrade.orderDetail(u, b.accountId, r.brokerageOrderId).catch(() => null);
      if (!o) continue;
      const filled = Number(o.filled_quantity ?? 0), price = Number(o.execution_price ?? NaN);
      await db.update(schema.copyOrders).set({ status: o.status ?? r.status, filledUnits: Number.isFinite(filled) ? filled : r.filledUnits, fillPrice: Number.isFinite(price) ? price : r.fillPrice, updatedAt: new Date() }).where(eq(schema.copyOrders.id, r.id));
      if (o.status && o.status !== r.status) await audit({ userId, actor: "system", action: "order-status", batchId, orderId: r.id, portfolioId: b.portfolioId, payload: { from: r.status, to: o.status, filled, price: Number.isFinite(price) ? price : null } });
    }
  }
  await recountManaged(b.portfolioId);
  return dbStore.orders(batchId);
}

/** A live copy's own shares: filled buys less filled sells across its orders. Recomputed, so it is never double-counted. */
export async function recountManaged(copyId: number): Promise<Record<string, number>> {
  const db = requireDb();
  // Only orders in the account the copy trades in now: shares bought in an account it used before are not
  // in this one, and counting them would let the copy sell the person's own shares here.
  const [copy] = await db.select({ accountId: schema.copyPortfolios.accountId }).from(schema.copyPortfolios).where(eq(schema.copyPortfolios.id, copyId));
  const rows = copy?.accountId ? await db.select({ ticker: schema.copyOrders.ticker, action: schema.copyOrders.action, filled: schema.copyOrders.filledUnits }).from(schema.copyOrders)
    .innerJoin(schema.copyBatches, eq(schema.copyBatches.id, schema.copyOrders.batchId))
    .where(and(eq(schema.copyOrders.portfolioId, copyId), eq(schema.copyBatches.accountId, copy.accountId))) : [];
  const m: Record<string, number> = {};
  for (const r of rows) m[r.ticker] = (m[r.ticker] ?? 0) + (r.action === "BUY" ? r.filled : -r.filled);
  for (const k of Object.keys(m)) if (m[k] <= 1e-6) delete m[k]; else m[k] = Math.round(m[k] * 1e4) / 1e4;
  await db.update(schema.copyPortfolios).set({ managed: m, updatedAt: new Date() }).where(eq(schema.copyPortfolios.id, copyId));
  return m;
}

/** Cancel a proposal before it is approved (orders already sent are cancelled at the broker, not here). */
export async function cancelBatch(user: Person, batchId: number, meta: Meta): Promise<void> {
  const won = await requireDb().update(schema.copyBatches).set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(schema.copyBatches.id, batchId), eq(schema.copyBatches.userId, user.id), eq(schema.copyBatches.status, "proposed"))).returning({ id: schema.copyBatches.id });
  if (!won.length) throw refuse("Only a batch that has not been approved can be canceled here. Orders already sent can be canceled with your broker.", 409);
  await audit({ userId: user.id, actor: user.email, action: "batch-cancel", batchId, payload: {}, ...meta });
}

/** Recent batches of a copy with their orders. */
export async function batchesOf(userId: string, copyId: number) {
  const db = requireDb();
  const batches = await db.select().from(schema.copyBatches).where(and(eq(schema.copyBatches.userId, userId), eq(schema.copyBatches.portfolioId, copyId))).orderBy(desc(schema.copyBatches.createdAt)).limit(10);
  const orders = batches.length ? await db.select().from(schema.copyOrders).where(inArray(schema.copyOrders.batchId, batches.map((b) => b.id))).orderBy(schema.copyOrders.seq) : [];
  return batches.map((b) => ({ id: b.id, status: b.status, createdAt: b.createdAt.toISOString(), approvedAt: b.approvedAt?.toISOString() ?? null, expiresAt: b.expiresAt.toISOString(), buyValue: b.buyValue, sellValue: b.sellValue, orderCount: b.orderCount, confirmation: confirmationPhrase(b), proposal: b.proposal, orders: orders.filter((o) => o.batchId === b.id).map((o) => ({ ...toOrder(o), filledUnits: o.filledUnits, fillPrice: o.fillPrice })) }));
}

/** Orders sent in the last few days that are not final, for the cron's status pass. */
export async function refreshOpenOrders(deadline: number): Promise<number> {
  const db = requireDb();
  const open = await db.selectDistinct({ batchId: schema.copyOrders.batchId, userId: schema.copyOrders.userId }).from(schema.copyOrders)
    .where(and(gte(schema.copyOrders.sentAt, new Date(Date.now() - 4 * 86_400_000)), sql`${schema.copyOrders.brokerageOrderId} is not null`, sql`${schema.copyOrders.status} not in ('EXECUTED','CANCELED','PARTIAL_CANCELED','REJECTED','FAILED','EXPIRED','REPLACED','rejected')`)).limit(50);
  let n = 0;
  for (const o of open) { if (Date.now() > deadline) break; await refreshBatch(o.userId, o.batchId).catch(() => undefined); n++; }
  return n;
}
