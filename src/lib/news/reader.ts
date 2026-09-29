/** Everything needed to rank stories for one person: their profile, preferences, desk, watchlist and network. */
import { and, eq, isNull, ne } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { workspaceFor, type Profile, type RoleId } from "@/lib/roles";
import { allDesks, deskFor, type Desk } from "./desks";
import { normalizeNewsPrefs, type NewsPrefs } from "./prefs";
import { normCompany, type NetworkPerson, type Reader } from "./rank";

export type ReaderContext = { userId: string; email: string; name: string; profile: Profile; prefs: NewsPrefs; desk: Desk; ownDesk: Desk; watchlist: string[]; reader: Reader; extra: Record<string, unknown> };

export function profileOf(p: typeof schema.profiles.$inferSelect): Profile {
  return { role: p.role as RoleId, specialty: p.specialty, seniority: p.seniority, firmType: p.firmType, firmName: p.firmName, firmTicker: p.firmTicker, sectors: p.sectors, goals: p.goals, name: p.name };
}

export async function networkOf(userId: string): Promise<Map<string, NetworkPerson[]>> {
  const rows = await requireDb().select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, company: schema.crmContacts.company })
    .from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), isNull(schema.crmContacts.optedOutAt), ne(schema.crmContacts.company, "")));
  const m = new Map<string, NetworkPerson[]>();
  for (const r of rows) {
    const key = normCompany(r.company);
    if (key.length < 3) continue;
    m.set(key, [...(m.get(key) ?? []), { contactId: r.id, name: r.name || r.email, company: r.company }]);
  }
  return m;
}

export function readerFromParts(profile: Profile, prefs: NewsPrefs, network: Map<string, NetworkPerson[]>): { desk: Desk; ownDesk: Desk; watchlist: string[]; reader: Reader } {
  const ownDesk = deskFor(profile);
  const desk = (prefs.desk && allDesks().find((d) => d.id === prefs.desk)) || ownDesk;
  const watchlist = [...new Set([...(profile.firmTicker ? [profile.firmTicker.toUpperCase()] : []), ...workspaceFor(profile).watchlist, ...prefs.follows.tickers])];
  return { desk, ownDesk, watchlist, reader: { desk, watch: new Set(watchlist), follows: prefs.follows, mutes: prefs.mutes, network } };
}

export async function readerFor(userId: string): Promise<ReaderContext | null> {
  const [p] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (!p) return null;
  const profile = profileOf(p);
  const extra = (p.extra ?? {}) as Record<string, unknown>;
  const prefs = normalizeNewsPrefs(extra.news, profile);
  const parts = readerFromParts(profile, prefs, await networkOf(userId).catch(() => new Map()));
  return { userId, email: p.email, name: p.name, profile, prefs, extra, ...parts };
}
