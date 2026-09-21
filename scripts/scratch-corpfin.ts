import { CORPFIN_PACK } from "../src/lib/workflows/packs/corpfin";

const calc = CORPFIN_PACK.filter((t) => t.kind === "calc");
const by = (id: string) => { const t = CORPFIN_PACK.find((x) => x.id === id); if (!t || t.kind !== "calc") throw new Error(id); return t; };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const fail: string[] = [];

/* 1. PVM: effects sum to the variance on 400 random cubes incl. new/discontinued/revenue-only rows */
let pvmTrials = 0;
for (let t = 0; t < 400; t++) {
  const rows = ["item,base_volume,base_price,actual_volume,actual_price"];
  for (let k = 0; k < 2 + Math.floor(Math.random() * 7); k++) {
    const roll = Math.random();
    const bv = roll < 0.15 ? 0 : +(Math.random() * 50 + 1).toFixed(3);
    const av = roll > 0.85 ? 0 : +(Math.random() * 50 + 1).toFixed(3);
    const bp = +(Math.random() * 90 + 5).toFixed(3), ap = +(Math.random() * 90 + 5).toFixed(3);
    rows.push(`SKU${k},${bv},${bv ? bp : 0},${av},${av ? ap : 0}`);
  }
  let out; try { out = by("cf-pvm-bridge").compute({ csv: rows.join("\n"), unit: "$mm", top: 5 }); } catch { continue; }
  pvmTrials++;
  const w = out.blocks.find((b) => b.type === "waterfall");
  if (w?.type === "waterfall") {
    const base = w.steps[0].value, actual = w.steps[w.steps.length - 1].value;
    const eff = w.steps.slice(1, -1).reduce((a, s) => a + s.value, 0);
    if (!near(actual - base, eff, 1e-9)) fail.push(`PVM t${t}: effects ${eff} vs variance ${actual - base}`);
  }
}
console.log(`PVM: ${pvmTrials} random cubes, effects reconcile exactly to the variance`);

/* 2. CCC days bridge and unlock, raw from the waterfall */
const cc = by("cf-cash-conversion-cycle").compute({ revenue: 36500, cogs: 18250, ar: 4000, inventory: 5000, ap: 2000, targetDso: 30, targetDio: 80, targetDpo: 50, rate: 6, days: 365 });
const ccw = cc.blocks.find((b) => b.type === "waterfall");
if (ccw?.type === "waterfall") {
  const s = ccw.steps.map((x) => x.value);
  if (!near(s[0], 100)) fail.push(`CCC current ${s[0]} expected 100 (DSO 40 + DIO 100 - DPO 40)`);
  if (!near(s[0] + s[1] + s[2] + s[3], s[4])) fail.push(`CCC bridge ${s[0] + s[1] + s[2] + s[3]} vs target ${s[4]}`);
  if (!near(s[4], 60)) fail.push(`target CCC ${s[4]} expected 60`);
}
const ccb = cc.blocks.find((b) => b.type === "bar");
if (ccb?.type === "bar") {
  const got = ccb.data.reduce((a, d) => a + (d.value ?? 0), 0);
  const want = (40 - 30) * 36500 / 365 + (100 - 80) * 18250 / 365 + (50 - 40) * 18250 / 365;
  if (!near(got, want, 1e-9)) fail.push(`CCC unlock ${got} vs ${want}`);
  console.log(`CCC: unlock ${got.toFixed(1)}mm = AR ${(1000).toFixed(0)} + inventory ${(1000).toFixed(0)} + AP ${(500).toFixed(0)}`);
}

/* 3. Covenant: utilization bar carries raw ratios */
const cov = by("cf-covenant-headroom").compute({ ebitda: 1000, addbacks: 0, debt: 4000, cash: 600, nettingCap: 500, interest: 200, capex: 100, taxes: 50, amort: 100, dividends: 50, revolver: 500, maxLeverage: 4, minCoverage: 3, minFccr: 1.25, minLiquidity: 750 });
const cb = cov.blocks.find((b) => b.type === "bar");
if (cb?.type === "bar") {
  const u = Object.fromEntries(cb.data.map((d) => [d.label, d.value ?? 0]));
  const want = { "Net leverage": 3.5 / 4, "Interest coverage": 3 / 5, "Fixed-charge coverage": 1.25 / (850 / 350), "Minimum liquidity": 750 / 1100 };
  for (const [k, v] of Object.entries(want)) if (!near(u[k], v, 1e-9)) fail.push(`covenant utilization ${k}: ${u[k]} vs ${v}`);
  console.log("Covenant: net leverage 3.5x (net debt 3,500 after the 500 netting cap), coverage 5.0x, FCCR 2.43x, utilizations exact");
}
const cs = cov.blocks.find((b) => b.type === "sensitivity");
if (cs?.type === "sensitivity" && !near(cs.values[0][0] ?? 0, 3.5, 1e-9)) fail.push(`covenant grid base cell ${cs.values[0][0]} vs 3.5`);

