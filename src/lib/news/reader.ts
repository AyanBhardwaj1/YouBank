/** Everything needed to rank stories for one person: their profile, preferences, desk, watchlist, network and what their reading has taught the page. */
import { and, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { memo } from "@/lib/memo";
import { workspaceFor, type Profile, type RoleId } from "@/lib/roles";
import { companiesOf, EMPTY_AFFINITY, learnAffinity, WINDOW_DAYS, type Affinity, type Signal } from "./affinity";
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

/**
 * The person's last 60 days of reading, saving, hiding and following, as signals for the affinity
 * model. One indexed read of their own rows (at most 600 stories), joined to each story's tags.
 */
export async function signalsOf(userId: string): Promise<Signal[]> {
  const db = requireDb();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const cols = { desks: schema.newsClusters.desks, tickers: schema.newsClusters.tickers, entities: schema.newsClusters.entities, category: schema.newsClusters.category };
  const [acts, follows] = await Promise.all([
    db.select({ readAt: schema.newsUserItems.readAt, savedAt: schema.newsUserItems.savedAt, hiddenAt: schema.newsUserItems.hiddenAt, ...cols })
      .from(schema.newsUserItems).innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsUserItems.clusterId))
      .where(and(eq(schema.newsUserItems.userId, userId), gte(schema.newsUserItems.updatedAt, since), or(sql`${schema.newsUserItems.readAt} is not null`, sql`${schema.newsUserItems.savedAt} is not null`, sql`${schema.newsUserItems.hiddenAt} is not null`)))
      .limit(600),
    db.select({ at: schema.newsFollows.createdAt, ...cols }).from(schema.newsFollows).innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsFollows.clusterId))
      .where(eq(schema.newsFollows.userId, userId)).limit(100).catch(() => []),
  ]);
  const out: Signal[] = [];
  const of = (r: { desks: string[]; tickers: string[]; entities: typeof schema.newsClusters.$inferSelect["entities"]; category: string }) => ({ tags: r.desks, tickers: r.tickers, companies: companiesOf(r.entities), category: r.category });
  for (const r of acts) {
    if (r.readAt) out.push({ kind: "read", at: r.readAt, ...of(r) });
    if (r.savedAt) out.push({ kind: "save", at: r.savedAt, ...of(r) });
    if (r.hiddenAt) out.push({ kind: "hide", at: r.hiddenAt, ...of(r) });
  }
  for (const f of follows) out.push({ kind: "follow", at: f.at, ...of(f) });
  return out;
}

/** The learned affinities, reused for two minutes per instance (the feed polls every minute). */
export const affinityOf = (userId: string): Promise<Affinity> =>
  memo(`news:affinity:${userId}`, 120_000, async () => learnAffinity(await signalsOf(userId))).catch(() => EMPTY_AFFINITY);

export function readerFromParts(profile: Profile, prefs: NewsPrefs, network: Map<string, NetworkPerson[]>, affinity?: Affinity): { desk: Desk; ownDesk: Desk; watchlist: string[]; reader: Reader } {
  const ownDesk = deskFor(profile);
  const desk = (prefs.desk && allDesks().find((d) => d.id === prefs.desk)) || ownDesk;
  const watchlist = [...new Set([...(profile.firmTicker ? [profile.firmTicker.toUpperCase()] : []), ...workspaceFor(profile).watchlist, ...prefs.follows.tickers])];
  return { desk, ownDesk, watchlist, reader: { desk, watch: new Set(watchlist), follows: prefs.follows, mutes: prefs.mutes, network, ...(affinity ? { affinity } : {}) } };
}

export async function readerFor(userId: string): Promise<ReaderContext | null> {
  const [p] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (!p) return null;
  const profile = profileOf(p);
  const extra = (p.extra ?? {}) as Record<string, unknown>;
  const prefs = normalizeNewsPrefs(extra.news, profile);
  // Contacts change slowly; the feed polls every minute. Five minutes of reuse per instance.
  const [network, affinity] = await Promise.all([memo(`news:network:${userId}`, 300_000, () => networkOf(userId)).catch(() => new Map()), affinityOf(userId)]);
  const parts = readerFromParts(profile, prefs, network, affinity);
  return { userId, email: p.email, name: p.name, profile, prefs, extra, ...parts };
}
