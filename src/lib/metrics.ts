import type { CompanyData } from "./types";

/** Derived valuation and operating metrics. null = not available or not meaningful. */
export type Derived = {
  marketCap: number | null;
  netDebt: number | null;
  ev: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  opMargin: number | null;
  ebitdaMargin: number | null;
  fcf: number | null;
  fcfMargin: number | null;
  ruleOf40: number | null;
  evRevLtm: number | null;
  evRevNtm: number | null;
  evEbitdaLtm: number | null;
  evAdjEbitdaLtm: number | null;
  evEbitdaNtm: number | null;
  peLtm: number | null;
  evFcf: number | null;
};

const ratio = (num: number | null, den: number | null): number | null => (num !== null && den !== null && den > 0 ? num / den : null);
const sub = (a: number | null, b: number | null): number | null => (a !== null && b !== null ? a - b : null);
const add = (a: number | null, b: number | null): number | null => (a !== null && b !== null ? a + b : null);

export function derive(c: CompanyData): Derived {
  const { ltm: l, balance: b, price: p, estimates: e } = c;
  const marketCap = p?.marketCap ?? null;
  const netDebt = sub(b.debt, b.cash);
  const ev = add(marketCap, netDebt);
  const fcf = sub(l.operatingCashFlow, l.capex);
  const margin = (x: number | null) => (x !== null && l.revenue !== null && l.revenue > 0 ? x / l.revenue : null);
  const revenueGrowth = l.revenue !== null && l.priorRevenue !== null && l.priorRevenue > 0 ? l.revenue / l.priorRevenue - 1 : null;
  const fcfMargin = margin(fcf);
  return {
    marketCap,
    netDebt,
    ev,
    revenueGrowth,
    grossMargin: margin(l.grossProfit),
    opMargin: margin(l.operatingIncome),
    ebitdaMargin: margin(l.ebitda),
    fcf,
    fcfMargin,
    ruleOf40: revenueGrowth !== null && fcfMargin !== null ? (revenueGrowth + fcfMargin) * 100 : null,
    evRevLtm: ratio(ev, l.revenue),
    evRevNtm: ratio(ev, e.ntmRevenue),
    evEbitdaLtm: ratio(ev, l.ebitda),
    evAdjEbitdaLtm: ratio(ev, l.adjEbitda),
    evEbitdaNtm: ratio(ev, e.ntmEbitda),
    peLtm: ratio(marketCap, l.netIncome),
    evFcf: ratio(ev, fcf),
  };
}

export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* Formatting */
export const fmtX = (v: number | null, cap = 100) => (v === null ? "NM" : v > cap ? `>${cap}x` : `${v.toFixed(1)}x`);
export const fmtPct = (v: number | null, digits = 0) => (v === null ? "NM" : `${(v * 100).toFixed(digits)}%`);
export const fmtNum = (v: number | null, digits = 0) =>
  v === null ? "NM" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtMoney = (v: number | null) => (v === null ? "NM" : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}B` : `${v.toFixed(0)}M`);
export const fmtSigned = (v: number | null, digits = 0) => (v === null ? "NM" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`);
