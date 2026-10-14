/**
 * From a fund's 13F holdings to the weights a clone holds. Pure, for tests.
 *
 * The rules, in order (every one is shown on the page and in a copy's settings):
 * 1. Long equity only. Options (puts and calls) and principal amounts (convertible notes) are listed on
 *    the fund page but never cloned: a 13F gives an option's underlying value, not its strike, expiry or
 *    premium, so no one can rebuild the position from it.
 * 2. Each CUSIP needs a ticker (see securities.ts); unmapped lines are left out and counted against
 *    coverage, by value.
 * 3. Share classes of one company count as one idea (Alphabet's GOOGL and GOOG; Berkshire's A and B
 *    shares): they are merged into the class the fund holds most of, so a top-N rule is about companies.
 * 4. Excluded tickers and sectors go next.
 * 5. Largest first, the top N, then any below the minimum weight; what is left is scaled to 100%.
 */
import type { Holding } from "./thirteenf";

export type SecurityInfo = { ticker: string | null; sector: string | null; source?: string };

export type CloneRules = {
  /** Keep this many companies (after merging share classes). 0 or less means all. */
  topN: number;
  /** Drop positions below this weight (0.01 = 1%) after the top-N cut, before rescaling. */
  minWeight: number;
  excludeTickers: string[];
  excludeSectors: string[];
};

export const DEFAULT_RULES: CloneRules = { topN: 20, minWeight: 0, excludeTickers: [], excludeSectors: [] };

export type Target = { ticker: string; weight: number; name: string; value: number; cusips: string[]; sector: string | null; mergedClasses: boolean };
export type Left = { name: string; cusip: string; value: number; reason: "option" | "principal" | "unmapped" | "excluded ticker" | "excluded sector" | "below top N" | "below minimum weight" };

export type CloneResult = {
  targets: Target[];
  left: Left[];
  /** Shares of the fund's long equity value: mapped to tickers, and finally held by the clone. */
  coverage: { equityValue: number; mappedValue: number; mappedPct: number; clonedPct: number; unmappedCount: number };
};

