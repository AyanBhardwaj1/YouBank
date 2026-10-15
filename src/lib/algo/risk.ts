/**
 * The risk engine. Every order from every source (a strategy tick, a paper fill, an approved batch, an
 * autonomous run, an order the person asked the agent for) passes `checkOrders` on the server immediately
 * before it is sent, with the state read fresh. Pure: the caller reads the state, this decides, so every
 * rule is tested on its own (scripts/test-algo.ts).
 *
 * Rules, in the order they are checked (the first blocking rule is the reason shown):
 *  1. kill switches: the administrator's (global), the person's, the strategy's (tripped by hand or by
 *     the drawdown rule). Only the person's own "close this position" passes a user or strategy kill
 *     (and the notional limits and throttles, since it only reduces risk); nothing passes the global one;
 *  2. an earlier order with an unknown outcome blocks new orders until it is reconciled (it may have filled);
 *  3. market hours: no market orders while closed; outside 9:30–16:00 ET only with extended hours on and a
 *     limit order (crypto trades around the clock);
 *  4. a price is required, and the price must be within the fat-finger band of an independent reference;
 *  5. per-order notional: the strategy's limit and the server's ceiling;
 *  6. per-day notional: the strategy's and the person's across strategies (the server ceiling);
 *  7. order throttles: per minute and per day;
 *  8. no short sales: a sell may not exceed what the strategy holds;
 *  9. exposure after the order: max position, gross and net, as fractions of the strategy's equity;
 * 10. the daily loss limit: down `dailyLossPct` since the day began, only orders that reduce risk go;
 * 11. the drawdown kill switch: down `maxDrawdownPct` from the peak trips the strategy's kill switch;
 * 12. pattern day trading: under the legacy rule, a margin account under $25,000 may not make a fourth day
 *     trade in five business days (FINRA amended Rule 4210 to drop the PDT designation from 4 June 2026,
 *     phased in to 20 October 2027, so `pdtMode: "intraday"` turns this into a warning for brokers that
 *     have moved to intraday margin);
 * 13. wash sales: a buy within 30 days of a sale at a loss is allowed, with a warning (the loss may be
 *     disallowed for taxes).
 */
import type { MarketState } from "@/lib/copytrade/markethours";
import type { RiskLimits } from "./strategy";

export type RiskOrder = {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  /** The price the order is valued at (the last price; for options, dollars per contract), and its limit when it has one. */
  price: number;
  limitPrice: number | null;
  type: "market" | "limit";
  assetClass: "equity" | "crypto" | "option";
  /** The person's own instruction to close a position (passes a user or strategy kill switch, never the global one). */
  manualLiquidation?: boolean;
};

export type RiskState = {
  now: Date;
  /** null for crypto, which trades around the clock. */
  market: MarketState | null;
  extendedHoursNow?: boolean;
  kill: { global: boolean; user: boolean; strategy: boolean };
  /** The strategy's equity now, at the start of the day, and at its peak. */
  equity: number;
  startOfDayEquity: number;
  peakEquity: number;
  /** Units the strategy holds, and mark prices. */
  positions: Record<string, number>;
  prices: Record<string, number>;
  /** Independent reference prices for the fat-finger check (the previous close, or a second source). */
  refPrices: Record<string, number>;
  /** This strategy's orders today, and the person's across all strategies. */
  sentToday: { usd: number; count: number };
  userSentTodayUsd: number;
  /** Times (ms) of this strategy's orders in the last minute. */
  recentOrderTimes: number[];
  unknownOrders: number;
  server: { maxOrderUsd: number; maxDayUsd: number };
  account: { type: "cash" | "margin" | "unknown"; equity: number; dayTradesLast5: number; pdtFlagged?: boolean };
  /** Sides traded today per symbol (fills and open orders), to tell when an order would be a day trade. */
  todaySides: Record<string, ("buy" | "sell")[]>;
  /** Sales at a loss in the last 30 days (symbol → date). */
  lossSales: Record<string, string>;
};

export type RuleId =
  | "kill_global" | "kill_user" | "kill_strategy" | "unknown_outstanding" | "market_closed" | "extended_hours" | "price_missing" | "fat_finger"
  | "max_order" | "server_max_order" | "max_day" | "server_max_day" | "rate_minute" | "rate_day" | "no_short" | "max_position" | "max_gross" | "max_net"
  | "daily_loss" | "drawdown_kill" | "pdt" | "wash_sale" | "bad_quantity";

