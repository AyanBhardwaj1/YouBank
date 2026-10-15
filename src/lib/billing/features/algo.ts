import type { PremiumFeature } from "./types";

/**
 * Premium features: algorithmic and agentic trading (the algo trading work owns this file; docs/algo-trading.md).
 *
 * Free for everyone, and so not listed here: the strategy builder and templates, backtests with walk-forward
 * and the overfitting checks, and paper trading (up to 3 strategies, decisions at most daily). Backtests run
 * in the request on free price data; paper ticks are a small shared background pass (the "Algo trading"
 * line in costs.ts FIXED).
 *
 * - algo.live: live trading with approval (Pro). The brokers' APIs cost us nothing per person (Alpaca,
 *   Webull's OpenAPI, Robinhood's Crypto API); SnapTrade's per-user fee is the copy trading connection
 *   already counted under copytrade.broker, shared, not charged twice. What remains is the background work
 *   of live strategies: intraday ticks (at most every 15 minutes in market hours), order sends and status
 *   checks. For ten strategies ticking hourly with a few orders a day that is about 0.6 CPU-hours on
 *   Vercel ($0.08) and 0.2 Neon compute-hours ($0.02) a month: flatMonthlyUsd $0.10, counted once a month
 *   by adoption. Server caps: 10 strategies on Pro, 25 on Deal Team; ticks stop outside market hours.
 * - algo.agent: the AI trading agent (Pro). Each turn is two structured model calls (plan, then answer) on
 *   the person's chosen model, about the cost of one assistant answer ($0.24 on the default model), recorded
 *   in the AI ledger through structured() and so inside the AI allowance; ten turns a minute at most.
 * - algo.autonomous: live autonomous trading (Deal Team). The same ticks and orders as algo.live, so no cost
 *   of its own; it is a plan perk because it carries the most risk and the strictest gates.
 * - algo.more: more strategies (25) and 15-minute intraday decisions (Deal Team). A perk: the ticks are
 *   inside algo.live's figure, which is counted at heavy use for everyone on the plan.
 */
export const ALGO_FEATURES: PremiumFeature[] = [
  {
    id: "algo.live", area: "platform", name: "Live algo trading with approval",
    description: "Run strategies on your own Alpaca, Webull, Robinhood Crypto or SnapTrade-connected account; each batch of orders waits for your tap.",
    minPlan: "pro", metered: true, costPerUseUsd: 0, flatMonthlyUsd: 0.1,
    perUse: "a month of live strategies' background work: intraday ticks, order sends and status checks, about 0.6 Vercel CPU-hours and 0.2 Neon compute-hours for ten strategies; broker APIs are free and SnapTrade's fee is copytrade.broker's",
  },
  {
    id: "algo.agent", area: "ai", name: "AI trading agent",
    description: "Talk to an agent that builds strategies, runs backtests, explains every trade and pauses things; it never trades on what it reads.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.24,
    perUse: "a turn: a planning call and an answering call on the person's model, about one assistant answer's tokens ($0.24 on the default model), recorded in the AI ledger",
  },
  {
    id: "algo.autonomous", area: "platform", name: "Autonomous algo trading",
    description: "Let a strategy trade within its limits without asking each time, after 14 days on paper and a typed confirmation.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the same ticks and orders as live trading with approval",
  },
  {
    id: "algo.more", area: "platform", name: "More strategies and 15-minute decisions",
    description: "Run up to 25 strategies (Pro runs 10) and let intraday strategies decide every 15 minutes (Pro: hourly).",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the ticks are inside algo.live's monthly figure",
  },
];
