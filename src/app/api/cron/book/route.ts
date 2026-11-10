import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { handled } from "@/lib/errors";
import { watchAllBooks } from "@/lib/book/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Book's daily check from Vercel Cron (CRON_SECRET or AUTOPILOT_SECRET bearer token), weekdays after
 * the US close: every person's book is checked again and what changed is sent (src/lib/book/watch.ts).
 * Free work only: filings, prices and the Newsroom, no AI.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => NextResponse.json({ ok: true, ...(await watchAllBooks(Date.now() + 270_000)) }));
}

export const GET = handle;
export const POST = handle;
