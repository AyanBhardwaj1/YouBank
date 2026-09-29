import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { normalizeNewsPrefs } from "@/lib/news/prefs";
import { profileOf } from "@/lib/news/reader";
import { StoryPage } from "@/components/news/StoryPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Story" };

/** A story on its own page, in the reader's look. */
export default async function NewsStoryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const prefs = p ? normalizeNewsPrefs((p.extra as Record<string, unknown> | null)?.news, profileOf(p)) : null;
  return <StoryPage id={id} look={prefs?.look ?? "brief"} motion={prefs?.motion ?? "rich"} />;
}
