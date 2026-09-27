import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listDevices, revokeDevice } from "@/lib/office/auth";

export const dynamic = "force-dynamic";

/** The Excel and PowerPoint installs connected to this account. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ devices: await listDevices(user.id) }));
}

/** Disconnect one: its token stops working at once. */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await revokeDevice(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
