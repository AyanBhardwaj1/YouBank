import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { getMeetingSettings, saveMeetingSettings } from "@/lib/meetings/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await getMeetingSettings(user.id)));
}

/** Save the copilot settings. Turning on auto-join for the notetaker needs its plan, since it spends on its own. */
export async function PUT(req: Request) {
  return guarded(async (user) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "bad request" }, { status: 400 });
    if ((body as { autoJoin?: unknown }).autoJoin === true && !(await getMeetingSettings(user.id)).autoJoin) await requireFeature(user, "meetings.bot");
    return NextResponse.json(await saveMeetingSettings(user.id, body));
  });
}
