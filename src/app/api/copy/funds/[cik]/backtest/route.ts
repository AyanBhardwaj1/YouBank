import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { fundBacktest } from "@/lib/copytrade/analytics";
import { HYPOTHETICAL, NO_LAG_NOTE } from "@/lib/copytrade/disclosures";
import { padCik } from "@/lib/copytrade/funds";
import { rateLimit } from "@/lib/locks";
import { gradeCloneBacktest } from "@/lib/quant/adapters/copy13f";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?top=20&years=5 — the lag-aware clone backtest, with its assumptions and the hypothetical-performance
 * disclosure. Free. Each run is logged as a trial of the fund's clone family (every top-N tried is a variant) and
 * carries Quant Edge's integrity grade; a grade that cannot be computed is left out, never blocks the backtest.
 */
export async function GET(req: Request, ctx: { params: Promise<{ cik: string }> }) {
  return guarded(async (user) => {
    const cik = padCik((await ctx.params).cik);
    if (!cik) return NextResponse.json({ error: "That is not a CIK." }, { status: 400 });
    const p = new URL(req.url).searchParams;
    const top = [5, 10, 20, 30, 50, 0].includes(Number(p.get("top"))) ? Number(p.get("top")) : 20;
    const years = [1, 3, 5].includes(Number(p.get("years"))) ? Number(p.get("years")) : 5;
    await rateLimit(`copy-backtest:${user.id}`, 12, 60_000, "Too many backtests at once. Wait a moment and try again.");
    const { daily, turnoverPerYear, ...bt } = await fundBacktest(cik, top, years);
    const integrity = daily ? await gradeCloneBacktest(cik, bt, daily, turnoverPerYear ?? 0, years).catch(() => null) : null;
    return NextResponse.json({ ...bt, integrity, disclosure: HYPOTHETICAL, noLagNote: NO_LAG_NOTE });
  });
}
