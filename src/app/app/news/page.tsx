import { Newsroom } from "@/components/news/Newsroom";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsroom" };

const VIEWS = new Set(["today", "globe", "deals", "radar", "saved"]);

/**
 * The Newsroom: ?view=globe|deals|radar|saved|brief, ?story=<id> opens a story in the side peek, and
 * ?listen=1, ?cards=1 or ?recap=1 open the audio briefing, Brief mode or the recap (the bell's "your
 * audio briefing is ready" links to ?listen=1).
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const view = typeof p.view === "string" ? (p.view === "brief" ? "today" : p.view) : "today";
  const story = typeof p.story === "string" && /^\d+$/.test(p.story) ? Number(p.story) : null;
  const overlay = p.listen === "1" ? "listen" : p.cards === "1" ? "brief" : p.recap === "1" ? "recap" : null;
  return <Newsroom initialView={(VIEWS.has(view) ? view : "today") as "today" | "globe" | "deals" | "radar" | "saved"} initialStory={story} initialOverlay={overlay} />;
}
