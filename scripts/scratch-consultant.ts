import { CONSULTANT_PACK } from "../src/lib/workflows/packs/consultant";
const byId = (id: string) => { const t = CONSULTANT_PACK.find((x) => x.id === id); if (!t || t.kind !== "calc") throw new Error(id); return t; };
for (const id of ["strat-market-sizing", "ops-pvm-decomposition", "fdd-nwc-peg", "turn-13-week-cash", "ops-zbb-savings", "ops-cost-to-serve", "cdd-nps-survey-stats", "cdd-benchmark-quartiles", "econ-lost-profits"]) {
  const t = byId(id);
  const out = t.compute(t.example ?? {});
  console.log(`\n=== ${id} (${out.blocks.length} blocks: ${out.blocks.map((b) => b.type).join(", ")})`);
  console.log(out.summary);
  const k = out.blocks.find((b) => b.type === "kpis");
  if (k && k.type === "kpis") console.log("KPIs: " + k.items.map((x) => `${x.label}=${x.value}`).join(" | "));
  // waterfall tie-out check
  for (const b of out.blocks) if (b.type === "waterfall") {
    let run = 0; const errs: string[] = [];
    for (const s of b.steps) { if (s.total) { if (Math.abs(s.value - run) > Math.max(1e-6, Math.abs(s.value) * 1e-9) && run !== 0) errs.push(`${s.label}: stated ${s.value.toFixed(2)} vs running ${run.toFixed(2)}`); run = s.value; } else run += s.value; }
    console.log(`  waterfall "${b.title}" tie-out: ${errs.length ? "MISMATCH " + errs.join("; ") : "ok"}`);
  }
  // empty-input behaviour
  try { const e = t.compute({}); console.log(`  empty inputs: returned ${e.blocks.length} blocks`); } catch (err) { console.log(`  empty inputs: threw "${(err as Error).message.slice(0, 80)}"`); }
}
