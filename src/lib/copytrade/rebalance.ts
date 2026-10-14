/**
 * The orders that move a copy from what it holds to its targets. Pure: the account, prices and settings
 * come in; a proposal a person reviews goes out. Nothing here talks to a broker.
 *
 * The rules (each one appears in the review screen):
 * - A copy has a size in dollars (a fixed amount, or a percentage of the account worked out before this
 *   runs). Each target gets size × weight.
 * - What the copy holds is what its own filled orders bought (`managed`), capped at what the account
 *   still holds. Shares the person holds outside the copy are protected: never counted, never sold.
 *   With the opt-in `sellOutside`, shares outside the copy in tickers the copy targets or holds count
 *   toward the target (so the copy does not buy a second stake) and may be trimmed. Unrelated holdings
 *   are never touched, opt-in or not.
 * - Whole shares unless the broker supports fractional ones (rounded down to 1/10,000 of a share).
 * - Orders smaller than the minimum order are skipped; orders larger than the per-order cap are cut.
 * - Sells first. Buys are paid from cash less a small buffer, plus (by default) the estimated proceeds of
 *   the sells, and are checked at the limit price, the most they could cost; when they do not fit, every
 *   buy is scaled down by the same factor.
 * - Limit orders by default, at the last price plus a band for buys and minus it for sells.
 */

export type BrokerPosition = { ticker: string; units: number; price: number };

export type RebalanceInput = {
  targets: { ticker: string; weight: number }[];
  budgetUsd: number;
  cash: number;
  positions: BrokerPosition[];
  managed: Record<string, number>;
  prices: Record<string, number>;
  fractional: boolean;
  minOrderUsd: number;
  sellOutside: boolean;
  cashBufferPct: number;
  useSaleProceeds: boolean;
  orderType: "Limit" | "Market";
  /** Limit band as a fraction (0.005 = 0.5%). */
  limitBand: number;
  maxOrderUsd: number;
};

export type OrderReason = "new" | "add" | "trim" | "exit";
export type ProposedOrder = {
  ticker: string;
  action: "BUY" | "SELL";
  units: number;
  /** Last price the estimate uses. */
  price: number;
  limitPrice: number | null;
  estValue: number;
  /** The most a buy could cost (at its limit), or the least a sell could raise. */
  boundValue: number;
  reason: OrderReason;
  /** Units of this sell that come from shares held outside the copy (only with the opt-in). */
  fromOutside: number;
  /** A sell can realise a taxable gain or loss. */
  taxCaution: boolean;
};

export type DiffRow = { ticker: string; weight: number; currentUnits: number; targetUnits: number; outsideUnits: number; price: number | null; currentValue: number; targetValue: number };

export type Proposal = {
  orders: ProposedOrder[];
  skipped: { ticker: string; reason: string }[];
  rows: DiffRow[];
  summary: { buys: number; sells: number; net: number; cashBefore: number; cashAfterEst: number; scaled: number | null; orders: number };
  warnings: string[];
};

const STEP = 1e-4;
export const roundUnits = (u: number, fractional: boolean) => (fractional ? Math.floor(u / STEP + 1e-9) * STEP : Math.floor(u + 1e-9));
const fix = (u: number) => Math.round(u / STEP) * STEP;

/** A limit price on the right side of the last price, in cents (four places under $1). */
export function limitPrice(price: number, action: "BUY" | "SELL", band: number): number {
  const raw = action === "BUY" ? price * (1 + band) : price * (1 - band);
  const tick = price >= 1 ? 100 : 10_000;
  return action === "BUY" ? Math.ceil(raw * tick - 1e-9) / tick : Math.floor(raw * tick + 1e-9) / tick;
}

const norm = (t: string) => t.trim().toUpperCase().replace(/\./g, "-");

