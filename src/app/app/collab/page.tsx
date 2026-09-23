import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { listSessions } from "@/lib/collab/db";
import { myTeams } from "@/lib/teams/db";
import { toolsFor } from "@/lib/workflows/registry";
import type { Profile, RoleId } from "@/lib/roles";
import { CollabList } from "@/components/collab/CollabList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared sessions" };

const isMissingTable = (e: unknown) => /relation .* does not exist|undefined_table/i.test(e instanceof Error ? e.message : String(e));

export default async function CollabPage() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");

  let sessions: Awaited<ReturnType<typeof listSessions>> = [];
  let needsMigration = false;
  try { sessions = await listSessions(user); }
  catch (e) { if (!isMissingTable(e)) throw e; needsMigration = true; }

  const teams = needsMigration ? [] : await myTeams(user.id).catch(() => []);
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const profile: Profile = {
    role: (p?.role ?? "banker") as RoleId, specialty: p?.specialty ?? "", seniority: p?.seniority ?? "",
    firmType: p?.firmType ?? "", firmName: p?.firmName ?? "", firmTicker: p?.firmTicker ?? "",
    sectors: p?.sectors ?? [], goals: p?.goals ?? "", name: user.name,
  };
  // Only id and title cross to the browser; the tool definitions stay on the server.
  const tools = toolsFor(profile).slice(0, 60).map((t) => ({ id: t.id, title: t.title, kind: t.kind }));

  return (
    <CollabList
      needsMigration={needsMigration}
      me={{ id: user.id, name: user.name || user.email }}
      sessions={sessions.map((s) => ({ id: s.id, title: s.title, kind: s.kind, refId: s.refId, teamId: s.teamId, status: s.status, ownerId: s.ownerId, updatedAt: s.updatedAt.toISOString() }))}
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      tools={tools}
    />
  );
}
