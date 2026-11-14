import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { NO_STORE, tickerList } from "@/lib/predict/http";
import { loadPredictSignals } from "@/lib/predict/store";
import { DISCLAIMER } from "@/lib/predict/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?tickers=JPM,NVDA&per=5 — for each ticker, the open markets that move it (predictSignalsFor), for Home, Edge and the terminal. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`predict-signals:${user.id}`, 300, 3_600_000, "Event signals were asked for many times this hour. Try again in a few minutes.");
    const q = new URL(req.url).searchParams;
    const tickers = tickerList(q.get("tickers"), 50);
    if (!tickers.length) return NextResponse.json({ error: "Give one or more tickers, e.g. ?tickers=JPM,NVDA." }, { status: 400 });
    const per = Math.min(Math.max(Number(q.get("per")) || 5, 1), 10);
    return NextResponse.json({ signals: await loadPredictSignals(tickers, per), disclaimer: DISCLAIMER }, { headers: NO_STORE });
  });
}
