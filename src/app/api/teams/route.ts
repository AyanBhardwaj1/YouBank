import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createTeam, myTeams } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/** Teams the signed-in user belongs to. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await myTeams(user.id)));
}

/** Create a team; the creator becomes its owner. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();
    if (!name) return NextResponse.json({ error: "A team needs a name" }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ error: "That name is too long" }, { status: 400 });
    return NextResponse.json(await createTeam(user, name), { status: 201 });
  });
}
