/**
 * Credit inference without a ratings licence: Altman's Z (1968) and Z'' (1995), Ohlson's O-score
 * (1980), and the Merton distance to default in Bharath and Shumway's (2008) naive form, combined into
 * an implied rating. Every score keeps its inputs, so the screen can show why.
 */
import { normCdf } from "./stats";
import type { Annual } from "./fundamentals";

export type Zone = "safe" | "grey" | "distress";
export type ScoreResult = { value: number; zone: Zone; inputs: Record<string, number>; note?: string };

const div = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b : null);

/** Altman Z (public manufacturers): 1.2 X1 + 1.4 X2 + 3.3 X3 + 0.6 X4 + 1.0 X5. Safe above 2.99, distress below 1.81. */
export function altmanZ(a: Annual, marketCapUsd: number | null): ScoreResult | null {
  const X1 = div(a.currentAssets !== null && a.currentLiabilities !== null ? a.currentAssets - a.currentLiabilities : null, a.totalAssets);
  const X2 = div(a.retainedEarnings, a.totalAssets), X3 = div(a.ebit, a.totalAssets), X4 = div(marketCapUsd, a.totalLiabilities), X5 = div(a.revenue, a.totalAssets);
  if ([X1, X2, X3, X4, X5].some((x) => x === null)) return null;
  const value = 1.2 * X1! + 1.4 * X2! + 3.3 * X3! + 0.6 * X4! + 1.0 * X5!;
  return { value, zone: value > 2.99 ? "safe" : value >= 1.81 ? "grey" : "distress", inputs: { X1: X1!, X2: X2!, X3: X3!, X4: X4!, X5: X5! } };
}

/** Altman Z'' (non-manufacturers and emerging markets): 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4 (book equity / liabilities). Safe above 2.60, distress below 1.10. */
export function altmanZpp(a: Annual): ScoreResult | null {
  const X1 = div(a.currentAssets !== null && a.currentLiabilities !== null ? a.currentAssets - a.currentLiabilities : null, a.totalAssets);
  const X2 = div(a.retainedEarnings, a.totalAssets), X3 = div(a.ebit, a.totalAssets), X4 = div(a.equity, a.totalLiabilities);
  if ([X1, X2, X3, X4].some((x) => x === null)) return null;
  const value = 6.56 * X1! + 3.26 * X2! + 6.72 * X3! + 1.05 * X4!;
  return { value, zone: value > 2.6 ? "safe" : value >= 1.1 ? "grey" : "distress", inputs: { X1: X1!, X2: X2!, X3: X3!, X4: X4! } };
}

/**
 * Altman's bond-rating equivalents for the emerging-market score (Z'' + 3.25): the median score of US
 * firms at each S&P rating in 1996 (Altman 2018, the fifty-year retrospective). A firm takes the rating
 * whose median is nearest, so the cut-offs sit at the midpoints between adjacent medians. The top two
 * rows pool AAA with AA+ and AA with AA-; they are labelled AA+ and AA, the conservative end.
 */
const EMS_MEDIANS: [number, string][] = [
  [8.15, "AA+"], [7.16, "AA"], [6.85, "A+"], [6.65, "A"], [6.4, "A-"], [6.25, "BBB+"], [5.85, "BBB"], [5.65, "BBB-"],
  [5.25, "BB+"], [4.95, "BB"], [4.75, "BB-"], [4.5, "B+"], [4.15, "B"], [3.75, "B-"], [3.2, "CCC+"], [2.5, "CCC"], [1.75, "CCC-"], [0, "D"],
];
export function emsRating(zpp: number): string {
  const ems = zpp + 3.25;
  for (let i = 0; i < EMS_MEDIANS.length - 1; i++) if (ems >= (EMS_MEDIANS[i][0] + EMS_MEDIANS[i + 1][0]) / 2) return EMS_MEDIANS[i][1];
  return "D";
}

/**
 * Mortality of rated bonds by original S&P rating, 1971-2016 (Altman 2018): the default rate in the
 * first year and cumulatively over five, in decimals. Issue-based, so a rating's five-year figure is
 * what a new bond at that rating has historically gone on to do.
 */
