import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, giveConsent, requestMeta, sameSiteJson } from "@/lib/copytrade/access";

export const dynamic = "force-dynamic";

/** POST { kind: "terms" | "trading" } — record that the person accepted the current text (stored with its version and hash, and audited). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const kind = ((await req.json().catch(() => ({}))) as { kind?: unknown }).kind;
    if (kind !== "terms" && kind !== "trading") return NextResponse.json({ error: "Unknown consent." }, { status: 400 });
    await giveConsent(user, kind, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
