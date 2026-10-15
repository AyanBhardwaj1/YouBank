/**
 * Q3 "Check a claim": typed numbers only (a Sharpe ratio, how long, how often, the shape of returns and how many
 * variants were tried) for a strategy seen online. No data, free for everyone, built to share:
 * "a Sharpe of 2 over 18 months, best of about 30 variants, has a deflated Sharpe ratio of 0.64". Pure.
 *
 * Without the variants' own Sharpe ratios, the trials' spread is taken as that of a zero-skill strategy's Sharpe
 * estimate over the same sample, 1/(n - 1) per period: the null the claim must beat.
 */
import { annualise, perPeriod } from "../stats/core";
import { bestOfNCurve, dsrFromStats, expectedMaxSharpe, haircutSharpe, minTrlFromStats, passesT3, psrFromStats } from "../stats/integrity";
import { T } from "../words";

export type ClaimInput = { sharpe: number; months: number; frequency: "daily" | "weekly" | "monthly"; trials: number; skew?: number; kurt?: number };

export type ClaimResult = {
  input: Required<ClaimInput>; periods: number; periodsPerYear: number;
  psr: number; dsr: number; srStarAnnual: number; minTrlYears: number | null; years: number;
  haircut: { sharpe: number; share: number } | null; t3: boolean; verdict: "strong" | "plausible" | "weak" | "likely luck";
  sentence: string; curve: { trials: number; sharpe: number }[];
};

const PPY = { daily: 252, weekly: 52, monthly: 12 } as const;

export function cleanClaim(v: Record<string, unknown>): ClaimInput {
  const num = (x: unknown, lo: number, hi: number, name: string) => { const n = Number(x); if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error(`${name} must be between ${lo} and ${hi}.`), { status: 400 }); return n; };
  const frequency = v.frequency === "weekly" || v.frequency === "monthly" ? v.frequency : "daily";
  return {
    sharpe: num(v.sharpe, -5, 10, "The Sharpe ratio"), months: num(v.months, 1, 600, "The length in months"), frequency,
    trials: Math.round(num(v.trials ?? 1, 1, 100_000, "The number of variants")),
    skew: v.skew === undefined || v.skew === "" ? 0 : num(v.skew, -10, 10, "Skewness"), kurt: v.kurt === undefined || v.kurt === "" ? 3 : num(v.kurt, 1, 100, "Kurtosis"),
  };
}

export function checkClaim(c: ClaimInput): ClaimResult {
  const input = { skew: 0, kurt: 3, ...c } as Required<ClaimInput>;
  const ppy = PPY[input.frequency];
  const n = Math.max(3, Math.round((input.months / 12) * ppy));
  const sr = perPeriod(input.sharpe, ppy);
  const v = 1 / (n - 1);
  const psr = psrFromStats(sr, n, input.skew, input.kurt, 0);
  const d = dsrFromStats(sr, n, input.skew, input.kurt, input.trials, v);
  const dsr = input.trials > 1 ? d.dsr : psr;
  const mt = minTrlFromStats(sr, input.skew, input.kurt, 0, 0.05);
  const years = input.months / 12;
  const hc = input.trials > 1 ? haircutSharpe(input.sharpe, years, input.trials, "bhy") : null;
  const verdict: ClaimResult["verdict"] = dsr >= 0.95 ? "strong" : dsr >= 0.8 ? "plausible" : dsr >= 0.5 ? "weak" : "likely luck";
  return {
    input, periods: n, periodsPerYear: ppy, psr, dsr, srStarAnnual: annualise(input.trials > 1 ? expectedMaxSharpe(input.trials, v) : 0, ppy),
    minTrlYears: Number.isFinite(mt) ? mt / ppy : null, years, haircut: hc ? { sharpe: hc.sharpeAdjusted, share: hc.haircut } : null, t3: passesT3(input.sharpe, years), verdict,
    sentence: T.claim(input.sharpe, Math.round(input.months), input.trials, dsr),
    curve: bestOfNCurve(n, ppy, v),
  };
}
