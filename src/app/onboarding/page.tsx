import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { OnboardingWizard } from "@/components/workspace/OnboardingWizard";
import type { Profile, RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  let initial: Partial<Profile> | null = null;
  if (db) {
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (p) initial = { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals };
  }
  return (
    <main className="flex min-h-dvh items-start justify-center px-6 py-12 text-fg">
      <OnboardingWizard initial={initial} userName={user.name} />
    </main>
  );
}
