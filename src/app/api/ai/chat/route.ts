import { runChat, type ChatMessage } from "@/lib/ai/agent";
import { modelAllowed } from "@/lib/ai/config";
import { isAdmin } from "@/lib/auth/admin";
import { fitMessages, MAX_MESSAGE_CHARS } from "@/lib/ai/limits";
import { currentUser } from "@/lib/auth/user";
import { loadUserContext } from "@/lib/ai/persona";
import { MODELS, type Effort } from "@/lib/ai/models";
import { runAsUser } from "@/lib/ai/usage";
import { DEEP_EFFORT, DEEP_MAX_TURNS, DEEP_PROTOCOL, deepModel } from "@/lib/ai/deep";
import { contextBlock } from "@/lib/ai/prompts";
import { requireFeature } from "@/lib/billing/entitlements";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
/** Leave headroom before the host function limit so the answer still streams out. */
const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS) || 235_000;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { persona, prefs } = await loadUserContext(user.id);
  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; context?: { ticker?: string; panels?: string[]; subject?: string; mode?: string }; model?: string; effort?: string; deep?: boolean } | null;
  // Deep research is premium: the plan is checked before anything runs, and a plan without it gets its
  // message (402) to show in line.
  const deep = body?.deep === true;
  if (deep) { try { await requireFeature(user, "ai.deep-research"); } catch (e) { return errorResponse(e); } }
  const all = (Array.isArray(body?.messages) ? body.messages : []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-40);
  if (all.length === 0 || all[all.length - 1].role !== "user") {
    return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  }
  if (all[all.length - 1].content.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: `That message is too long (over ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters). Shorten it, or open the document in Studio and ask there.` }, { status: 413 });
  }
  const messages = fitMessages(all.map((m) => ({ role: m.role, content: m.content })));
  const chosen = body?.model && MODELS.some((m) => m.id === body.model) && modelAllowed(body.model) ? body.model : undefined;
  const override = deep
    ? { model: chosen ?? deepModel(prefs), effort: DEEP_EFFORT }
    : { model: chosen, effort: body?.effort && EFFORTS.has(body.effort) ? (body.effort as Effort) : undefined };
  const context = {
    ticker: String(body?.context?.ticker ?? "").toUpperCase().slice(0, 8),
    panels: (Array.isArray(body?.context?.panels) ? body.context.panels : []).slice(0, 8).map((p) => String(p).slice(0, 80)),
    subject: String(body?.context?.subject ?? "").slice(0, 300),
    mode: String(body?.context?.mode ?? "").slice(0, 40),
    persona,
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
      // Closing the chat stops the run between turns.
      await runAsUser(user.id, () => runChat({
        messages, context, emit, prefs, override, deadline: Date.now() + BUDGET_MS, parallelTools: true, signal: req.signal,
        ...(deep ? { feature: "ai.deep-research", maxTurns: DEEP_MAX_TURNS, volatile: `${contextBlock(context)}\n\n${DEEP_PROTOCOL}` } : { feature: "terminal-ai" }),
      }), { admin: isAdmin(user) });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
