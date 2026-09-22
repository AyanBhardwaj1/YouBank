import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { setActiveTeam } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/** Switch the active workspace. A null teamId returns the user to their personal work. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { teamId?: number | null } | null;
    const teamId = body?.teamId ?? null;
    if (teamId !== null && !Number.isInteger(teamId)) return NextResponse.json({ error: "teamId must be a number or null" }, { status: 400 });
    await setActiveTeam(user.id, teamId);
    return NextResponse.json({ ok: true, teamId });
  });
}
