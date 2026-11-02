/**
 * What commercial email needs before it leaves: campaign and nurture mail is outreach to people who did
 * not write first, so it carries the sender's postal address and a working way to stop it (CAN-SPAM),
 * and the one-click unsubscribe headers Gmail, Yahoo and Microsoft require of bulk senders (RFC 8058).
 * Replies, follow-ups in someone's own conversation and introductions are left exactly as written.
 *
 * The unsubscribe link carries who sent it and to whom, signed with a key derived from
 * EMAIL_TOKEN_SECRET, so a link opts out only the address it was sent to, and only for that sender.
 * Pure except optOutAddress and senderAuth (DNS, with the resolver injectable for tests).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as dnsPromises } from "node:dns";
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { siteLink } from "@/lib/site";
import { optOutContact } from "./db";
import { PUBLIC_EMAIL_DOMAINS, type DraftKind } from "./model";

/** Kinds of email that are outreach: they get the footer and the headers, and need a postal address. */
export const COMMERCIAL_KINDS: readonly DraftKind[] = ["campaign", "nurture"];
export const isCommercial = (kind: string) => (COMMERCIAL_KINDS as readonly string[]).includes(kind);

export const POSTAL_ADDRESS_NEEDED = "Add your postal address in Relationships settings before sending outreach: the law requires it in every commercial email";

const key = () => {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  if (!secret || secret.length < 16) throw new Error("EMAIL_TOKEN_SECRET is not set (needs at least 16 characters)");
  return createHmac("sha256", secret).update("youbank:unsubscribe:v1").digest();
};
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

/** A link token for one recipient of one sender. */
export function unsubscribeToken(userId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: email.trim().toLowerCase() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Who a token is for, or null when it was altered or is malformed. */
export function readUnsubscribeToken(token: string): { userId: string; email: string } | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; e?: unknown };
    return typeof v.u === "string" && typeof v.e === "string" && v.e.includes("@") ? { userId: v.u, email: v.e } : null;
  } catch { return null; }
}

export const unsubscribeUrl = (userId: string, email: string) => siteLink(`/api/unsubscribe/${unsubscribeToken(userId, email)}`);

/** The lines added under the signature of a commercial email. */
export function complianceFooter(postalAddress: string, url: string): string {
  const address = postalAddress.trim().replace(/\s*\n\s*/g, ", ");
  return `\n\n--\n${address}\nTo stop these emails, reply "unsubscribe" or open ${url}`;
}

/** RFC 2369 and RFC 8058 headers: an HTTPS one-click link, and a reply to the sender as the mailto. */
export function unsubscribeHeaders(url: string, from: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>, <mailto:${from}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Stop all outreach from one sender to one address: the contact is marked opted out (which also takes
 * them out of every campaign and withdraws waiting outreach), and campaign leads with that address that
 * have no contact yet are marked too.
 */
export async function optOutAddress(userId: string, email: string): Promise<void> {
  const db = requireDb();
  const address = email.trim().toLowerCase();
  const contacts = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.userId, userId), eq(schema.crmContacts.email, address)));
  for (const c of contacts) await optOutContact(userId, c.id);
  await db.update(schema.crmCampaignLeads).set({ status: "opted_out" })
    .where(and(eq(schema.crmCampaignLeads.userId, userId), eq(schema.crmCampaignLeads.email, address),
      inArray(schema.crmCampaignLeads.status, ["sourced", "review", "qualified", "active"])));
}

export type SenderAuth = { domain: string; spf: boolean; dmarc: boolean; dkim: boolean | null; hosted: boolean };
type Resolver = { resolveTxt: (name: string) => Promise<string[][]> };

/** DKIM selectors the big hosts use; a domain with none of these may still sign under another one. */
const DKIM_SELECTORS = ["google", "selector1", "selector2", "k1", "default", "s1", "dkim"];

/**
 * Whether a sending domain publishes SPF, DMARC and (as far as common selectors show) DKIM. A public
 * mailbox domain (gmail.com, outlook.com) is the provider's to authenticate, so it counts as hosted.
 */
export async function senderAuth(address: string, resolver: Resolver = dnsPromises): Promise<SenderAuth> {
  const domain = (address.split("@")[1] ?? "").toLowerCase();
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return { domain, spf: true, dmarc: true, dkim: true, hosted: true };
  const txt = async (name: string) => (await resolver.resolveTxt(name).catch(() => [] as string[][])).map((r) => r.join(""));
  const [root, dmarc, ...dkim] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`), ...DKIM_SELECTORS.map((s) => txt(`${s}._domainkey.${domain}`))]);
  return {
    domain,
    spf: root.some((r) => /^v=spf1\b/i.test(r)),
    dmarc: dmarc.some((r) => /^v=DMARC1\b/i.test(r)),
    dkim: dkim.some((rs) => rs.some((r) => /v=DKIM1|k=rsa|p=/i.test(r))) ? true : null,
    hosted: false,
  };
}

/**
 * What stops a campaign from launching from this domain, and what only warns. Without SPF or a DKIM
 * key that can be found, mail is likely rejected; DMARC is required of bulk senders and checked by
 * Microsoft and Gmail, so its absence is a warning at YouBank's campaign volumes. Pure.
 */
export function launchChecks(auth: SenderAuth[]): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [], warnings: string[] = [];
  for (const a of auth.filter((x) => !x.hosted)) {
    if (!a.spf && a.dkim !== true) blockers.push(`${a.domain} publishes no SPF record and no DKIM key we could find, so receivers will likely reject campaign mail from it. Add SPF (and DKIM) in your DNS first.`);
    else if (!a.spf) warnings.push(`${a.domain} has no SPF record; add one so receivers can check mail from it.`);
    if (!a.dmarc) warnings.push(`${a.domain} has no DMARC record. Gmail, Yahoo and Microsoft require one of bulk senders; add "v=DMARC1; p=none" at _dmarc.${a.domain} to start.`);
  }
  return { blockers, warnings };
}
