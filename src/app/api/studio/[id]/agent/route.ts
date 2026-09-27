import { currentUser } from "@/lib/auth/user";
import { runStudioAgent, type StudioStreamEvent } from "@/lib/studio/agent";
import { requireDoc } from "@/lib/studio/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run the agent on a document. The response is a stream of newline-delimited JSON events: every
 * patch the agent commits arrives here the moment it is stored, so the person watches the work
 * happen. Closing the request stops the agent between steps.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try { await requireDoc(user, id, "edit"); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Forbidden" }, { status: 403 }); }
  const body = (await req.json().catch(() => null)) as { instruction?: string; effort?: "fast" | "balanced" | "thorough"; selection?: { sheet?: string; range?: string }; history?: { role: "user" | "assistant"; content: string }[] } | null;
  const instruction = body?.instruction?.trim();
  if (!instruction) return Response.json({ error: "Say what to do" }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StudioStreamEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the reader went away */ } };
      await runStudioAgent({
        user, docId: id, instruction: instruction.slice(0, 8000), effort: body?.effort, selection: body?.selection,
        history: (body?.history ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
        emit, signal: req.signal,
      });
      try { controller.close(); } catch { /* closed */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
