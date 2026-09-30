import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { runView } from "@/lib/edge/canvas/engine";
import { composeSections, createStory, storiesOf } from "@/lib/edge/story";

export const dynamic = "force-dynamic";

/** The person's stories. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    return NextResponse.json({ stories: (await storiesOf(user.id)).map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), url: `/story/${s.slug}` })) });
  });
}

/** Make a story from a finished run: { runId, title? }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => ({}))) as { runId?: number; title?: string };
    const run = await runView(user, Number(body.runId), true);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const values = run.steps.flatMap((s) => Object.values(s.output ?? {}));
    const sections = composeSections(values);
    if (!sections.length) return NextResponse.json({ error: "This run has nothing a story can show yet." }, { status: 400 });
    const story = await createStory(user.id, { title: (body.title ?? "").trim() || sections.find((s) => s.kind === "memo")?.title || sections[0].title, runId: Number(body.runId), sections });
    return NextResponse.json({ slug: story.slug, url: `/story/${story.slug}` });
  });
}
