import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { activeTeam, myTeams, type TeamSummary } from "@/lib/teams/db";
import { TeamClient } from "@/components/workspace/TeamClient";
// Drizzle keeps Postgres's "relation does not exist" on the error's cause, so the check lives in lib/errors.
import { isMissingTable } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");

  let teams: TeamSummary[] = [];
  let needsMigration = false;
  try {
    teams = await myTeams(user.id);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    needsMigration = true;
  }

  let activeTeamId: number | null = null;
  if (!needsMigration) {
    const [p] = await db.select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).catch(() => []);
    activeTeamId = await activeTeam(user.id, p?.extra ?? null).catch(() => null);
  }

  return <TeamClient me={{ id: user.id, email: user.email, name: user.name }} teams={teams} activeTeamId={activeTeamId} needsMigration={needsMigration} />;
}
