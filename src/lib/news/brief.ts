/**
 * The morning brief. One per desk per day, written once and shared by everyone on the desk: a title,
 * a two-sentence opener, and the six to nine stories that matter most, each in a line or two with why
 * it matters to the desk; the market watch and the week's calendar beside it. A person's brief adds a
 * "for you" section on top: stories on their watchlist, companies where their contacts work, and
 * what they follow. When the budget has paused briefs, it falls back to the stories' own summaries.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { allow } from "./budget";
import { calendarFor, marketWatch, type CalEvent, type WatchRow } from "./calendar";
import type { Desk } from "./desks";
import { localParts } from "./prefs";
import { rank, type Ranked, type Reader } from "./rank";
import { recentClusters, type ClusterRow } from "./store";

export type BriefItem = { clusterId: number; headline: string; lines: string[]; why: string; category: string; sources: number; tickers: string[] };
export type Brief = {
  desk: string; deskLabel: string; slot: string; title: string; intro: string; items: BriefItem[];
  watch: WatchRow[]; calendar: CalEvent[]; generatedAt: string; model: string;
};

// Lenient like the story reading: sizes are applied after parsing, not by the schema.
const Out = z.object({
  title: z.string().describe("4 to 9 words naming today's top story for this desk"),
  intro: z.string().describe("two sentences: the one thing to know today, then the overall tone for the desk"),
  picks: z.array(z.object({ id: z.number(), lines: z.array(z.string()).describe("one or two lines"), why: z.string() })).describe("six to nine picks, most important first"),
});

/** The desk's own view of the news: no personal boosts, just fit, importance and freshness. */
export const deskReader = (desk: Desk): Reader => ({ desk, watch: new Set<string>(), follows: { tickers: [], topics: [] }, mutes: { sources: [], topics: [] }, network: new Map() });

/** Today's date in New York: the slot a desk's morning brief belongs to. */
export const briefSlot = (at = new Date()) => localParts(at, "America/New_York").date;

function fallback(desk: Desk, picks: Ranked<ClusterRow>[]): Pick<Brief, "title" | "intro" | "items" | "model"> {
  return {
    title: `The ${desk.label} brief`, intro: "", model: "",
    items: picks.slice(0, 8).map((c) => ({
      clusterId: c.id, headline: c.headline, lines: (c.summary?.bullets ?? []).slice(0, 2), why: c.summary?.why ?? "", category: c.category, sources: c.sourceCount, tickers: c.tickers,
    })),
  };
}

/** A desk's brief for the slot: stored once, generated on first need. */
export async function deskBrief(desk: Desk, opts: { slot?: string; force?: boolean } = {}): Promise<Brief> {
  const slot = opts.slot ?? briefSlot();
  const db = requireDb();
  if (!opts.force) {
    const [row] = await db.select().from(schema.newsBriefs).where(and(eq(schema.newsBriefs.desk, desk.id), eq(schema.newsBriefs.kind, "morning"), eq(schema.newsBriefs.slot, slot)));
    if (row) return row.content as unknown as Brief;
  }
  const ranked = rank(deskReader(desk), await recentClusters(30, 700, 0.25)).filter((c) => c.score > 0.2).slice(0, 16);
  const [watch, calendar] = await Promise.all([
    marketWatch(desk.watch).catch(() => []),
    calendarFor(desk, desk.watch.map((w) => w.symbol).filter((s) => /^[A-Z]{1,5}$/.test(s))).catch(() => []),
  ]);
  let body = fallback(desk, ranked);
  if (ranked.length >= 3 && (await allow("brief"))) {
    const list = ranked.map((c) => `#${c.id} [${c.category}, ${c.sourceCount} source${c.sourceCount === 1 ? "" : "s"}] ${c.headline}${c.summary?.bullets?.length ? `\n  ${c.summary.bullets.join(" ")}` : ""}${c.summary?.why ? `\n  Why: ${c.summary.why}` : ""}`).join("\n");
    try {
      const r = await structured(Out, "news-brief",
        `You write the morning brief for ${desk.focus}. Pick the six to nine stories that matter most to this desk today from the candidates, most important first, and write each in one or two tight lines (facts from the candidate only), then one line on why it matters to this desk. Title and opener are specific, never generic. Plain words; no hype, no emojis.`,
        `Desk: ${desk.label}\nCandidates:\n${list}`, { task: "summarize", maxTokens: 2000, timeoutMs: 90_000 });
      const byId = new Map(ranked.map((c) => [c.id, c]));
      const items = r.data.picks.filter((p) => byId.has(p.id)).slice(0, 9).map((p) => {
        const c = byId.get(p.id)!;
        return { clusterId: c.id, headline: c.headline, lines: p.lines.map((l) => l.trim()).filter(Boolean).slice(0, 2), why: p.why.trim(), category: c.category, sources: c.sourceCount, tickers: c.tickers };
      });
      if (items.length >= 3) body = { title: r.data.title.trim(), intro: r.data.intro.trim(), items, model: r.model };
    } catch { /* the fallback stands */ }
  }
  const brief: Brief = { desk: desk.id, deskLabel: desk.label, slot, ...body, watch, calendar, generatedAt: new Date().toISOString() };
  if (brief.items.length) {
    await db.insert(schema.newsBriefs).values({ desk: desk.id, kind: "morning", slot, content: brief as unknown as Record<string, unknown>, model: brief.model })
      .onConflictDoUpdate({ target: [schema.newsBriefs.desk, schema.newsBriefs.kind, schema.newsBriefs.slot], set: { content: brief as unknown as Record<string, unknown>, model: brief.model, createdAt: new Date() } });
  }
  return brief;
}

/** The personal section: stories with a personal reason (watchlist, network, follows) from the last day and a half. */
export function forYou<T extends ClusterRow>(reader: Reader, clusters: T[], limit = 5): Ranked<T>[] {
  return rank(reader, clusters).filter((c) => c.reasons.some((r) => !r.startsWith("For your desk"))).slice(0, limit);
}
