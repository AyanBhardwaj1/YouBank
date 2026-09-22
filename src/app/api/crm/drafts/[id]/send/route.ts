import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { sendDraft } from "@/lib/crm/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send an approved draft.
 *
 * Reached only when a person clicks Send. There is no scheduled or agent-initiated path to it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { subject?: string; body?: string } | null;
    const result = await sendDraft(user.id, id, new URL(req.url).origin, { subject: body?.subject, body: body?.body });
    return NextResponse.json(result);
  });
}
