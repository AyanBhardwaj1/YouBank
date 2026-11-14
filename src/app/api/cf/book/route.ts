import { NextResponse } from "next/server";
import { fromWorker } from "@/lib/cloudflare/worker";
import { handled, logError } from "@/lib/errors";
import { warmFilings, warmInsiders } from "@/lib/book/store";
import { bookPlan, warmRisk, watchBook } from "@/lib/book/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const tickers = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && TICKER.test(t)).slice(0, 500) : []);

/**
 * POST { action } — one step of the nightly kill-criteria Workflow (cloudflare/src/workflow.ts). Each step is
 * small and safe to repeat, so the Workflow can retry it alone:
 * - plan: whose books, which tickers need insider selling, which need new 10-Qs and 10-Ks;
 * - insiders { tickers } / filings { tickers }: fetch them once for every book;
 * - check { userId }: re-check one book's kill criteria, send what changed to Needs you, and warm its risk;
 * - risk { userId }: warm that book's risk alone.
 */
export async function POST(req: Request) {
  if (!fromWorker(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => {
    const b = (await req.json().catch(() => ({}))) as { action?: unknown; userId?: unknown; tickers?: unknown };
    const userId = typeof b.userId === "string" && /^[\w-]{1,80}$/.test(b.userId) ? b.userId : "";
    switch (b.action) {
      case "plan": return NextResponse.json(await bookPlan());
      case "insiders": return NextResponse.json({ done: await warmInsiders(tickers(b.tickers), Date.now() + 250_000) });
      case "filings": return NextResponse.json({ done: await warmFilings(tickers(b.tickers), Date.now() + 250_000) });
      case "check": {
        if (!userId) return NextResponse.json({ error: "Whose book?" }, { status: 400 });
        const alerts = (await watchBook(userId)).length;
        // Today's risk for the book, ready for the risk panel, the report and MCP (a warm-up: never fails the step).
        const risk = await warmRisk(userId).catch((e) => { logError(e, { where: "cf-book-risk" }); return false; });
        return NextResponse.json({ alerts, risk });
      }
      case "risk": return userId ? NextResponse.json({ ran: await warmRisk(userId) }) : NextResponse.json({ error: "Whose book?" }, { status: 400 });
      default: return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    }
  });
}
