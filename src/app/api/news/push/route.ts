import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

/** Register this browser for push ({ subscription }), or remove it ({ subscription, remove: true }). */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { subscription?: Sub; remove?: boolean };
    const s = body.subscription;
    if (!s?.endpoint || !/^https:\/\//.test(s.endpoint)) return NextResponse.json({ error: "No push subscription" }, { status: 400 });
    const db = requireDb();
    if (body.remove) {
      await db.delete(schema.newsPushSubs).where(and(eq(schema.newsPushSubs.userId, user.id), eq(schema.newsPushSubs.endpoint, s.endpoint)));
      return NextResponse.json({ ok: true });
    }
    if (!s.keys?.p256dh || !s.keys.auth) return NextResponse.json({ error: "Subscription keys missing" }, { status: 400 });
    const keys = { p256dh: s.keys.p256dh, auth: s.keys.auth };
    await db.insert(schema.newsPushSubs).values({ userId: user.id, endpoint: s.endpoint, keys, userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200) })
      .onConflictDoUpdate({ target: schema.newsPushSubs.endpoint, set: { userId: user.id, keys } });
    return NextResponse.json({ ok: true });
  });
}