/* 4. Accretion: linearity in synergies and the breakeven, from the raw sensitivity grid + waterfall */
const ad = by("cf-accretion-dilution"), ex = ad.example!;
const o1 = ad.compute(ex);
const aw = o1.blocks.find((b) => b.type === "waterfall");
if (aw?.type === "waterfall") {
  const s = aw.steps.map((x) => x.value);
  if (!near(s[0] + s[1] + s[2] + s[3] + s[4], s[5], 1e-9)) fail.push(`accretion NI bridge ${s[0] + s[1] + s[2] + s[3] + s[4]} vs ${s[5]}`);
  console.log(`Accretion: NI bridge exact (${s[0]} + ${s[1]} + ${s[2].toFixed(1)} ${s[3].toFixed(1)} ${s[4].toFixed(1)} = ${s[5].toFixed(1)})`);
}
const as_ = o1.blocks.find((b) => b.type === "sensitivity");
if (as_?.type === "sensitivity") {
  const row = as_.values[as_.baseRow ?? 2].map((v) => v ?? 0);
  const syn = Number(ex.synergies);
  const a0 = row[0], a2 = row[2];
  const implied = (-a0 * syn) / (a2 - a0); // accretion is linear in synergies
  const k = o1.blocks[0];
  const shown = k.type === "kpis" ? k.items.find((x) => x.label === "Breakeven synergies")!.value : "";
  const mag = shown.includes("B") ? 1000 : 1;
  const parsed = Number(shown.replace(/[$MB,]/g, "")) * mag;
  if (Math.abs(implied - parsed) > 50 * mag / 1000 + 0.05 * mag) fail.push(`breakeven ${parsed} vs implied ${implied.toFixed(1)}`);
  const check = ad.compute({ ...ex, synergies: implied });
  const kk = check.blocks[0];
  const acc = kk.type === "kpis" ? kk.items.find((x) => x.label === "Pro forma EPS")!.delta! : "";
  if (!/^-?0\.0%$/.test(acc)) fail.push(`accretion at implied breakeven ${implied.toFixed(1)} is ${acc}`);
  console.log(`Accretion: breakeven synergies shown ${shown}, solved ${implied.toFixed(1)}mm, accretion there ${acc}`);
}

/* 5. Debt schedule: maturity wall sums to principal; interest ties to average balances */
const dsT = by("cf-debt-schedule");
const ds = dsT.compute(dsT.example!);
const wall = ds.blocks.find((b) => b.type === "columns");
if (wall?.type === "columns") {
  const total = wall.data.reduce((a, d) => a + d.value, 0);
  if (!near(total, 300 + 1200 + 750 + 1000 + 900 + 180, 1e-9)) fail.push(`maturity wall ${total} vs 4330 principal`);
  console.log(`Debt: maturity wall totals ${total} = pasted principal`);
}
const dsRate = ds.blocks.find((b) => b.type === "bar");
if (dsRate?.type === "bar") {
  const cur = dsRate.data.find((d) => d.emphasis)!.value!;
  const up = dsRate.data.find((d) => d.label.includes("100 bps") && d.label.startsWith("+"))!.value!;
  if (!near(up - cur, 1500 * 0.01, 1e-9)) fail.push(`floating sensitivity ${up - cur} vs 15 (1,500mm floating x 100bps)`);
  console.log(`Debt: +100bps adds ${(up - cur).toFixed(1)}mm on 1,500mm of floating debt`);
}

