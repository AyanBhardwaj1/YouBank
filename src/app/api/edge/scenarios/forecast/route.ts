import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { requireReady } from "@/lib/edge/premium";
import { forecastDriver, isFactor } from "@/lib/edge/premium/timesfm";
import { factorHistory } from "@/lib/edge/scen/data";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Forecast a scenario driver: { factor: market|energy|oil|gas|rates, horizon: weeks (4, 13, 26 or 52),
 * timesfm?: true }. Without timesfm it is the free drift and volatility forecast; with it, Google's
 * TimesFM through BigQuery (premium: edge.timesfm), after the plan and the setup are checked (402 or
 * 409, nothing sent to Google).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { factor?: string; horizon?: number; timesfm?: boolean } | null;
    if (!isFactor(body?.factor)) return NextResponse.json({ error: "Pick a driver." }, { status: 400 });
    const timesfm = body.timesfm === true;
    if (timesfm) { await requireFeature(user, "edge.timesfm"); requireReady("edge.timesfm"); }
    await rateLimit(`edge-forecast:${user.id}`, 60, 3_600_000, "Many forecasts this hour; try again in a few minutes.");
    return NextResponse.json(await forecastDriver(await factorHistory(), body.factor, Number(body.horizon) || 26, timesfm));
  });
}
