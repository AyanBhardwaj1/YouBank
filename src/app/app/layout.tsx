import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { AppShell } from "@/components/workspace/AppShell";
import { normalizeNavPrefs } from "@/lib/nav";
import { ThemeSync } from "@/components/theme/ThemeSync";
import type { Profile, RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!db) throw new Error("DATABASE_URL is not configured");
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  if (!p?.completedAt) redirect("/onboarding");
  const profile: Profile = { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals, name: user.name };
  const extra = (p.extra ?? {}) as Record<string, unknown>;
  const savedTheme = typeof extra.theme === "string" ? extra.theme : null;
  return (
    <WorkspaceProvider profile={profile}>
      <ThemeSync theme={savedTheme} />
      <AppShell email={user.email} initialNav={normalizeNavPrefs(extra.nav, profile.role)}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
