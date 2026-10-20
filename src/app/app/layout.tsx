import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { AppShell } from "@/components/workspace/AppShell";
import { normalizeNavPrefs } from "@/lib/nav";
import { catalogFor } from "@/lib/workflows/catalog";
import { edgePrefs } from "@/lib/edge/access";
import { ThemeSync } from "@/components/theme/ThemeSync";
import { SetupScreen } from "@/components/ui/SetupScreen";
import { isMissingTable } from "@/lib/errors";
import { setupState } from "@/lib/setup";
import type { Profile, RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A deploy ahead of its database (no DATABASE_URL, or the schema not pushed yet) shows a calm
  // "being set up" screen; /api/health tells the operator what is missing.
  if (!(await setupState()).ready) return <SetupScreen />;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!db) return <SetupScreen />;
  let p: typeof schema.profiles.$inferSelect | undefined;
  try {
    [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  } catch (e) {
    if (isMissingTable(e)) return <SetupScreen />;
    throw e;
  }
  if (!p?.completedAt) redirect("/onboarding");
  const profile: Profile = { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals, name: user.name };
  const extra = (p.extra ?? {}) as Record<string, unknown>;
  const savedTheme = typeof extra.theme === "string" ? extra.theme : null;
  const edge = edgePrefs(extra, profile.role).beta;
  return (
    <WorkspaceProvider profile={profile} edge={edge} tools={catalogFor(profile)}>
      <ThemeSync theme={savedTheme} />
      {/* Keyed on the beta switch so turning Edge on or off rebuilds the bars with it. */}
      <AppShell key={edge ? "edge" : "base"} email={user.email} edge={edge} initialNav={normalizeNavPrefs(extra.nav, profile.role, { edge })}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
