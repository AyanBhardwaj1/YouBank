import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { AUTONOMY_SCOPES, type AutonomyScope } from "@/lib/crm/autopilot-rules";
import { engineOverview, resetDemotion } from "@/lib/crm/engine";
import { getSettings, saveSettings } from "@/lib/crm/settings";
import { requireFeature } from "@/lib/billing/entitlements";
import { AUTOPILOT } from "@/lib/crm/plan";

export const dynamic = "force-dynamic";

/** What the adaptive engine has learned: trust per kind of email, lessons from edits, outreach experiments. */
export async function GET() {
  return guarded(async (user) => {
    const settings = await getSettings(user.id);
    return NextResponse.json(await engineOverview(user.id, settings.autopilot.autonomy));
  });
}

/**
 * action "graduate": the person accepts a suggestion to put a proven kind of email on autopilot.
 * It turns that kind to Autopilot and the master switch on; both stay visible and reversible.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { action?: string; scope?: string } | null;
    if (body?.action !== "graduate" || !(AUTONOMY_SCOPES as readonly string[]).includes(body.scope ?? "")) {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const settings = await getSettings(user.id);
    const scope = body.scope as AutonomyScope;
    if (settings.autopilot.regulated) return NextResponse.json({ error: "Regulated mode is on, so autopilot cannot be switched on." }, { status: 400 });
    // Graduating puts a kind of email on Autopilot and switches it on: premium (relationships.autopilot), as in Settings.
    await requireFeature(user, AUTOPILOT);
    const next = await saveSettings(user.id, { autopilot: { ...settings.autopilot, enabled: true, autonomy: { ...settings.autopilot.autonomy, [scope]: "auto" } } });
    await resetDemotion(user.id, scope);
    return NextResponse.json({ ok: true, autopilot: next.autopilot });
  });
}
