import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { memo } from "@/lib/memo";
import { rateLimit } from "@/lib/locks";
import { NO_STORE } from "@/lib/predict/http";
import { marketLabel } from "@/lib/predict/normalize";
import { matchAcross, MATCH_MIN } from "@/lib/predict/match";
import { annualised, daysToClose, FEE_BASIS, spreadBetween } from "@/lib/predict/spread";
import { loadMarkets } from "@/lib/predict/store";
import { DISCLAIMER, type Market } from "@/lib/predict/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NOTE = "Where venues price the same question differently. Not risk-free: venues' rules can resolve the same question differently, money is tied up until settlement, and moving it between venues takes time and costs more than the fees shown.";

const slimMarket = (m: Market) => ({ key: m.key, venue: m.venue, label: marketLabel(m), prob: m.prob, bid: m.bid, ask: m.ask, volume24h: m.volume24h, closeTime: m.closeTime, url: m.url, realMoney: m.realMoney });

/**
 * GET ?min=0.6 — the same question on two venues (a conservative matcher with a confidence, src/lib/predict/match.ts)
 * and the spread between them net of fees, largest net edge first. Information, not arbitrage.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`predict-spreads:${user.id}`, 240, 3_600_000, "Spreads were loaded many times this hour. Try again in a few minutes.");
    const min = Math.min(0.95, Math.max(MATCH_MIN, Number(new URL(req.url).searchParams.get("min")) || MATCH_MIN));
    const { markets, venues } = await loadMarkets();
    // Matching is pairwise over thousands of markets: worked out once a minute per instance.
    const pairs = await memo(`predict:pairs:${venues.map((v) => `${v.venue}${v.fetchedAt}`).join("|")}`, 60_000, async () => matchAcross(markets));
    const rows = pairs.filter((p) => p.confidence >= min).map((p) => {
      const s = spreadBetween(p.a, p.b);
      const days = Math.max(daysToClose(p.a) ?? 0, daysToClose(p.b) ?? 0) || null;
      return { a: slimMarket(p.a), b: slimMarket(p.b), confidence: p.confidence, reasons: p.reasons, spread: s, annualised: s ? annualised(s.net, s.cost, days) : null, days };
    }).sort((x, y) => (y.spread?.net ?? -1) - (x.spread?.net ?? -1) || Math.abs(y.spread?.gap ?? 0) - Math.abs(x.spread?.gap ?? 0)).slice(0, 200);
    return NextResponse.json({ pairs: rows, venues, fees: FEE_BASIS, note: NOTE, disclaimer: DISCLAIMER }, { headers: NO_STORE });
  });
}
