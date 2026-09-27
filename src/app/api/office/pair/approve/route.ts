import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { approvePairing } from "@/lib/office/auth";

export const dynamic = "force-dynamic";

/** The signed-in person approves the code their add-in shows. Browser sessions only: an add-in cannot approve another. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const r = await approvePairing(user, typeof body?.code === "string" ? body.code : "");
    return NextResponse.json({ ok: true, host: r.host });
  });
}
