import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, giveQuantConsent, hasQuantConsent, requestMeta, sameSiteJson } from "@/lib/quant/access";
import { QUANT_TERMS } from "@/lib/quant/words";

export const dynamic = "force-dynamic";

/** GET — whether the person accepted the current Quant terms, and the terms. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ accepted: await hasQuantConsent(user.id), terms: QUANT_TERMS }));
}

/** POST { accept: true } — record the consent (version, text hash, time, address). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { accept?: unknown };
    if (body.accept !== true) return NextResponse.json({ error: "Send { accept: true } to accept." }, { status: 400 });
    await giveQuantConsent(user, requestMeta(req));
    return NextResponse.json({ accepted: true, version: QUANT_TERMS.version });
  });
}