export type Violation = { rule: RuleId; severity: "block" | "warn"; message: string };
export type OrderCheck = { ok: boolean; violations: Violation[]; trip: "drawdown" | null };

export const PDT_EQUITY = 25_000;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Whether an order adds risk (a buy, for long-only books; a sell that would go short). */
const addsRisk = (o: RiskOrder, held: number) => (o.side === "buy" ? held >= 0 : o.qty > held + 1e-9);

/** Check one order against the limits and the state. */
export function checkOrder(limits: RiskLimits, s: RiskState, o: RiskOrder): OrderCheck {
  const v: Violation[] = [];
  const block = (rule: RuleId, message: string) => v.push({ rule, severity: "block", message });
  const warn = (rule: RuleId, message: string) => v.push({ rule, severity: "warn", message });
  let trip: OrderCheck["trip"] = null;
  const value = o.qty * o.price;
  const held = s.positions[o.symbol] ?? 0;

  if (!(o.qty > 0) || !Number.isFinite(o.qty)) block("bad_quantity", "The order has no quantity.");
  // 1. Kill switches.
  if (s.kill.global) block("kill_global", "Trading is paused for everyone by YouBank's administrators.");
  if (s.kill.user && !o.manualLiquidation) block("kill_user", "Your kill switch is on: every strategy is paused. Turn it off to trade again.");
  if (s.kill.strategy && !o.manualLiquidation) block("kill_strategy", "This strategy's kill switch is on. Review it and turn it off to trade again.");
  // 2. Unknown outcomes.
  if (s.unknownOrders > 0 && !o.manualLiquidation) block("unknown_outstanding", `${s.unknownOrders} earlier order${s.unknownOrders === 1 ? " has" : "s have"} no confirmed outcome. Check your broker; new orders wait until it is settled.`);
  // 3. Market hours (equities and options).
  if (o.assetClass !== "crypto" && s.market && !s.market.open) {
    if (o.type === "market") block("market_closed", `The market is closed (${s.market.reason}); market orders wait for the open at ${s.market.nextOpen}.`);
    else if (s.extendedHoursNow && !limits.allowExtendedHours) block("extended_hours", "Extended-hours trading is off for this strategy.");
  }
  // 4. Prices.
  const ref = s.refPrices[o.symbol];
  if (!(o.price > 0)) block("price_missing", `There is no current price for ${o.symbol}, so the order cannot be checked.`);
  else if (ref > 0) {
    const px = o.limitPrice ?? o.price;
    const dev = Math.abs(px / ref - 1);
    if (dev > limits.fatFingerPct) block("fat_finger", `${o.symbol} at ${px.toFixed(2)} is ${pct(dev)} from its reference price ${ref.toFixed(2)}, beyond the ${pct(limits.fatFingerPct)} fat-finger limit.`);
  }
  // 5–7 do not hold back the person's own instruction to close a position (it only reduces risk).
  const closing = !!o.manualLiquidation && o.side === "sell";
  // 5. Per-order notional.
  if (!closing && value > limits.maxOrderUsd + 0.005) block("max_order", `The ${o.symbol} order (${usd(value)}) is over this strategy's per-order limit of ${usd(limits.maxOrderUsd)}.`);
  if (!closing && value > s.server.maxOrderUsd + 0.005) block("server_max_order", `The ${o.symbol} order (${usd(value)}) is over the server's per-order ceiling of ${usd(s.server.maxOrderUsd)}.`);
  // 6. Per-day notional.
  if (!closing && s.sentToday.usd + value > limits.maxDayUsd + 0.005) block("max_day", `This would take the strategy's orders today to ${usd(s.sentToday.usd + value)}, over its daily limit of ${usd(limits.maxDayUsd)}.`);
  if (!closing && s.userSentTodayUsd + value > s.server.maxDayUsd + 0.005) block("server_max_day", `This would take your orders today to ${usd(s.userSentTodayUsd + value)}, over the ${usd(s.server.maxDayUsd)} daily ceiling across your strategies.`);
  // 7. Throttles.
  const lastMinute = s.recentOrderTimes.filter((t) => s.now.getTime() - t < 60_000).length;
  if (!closing && lastMinute >= limits.maxOrdersPerMinute) block("rate_minute", `${lastMinute} orders in the last minute: the limit is ${limits.maxOrdersPerMinute}. The rest wait.`);
  if (!closing && s.sentToday.count >= limits.maxOrdersPerDay) block("rate_day", `${s.sentToday.count} orders today: the daily limit is ${limits.maxOrdersPerDay}.`);
  // 8. Short sales.
  // Writing a covered call or a cash-secured put opens an option position with a sell; that is not a short sale of stock.
  if (o.side === "sell" && o.qty > held + 1e-9 && o.assetClass !== "option" && !limits.allowShort) block("no_short", `Selling ${o.qty} ${o.symbol} would exceed the ${held} the strategy holds; short selling is not allowed.`);
  // 9. Exposure after the order.
  if (s.equity > 0) {
    const after = { ...s.positions, [o.symbol]: held + (o.side === "buy" ? o.qty : -o.qty) };
    const val = (k: string) => (after[k] ?? 0) * (k === o.symbol ? o.price : s.prices[k] ?? 0);
    const pos = Math.abs(val(o.symbol)) / s.equity;
    const gross = Object.keys(after).reduce((t, k) => t + Math.abs(val(k)), 0) / s.equity;
    const net = Object.keys(after).reduce((t, k) => t + val(k), 0) / s.equity;
    const increasing = addsRisk(o, held);
    if (increasing && pos > limits.maxPositionPct + 1e-6) block("max_position", `${o.symbol} would be ${pct(pos)} of the strategy, over its ${pct(limits.maxPositionPct)} position limit.`);
    if (increasing && gross > limits.maxGross + 1e-6) block("max_gross", `Gross exposure would be ${pct(gross)}, over the ${pct(limits.maxGross)} limit.`);
    if (increasing && net > limits.maxNet + 1e-6) block("max_net", `Net exposure would be ${pct(net)}, over the ${pct(limits.maxNet)} limit.`);
  }
  // 10. Daily loss.
  const dayPnl = s.startOfDayEquity > 0 ? s.equity / s.startOfDayEquity - 1 : 0;
  if (dayPnl <= -limits.dailyLossPct && addsRisk(o, held) && !o.manualLiquidation) block("daily_loss", `The strategy is down ${pct(-dayPnl)} today, past its ${pct(limits.dailyLossPct)} daily loss limit: only orders that reduce risk go until tomorrow.`);
  // 11. Drawdown kill switch.
  const dd = s.peakEquity > 0 ? s.equity / s.peakEquity - 1 : 0;
  if (dd <= -limits.maxDrawdownPct) {
    trip = "drawdown";
    if (!o.manualLiquidation) block("drawdown_kill", `The strategy is ${pct(-dd)} below its peak, past its ${pct(limits.maxDrawdownPct)} drawdown limit: its kill switch is now on.`);
  }
  // 12. Pattern day trading.
  const sides = s.todaySides[o.symbol] ?? [];
  const dayTrade = o.assetClass !== "crypto" && sides.some((x) => x !== o.side);
  if (dayTrade && s.account.type === "margin" && s.account.equity < PDT_EQUITY && !o.manualLiquidation) {
    if (limits.pdtMode === "legacy" && (s.account.dayTradesLast5 >= 3 || s.account.pdtFlagged)) block("pdt", `This ${o.side} of ${o.symbol} would be a day trade, and the account has made ${s.account.dayTradesLast5} in the last five business days with under ${usd(PDT_EQUITY)}: a fourth would flag it as a pattern day trader under the legacy rule.`);
    else if (limits.pdtMode !== "off") warn("pdt", `This ${o.side} of ${o.symbol} is a day trade (${s.account.dayTradesLast5 + 1} in five business days). Brokers moving to FINRA's intraday-margin rule may still restrict accounts under ${usd(PDT_EQUITY)}.`);
  }
  // 13. Wash sales.
  if (o.side === "buy" && s.lossSales[o.symbol]) warn("wash_sale", `${o.symbol} was sold at a loss on ${s.lossSales[o.symbol]}; buying it back within 30 days can make that loss a wash sale for taxes.`);

  return { ok: !v.some((x) => x.severity === "block"), violations: v, trip };
}

