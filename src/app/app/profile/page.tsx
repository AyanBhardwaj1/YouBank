import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { OnboardingWizard } from "@/components/workspace/OnboardingWizard";
import type { Profile, RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const initial: Partial<Profile> | null = p ? { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals } : null;
  return (
    <main className="h-full overflow-auto px-6 py-8">
      <OnboardingWizard initial={initial} userName={user.name} />
    </main>
  );
}