export const MORTALITY: Record<string, { year1: number; year5: number }> = {
  AAA: { year1: 0, year5: 0.0001 }, AA: { year1: 0, year5: 0.0028 }, A: { year1: 0.0001, year5: 0.0036 }, BBB: { year1: 0.0032, year5: 0.0527 },
  BB: { year1: 0.0092, year5: 0.1071 }, B: { year1: 0.0286, year5: 0.2808 }, CCC: { year1: 0.0811, year5: 0.4727 },
};
export const mortalityFor = (rating: string) => MORTALITY[rating.replace(/[+-]$/, "")] ?? null;

/**
 * Ohlson O-score (model 1: failure within a year). SIZE is log(total assets / GNP price-level index)
 * with the index at 100 in 1968, about 610 today, and assets in dollars. The units matter: with assets
 * in millions every company looks like a bankruptcy risk (a common implementation error), while in
 * dollars a typical healthy company scores well under Ohlson's 3.8% cut-off, as in his sample.
 * The probability of failure is exp(O) / (1 + exp(O)).
 */
export function ohlsonO(a: Annual, prior: Annual | null, deflator = 6.1): (ScoreResult & { pd: number }) | null {
  const ta = a.totalAssets, tl = a.totalLiabilities;
  if (!ta || tl === null || a.currentAssets === null || a.currentLiabilities === null || a.netIncome === null) return null;
  const SIZE = Math.log(ta / (100 * deflator));
  const TLTA = tl / ta, WCTA = (a.currentAssets - a.currentLiabilities) / ta, CLCA = a.currentAssets ? a.currentLiabilities / a.currentAssets : 0;
  const OENEG = tl > ta ? 1 : 0, NITA = a.netIncome / ta;
  const funds = a.cfo ?? (a.netIncome + (a.da ?? 0));
  const FUTL = tl ? funds / tl : 0;
  const INTWO = prior?.netIncome !== null && prior?.netIncome !== undefined && a.netIncome < 0 && prior.netIncome < 0 ? 1 : 0;
  const CHIN = prior?.netIncome !== null && prior?.netIncome !== undefined && (Math.abs(a.netIncome) + Math.abs(prior.netIncome)) > 0 ? (a.netIncome - prior.netIncome) / (Math.abs(a.netIncome) + Math.abs(prior.netIncome)) : 0;
  const O = -1.32 - 0.407 * SIZE + 6.03 * TLTA - 1.43 * WCTA + 0.0757 * CLCA - 1.72 * OENEG - 2.37 * NITA - 1.83 * FUTL + 0.285 * INTWO - 0.521 * CHIN;
  const pd = 1 / (1 + Math.exp(-O));
  return { value: O, pd, zone: pd < 0.01 ? "safe" : pd < 0.038 ? "grey" : "distress", inputs: { SIZE, TLTA, WCTA, CLCA, OENEG, NITA, FUTL, INTWO, CHIN } };
}

export type Merton = { dd: number; pd: number; assetValue: number; assetVol: number; debtFace: number; equityVol: number; mu: number };

/**
 * Naive Merton distance to default (Bharath and Shumway 2008): debt at face (short-term + half of
 * long-term), debt volatility 0.05 + 0.25 x equity volatility, drift = last year's stock return, one year.
 */
export function mertonNaive(equity: number, stDebt: number, ltDebt: number, equityVol: number, pastReturn: number, T = 1): Merton | null {
  const F = stDebt + 0.5 * ltDebt;
  if (!(equity > 0) || !(F > 0) || !(equityVol > 0)) return null;
  const debtVol = 0.05 + 0.25 * equityVol;
  const V = equity + F;
  const sV = (equity / V) * equityVol + (F / V) * debtVol;
  const dd = (Math.log(V / F) + (pastReturn - 0.5 * sV * sV) * T) / (sV * Math.sqrt(T));
  return { dd, pd: normCdf(-dd), assetValue: V, assetVol: sV, debtFace: F, equityVol, mu: pastReturn };
}

/**
 * A one-year default probability as a rating band. The cut-offs are geometric means between adjacent
 * long-run one-year issuer default rates in S&P's global corporate studies (about 0.02% for AA, 0.05%
 * for A, 0.16% for BBB, 0.6% for BB, 3% for B and 26% for CCC). Issuer-based one-year rates suit a
 * one-year PD; the issue-based mortality table above is shown beside the result for the longer view.
 */
