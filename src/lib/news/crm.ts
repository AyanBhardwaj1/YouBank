/**
 * News about people you know, into Relationships: a story naming a company where a contact works
 * becomes a signal on that contact and a suggestion to reconnect. Approving it drafts the note with
 * the story as its reason (the reconnection writer reads the contact's recent signals), for review,
 * never sent on its own.
 */
import { requireDb, schema } from "@/db";
import { recordAction } from "@/lib/crm/db";
import type { NetworkPerson } from "./rank";
import type { ClusterRow } from "./store";

export async function noteNewsForNetwork(userId: string, c: Pick<ClusterRow, "id" | "headline" | "summary" | "firstSeenAt">, people: NetworkPerson[], url: string): Promise<number> {
  let n = 0;
  for (const person of people.slice(0, 3)) {
    const [signal] = await requireDb().insert(schema.crmSignals).values({
      userId, contactId: person.contactId, kind: "news", sourceKey: `news:${c.id}`, title: c.headline.slice(0, 300),
      detail: [c.summary?.bullets?.join(" "), c.summary?.why].filter(Boolean).join(" ").slice(0, 1000), url, strength: "name", occurredAt: c.firstSeenAt,
    }).onConflictDoNothing().returning();
    if (!signal) continue;
    n++;
    await recordAction(userId, {
      kind: "reconnect",
      title: `${person.company} is in the news: reconnect with ${person.name}?`,
      reasoning: `${c.headline}.${c.summary?.why ? ` ${c.summary.why}` : ""}`,
      uncertainties: [`Matched on the company name. Check that the story is about the ${person.company} ${person.name} works at.`],
      payload: { contactId: person.contactId, signalId: signal.id, url },
      dedupeKey: `reconnect:news:${c.id}:${person.contactId}`,
      contactId: person.contactId,
    });
  }
  return n;
}
