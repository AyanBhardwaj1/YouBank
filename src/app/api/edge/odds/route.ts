import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { companyNode } from "@/lib/edge/entities/resolve";
import { oddsFor } from "@/lib/edge/odds/score";
import { currentModel } from "@/lib/edge/odds/train";
import { inScope, SECTORS, universeMode } from "@/lib/edge/odds/labels";
import { trackRecord } from "@/lib/edge/forecasts/ledger";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * One company's Deal Radar (E4, free): GET ?ticker=. The model probability of an announced agreement to be
 * acquired within 12 months, its Venn-Abers interval, the sector base rate, the top reasons with their
 * filings, what would move it, the odds over time, likely buyers from the deal model, the model's scorecard
 * and calibration, its track record so far, and the disclaimer. A company outside the scored universe says
 * so.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const ticker = (new URL(req.url).searchParams.get("ticker") ?? "").toUpperCase();
    if (!TICKER.test(ticker)) return NextResponse.json({ error: "Give a ticker." }, { status: 400 });
    const node = await companyNode(ticker);
    if (!node) return NextResponse.json({ error: "That company is not in SEC's list." }, { status: 404 });
    const [odds, model] = await Promise.all([oddsFor(node.id), currentModel()]);
    const track = await memo("edge:odds:track", 15 * 60_000, () => trackRecord("deal_target")).catch(() => []);
    if (!odds) {
      const why = !model ? "The Deal Radar has no trained model yet." : universeMode() === "sectors" ? `Not scored: this round covers ${Object.values(SECTORS).map((s) => s.label.toLowerCase()).join("; ")}.` : "Not scored yet.";
      return NextResponse.json({ covered: false, error: why, ticker, scorecard: model?.metrics.scorecard ?? null, track: track[0] ?? null });
    }
    return NextResponse.json({ covered: true, ...odds, low: odds.low, high: odds.high, scorecardFull: model?.metrics.scorecard ?? null, track: track[0] ?? null, inScopeSic: inScope(odds.sic) }, { headers: { "cache-control": "private, max-age=60" } });
  });
}
