/**
 * The LBO engine shared by the Tools calculator (lbo-returns) and the LBO Stress Lab (E6). One pure function,
 * `lboSchedule`, runs a leveraged buyout down one path: entry at a multiple of EBITDA, tranches in order of
 * seniority (floating term loans at SOFR plus a spread with a floor and OID accretion, fixed notes and second
 * liens, a revolver that draws to keep minimum cash), fees and minimum cash, then a schedule each period with
 * interest on beginning balances, cash taxes on EBIT less interest, capex and working capital, mandatory
 * amortisation and a cash sweep in order, covenant tests (maximum net leverage and minimum interest cover on
 * last-twelve-months figures, or covenant-lite with a springing test when the revolver is drawn), a liquidity
 * default when cash runs out past the revolver, and the exit at a multiple. The calculator runs it yearly on a
 * deterministic path; the lab runs it quarterly on thousands of simulated paths. On a zero-volatility yearly
 * path the two agree to the cent (scripts/test-edge-next.ts checks it against the calculator's own fixtures).
 *
 * Also here: the IRR of dated cash flows (bisection on NPV), and the path summary statistics. Pure.
 */

export type Tranche = {
  name: string;
  kind: "tlb" | "notes" | "second" | "revolver";
  /** Size in turns of entry EBITDA (a revolver's commitment, undrawn at close). */
  turns: number;
  floating: boolean;
  /** Floating: spread over SOFR in basis points, a SOFR floor (%), and the OID price (accreted over four years, as the calculator does). */
  spreadBps?: number; floorPct?: number; oid?: number;
  /** Fixed coupon (%), for notes and second liens. */
  fixedPct?: number;
  /** Mandatory amortisation, % of the original balance a year. */
  amortPct?: number;
  /** Whether the sweep may prepay it (notes usually not). */
  prepayable: boolean;
};

export type Covenants = {
  /** Maximum net debt / LTM EBITDA; null for none. */
  maxNetLeverage: number | null;
  /** Minimum LTM EBITDA / LTM cash interest; null for none. */
  minInterestCover: number | null;
  /** Covenant-lite: test only while the revolver is drawn above `springAt` of its commitment. */
  springing?: boolean; springAt?: number;
};

export type Structure = {
  ebitda0: number; entryMultiple: number; tranches: Tranche[];
  financeFeePct: number; txnFeePct: number; minCash: number;
  daPct: number; capexPct: number; nwcPct: number; tax: number; sweep: number;
  years: number; periodsPerYear: 1 | 4; covenants: Covenants;
};

/**
 * One path: annualised EBITDA run-rate and SOFR (%) for periods 1..N, and the exit multiple; optionally the
 * spread (bps) new revolver money costs each period, when the lab models refinancing spreads.
 */
export type Path = { ebitda: ArrayLike<number>; sofr: ArrayLike<number>; exitMultiple: number; revolverSpreadBps?: ArrayLike<number> };

export type Row = { t: number; ebitda: number; interest: number; taxes: number; fcf: number; amort: number; swept: number; balances: number[]; revolver: number; cash: number; netDebt: number; netLeverage: number; cover: number; breach: boolean };
export type Result = {
  entryTev: number; debt0: number; fees: number; uses: number; equity: number; openNetDebt: number;
  rows: Row[]; exitEbitda: number; exitTev: number; exitEquity: number; moic: number; irr: number;
  firstBreach: number; defaulted: number;
  /** Each year-end: LTM EBITDA and net debt, and whether either covenant failed in a quarter of that year. */
  yearly: { ltmE: number; netDebt: number; lev: boolean; cov: boolean }[];
  attribution: { growth: number; multiple: number; paydown: number; fees: number };
};

const rateOf = (t: Tranche, sofr: number) => (t.floating ? Math.max(t.floorPct ?? 0, sofr) / 100 + (t.spreadBps ?? 0) / 10000 + (100 - (t.oid ?? 100)) / 4 / 100 : (t.fixedPct ?? 0) / 100);

