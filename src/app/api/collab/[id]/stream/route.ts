import { currentUser } from "@/lib/auth/user";
import { eventsSince, heartbeat, presenceFor, requireSession, type Presence } from "@/lib/collab/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Poll interval, and how long one connection lives before the browser reconnects. */
const TICK_MS = 1_200;
const LIFETIME_MS = 45_000;
/** Presence is a write, so check in less often than we read. */
const HEARTBEAT_EVERY = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream session events.
 *
 * Vercel cannot hold a socket open indefinitely, so this polls the append-only log and closes after
 * LIFETIME_MS. Each frame carries its event id, so the browser's EventSource reconnects with
 * Last-Event-ID and resumes exactly where it stopped; no event is missed across the gap.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("bad id", { status: 400 });
  try { await requireSession(user, id); }
  catch (e) { return new Response(e instanceof Error ? e.message : "Forbidden", { status: 403 }); }

  const url = new URL(req.url);
  const resume = Number(req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0);
  let cursor = Number.isFinite(resume) && resume > 0 ? resume : 0;

  const enc = new TextEncoder();
  let stop = false;

  const stream = new ReadableStream({
    async start(controller) {
      const frame = (eventId: number, type: string, data: unknown) => {
        try { controller.enqueue(enc.encode(`id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { stop = true; }
      };

      // Reconnect quickly after a planned close, rather than the browser's 3s default.
      try { controller.enqueue(enc.encode("retry: 700\n\n")); } catch { stop = true; }

      let lastPresence = "";
      const pushPresence = (p: Presence[]) => {
        const key = p.map((x) => `${x.userId}:${x.field}`).join("|");
        if (key !== lastPresence) { lastPresence = key; frame(cursor, "presence", p); }
      };

      pushPresence(await heartbeat(id, user).catch(() => [] as Presence[]));

      const deadline = Date.now() + LIFETIME_MS;
      for (let tick = 0; !stop && Date.now() < deadline; tick++) {
        try {
          for (const e of await eventsSince(id, cursor)) {
            cursor = e.id;
            frame(e.id, "change", { id: e.id, kind: e.kind, userId: e.userId, userName: e.userName, payload: e.payload });
          }
          pushPresence(tick % HEARTBEAT_EVERY === 0 ? await heartbeat(id, user) : await presenceFor(id));
        } catch {
          // A transient database error should not kill the session; the next tick retries.
        }
        await sleep(TICK_MS);
      }
      // Tell the client this was a planned close, not a failure.
      frame(cursor, "bye", { reason: "rotate" });
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() { stop = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
