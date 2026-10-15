import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, jsonBody, refuse, sameSiteJson } from "@/lib/quant/access";
import { estimateCost } from "@/lib/quant/tca/run";
import { DISCLOSURES } from "@/lib/quant/words";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST { symbol, notionalUsd, side, broker? } — a pre-trade cost estimate for one symbol (free). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const b = await jsonBody(req);
    const symbol = String(b.symbol ?? "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw refuse("Give a ticker.");
    const side = b.side === "sell" || b.side === "short" || b.side === "cover" ? b.side : "buy";
    const est = await estimateCost(symbol, Number(b.notionalUsd), side, { broker: typeof b.broker === "string" ? b.broker : undefined, ownerId: user.id });
    return NextResponse.json({ estimate: est, disclosure: DISCLOSURES.model_estimate });
  });
}
