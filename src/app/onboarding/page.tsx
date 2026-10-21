import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { OnboardingWizard } from "@/components/workspace/OnboardingWizard";
import type { Profile, RoleId } from "@/lib/roles";
import { SetupScreen } from "@/components/ui/SetupScreen";
import { setupState } from "@/lib/setup";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await setupState()).ready) return <SetupScreen />;
  const user = await currentUser();
  const next = safeNext((await searchParams).next);
  if (!user) redirect(next === "/app" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
  let initial: Partial<Profile> | null = null;
  if (db) {
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (p) initial = { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals };
  }
  return (
    <main className="flex min-h-dvh items-start justify-center px-6 py-12 text-fg">
      <OnboardingWizard initial={initial} userName={user.name} next={next} />
    </main>
  );
}
