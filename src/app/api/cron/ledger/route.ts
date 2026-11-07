import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { handled } from "@/lib/errors";
import { anchorAllLedgers } from "@/lib/ledger/anchor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily research-ledger anchors by email (src/lib/ledger/anchor.ts), from Vercel Cron with CRON_SECRET or AUTOPILOT_SECRET. */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => NextResponse.json({ ok: true, ...(await anchorAllLedgers(Date.now() + 270_000)) }));
}

export const GET = handle;
export const POST = handle;
