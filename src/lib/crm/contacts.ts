import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { enrichCompany } from "./agent";
import { companyDomain, CONTACT_KINDS } from "./model";
import { contactActivity } from "./nurture";
import { optOutContact, upsertContact, type ContactRow } from "./db";

/** Contacts with their email activity and recent signals, for the Contacts tab. */
export async function contactsOverview(userId: string) {
  const db = requireDb();
  const [contacts, activity, signals] = await Promise.all([
    db.select().from(schema.crmContacts).where(eq(schema.crmContacts.userId, userId)).orderBy(desc(schema.crmContacts.lastSeenAt)).limit(500),
    contactActivity(userId),
    db.select().from(schema.crmSignals).where(eq(schema.crmSignals.userId, userId)).orderBy(desc(schema.crmSignals.createdAt)).limit(200),
  ]);
  const byId = new Map(activity.map((a) => [a.contactId, a]));
  return contacts.map((c) => {
    const a = byId.get(c.id);
    return {
      ...c,
      lastContactAt: a?.lastContactAt ?? null, lastSentAt: a?.lastSentAt ?? null, exchanges: a?.exchanges ?? 0,
      signals: signals.filter((s) => s.contactId === c.id).slice(0, 3),
    };
  });
}

/**
 * Add someone by hand, with notes the agent will use when it writes to them. Their company is
 * matched against the directory the same way an inbound sender's is.
 */
export async function addContact(userId: string, input: { email: string; name?: string; title?: string; company?: string; kind?: string; notes?: string }): Promise<ContactRow> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new Error("That is not an email address");
  const match = await enrichCompany(input.company ?? "", companyDomain(email)).catch(() => null);
  const contact = await upsertContact(userId, {
    email, name: input.name, title: input.title, company: input.company || match?.name || "",
    kind: (CONTACT_KINDS as readonly string[]).includes(input.kind ?? "") ? input.kind : "unknown", startupId: match?.id ?? null,
  });
  if (input.notes?.trim()) return updateContact(userId, contact.id, { notes: input.notes });
  return contact;
}

export async function updateContact(userId: string, id: number, fields: {
  name?: string; title?: string; company?: string; kind?: string; notes?: string; optedOut?: boolean;
}): Promise<ContactRow> {
  const db = requireDb();
  if (fields.optedOut === true) await optOutContact(userId, id);
  const set: Partial<ContactRow> = { updatedAt: new Date() };
  if (fields.name !== undefined) set.name = fields.name.trim().slice(0, 200);
  if (fields.title !== undefined) set.title = fields.title.trim().slice(0, 200);
  if (fields.company !== undefined) set.company = fields.company.trim().slice(0, 200);
  if (fields.kind !== undefined && (CONTACT_KINDS as readonly string[]).includes(fields.kind)) set.kind = fields.kind;
  if (fields.notes !== undefined) set.notes = fields.notes.slice(0, 4000);
  // Only a person clears an opt-out, and only by saying so explicitly.
  if (fields.optedOut === false) set.optedOutAt = null;
  const [row] = await db.update(schema.crmContacts).set(set)
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.userId, userId))).returning();
  if (!row) throw new Error("Contact not found");
  return row;
}
