/**
 * The LBO engine's cross-language fixture: scripts/fixtures/lbo/engine.json holds a few structures and paths with
 * what src/lib/edge/scen/lbo.ts computes for them, so ml/lbo_core.py (the 20,000-path refine on the ML service)
 * is checked against the same numbers by ml/test_lbo_core.py, and scripts/test-edge-next.ts checks that the
 * TypeScript engine still matches them.
 *   pnpm exec tsx scripts/gen-lbo-fixture.ts
 */
import { writeFileSync } from "node:fs";
import { lboSchedule, steadyPath, type Path, type Structure } from "@/lib/edge/scen/lbo";

const base: Structure = {
  ebitda0: 200, entryMultiple: 11, financeFeePct: 2, txnFeePct: 2, minCash: 20, daPct: 30, capexPct: 40, nwcPct: 10, tax: 25, sweep: 75, years: 5, periodsPerYear: 4,
  covenants: { maxNetLeverage: 7, minInterestCover: 1.75, springing: false, springAt: 0.35 },
  tranches: [
    { name: "Term loan B", kind: "tlb", turns: 4, floating: true, spreadBps: 350, floorPct: 0.5, oid: 99, amortPct: 1, prepayable: true },
    { name: "Senior notes", kind: "notes", turns: 1.5, floating: false, fixedPct: 8.5, amortPct: 0, prepayable: false },
    { name: "Revolver", kind: "revolver", turns: 1, floating: true, spreadBps: 325, floorPct: 0, amortPct: 0, prepayable: true },
  ],
};
const shock: Path = { ebitda: Array.from({ length: 20 }, (_, k) => 200 * (k < 6 ? 1 - 0.06 * (k + 1) : 0.64 + 0.03 * (k - 5))), sofr: Array.from({ length: 20 }, (_, k) => 4 + 0.15 * Math.min(k, 8)), exitMultiple: 8.5, revolverSpreadBps: Array.from({ length: 20 }, (_, k) => 350 + 40 * Math.min(k, 6)) };
const deep: Path = { ...shock, ebitda: Array.from({ length: 20 }, (_, k) => 200 * (k < 6 ? 1 - 0.13 * (k + 1) : 0.22 + 0.05 * (k - 5))) };
const cases = [
  { structure: base, path: steadyPath(200, 0.05, 4.1, 10, 5, 4) },
  { structure: base, path: shock },
  { structure: { ...base, covenants: { maxNetLeverage: 6, minInterestCover: null, springing: true, springAt: 0.35 } }, path: deep },
  { structure: { ...base, periodsPerYear: 1 as const, years: 4, tranches: base.tranches.slice(0, 2) }, path: steadyPath(200, -0.02, 3.5, 9, 4, 1) },
];
const out = cases.map((c) => {
  const r = lboSchedule(c.structure, { ...c.path, ebitda: Array.from(c.path.ebitda), sofr: Array.from(c.path.sofr), ...(c.path.revolverSpreadBps ? { revolverSpreadBps: Array.from(c.path.revolverSpreadBps) } : {}) });
  return { structure: c.structure, path: { ebitda: Array.from(c.path.ebitda), sofr: Array.from(c.path.sofr), exitMultiple: c.path.exitMultiple, ...(c.path.revolverSpreadBps ? { revolverSpreadBps: Array.from(c.path.revolverSpreadBps) } : {}) }, result: { equity: r.equity, moic: r.moic, irr: r.irr, exitEquity: r.exitEquity, firstBreach: r.firstBreach, defaulted: r.defaulted, yearly: r.yearly, attribution: r.attribution, cash: r.rows.map((x) => x.cash) } };
});
writeFileSync("scripts/fixtures/lbo/engine.json", `${JSON.stringify(out)}\n`);
console.log(`wrote ${out.length} engine cases`, out.map((c) => [c.result.irr.toFixed(4), c.result.firstBreach, c.result.defaulted]));
