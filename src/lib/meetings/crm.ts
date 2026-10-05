/**
 * What a meeting adds to Relationships, stored the way the email agent stores what it reads:
 *
 * - People: each participant is matched to a contact by email, or by name when exactly one contact
 *   fits well (lib/meetings/match). A new person with an email becomes a contact tagged "needs review",
 *   with a suggestion to keep them; a new person without one becomes a suggestion to add them, which
 *   asks for the address. Coworkers are filed as colleagues, never as pipeline.
 * - The timeline: for each contact, a meeting entry in their history (a thread with one message,
 *   category "meeting"), linked to the deal. That is where Relationships already reads activity, so
 *   relationship strength, nurture and quiet-deal checks all see the meeting. The entry carries the
 *   topics they raised, what they showed they know and what they asked: their contact knowledge
 *   (drizzle/0010_contact_knowledge.sql).
 * - Deals: terms stated in the meeting are compared with the deal, and each difference is a proposed
 *   change for the person to accept or reject (crm_actions, tagged with the meeting); nothing is
 *   written over. A stage change is the agent's usual "move deal" suggestion.
 * - Follow-ups: drafts in the review queue, addressed to the participants, never sent on their own
 *   (autopilot leaves meeting follow-ups to the person).
 *
 * Running it again on the same meeting changes nothing twice: entries are keyed by meeting and
 * contact, suggestions by a dedupe key, drafts are checked for first.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { EmailAddress, MeetingParticipantJson } from "@/db/schema";
import { audienceOf } from "@/lib/crm/autopilot-rules";
import { mailboxAddresses, recordAction, upsertContact, type ContactRow, type DealRow } from "@/lib/crm/db";
import { normalizeCompany, stagesFor, STAGE_LABEL } from "@/lib/crm/model";
import { getSettings, internalDomains } from "@/lib/crm/settings";
import { describeChanges, proposeDealChanges } from "./diff";
import { dedupePeople, matchParticipants, type Person } from "./match";
import { durationLabel, PLATFORM_LABEL, isPlatform, type MeetingNotes, type ParticipantNotes } from "./model";
import { getMeetingSettings, linkMeeting, type MeetingRow } from "./store";

export const NEEDS_REVIEW = "needs review";

export type CrmReport = { linked: number; created: number; suggested: number; proposals: number; drafts: number };

const money = (n: number | null) => (n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`);
const titleOf = (m: MeetingRow) => m.title || `${isPlatform(m.platform) ? PLATFORM_LABEL[m.platform] : "Meeting"} on ${m.startedAt.toISOString().slice(0, 10)}`;

/** The per-person body of their timeline entry: what they said and showed, then the meeting's summary. Pure. */
export function entryBody(m: Pick<MeetingRow, "startedAt" | "durationSec">, title: string, notes: MeetingNotes | null, p: ParticipantNotes | null): string {
  const lines = [`${title} · ${m.startedAt.toISOString().slice(0, 10)}${m.durationSec ? ` · ${durationLabel(m.durationSec)}` : ""}`];
  if (p?.signals.length) lines.push("", "Signals:", ...p.signals.map((s) => `- ${s}`));
  if (p?.facts.length) lines.push("", "New facts:", ...p.facts.map((s) => `- ${s}`));
  if (notes?.summary) lines.push("", "Summary:", notes.summary);
  const theirs = notes?.actionItems.filter((a) => p && a.owner && a.owner.toLowerCase() === p.name.toLowerCase()) ?? [];
  if (theirs.length) lines.push("", "They will:", ...theirs.map((a) => `- ${a.text}${a.due ? ` (by ${a.due})` : ""}`));
  return lines.join("\n").slice(0, 8000);
}

/** The participant notes for a contact, by email or name. Pure. */
function notesFor(notes: MeetingNotes | null, person: Person, contact: ContactRow | null): ParticipantNotes | null {
  if (!notes) return null;
  const email = (person.email || contact?.email || "").toLowerCase();
  const names = [person.name, contact?.name].filter(Boolean).map((n) => n!.toLowerCase());
  return notes.participants.find((p) => (email && p.email === email) || names.includes(p.name.toLowerCase())) ?? null;
}

/**
 * File a meeting into Relationships. With `notes` null (no AI notes this time), people are still
 * matched and linked and the meeting still appears on their timelines; signals, proposals and drafts
 * need the notes.
 */
