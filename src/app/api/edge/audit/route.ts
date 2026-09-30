import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { trailCsv, trailFor } from "@/lib/edge/provenance";

export const dynamic = "force-dynamic";

/** The audit trail of one finding as CSV: every source, its license, when it was retrieved and by what method. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number(new URL(req.url).searchParams.get("detection"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const [d] = await requireDb().select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title }).from(schema.edgeDetections)
      .where(and(eq(schema.edgeDetections.id, id), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const csv = trailCsv(await trailFor([`detection:${d.id}`]));
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="edge-audit-${d.id}.csv"`, "cache-control": "private, no-store" } });
  });
}
