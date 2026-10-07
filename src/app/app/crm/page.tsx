import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { crmCounts } from "@/lib/crm/db";
import { CrmWorkspace } from "@/components/crm/CrmWorkspace";
import { aiStatus } from "@/lib/ai/config";
import { loadUserContext } from "@/lib/ai/persona";
// Drizzle keeps Postgres's "relation does not exist" on the error's cause, so the check lives in lib/errors.
import { isMissingTable } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relationships" };

/** `connected` and `error` come back on the OAuth redirect; passing them as props avoids a hydration mismatch. */
export default async function CrmPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string; tab?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  let needsMigration = false;
  try { await crmCounts(user.id); } catch (e) { if (!isMissingTable(e)) throw e; needsMigration = true; }
  const ctx = await loadUserContext(user.id);
  const ai = aiStatus(ctx.prefs);
  const { connected, error, tab } = await searchParams;
  return <CrmWorkspace needsMigration={needsMigration} aiConfigured={!!ai?.configured} connected={connected ?? null} oauthError={error ?? null} initialTab={tab ?? null} />;
}
