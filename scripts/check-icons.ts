/** Report tool icons that fall back to the sparkle: pnpm exec tsx scripts/check-icons.ts */
import { readFileSync } from "node:fs";
import { ALL_TOOL_DEFS } from "../src/lib/workflows/registry";

const src = readFileSync(new URL("../src/components/ui/Icon.tsx", import.meta.url), "utf8");
const block = src.slice(src.indexOf("const MAP"), src.indexOf("/** Icon by lucide name"));
const known = new Set([...block.matchAll(/([A-Za-z0-9_]+)\s*(?::|,)/g)].map((m) => m[1]));
const used = new Map<string, string[]>();
for (const t of ALL_TOOL_DEFS) used.set(t.icon, [...(used.get(t.icon) ?? []), t.id]);
const missing = [...used.entries()].filter(([name]) => !known.has(name));
console.log(`${ALL_TOOL_DEFS.length} tools, ${used.size} distinct icons, ${missing.length} unmapped`);
for (const [name, ids] of missing) console.log(`  ${name}: ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ` (+${ids.length - 4})` : ""}`);
