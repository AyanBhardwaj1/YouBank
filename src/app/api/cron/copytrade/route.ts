import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { copyTick } from "@/lib/copytrade/ingest";
import { handled } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The copy-trading pass (lib/copytrade/ingest): new 13Fs from EDGAR, alerts to followers, paper copies
 * rebalanced, notices for live copies (never trades), order statuses refreshed. Every 15 minutes from the
 * Neon heartbeat (neon/copytrade.ts) and once a day from Vercel Cron, with the CRON_SECRET or
 * AUTOPILOT_SECRET bearer token. Free work only.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => NextResponse.json({ ok: true, ...(await copyTick(Date.now() + 270_000)) }));
}

export const GET = handle;
export const POST = handle;
