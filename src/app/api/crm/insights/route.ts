import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { crmInsights, tagTopics } from "@/lib/crm/insights";
import { draftReconnect } from "@/lib/crm/nurture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Relationship strength, reply odds, reply timing, who is going quiet and the pipeline forecast. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await crmInsights(user.id)));
}

/**
 * "tag": tag the next batch of untagged emails with topics (one small-model call), for contact
 * knowledge. "reconnect": draft a note to someone going quiet (it waits in the queue for review).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { action?: string; contactId?: number } | null;
    if (body?.action === "tag") return NextResponse.json({ tagged: await tagTopics(user.id, 30) });
    if (body?.action === "reconnect" && Number.isInteger(body.contactId)) {
      const r = await draftReconnect(user.id, body.contactId as number);
      return NextResponse.json({ drafted: !!r.draft, reason: r.reason });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  });
}
