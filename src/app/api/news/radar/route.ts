import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { radarScreen } from "@/lib/news/radar/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A sector's radar (?sector=energy), or the person's own: lanes, the sector's deals and the map. Technology is the tech radar. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const v = await radarScreen(user.id, new URL(req.url).searchParams.get("sector") ?? undefined);
    return v ? NextResponse.json(v) : NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
  });
}
