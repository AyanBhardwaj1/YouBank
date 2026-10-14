import type { PremiumFeature } from "./types";

/**
 * Premium features: copying hedge-fund 13F portfolios (the copy-trading work owns this file).
 *
 * Free for everyone, and so not listed here: browsing funds and their 13F holdings, quarter-over-quarter
 * changes, the lag-aware clone backtests, paper copies (up to 10) and alerts when a followed fund files.
 * All of it reads SEC EDGAR and free price data.
 *
 * - copytrade.broker: connecting brokerages through SnapTrade and placing copy orders. SnapTrade bills
 *   per connected user per month (about $2 on its pay-as-you-go plan with trading, at list price in
 *   October 2026; volume plans are lower), whether or not that person trades that month. The pricing
 *   model (lib/billing/costs.ts) multiplies costPerUseUsd by uses a month (4 at typical use), so a flat
 *   monthly fee is entered as a quarter of it per "use": $0.50 a week, $2 a month at typical use, exactly
 *   SnapTrade's charge. Paid outside the AI ledger, so not in the AI allowance. A connection is made only
 *   when the person clicks Connect, and deleted when they disconnect, which stops the charge.
 * - copytrade.blends and copytrade.multi are perks of the plan, with no cost per use.
 */
export const COPYTRADE_FEATURES: PremiumFeature[] = [
  {
    id: "copytrade.broker", area: "platform", name: "Copy trading with your broker",
    description: "Connect Schwab, Fidelity, Robinhood, IBKR and about 20 other brokers, and place a fund copy's orders after you approve each batch.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.5,
    perUse: "a week of one connected brokerage user: SnapTrade charges about $2 per connected user per month while the connection exists, and the pricing model counts 4 uses a month at typical use (20 at heavy, which overstates a flat monthly fee)",
  },
  {
    id: "copytrade.blends", area: "platform", name: "Fund blends",
    description: "Copy a blend of several funds, weighted as you choose, as one portfolio.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
  },
  {
    id: "copytrade.multi", area: "platform", name: "More live copies",
    description: "Run up to 10 live copies at once (Pro runs 2).",
    minPlan: "team", metered: false, costPerUseUsd: 0,
  },
];
