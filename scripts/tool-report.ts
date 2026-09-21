/** Coverage report for the tool system: pnpm exec tsx scripts/tool-report.ts */
import { ALL_TOOL_DEFS, toolsForRole, toolsFor } from "../src/lib/workflows/registry";
import { ROLES, ROLE_IDS } from "../src/lib/roles";

const ai = ALL_TOOL_DEFS.filter((t) => t.kind === "ai").length;
console.log(`TOTAL ${ALL_TOOL_DEFS.length} tools: ${ai} AI workflows, ${ALL_TOOL_DEFS.length - ai} calculators`);
console.log(`Minutes claimed saved per full pass: ${ALL_TOOL_DEFS.reduce((a, t) => a + (t.savesMinutes ?? 0), 0).toLocaleString()}\n`);
console.log("BY ROLE");
for (const r of ROLE_IDS) {
  const list = toolsForRole(r);
  const aiN = list.filter((t) => t.kind === "ai").length;
  const specs = ROLES[r].specialties.map((s) => `${s}:${toolsFor({ role: r, specialty: s }).filter((t) => t.specialties?.includes(s)).length}`);
  console.log(`  ${ROLES[r].label.padEnd(22)} ${String(list.length).padStart(3)} (${aiN} ai / ${list.length - aiN} calc)  ${specs.join(" · ")}`);
}
const byCat = new Map<string, number>();
for (const t of ALL_TOOL_DEFS) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
console.log("\nBY CATEGORY");
for (const [c, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(24)} ${n}`);
