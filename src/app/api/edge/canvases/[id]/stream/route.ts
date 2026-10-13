import { currentUser } from "@/lib/auth/user";
import { canvasAccess, canvasChanges, canvasFeed } from "@/lib/edge/canvas/store";
import { follow, resumeFrom, sseStream, streamGate } from "@/lib/realtime/feed";

export const dynamic = "force-dynamic";
/** Longer than a connection's two-minute life. */
export const maxDuration = 150;

/**
 * Everyone else's changes to a canvas as they happen (saves, runs starting and finishing, checkpoints),
 * over SSE. Each frame carries its event id, so a reconnect resumes where the last one stopped.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return streamGate(() => open(req, ctx));
}

async function open(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("bad id", { status: 400 });
  await canvasAccess(user, id, "view");
  let cursor = resumeFrom(req);
  return sseStream(req, (frame) => follow(canvasFeed(id), cursor, async (since) => ({ events: await canvasChanges(id, since) }), ({ events }) => {
    for (const e of events) {
      cursor = e.id;
      frame(e.id, e.kind, { id: e.id, kind: e.kind, userId: e.userId, label: e.label, version: e.version, payload: e.payload, at: e.createdAt });
    }
  }), () => cursor);
}
