/** Scratch checks for the VC pack math against published worked examples. */
import { VC_PACK } from "../src/lib/workflows/packs/vc";
import type { CalculatorDef, WorkflowDef } from "../src/lib/workflows/types";

const calc = (id: string) => VC_PACK.find((t) => t.id === id && t.kind === "calc") as CalculatorDef;
const kpi = (id: string, inputs: Record<string, unknown>, label: string) => {
  const out = calc(id).compute(inputs);
  const b = out.blocks.find((x) => x.type === "kpis");
  const item = b && b.type === "kpis" ? b.items.find((k) => k.label.toLowerCase().includes(label.toLowerCase())) : undefined;
  return item?.value ?? "?";
};

// 1. CRV option pool shuffle: $10M pre, $3M raise, 10% post-money pool -> investor 23.1%, founders 66.9%
{
  const out = calc("cap-table-dilution").compute({ founderShares: 9, otherCommon: 0, pool: 0, safes: "", pre: 10, newMoney: 3, poolTarget: 10 });
  const t = out.blocks.find((b) => b.type === "table");
  console.log("1. CRV pool shuffle:", out.summary);
  if (t && t.type === "table") for (const r of t.rows) console.log("   ", r.join(" | "));
  const out20 = calc("cap-table-dilution").compute({ founderShares: 9, otherCommon: 0, pool: 0, safes: "", pre: 10, newMoney: 3, poolTarget: 20 });
  console.log("   at a 20% pool, founders =", kpi("cap-table-dilution", { founderShares: 9, otherCommon: 0, pool: 0, safes: "", pre: 10, newMoney: 3, poolTarget: 20 }, "Founders"), "(CRV says ~56.9%)", out20.title === "" ? "" : "");
}

// 2. Post-money SAFE: $500K at $6.7M cap = ~7.5%
{
  const out = calc("safe-to-equity").compute({ safes: "Angel, 0.5, 6.7, post", common: 9, pool: 0, pre: 20, newMoney: 0.0001, poolTarget: 0 });
  console.log("2. $500K at $6.7M post cap:", out.summary.slice(0, 200));
}

// 3. Research prompt 5: three post-money SAFEs into a $6M Series A at $24M pre with a 12% pool
{
  const out = calc("safe-to-equity").compute({ safes: "SAFE A, 0.5, 8, post\nSAFE B, 0.75, 10, post\nMFN, 0.25, 10, post", common: 9, pool: 0.5, pre: 24, newMoney: 6, poolTarget: 12 });
  console.log("3. SAFE stack ->", out.summary);
  const t = out.blocks.find((b) => b.type === "table");
  if (t && t.type === "table") for (const r of t.rows) console.log("   ", r.join(" | "));
}

// 4. Glencoyne waterfall: $30M exit, $5M for 25% (2.5mm of 10mm shares)
{
  const np = calc("exit-waterfall").compute({ classes: "Series A, 5, 2.5, 1, n, 0, 1", common: 7.5, exits: "30", focus: 30, costs: 0, carve: 0 });
  console.log("4a. Non-participating:", np.summary);
  const p = calc("exit-waterfall").compute({ classes: "Series A, 5, 2.5, 1, y, 0, 1", common: 7.5, exits: "30", focus: 30, costs: 0, carve: 0 });
  console.log("4b. Participating:", p.summary);
}

// 5. Research prompt 10: A 1x non-part, B 1x participating capped at 3x, exits 50/150/500
{
  const out = calc("exit-waterfall").compute({ classes: "Series A, 12, 12, 1, n, 0, 2\nSeries B, 35, 17.5, 1, y, 3, 1", common: 40, exits: "50 150 500", focus: 150, costs: 0, carve: 0 });
  const t = out.blocks.filter((b) => b.type === "table")[0];
  console.log("5. Stacked waterfall:", out.summary);
  if (t && t.type === "table") for (const r of t.rows) console.log("   ", r.join(" | "));
  const bl = out.blocks.find((b) => b.type === "bullets");
  if (bl && bl.type === "bullets") bl.items.forEach((x) => console.log("   *", x));
}

// 6. Venture method: $10M in, $1B exit in 7y, 10x, 40% dilution -> 16.7% today, $60M post, $50M pre
{
  const out = calc("venture-method").compute({ investment: 10, exitEquity: 1000, years: 7, method: "Target multiple", targetMultiple: 10, targetIrr: 40, dilution: 40 });
  console.log("6. Venture method:", out.summary);
}

// 7. Fund model: VC Factory check - $40M fund, 3x gross, 7.5% ownership at exit -> ~$1B winner
{
  const out = calc("vc-fund-model").compute({ size: 40, fee: 2, feeStep: 1.5, invPeriod: 4, term: 10, positions: 25, entryOwn: 15, reserve: 40, followOns: 6, dilution: 50, lossRate: 50, baseRate: 30, baseMoic: 1.5, winnerMoic: 20, hold: 7, carry: 20, hurdle: 0, target: 3, recycle: false });
  console.log("7. Fund model:", out.summary);
}

// 8. Specialty coverage and counts
{
  const SPECS = ["Pre-seed / seed", "Series A-B", "Growth / late stage", "Corporate VC", "Angel / syndicate", "Secondaries"];
  const ai = VC_PACK.filter((t) => t.kind === "ai").length, c = VC_PACK.length - ai;
  console.log(`8. ${VC_PACK.length} tools: ${ai} AI workflows, ${c} calculators`);
  for (const s of SPECS) {
    const hits = VC_PACK.filter((t) => t.specialties?.includes(s));
    console.log(`   ${s}: ${hits.length} -> ${hits.map((t) => t.id).join(", ")}`);
  }
  const noSpec = VC_PACK.filter((t) => !t.specialties).length;
  console.log(`   tools with no specialty filter (visible to all): ${noSpec}`);
  const short = VC_PACK.filter((t) => t.kind === "ai" && (t as WorkflowDef).instructions.length < 900);
  console.log(`   thin instructions (<900 chars): ${short.map((t) => t.id).join(", ") || "none"}`);
  const cats = [...new Set(VC_PACK.map((t) => t.category))];
  console.log(`   categories: ${cats.join(", ")}`);
}