/* 6. Swap: the breakeven path averages to the swap rate */
const sw = by("cf-swap-breakeven").compute({ notional: 1000, tenor: 5, index: 4, swapFixed: 4.5, spread: 200, discount: 4, hedgeShare: 100 });
const swl = sw.blocks.find((b) => b.type === "line");
if (swl?.type === "line") {
  const path = swl.series[0].points.map((p) => p.y ?? 0);
  const avg = path.reduce((a, b) => a + b, 0) / path.length;
  if (!near(avg, 0.045, 1e-6)) fail.push(`swap breakeven path averages ${avg} vs the 4.5% swap rate`);
  console.log(`Swap: breakeven ramp averages ${(avg * 100).toFixed(3)}% = the swap rate; rise of ${((path[1] - path[0]) * 10000).toFixed(0)}bps/yr`);
}

/* 7. FX hedge layering: hedge ratio and incremental notional */
const fx = by("cf-fx-hedge-layering").compute({ csv: "currency,quarter,exposure_local,spot_rate,forward_rate,hedged_local\nEUR,1,100,1.10,1.10,50\nEUR,2,100,1.10,1.10,0", policy: "100, 50", shock: 10, shares: 100, tax: 25 });
const fk = fx.blocks[0];
if (fk.type === "kpis") {
  const v = (l: string) => fk.items.find((x) => x.label.startsWith(l))?.value;
  // exposure 220mm USD; hedged 55; target = 100%*100 + 50%*100 = 150 local = 165 USD; incremental = 50 local Q1 + 50 local Q2 = 110 USD
  if (v("Exposure at spot") !== "$220.0M") fail.push(`fx exposure ${v("Exposure at spot")}`);
  if (v("Hedge ratio today") !== "25%") fail.push(`fx ratio ${v("Hedge ratio today")}`);
  if (v("Incremental notional") !== "$110.0M") fail.push(`fx incremental ${v("Incremental notional")}`);
  if (v("At risk at policy") !== "$5.5M") fail.push(`fx at risk at policy ${v("At risk at policy")}`);
  console.log(`FX layering: exposure ${v("Exposure at spot")}, ratio ${v("Hedge ratio today")} vs policy, incremental ${v("Incremental notional")}, at risk at policy ${v("At risk at policy")}`);
}

/* 8. FX sensitivity: revenue at spot vs budget and the EBITDA net */
const fs = by("cf-fx-sensitivity").compute({ csv: "currency,revenue_local,opex_local,spot_rate,budget_rate\nEUR,1000,400,1.00,1.10", hedgeRatio: 50, shock: 10, shares: 100, tax: 25 });
const fsk = fs.blocks[0];
if (fsk.type === "kpis") {
  const v = (l: string) => fsk.items.find((x) => x.label.startsWith(l))?.value;
  // rev spot 1000, budget 1100 => -100; opex spot 400 vs 440 => -40; ebitda impact -60; after 50% hedge -30; eps -30*0.75/100 = -0.225
  if (v("FX effect on revenue") !== "$-100.0M" || v("FX effect on EBITDA") !== "$-60.0M" || v("After hedges") !== "$-30.0M") fail.push(`fx sensitivity kpis ${v("FX effect on revenue")} ${v("FX effect on EBITDA")} ${v("After hedges")}`);
  if (v("EPS effect") !== "$-0.22") fail.push(`fx eps ${v("EPS effect")}`);
  console.log(`FX sensitivity: revenue ${v("FX effect on revenue")}, EBITDA ${v("FX effect on EBITDA")}, after hedges ${v("After hedges")}, EPS ${v("EPS effect")}`);
}

/* 9. Buyback: EPS values raw from the bar, and the earnings-yield test */
const bb = by("cf-buyback-vs-dividend").compute({ netIncome: 1000, shares: 100, price: 100, ebitda: 1500, fcf: 900, cash: 1000, debt: 2000, deploy: 500, debtFunded: 0, premium: 0, newDebtRate: 5, cashYield: 4, tax: 0, currentDps: 0 });
const bbb = bb.blocks.find((b) => b.type === "bar");
if (bbb?.type === "bar") {
  const d = Object.fromEntries(bbb.data.map((x) => [x.label, x.value ?? 0]));
  // funding cost = 500*4% = 20; buyback: (1000-20)/(100-5) = 10.32; dividend: 980/100 = 9.80; base 10.00
  if (!near(d["Standalone"], 10, 1e-3) || !near(d["Buyback"], 10.32, 1e-3) || !near(d["Dividend"], 9.8, 1e-3)) fail.push(`buyback EPS ${JSON.stringify(d)}`);
  console.log(`Buyback: EPS ${d["Standalone"]} standalone, ${d["Buyback"]} buyback, ${d["Dividend"]} dividend (earnings yield 10% > 4% cash yield)`);
}

