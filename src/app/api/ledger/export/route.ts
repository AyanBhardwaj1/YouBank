import { guarded } from "@/lib/auth/user";
import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { exportHeader } from "@/lib/ledger/chain";
import { allEntries } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET: the whole ledger as JSON Lines, streamed a page at a time (an entry can hold a long answer), after
 * a header that says how to check the chain without YouBank.
 */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`ledger-export:${user.id}`, 20, 3_600_000, "The ledger was exported many times this hour. Try again later.");
    const now = new Date();
    const enc = new TextEncoder();
    const pages = allEntries(user.id);
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(`${JSON.stringify(exportHeader(user.email, now))}\n`)); },
      async pull(c) {
        try {
          const next = await pages.next();
          if (next.done) { c.close(); return; }
          c.enqueue(enc.encode(next.value.map((e) => `${JSON.stringify(e)}\n`).join("")));
        } catch (e) {
          logError(e, { where: "ledger.export" });
          c.error(e);
        }
      },
      async cancel() { await pages.return(undefined); },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-research-ledger-${now.toISOString().slice(0, 10)}.jsonl"`, "Cache-Control": "no-store" },
    });
  });
}
