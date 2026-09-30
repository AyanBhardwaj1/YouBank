import { notFound } from "next/navigation";
import { StoryView } from "@/components/edge/story/StoryView";
import { currentUser } from "@/lib/auth/user";
import { storyFor, type Section } from "@/lib/edge/story";
import { myTeams } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const user = await currentUser().catch(() => null);
  const story = await storyFor((await params).slug, user?.id ?? null).catch(() => null);
  return { title: story ? story.title : "Edge story", robots: { index: false } };
}

/** A published Edge story: its owner, their team when shared with it, or anyone with the link when published. */
export default async function StoryPage({ params }: Params) {
  const user = await currentUser().catch(() => null);
  const story = await storyFor((await params).slug, user?.id ?? null);
  if (!story) notFound();
  const owner = !!user && user.id === story.ownerId;
  const teams = owner ? (await myTeams(user.id)).map((t) => ({ id: t.id, name: t.name })) : [];
  return <StoryView story={{ slug: story.slug, title: story.title, createdAt: story.createdAt.toISOString(), sections: story.sections as Section[], visibility: story.visibility, teamId: story.teamId }} owner={owner} teams={teams} />;
}