/** Sources and uses at close. Throws a plain message when leverage exceeds the price plus fees. Pure. */
export function sourcesUses(s: Structure): { entryTev: number; debt0: number; fees: number; uses: number; equity: number } {
  if (!(s.ebitda0 > 0) || !(s.entryMultiple > 0)) throw Object.assign(new Error("Entry EBITDA and entry multiple must be positive."), { status: 400 });
  const entryTev = s.ebitda0 * s.entryMultiple;
  const debt0 = s.tranches.filter((t) => t.kind !== "revolver").reduce((a, t) => a + t.turns * s.ebitda0, 0);
  const fees = debt0 * (s.financeFeePct / 100) + entryTev * (s.txnFeePct / 100);
  const uses = entryTev + fees + s.minCash, equity = uses - debt0;
  if (equity <= 0) throw Object.assign(new Error("Leverage exceeds the purchase price plus fees: reduce the debt turns."), { status: 400 });
  return { entryTev, debt0, fees, uses, equity };
}

/** Run the buyout down one path. `keepRows` false skips the per-period rows (the lab's thousands of paths). Pure. */
export function lboSchedule(s: Structure, path: Path, keepRows = true): Result {
  const su = sourcesUses(s);
  const ppy = s.periodsPerYear, N = Math.round(s.years * ppy);
  const debts = s.tranches.map((t) => (t.kind === "revolver" ? 0 : t.turns * s.ebitda0));
  const orig = debts.slice();
  const revIdx = s.tranches.findIndex((t) => t.kind === "revolver");
  const revCap = revIdx >= 0 ? s.tranches[revIdx].turns * s.ebitda0 : 0;
  let cash = s.minCash, prevE = s.ebitda0, firstBreach = -1, defaulted = -1;
  const rows: Row[] = [];
  const ltmE: number[] = [], ltmI: number[] = [];
  const yearly: Result["yearly"] = [];
  let yLev = false, yCov = false;
  let lastE = s.ebitda0, lastNet = su.debt0 - s.minCash;
  for (let t = 1; t <= N; t++) {
    const E = path.ebitda[t - 1] ?? prevE, sofr = path.sofr[t - 1] ?? path.sofr[path.sofr.length - 1] ?? 0;
    const e = E / ppy;
    let interest = 0;
    for (let k = 0; k < debts.length; k++) {
      const tr = s.tranches[k];
      const spread = k === revIdx && path.revolverSpreadBps ? path.revolverSpreadBps[t - 1] : undefined;
      interest += (debts[k] * (spread !== undefined ? rateOf({ ...tr, spreadBps: spread }, sofr) : rateOf(tr, sofr))) / ppy;
    }
    const ebit = e * (1 - s.daPct / 100);
    const taxes = Math.max(0, ebit - interest) * (s.tax / 100);
    const dNwc = (E - prevE) * (s.nwcPct / 100);
    const fcf = e - interest - taxes - e * (s.capexPct / 100) - dNwc;
    let amort = 0;
    for (let k = 0; k < debts.length; k++) {
      const pct = s.tranches[k].amortPct ?? 0;
      if (!pct || s.tranches[k].kind === "revolver") continue;
      const a = Math.min(debts[k], (orig[k] * pct) / 100 / ppy);
      debts[k] -= a; amort += a;
    }
    let pay = Math.max(0, fcf - amort) * (s.sweep / 100);
    let swept = 0;
    // The revolver is repaid first, then prepayable tranches in order of seniority.
    const order = revIdx >= 0 ? [revIdx, ...debts.map((_, k) => k).filter((k) => k !== revIdx)] : debts.map((_, k) => k);
    for (const k of order) {
      if (pay <= 0) break;
      if (k !== revIdx && !s.tranches[k].prepayable) continue;
      const x = Math.min(debts[k], pay); debts[k] -= x; pay -= x; swept += x;
    }
    cash += fcf - amort - swept;
    if (revIdx >= 0 && cash < s.minCash) {
      const draw = Math.min(revCap - debts[revIdx], s.minCash - cash);
      if (draw > 0) { debts[revIdx] += draw; cash += draw; }
    }
    if (cash < 0 && defaulted < 0 && revIdx >= 0) defaulted = t;
    ltmE.push(e); ltmI.push(interest);
    if (ltmE.length > ppy) { ltmE.shift(); ltmI.shift(); }
    // Before a full year of history, the LTM figures annualise what there is.
    const scale = ppy / ltmE.length;
    const LE = ltmE.reduce((a, v) => a + v, 0) * scale, LI = ltmI.reduce((a, v) => a + v, 0) * scale;
    const totalDebt = debts.reduce((a, v) => a + v, 0);
    const netDebt = totalDebt - cash;
    const netLeverage = LE > 0 ? netDebt / LE : Infinity, cover = LI > 0 ? LE / LI : Infinity;
    const c = s.covenants;
    const tested = !c.springing || (revCap > 0 && revIdx >= 0 && debts[revIdx] > (c.springAt ?? 0.35) * revCap);
    const levFail = tested && c.maxNetLeverage !== null && netLeverage > c.maxNetLeverage;
    const covFail = tested && c.minInterestCover !== null && cover < c.minInterestCover;
    const breach = levFail || covFail;
    if (breach && firstBreach < 0) firstBreach = t;
    yLev ||= levFail; yCov ||= covFail;
    if (t % ppy === 0) { yearly.push({ ltmE: LE, netDebt, lev: yLev, cov: yCov }); yLev = false; yCov = false; }
    if (keepRows) rows.push({ t, ebitda: e, interest, taxes, fcf, amort, swept, balances: debts.slice(), revolver: revIdx >= 0 ? debts[revIdx] : 0, cash, netDebt, netLeverage, cover, breach });
    prevE = E; lastE = LE; lastNet = netDebt;
  }
  const exitTev = lastE * path.exitMultiple, exitEquity = exitTev - lastNet;
  const moic = exitEquity / su.equity;
  const irr = Math.pow(Math.max(moic, 0.0001), 1 / s.years) - 1;
  const openNetDebt = su.debt0 - s.minCash;
  return {
    ...su, openNetDebt, rows, yearly, exitEbitda: lastE, exitTev, exitEquity, moic, irr, firstBreach, defaulted,
    attribution: { growth: s.entryMultiple * (lastE - s.ebitda0), multiple: (path.exitMultiple - s.entryMultiple) * lastE, paydown: openNetDebt - lastNet, fees: -su.fees },
  };
}

