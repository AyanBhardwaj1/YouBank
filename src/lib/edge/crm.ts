/**
 * Edge's findings on the companies where people's contacts work, into Relationships. A finding about a
 * company (a ground change at its plants, a deal it is in, a rewritten filing, a red flag, a model's
 * pick) becomes a signal on each contact there, shown on the contact and read by the reconnection
 * writer, and on any open deal in the pipeline named for that company. A big finding also suggests
 * reconnecting, for approval; nothing is sent by this.
 */
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { recordAction } from "@/lib/crm/db";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { memo } from "@/lib/memo";
import { normCompany, type NetworkPerson } from "@/lib/news/rank";
import { networkOf } from "@/lib/news/reader";
import { appOrigin } from "./alerts";
import { BETA_ON } from "./watches";

type Detection = typeof schema.edgeDetections.$inferSelect;

/** An SEC registrant's name as people write it: "ONEOK INC /NEW/" is ONEOK Inc, "L.P." is LP. Pure. */
export function plainRegistrant(name: string): string {
  return name.replace(/\s*\/[A-Z]{2,}\/?\s*$/i, "").replace(/\bL\.\s?P\.?(?=\s|$)/gi, "LP").replace(/\bL\.\s?L\.\s?C\.?(?=\s|$)/gi, "LLC").trim();
}

/** The companies a finding is about, by name: its tickers' registrants and the names in its picture. */
export async function companiesOf(d: Pick<Detection, "tickers" | "visual">): Promise<string[]> {
  const v = d.visual as { site?: { company?: string }; company?: { name?: string }; subject?: { name?: string }; name?: string; parties?: { label?: string; companies?: string[] }[] };
  const names = new Set<string>();
  for (const t of d.tickers.slice(0, 6)) { const r = await resolveTicker(t).catch(() => null); if (r?.name) names.add(plainRegistrant(r.name)); }
  for (const n of [v.site?.company, v.company?.name, v.subject?.name, typeof v.name === "string" ? v.name : undefined]) if (n) names.add(n);
  for (const p of v.parties ?? []) { if (p.label) names.add(p.label); for (const c of p.companies ?? []) names.add(c); }
  return [...names];
}

/** The people in a network at any of these companies, at most three. Pure. */
export function peopleAt(network: Map<string, NetworkPerson[]>, companies: string[]): NetworkPerson[] {
  const seen = new Set<number>();
  return companies.map(normCompany).filter((k) => k.length >= 3).flatMap((k) => network.get(k) ?? []).filter((p) => !seen.has(p.contactId) && !!seen.add(p.contactId)).slice(0, 3);
}

export async function noteFindingsForNetworks(found: Detection[], big: (d: Detection) => boolean): Promise<number> {
  if (!found.length) return 0;
  const users = (await requireDb().execute(sql`select profiles.user_id from profiles where ${BETA_ON} and exists (select 1 from crm_contacts c where c.user_id = profiles.user_id and c.company <> '') limit 500`)).rows as { user_id: string }[];
  if (!users.length) return 0;
  const companies = new Map<number, string[]>();
  for (const d of found) companies.set(d.id, await companiesOf(d));
  const url = `${appOrigin()}/app/edge?view=feed`;
  let n = 0;
  for (const { user_id: userId } of users) {
    try {
      const network = await memo(`news:network:${userId}`, 300_000, () => networkOf(userId));
      const deals = await requireDb().select({ id: schema.crmDeals.id, name: schema.crmDeals.name }).from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.status, "open"))).limit(500);
      for (const d of found) {
        if (d.ownerId && d.ownerId !== userId) continue;
        const keys = new Set((companies.get(d.id) ?? []).map(normCompany).filter((k) => k.length >= 3));
        for (const deal of deals.filter((x) => keys.has(normCompany(x.name))).slice(0, 3)) {
          // A deal's signal has no contact, so the unique index cannot catch a repeat; check first.
          const [had] = await requireDb().select({ id: schema.crmSignals.id }).from(schema.crmSignals).where(and(eq(schema.crmSignals.userId, userId), eq(schema.crmSignals.dealId, deal.id), eq(schema.crmSignals.sourceKey, `edge:${d.id}`))).limit(1);
          if (had) continue;
          await requireDb().insert(schema.crmSignals).values({ userId, dealId: deal.id, kind: "edge", sourceKey: `edge:${d.id}`, title: d.title.slice(0, 300), detail: d.summary.slice(0, 1000), url, strength: "name", occurredAt: d.observedAt ?? d.detectedAt });
          n++;
        }
        for (const person of peopleAt(network, companies.get(d.id) ?? [])) {
          const [signal] = await requireDb().insert(schema.crmSignals).values({
            userId, contactId: person.contactId, kind: "edge", sourceKey: `edge:${d.id}`, title: d.title.slice(0, 300), detail: d.summary.slice(0, 1000), url, strength: "name", occurredAt: d.observedAt ?? d.detectedAt,
          }).onConflictDoNothing().returning({ id: schema.crmSignals.id });
          if (!signal) continue;
          n++;
          if (!big(d)) continue;
          await recordAction(userId, {
            kind: "reconnect", title: `Edge found something at ${person.company}: reconnect with ${person.name}?`.slice(0, 300), reasoning: `${d.title}. ${d.summary.slice(0, 600)}`,
            uncertainties: [`Matched on the company name. Check that ${person.name} works at the ${person.company} in the finding.`],
            payload: { contactId: person.contactId, signalId: signal.id, url }, dedupeKey: `reconnect:edge:${d.id}:${person.contactId}`, contactId: person.contactId,
          });
        }
      }
    } catch (e) { logError(e, { where: "edge-crm-signals" }); }
  }
  return n;
}
