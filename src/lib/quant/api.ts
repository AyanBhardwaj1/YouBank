/**
 * Quant Edge's server API for the algo engine (claude/new-session-6k1ff0-algo), in one place. The two sides
 * meet only here, at contracts.ts, at the Inngest events (jobs.ts QUANT_EVENTS) and at the /api/quant routes;
 * neither imports the other's internals (docs/quant-edge.md, section 5.1).
 *
 *   signalsAsOf({ producers, symbols, at })   backtests: signals usable at `at` (no look-ahead)
 *   latestSignals({ producers, symbols })      live: signals valid now
 *   getTarget(key, { at }), targetHistory(key) target portfolios (13F clones today)
 *   logTrial({ family, params, returns, ... }) every backtest run is a trial (rule 3)
 *   integrityCheck(family, { ownerId })        the IntegrityReport (report.grade), before going live
 *   liveGate(report, family), logOverride(...) rule 6: D or F needs a typed, logged override for live trading
 *   estimateCost(symbol, notionalUsd, side)    the pre-trade CostEstimate
 *   latestRiskBudget(ownerId, accountRef)      the person's latest RiskBudget (adopt or tighten, never loosen)
 */
export { signalsAsOf, latestSignals, publishSignals } from "./signals";
export { getTarget, targetHistory, saveTarget } from "./targets";
export { logTrial, familyTrials, familyKey } from "./trials";
export { integrityCheck, liveGate, logOverride, overridePhrase } from "./integrity/check";
export { estimateCost } from "./tca/run";
export { latestRiskBudget } from "./sizing/store";
export { QUANT_EVENTS } from "./jobs";
export * from "./contracts";
