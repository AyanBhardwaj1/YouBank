import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { brokerHoldings } from "@/lib/quant/broker";
import { factorLab, LAB_VERSION } from "@/lib/quant/factors/lab";
import { crowding, factorPanel, factorStatus } from "@/lib/quant/factors/read";
import { trySaveRun } from "@/lib/quant/runs";
import { getTarget } from "@/lib/quant/targets";
import { cleanHoldings } from "@/lib/quant/holdings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — the factor dashboard without holdings: which factor set is live, its returns and crowding. */
export async function GET() {
  return guarded(async () => {
    const from = new Date(Date.now() - 5.2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const [panel, status, crowd] = await Promise.all([factorPanel(from), factorStatus().catch(() => null), crowding().catch(() => [])]);
    return NextResponse.json({ tier: panel.tier, source: panel.source, names: panel.names, dates: panel.dates.filter((_, i) => i % 5 === 0 || i === panel.dates.length - 1), cumulative: panel.names.map((_, k) => { let g = 1; return panel.rows.map((r) => (g *= 1 + r[k])).filter((_, i) => i % 5 === 0 || i === panel.rows.length - 1); }), status, crowding: crowd });
  });
}

/**
 * POST { holdings?, source?: "typed" | "copy" | "broker", copyId?, accountId?, years? } — Factor Lab on a portfolio.
 * Free: up to 30 holdings, typed, from CSV or a copy, three years. quant.factorlab-pro: 200 holdings, a connected
 * broker account's holdings, ten years.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    const b = await jsonBody(req);
    const pro = await canUse(user, "quant.factorlab-pro");
    let holdings = cleanHoldings(b.holdings);
    if (b.source === "broker") {
      await requireFeature(user, "quant.factorlab-pro");
      if (typeof b.accountId !== "string") throw refuse("Choose a connected account.");
      holdings = (await brokerHoldings(user, b.accountId)).holdings;
    } else if (b.source === "copy") {
      const t = await getTarget(`copy:${Number(b.copyId) || 0}`);
      if (!t || t.ownerId !== user.id) throw refuse("That copy has no target yet. Open it in Fund copies first.", 404);
      holdings = t.weights.map((w) => ({ symbol: w.instrument.symbol, weight: w.weight }));
    }
    if (pro) await capDaily(user, "factorPro", "That is the most Factor Lab runs in a day.");
    const years = Math.min(Number(b.years) || 3, pro ? 10 : 3);
    const result = await factorLab(holdings, { years, maxHoldings: pro ? 200 : 30 });
    const runId = await trySaveRun(user.id, "factors", { holdings, years, source: b.source ?? "typed" }, { summary: result.summary, tier: result.tier, y1: result.windows.y1, y3: result.windows.y3 }, result.sources.map((label) => ({ label })), LAB_VERSION);
    return NextResponse.json({ ...result, runId, plan: { pro, maxHoldings: pro ? 200 : 30, maxYears: pro ? 10 : 3 } });
  });
}
