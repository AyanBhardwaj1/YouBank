import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

/** The bell: the latest alerts and briefs, with the unread count. */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const [items, [{ n }]] = await Promise.all([
      db.select().from(schema.newsNotifications).where(eq(schema.newsNotifications.userId, user.id)).orderBy(desc(schema.newsNotifications.createdAt)).limit(40),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.newsNotifications).where(and(eq(schema.newsNotifications.userId, user.id), isNull(schema.newsNotifications.readAt))),
    ]);
    return NextResponse.json({ unread: n, items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, url: i.url, urgent: i.urgent, at: i.createdAt.toISOString(), read: !!i.readAt, delivered: i.delivered })) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** Mark read: { ids: [...] } or { all: true }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { ids?: number[]; all?: boolean };
    const db = requireDb();
    const ids = (body.ids ?? []).filter((x) => Number.isInteger(x)).slice(0, 200);
    if (!body.all && !ids.length) return NextResponse.json({ ok: true });
    await db.update(schema.newsNotifications).set({ readAt: new Date() })
      .where(and(eq(schema.newsNotifications.userId, user.id), isNull(schema.newsNotifications.readAt), ...(body.all ? [] : [inArray(schema.newsNotifications.id, ids)])));
    return NextResponse.json({ ok: true });
  });
}
