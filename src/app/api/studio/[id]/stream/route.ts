import { currentUser } from "@/lib/auth/user";
import { follow, resumeFrom, sseStream, streamGate } from "@/lib/realtime/feed";
import { changesSince, docFeed, requireDocAccess } from "@/lib/studio/db";

export const dynamic = "force-dynamic";
/** Longer than a connection's two-minute life. */
export const maxDuration = 150;

/**
 * Everyone else's edits, as they happen: the append-only event log over SSE. Each frame carries its
 * event id, so a reconnect with Last-Event-ID resumes exactly where the last connection stopped.
 * Connections on one document share a poll whose pace follows activity (see lib/realtime/feed).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return streamGate(() => open(req, ctx));
}

async function open(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("bad id", { status: 400 });
  await requireDocAccess(user, id);
  let cursor = resumeFrom(req);
  return sseStream(req, (frame) => follow(docFeed(id), cursor, async (since) => ({ events: await changesSince(id, since) }), ({ events }) => {
    for (const e of events) {
      cursor = e.id;
      frame(e.id, "change", { id: e.id, actor: e.actor, actorName: e.actorName, runId: e.runId, label: e.label, patches: e.patches, at: e.createdAt });
    }
  }), () => cursor);
}
