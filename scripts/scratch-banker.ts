import { BANKER_PACK } from "../src/lib/workflows/packs/banker";
for (const id of ["ma-accretion-dilution", "rx-recovery-waterfall", "ecm-spac-economics", "dcm-bond-math"]) {
  const t = BANKER_PACK.find((x) => x.id === id);
  if (!t || t.kind !== "calc") continue;
  const out = t.compute(t.example ?? {});
  console.log(`\n=== ${id}`);
  console.log(out.summary);
  const k = out.blocks.find((b) => b.type === "kpis");
  if (k && k.type === "kpis") console.log("KPIs: " + k.items.map((x) => `${x.label}=${x.value}`).join(" | "));
  const c = out.blocks.find((b) => b.type === "callout");
  if (c && c.type === "callout") console.log("Callout: " + c.text.slice(0, 260));
}
