import { runChat, type ChatMessage } from "@/lib/ai/agent";
import { fitMessages, MAX_MESSAGE_CHARS } from "@/lib/ai/limits";
import { loadUserContext } from "@/lib/ai/persona";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "@/lib/auth/admin";
import { guardedDesktop } from "@/lib/desktop/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave headroom before the host function limit so the answer still streams out. */
const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS) || 235_000;

/**
 * Quick ask from the desktop app's floating window: the same assistant as the terminal's, with the
 * same tools, model settings and daily AI allowance, streamed as the same server-sent events. Only a
 * person typing a question starts it; the app never asks on its own. Free, like the assistant on the
 * site; it counts toward the person's AI limit like any other question.
 */
export async function POST(req: Request) {
  return guardedDesktop(req, async (user) => {
    const { persona, prefs } = await loadUserContext(user.id);
    const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; ticker?: string } | null;
    const all = (Array.isArray(body?.messages) ? body.messages : []).filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-20);
    if (all.length === 0 || all[all.length - 1].role !== "user") return Response.json({ error: "Type a question first." }, { status: 400 });
    if (all[all.length - 1].content.length > MAX_MESSAGE_CHARS) {
      return Response.json({ error: `That question is too long (over ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters). Shorten it, or open YouBank and ask in Studio.` }, { status: 413 });
    }
    const messages = fitMessages(all.map((m) => ({ role: m.role, content: m.content })));
    const context = { ticker: String(body?.ticker ?? "").toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 8), panels: [], subject: "", mode: "", persona };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (e: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
        // Attributed to the person explicitly, as the stream outlives the handler; closing the window stops the run between turns.
        try { await runAsUser(user.id, () => runChat({ messages, context, emit, prefs, deadline: Date.now() + BUDGET_MS, feature: "desktop-ask", parallelTools: true, signal: req.signal }), { admin: isAdmin(user) }); }
        catch { emit({ type: "error", message: "The answer stopped early. Try again in a moment." }); }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  }, { device: "required" });
}