export function cloneTargets(holdings: Holding[], rules: CloneRules, info: (cusip: string) => SecurityInfo | undefined): CloneResult {
  const left: Left[] = [];
  const eq: Holding[] = [];
  for (const h of holdings) {
    if (h.putCall) left.push({ name: h.name, cusip: h.cusip, value: h.value, reason: "option" });
    else if (h.shareType === "PRN") left.push({ name: h.name, cusip: h.cusip, value: h.value, reason: "principal" });
    else eq.push(h);
  }
  const equityValue = eq.reduce((s, h) => s + h.value, 0);
  // One entry per company: by issuer (the CUSIP's first six characters), keeping the class held most.
  const byIssuer = new Map<string, { name: string; value: number; cusips: string[]; best: { cusip: string; value: number; ticker: string; sector: string | null } | null; classes: Set<string> }>();
  let mappedValue = 0, unmappedCount = 0;
  for (const h of eq) {
    const s = info(h.cusip);
    if (!s?.ticker) { left.push({ name: h.name, cusip: h.cusip, value: h.value, reason: "unmapped" }); unmappedCount++; continue; }
    mappedValue += h.value;
    const g = byIssuer.get(h.issuer6) ?? { name: h.name, value: 0, cusips: [], best: null, classes: new Set<string>() };
    g.value += h.value;
    g.cusips.push(h.cusip);
    g.classes.add(s.ticker);
    if (!g.best || h.value > g.best.value) g.best = { cusip: h.cusip, value: h.value, ticker: s.ticker, sector: s.sector };
    byIssuer.set(h.issuer6, g);
  }
  // Two issuers can map to one ticker (an old and a new CUSIP after a reorganisation): add them up.
  const byTicker = new Map<string, Target>();
  for (const g of byIssuer.values()) {
    const t = g.best!.ticker;
    const x = byTicker.get(t);
    if (x) { x.value += g.value; x.cusips.push(...g.cusips); x.mergedClasses ||= g.classes.size > 1; }
    else byTicker.set(t, { ticker: t, weight: 0, name: g.name, value: g.value, cusips: [...g.cusips], sector: g.best!.sector, mergedClasses: g.classes.size > 1 });
  }
  const exT = new Set(rules.excludeTickers.map((t) => t.trim().toUpperCase().replace(/\./g, "-")).filter(Boolean));
  const exS = new Set(rules.excludeSectors.map((s) => s.trim().toLowerCase()).filter(Boolean));
  let kept = [...byTicker.values()].sort((a, b) => b.value - a.value).filter((t) => {
    if (exT.has(t.ticker)) { left.push({ name: t.name, cusip: t.cusips[0], value: t.value, reason: "excluded ticker" }); return false; }
    if (t.sector && exS.has(t.sector.toLowerCase())) { left.push({ name: t.name, cusip: t.cusips[0], value: t.value, reason: "excluded sector" }); return false; }
    return true;
  });
  if (rules.topN > 0 && kept.length > rules.topN) {
    for (const t of kept.slice(rules.topN)) left.push({ name: t.name, cusip: t.cusips[0], value: t.value, reason: "below top N" });
    kept = kept.slice(0, rules.topN);
  }
  const keptTotal = kept.reduce((s, t) => s + t.value, 0) || 1;
  if (rules.minWeight > 0) {
    kept = kept.filter((t) => {
      if (t.value / keptTotal >= rules.minWeight) return true;
      left.push({ name: t.name, cusip: t.cusips[0], value: t.value, reason: "below minimum weight" });
      return false;
    });
  }
  const total = kept.reduce((s, t) => s + t.value, 0);
  const targets = kept.map((t) => ({ ...t, weight: total > 0 ? t.value / total : 0 }));
  return {
    targets, left,
    coverage: { equityValue, mappedValue, mappedPct: equityValue > 0 ? mappedValue / equityValue : 0, clonedPct: equityValue > 0 ? total / equityValue : 0, unmappedCount },
  };
}

/** Weights as a plain map. */
export const weightMap = (ts: Pick<Target, "ticker" | "weight">[]): Record<string, number> => Object.fromEntries(ts.map((t) => [t.ticker, t.weight]));

/**
 * Several funds' clones mixed by the person's weights (a blend), then cut to the top N and rescaled.
 * Fund weights are normalised, so 1:1:2 and 25%:25%:50% mean the same.
 */
export function blendTargets(parts: { weight: number; targets: Pick<Target, "ticker" | "weight" | "name" | "sector">[] }[], topN: number): { ticker: string; weight: number; name: string; sector: string | null }[] {
  const sum = parts.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  const by = new Map<string, { ticker: string; weight: number; name: string; sector: string | null }>();
  for (const p of parts) {
    const f = Math.max(0, p.weight) / sum;
    for (const t of p.targets) {
      const x = by.get(t.ticker) ?? { ticker: t.ticker, weight: 0, name: t.name, sector: t.sector };
      x.weight += f * t.weight;
      by.set(t.ticker, x);
    }
  }
  let out = [...by.values()].sort((a, b) => b.weight - a.weight);
  if (topN > 0) out = out.slice(0, topN);
  const total = out.reduce((s, t) => s + t.weight, 0) || 1;
  return out.map((t) => ({ ...t, weight: t.weight / total }));
}

/** Clean rules from untrusted input, within sane bounds. */
export function cleanRules(v: Partial<Record<keyof CloneRules, unknown>>): CloneRules {
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === "string" ? x.split(/[,\s]+/) : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 100);
  const n = Number(v.topN);
  const mw = Number(v.minWeight);
  return {
    topN: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULT_RULES.topN,
    minWeight: Number.isFinite(mw) ? Math.max(0, Math.min(0.25, mw)) : 0,
    excludeTickers: list(v.excludeTickers).map((t) => t.toUpperCase()),
    excludeSectors: list(v.excludeSectors).map((s) => s.toLowerCase()),
  };
}
