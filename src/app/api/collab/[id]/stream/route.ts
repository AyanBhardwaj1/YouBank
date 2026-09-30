import { currentUser } from "@/lib/auth/user";
import { eventsSince, heartbeat, presenceFor, requireSessionAccess, sessionFeed, type Presence } from "@/lib/collab/db";
import { follow, resumeFrom, sseStream } from "@/lib/realtime/feed";

export const dynamic = "force-dynamic";
/** Longer than a connection's two-minute life. */
export const maxDuration = 150;

/** Presence is a write, so each connection checks in on its own slower timer (the window is 40 s). */
const HEARTBEAT_MS = 15_000;

/**
 * Stream session events and who is here.
 *
 * Vercel cannot hold a socket open indefinitely, so this follows the append-only log by polling and
 * closes after a while. Each frame carries its event id, so the browser's EventSource reconnects with
 * Last-Event-ID and resumes exactly where it stopped; no event is missed across the gap. Connections on
 * one session share a poll whose pace follows activity (see lib/realtime/feed).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("bad id", { status: 400 });
  try { await requireSessionAccess(user, id); } catch { return new Response("Forbidden", { status: 403 }); }
  let cursor = resumeFrom(req);

  return sseStream(req, (frame) => {
    let lastPresence = "";
    const pushPresence = (p: Presence[]) => {
      const key = p.map((x) => `${x.userId}:${x.field}`).join("|");
      if (key !== lastPresence) { lastPresence = key; frame(cursor, "presence", p); }
    };
    const checkIn = () => { heartbeat(id, user).then(pushPresence, () => undefined); };
    checkIn();
    const timer = setInterval(checkIn, HEARTBEAT_MS);
    const stop = follow<Awaited<ReturnType<typeof eventsSince>>[number], Presence[]>(sessionFeed(id), cursor,
      async (since) => {
        const [events, presence] = await Promise.all([eventsSince(id, since), presenceFor(id)]);
        return { events, extra: presence };
      },
      ({ events, extra }) => {
        for (const e of events) {
          cursor = e.id;
          frame(e.id, "change", { id: e.id, kind: e.kind, userId: e.userId, userName: e.userName, payload: e.payload });
        }
        if (extra) pushPresence(extra);
      });
    return () => { clearInterval(timer); stop(); };
  }, () => cursor);
}
