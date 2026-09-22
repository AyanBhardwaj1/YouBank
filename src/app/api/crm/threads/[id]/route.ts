import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createDraft, processThread, threadWithMessages } from "@/lib/crm/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const found = await threadWithMessages(user.id, id);
    if (!found) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    return NextResponse.json(found);
  });
}

/** action: "process" re-reads and files the thread; "draft" writes a reply for review. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { action?: string; instruction?: string } | null;
    if (body?.action === "draft") {
      return NextResponse.json(await createDraft(user.id, id, { instruction: body.instruction?.slice(0, 500) }), { status: 201 });
    }
    return NextResponse.json(await processThread(user.id, id));
  });
}
