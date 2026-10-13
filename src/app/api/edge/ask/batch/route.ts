import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";
import { allowedOf, withFeatures } from "@/lib/billing/use";
import { requireEdge } from "@/lib/edge/access";
import { askDocuments, askWants, type AskPremium } from "@/lib/edge/docs/answer";
import { requireReady } from "@/lib/edge/premium";
import { describeFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** At most six companies: each answer reads that company's filings, and all must fit one function's time. */
const BATCH_MAX = 6;
/** Two at a time, so the first answers arrive while the others are read. */
const WORKERS = 2;

/**
 * Ask across companies (premium: edge.batch-ask): one question answered separately for each company
 * from its own filings, { question, tickers, mode, forms, months, premium? }. Each answer is a full
 * cited answer, saved like any other. The plan is checked before anything is read (402), as are any
 * premium options asked for. Lines of JSON stream back: { progress: { ticker, message } }, then for
 * each company { result: { ticker, answer } } or { failed: { ticker, error } }; companies the time did
 * not reach come back as { skipped: { ticker } } to ask again.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { question?: string; tickers?: string[]; mode?: string; forms?: string[]; months?: number; premium?: AskPremium } | null;
    const question = body?.question?.trim().slice(0, 2000) ?? "";
    const tickers = [...new Set((body?.tickers ?? []).map((t) => String(t).toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))].slice(0, BATCH_MAX);
    if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
    if (tickers.length < 2) return NextResponse.json({ error: "Add at least two companies to compare." }, { status: 400 });
    const premium = { model: body?.premium?.model === true, citations: body?.premium?.citations === true };
    const want = askWants(premium);
    const allowed = allowedOf(await entitlements(user), { auto: want.auto, require: ["edge.batch-ask", ...want.require] });
    for (const id of want.require) requireReady(id);
    await rateLimit(`edge-ask-batch:${user.id}`, 10, 3_600_000, "Several comparisons this hour; try again in a few minutes.");
    const mode = body?.mode === "strict" ? "strict" as const : "balanced" as const;
    const forms = (body?.forms ?? ["10-K", "10-Q", "8-K"]).map(String).slice(0, 6);
    const months = Math.max(1, Math.min(36, Number(body?.months) || 12));
    const deadline = Date.now() + 280_000;

    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: unknown) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the reader left */ } };
        const queue = [...tickers];
        const worker = async () => {
          for (let t = queue.shift(); t; t = queue.shift()) {
            // A company's first question reads its filings: a minute or two. Too little time left, and it waits for next time.
            if (Date.now() > deadline - 100_000 || req.signal.aborted) { send({ skipped: { ticker: t } }); continue; }
            const ticker = t;
            try {
              const answer = await askDocuments(user.id, { question, mode, form: "auto", premium, scope: { tickers: [ticker], sources: ["sec"], forms, months } }, {
                deadline: Math.min(deadline, Date.now() + 200_000), progress: async (message) => send({ progress: { ticker, message } }),
              });
              send({ result: { ticker, answer } });
            } catch (e) {
              send({ failed: { ticker, error: describeFailure(e, 500, "edge-ask-batch").message } });
            }
          }
        };
        await withFeatures(allowed, () => Promise.all(Array.from({ length: WORKERS }, worker)));
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  });
}
