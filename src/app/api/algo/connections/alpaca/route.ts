import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireRecentTwoFactor } from "@/lib/auth/step-up";
import { CROSS_SITE, requestMeta, requireConsent, sameSiteJson } from "@/lib/algo/access";
import { alpacaConnectUrl } from "@/lib/algo/connections";

export const dynamic = "force-dynamic";

/** POST { env: "paper" | "live" } — a link to Alpaca's consent page (OAuth). Needs a fresh authenticator code. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireRecentTwoFactor(user);
    await requireConsent(user.id, "terms");
    const body = (await req.json().catch(() => ({}))) as { env?: unknown };
    return NextResponse.json({ url: await alpacaConnectUrl(user, body.env === "live" ? "live" : "paper", requestMeta(req)) });
  });
}
