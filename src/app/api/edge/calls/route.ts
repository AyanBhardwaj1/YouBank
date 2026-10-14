import { NextResponse } from "next/server";
import { desc, eq, inArray, or, sql, and } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";

export const dynamic = "force-dynamic";

/**
 * The calls Call Desk can read (E5): the person's recordings and uploads, and filed 8-K releases and
 * transcripts (shared), each with its read summary when it has one. Reads only the columns the list shows.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const ticker = (new URL(req.url).searchParams.get("ticker") ?? "").toUpperCase();
    const db = requireDb();
    const d = schema.edgeDocs;
    const teams = db.select({ id: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
    const cols = { id: d.id, title: d.title, source: d.source, mime: d.mime, status: d.status, createdAt: d.createdAt, ticker: sql<string>`coalesce(${d.meta}->>'ticker', '')`, form: sql<string>`coalesce(${d.meta}->>'form', '')`, filed: sql<string>`coalesce(${d.meta}->>'filed', '')`,
      summary: sql<{ mean: number; low: number; high: number; scored: number } | null>`${d.meta}->'callDesk'->'summary'`, rose: sql<number | null>`(${d.meta}->'callDesk'->'comparison'->>'prob')::float`, promises: sql<number>`coalesce(jsonb_array_length(${d.meta}->'callDesk'->'commitments'), 0)` };
    const mine = and(or(eq(d.ownerId, user.id), inArray(d.teamId, teams)), inArray(d.source, ["audio", "upload"]));
    const filed = and(eq(d.source, "sec"), sql`${d.meta}->>'form' like '8-K%'`, ticker ? undefined : sql`(${d.meta}->'callDesk') is not null`);
    const rows = await db.select(cols).from(d).where(and(or(mine, filed), ticker ? sql`${d.meta}->>'ticker' = ${ticker}` : undefined)).orderBy(desc(d.createdAt)).limit(80);
    return NextResponse.json({ calls: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), read: !!r.summary || r.promises > 0 })) });
  });
}