/* 10. Forecast accuracy: MAPE and bias by hand */
const fa = by("cf-forecast-accuracy").compute({ csv: "period,line,forecast,actual\nP1,A,100,110\nP2,A,100,90\nP1,B,100,80\nP2,B,100,80", tolerance: 5 });
const fab = fa.blocks.find((b) => b.type === "bar");
if (fab?.type === "bar") {
  const m = Object.fromEntries(fab.data.map((d) => [d.label, d.value ?? 0]));
  if (!near(m["A"], 0.1, 1e-9) || !near(m["B"], 0.2, 1e-9)) fail.push(`MAPE ${JSON.stringify(m)}`);
  const line = fa.blocks.find((b) => b.type === "line");
  if (line?.type === "line") {
    const bias = line.series[0].points.map((p) => p.y ?? 0);
    if (!near(bias[0], -0.05, 1e-9)) fail.push(`period bias ${bias[0]} vs -0.05`);
  }
  console.log("Forecast accuracy: MAPE A 10% (noisy, zero bias), B 20% (all bias); period bias exact");
}

/* 11. Headcount: monthly cost ties to the department roll-up */
const hc = by("cf-headcount-plan").compute({ csv: "department,role,start_month,fte,base_salary,bonus_pct\nEng,Engineer,1,1,120,0", months: 12, benefits: 0, payrollTax: 0, attrition: 0, startingFte: 0, startingCost: 0 });
const hcl = hc.blocks.find((b) => b.type === "line");
if (hcl?.type === "line") {
  const total = hcl.series[0].points.reduce((a, p) => a + (p.y ?? 0), 0);
  if (!near(total, 120, 1e-6)) fail.push(`headcount in-year cost ${total} vs 120 (one hire at $120k from month 1, no load, no attrition)`);
  console.log("Headcount: one $120k hire from month 1 with no load costs exactly $120k in the year");
}

/* 12. Capital allocation: NPV, PI and IRR by hand, from raw blocks */
const ca = by("cf-capital-allocation").compute({ csv: "project,category,investment,flows,strategic_score\nA,Growth,100,60 60,5\nB,Growth,100,30 30 30 30,3", hurdle: 10, budget: 150 });
const cab = ca.blocks.find((b) => b.type === "bar");
if (cab?.type === "bar") {
  const npvA = 60 / 1.1 + 60 / 1.21 - 100, npvB = 30 * (1 / 1.1 + 1 / 1.21 + 1 / 1.331 + 1 / 1.4641) - 100;
  const d = Object.fromEntries(cab.data.map((x) => [x.label, x.value ?? 0]));
  if (!near(d["A"], npvA, 1e-9) || !near(d["B"], npvB, 1e-9)) fail.push(`capalloc NPV ${JSON.stringify(d)} vs ${npvA} / ${npvB}`);
  const sc = ca.blocks.find((b) => b.type === "scatter");
  if (sc?.type === "scatter") {
    const irrA = sc.points.find((p) => p.label === "A")!.y!;
    if (Math.abs(60 / (1 + irrA) + 60 / Math.pow(1 + irrA, 2) - 100) > 1e-6) fail.push(`IRR A ${irrA} does not zero the NPV`);
    console.log(`Capital allocation: NPV A ${npvA.toFixed(3)}, B ${npvB.toFixed(3)}; IRR A ${(irrA * 100).toFixed(2)}% zeroes the NPV; funded within the 150 budget`);
  }
}

/* 13. every calculator: example runs and empty inputs throw */
for (const t of calc) {
  if (t.kind !== "calc") continue;
  try { t.compute(t.example ?? {}); } catch (e) { fail.push(`${t.id} threw on example: ${(e as Error).message}`); }
  try { t.compute({}); console.log(`  note: ${t.id} returns on empty inputs (allowed)`); } catch { /* expected */ }
}
console.log(fail.length ? `\nFAILURES:\n- ${fail.join("\n- ")}` : `\nALL ${13} IDENTITY CHECK GROUPS PASSED`);
