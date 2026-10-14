import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getMeeting } from "@/lib/calendar/meetings";
import { cancelMeeting, changeMeeting, type ChangeInput } from "@/lib/calendar/write";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const meeting = await getMeeting(user.id, id);
    return meeting ? NextResponse.json({ meeting }) : NextResponse.json({ error: "That meeting is not in your calendar any more." }, { status: 404 });
  });
}

/** Reschedule or edit. `scope` is "instance" (default) or "series"; `sendInvites` defaults to true. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as ChangeInput | null;
    if (!body) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    await rateLimit(`calendar-write:${user.id}`, 60, 3_600_000, "That is a lot of changes this hour. Try again later.");
    return NextResponse.json({ meeting: await changeMeeting(user.id, id, body) });
  });
}

/** Cancel: ?scope=instance|series&notify=1|0. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const q = new URL(req.url).searchParams;
    await rateLimit(`calendar-write:${user.id}`, 60, 3_600_000, "That is a lot of changes this hour. Try again later.");
    await cancelMeeting(user.id, id, { scope: q.get("scope") === "series" ? "series" : "instance", sendInvites: q.get("notify") !== "0" });
    return NextResponse.json({ ok: true });
  });
}
