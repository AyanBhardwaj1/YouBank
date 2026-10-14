import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { filtersOf } from "@/lib/edge/deals/export";
import { coverage, headlineTerms, searchDeals } from "@/lib/edge/deals/store";
import { trimmedStats } from "@/lib/edge/deals/range";

export const dynamic = "force-dynamic";

/**
 * The Precedent Engine's search (E1, free): GET ?q=&sic=&from=&to=&buyer=&consideration=&min=&max=&read=1&limit=&offset=.
 * Deals newest first with their headline terms, the EV/EBITDA spread of the page, and how much the database
 * holds (so "no results" can be told from "not read yet").
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const f = filtersOf(q);
    const limit = Math.max(1, Math.min(100, Number(q.get("limit")) || 50)), offset = Math.max(0, Number(q.get("offset")) || 0);
    const [{ rows, total }, cov] = await Promise.all([searchDeals(f, limit, offset), coverage()]);
    const terms = await headlineTerms(rows.map((r) => r.id));
    return NextResponse.json({
      deals: rows.map((r) => ({ ...r, terms: terms.get(r.id) ?? {} })), total, coverage: cov,
      spread: { evEbitda: trimmedStats(rows.map((r) => r.evEbitda ?? NaN)), evRevenue: trimmedStats(rows.map((r) => r.evRevenue ?? NaN)) },
    }, { headers: { "cache-control": "private, max-age=30" } });
  });
}
