import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { premiumScope } from "@/lib/billing/use";
import { requireEdge } from "@/lib/edge/access";
import { comparePeers } from "@/lib/edge/calls/peers";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Compare up to six companies' latest calls and promises (premium edge.calls-peers): POST { tickers }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await requireFeature(user, "edge.calls-peers");
    const body = (await req.json().catch(() => ({}))) as { tickers?: unknown };
    const tickers = [...new Set((Array.isArray(body.tickers) ? body.tickers : []).map((t) => String(t).trim().toUpperCase()).filter((t) => TICKER.test(t)))].slice(0, 6);
    if (tickers.length < 2) return NextResponse.json({ error: "Name two to six companies to compare." }, { status: 400 });
    await rateLimit(`edge-calls-peers:${user.id}`, 20, 3_600_000, "Twenty comparisons this hour. Try again later.");
    return NextResponse.json(await premiumScope(user, { require: ["edge.calls-peers"] }, () => comparePeers(user.id, tickers)));
  });
}
