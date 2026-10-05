import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { approveDesktopPairing } from "@/lib/desktop/auth";

export const dynamic = "force-dynamic";

/** The signed-in person approves the code their desktop app shows. Browser sessions only: a connected app cannot approve another. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const r = await approveDesktopPairing(user, typeof body?.code === "string" ? body.code : "");
    return NextResponse.json({ ok: true, name: r.name, platform: r.platform });
  });
}
