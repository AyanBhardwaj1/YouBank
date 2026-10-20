import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { afterCursor, cursorTime, decodeCursor, pageOf } from "@/lib/cursor";

export const dynamic = "force-dynamic";

/**
 * The bell: the latest alerts and briefs (40 a page; `next` is the cursor for older ones, which `?cursor=`
 * asks for), with the unread count (counted on an index of the unread rows alone, drizzle/0027).
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const db = requireDb();
    const t = schema.newsNotifications;
    const cursor = decodeCursor(new URL(req.url).searchParams.get("cursor"));
    const [rows, [{ n }]] = await Promise.all([
      db.select({ id: t.id, kind: t.kind, title: t.title, body: t.body, url: t.url, urgent: t.urgent, createdAt: t.createdAt, readAt: t.readAt, delivered: t.delivered, cursorAt: cursorTime(t.createdAt) })
        .from(t).where(and(eq(t.userId, user.id), afterCursor(cursor, t.createdAt, t.id))).orderBy(desc(t.createdAt), desc(t.id)).limit(41),
      db.select({ n: sql<number>`count(*)::int` }).from(t).where(and(eq(t.userId, user.id), isNull(t.readAt))),
    ]);
    const { rows: items, next } = pageOf(rows, 40);
    return NextResponse.json({ unread: n, items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, url: i.url, urgent: i.urgent, at: i.createdAt.toISOString(), read: !!i.readAt, delivered: i.delivered })), next }, { headers: { "Cache-Control": "private, no-store" } });
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
