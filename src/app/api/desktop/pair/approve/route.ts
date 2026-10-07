import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { approveDesktopPairing } from "@/lib/desktop/auth";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * Approving hands a token for this account to whatever app holds the code, so only the site's own page
 * may ask: a cross-site form or script cannot (a JSON body forces a CORS preflight, and browsers mark
 * cross-site requests in Sec-Fetch-Site). Pure.
 */
function sameSiteJson(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

/** The signed-in person approves the code their desktop app shows. Browser sessions only: a connected app cannot approve another. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Approve the code on YouBank itself." }, { status: 403 });
  return guarded(async (user) => {
    // A few tries an hour is plenty for a person, and makes guessing someone else's live code hopeless.
    await rateLimit(`desktop-approve:${user.id}`, 20, 3_600_000, "Too many codes tried. Wait a while, then choose Connect again in the desktop app.");
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const r = await approveDesktopPairing(user, typeof body?.code === "string" ? body.code : "");
    return NextResponse.json({ ok: true, name: r.name, platform: r.platform });
  });
}
