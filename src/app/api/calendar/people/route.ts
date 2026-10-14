import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { meetingSummaries, meetingsFor } from "@/lib/calendar/meetings";

export const dynamic = "force-dynamic";

/**
 * Meetings for Relationships.
 * - No parameters: "last met" and "next meeting" for every linked contact and deal.
 * - ?contactId= or ?dealId=: that one's upcoming meetings and the last few past ones.
 * Answers with empty results (not an error) before the calendar tables exist.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const contactId = Number(q.get("contactId") ?? 0), dealId = Number(q.get("dealId") ?? 0);
    try {
      if (contactId > 0 || dealId > 0) return NextResponse.json(await meetingsFor(user.id, contactId > 0 ? { contactId } : { dealId }));
      return NextResponse.json(await meetingSummaries(user.id));
    } catch (e) {
      const text = e instanceof Error ? `${e.message} ${(e.cause as Error | undefined)?.message ?? ""}` : "";
      if (/relation .* does not exist/i.test(text)) return NextResponse.json(contactId || dealId ? { upcoming: [], past: [] } : { contacts: {}, deals: {} });
      throw e;
    }
  });
}
