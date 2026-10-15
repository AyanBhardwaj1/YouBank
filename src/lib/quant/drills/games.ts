/**
 * Q14: the games, with virtual money only (no prizes, no stakes). Pure and seeded, so the browser plays them
 * and the result can be checked.
 *
 * - The Kelly coin (Haghani and Dewey 2016): $25, a coin that lands heads 60% of the time, 300 flips, winnings
 *   capped at $250. Afterwards, the person's path against Kelly's (20% of wealth each flip) on the same flips.
 * - The market-making game: an unknown value (the sum of three dice); the person quotes a bid and an ask each
 *   round; simulated traders, a share of them informed, trade against the quote. The score separates the
 *   spread earned from what informed traders took (adverse selection).
 * - Expected-value problems with worked answers.
 */
import { rng } from "../stats/core";

/* ---------------- The Kelly coin ---------------- */

export const COIN = { start: 25, p: 0.6, flips: 300, cap: 250 } as const;

/** The flips of a game, from its seed (true = heads). */
export function coinFlips(seed: number, n: number = COIN.flips): boolean[] {
  const u = rng(seed);
  return Array.from({ length: n }, () => u() < COIN.p);
}

export type CoinBet = { side: "heads" | "tails"; amount: number };
export type CoinResult = { path: number[]; kellyPath: number[]; busted: boolean; capped: boolean; final: number; kellyFinal: number; maxBetShare: number; flipsPlayed: number; betTails: number };

/** Play bets against the flips; a bet larger than wealth is cut to wealth; the game stops at $0 or the cap. */
export function playCoin(flips: boolean[], bets: CoinBet[]): CoinResult {
  let w: number = COIN.start, k: number = COIN.start, maxShare = 0, played = 0, tails = 0;
  const path = [w], kellyPath = [k];
  for (let i = 0; i < Math.min(flips.length, bets.length); i++) {
    if (w <= 0.005 || w >= COIN.cap) break;
    const b = bets[i], amt = Math.max(0, Math.min(b.amount, w));
    maxShare = Math.max(maxShare, w > 0 ? amt / w : 0);
    if (b.side === "tails" && amt > 0) tails++;
    const won = (b.side === "heads") === flips[i];
    w = Math.min(COIN.cap, Math.round((w + (won ? amt : -amt)) * 100) / 100);
    if (k < COIN.cap) k = Math.min(COIN.cap, k * (flips[i] ? 1.2 : 0.8));
    path.push(w); kellyPath.push(Math.round(k * 100) / 100);
    played++;
  }
  return { path, kellyPath, busted: w <= 0.005, capped: w >= COIN.cap, final: w, kellyFinal: Math.round(k * 100) / 100, maxBetShare: maxShare, flipsPlayed: played, betTails: tails };
}

/* ---------------- Market making ---------------- */

export type MmRound = { bid: number; ask: number };
export type MmTrade = { round: number; trader: "informed" | "noise"; side: "buy" | "sell"; price: number };
export type MmResult = { value: number; trades: MmTrade[]; inventory: number; cash: number; pnl: number; spreadEarned: number; adverseSelection: number; informedShare: number };

/**
 * One game: the hidden value is the sum of three dice. Each round one trader arrives; with probability
 * `informedShare` they know the value (they buy at the ask if it is below the value, sell at the bid if it is
 * above, else pass); otherwise they buy or sell at random. P&L is marked to the true value at the end;
 * spread earned is measured against the expected value 10.5, adverse selection is the rest.
 */
export function playMarketMaking(seed: number, quotes: MmRound[], informedShare = 0.3): MmResult {
  const u = rng(seed);
  const die = () => 1 + Math.floor(u() * 6);
  const value = die() + die() + die();
  const trades: MmTrade[] = [];
  let inventory = 0, cash = 0, spread = 0;
  quotes.forEach((q, round) => {
    const bid = Math.min(q.bid, q.ask), ask = Math.max(q.bid, q.ask);
    const informed = u() < informedShare;
    let side: "buy" | "sell" | null;
    if (informed) side = ask < value ? "buy" : bid > value ? "sell" : null;
    else side = u() < 0.5 ? "buy" : "sell";
    if (!side) return;
    const price = side === "buy" ? ask : bid;
    if (side === "buy") { inventory -= 1; cash += price; spread += price - 10.5; }
    else { inventory += 1; cash -= price; spread += 10.5 - price; }
    trades.push({ round, trader: informed ? "informed" : "noise", side, price });
  });
  const pnl = cash + inventory * value;
  return { value, trades, inventory, cash, pnl, spreadEarned: spread, adverseSelection: pnl - spread, informedShare };
}

/* ---------------- Expected value ---------------- */

export type EvProblem = { id: string; question: string; answer: number; unit: string; worked: string };

export function evProblems(): EvProblem[] {
  // Reroll a d100 for $1: reroll when the roll is below 50.5 - 1 = 49.5, i.e. 49 or less.
  const reroll = 0.49 * (50.5 - 1) + (Array.from({ length: 51 }, (_, i) => 50 + i).reduce((s, k) => s + k, 0)) / 100;
  return [
    { id: "d100-reroll", question: "You roll a fair 100-sided die and are paid its number in dollars. After seeing the roll you may pay $1 to roll again (and take the new number). Playing well, what is the game worth?", answer: Math.round(reroll * 1000) / 1000, unit: "$", worked: `Reroll when the first roll is 49 or less (a new roll is worth $50.50 less the $1 fee, $49.50). Value = 0.49 x 49.50 + (50 + 51 + ... + 100) / 100 = 24.255 + 38.25 = $${reroll.toFixed(3)}.` },
    { id: "coin-kelly", question: "A coin lands heads 55% of the time and pays even money. What fraction of your bankroll maximises long-run growth?", answer: 0.1, unit: "fraction", worked: "Kelly: f* = p - (1 - p)/b = 0.55 - 0.45/1 = 0.10, so 10% of the bankroll per flip." },
    { id: "binary-option", question: "A contract pays $100 if a stock closes above $50 in a month, else nothing. You think the chance is 30%. Ignoring interest, what is the most you would pay?", answer: 30, unit: "$", worked: "Expected payoff = 0.30 x $100 = $30; paying more than that has a negative expected value at your own estimate." },
    { id: "two-dice", question: "What is the expected value of the larger of two fair six-sided dice?", answer: 161 / 36, unit: "pips", worked: "P(max = k) = (2k - 1)/36, so E = Σ k(2k - 1)/36 for k = 1..6 = 161/36 ≈ 4.47." },
    { id: "spread-cost", question: "You buy 200 shares at the ask of $20.04 when the bid is $20.00, and sell later at the bid of an unchanged quote. What did the spread cost you in dollars?", answer: 8, unit: "$", worked: "You pay the full spread on a round trip: 200 x $0.04 = $8 (half on the way in, half on the way out, measured from the mid)." },
  ];
}
