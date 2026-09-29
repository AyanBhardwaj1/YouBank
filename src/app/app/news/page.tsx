import { Newsroom } from "@/components/news/Newsroom";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsroom" };

const VIEWS = new Set(["today", "deals", "radar", "saved"]);

/** The Newsroom: ?view=deals|radar|saved|brief, ?story=<id> opens a story in the side peek. */
export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const view = typeof p.view === "string" ? (p.view === "brief" ? "today" : p.view) : "today";
  const story = typeof p.story === "string" && /^\d+$/.test(p.story) ? Number(p.story) : null;
  return <Newsroom initialView={(VIEWS.has(view) ? view : "today") as "today" | "deals" | "radar" | "saved"} initialStory={story} />;
}
