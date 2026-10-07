import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { getAccount } from "@/lib/calendar/accounts";
import { savePrefs } from "@/lib/calendar/prefs";
import { syncAccount } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";

/** Show or hide a calendar ({ visible }), or make it the default for new meetings ({ default: true }). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { visible?: boolean; default?: boolean } | null;
    const db = requireDb();
    const C = schema.calendarCalendars;
    const [cal] = await db.select().from(C).where(and(eq(C.id, id), eq(C.userId, user.id)));
    if (!cal) return NextResponse.json({ error: "That calendar is not connected." }, { status: 404 });
    if (body?.default) {
      if (!cal.canWrite) return NextResponse.json({ error: "New meetings cannot be written to that calendar." }, { status: 400 });
      await savePrefs(user.id, user.email, { defaultCalendarId: id });
    }
    if (typeof body?.visible === "boolean" && body.visible !== cal.visible) {
      await db.update(C).set({ visible: body.visible, ...(body.visible ? { syncToken: "" } : {}) }).where(eq(C.id, id));
      // Shown again: read it now. Hidden: the sync drops its events.
      const account = await getAccount(user.id, cal.accountId);
      if (account) after(() => syncAccount(account, { calendars: false }).then(() => undefined, () => undefined));
      if (!body.visible) await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.calendarId, id));
    }
    return NextResponse.json({ ok: true });
  });
}
