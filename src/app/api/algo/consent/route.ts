import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, giveConsent, requestMeta, sameSiteJson } from "@/lib/algo/access";

export const dynamic = "force-dynamic";

/** POST { kind: "terms" | "live" } — record that the person accepted this version of the text. (Autonomous consent is per strategy, given when switching its mode.) */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown };
    if (body.kind !== "terms" && body.kind !== "live") return NextResponse.json({ error: "Choose which text you accept." }, { status: 400 });
    await giveConsent(user, body.kind, 0, null, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
