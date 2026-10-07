/**
 * Who a meeting is with, in Relationships terms. Pure.
 *
 * An attendee links to a contact only on their email address: a meeting with one person at a company
 * says nothing about their colleagues. Deals link more loosely, because a deal is a company: through
 * a linked contact, through any attendee from the deal contact's company domain, or through the
 * deal's name in the meeting's title ("Ledgerline <> YouBank: diligence call").
 *
 * Addresses are compared in a normal form: lower case, "+tag" dropped, and Gmail's dots ignored,
 * because calendar invitations often carry a different spelling of the address email came from.
 */
import type { Attendee } from "./types";

export const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "fastmail.com", "gmx.com", "gmx.de", "web.de", "hey.com", "zoho.com", "yandex.ru", "qq.com", "163.com",
]);

/** Addresses that are rooms, groups and calendar plumbing rather than people. */
const NOT_A_PERSON = /(@resource\.calendar\.google\.com|@group\.calendar\.google\.com|@group\.v\.calendar\.google\.com|^noreply@|^no-reply@|calendar-notification@)/i;

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase().replace(/^mailto:/, "");
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

export const isPerson = (email: string) => email.includes("@") && !NOT_A_PERSON.test(email);

export type ContactLite = { id: number; email: string; name: string; company: string; domain: string };
export type DealLite = { id: number; name: string; contactId: number | null; status?: string };

export type MeetingLinks = {
  contactIds: number[];
  dealIds: number[];
  /** Whether anyone outside the person's own organisation is invited. */
  external: boolean;
  /** Per attendee: the contact it matched, if any. */
  byEmail: Record<string, number | null>;
};

/** Lower-case words of a name, for whole-word matching in titles. */
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const LEGAL = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|ag|bv|holdings|group|technologies|labs)\b/g;

/** A deal named in a title, as a whole phrase. Short or generic names are not trusted. */
export function titleMentions(title: string, dealName: string): boolean {
  const name = words(dealName).replace(LEGAL, "").replace(/\s+/g, " ").trim();
  if (name.length < 4) return false;
  return ` ${words(title)} `.includes(` ${name} `);
}

/**
 * Link one meeting's people to contacts and deals.
 * `selfEmails` are the person's own addresses (mailboxes and calendars); their domains count as
 * internal unless they are public mail domains.
 */
export function linkMeeting(input: { title: string; organizer: Attendee | null; attendees: Attendee[] }, contacts: ContactLite[], deals: DealLite[], selfEmails: string[]): MeetingLinks {
  const self = new Set(selfEmails.map(normalizeEmail));
  const internalDomains = new Set(selfEmails.map(domainOf).filter((d) => d && !PUBLIC_DOMAINS.has(d)));
  const byNorm = new Map<string, ContactLite>();
  for (const c of contacts) byNorm.set(normalizeEmail(c.email), c);

  const people = [...(input.organizer ? [input.organizer] : []), ...input.attendees]
    .filter((a) => isPerson(a.email) && !a.self && !self.has(normalizeEmail(a.email)));
  const seen = new Set<string>();
  const byEmail: Record<string, number | null> = {};
  const contactIds: number[] = [];
  let external = false;
  const domains = new Set<string>();
  for (const a of people) {
    const n = normalizeEmail(a.email);
    if (seen.has(n)) continue;
    seen.add(n);
    const d = domainOf(n);
    if (!internalDomains.has(d)) external = true;
    if (!internalDomains.has(d) && !PUBLIC_DOMAINS.has(d)) domains.add(d);
    const c = byNorm.get(n);
    byEmail[a.email.toLowerCase()] = c?.id ?? null;
    if (c && !contactIds.includes(c.id)) contactIds.push(c.id);
  }

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const dealIds: number[] = [];
  for (const deal of deals) {
    if (deal.status && deal.status !== "open") continue;
    const dc = deal.contactId ? contactById.get(deal.contactId) : undefined;
    const dcDomain = dc ? (dc.domain || domainOf(dc.email)) : "";
    const hit = (deal.contactId !== null && contactIds.includes(deal.contactId))
      || (!!dcDomain && domains.has(dcDomain))
      || titleMentions(input.title, deal.name);
    if (hit) dealIds.push(deal.id);
  }
  return { contactIds, dealIds, external, byEmail };
}

/** A tidy display name for an attendee with no CN: "maya.ruiz@x.io" -> "Maya Ruiz". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
