/**
 * The contract between Quant Edge (signals, targets, risk budgets, cost estimates, integrity reports) and the
 * algo trading engine: types only, no imports, so either side can depend on it without pulling in the other.
 * docs/quant-edge.md section 5 is the spec; Quant owns this file and the algo work reviews changes to it.
 * A breaking change bumps CONTRACT_VERSION.
 */
export const CONTRACT_VERSION = "quant/1" as const;

/** What a signal or a target refers to. Equities by ticker plus CIK; options carry their terms. */
export type Instrument = {
  symbol: string;                                   // "AAPL", "BRK-B" (dots become dashes, as copytrade does)
  assetClass: "equity" | "etf" | "option" | "crypto" | "future" | "fx";
  cik?: string; figi?: string; currency: string;    // "USD"
  option?: { underlying: string; expiry: string; strike: number; right: "C" | "P" };
};

/** Where a number came from, for the "Models and sources" panel and the audit trail. */
export type Evidence = { label: string; url: string; source: string; licence: string; knownAt: string; retrievedAt: string };

/** How trustworthy a producer's numbers are, measured, not asserted. */
export type Calibration = {
  method: "isotonic" | "platt" | "venn-abers" | "conformal" | "event-study" | "none";
  n: number;                                        // resolved examples behind it
  brierSkill?: number | null;                       // against the base rate, when probabilities are scored
  falseAlarmRate?: number | null;                   // per instrument-year, for detectors
  trackKind?: string;                               // edge_forecasts.kind for the live track record
};

/** Q3's verdict on whatever produced a number. */
export type IntegrityReport = {
  pointInTime: boolean;                             // every input carried knownAt and was used only after it
  survivorshipSafe: boolean;                        // universe included delisted securities
  trials: number; effectiveTrials: number;          // from quant_trials, not typed in
  sharpe: number; psr: number; dsr: number | null;  // annualised Sharpe; probabilities 0..1
  pbo: number | null; minTrlYears: number | null;
  oosSharpe: number | null;                         // walk-forward out-of-sample
  costBpsAssumed: number;                           // round-trip cost used
  llmInputs: boolean;                               // any LLM-derived input (look-ahead risk before the model's cutoff)
  grade: "A" | "B" | "C" | "D" | "F";               // rules in Q3
  warnings: string[]; checkedAt: string; version: string;
};

export type QuantSignal = {
  contract: typeof CONTRACT_VERSION;
  id: string;                                       // deterministic (QF1)
  producer: string; producerVersion: string;        // "quant.insider_cluster", "2026-10-20.1"
  instrument: Instrument;
  asOf: string;                                     // ISO time every input was public (max knownAt); usable from here
  computedAt: string; reconstructed: boolean;       // backfilled from archives rather than computed live
  validUntil: string;                               // stop using after this
  horizonDays: number;                              // trading days the statement is about
  kind: "score" | "expected_return" | "probability" | "event";
  /** score: cross-sectional z-score clipped to [-3, 3], sign = direction relative to the universe. */
  score?: number;
  /** expected_return: excess return over `benchmark` across the horizon, with an interval. */
  expectedReturn?: { mean: number; low: number; high: number; level: number; benchmark: string; net: boolean };
  /** probability: of a stated, machine-checkable question (also logged to the forecast ledger). */
  probability?: { p: number; low: number; high: number; baseRate: number; question: string };
  /** event: something happened (a cluster buy, a 13D), with the base rate of what followed similar events. */
  event?: { type: string; occurredAt: string; baseRate: { car: number; low: number; high: number; hitRate: number; unconditionalHitRate: number; n: number; window: string; era: string } };
  universe: string;                                 // the set the score is relative to: "us-top1000"
  explain: string;                                  // one sentence, factual, from quant/words.ts templates; never "buy" or "sell"
  evidence: Evidence[];
  calibration: Calibration;
  integrity?: IntegrityReport;                      // of the producer's historical backtest, when it has one
  costs?: CostEstimate;                             // estimated round trip at a reference size
  forecastId?: number | null;                       // edge_forecasts row when probability is present
  tags?: string[];
};

export type CostEstimate = {
  spreadBps: number; impactBps: number; commissionBps: number; borrowBpsYear?: number | null;
  totalRoundTripBps: number; referenceNotionalUsd: number; adv20Usd: number; model: string; asOf: string;
};

export type TargetWeight = {
  instrument: Instrument;
  weight: number;                                   // fraction of NAV; negative = short
  reason?: string;                                  // factual: "top decile momentum", "risk-parity share"
  signalIds?: string[];
  bounds?: { min: number; max: number };            // what the producer would accept when rounding to shares
};

export type TargetPortfolio = {
  contract: typeof CONTRACT_VERSION;
  key: string; version: number;                     // quant_targets
  producer: string; producerVersion: string;        // "quant.sleeve", "copy.13f", "quant.riskparity"
  ownerId: string | null;                           // null = impersonal definition, same for everyone
  name: string;
  asOf: string; validUntil: string;
  weights: TargetWeight[];
  cashWeight: number;                               // 1 − Σ weights; short financing and margin are the engine's concern
  constraints: {
    longOnly: boolean; maxWeight: number; maxNames?: number; maxGross: number; netRange: [number, number];
    sectorCap?: number; minAdvUsd?: number; minPrice?: number; excluded: string[]; maxTurnoverPerRebalance?: number;
  };
  rebalance: {
    policy: "on_change" | "calendar" | "drift";
    cadence?: "daily" | "weekly" | "monthly" | "quarterly";
    driftBand?: number;                             // rebalance when any weight drifts this far (absolute)
    window: "open" | "close" | "vwap_day" | "any";  // when the producer's backtest assumed trading
    notBefore: string;                              // earliest time trading on this version is consistent with the backtest
  };
  sizing: { method: "fixed" | "equal" | "vol_target" | "risk_parity" | "kelly_fraction" | "mean_variance"; kellyFraction?: number; volTarget?: number };
  risk: { exAnteVol: number; beta?: number; factorExposures?: Record<string, number>; var95_1d?: number; model: string };
  integrity?: IntegrityReport;
  disclosures: string[];                            // keys of DISCLOSURES in quant/words.ts ("hypothetical", "not_advice", "timing_13f")
  provenance: { signalIds: string[]; inputsHash: string; recipe: string };
};

/** Q4's output: a recommendation the algo engine's own risk controls may adopt or tighten, never loosen. */
export type RiskBudget = {
  ownerId: string; accountRef: string | null; asOf: string;
  maxPositionWeight: number; maxGross: number; maxDailyLossPct: number;
  volTarget: number | null;                         // annualised, for scaling
  kellyFraction: number;                            // of full Kelly, after the uncertainty haircut
  drawdownRules: { fromPeakPct: number; action: "halve" | "flatten" | "pause_new" | "notify" }[];
  basis: string;                                    // how it was derived, in words
};

/** A person's execution, for Q5. */
export type Fill = {
  source: "csv" | "snaptrade" | "algo"; accountRef: string; broker?: string; extId: string;
  symbol: string; side: "buy" | "sell" | "short" | "cover"; qty: number; price: number;
  executedAt: string; placedAt?: string; orderType?: "market" | "limit" | "stop" | "other"; limitPrice?: number; fees?: number;
};
