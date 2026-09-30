import { runChat, type ChatMessage } from "@/lib/ai/agent";
import { modelAllowed } from "@/lib/ai/config";
import { fitMessages, MAX_MESSAGE_CHARS } from "@/lib/ai/limits";
import { currentUser } from "@/lib/auth/user";
import { loadUserContext } from "@/lib/ai/persona";
import { MODELS, type Effort } from "@/lib/ai/models";
import { runAsUser } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
/** Leave headroom before the host function limit so the answer still streams out. */
const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS) || 235_000;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { persona, prefs } = await loadUserContext(user.id);
  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; context?: { ticker?: string; panels?: string[]; subject?: string; mode?: string }; model?: string; effort?: string } | null;
  const all = (Array.isArray(body?.messages) ? body.messages : []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-40);
  if (all.length === 0 || all[all.length - 1].role !== "user") {
    return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  }
  if (all[all.length - 1].content.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: `That message is too long (over ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters). Shorten it, or open the document in Studio and ask there.` }, { status: 413 });
  }
  const messages = fitMessages(all.map((m) => ({ role: m.role, content: m.content })));
  const override = {
    model: body?.model && MODELS.some((m) => m.id === body.model) && modelAllowed(body.model) ? body.model : undefined,
    effort: body?.effort && EFFORTS.has(body.effort) ? (body.effort as Effort) : undefined,
  };
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
      await runAsUser(user.id, () => runChat({ messages, context, emit, prefs, override, deadline: Date.now() + BUDGET_MS, feature: "terminal-ai", parallelTools: true, signal: req.signal }));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
