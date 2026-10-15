import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, killState, requestMeta, sameSiteJson, setKill } from "@/lib/algo/access";

export const dynamic = "force-dynamic";

/** GET — the person's and the global kill switch. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await killState(user.id)));
}

/** POST { on, reason? } — the person's kill switch: every strategy stops trading; on cancels unsent batches. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { on?: unknown; reason?: unknown };
    await setKill(user.id, body.on === true, user.email, typeof body.reason === "string" ? body.reason.slice(0, 200) : null, requestMeta(req));
    return NextResponse.json(await killState(user.id));
  });
}
