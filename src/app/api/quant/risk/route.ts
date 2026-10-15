import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { brokerHoldings } from "@/lib/quant/broker";
import { cleanHoldings } from "@/lib/quant/holdings";
import { riskView, RISK_VERSION } from "@/lib/quant/risk/run";
import { trySaveRun } from "@/lib/quant/runs";
import { getTarget } from "@/lib/quant/targets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { holdings, source?, copyId?, accountId?, shocks?: string[], reverseLoss?, horizonDays?, portfolioUsd? } — the
 * risk model and stress tests. Free: 30 holdings, five replays, two shocks, one-day 95% VaR with its backtest.
 * quant.risk-pro: 200 holdings, broker holdings, unlimited shocks, reverse stress, 10,000 paths, every VaR.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    const b = await jsonBody(req);
    const pro = await canUse(user, "quant.risk-pro");
    let holdings = cleanHoldings(b.holdings);
    let portfolioUsd = Number(b.portfolioUsd) || undefined;
    if (b.source === "broker") {
      await requireFeature(user, "quant.risk-pro");
      if (typeof b.accountId !== "string") throw refuse("Choose a connected account.");
      const h = await brokerHoldings(user, b.accountId);
      holdings = h.holdings; portfolioUsd = h.total;
    } else if (b.source === "copy") {
      const t = await getTarget(`copy:${Number(b.copyId) || 0}`);
      if (!t || t.ownerId !== user.id) throw refuse("That copy has no target yet. Open it in Fund copies first.", 404);
      holdings = t.weights.map((w) => ({ symbol: w.instrument.symbol, weight: w.weight }));
    }
    if (pro) await capDaily(user, "riskPro", "That is the most 10,000-path risk runs in a day.");
    const shocks = Array.isArray(b.shocks) ? (b.shocks as unknown[]).map(String).filter((s) => s.trim()).slice(0, 10) : [];
    const result = await riskView({ holdings, pro, shocks, reverseLoss: Number(b.reverseLoss) || undefined, horizonDays: Number(b.horizonDays) || undefined, portfolioUsd });
    const runId = await trySaveRun(user.id, "risk", { holdings, shocks, reverseLoss: b.reverseLoss ?? null, pro }, { summary: result.summary, vol: result.decomposition.volAnnual, var: result.var.rows, stress: result.stress.map((s) => ({ key: s.key, mid: s.mid })) }, result.sources.map((label) => ({ label })), RISK_VERSION);
    return NextResponse.json({ ...result, runId, plan: { pro } });
  });
}
