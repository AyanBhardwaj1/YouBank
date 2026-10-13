import { currentUser } from "@/lib/auth/user";
import { storyFor, storyPptx } from "@/lib/edge/story";
import { describeFailure } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The story as PowerPoint, for anyone who can read it. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  // A download link: the failure is plain text a person can read in the tab.
  try { return await build(req, ctx); }
  catch (e) { const f = describeFailure(e, 500, "story-pptx"); return new Response(f.message, { status: f.status }); }
}

async function build(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await currentUser().catch(() => null);
  const story = await storyFor((await ctx.params).slug, user?.id ?? null);
  if (!story) return new Response("Not found", { status: 404 });
  const buf = await storyPptx(story);
  const name = story.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "edge-story";
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${name}.pptx"`, "cache-control": "private, no-store" } });
}
