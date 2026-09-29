import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { briefView } from "@/lib/news/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Today's morning brief for the person's desk (?desk= to read another), with their "for you" section. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const v = await briefView(user.id, new URL(req.url).searchParams.get("desk") ?? undefined);
    return v ? NextResponse.json(v, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
  });
}