/** The IRR of cash flows at the given times (years), by bisection on NPV; null when NPV never changes sign. Pure. */
export function irrOf(flows: number[], times: number[]): number | null {
  const npv = (r: number) => flows.reduce((s, f, i) => s + f / Math.pow(1 + r, times[i]), 0);
  let lo = -0.99, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-10) return mid;
    if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** A sorted copy's quantile. Pure. */
export function q(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The calculator's structure (lbo-returns inputs) as the shared engine's. Pure. */
export function calculatorStructure(i: { ebitda: number; entryMultiple: number; tlbTurns: number; secondTurns: number; tlbSpread: number; secondRate: number; oid: number; financeFeePct: number; txnFeePct: number; minCash: number; daPct: number; capexPct: number; nwcPct: number; tax: number; amortPct: number; sweep: number; years: number }): Structure {
  return {
    ebitda0: i.ebitda, entryMultiple: i.entryMultiple, financeFeePct: i.financeFeePct, txnFeePct: i.txnFeePct, minCash: i.minCash,
    daPct: i.daPct, capexPct: i.capexPct, nwcPct: i.nwcPct, tax: i.tax, sweep: i.sweep, years: Math.round(i.years), periodsPerYear: 1,
    covenants: { maxNetLeverage: null, minInterestCover: null },
    tranches: [
      { name: "Term loan B", kind: "tlb", turns: i.tlbTurns, floating: true, spreadBps: i.tlbSpread, floorPct: 0, oid: i.oid, amortPct: i.amortPct, prepayable: true },
      { name: "Second lien", kind: "second", turns: i.secondTurns, floating: false, fixedPct: i.secondRate, amortPct: 0, prepayable: true },
    ],
  };
}

/** A deterministic path: EBITDA growing at `growth` a year from `e0`, a flat SOFR, a fixed exit multiple. Pure. */
export function steadyPath(e0: number, growth: number, sofr: number, exitMultiple: number, years: number, ppy: 1 | 4 = 1): Path {
  const N = years * ppy;
  return { ebitda: Array.from({ length: N }, (_, k) => e0 * Math.pow(1 + growth, (k + 1) / ppy)), sofr: new Array(N).fill(sofr), exitMultiple };
}
