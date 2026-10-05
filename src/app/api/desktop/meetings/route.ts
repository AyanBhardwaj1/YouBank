import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { startDesktopMeeting } from "@/lib/meetings/pipeline";
import { meetingList, publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";

/** For the desktop app: recent meetings, the copilot settings, and what this person may use. */
export async function GET(req: Request) {
  return guardedDesktop(req, async (user) => {
    const r = await meetingList(user);
    return NextResponse.json({ ...r, meetings: r.meetings.slice(0, 20) }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}

/**
 * Start capturing a meeting, after the person agreed to the consent prompt on this computer (or set
 * this app to start on its own): { platform, appTitle, title?, consent: { noticeCopied, auto }, contactIds?, dealIds? }.
 * Refused when the person's never-record settings cover it, or when no transcription is set up.
 */
export async function POST(req: Request) {
  return guardedDesktop(req, async (user, device) => {
    const body = (await req.json().catch(() => null)) as { platform?: unknown; appTitle?: unknown; title?: unknown; consent?: { noticeCopied?: unknown; auto?: unknown }; contactIds?: unknown; dealIds?: unknown } | null;
    if (!body?.consent || typeof body.consent !== "object") return NextResponse.json({ error: "Agree to the recording notice first." }, { status: 400 });
    const m = await startDesktopMeeting(user, device?.id ?? null, {
      platform: typeof body.platform === "string" ? body.platform : "other",
      appTitle: typeof body.appTitle === "string" ? body.appTitle : "", title: typeof body.title === "string" ? body.title : "",
      consent: { noticeCopied: body.consent.noticeCopied === true, auto: body.consent.auto === true },
      contactIds: body.contactIds, dealIds: body.dealIds,
    });
    return NextResponse.json({ meeting: publicMeeting(m) });
  }, { device: "required" });
}
