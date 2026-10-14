import { NextResponse } from "next/server";
import { runAsPlatform } from "@/lib/ai/context";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { requireEdge } from "@/lib/edge/access";
import { backfillSlice, backfillStatus, setState } from "@/lib/edge/deals/jobs";
import { sendJob } from "@/lib/edge/infra/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The deal database's backfill (E1, administrators). GET: whether reading is on and why, the day's ceiling
 * and spend, the cursor, how many deals wait unread. POST { on: true | false | null } switches it (null
 * hands the decision back to EDGE_BACKFILL_DAILY_USD); { run: true } runs a slice now (on Inngest when set
 * up, else in this request). Platform data: the spend is the platform's, never a person's allowance.
 */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators manage the deal backfill." }, { status: 403 });
    return NextResponse.json(await backfillStatus());
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators manage the deal backfill." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { on?: boolean | null; run?: boolean };
    if (body.on === true || body.on === false || body.on === null) await setState({ on: body.on, by: user.email, switchedAt: new Date().toISOString() });
    if (body.run) {
      const sent = await sendJob("edge/deals.backfill", { by: user.email }).catch(() => ({ sent: false as const, reason: "" }));
      // Platform spend: run outside the administrator's context so the day's ceiling (which counts unattributed
      // edge-deals-* usage) sees it, and it is not charged to their allowance.
      if (!sent.sent) return NextResponse.json({ ran: "inline", result: await runAsPlatform(() => backfillSlice(Date.now() + 260_000)), status: await backfillStatus() });
      return NextResponse.json({ ran: "queued", status: await backfillStatus() });
    }
    return NextResponse.json(await backfillStatus());
  });
}
