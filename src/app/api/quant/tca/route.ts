import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireQuantConsent } from "@/lib/quant/access";
import { toCsv } from "@/lib/quant/csv";
import { trySaveRun } from "@/lib/quant/runs";
import { TCA_VERSION } from "@/lib/quant/tca/model";
import { tcaReport } from "@/lib/quant/tca/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?portfolioUsd=&format=csv — the person's execution-cost report (CSV: one row per fill, cells neutralised). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    const q = new URL(req.url).searchParams;
    const r = await tcaReport(user.id, { portfolioUsd: Number(q.get("portfolioUsd")) || null });
    if (q.get("format") === "csv") {
      const csv = toCsv(["executed_at", "symbol", "side", "qty", "price", "broker", "order_type", "vs_open_bps", "vs_close_bps", "vs_typical_bps", "range_position", "modelled_cost_usd", "flags"],
        r.fills.map((f) => [f.fill.executedAt, f.fill.symbol, f.fill.side, f.fill.qty, f.fill.price, f.fill.broker ?? "", f.fill.orderType ?? "", f.vsOpenBps, f.vsCloseBps, f.vsTypicalBps, f.rangePosition, f.modelledCostUsd, f.flags.join("; ")]));
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=youbank-execution-costs.csv" } });
    }
    await trySaveRun(user.id, "tca", { fills: r.fills.length }, { annual: r.annual, observedY: r.observedY }, r.sources.map((label) => ({ label })), TCA_VERSION);
    return NextResponse.json({ ...r, fills: r.fills.slice(0, 500) });
  });
}
