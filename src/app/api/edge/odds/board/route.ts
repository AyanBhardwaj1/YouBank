import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { board } from "@/lib/edge/odds/score";
import { currentModel } from "@/lib/edge/odds/train";
import { DISCLAIMER } from "@/lib/edge/odds/model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * The Deal Radar board (E4): ?scope=watched (free) or movers (free: the week's 25 largest rises), or screen
 * (premium: edge.odds-screener, every scored company filtered by &sector= and &min=, with &format=csv).
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const scope = q.get("scope") === "movers" ? "movers" : q.get("scope") === "screen" ? "screen" : "watched";
    if (scope === "screen") await requireFeature(user, "edge.odds-screener");
    const min = Number(q.get("min"));
    const rows = await board(scope, user.id, { sector: q.get("sector") || undefined, min: Number.isFinite(min) && min > 0 ? min : undefined, limit: Number(q.get("limit")) || undefined });
    const model = await currentModel();
    if (scope === "screen" && q.get("format") === "csv") {
      const head = ["ticker", "name", "sector", "probability_12m", "low", "high", "sector_base_rate", "weekly_change", "reasons"].join(",");
      const body = rows.map((r) => [r.ticker, r.name, r.sector, r.p, r.low, r.high, r.base, r.rise, r.reasons.map((x) => `${x.direction === "up" ? "+" : "-"} ${x.label}`).join("; ")].map(cell).join(","));
      return new Response(`# ${DISCLAIMER} Model ${model?.version ?? ""}.\n${head}\n${body.join("\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="deal-radar-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    const watched = scope === "watched" ? rows : [];
    return NextResponse.json({ scope, rows, watched, movers: scope === "movers" ? rows : [], version: model?.version ?? null, disclaimer: DISCLAIMER }, { headers: { "cache-control": "private, max-age=60" } });
  });
}
