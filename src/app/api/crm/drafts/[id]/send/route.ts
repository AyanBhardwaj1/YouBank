import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { learnFromSend } from "@/lib/crm/engine";
import { sendDraft } from "@/lib/crm/send";
import { getSettings } from "@/lib/crm/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send a draft because a person pressed Send.
 *
 * Afterwards, outside the response, the adaptive engine learns from what they did: whether they sent
 * the agent's words unchanged (trust for this kind of email) and, if they edited them, what the edit
 * says about their preferences (lessons for later drafts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { subject?: string; body?: string } | null;
    const result = await sendDraft(user.id, id, new URL(req.url).origin, { subject: body?.subject, body: body?.body });
    after(async () => {
      const settings = await getSettings(user.id);
      await learnFromSend(user.id, id, settings.signature).catch(() => undefined);
    });
    return NextResponse.json(result);
  });
}
