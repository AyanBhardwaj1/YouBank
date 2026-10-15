import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { handled } from "@/lib/errors";
import { jobsReady } from "@/lib/edge/infra/jobs";
import { nightlyInline } from "@/lib/quant/nightly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The quant nightly pass from Vercel Cron (CRON_SECRET or AUTOPILOT_SECRET bearer token): with Inngest set up it
 * does nothing, because the quant-nightly function already runs on its own weekday schedule (sending
 * quant/nightly here as well would run the whole pass twice a weekday, and on weekends); without Inngest, it
 * runs the slices inline within the function's time. Free work only.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => {
    if (jobsReady()) return NextResponse.json({ ok: true, scheduled: "quant-nightly runs on the job runner's own schedule" });
    return NextResponse.json({ ok: true, inline: await nightlyInline(Date.now() + 270_000) });
  });
}

export const GET = handle;
export const POST = handle;
