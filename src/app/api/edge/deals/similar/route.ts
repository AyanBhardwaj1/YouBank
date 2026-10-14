import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { buildQuery } from "@/lib/edge/deals/query";
import { bandSentence } from "@/lib/edge/deals/range";
import { similarDeals, type DealFilters } from "@/lib/edge/deals/store";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * "Deals like this one" (E1, free): { ticker | dealId | text, buyerType?, filters?, k? }. Ranked precedents
 * with why each matched, the trimmed median and IQR of their multiples, and the split-conformal 80% band
 * with its tested coverage.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await rateLimit(`edge-deals-similar:${user.id}`, 60, 3_600_000, "Many searches this hour. Try again shortly.");
    const body = (await req.json().catch(() => ({}))) as { ticker?: string; dealId?: number; text?: string; buyerType?: string; filters?: DealFilters; k?: number };
    const ticker = String(body.ticker ?? "").toUpperCase();
    const q = await buildQuery({ dealId: Number(body.dealId) || undefined, ticker: TICKER.test(ticker) ? ticker : undefined, text: typeof body.text === "string" ? body.text.slice(0, 600) : undefined, buyerType: body.buyerType });
    if (!q) return NextResponse.json({ error: "Give a ticker, a deal or a sentence to compare with." }, { status: 400 });
    const f = body.filters ?? {};
    const r = await similarDeals(q, { sic: f.sic, from: f.from, to: f.to, buyer: f.buyer, consideration: f.consideration, min: f.min, max: f.max }, Math.max(5, Math.min(50, Number(body.k) || 20)));
    return NextResponse.json({ ...r, bandText: bandSentence(r.range.band) });
  });
}
