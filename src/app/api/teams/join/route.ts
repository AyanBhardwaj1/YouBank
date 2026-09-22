import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { acceptInvite, setActiveTeam } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/** Redeem an invitation token and switch the user into that team. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    const token = body?.token?.trim();
    if (!token) return NextResponse.json({ error: "An invitation token is required" }, { status: 400 });
    const team = await acceptInvite(token, user);
    await setActiveTeam(user.id, team.id).catch(() => {}); // a missing profile row must not fail the join
    return NextResponse.json(team);
  });
}
