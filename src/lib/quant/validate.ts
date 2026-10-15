/**
 * QF1: checks that a payload keeps the contract (src/lib/quant/contracts.ts) before it is stored or sent to
 * the algo engine, and the deterministic signal id. Pure apart from hashing; scripts/test-quant.ts runs it
 * on good and bad fixtures. Every message names the field, so a producer's bug is easy to find.
 */
import { createHash } from "node:crypto";
import { CONTRACT_VERSION, type Fill, type IntegrityReport, type QuantSignal, type RiskBudget, type TargetPortfolio } from "./contracts";
import { DISCLOSURE_KEYS, forbiddenIn } from "./words";

export type Validation = { ok: true } | { ok: false; errors: string[] };

const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && Number.isFinite(Date.parse(s));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const prob = (v: unknown) => finite(v) && v >= 0 && v <= 1;
const result = (errors: string[]): Validation => (errors.length ? { ok: false, errors } : { ok: true });

/** Symbols as copy trading writes them: upper case, dots become dashes ("BRK-B"). */
export const normSymbol = (s: string) => s.trim().toUpperCase().replace(/\./g, "-");

/**
 * The signal id: sha256 of producer, producer version, instrument key, as-of time and horizon, hex, first 32.
 * The instrument key is the symbol, plus an option's terms. The as-of time is normalised to an ISO instant,
 * so "2026-10-14T20:41:07Z" and "2026-10-14T16:41:07-04:00" give the same id.
 */
export function signalId(s: Pick<QuantSignal, "producer" | "producerVersion" | "instrument" | "asOf" | "horizonDays">): string {
  const i = s.instrument;
  const key = [normSymbol(i.symbol), i.assetClass, i.option ? `${i.option.underlying}:${i.option.expiry}:${i.option.strike}:${i.option.right}` : ""].join("|");
  return createHash("sha256").update([s.producer, s.producerVersion, key, new Date(s.asOf).toISOString(), String(s.horizonDays)].join("\n")).digest("hex").slice(0, 32);
}

function instrumentErrors(i: unknown, at: string): string[] {
  const e: string[] = [];
  const x = i as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return [`${at} is missing`];
  if (typeof x.symbol !== "string" || !/^[A-Z0-9][A-Z0-9.\-/^]{0,19}$/i.test(x.symbol)) e.push(`${at}.symbol is not a symbol`);
  if (!["equity", "etf", "option", "crypto", "future", "fx"].includes(String(x.assetClass))) e.push(`${at}.assetClass is not one of equity, etf, option, crypto, future, fx`);
  if (typeof x.currency !== "string" || !/^[A-Z]{3}$/.test(x.currency)) e.push(`${at}.currency is not a three-letter code`);
  if (x.cik !== undefined && (typeof x.cik !== "string" || !/^\d{1,10}$/.test(x.cik))) e.push(`${at}.cik is not a CIK`);
  if (x.assetClass === "option") {
    const o = x.option as Record<string, unknown> | undefined;
    if (!o || typeof o.underlying !== "string" || !isIso(o.expiry) || !finite(o.strike) || !["C", "P"].includes(String(o.right))) e.push(`${at}.option needs underlying, expiry, strike and right`);
  }
  return e;
}

