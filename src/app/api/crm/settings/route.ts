import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { mailboxAddresses } from "@/lib/crm/db";
import { getSettings, internalDomains, saveSettings } from "@/lib/crm/settings";

export const dynamic = "force-dynamic";

/** Settings, plus the coworker domains in effect when none were set by hand. */
export async function GET() {
  return guarded(async (user) => {
    const [settings, mailboxes] = await Promise.all([getSettings(user.id), mailboxAddresses(user.id)]);
    const { lockUntil: _lock, ...rest } = settings;
    void _lock;
    return NextResponse.json({ ...rest, effectiveInternalDomains: internalDomains(settings, mailboxes) });
  });
}

export async function PUT(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await saveSettings(user.id, {
      instructions: body.instructions as string | undefined, knowledge: body.knowledge as string | undefined, voice: body.voice as string | undefined,
      followUpDays: body.followUpDays as number | undefined, staleDealDays: body.staleDealDays as number | undefined, nightly: body.nightly as boolean | undefined,
      mode: body.mode as string | undefined, about: body.about as string | undefined, signature: body.signature as string | undefined,
      internalDomains: body.internalDomains as string[] | undefined, autopilot: body.autopilot,
    }));
  });
}
