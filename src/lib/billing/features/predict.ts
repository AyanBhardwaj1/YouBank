import type { PremiumFeature } from "./types";

/**
 * Premium features of Prediction markets (src/lib/predict; the prediction-markets work owns this file).
 *
 * Free for everyone, and so not listed here: the markets browser across Kalshi, Polymarket, Gemini and
 * Manifold, each market's history, book and rules, the cross-venue spreads, the rule-based stock mapping,
 * the Book's event exposure, up to five watched markets with move alerts, paper forecasts with Brier scores,
 * and the MCP tools. All of it reads the venues' free public market-data endpoints through the shared cache.
 */
export const PREDICT_FEATURES: PremiumFeature[] = [
  {
    id: "predict.watch-pro", area: "predict", name: "More market alerts",
    description: "Watch up to 100 prediction markets for probability moves, instead of five.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk with no cost of its own: the hourly check reads each watched market once from the shared cache, however many people watch it",
  },
  {
    id: "predict.ai-map", area: "predict", name: "AI stock mapping for events",
    description: "Ask the AI which further stocks an event moves, beyond the rules' sectors and named companies, each with its reason.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.002,
    perUse: "one reading: about 1,500 tokens in and 400 out on the small model, recorded in the AI ledger as the person, cached per market for a week; 30 a day",
  },
];
