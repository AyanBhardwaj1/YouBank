/**
 * Macro inference: the New York Fed's yield-curve recession probability (Estrella and Trubin 2006),
 * the Sahm rule (Sahm 2019), a Nelson-Siegel fit of the Treasury curve (Diebold and Li 2006), and
 * simple curve shape measures. Small, well-published models, stated with their inputs.
 */
import { invert, normCdf } from "./stats";

/**
 * Probability of a US recession twelve months ahead from the 10-year minus 3-month Treasury spread
 * (percentage points, monthly average): P = N(-0.5333 - 0.6330 x spread).
 */
export function recessionProbability(spread10y3m: number): number {
  return normCdf(-0.5333 - 0.633 * spread10y3m);
}

export type Sahm = { value: number; triggered: boolean; threeMonthAvg: number; low12: number };

/**
 * The Sahm rule: the three-month average unemployment rate minus its low over the prior twelve months.
 * At 0.50 points or more, the US has historically been in the early months of a recession.
 * `rates` are monthly unemployment rates in percent, oldest first.
 */
export function sahmRule(rates: number[]): Sahm | null {
  if (rates.length < 15) return null;
  const ma = rates.map((_, i) => (i >= 2 ? (rates[i] + rates[i - 1] + rates[i - 2]) / 3 : NaN));
  const i = ma.length - 1;
  const prior = ma.slice(Math.max(2, i - 12), i).filter(Number.isFinite);
  const low12 = Math.min(...prior);
  const value = ma[i] - low12;
  return { value, triggered: value >= 0.5, threeMonthAvg: ma[i], low12 };
}

export type CurvePoint = { tenorYears: number; yield: number };
export type NelsonSiegel = { level: number; slope: number; curvature: number; lambda: number; fitted: (tenorYears: number) => number; rmse: number };

/**
 * Nelson-Siegel with Diebold and Li's fixed decay (lambda = 0.0609 with maturities in months), fitted by
 * least squares: y(t) = b0 + b1 (1 - e^(-lt)) / (lt) + b2 [(1 - e^(-lt)) / (lt) - e^(-lt)].
 */
export function nelsonSiegel(points: CurvePoint[], lambdaPerMonth = 0.0609): NelsonSiegel | null {
  const pts = points.filter((p) => p.tenorYears > 0 && Number.isFinite(p.yield));
  if (pts.length < 4) return null;
  const load = (tYears: number) => { const lt = lambdaPerMonth * tYears * 12; const f1 = (1 - Math.exp(-lt)) / lt; return [1, f1, f1 - Math.exp(-lt)]; };
  const X = pts.map((p) => load(p.tenorYears)), y = pts.map((p) => p.yield);
  const xtx = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((a, r) => a + r[i] * r[j], 0)));
  const xty = [0, 1, 2].map((i) => X.reduce((a, r, k) => a + r[i] * y[k], 0));
  const inv = invert(xtx);
  if (!inv) return null;
  const b = inv.map((row) => row.reduce((a, v, j) => a + v * xty[j], 0));
  const fitted = (t: number) => { const l = load(t); return b[0] * l[0] + b[1] * l[1] + b[2] * l[2]; };
  const rmse = Math.sqrt(pts.reduce((a, p) => a + (p.yield - fitted(p.tenorYears)) ** 2, 0) / pts.length);
  return { level: b[0], slope: b[1], curvature: b[2], lambda: lambdaPerMonth, fitted, rmse };
}

/** Curve shape: 2s10s and 3m10y spreads, butterfly (2 x 5y - 2y - 10y), and whether any part is inverted. */
export function curveShape(points: CurvePoint[]): { s2s10: number | null; s3m10y: number | null; butterfly: number | null; inverted: boolean } {
  const at = (t: number) => points.find((p) => Math.abs(p.tenorYears - t) < 0.01)?.yield ?? null;
  const y3m = at(0.25), y2 = at(2), y5 = at(5), y10 = at(10);
  return {
    s2s10: y2 !== null && y10 !== null ? y10 - y2 : null,
    s3m10y: y3m !== null && y10 !== null ? y10 - y3m : null,
    butterfly: y2 !== null && y5 !== null && y10 !== null ? 2 * y5 - y2 - y10 : null,
    inverted: points.some((p, i) => i > 0 && p.yield < points[i - 1].yield - 0.05),
  };
}
