import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { getPrefs, savePrefs, type PrefsInput } from "@/lib/calendar/prefs";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await getPrefs(user.id)));
}

/**
 * Save calendar preferences. Switching the morning auto-brief on is a premium choice and is checked
 * here; switching it off never is.
 */
export async function PATCH(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as PrefsInput | null;
    if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    if (body.autoBrief === true) await requireFeature(user, "calendar.auto_brief");
    return NextResponse.json(await savePrefs(user.id, user.email, body));
  });
}
