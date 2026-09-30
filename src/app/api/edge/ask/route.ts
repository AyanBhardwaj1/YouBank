import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { askDocuments, type AskInput } from "@/lib/edge/docs/answer";
import { describeFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES = ["sec", "uploads", "audio", "workspace", "newsroom", "web"];

/**
 * Ask the documents: { question, mode: strict|balanced, form, scope: { tickers, sources, forms, months,
 * docIds } }. The answer streams as lines of JSON: { progress } while sources are read and passages
 * found, then { answer } (or { error }).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as AskInput | null;
    if (!body?.question?.trim()) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
    await rateLimit(`edge-ask:${user.id}`, 40, 3_600_000, "Many questions this hour; try again in a few minutes.");
    const scope = body.scope ?? {};
    const clean: AskInput = {
      question: body.question.slice(0, 2000), mode: body.mode === "balanced" ? "balanced" : "strict",
      form: (["direct", "table", "timeline", "memo"] as const).find((f) => f === body.form) ?? "auto",
      scope: {
        tickers: (scope.tickers ?? []).map((t) => String(t).toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, 6),
        sources: (scope.sources ?? []).filter((s) => SOURCES.includes(s)),
        forms: (scope.forms ?? []).map(String).slice(0, 6), months: Math.max(1, Math.min(36, Number(scope.months) || 12)),
        docIds: (scope.docIds ?? []).map(Number).filter(Number.isInteger).slice(0, 200),
      },
    };
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: unknown) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the reader left */ } };
        try {
          const answer = await askDocuments(user.id, clean, { deadline: Date.now() + 270_000, progress: async (m) => send({ progress: m }) });
          send({ answer });
        } catch (e) {
          send({ error: describeFailure(e, 500, "edge-ask").message });
        }
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  });
}
