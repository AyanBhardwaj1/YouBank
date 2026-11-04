import { z } from "zod";
import { TOOL_CATALOG } from "@/lib/workflows/catalog";
import { rank } from "@/lib/palette";
import { siteLink } from "@/lib/site";
import { def, type ToolDef } from "./tools";

/**
 * Tool search over YouBank's own catalogue (every AI workflow and calculator), so a chat answer can hand
 * the person the right tool instead of approximating it: "Open the LBO model with these inputs". Ranked
 * by the command palette's matcher over the title, tagline, tags and category; nothing is run.
 */
export function findTools(query: string, limit = 6) {
  const items = TOOL_CATALOG.map((t) => ({ id: t.id, label: t.title, group: "Tools" as const, icon: t.icon, keywords: `${t.tagline} ${(t.tags ?? []).join(" ")} ${t.category} ${t.pack}`, t }));
  // Each word on its own too, so "merger accretion model" still finds "Accretion / dilution".
  const hits = rank(items, query, limit);
  const more = hits.length < limit ? query.split(/\s+/).filter((w) => w.length > 3).flatMap((w) => rank(items, w, limit)) : [];
  const seen = new Set<string>();
  return [...hits, ...more].filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, limit).map(({ t }) => ({
    title: t.title, kind: t.kind === "ai" ? "AI workflow" : "calculator", what: t.tagline, category: t.category,
    saves: t.savesMinutes ? `about ${t.savesMinutes >= 60 ? `${Math.round(t.savesMinutes / 60)}h` : `${t.savesMinutes}m`}` : undefined,
    link: siteLink(`/app/tools/${t.id}`),
  }));
}

export const findToolsTool = def({
  name: "find_tools",
  description: "Search YouBank's catalogue of AI workflows and calculators (LBO, DCF, accretion/dilution, cap tables, 13-week cash flow, diligence checklists, memos and hundreds more). Use it when the person would be better served by running a dedicated tool, or asks what YouBank can do for a task. Returns titles, what each does and a link to open it.",
  schema: z.object({ query: z.string().min(2).max(200).describe("The task in a few words, e.g. 'merger accretion', 'cash flow forecast'") }),
  run: async ({ query }) => {
    const hits = findTools(query);
    return JSON.stringify(hits.length ? { tools: hits, note: "Link the one that fits as a markdown link with its title." } : { tools: [], note: "Nothing in the catalogue matches; answer directly." });
  },
}) as unknown as ToolDef<unknown>;