/**
 * Check a batch in order, as if each passing order were sent: later orders see the earlier ones' notional,
 * counts, positions and same-day sides. Blocked orders are dropped from the batch, not sent.
 */
export function checkOrders(limits: RiskLimits, state: RiskState, orders: RiskOrder[]): { passed: RiskOrder[]; results: (OrderCheck & { order: RiskOrder })[]; trip: OrderCheck["trip"] } {
  const s: RiskState = { ...state, positions: { ...state.positions }, sentToday: { ...state.sentToday }, recentOrderTimes: [...state.recentOrderTimes], todaySides: Object.fromEntries(Object.entries(state.todaySides).map(([k, x]) => [k, [...x]])), account: { ...state.account } };
  const results: (OrderCheck & { order: RiskOrder })[] = [];
  const passed: RiskOrder[] = [];
  let trip: OrderCheck["trip"] = null;
  for (const o of orders) {
    const r = checkOrder(limits, s, o);
    results.push({ ...r, order: o });
    if (r.trip) trip = r.trip;
    if (!r.ok) continue;
    passed.push(o);
    const value = o.qty * o.price;
    s.sentToday.usd += value; s.sentToday.count++; s.userSentTodayUsd += value;
    s.recentOrderTimes.push(s.now.getTime());
    s.positions[o.symbol] = (s.positions[o.symbol] ?? 0) + (o.side === "buy" ? o.qty : -o.qty);
    if ((s.todaySides[o.symbol] ?? []).some((x) => x !== o.side)) s.account.dayTradesLast5++;
    s.todaySides[o.symbol] = [...(s.todaySides[o.symbol] ?? []), o.side];
  }
  return { passed, results, trip };
}

