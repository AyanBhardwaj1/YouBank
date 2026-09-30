import { currentUser } from "@/lib/auth/user";
import { storyFor, storyPptx } from "@/lib/edge/story";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The story as PowerPoint, for anyone who can read it. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await currentUser().catch(() => null);
  const story = await storyFor((await ctx.params).slug, user?.id ?? null);
  if (!story) return new Response("Not found", { status: 404 });
  const buf = await storyPptx(story);
  const name = story.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "edge-story";
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${name}.pptx"`, "cache-control": "private, no-store" } });
}
