import type { Metadata } from "next";
import { PublicIndex } from "@/components/news/public/PublicNews";
import { publicStories, SITE } from "@/lib/news/public";

export const metadata: Metadata = {
  title: "Newsroom: what moved markets and deals today",
  description: "The day's most important finance stories from about ninety free sources, filings and regulators, each with its numbers, chart, timeline and sources. Free from YouBank.",
  alternates: { canonical: `${SITE}/news` },
  openGraph: { type: "website", url: `${SITE}/news`, title: "YouBank Newsroom", description: "What moved markets and deals today, with the numbers, charts and every source." },
};

/** The public front of the Newsroom: the last day's most important stories, for anyone. */
export default async function PublicNewsPage() {
  const stories = await publicStories(36, 40, 0.35);
  // eslint-disable-next-line react-hooks/purity -- a server render's clock, passed down so the client renders the same relative times
  return <PublicIndex stories={stories} now={Date.now()} />;
}
