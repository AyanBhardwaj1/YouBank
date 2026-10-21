import { Newsroom, type NewsroomSeed } from "@/components/news/Newsroom";
import { currentUser } from "@/lib/auth/user";
import { profileRow } from "@/lib/auth/profile-row";
import { allDesks, deskFor } from "@/lib/news/desks";
import { normalizeNewsPrefs, publicPrefs } from "@/lib/news/prefs";
import { profileOf } from "@/lib/news/reader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsroom" };

const VIEWS = new Set(["today", "globe", "deals", "radar", "saved"]);

/**
 * What the Newsroom's header and edition need before the feed arrives (the desk's name, the person's
 * edition and layout), from the profile row the workspace layout already reads in this request. With it
 * the first paint has the right desk and look, and nothing moves when the feed lands.
 */
async function seedFor(): Promise<NewsroomSeed | null> {
  try {
    const user = await currentUser();
    const p = user ? await profileRow(user.id) : undefined;
    if (!p) return null;
    const profile = profileOf(p);
    const prefs = normalizeNewsPrefs(((p.extra ?? {}) as Record<string, unknown>).news, profile);
    const own = deskFor(profile);
    const desk = (prefs.desk && allDesks().find((d) => d.id === prefs.desk)) || own;
    return { desk: { id: desk.id, label: desk.label }, ownDeskId: own.id, prefs: publicPrefs(prefs) };
  } catch {
    return null;
  }
}

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
  return <Newsroom initialView={(VIEWS.has(view) ? view : "today") as "today" | "globe" | "deals" | "radar" | "saved"} initialStory={story} initialOverlay={overlay} seed={await seedFor()} />;
}
