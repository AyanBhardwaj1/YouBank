import { z } from "zod";
import { aiUser } from "./context";
import { def, type ToolDef } from "./tools";
import { withinRate } from "@/lib/locks";

/**
 * What a company changed in its latest 10-K (or 10-Q) against the one before, for the chat: Edge's change
 * radar (src/lib/edge/docs/changes.ts), which matches paragraphs by their word sequences, so new, dropped
 * and reworded passages are found, not only edits. Research item E1 ("Lazy Prices": how much a filing
 * changes is itself informative). Shares the radar's per-person budget of 30 comparisons an hour.
 */
export const filingChangesTool = def({
  name: "filing_changes",
  description: "Compare a company's latest 10-K (or 10-Q) with the previous one in a section (risk factors, MD&A, or the whole filing): counts of added, removed and reworded paragraphs, the most important changes quoted, and links to both filings. Use for 'what changed in the 10-K', new risks, dropped language.",
  schema: z.object({
    ticker: z.string().min(1).max(10),
    form: z.enum(["10-K", "10-Q"]).default("10-K"),
    section: z.enum(["risk", "mdna", "all"]).default("risk").describe("risk = Risk Factors, mdna = MD&A, all = the whole filing"),
  }),
  run: async ({ ticker, form, section }, ctx) => {
    const user = aiUser();
    if (user && !(await withinRate(`edge-radar:${user}`, 30, 3_600_000))) return JSON.stringify({ error: "Many filing comparisons this hour; try again later." });
    // Loaded here, not at the top: changes.ts imports the agent, which imports this file.
    const { changeRadar } = await import("@/lib/edge/docs/changes");
    const r = await changeRadar(ticker, form, section);
    if (!r.current || !r.prior) return JSON.stringify({ ticker: r.ticker, note: r.summary[0] ?? "There are not two filings to compare." });
    const cur = ctx.addSource(`${r.ticker} ${r.form} filed ${r.current.filed}`, r.current.url);
    const prev = ctx.addSource(`${r.ticker} ${r.form} filed ${r.prior.filed}`, r.prior.url);
    const total = r.counts.added + r.counts.removed + r.counts.changed + r.counts.unchanged;
    const clip = (s: string) => (s.length > 360 ? `${s.slice(0, 359)}…` : s);
    return JSON.stringify({
      ticker: r.ticker, name: r.name, form: r.form, section: r.section,
      current: { filed: r.current.filed, source: cur }, prior: { filed: r.prior.filed, source: prev },
      counts: r.counts,
      share_changed: total ? Math.round(((r.counts.added + r.counts.removed + r.counts.changed) / total) * 1000) / 10 : null,
      summary: r.summary,
      added: r.rows.filter((x) => x.status === "added").slice(0, 5).map((x) => ({ text: clip(x.text), source: cur })),
      removed: r.rows.filter((x) => x.status === "removed").slice(0, 4).map((x) => ({ text: clip(x.text), source: prev })),
      reworded: r.rows.filter((x) => x.status === "changed").slice(0, 4).map((x) => ({ now: clip(x.text), before: clip(x.before ?? ""), similarity: Math.round(x.similarity * 100) / 100 })),
      note: "Quote changed language with the source id of the filing it is from.",
    });
  },
}) as unknown as ToolDef<unknown>;
