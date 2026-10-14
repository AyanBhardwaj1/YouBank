import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { searchDeals } from "@/lib/edge/deals/store";
import { activeFieldsMany, dealCsv, filtersOf } from "@/lib/edge/deals/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Free exports hold this many deals; more is premium (edge.deals-export, a perk: the rows are stored). */
const FREE_ROWS = 50;

/**
 * Precedents as CSV (E1) with each term's quote and source: the search's filters, up to 50 deals free, up
 * to 1,000 with edge.deals-export.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const want = Math.max(1, Math.min(1000, Number(q.get("limit")) || FREE_ROWS));
    if (want > FREE_ROWS) await requireFeature(user, "edge.deals-export");
    const { rows } = await searchDeals(filtersOf(q), want, 0);
    const fields = await activeFieldsMany(rows.map((r) => r.id));
    return new Response(dealCsv(rows, fields), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="precedents-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  });
}