export async function applyMeetingToCrm(user: { id: string; email: string; name: string }, m: MeetingRow, notes: MeetingNotes | null): Promise<CrmReport> {
  const db = requireDb();
  const report: CrmReport = { linked: 0, created: 0, suggested: 0, proposals: 0, drafts: 0 };
  const [crmSettings, mailboxes, copilot] = await Promise.all([getSettings(user.id), mailboxAddresses(user.id), getMeetingSettings(user.id)]);
  const internal = internalDomains(crmSettings, mailboxes);
  const title = titleOf(m);

  // Everyone the meeting knows of: its participant list (bot, calendar, picks) and whoever the notes found.
  const people = dedupePeople([
    ...m.participants.map((p) => ({ name: p.name, email: p.email })),
    ...(notes?.participants ?? []).map((p) => ({ name: p.name, email: p.email })),
  ]);
  const contacts = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.userId, user.id)).limit(5000);
  const matches = matchParticipants(people, contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company })), { emails: [user.email, ...mailboxes], name: user.name });

  const picked = new Set(((m.context.contactIds as number[] | undefined) ?? []).filter((n) => Number.isInteger(n)));
  const excluded = new Set(((m.context.excludedContactIds as number[] | undefined) ?? []).filter((n) => Number.isInteger(n)));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const linked: { contact: ContactRow; person: Person; how: string }[] = [];
  const participants: MeetingParticipantJson[] = [];

  for (const match of matches) {
    const { person } = match;
    if (match.self) { participants.push({ name: person.name || user.name || "You", self: true }); continue; }
    if (match.contactId && excluded.has(match.contactId)) { participants.push({ name: person.name, email: person.email, contactId: null, how: "none" }); continue; }
    let contact = match.contactId ? byId.get(match.contactId) ?? null : null;
    let how: string = match.how;
    const pn = notesFor(notes, person, contact);
    if (!contact && person.email) {
      // A new person with an address: a contact now, marked for review, with a suggestion to keep them.
      const external = audienceOf(person.email, internal) === "external";
      contact = await upsertContact(user.id, { email: person.email, name: person.name, title: pn?.title, company: pn?.company, kind: external ? "unknown" : "colleague" });
      if (!contact.tags.includes(NEEDS_REVIEW)) {
        [contact] = await db.update(schema.crmContacts).set({ tags: [...contact.tags, NEEDS_REVIEW] }).where(eq(schema.crmContacts.id, contact.id)).returning();
      }
      how = "new";
      report.created++;
      const made = await recordAction(user.id, {
        kind: "review_contact", title: `New contact from “${title}”: ${person.name || person.email}`,
        reasoning: `${person.name || "They"} was in the meeting and is not in your contacts yet, so they were added and marked for review.${pn?.title || pn?.company ? ` Said to be ${[pn?.title, pn?.company].filter(Boolean).join(" at ")}.` : ""} Keep them, or reject to remove them again.`,
        payload: { contactId: contact.id, meetingId: m.id }, dedupeKey: `meeting:${m.id}:review_contact:${contact.id}`, contactId: contact.id, meetingId: m.id,
      });
      if (made) report.suggested++;
      byId.set(contact.id, contact);
    } else if (!contact && person.name.trim()) {
      // A name only: ask for the address rather than guess one.
      const made = await recordAction(user.id, {
        kind: "add_contact", title: `Add ${person.name} from “${title}” to your contacts?`,
        reasoning: `${person.name} was in the meeting${pn?.company ? ` (${pn.company})` : ""}, but the meeting did not give an email address${match.candidates.length ? ", and the name fits more than one contact, or fits one too loosely to be sure" : ""}. Add their address to keep them.`,
        payload: { name: person.name, company: pn?.company ?? "", title: pn?.title ?? "", candidates: match.candidates, meetingId: m.id },
        dedupeKey: `meeting:${m.id}:add_contact:${person.name.toLowerCase()}`, meetingId: m.id,
      });
      if (made) report.suggested++;
      participants.push({ name: person.name, email: person.email, contactId: null, how: "none" });
      continue;
    }
    if (!contact) continue;
    linked.push({ contact, person, how });
    participants.push({ name: person.name || contact.name, email: contact.email, contactId: contact.id, how });
  }
  // Contacts picked by hand who did not show up in any list still belong to the meeting.
  for (const id of picked) {
    const c = byId.get(id);
    if (c && !linked.some((l) => l.contact.id === id)) { linked.push({ contact: c, person: { name: c.name, email: c.email }, how: "manual" }); participants.push({ name: c.name || c.email, email: c.email, contactId: c.id, how: "manual" }); }
  }
  for (const how of new Set(linked.map((l) => l.how))) await linkMeeting(user.id, m.id, "contact", linked.filter((l) => l.how === how).map((l) => l.contact.id), how);
  report.linked = linked.length;

  // Deals: picked by hand, open deals of the linked contacts, and deals the notes named.
  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.userId, user.id));
  const pickedDeals = new Set(((m.context.dealIds as number[] | undefined) ?? []).filter((n) => Number.isInteger(n)));
  const contactIds = new Set(linked.map((l) => l.contact.id));
  const named = new Set((notes?.deals ?? []).map((d) => normalizeCompany(d.company)).filter(Boolean));
  const dealHits = deals.filter((d) => pickedDeals.has(d.id) || (d.status === "open" && d.contactId != null && contactIds.has(d.contactId)) || (d.status === "open" && named.has(normalizeCompany(d.name))));
  await linkMeeting(user.id, m.id, "deal", dealHits.map((d) => d.id), "matched");
  const primaryDeal = (contactId: number): DealRow | null => dealHits.find((d) => d.contactId === contactId) ?? (dealHits.length === 1 ? dealHits[0] : null);

  // Timeline entries with contact knowledge.
  for (const { contact, person } of linked) {
    const pn = notesFor(notes, person, contact);
    const deal = primaryDeal(contact.id);
    const providerThreadId = `meeting:${m.id}:${contact.id}`;
    const subject = `Meeting: ${title}`.slice(0, 300);
    const participantsJson: EmailAddress[] = linked.map((l) => ({ name: l.contact.name, address: l.contact.email }));
    const [thread] = await db.insert(schema.crmThreads).values({
      userId: user.id, providerThreadId, subject, snippet: (notes?.summary ?? title).slice(0, 300), participants: participantsJson,
      contactId: contact.id, dealId: deal?.id ?? null, category: "meeting", priority: "medium", summary: (notes?.summary ?? "").slice(0, 1000),
      needsReply: false, triagedAt: new Date(), lastMessageAt: m.startedAt,
    }).onConflictDoUpdate({
      target: [schema.crmThreads.userId, schema.crmThreads.providerThreadId],
      set: { subject, snippet: (notes?.summary ?? title).slice(0, 300), participants: participantsJson, dealId: deal?.id ?? null, summary: (notes?.summary ?? "").slice(0, 1000), lastMessageAt: m.startedAt },
    }).returning();
    await db.delete(schema.crmMessages).where(and(eq(schema.crmMessages.threadId, thread.id), eq(schema.crmMessages.providerMessageId, `meeting:${m.id}`)));
    await db.insert(schema.crmMessages).values({
      threadId: thread.id, providerMessageId: `meeting:${m.id}`, direction: "inbound", fromName: contact.name, fromAddress: contact.email,
      subject, body: entryBody(m, title, notes, pn), sentAt: m.startedAt, automated: false,
      // Always set, so the email agent's topic tagger never spends a model call on a meeting entry.
      topics: { topics: pn?.topics ?? [], knows: pn?.knows ?? [], asks: pn?.asks ?? [] },
    });
    await db.update(schema.crmContacts).set({ lastSeenAt: sql`greatest(${schema.crmContacts.lastSeenAt}, ${m.startedAt.toISOString()}::timestamptz)` }).where(eq(schema.crmContacts.id, contact.id));

    // A stated role or company that differs from the contact's is a proposal, never an overwrite.
    if (pn) {
      const changes = ([["title", pn.title], ["company", pn.company]] as const).filter(([f, v]) => v && v.toLowerCase() !== contact[f].toLowerCase());
      if (changes.length) {
        const made = await recordAction(user.id, {
          kind: "update_contact", title: `Update ${contact.name || contact.email}: ${changes.map(([f, v]) => `${f} ${contact[f] ? `“${contact[f]}” → ` : ""}“${v}”`).join(", ")}`,
          reasoning: `Said in “${title}”.`, payload: { contactId: contact.id, changes: Object.fromEntries(changes), meetingId: m.id },
          dedupeKey: `meeting:${m.id}:update_contact:${contact.id}`, contactId: contact.id, meetingId: m.id,
        });
        if (made) report.proposals++;
      }
    }
  }

  // Deal terms the meeting stated: proposals, one per deal, and a stage move.
  if (notes) {
    const stages = stagesFor(crmSettings.mode);
    for (const stated of notes.deals) {
      const key = normalizeCompany(stated.company);
      const deal = dealHits.find((d) => normalizeCompany(d.name) === key) ?? (dealHits.length === 1 ? dealHits[0] : null);
      if (!deal) continue;
      const p = proposeDealChanges({ ...deal, nextStepDue: deal.nextStepDue?.toISOString() ?? null }, stated, stages);
      if (p.changes.length) {
        const made = await recordAction(user.id, {
          kind: "update_deal", title: `Update ${deal.name}: ${describeChanges(p.changes, money)}`.slice(0, 300),
          reasoning: p.quote ? `Said in “${title}”: “${p.quote}”` : `Stated in “${title}”.`,
          uncertainties: ["Taken from a transcript; check the figures before accepting."],
          payload: { dealId: deal.id, changes: p.changes, meetingId: m.id }, dedupeKey: `meeting:${m.id}:update_deal:${deal.id}`, dealId: deal.id, meetingId: m.id,
        });
        if (made) report.proposals++;
      }
      if (p.stage) {
        const made = await recordAction(user.id, {
          kind: "move_stage", title: `Move ${deal.name} from ${STAGE_LABEL[p.stage.from as keyof typeof STAGE_LABEL] ?? p.stage.from} to ${STAGE_LABEL[p.stage.to]}`,
          reasoning: p.quote ? `Said in “${title}”: “${p.quote}”` : `The meeting “${title}” moved it on.`,
          payload: { dealId: deal.id, from: p.stage.from, to: p.stage.to, meetingId: m.id }, dedupeKey: `meeting:${m.id}:stage:${deal.id}:${p.stage.to}`, dealId: deal.id, meetingId: m.id,
        });
        if (made) report.proposals++;
      }
    }
  }

  // Follow-up drafts for the review queue, one per external participant at most.
  if (notes && copilot.followUps && notes.followUps.length) {
    const existing = await db.select({ contactId: schema.crmDrafts.contactId }).from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.userId, user.id), sql`(${schema.crmDrafts.meta}->>'meetingId')::int = ${m.id}`, inArray(schema.crmDrafts.status, ["pending", "sending", "sent"])));
    const done = new Set(existing.map((e) => e.contactId));
    for (const f of notes.followUps) {
      const target = linked.find((l) => (f.email && l.contact.email.toLowerCase() === f.email) || l.contact.name.toLowerCase() === f.to.toLowerCase() || l.person.name.toLowerCase() === f.to.toLowerCase());
      if (!target || done.has(target.contact.id) || audienceOf(target.contact.email, internal) === "internal" || target.contact.optedOutAt) continue;
      await db.insert(schema.crmDrafts).values({
        userId: user.id, threadId: null, dealId: primaryDeal(target.contact.id)?.id ?? null, contactId: target.contact.id,
        toAddresses: [{ name: target.contact.name, address: target.contact.email }], kind: "follow_up",
        meta: { meetingId: m.id, audience: "external", category: "meeting" },
        subject: f.subject || `Following up: ${title}`, body: f.body, originalBody: f.body,
        rationale: `Written from the meeting “${title}” on ${m.startedAt.toISOString().slice(0, 10)}. Check names, numbers and dates against the transcript before sending.`,
        confidence: "medium", sensitive: false, provider: "", model: "",
      });
      done.add(target.contact.id);
      report.drafts++;
    }
  }

  await db.update(schema.meetings).set({ participants, updatedAt: new Date() }).where(eq(schema.meetings.id, m.id));
  return report;
}

/** Take a meeting off one contact's timeline (the person unlinked them). */
export async function removeMeetingEntry(userId: string, meetingId: number, contactId: number): Promise<void> {
  await requireDb().delete(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.providerThreadId, `meeting:${meetingId}:${contactId}`)));
}
