import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { companyOverview } from "@/lib/edge/overview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** One company across Edge (the Terminal's EDGE function): ?ticker=ET. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const p = await requireEdge(user.id);
    const ticker = (new URL(req.url).searchParams.get("ticker") ?? "").toUpperCase();
    if (!TICKER.test(ticker)) return NextResponse.json({ error: "Give a ticker." }, { status: 400 });
    return NextResponse.json(await companyOverview(user.id, p.prefs.blend, ticker), { headers: { "cache-control": "private, max-age=30" } });
  });
}
