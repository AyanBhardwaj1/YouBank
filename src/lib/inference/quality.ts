/**
 * Earnings quality from two consecutive fiscal years: Beneish's M-score (1999, eight variables),
 * Piotroski's F-score (2000, nine signals), Sloan's (1996) accruals and Novy-Marx's (2013) gross
 * profitability. Each result lists the inputs that drove it.
 */
import type { Annual } from "./fundamentals";
import { normCdf } from "./stats";

const div = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b !== 0 ? a / b : null);

export type Beneish = { m: number; flag: boolean; vars: Record<string, number>; missing: string[]; /** Beneish's probit: P(manipulator) = N(M). */ p: number };

/**
 * M = -4.84 + 0.920 DSRI + 0.528 GMI + 0.404 AQI + 0.892 SGI + 0.115 DEPI - 0.172 SGAI + 4.679 TATA - 0.327 LVGI.
 * Above -1.78 is Beneish's cut-off for a likely manipulator. A ratio that cannot be computed is set to
 * 1 (no change), as practitioners do, and listed as missing.
 */
export function beneish(t: Annual, p: Annual): Beneish | null {
  if (!t.revenue || !p.revenue || !t.totalAssets || !p.totalAssets) return null;
  const missing: string[] = [];
  const or1 = (name: string, v: number | null) => { if (v === null || !Number.isFinite(v)) { missing.push(name); return 1; } return v; };
  const gm = (a: Annual) => (a.revenue && a.cogs !== null ? (a.revenue - a.cogs) / a.revenue : a.revenue && a.grossProfit !== null ? a.grossProfit / a.revenue : null);
  const aq = (a: Annual) => (a.totalAssets && a.currentAssets !== null && a.ppe !== null ? 1 - (a.currentAssets + a.ppe) / a.totalAssets : null);
  const dep = (a: Annual) => (a.da !== null && a.ppe !== null && a.da + a.ppe > 0 ? a.da / (a.da + a.ppe) : null);
  const lev = (a: Annual) => (a.totalAssets && a.currentLiabilities !== null ? (a.currentLiabilities + (a.ltDebt ?? 0)) / a.totalAssets : null);
  const vars = {
    DSRI: or1("DSRI", div(div(t.receivables, t.revenue), div(p.receivables, p.revenue))),
    GMI: or1("GMI", div(gm(p), gm(t))),
    AQI: or1("AQI", div(aq(t), aq(p))),
    SGI: or1("SGI", div(t.revenue, p.revenue)),
    DEPI: or1("DEPI", div(dep(p), dep(t))),
    SGAI: or1("SGAI", div(div(t.sga, t.revenue), div(p.sga, p.revenue))),
    LVGI: or1("LVGI", div(lev(t), lev(p))),
    TATA: t.netIncome !== null && t.cfo !== null ? (t.netIncome - t.cfo) / t.totalAssets : (missing.push("TATA"), 0),
  };
  const m = -4.84 + 0.92 * vars.DSRI + 0.528 * vars.GMI + 0.404 * vars.AQI + 0.892 * vars.SGI + 0.115 * vars.DEPI - 0.172 * vars.SGAI + 4.679 * vars.TATA - 0.327 * vars.LVGI;
  return { m, flag: m > -1.78, vars, missing, p: normCdf(m) };
}

export type Piotroski = { score: number; signals: { name: string; pass: boolean | null; detail: string }[] };

/** Piotroski F-score: nine pass/fail signals on profitability, leverage and liquidity, and efficiency. Needs three years for the turnover and ROA changes. */
export function piotroski(t: Annual, p: Annual, pp: Annual | null): Piotroski {
  const roa = (a: Annual, prevAssets: number | null) => div(a.netIncome, prevAssets ?? a.totalAssets);
  const roaT = roa(t, p.totalAssets), roaP = roa(p, pp?.totalAssets ?? null);
  const cfoT = div(t.cfo, p.totalAssets);
  const levT = div(t.ltDebt ?? 0, t.totalAssets), levP = div(p.ltDebt ?? 0, p.totalAssets);
  const crT = div(t.currentAssets, t.currentLiabilities), crP = div(p.currentAssets, p.currentLiabilities);
  const gmT = t.revenue && t.grossProfit !== null ? t.grossProfit / t.revenue : null, gmP = p.revenue && p.grossProfit !== null ? p.grossProfit / p.revenue : null;
  const toT = div(t.revenue, p.totalAssets), toP = pp ? div(p.revenue, pp.totalAssets) : div(p.revenue, p.totalAssets);
  const test = (name: string, pass: boolean | null, detail: string) => ({ name, pass, detail });
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const signals = [
    test("Positive ROA", roaT === null ? null : roaT > 0, `ROA ${pct(roaT)}`),
    test("Positive operating cash flow", cfoT === null ? null : cfoT > 0, `CFO / assets ${pct(cfoT)}`),
    test("Improving ROA", roaT === null || roaP === null ? null : roaT > roaP, `${pct(roaP)} → ${pct(roaT)}`),
    test("Cash flow above earnings", cfoT === null || roaT === null ? null : cfoT > roaT, `CFO ${pct(cfoT)} vs ROA ${pct(roaT)}`),
    test("Lower leverage", levT === null || levP === null ? null : levT <= levP, `LT debt / assets ${pct(levP)} → ${pct(levT)}`),
    test("Better liquidity", crT === null || crP === null ? null : crT > crP, `current ratio ${crP?.toFixed(2) ?? "n/a"} → ${crT?.toFixed(2) ?? "n/a"}`),
    test("No new shares", t.shares === null || p.shares === null ? null : t.shares <= p.shares * 1.005, `shares ${p.shares ? (p.shares / 1e6).toFixed(0) : "n/a"}m → ${t.shares ? (t.shares / 1e6).toFixed(0) : "n/a"}m`),
    test("Higher gross margin", gmT === null || gmP === null ? null : gmT > gmP, `${pct(gmP)} → ${pct(gmT)}`),
    test("Higher asset turnover", toT === null || toP === null ? null : toT > toP, `${toP?.toFixed(2) ?? "n/a"}x → ${toT?.toFixed(2) ?? "n/a"}x`),
  ];
  return { score: signals.filter((s) => s.pass).length, signals };
}

/** Sloan accruals: (net income - operating cash flow) / average total assets. High accruals predict lower future earnings. */
export function sloanAccruals(t: Annual, p: Annual | null): number | null {
  if (t.netIncome === null || t.cfo === null || !t.totalAssets) return null;
  const avg = p?.totalAssets ? (t.totalAssets + p.totalAssets) / 2 : t.totalAssets;
  return (t.netIncome - t.cfo) / avg;
}

/** Novy-Marx gross profitability: gross profit / total assets. */
export const grossProfitability = (t: Annual) => div(t.grossProfit, t.totalAssets);

/** Days sales outstanding and inventory days, for trend flags. */
export function workingCapitalDays(a: Annual): { dso: number | null; dio: number | null } {
  return {
    dso: a.receivables !== null && a.revenue ? (a.receivables / a.revenue) * 365 : null,
    dio: a.inventory !== null && a.cogs ? (a.inventory / a.cogs) * 365 : null,
  };
}
