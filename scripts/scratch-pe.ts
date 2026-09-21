/** Scratch: print calculator KPIs and summaries for the PE pack. */
import { PE_PACK } from "../src/lib/workflows/packs/pe";

for (const t of PE_PACK) {
  if (t.kind !== "calc") continue;
  try {
    const out = t.compute(t.example ?? {});
    console.log(`\n=== ${t.id} ===`);
    console.log(out.summary);
    for (const b of out.blocks) {
      if (b.type === "kpis") console.log("  KPI " + b.items.map((k) => `${k.label}=${k.value}`).join(" | "));
      else if (b.type === "table") console.log(`  TABLE ${b.title ?? ""} (${b.rows.length} rows)`);
      else if (b.type === "sensitivity") console.log(`  SENS ${b.title ?? ""} -> ${JSON.stringify(b.values[Math.floor(b.values.length / 2)])}`);
      else console.log(`  ${b.type.toUpperCase()} ${"title" in b ? (b.title ?? "") : ""}`);
    }
  } catch (e) {
    console.log(`\n=== ${t.id} === THREW: ${(e as Error).message}`);
  }
}
const ai = PE_PACK.filter((t) => t.kind === "ai");
console.log(`\n${PE_PACK.length} tools: ${ai.length} AI, ${PE_PACK.length - ai.length} calc`);
const specs = ["Large-cap buyout", "Middle-market buyout", "Growth equity", "Private credit / direct lending", "Secondaries", "Infrastructure & real assets", "Fund of funds / LP"];
for (const s of specs) console.log(`${s}: named by ${PE_PACK.filter((t) => t.specialties?.includes(s)).length}, visible to ${PE_PACK.filter((t) => !t.specialties || t.specialties.includes(s)).length}`);
console.log("no-specialty tools: " + PE_PACK.filter((t) => !t.specialties).length);

/* ---- math checks ---- */
import { toolById } from "../src/lib/workflows/registry";
const lbo = toolById("pe-lbo-returns");
if (lbo && lbo.kind === "calc") {
  const out = lbo.compute(lbo.example ?? {});
  const wf = out.blocks.find((b) => b.type === "waterfall");
  if (wf && wf.type === "waterfall") {
    const s = wf.steps;
    const sum = s[0].value + s.slice(1, -1).reduce((a, x) => a + x.value, 0);
    console.log(`ATTRIBUTION: start+steps=${sum.toFixed(4)} vs proceeds=${s[s.length - 1].value.toFixed(4)} -> ${Math.abs(sum - s[s.length - 1].value) < 1e-6 ? "RECONCILES" : "MISMATCH"}`);
  }
}
const mip = toolById("pe-mip-waterfall");
if (mip && mip.kind === "calc") {
  const out = mip.compute({ exitEquity: 620, basis: 241, hurdleMoic: 2, mipPct: 10, catchUp: 100, ratchetMoic: 99, ratchetPct: 10, vestedPct: 100 });
  const t = out.blocks.find((b) => b.type === "table");
  if (t && t.type === "table") {
    const mgmt = Number(String(t.totals?.[4]).replace(/,/g, ""));
    const profit = 620 - 241;
    console.log(`MIP CATCH-UP: mgmt=${mgmt} of profit ${profit} = ${((mgmt / profit) * 100).toFixed(3)}% (should be 10.000%)`);
  }
}
const fund = toolById("pe-fund-model");
if (fund && fund.kind === "calc") {
  const out = fund.compute(fund.example ?? {});
  const t = out.blocks.find((b) => b.type === "table");
  if (t && t.type === "table" && t.totals) {
    const carry = Number(String(t.totals[6]).replace(/,/g, ""));
    const lpDist = Number(String(t.totals[7]).replace(/,/g, ""));
    const paidIn = Number(String(t.totals[4]).replace(/,/g, ""));
    const profit = lpDist - paidIn + carry;
    console.log(`FUND WATERFALL: carry=${carry} / profit distributed ${profit.toFixed(1)} = ${((carry / profit) * 100).toFixed(2)}% (carry rate 20%)`);
  }
}
