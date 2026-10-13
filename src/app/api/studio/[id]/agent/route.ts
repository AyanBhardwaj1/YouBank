import { lease } from "@/lib/locks";
import { requestUser } from "@/lib/office/auth";
import { runStudioAgent, type StudioStreamEvent } from "@/lib/studio/agent";
import { requireDoc } from "@/lib/studio/db";
import { errorResponse, handled, logError } from "@/lib/errors";
import { requireFeature } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run the agent on a document. The response is a stream of newline-delimited JSON events: every
 * patch the agent commits arrives here the moment it is stored, so the person watches the work
 * happen. Closing the request stops the agent between steps. One run per document at a time: two
 * agents editing the same model would fight over it and double the cost.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handled(() => start(req, ctx));
}

async function start(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requestUser(req);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try { await requireDoc(user, id, "edit"); } catch (e) { return errorResponse(e, 403); }
  const body = (await req.json().catch(() => null)) as { instruction?: string; effort?: "fast" | "balanced" | "thorough" | "deep"; selection?: { sheet?: string; range?: string }; history?: { role: "user" | "assistant"; content: string }[] } | null;
  const instruction = body?.instruction?.trim();
  if (!instruction) return Response.json({ error: "Say what to do" }, { status: 400 });
  // A deep build is premium: the plan is checked before the run starts (402 with a plain message).
  if (body?.effort === "deep") { try { await requireFeature(user, "studio.deep-build"); } catch (e) { return errorResponse(e); } }
  // Longer than this route's 300 s limit, so a run whose function died frees the document.
  const release = await lease(`studio-agent:${id}`, 330_000);
  if (!release) return Response.json({ error: "The agent is already working on this document. Wait for it to finish, or stop it first." }, { status: 409 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StudioStreamEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the reader went away */ } };
      try {
        await runStudioAgent({
          user, docId: id, instruction: instruction.slice(0, 8000), effort: body?.effort, selection: body?.selection,
          history: (body?.history ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
          emit, signal: req.signal,
        });
      } catch (e) {
        logError(e, { where: "studio-agent" });
        emit({ t: "error", message: "The agent could not start. Try again in a moment." });
      } finally {
        await release();
        try { controller.close(); } catch { /* closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
