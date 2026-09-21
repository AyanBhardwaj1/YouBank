/** Validate a tool pack: pnpm exec tsx scripts/test-pack.ts <role|all> */
import { ALL_TOOL_DEFS } from "../src/lib/workflows/registry";
import { WorkflowOutput, type ToolDef } from "../src/lib/workflows/types";

const role = process.argv[2] ?? "all";
const tools: ToolDef[] = role === "all" ? ALL_TOOL_DEFS : ALL_TOOL_DEFS.filter((t) => t.roles === "all" || t.roles.includes(role as never));
const ids = new Map<string, number>();
for (const t of ALL_TOOL_DEFS) ids.set(t.id, (ids.get(t.id) ?? 0) + 1);
const dupes = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id);
let failures = 0;
if (dupes.length) { console.error(`DUPLICATE IDS: ${dupes.join(", ")}`); failures++; }
for (const t of tools) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) { console.error(`${t.id}: id must be kebab-case`); failures++; }
  if (!t.tagline || !t.description || !t.icon || !t.category) { console.error(`${t.id}: missing tagline/description/icon/category`); failures++; }
  if (t.kind === "ai") {
    if (t.instructions.length < 200) { console.error(`${t.id}: instructions too thin (${t.instructions.length} chars)`); failures++; }
    try { const p = t.prompt(t.example ?? {}); if (!p || p.length < 10) throw new Error("empty prompt"); } catch (e) { console.error(`${t.id}: prompt() threw: ${(e as Error).message}`); failures++; }
  } else {
    try {
      const out = t.compute(t.example ?? Object.fromEntries(t.fields.map((f) => [f.key, f.default])));
      const parsed = WorkflowOutput.safeParse(out);
      if (!parsed.success) { console.error(`${t.id}: output schema invalid: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`); failures++; }
      else if (out.blocks.length < 2) { console.error(`${t.id}: fewer than 2 blocks`); failures++; }
    } catch (e) { console.error(`${t.id}: compute threw on example: ${(e as Error).message}`); failures++; }
    try { t.compute({}); } catch { /* throwing on empty inputs is acceptable */ }
  }
}
const ai = tools.filter((t) => t.kind === "ai").length, calc = tools.length - ai;
console.log(`${role}: ${tools.length} tools (${ai} AI workflows, ${calc} calculators), ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
