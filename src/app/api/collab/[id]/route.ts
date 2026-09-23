import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { applyPatch, closeSession, heartbeat, latestEventId, leave, presenceFor, requireSession } from "@/lib/collab/db";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** The session, its shared state, who is here, and the event id to resume the stream from. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const session = await requireSession(user, id);
    const [presence, lastEventId] = await Promise.all([presenceFor(id), latestEventId(id)]);
    return NextResponse.json({ session, presence, lastEventId });
  });
}

/** action: patch | heartbeat | leave | close */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as
      { action?: string; patch?: Record<string, unknown>; field?: string } | null;

    if (body?.action === "close") { await closeSession(user, id); return NextResponse.json({ ok: true }); }
    await requireSession(user, id);

    if (body?.action === "leave") { await leave(id, user.id); return NextResponse.json({ ok: true }); }
    if (body?.action === "heartbeat") return NextResponse.json({ presence: await heartbeat(id, user, body.field ?? "") });
    if (body?.patch && typeof body.patch === "object") {
      const ev = await applyPatch(id, user, body.patch);
      return NextResponse.json({ eventId: ev.id });
    }
    return NextResponse.json({ error: "Nothing to do: send a patch, or an action of heartbeat, leave or close" }, { status: 400 });
  });
}
