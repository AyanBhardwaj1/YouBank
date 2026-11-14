/**
 * Cross-venue spreads, net of fees. Pure.
 *
 * If two venues list the same yes/no question, buying yes on one and no on the other pays $1 whichever way it
 * resolves, so the pair costs (yes ask on A) + (no ask on B) = askA + (1 - bidB). The gross edge is what is
 * left of the dollar: bidB - askA. Fees come off that. It is NOT risk-free arbitrage:
 * - the two venues' rules can resolve the "same" question differently (a source, a deadline, a rounding
 *   rule), and then both legs can lose;
 * - capital is locked until settlement (often weeks), and moving money between a regulated US exchange and a
 *   crypto venue costs time and money not counted here;
 * - quotes move, and the size at the best price is small.
 * So the app shows it as information: where the venues disagree, by how much, after the fees below.
 *
 * Taker fees per $1 contract at price p, as published (verify on each venue before relying on them):
 * - Kalshi: 0.07 x p x (1 - p), rounded up to the cent per order (at most 1.75 cents at 50 cents);
 *   computed here on a 100-contract order.
 * - Polymarket: most markets had no trading fee; since March 2026 some categories carry a taker fee of
 *   rate x p x (1 - p). 0.04 is used here, at or above the published category rates, to stay conservative.
 * - Gemini: a per-contract fee whose amount we could not confirm; Kalshi's formula is used as a stand-in.
 * - Manifold: play money, never part of a spread.
 */
import type { Market, Venue } from "./types";

export const FEE_BASIS: Record<Venue, string> = {
  kalshi: "Kalshi taker fee: 7% of p x (1 - p) per contract, rounded up to the cent per order.",
  polymarket: "Polymarket: up to 4% of p x (1 - p) per contract (category taker fees since March 2026; many markets charge none).",
  gemini: "Gemini: Kalshi's formula as a stand-in; Gemini's own per-contract fee was not confirmed.",
  manifold: "Manifold is play money and has no tradable spread.",
};

/** Taker fee in dollars per $1 contract bought at `p` on `venue`; null when the venue cannot be traded for money. */
export function takerFee(venue: Venue, p: number, contracts = 100): number | null {
  if (!(p > 0 && p < 1)) return 0;
  const q = p * (1 - p);
  switch (venue) {
    case "kalshi":
    case "gemini":
      // Rounded up to the cent on the whole order, then per contract.
      return Math.ceil(0.07 * contracts * q * 100 - 1e-9) / 100 / contracts;
    case "polymarket": return 0.04 * q;
    default: return null;
  }
}

export type Spread = {
  /** Mid-to-mid difference, B minus A, in probability. */
  gap: number;
  /** Which way the better pair runs: yes on `yesOn`, no on the other. */
  yesOn: Venue; noOn: Venue;
  /** Cost of the pair (yes ask + no ask), before fees. */
  cost: number;
  /** 1 - cost: what is left of the $1 payout before fees (negative: no edge). */
  gross: number;
  fees: number;
  /** gross - fees. */
  net: number;
  /** Whether both venues gave real bids and asks (false: mids or last trades stood in, so the figure is rougher). */
  quoted: boolean;
};

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** The better of the two pairs between markets A and B, net of fees; null when either has no price or is not tradable. Pure. */
export function spreadBetween(a: Pick<Market, "venue" | "prob" | "bid" | "ask" | "realMoney">, b: Pick<Market, "venue" | "prob" | "bid" | "ask" | "realMoney">): Spread | null {
  if (a.prob === null || b.prob === null || !a.realMoney || !b.realMoney) return null;
  const quoted = a.bid !== null && a.ask !== null && b.bid !== null && b.ask !== null;
  const askA = a.ask ?? a.prob, bidA = a.bid ?? a.prob, askB = b.ask ?? b.prob, bidB = b.bid ?? b.prob;
  const leg = (yes: typeof a, yesAsk: number, no: typeof b, noBid: number) => {
    const noAsk = 1 - noBid;
    const fees = (takerFee(yes.venue, yesAsk) ?? 0) + (takerFee(no.venue, noAsk) ?? 0);
    const cost = yesAsk + noAsk;
    return { yesOn: yes.venue, noOn: no.venue, cost: r4(cost), gross: r4(1 - cost), fees: r4(fees), net: r4(1 - cost - fees) };
  };
  const one = leg(a, askA, b, bidB), two = leg(b, askB, a, bidA);
  const best = one.net >= two.net ? one : two;
  return { gap: r4(b.prob - a.prob), ...best, quoted };
}

/** Days until a market closes (fractional), or null. Pure. */
export const daysToClose = (m: Pick<Market, "closeTime">, now = Date.now()) => (m.closeTime ? (Date.parse(m.closeTime) - now) / 86_400_000 : null);

/**
 * A net edge as an annualised rate on the capital the pair ties up until the later close. Small edges on
 * long-dated markets are worth less than they look; this says by how much. Null without a close. Pure.
 */
export function annualised(net: number, cost: number, days: number | null): number | null {
  if (days === null || days <= 0 || cost <= 0) return null;
  return r4(net / cost * (365 / Math.max(days, 1)));
}
