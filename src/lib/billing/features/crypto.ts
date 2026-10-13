import type { PremiumFeature } from "./types";

/**
 * Premium features: Blockchain and crypto (the crypto work owns this file).
 *
 * The crypto research itself (prices, DeFi, stablecoins, Bitcoin, raises, unlocks, treasuries, RWAs,
 * the mining map, a read-only portfolio from public nodes and notarizing on Base) is free: it runs on
 * free public APIs. These three call paid APIs and run only when a person asks:
 *
 * - wallet-deep: Alchemy and Helius bill compute units. A run is about 5 chains x (one balance call,
 *   up to 60 metadata calls, two transfer calls) on Alchemy, roughly 3,000 to 8,000 CUs, plus one
 *   Helius call: under a cent at pay-as-you-go rates, so 0.01 is a cautious figure.
 * - pro-data: CoinGecko Pro and DefiLlama Pro are flat subscriptions (about $129 and $300 a month);
 *   spread over expected use that is about a tenth of a cent a request.
 * - dune: reading a saved query's latest results costs Dune credits by the data returned; capped at
 *   500 rows, about 5 credits, roughly 5 cents on a paid plan.
 */
export const CRYPTO_FEATURES: PremiumFeature[] = [
  {
    id: "crypto.wallet-deep",
    area: "crypto",
    name: "Deep wallet analytics",
    description: "Every token a wallet holds across Ethereum, its L2s and Solana, with recent transfers and counterparties, from paid indexers (Alchemy, Helius).",
    minPlan: "pro",
    metered: true,
    costPerUseUsd: 0.01,
  },
  {
    id: "crypto.pro-data",
    area: "crypto",
    name: "Pro crypto data",
    description: "CoinGecko Pro and DefiLlama Pro on request: more tokens, fuller histories, and raises and unlock schedules when the free feeds fall short.",
    minPlan: "pro",
    metered: true,
    costPerUseUsd: 0.001,
  },
  {
    id: "crypto.dune",
    area: "crypto",
    name: "Dune queries",
    description: "Load the latest results of any saved Dune query (on-chain SQL: exchange flows, whale cohorts, protocol metrics) into a table you can sort and export.",
    minPlan: "team",
    metered: true,
    costPerUseUsd: 0.05,
  },
];
