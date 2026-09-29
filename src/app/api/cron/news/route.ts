import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { tick } from "@/lib/news/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Newsroom heartbeat, every ten minutes (a Neon Function schedule, as for autopilot, since Vercel's
 * Hobby plan runs cron once a day). Polls due sources, clusters, reads, alerts, briefs, delivers.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await tick(new URL(req.url).origin, 250_000);
  return NextResponse.json({ ok: true, ...report });
}

export const GET = handle;
export const POST = handle;
