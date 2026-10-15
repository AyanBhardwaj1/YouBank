import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, GLOBAL, killState, requestMeta, sameSiteJson, setKill } from "@/lib/algo/access";

export const dynamic = "force-dynamic";

/** POST { on, reason } — the administrators' global kill switch: no strategy of anyone trades while it is on. ADMIN_EMAILS only. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    if (!isAdmin(user)) return NextResponse.json({ error: "Only YouBank's administrators can do this." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { on?: unknown; reason?: unknown };
    await setKill(GLOBAL, body.on === true, user.email, typeof body.reason === "string" ? body.reason.slice(0, 200) : null, requestMeta(req));
    return NextResponse.json(await killState(user.id));
  });
}
