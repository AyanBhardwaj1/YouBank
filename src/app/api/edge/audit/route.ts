import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { feedIndex } from "@/lib/edge/feed";
import { trailCsv, trailFor } from "@/lib/edge/provenance";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";

const csvResponse = (csv: string, name: string) => new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });

/**
 * The audit trail as CSV: every source behind a finding, its license, when it was retrieved and by what
 * method. ?detection=ID for one card; ?all=1 for every finding in the person's feed (a year back).
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const [p, watches] = await Promise.all([requireEdge(user.id), listWatches(user.id)]);
    const q = new URL(req.url).searchParams;
    if (q.get("all")) {
      const titles = new Map((await feedIndex(user.id, watches, p.prefs.blend)).map((c) => [`detection:${c.id}`, c.title]));
      return csvResponse(trailCsv(await trailFor([...titles.keys()]), titles), `edge-audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    const id = Number(q.get("detection"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const [d] = await requireDb().select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title }).from(schema.edgeDetections)
      .where(and(eq(schema.edgeDetections.id, id), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return csvResponse(trailCsv(await trailFor([`detection:${d.id}`])), `edge-audit-${d.id}.csv`);
  });
}