/**
 * Day trades in the five business days ending `asOf`: per symbol and day, the number of buy–sell pairs
 * (an opening and a closing trade on the same day). `businessDays` are the last five trading days.
 */
export function countDayTrades(fills: { symbol: string; side: "buy" | "sell"; date: string }[], businessDays: string[]): number {
  const days = new Set(businessDays);
  const by = new Map<string, { b: number; s: number }>();
  for (const f of fills) {
    if (!days.has(f.date)) continue;
    const k = `${f.date}|${f.symbol}`;
    const x = by.get(k) ?? { b: 0, s: 0 };
    if (f.side === "buy") x.b++; else x.s++;
    by.set(k, x);
  }
  return [...by.values()].reduce((n, x) => n + Math.min(x.b, x.s), 0);
}

/** A summary for the dashboard's risk gauges: how much of each limit is used. */
export function riskUsage(limits: RiskLimits, s: Pick<RiskState, "equity" | "startOfDayEquity" | "peakEquity" | "positions" | "prices" | "sentToday">): { key: string; label: string; used: number; limit: number; unit: "usd" | "pct" | "count" }[] {
  const vals = Object.entries(s.positions).map(([k, u]) => u * (s.prices[k] ?? 0));
  const gross = s.equity > 0 ? vals.reduce((t, x) => t + Math.abs(x), 0) / s.equity : 0;
  const largest = s.equity > 0 ? Math.max(0, ...vals.map((x) => Math.abs(x))) / s.equity : 0;
  return [
    { key: "day_usd", label: "Orders today", used: s.sentToday.usd, limit: limits.maxDayUsd, unit: "usd" },
    { key: "day_count", label: "Order count today", used: s.sentToday.count, limit: limits.maxOrdersPerDay, unit: "count" },
    { key: "gross", label: "Gross exposure", used: gross, limit: limits.maxGross, unit: "pct" },
    { key: "position", label: "Largest position", used: largest, limit: limits.maxPositionPct, unit: "pct" },
    { key: "day_loss", label: "Loss today", used: s.startOfDayEquity > 0 ? Math.max(0, 1 - s.equity / s.startOfDayEquity) : 0, limit: limits.dailyLossPct, unit: "pct" },
    { key: "drawdown", label: "Drawdown from peak", used: s.peakEquity > 0 ? Math.max(0, 1 - s.equity / s.peakEquity) : 0, limit: limits.maxDrawdownPct, unit: "pct" },
  ];
}
