import { currentUser } from "@/lib/auth/user";
import { eventsSince, requireDoc } from "@/lib/studio/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICK_MS = 600;
const LIFETIME_MS = 45_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Everyone else's edits, as they happen: the append-only event log over SSE. Each frame carries its
 * event id, so a reconnect with Last-Event-ID resumes exactly where the last connection stopped.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("bad id", { status: 400 });
  try { await requireDoc(user, id); } catch (e) { return new Response(e instanceof Error ? e.message : "Forbidden", { status: 403 }); }
  const url = new URL(req.url);
  const resume = Number(req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0);
  let cursor = Number.isFinite(resume) && resume > 0 ? resume : 0;
  const enc = new TextEncoder();
  let stop = false;
  const stream = new ReadableStream({
    async start(controller) {
      const frame = (eventId: number, type: string, data: unknown) => {
        try { controller.enqueue(enc.encode(`id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { stop = true; }
      };
      try { controller.enqueue(enc.encode("retry: 600\n\n")); } catch { stop = true; }
      const deadline = Date.now() + LIFETIME_MS;
      while (!stop && Date.now() < deadline && !req.signal.aborted) {
        try {
          for (const e of await eventsSince(id, cursor)) {
            cursor = e.id;
            frame(e.id, "change", { id: e.id, actor: e.actor, actorName: e.actorName, runId: e.runId, label: e.label, patches: e.patches, at: e.createdAt });
          }
        } catch { /* a transient database error: the next tick retries */ }
        await sleep(TICK_MS);
      }
      frame(cursor, "bye", { reason: "rotate" });
      try { controller.close(); } catch { /* closed */ }
    },
    cancel() { stop = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}
