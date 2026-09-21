import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { workspaceFor, type Profile, type RoleId } from "@/lib/roles";
import { normalizePrefs, type AiPrefs } from "./models";

export type UserContext = { profile: Profile | null; persona: string; prefs: AiPrefs; theme: string | null };

/** Everything the AI layer needs about the signed-in user: profile-derived persona, model preferences, theme. */
export async function loadUserContext(userId: string): Promise<UserContext> {
  if (!db) return { profile: null, persona: "", prefs: {}, theme: null };
  try {
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    if (!p) return { profile: null, persona: "", prefs: {}, theme: null };
    const profile: Profile = { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals, name: p.name };
    const extra = (p.extra ?? {}) as Record<string, unknown>;
    const persona = p.completedAt ? workspaceFor(profile).persona + (p.goals ? ` Their stated goals: ${p.goals.slice(0, 400)}` : "") : "";
    return { profile, persona, prefs: normalizePrefs(extra.ai), theme: typeof extra.theme === "string" ? extra.theme : null };
  } catch {
    return { profile: null, persona: "", prefs: {}, theme: null };
  }
}

/** Back-compat helper. */
export async function loadPersona(userId: string): Promise<string> {
  return (await loadUserContext(userId)).persona;
}
