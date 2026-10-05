import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { publicMeeting, meetingList } from "@/lib/meetings/views";
import { sendBot } from "@/lib/meetings/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const positive = (v: string | null) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };

/** The person's meetings (?contactId= or ?dealId= for one contact's or deal's), what they may use, and their settings. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    return NextResponse.json(await meetingList(user, { contactId: positive(q.get("contactId")), dealId: positive(q.get("dealId")) }), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Send the notetaker to a meeting link: { meetingUrl, title?, contactIds?, dealIds? }. Premium; billed per hour. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { meetingUrl?: unknown; title?: unknown; contactIds?: unknown; dealIds?: unknown } | null;
    if (typeof body?.meetingUrl !== "string") return NextResponse.json({ error: "Paste the meeting link." }, { status: 400 });
    const m = await sendBot(user, { meetingUrl: body.meetingUrl, title: typeof body.title === "string" ? body.title : "", contactIds: body.contactIds, dealIds: body.dealIds });
    return NextResponse.json({ meeting: publicMeeting(m) });
  });
}
