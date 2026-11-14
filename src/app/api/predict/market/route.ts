import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { loadBook } from "@/lib/book/store";
import { rateLimit } from "@/lib/locks";
import { bookExposure, exposureLine } from "@/lib/predict/exposure";
import { marketKey, NO_STORE } from "@/lib/predict/http";
import { mapMarket } from "@/lib/predict/mapping";
import { counterparts } from "@/lib/predict/match";
import { annualised, daysToClose, FEE_BASIS, spreadBetween } from "@/lib/predict/spread";
import { loadMarkets, marketByKey, orderBook, priceHistory, type Range } from "@/lib/predict/store";
import { DISCLAIMER, VENUE_NOTE } from "@/lib/predict/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?key=kalshi:KXFEDDECISION-26DEC-C25&range=1w|1m|3m — one market in full: its probability history (and the
 * same question's on other venues), the order book or best bid and ask, the resolution rules, the matching
 * markets elsewhere with the spread net of fees, the stocks it moves, what it touches in the person's Book,
 * and their watch and forecasts on it.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`predict-detail:${user.id}`, 240, 3_600_000, "Market pages were opened many times this hour. Try again in a few minutes.");
    const q = new URL(req.url).searchParams;
    const key = marketKey(q.get("key"));
    const range: Range = q.get("range") === "1w" || q.get("range") === "3m" ? (q.get("range") as Range) : "1m";
    const { markets } = await loadMarkets();
    const listed = markets.find((m) => m.key === key);
    // The market itself, read on its own for the full rules text (lists keep a preview); the listed copy if that fails.
    const m = (await marketByKey(key, { fresh: true, eventId: listed?.eventId })) ?? listed ?? null;
    if (!m) return NextResponse.json({ error: "That market could not be found on its venue. It may have been removed." }, { status: 404 });
    const others = m.status === "open" ? counterparts(m, markets).slice(0, 3) : [];
    const [history, book, otherHistories, positions] = await Promise.all([
      priceHistory(m, range), orderBook(m),
      Promise.all(others.map((o) => priceHistory(o.market, range))),
      loadBook(user.id).catch(() => []),
    ]);
    const db = requireDb();
    const [watch] = await db.select().from(schema.predictWatches).where(and(eq(schema.predictWatches.userId, user.id), eq(schema.predictWatches.marketKey, key))).catch(() => []);
    const forecasts = await db.select().from(schema.predictForecasts).where(and(eq(schema.predictForecasts.userId, user.id), eq(schema.predictForecasts.marketKey, key))).orderBy(desc(schema.predictForecasts.createdAt)).limit(20).catch(() => []);
    const exposure = bookExposure(positions, [m])[0] ?? null;
    const days = daysToClose(m);
    return NextResponse.json({
      market: m, venueNote: VENUE_NOTE[m.venue], daysToClose: days, history, book: book.book, bookDepth: book.depth,
      counterparts: others.map((o, i) => {
        const s = spreadBetween(m, o.market);
        return { market: o.market, confidence: o.confidence, reasons: o.reasons, history: otherHistories[i], spread: s, annualised: s ? annualised(s.net, s.cost, Math.max(days ?? 0, daysToClose(o.market) ?? 0) || null) : null };
      }),
      fees: { [m.venue]: FEE_BASIS[m.venue], ...Object.fromEntries(others.map((o) => [o.market.venue, FEE_BASIS[o.market.venue]])) },
      mapping: mapMarket(m),
      exposure: exposure ? { ...exposure, line: exposureLine(exposure) } : null,
      watch: watch ? { threshold: watch.threshold, baseProb: watch.baseProb } : null,
      forecasts: forecasts.map((f) => ({ id: f.id, p: f.p, marketP: f.marketP, day: String(f.day), outcome: f.outcome, brier: f.brier, marketBrier: f.marketBrier })),
      disclaimer: DISCLAIMER,
    }, { headers: NO_STORE });
  });
}
