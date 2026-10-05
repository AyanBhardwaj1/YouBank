import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listDesktopDevices, revokeDesktopDevice } from "@/lib/desktop/auth";

export const dynamic = "force-dynamic";

/** The computers connected to this account through the desktop app. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ devices: await listDesktopDevices(user.id) }));
}

/** Disconnect one: its token stops working at once, and its scheduled tasks with it. */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await revokeDesktopDevice(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
