import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { liveSuggestions, setLive } from "@/lib/meetings/copilot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Switch live suggestions on or off for this meeting: { on }. On needs the plan (`meetings.live`). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    const body = (await req.json().catch(() => null)) as { on?: unknown } | null;
    if (!id || typeof body?.on !== "boolean") return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await setLive(user, id, body.on));
  }, { device: "required" });
}

/** One round of live suggestions, while they are switched on for this meeting. Billed per minute. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json(await liveSuggestions(user, id));
  }, { device: "required" });
}
