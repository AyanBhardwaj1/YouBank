import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { loadBook } from "@/lib/book/store";
import { rateLimit } from "@/lib/locks";
import { bookExposure, exposureLine } from "@/lib/predict/exposure";
import { NO_STORE, tickerList } from "@/lib/predict/http";
import { loadMarkets } from "@/lib/predict/store";
import { DISCLAIMER } from "@/lib/predict/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET — the person's Book against open prediction markets: which markets touch which positions, and whether
 * YES helps or hurts each (src/lib/predict/exposure.ts). ?tickers=AAPL,JPM checks a list instead (long, unweighted).
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`predict-exposure:${user.id}`, 240, 3_600_000, "Event exposure was checked many times this hour. Try again in a few minutes.");
    const given = tickerList(new URL(req.url).searchParams.get("tickers"), 50);
    const positions = given.length ? given.map((ticker) => ({ ticker, direction: "long" as const, weight: null })) : (await loadBook(user.id).catch(() => [])).map((p) => ({ ticker: p.ticker, direction: p.direction, weight: p.weight }));
    if (!positions.length) return NextResponse.json({ source: "book", positions: 0, exposure: [], disclaimer: DISCLAIMER }, { headers: NO_STORE });
    const { markets, venues } = await loadMarkets(["kalshi", "polymarket", "gemini"]);
    const exposure = bookExposure(positions, markets).slice(0, 100).map((e) => ({ ...e, line: exposureLine(e) }));
    return NextResponse.json({ source: given.length ? "tickers" : "book", positions: positions.length, tickers: positions.map((p) => p.ticker), exposure, venues, disclaimer: DISCLAIMER }, { headers: NO_STORE });
  });
}
