import type { PremiumFeature } from "./types";

/**
 * Premium features of Quant Edge (docs/quant-edge.md, section 8; the Quant work owns this file).
 *
 * Free for everyone, and so not listed here: every calculator (Kelly, risk parity, volatility targeting, the
 * drawdown governor on entered returns), "check a claim", one uploaded return series graded (PSR, DSR, MinTRL,
 * bootstrap, costs), the grade and top warnings of any strategy family, factor exposures for up to 30 holdings,
 * the risk view with the five historical replays and two hypothetical shocks, one-day 95% VaR with its
 * backtest, the fills import and daily-bar cost analysis, a pre-trade cost estimate for one symbol, the latest
 * Rule 605/606 summary for the person's broker, insider and activist signals on watched and held companies with
 * the board's top 20 and base rates, and Desk Drills. All of it runs on free public data, stored rows and
 * in-process maths.
 *
 * Margins (docs/pricing.md): Deal Team's yearly full-allowance margin is at the 25% floor once the algo branch
 * merges (about $0.04 a seat a month of room), and every Pro feature is also on Deal Team and Enterprise. So no
 * feature here adds a cost paid outside the AI allowance:
 * - The compute layers (Factor Lab, Risk and Integrity Pro) are perks with no cost of their own. Their CPU is
 *   small (a few CPU-seconds on Vercel, $0.0000356 a CPU-second: well under a tenth of a cent a use), sits inside
 *   the per-person infrastructure usage costs.ts already models, and is capped per person per day on the server
 *   (lib/quant/access.ts CAPS), so a repeated click cannot run it up. `perUse` states the compute honestly.
 * - The one model-backed layer (13D Item 4 readings) records its spend in the AI ledger as the person
 *   (`inAiAllowance`), so the allowance bounds it.
 * - The minute-bar vendor (planned) is a fixed monthly fee, to be added to FIXED in costs.ts when bought.
 * The Pairs scanner (Q10, a later round) is deliberately not registered: its ML-service scans (about $0.01 each,
 * outside the AI ledger) would break the Deal Team floor; it needs another design when it is built.
 *
 * An "Investor" plan (open question 2) is not added here: that is a pricing decision. If the owner adds one,
 * the Pro-level layers below that a retail investor uses most (factorlab, risk, integrity, sizing, tca) are the
 * natural set to unlock there; they are registered at Pro meanwhile.
 */
export const QUANT_FEATURES: PremiumFeature[] = [
  /* ---------------- Q1 Factor Lab ---------------- */
  {
    id: "quant.factorlab-pro", area: "quant", name: "Factor Lab Pro",
    description: "Factor exposures for up to 200 holdings, holdings synced from a connected broker, and the longest factor history.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk with no cost of its own: one run is regressions on up to 200 holdings over ten years of daily factor returns, about 5 CPU-seconds on Vercel (under $0.0002), inside the modelled infrastructure; 120 a day",
  },
  /* ---------------- Q2 Risk Model and Stress Tests ---------------- */
  {
    id: "quant.risk-pro", area: "quant", name: "Risk Pro",
    description: "Unlimited hypothetical shocks, reverse stress tests, 10,000-path stress runs, and value at risk at every horizon and level.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk with no cost of its own: one stress run is 10,000 paths of filtered historical simulation, about 10 CPU-seconds on Vercel (under $0.0004), inside the modelled infrastructure; 60 a day",
  },
  /* ---------------- Q3 Backtest Integrity Checker ---------------- */
  {
    id: "quant.integrity-pro", area: "quant", name: "Integrity Pro",
    description: "Trial matrices up to 500 variants with PBO, White's Reality Check, the placebo run and the full report with neighbourhood maps.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk with no cost of its own: one report is PBO's 12,870 splits on 500 trials (about 3 CPU-seconds, measured) plus the Reality Check and placebo bootstraps, about 10 CPU-seconds in all (under $0.0004), inside the modelled infrastructure; 60 a day",
  },
  /* ---------------- Q4 Sizing and Drawdown Governor ---------------- */
  {
    id: "quant.sizing-pro", area: "quant", name: "Sizing Pro",
    description: "Drawdown-governor simulations on strategy families, multi-asset Kelly above five assets, and risk budgets saved for the algo engine.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the same calculators on more inputs, well under a tenth of a cent",
  },
  /* ---------------- Q5 Execution Cost Analyzer ---------------- */
  {
    id: "quant.tca-pro", area: "quant", name: "Costs Pro",
    description: "Fills synced from a connected broker, every broker's Rule 605 and 606 history by order size, and cost estimates inside copy batches.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the broker sync reuses the SnapTrade connection copy trading already pays for (copytrade.broker); the scorecards are stored rows",
  },
  {
    id: "quant.tca-minute", area: "quant", name: "Minute-bar shortfall",
    description: "Implementation shortfall of each fill against the minute it was placed, and options fills against the mid.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true,
    perUse: "the minute-bar vendor is a fixed monthly fee (about $29, open question 1), added to FIXED in costs.ts when bought; not built until a vendor is chosen",
  },
  /* ---------------- Q7 Insider and Activist Clusters ---------------- */
  {
    id: "quant.insiders-pro", area: "quant", name: "Insiders Pro",
    description: "The full insider and activist board with filters, the event lists behind each base rate, and 13D purpose readings with the quote.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.002,
    perUse: "one 13D Item 4 reading: about 6,000 tokens in and 300 out on the small model (gpt-6-luna), recorded in the AI ledger as the person, cached per filing so a filing is read once; 20 a day",
  },
  /* ---------------- Q14 Desk Drills ---------------- */
  {
    id: "quant.drills-teams", area: "quant", name: "Team drill leaderboards",
    description: "A private calibration leaderboard for your team: who is best calibrated on Desk Drills and their own calls.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: one query over the team's stored drill scores",
  },
  /* ---------------- Later rounds (registered for the cost model; unlock nothing yet) ---------------- */
  {
    id: "quant.events-pro", area: "quant", name: "Event Desk Pro",
    description: "The market-wide event board, custom event studies on your own event lists, and exports.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true, perUse: "a perk: stored base rates and a CPU event study",
  },
  {
    id: "quant.diff-pro", area: "quant", name: "Filing changes Pro",
    description: "The market-wide filing-change board, written summaries of what changed, and alerts.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.03, planned: true,
    perUse: "one filing summary on the small model with embeddings, $0.01 to $0.03; must record through the AI ledger when built",
  },
  {
    id: "quant.vol-pro", area: "quant", name: "Volatility Desk Pro",
    description: "Shared implied volatility, skew, term structure history and dealer gamma estimates.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true, perUse: "a perk once an options data licence exists (a fixed vendor fee); not built",
  },
  {
    id: "quant.sleeves", area: "quant", name: "Factor sleeves",
    description: "Up to five rules-based factor sleeves, each graded, as targets the algo engine can follow.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true, perUse: "a perk: CPU backtests on stored data; waits for counsel's review",
  },
  {
    id: "quant.sleeves-team", area: "quant", name: "Shared firm sleeves",
    description: "Sleeves shared across your team.",
    minPlan: "team", metered: false, costPerUseUsd: 0, planned: true, perUse: "a perk",
  },
  {
    id: "quant.crowding-pro", area: "quant", name: "Short interest and crowding boards",
    description: "Market-wide short interest and hedge-fund crowding boards, with exports.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true, perUse: "a perk: free FINRA and 13F data",
  },
];
