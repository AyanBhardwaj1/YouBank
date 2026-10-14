import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { commitmentsFor } from "@/lib/edge/calls/store";

export const dynamic = "force-dynamic";

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * A company's promises (E5, free): GET ?ticker=. Every quantified forward statement Call Desk read from its
 * releases and calls, with its status (open, hit, missed, raised, lowered, withdrawn, or unmapped and not
 * scored), the source quote, the period and the hit rate with its interval. Add &format=csv to export.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();
    if (!TICKER.test(ticker)) return NextResponse.json({ error: "Give a ticker." }, { status: 400 });
    const r = await commitmentsFor(user.id, ticker);
    if (url.searchParams.get("format") === "csv") {
      const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [["metric", "period_fy", "period_q", "low", "high", "unit", "status", "probability", "reported", "said", "quote"].join(","), ...r.rows.map((x) => [x.label, x.period?.fy ?? "", x.period?.q ?? "", x.low, x.high, x.unit, x.status, x.p ?? "", x.reported ?? "", x.said ?? "", x.quote].map(esc).join(","))];
      return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ticker}-promises.csv"` } });
    }
    return NextResponse.json(r);
  });
}