export function proposeOrders(input: RebalanceInput): Proposal {
  const warnings: string[] = [];
  const skipped: { ticker: string; reason: string }[] = [];
  const held = new Map<string, number>();
  const posPrice = new Map<string, number>();
  for (const p of input.positions) { const t = norm(p.ticker); held.set(t, (held.get(t) ?? 0) + p.units); if (p.price > 0) posPrice.set(t, p.price); }
  const priceOf = (t: string) => { const p = input.prices[t] ?? posPrice.get(t); return p && p > 0 ? p : null; };
  const targets = new Map(input.targets.filter((t) => t.weight > 0).map((t) => [norm(t.ticker), t.weight]));
  const managed = new Map(Object.entries(input.managed).map(([t, u]) => [norm(t), u]));
  const scope = new Set([...targets.keys(), ...[...managed].filter(([, u]) => u > 0).map(([t]) => t)]);

  const rows: DiffRow[] = [];
  type Work = { t: string; price: number; current: number; target: number; outside: number; weight: number };
  const work: Work[] = [];
  for (const t of scope) {
    const account = held.get(t) ?? 0;
    const own = Math.min(managed.get(t) ?? 0, account);
    const current = input.sellOutside ? account : own;
    const outside = account - current;
    const weight = targets.get(t) ?? 0;
    const price = priceOf(t);
    const target = price ? roundUnits((input.budgetUsd * weight) / price, input.fractional) : current;
    rows.push({ ticker: t, weight, currentUnits: fix(current), targetUnits: fix(target), outsideUnits: fix(outside), price, currentValue: price ? current * price : 0, targetValue: price ? target * price : 0 });
    if (!price) { skipped.push({ ticker: t, reason: "No current price, so no order" }); continue; }
    if (weight > 0 && target === 0 && current === 0) skipped.push({ ticker: t, reason: input.fractional ? "Its share of the copy is too small to buy" : `One share costs more than its ${Math.round(weight * 1000) / 10}% of the copy, and this broker trades whole shares only` });
    work.push({ t, price, current, target, outside, weight });
  }

  const sells: ProposedOrder[] = [];
  const buys: ProposedOrder[] = [];
  const cap = (o: ProposedOrder): ProposedOrder | null => {
    if (input.maxOrderUsd > 0 && o.units * o.price > input.maxOrderUsd) {
      const u = roundUnits(input.maxOrderUsd / o.price, input.fractional);
      warnings.push(`${o.ticker}: cut to ${u} shares by the per-order limit of $${input.maxOrderUsd.toLocaleString("en-US")}.`);
      if (u <= 0) return null;
      o = { ...o, units: u };
    }
    o.estValue = o.units * o.price;
    o.boundValue = o.units * (o.limitPrice ?? (o.action === "BUY" ? o.price * (1 + input.limitBand) : o.price * (1 - input.limitBand)));
    if (o.estValue < input.minOrderUsd) { skipped.push({ ticker: o.ticker, reason: `Below the $${input.minOrderUsd} minimum order` }); return null; }
    return o;
  };
  for (const w of work) {
    const delta = w.target - w.current;
    if (Math.abs(delta) < STEP / 2) continue;
    if (delta < 0) {
      // A full exit sells everything the copy holds, fractional remainder included.
      let units = w.target === 0 ? w.current : roundUnits(-delta, input.fractional);
      units = Math.min(units, w.current);
      if (units <= 0) continue;
      const fromOutside = input.sellOutside ? Math.max(0, units - Math.min(managed.get(w.t) ?? 0, held.get(w.t) ?? 0)) : 0;
      const o = cap({ ticker: w.t, action: "SELL", units: fix(units), price: w.price, limitPrice: input.orderType === "Limit" ? limitPrice(w.price, "SELL", input.limitBand) : null, estValue: 0, boundValue: 0, reason: w.target === 0 ? "exit" : "trim", fromOutside: fix(fromOutside), taxCaution: true });
      if (o) sells.push(o);
    } else {
      const units = roundUnits(delta, input.fractional);
      if (units <= 0) continue;
      const o = cap({ ticker: w.t, action: "BUY", units, price: w.price, limitPrice: input.orderType === "Limit" ? limitPrice(w.price, "BUY", input.limitBand) : null, estValue: 0, boundValue: 0, reason: w.current > 0 ? "add" : "new", fromOutside: 0, taxCaution: false });
      if (o) buys.push(o);
    }
  }

  const sellBound = sells.reduce((s, o) => s + o.boundValue, 0);
  const available = Math.max(0, input.cash * (1 - input.cashBufferPct)) + (input.useSaleProceeds ? sellBound : 0);
  const buyBound = buys.reduce((s, o) => s + o.boundValue, 0);
  let scaled: number | null = null;
  let finalBuys = buys;
  if (buyBound > available + 1e-6) {
    scaled = buyBound > 0 ? available / buyBound : 0;
    warnings.push(`Not enough cash for every buy: each buy is scaled to ${Math.round(scaled * 100)}% of its size.`);
    finalBuys = [];
    for (const o of buys) {
      const units = roundUnits(o.units * scaled, input.fractional);
      if (units <= 0) { skipped.push({ ticker: o.ticker, reason: "Dropped when buys were scaled to the cash available" }); continue; }
      const est = units * o.price;
      if (est < input.minOrderUsd) { skipped.push({ ticker: o.ticker, reason: `Below the $${input.minOrderUsd} minimum order after scaling to the cash available` }); continue; }
      finalBuys.push({ ...o, units, estValue: est, boundValue: units * (o.limitPrice ?? o.price * (1 + input.limitBand)) });
    }
  }
  const orders = [...sells, ...finalBuys];
  const buysEst = finalBuys.reduce((s, o) => s + o.estValue, 0);
  const sellsEst = sells.reduce((s, o) => s + o.estValue, 0);
  if (sells.length) warnings.push("Sells can realise taxable gains or losses, short-term for shares held under a year. Check your tax lots with your broker before approving.");
  if (input.useSaleProceeds && sells.length && finalBuys.length) warnings.push("Buys use the estimated proceeds of the sells. In a cash account, buying with unsettled proceeds and selling before they settle can break your broker's rules.");
  const protectedOut = [...held].filter(([t, u]) => u > 0 && !(input.sellOutside && scope.has(t)) && (managed.get(t) ?? 0) < u).length;
  if (protectedOut && !input.sellOutside) warnings.push(`${protectedOut} position${protectedOut === 1 ? "" : "s"} you hold outside this copy ${protectedOut === 1 ? "is" : "are"} left alone.`);
  return {
    orders, skipped, rows: rows.sort((a, b) => b.weight - a.weight || b.currentValue - a.currentValue),
    summary: { buys: buysEst, sells: sellsEst, net: buysEst - sellsEst, cashBefore: input.cash, cashAfterEst: input.cash - buysEst + sellsEst, scaled, orders: orders.length },
    warnings,
  };
}
