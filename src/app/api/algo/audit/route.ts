import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { auditCsv, auditLog } from "@/lib/algo/access";

export const dynamic = "force-dynamic";

/** GET [?format=csv][&strategy=ID] — the person's own algo trading audit log; the CSV neutralises formula-leading cells. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const p = new URL(req.url).searchParams;
    const strategyId = Number(p.get("strategy")) || undefined;
    const rows = await auditLog(user.id, { strategyId, limit: p.get("format") === "csv" ? 5000 : 200 });
    if (p.get("format") === "csv") {
      return new Response(auditCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-algo-audit-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    return NextResponse.json({ entries: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actor, action: r.action, strategyId: r.strategyId, batchId: r.batchId, orderId: r.orderId, payload: r.payload })) });
  });
}
