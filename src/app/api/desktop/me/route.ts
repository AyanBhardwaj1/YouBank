import { NextResponse } from "next/server";
import { entitlements } from "@/lib/billing/entitlements";
import { DESKTOP_FEATURES } from "@/lib/billing/features/desktop";
import { PLANS } from "@/lib/billing/plans";
import { guardedDesktop, revokeDesktopDevice, saveDeviceTasks } from "@/lib/desktop/auth";
import { fileQuota } from "@/lib/desktop/files";
import { TASK_IDS } from "@/lib/desktop/tasks";

export const dynamic = "force-dynamic";

/** Who the app is connected as, what their plan unlocks on desktop, and this computer's task switches. A 401 tells it to connect again. */
export async function GET(req: Request) {
  return guardedDesktop(req, async (user, device) => {
    const [e, files] = await Promise.all([entitlements(user), fileQuota(user)]);
    return NextResponse.json({
      user: { name: user.name, email: user.email },
      plan: { id: e.plan, name: PLANS[e.plan].name, admin: e.admin },
      features: Object.fromEntries(DESKTOP_FEATURES.map((f) => [f.id, { unlocked: e.features.includes(f.id), name: f.name, description: f.description, plan: PLANS[f.minPlan].name }])),
      files,
      device: device ? { id: device.id, name: device.name, tasks: device.settings.tasks ?? {} } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}

/** Save which scheduled tasks are on for this computer: { tasks: { "edge-brief": true, ... } }. */
export async function PUT(req: Request) {
  return guardedDesktop(req, async (_user, device) => {
    const body = (await req.json().catch(() => null)) as { tasks?: unknown } | null;
    if (!device || !body?.tasks || typeof body.tasks !== "object") return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json({ tasks: await saveDeviceTasks(device, body.tasks as Record<string, unknown>, TASK_IDS) });
  }, { device: "required" });
}

/** The app signs out: its own token is revoked, so a copy left in a keychain backup is useless. */
export async function DELETE(req: Request) {
  return guardedDesktop(req, async (user, device) => {
    if (device) await revokeDesktopDevice(user.id, device.id);
    return NextResponse.json({ ok: true });
  }, { device: "required" });
}
