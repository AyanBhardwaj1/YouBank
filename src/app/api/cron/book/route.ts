import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { handled } from "@/lib/errors";
import { watchAllBooks } from "@/lib/book/watch";
import { callWorker, cfOn } from "@/lib/cloudflare/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Book's daily check from Vercel Cron (CRON_SECRET or AUTOPILOT_SECRET bearer token), weekdays after
 * the US close: every person's book is checked again and what changed is sent (src/lib/book/watch.ts).
 * Free work only: filings, prices and the Newsroom, no AI. With CF_WORKER_URL set it starts the Cloudflare
 * Workflow instead (src/lib/cloudflare/worker.ts).
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => {
    // With the Workflow on Cloudflare, tonight's check runs there, each book a retried step of its own
    // (cloudflare/src/workflow.ts); if the Worker does not answer, the check runs here as before.
    if (cfOn("workflow")) {
      const started = await callWorker<{ id: string }>("/workflows/book", { at: new Date().toISOString() }, { timeoutMs: 10_000 });
      if (started?.id) return NextResponse.json({ ok: true, via: "cloudflare-workflow", instance: started.id });
    }
    return NextResponse.json({ ok: true, via: "inline", ...(await watchAllBooks(Date.now() + 270_000)) });
  });
}

export const GET = handle;
export const POST = handle;
