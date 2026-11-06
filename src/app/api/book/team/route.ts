import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { listMembers, myTeams, requireTeam } from "@/lib/teams/db";
import { setBookShare, sharesOf, teamBook } from "@/lib/book/store";
import { requireDb, schema } from "@/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET (no team): the person's teams and which they share their book with. GET ?team=ID: that team's
 * shared books, read-only, for anyone on the team (src/lib/book/store.ts teamBook). Only books their
 * owners chose to share appear.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const id = Number(new URL(req.url).searchParams.get("team"));
    if (!id) {
      const [teams, [row]] = await Promise.all([myTeams(user.id), requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id))]);
      return NextResponse.json({ teams: teams.map((t) => ({ id: t.id, name: t.name, members: t.memberCount })), sharing: sharesOf(row?.extra as Record<string, unknown>) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    await requireTeam(id, user.id, "view");
    await rateLimit(`book-team:${user.id}`, 120, 3_600_000, "The team book was checked many times this hour. Try again in a few minutes.");
    const members = await listMembers(id);
    return NextResponse.json({ ...(await teamBook(id, members.map((m) => ({ userId: m.userId, name: m.name, email: m.email })))), memberCount: members.length }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** POST { team, share }: share the book with a team the person belongs to, or stop. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { team?: unknown; share?: unknown };
    const id = Number(b.team);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a team." }, { status: 400 });
    // Stopping is always allowed (even after leaving the team); starting needs membership.
    if (b.share === true) await requireTeam(id, user.id, "view");
    return NextResponse.json({ sharing: await setBookShare(user.id, id, b.share === true) });
  });
}
