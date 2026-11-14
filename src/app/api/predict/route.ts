import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { NO_STORE } from "@/lib/predict/http";
import { filterMarkets, parseFilters } from "@/lib/predict/query";
import { loadMarkets } from "@/lib/predict/store";
import { DISCLAIMER } from "@/lib/predict/types";
import { watchedKeys } from "@/lib/predict/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?q=&venue=kalshi,polymarket&cat=finance|all|fed|…&sort=volume|change|closing|prob&min=&limit= — open
 * prediction markets across venues, normalised (src/lib/predict). Venues are read through the shared cache;
 * a venue that is down answers from its last good snapshot or is listed as unavailable, never as an error.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`predict-list:${user.id}`, 600, 3_600_000, "The markets were loaded many times this hour. Try again in a few minutes.");
    const q = new URL(req.url).searchParams;
    const f = parseFilters(q);
    const limit = Math.min(Math.max(Number(q.get("limit")) || 150, 1), 300);
    const { markets, venues } = await loadMarkets();
    const list = filterMarkets(markets, f);
    const shown = list.slice(0, limit);
    const watched = await watchedKeys(user.id, shown.map((m) => m.key)).catch(() => new Set<string>());
    return NextResponse.json({
      markets: shown.map((m) => ({ ...m, rules: undefined, watched: watched.has(m.key) })),
      total: list.length, filters: f, venues, asOf: new Date().toISOString(), disclaimer: DISCLAIMER,
    }, { headers: NO_STORE });
  });
}