function evidenceErrors(ev: unknown): string[] {
  if (!Array.isArray(ev)) return ["evidence is not a list"];
  const e: string[] = [];
  ev.forEach((x: Record<string, unknown>, k) => {
    for (const f of ["label", "url", "source", "licence"]) if (typeof x?.[f] !== "string" || !(x[f] as string).length) e.push(`evidence[${k}].${f} is missing`);
    if (typeof x?.url === "string" && x.url && !/^https:\/\//.test(x.url) && !/^http:\/\/localhost(:\d+)?\//.test(x.url)) e.push(`evidence[${k}].url is not https`);
    if (!isIso(x?.knownAt)) e.push(`evidence[${k}].knownAt is not a time`);
    if (!isIso(x?.retrievedAt)) e.push(`evidence[${k}].retrievedAt is not a time`);
  });
  return e;
}

export function validateIntegrity(r: unknown, at = "integrity"): string[] {
  const x = r as Partial<IntegrityReport> | null;
  if (!x || typeof x !== "object") return [`${at} is missing`];
  const e: string[] = [];
  if (!["A", "B", "C", "D", "F"].includes(String(x.grade))) e.push(`${at}.grade is not A to F`);
  if (!finite(x.trials) || x.trials < 0 || !finite(x.effectiveTrials) || x.effectiveTrials < 0 || x.effectiveTrials > Math.max(1, x.trials)) e.push(`${at}.trials and effectiveTrials must be counts, effective no more than raw`);
  if (!prob(x.psr)) e.push(`${at}.psr is not a probability`);
  if (x.dsr !== null && !prob(x.dsr)) e.push(`${at}.dsr is not a probability or null`);
  if (x.pbo !== null && !prob(x.pbo)) e.push(`${at}.pbo is not a probability or null`);
  if (!finite(x.sharpe)) e.push(`${at}.sharpe is not a number`);
  if (!Array.isArray(x.warnings)) e.push(`${at}.warnings is not a list`);
  if (!isIso(x.checkedAt)) e.push(`${at}.checkedAt is not a time`);
  return e;
}

/** A QuantSignal keeps the contract: version, deterministic id, times in order, the payload its kind needs, factual wording. */
export function validateSignal(s: unknown): Validation {
  const x = s as Partial<QuantSignal> | null;
  if (!x || typeof x !== "object") return { ok: false, errors: ["signal is not an object"] };
  const e: string[] = [];
  if (x.contract !== CONTRACT_VERSION) e.push(`contract is not ${CONTRACT_VERSION}`);
  if (typeof x.producer !== "string" || !/^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(x.producer)) e.push("producer is not 'area.name'");
  if (typeof x.producerVersion !== "string" || !x.producerVersion) e.push("producerVersion is missing");
  e.push(...instrumentErrors(x.instrument, "instrument"));
  for (const f of ["asOf", "computedAt", "validUntil"] as const) if (!isIso(x[f])) e.push(`${f} is not a time`);
  if (isIso(x.asOf) && isIso(x.validUntil) && Date.parse(x.validUntil) <= Date.parse(x.asOf)) e.push("validUntil must be after asOf");
  if (typeof x.reconstructed !== "boolean") e.push("reconstructed is not true or false");
  if (!finite(x.horizonDays) || x.horizonDays < 0 || !Number.isInteger(x.horizonDays)) e.push("horizonDays is not a whole number of trading days");
  if (!e.length && x.id !== signalId(x as QuantSignal)) e.push("id is not the deterministic hash of producer, version, instrument, asOf and horizon");
  switch (x.kind) {
    case "score":
      if (!finite(x.score) || x.score < -3 || x.score > 3) e.push("score must be a number in [-3, 3]");
      break;
    case "expected_return": {
      const r = x.expectedReturn;
      if (!r || !finite(r.mean) || !finite(r.low) || !finite(r.high) || !(r.low <= r.mean && r.mean <= r.high) || !prob(r.level) || typeof r.benchmark !== "string" || typeof r.net !== "boolean") e.push("expectedReturn needs low <= mean <= high, a level, a benchmark and net");
      break;
    }
    case "probability": {
      const p = x.probability;
      if (!p || !prob(p.p) || !prob(p.low) || !prob(p.high) || !(p.low <= p.p && p.p <= p.high) || !prob(p.baseRate) || typeof p.question !== "string" || p.question.length < 10) e.push("probability needs low <= p <= high in [0, 1], a base rate and a question");
      break;
    }
    case "event": {
      const v = x.event, b = v?.baseRate;
      if (!v || typeof v.type !== "string" || !isIso(v.occurredAt)) e.push("event needs a type and occurredAt");
      if (!b || !finite(b.car) || !finite(b.low) || !finite(b.high) || !(b.low <= b.car && b.car <= b.high) || !prob(b.hitRate) || !prob(b.unconditionalHitRate) || !finite(b.n) || b.n < 1 || typeof b.window !== "string" || typeof b.era !== "string") e.push("event.baseRate needs car within [low, high], hit rates, n of at least 1, a window and an era (rule 4: no signal without its base rate)");
      break;
    }
    default: e.push("kind is not score, expected_return, probability or event");
  }
  if (typeof x.universe !== "string" || !x.universe) e.push("universe is missing");
  if (typeof x.explain !== "string" || x.explain.length < 10) e.push("explain is missing");
  else { const bad = forbiddenIn(x.explain); if (bad.length) e.push(`explain uses words that read as advice: ${bad.join(", ")}`); }
  e.push(...evidenceErrors(x.evidence));
  const c = x.calibration;
  if (!c || !["isotonic", "platt", "venn-abers", "conformal", "event-study", "none"].includes(String(c.method)) || !finite(c.n) || c.n < 0) e.push("calibration needs a method and n");
  if (x.integrity) e.push(...validateIntegrity(x.integrity));
  if (x.costs && (!finite(x.costs.totalRoundTripBps) || x.costs.totalRoundTripBps < 0)) e.push("costs.totalRoundTripBps is not a cost");
  return result(e);
}

/** A TargetPortfolio keeps the contract: weights that respect its own constraints, cash that balances, known disclosures. */
export function validateTarget(t: unknown): Validation {
  const x = t as Partial<TargetPortfolio> | null;
  if (!x || typeof x !== "object") return { ok: false, errors: ["target is not an object"] };
  const e: string[] = [];
  if (x.contract !== CONTRACT_VERSION) e.push(`contract is not ${CONTRACT_VERSION}`);
  if (typeof x.key !== "string" || !/^[a-z0-9]+(:[A-Za-z0-9_.\-]+)+$/.test(x.key)) e.push("key is not like 'copy:34' or 'sleeve:12'");
  if (!finite(x.version) || x.version < 1 || !Number.isInteger(x.version)) e.push("version is not a positive whole number");
  if (typeof x.producer !== "string" || !x.producer.includes(".")) e.push("producer is not 'area.name'");
  if (x.ownerId !== null && typeof x.ownerId !== "string") e.push("ownerId is not a string or null");
  for (const f of ["asOf", "validUntil"] as const) if (!isIso(x[f])) e.push(`${f} is not a time`);
  if (!Array.isArray(x.weights)) e.push("weights is not a list");
  const c = x.constraints;
  if (!c || typeof c.longOnly !== "boolean" || !finite(c.maxWeight) || !finite(c.maxGross) || !Array.isArray(c.netRange) || c.netRange.length !== 2 || !Array.isArray(c.excluded)) e.push("constraints need longOnly, maxWeight, maxGross, netRange and excluded");
  if (Array.isArray(x.weights) && c && finite(c.maxWeight)) {
    const seen = new Set<string>();
    x.weights.forEach((w, k) => {
      e.push(...instrumentErrors(w.instrument, `weights[${k}].instrument`));
      if (!finite(w.weight)) e.push(`weights[${k}].weight is not a number`);
      else {
        if (c.longOnly && w.weight < 0) e.push(`weights[${k}] is short in a long-only target`);
        if (Math.abs(w.weight) > c.maxWeight + 1e-9) e.push(`weights[${k}] exceeds maxWeight`);
      }
      const sym = typeof w.instrument?.symbol === "string" ? normSymbol(w.instrument.symbol) : "";
      if (sym && seen.has(sym)) e.push(`weights[${k}] repeats ${sym}`);
      seen.add(sym);
      if (sym && c.excluded?.map(normSymbol).includes(sym)) e.push(`weights[${k}] holds excluded ${sym}`);
      if (w.reason && forbiddenIn(w.reason).length) e.push(`weights[${k}].reason uses words that read as advice`);
    });
    const net = x.weights.reduce((s, w) => s + (finite(w.weight) ? w.weight : 0), 0);
    const gross = x.weights.reduce((s, w) => s + (finite(w.weight) ? Math.abs(w.weight) : 0), 0);
    if (gross > c.maxGross + 1e-9) e.push("gross exposure exceeds maxGross");
    if (Array.isArray(c.netRange) && (net < c.netRange[0] - 1e-9 || net > c.netRange[1] + 1e-9)) e.push("net exposure is outside netRange");
    if (c.maxNames !== undefined && x.weights.length > c.maxNames) e.push("more names than maxNames");
    if (!finite(x.cashWeight) || Math.abs(x.cashWeight - (1 - net)) > 1e-6) e.push("cashWeight must equal 1 - the sum of weights");
  }
  const r = x.rebalance;
  if (!r || !["on_change", "calendar", "drift"].includes(String(r.policy)) || !["open", "close", "vwap_day", "any"].includes(String(r.window)) || !isIso(r.notBefore)) e.push("rebalance needs a policy, a window and notBefore");
  else if (isIso(x.asOf) && Date.parse(r.notBefore) < Date.parse(x.asOf)) e.push("rebalance.notBefore is before asOf (rule 1: trade no earlier than the information allows)");
  if (!x.sizing || !["fixed", "equal", "vol_target", "risk_parity", "kelly_fraction", "mean_variance"].includes(String(x.sizing.method))) e.push("sizing.method is not known");
  if (!x.risk || !finite(x.risk.exAnteVol) || x.risk.exAnteVol < 0 || typeof x.risk.model !== "string") e.push("risk needs exAnteVol and model");
  if (x.integrity) e.push(...validateIntegrity(x.integrity));
  if (!Array.isArray(x.disclosures) || !x.disclosures.length) e.push("disclosures is empty");
  else for (const d of x.disclosures) if (!(DISCLOSURE_KEYS as string[]).includes(d)) e.push(`disclosure '${d}' is not a key of DISCLOSURES`);
  if (!x.provenance || !Array.isArray(x.provenance.signalIds) || typeof x.provenance.inputsHash !== "string" || typeof x.provenance.recipe !== "string") e.push("provenance needs signalIds, inputsHash and recipe");
  return result(e);
}

/** A RiskBudget: fractions in range, drawdown rules ordered from mildest to hardest. */
export function validateRiskBudget(b: unknown): Validation {
  const x = b as Partial<RiskBudget> | null;
  if (!x || typeof x !== "object") return { ok: false, errors: ["budget is not an object"] };
  const e: string[] = [];
  if (typeof x.ownerId !== "string" || !x.ownerId) e.push("ownerId is missing");
  if (!isIso(x.asOf)) e.push("asOf is not a time");
  if (!finite(x.maxPositionWeight) || x.maxPositionWeight <= 0 || x.maxPositionWeight > 1) e.push("maxPositionWeight is not in (0, 1]");
  if (!finite(x.maxGross) || x.maxGross <= 0 || x.maxGross > 4) e.push("maxGross is not in (0, 4]");
  if (!finite(x.maxDailyLossPct) || x.maxDailyLossPct <= 0 || x.maxDailyLossPct > 1) e.push("maxDailyLossPct is not in (0, 1]");
  if (x.volTarget !== null && (!finite(x.volTarget) || x.volTarget <= 0 || x.volTarget > 2)) e.push("volTarget is not null or in (0, 2]");
  if (!finite(x.kellyFraction) || x.kellyFraction < 0 || x.kellyFraction > 1) e.push("kellyFraction is not in [0, 1]");
  if (!Array.isArray(x.drawdownRules)) e.push("drawdownRules is not a list");
  else x.drawdownRules.forEach((r, k) => {
    if (!finite(r.fromPeakPct) || r.fromPeakPct <= 0 || r.fromPeakPct >= 1) e.push(`drawdownRules[${k}].fromPeakPct is not in (0, 1)`);
    if (!["halve", "flatten", "pause_new", "notify"].includes(r.action)) e.push(`drawdownRules[${k}].action is not known`);
    if (k > 0 && finite(r.fromPeakPct) && r.fromPeakPct < x.drawdownRules![k - 1].fromPeakPct) e.push("drawdownRules are not ordered by depth");
  });
  if (typeof x.basis !== "string" || x.basis.length < 10) e.push("basis is missing");
  return result(e);
}

/** A Fill from any source. */
export function validateFill(f: unknown): Validation {
  const x = f as Partial<Fill> | null;
  if (!x || typeof x !== "object") return { ok: false, errors: ["fill is not an object"] };
  const e: string[] = [];
  if (!["csv", "snaptrade", "algo"].includes(String(x.source))) e.push("source is not csv, snaptrade or algo");
  if (typeof x.accountRef !== "string" || !x.accountRef) e.push("accountRef is missing");
  if (typeof x.extId !== "string" || !x.extId) e.push("extId is missing");
  if (typeof x.symbol !== "string" || !/^[A-Z0-9][A-Z0-9.\-/]{0,14}$/i.test(x.symbol)) e.push("symbol is not a symbol");
  if (!["buy", "sell", "short", "cover"].includes(String(x.side))) e.push("side is not buy, sell, short or cover");
  if (!finite(x.qty) || x.qty <= 0) e.push("qty is not positive");
  if (!finite(x.price) || x.price <= 0) e.push("price is not positive");
  if (!isIso(x.executedAt)) e.push("executedAt is not a time");
  if (x.placedAt !== undefined && !isIso(x.placedAt)) e.push("placedAt is not a time");
  if (x.placedAt && isIso(x.executedAt) && isIso(x.placedAt) && Date.parse(x.placedAt) > Date.parse(x.executedAt)) e.push("placedAt is after executedAt");
  if (x.fees !== undefined && (!finite(x.fees) || x.fees < 0)) e.push("fees is not a cost");
  return result(e);
}
