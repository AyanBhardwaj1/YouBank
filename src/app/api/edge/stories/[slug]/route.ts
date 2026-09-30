import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { setVisibility } from "@/lib/edge/story";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/** Share a story: { visibility: "private" | "team" | "link", teamId? }. Owners only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { visibility?: string; teamId?: number | null };
    const visibility = (["private", "team", "link"] as const).find((v) => v === body.visibility);
    if (!visibility) return NextResponse.json({ error: "Choose private, team or link." }, { status: 400 });
    const teamId = visibility === "team" ? Number(body.teamId) : null;
    if (visibility === "team" && !(await myTeamIds(user.id)).includes(teamId!)) return NextResponse.json({ error: "Pick one of your teams." }, { status: 400 });
    const row = await setVisibility(user.id, (await ctx.params).slug, visibility, teamId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ visibility: row.visibility, teamId: row.teamId });
  });
}
