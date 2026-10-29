import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { edgeProfile, saveEdge, type Blend } from "@/lib/edge/access";
import { edgeState } from "@/lib/edge/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Edge for this person: their watches and limits, and what they can watch. */
export async function GET() {
  return guarded(async (user) => {
    const p = await edgeProfile(user.id);
    if (!p) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 400 });
    return NextResponse.json(await edgeState(user.id, p.prefs.beta, p.prefs.since, p.prefs.blend));
  });
}

/** Change how the feed is ranked. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { blend?: Partial<Blend> } | null;
    if (!body) return NextResponse.json({ error: "That request was incomplete. Reload the page and try again." }, { status: 400 });
    let prefs = (await edgeProfile(user.id))?.prefs;
    if (!prefs) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 400 });
    if (body.blend && typeof body.blend === "object") prefs = await saveEdge(user.id, { blend: body.blend });
    return NextResponse.json(await edgeState(user.id, prefs.beta, prefs.since, prefs.blend));
  });
}
