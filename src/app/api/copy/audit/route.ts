import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { auditCsv, auditLog } from "@/lib/copytrade/access";

export const dynamic = "force-dynamic";

/** GET [?format=csv] — the person's own copy-trading audit log: consents, connections, proposals, approvals and orders. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const rows = await auditLog(user.id);
    if (new URL(req.url).searchParams.get("format") === "csv") {
      return new Response(auditCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-copy-audit-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    return NextResponse.json({ entries: rows.slice(0, 100).map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actor, action: r.action, portfolioId: r.portfolioId, batchId: r.batchId, orderId: r.orderId })) });
  });
}
