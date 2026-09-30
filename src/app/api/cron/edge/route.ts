import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { scanDeals } from "@/lib/edge/dealwatch";
import { checkDue } from "@/lib/edge/watches";
import { describeFailure } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Edge's daily pass, triggered by Vercel Cron with the CRON_SECRET bearer token: refresh the asset maps
 * (weekly), look at every watched company and place not checked in the last day (each distinct target
 * once, least recently checked first), then build pro-forma cards for new deals that touch the map.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + 270_000;
  try {
    const watches = await checkDue(deadline - 60_000);
    const deals = await scanDeals(deadline - 10_000);
    return NextResponse.json({ ok: true, watches, deals: deals.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: describeFailure(e, 500, "edge-cron").message }, { status: 500 });
  }
}