const PD_BANDS: [number, string][] = [[0.00005, "AAA"], [0.0003, "AA"], [0.0009, "A"], [0.003, "BBB"], [0.013, "BB"], [0.089, "B"]];
export function pdRating(pd: number): string {
  for (const [cut, r] of PD_BANDS) if (pd < cut) return r;
  return "CCC";
}

const NOTCH = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "CCC+", "CCC", "CCC-", "D"];
const notchOf = (r: string) => { const i = NOTCH.indexOf(r); return i >= 0 ? i : NOTCH.indexOf(r.replace(/[+-]$/, "")); };

export type ImpliedRating = {
  rating: string; grade: "investment" | "speculative";
  /** Each model's view; an excluded view is shown with the reason and left out of the rating. */
  views: { method: string; rating: string; detail: string; excluded?: string }[];
  zpp: ScoreResult | null; z: ScoreResult | null; o: (ScoreResult & { pd: number }) | null; merton: Merton | null;
  mortality: { year1: number; year5: number } | null;
};

/** Market-implied default probabilities are floored at one basis point: below that the model's precision is fiction. */
export const PD_FLOOR = 0.0001;

/**
 * The implied rating: the median notch of the views that apply (Z'' via Altman's table, O-score and
 * Merton via default-probability bands); with two views, their midpoint, rounded to the more cautious
 * notch. A view is left out when the company sits outside what the model was built for: Z'' when
 * retained earnings are negative because of buybacks rather than losses (the model reads that as
 * distress). Banks and insurers fit none of these models; the caller says so.
 */
export function impliedRating(latest: Annual, prior: Annual | null, market: { marketCapUsd: number | null; equityVol: number | null; pastReturn: number | null; /** Total debt from a broader set of tags, used when the panel found none (convertibles, for one). */ debtUsd?: number | null }): ImpliedRating {
  const zpp = altmanZpp(latest), z = altmanZ(latest, market.marketCapUsd), o = ohlsonO(latest, prior);
  const panelDebt = (latest.stDebt ?? 0) + (latest.ltDebt ?? 0);
  const [st, lt] = panelDebt > 0 ? [latest.stDebt ?? 0, latest.ltDebt ?? 0] : [0, market.debtUsd ?? 0];
  const canMerton = !!market.marketCapUsd && market.equityVol !== null;
  const merton = canMerton ? mertonNaive(market.marketCapUsd!, st, lt, market.equityVol!, market.pastReturn ?? 0) : null;
  const views: ImpliedRating["views"] = [];
  const buybacks = (latest.retainedEarnings ?? 0) < 0 && (latest.netIncome ?? 0) > 0 && (prior?.netIncome ?? 0) > 0;
  if (zpp) views.push({ method: "Altman Z''", rating: emsRating(zpp.value), detail: `Z'' ${zpp.value.toFixed(2)} (${zpp.zone})`, excluded: buybacks ? "Retained earnings are negative after buybacks, not losses; Z'' would read that as distress." : undefined });
  if (o) views.push({ method: "Ohlson O-score", rating: pdRating(o.pd), detail: `PD ${(o.pd * 100).toFixed(2)}%` });
  if (merton) views.push({ method: "Merton distance to default", rating: pdRating(Math.max(PD_FLOOR, merton.pd)), detail: `DD ${merton.dd.toFixed(2)}, PD ${merton.pd < PD_FLOOR ? "<0.01" : (merton.pd * 100).toFixed(2)}%` });
  else if (canMerton && st + lt <= 0) views.push({ method: "Merton distance to default", rating: pdRating(PD_FLOOR), detail: "No borrowings: no default point" });
  const notches = views.filter((v) => !v.excluded).map((v) => notchOf(v.rating)).filter((n) => n >= 0).sort((a, b) => a - b);
  const mid = notches.length % 2 ? notches[(notches.length - 1) / 2] : notches.length ? Math.ceil((notches[notches.length / 2 - 1] + notches[notches.length / 2]) / 2) : -1;
  const rating = mid >= 0 ? NOTCH[mid] : "NR";
  return { rating, grade: rating !== "NR" && notchOf(rating) <= notchOf("BBB-") ? "investment" : "speculative", views, zpp, z, o, merton, mortality: rating === "NR" ? null : mortalityFor(rating) };
}
