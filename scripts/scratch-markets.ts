/** Scratch: print every markets calculator's output from its example inputs. */
import { MARKETS_PACK } from "../src/lib/workflows/packs/markets";

for (const t of MARKETS_PACK) {
  if (t.kind !== "calc") continue;
  const out = t.compute(t.example ?? {});
  console.log(`\n=== ${t.id} ===`);
  console.log(out.summary);
  for (const b of out.blocks) {
    if (b.type === "kpis") console.log("  KPI " + b.items.map((k) => `${k.label}=${k.value}`).join(" | "));
    else if (b.type === "table") { console.log(`  TABLE ${b.title ?? ""}`); for (const r of b.rows) console.log("    " + r.join(" | ")); if (b.totals) console.log("    TOTALS " + b.totals.join(" | ")); }
    else if (b.type === "waterfall") console.log(`  WATERFALL ${b.title ?? ""}: ` + b.steps.map((s) => `${s.label}=${s.value.toFixed(1)}`).join(" | "));
    else if (b.type === "sensitivity") { console.log(`  SENS ${b.title ?? ""} rows=${b.rows.join(",")} cols=${b.cols.join(",")}`); for (let r = 0; r < b.values.length; r++) console.log("    " + b.rows[r] + ": " + b.values[r].map((v) => (v === null ? "null" : v.toFixed(4))).join(" ")); }
    else if (b.type === "bar" || b.type === "columns") console.log(`  ${b.type.toUpperCase()} ${b.title ?? ""}: ` + b.data.map((d) => `${d.label}=${d.value === null ? "null" : d.value.toFixed(4)}`).join(" | "));
  }
  try { t.compute({}); console.log("  EMPTY INPUTS: returned without throwing"); } catch (e) { console.log(`  EMPTY INPUTS: threw "${(e as Error).message}"`); }
}
