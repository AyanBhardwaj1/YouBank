import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, sameSiteJson } from "@/lib/algo/access";
import { backtestFor } from "@/lib/algo/live";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST { strategyId } or { spec }, { years?, walkForward? } — a point-in-time backtest with costs, the
 * deflated Sharpe (every run counts as a trial), bootstrap intervals and, on request, walk-forward with the
 * probability of overfitting. Free; free price data; runs in the request.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`algo-backtest:${user.id}`, 10, 60_000, "Too many backtests at once. Wait a moment and try again.");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await backtestFor(user, body, Date.now() + 100_000));
  });
}
