import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { DAY_MS, STAGE_LABEL, isStage, type Stage } from "./model";
import { dealPatch } from "@/lib/meetings/diff";
import { addContact, updateContact } from "./contacts";
import { createDraft, moveDeal, recordAction, type ActionRow } from "./db";
import { draftReconnect } from "./nurture";
import { followUpCandidates, matchFundingSignals, staleDeals, type Filing, type ThreadActivity } from "./scan";
import { getSettings } from "./settings";

/**
 * Next-best actions: the agent's suggestions, and what approving one does.
 *
 * Scans only read the CRM and YouBank's own data, so they cost nothing to run. The model is called
 * when a person approves a suggestion that needs an email written, and that email then waits in the
 * review queue like any other.
 */

export async function listActions(userId: string, status = "pending") {
  return requireDb().select().from(schema.crmActions)
    .where(and(eq(schema.crmActions.userId, userId), eq(schema.crmActions.status, status)))
    .orderBy(desc(schema.crmActions.createdAt)).limit(100);
}

/* ---------------- Scans ---------------- */

/** Conversations where the reader wrote last and nobody has answered. */
export async function scanFollowUps(userId: string): Promise<number> {
  const db = requireDb();
  const settings = await getSettings(userId);
  const latest = await db.execute(sql`
    select distinct on (m.thread_id)
           m.thread_id as "threadId", m.id as "messageId", m.direction, m.sent_at as "sentAt",
           t.subject, t.category, t.deal_id as "dealId", t.contact_id as "contactId"
    from ${schema.crmMessages} m join ${schema.crmThreads} t on t.id = m.thread_id
    where t.user_id = ${userId} and t.last_message_at > now() - interval '31 days'
    order by m.thread_id, m.sent_at desc`);
  const rows = latest.rows as { threadId: number; messageId: number; direction: string; sentAt: string; subject: string; category: string; dealId: number | null; contactId: number | null }[];
  if (rows.length === 0) return 0;

  const threadIds = rows.map((r) => Number(r.threadId));
  const [campaignThreads, pendingDrafts] = await Promise.all([
    db.select({ id: schema.crmCampaignLeads.threadId }).from(schema.crmCampaignLeads)
      .where(and(eq(schema.crmCampaignLeads.userId, userId), inArray(schema.crmCampaignLeads.threadId, threadIds))),
    db.select({ id: schema.crmDrafts.threadId }).from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"), inArray(schema.crmDrafts.threadId, threadIds))),
  ]);
  const inCampaign = new Set(campaignThreads.map((r) => r.id));
  const drafted = new Set(pendingDrafts.map((r) => r.id));

  const activity: ThreadActivity[] = rows.map((r) => ({
    threadId: Number(r.threadId), subject: r.subject, category: r.category, dealId: r.dealId, contactId: r.contactId,
    lastDirection: r.direction === "outbound" ? "outbound" : "inbound", lastMessageId: Number(r.messageId), lastAt: new Date(r.sentAt),
    inCampaign: inCampaign.has(Number(r.threadId)), hasPendingDraft: drafted.has(Number(r.threadId)),
  }));

  let n = 0;
  for (const t of followUpCandidates(activity, new Date(), settings.followUpDays)) {
    const made = await recordAction(userId, {
      kind: "follow_up",
      title: `No reply in ${t.waited} days: ${t.subject || "(no subject)"}`,
      reasoning: `You wrote last, ${t.waited} days ago, and nothing has come back. Your follow-up window is ${settings.followUpDays} days.`,
      payload: { threadId: t.threadId, waited: t.waited },
      dedupeKey: `follow_up:${t.threadId}:${t.lastMessageId}`,
      threadId: t.threadId, dealId: t.dealId, contactId: t.contactId,
    });
    if (made) n++;
  }
  return n;
}

/** Live deals where nothing has happened for a while. */
export async function scanStaleDeals(userId: string): Promise<number> {
  const db = requireDb();
  const settings = await getSettings(userId);
  const deals = await db.select().from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.status, "open")));
  if (deals.length === 0) return 0;
  const lastEmail = await db.select({ dealId: schema.crmThreads.dealId, at: sql<string>`max(${schema.crmThreads.lastMessageAt})` })
    .from(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), isNotNull(schema.crmThreads.dealId))).groupBy(schema.crmThreads.dealId);
  const byDeal = new Map(lastEmail.map((r) => [r.dealId, r.at ? new Date(r.at) : null]));

  let n = 0;
  const stale = staleDeals(deals.map((d) => ({
    dealId: d.id, name: d.name, stage: d.stage, contactId: d.contactId, updatedAt: d.updatedAt, lastEmailAt: byDeal.get(d.id) ?? null,
  })), new Date(), settings.staleDealDays);
  for (const d of stale) {
    const made = await recordAction(userId, {
      kind: "check_in",
      title: `${d.name} has been quiet for ${d.quiet} days in ${STAGE_LABEL[d.stage as Stage] ?? d.stage}`,
      reasoning: `No email and no change to the deal for ${d.quiet} days. ${d.contactId ? "Approving drafts a short check-in to your contact there." : "There is no contact on this deal, so approving only clears the reminder."}`,
      payload: { dealId: d.dealId, quiet: d.quiet },
      // One reminder per quiet stretch; if it stays quiet for another full stretch, it comes back.
      dedupeKey: `check_in:${d.dealId}:${Math.floor(d.quiet / settings.staleDealDays)}:${d.updatedAt.getTime()}`,
      dealId: d.dealId, contactId: d.contactId,
    });
    if (made) n++;
  }
  return n;
}

/**
 * Funding news about people you know, from the Form D filings YouBank already collects nightly.
 * A new match becomes a signal on the contact and a suggestion to reconnect.
 */
export async function scanSignals(userId: string): Promise<number> {
  const db = requireDb();
  const contacts = await db.select().from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.userId, userId), isNull(schema.crmContacts.optedOutAt)));
  const withCompany = contacts.filter((c) => c.company.trim());
  if (withCompany.length === 0) return 0;

  const since = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
  const rows = await db.select().from(schema.startups)
    .where(and(eq(schema.startups.source, "formd"), gte(schema.startups.sourceDate, since)));
  const filings: Filing[] = rows.map((r) => ({
    sourceId: r.sourceId, name: r.name, officers: r.founders.split(",").map((s) => s.trim()).filter(Boolean),
    raised: r.raised, raisedUsd: r.raisedUsd, filedOn: r.sourceDate, url: r.url, industry: r.industries[0] ?? "",
  }));

  const deals = await db.select({ id: schema.crmDeals.id, contactId: schema.crmDeals.contactId }).from(schema.crmDeals)
    .where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.status, "open")));
  const dealFor = new Map(deals.map((d) => [d.contactId, d.id]));

  const matches = matchFundingSignals(withCompany.map((c) => ({
    contactId: c.id, dealId: dealFor.get(c.id) ?? null, name: c.name, company: c.company, since: null,
  })), filings);

  let n = 0;
  for (const m of matches) {
    const f = m.filing;
    const sold = f.raisedUsd ? f.raised : "an undisclosed amount";
    const [signal] = await db.insert(schema.crmSignals).values({
      userId, contactId: m.entity.contactId, dealId: m.entity.dealId, kind: "funding", sourceKey: f.sourceId,
      title: `${f.name} filed a Form D on ${f.filedOn} reporting ${sold} sold`,
      detail: [f.industry ? `Industry: ${f.industry}.` : "", f.officers.length ? `Officers: ${f.officers.slice(0, 4).join(", ")}.` : ""].filter(Boolean).join(" "),
      url: f.url, strength: m.strength, occurredAt: new Date(f.filedOn),
    }).onConflictDoNothing().returning();
    if (!signal) continue;
    n++;
    const contact = withCompany.find((c) => c.id === m.entity.contactId);
    await recordAction(userId, {
      kind: "reconnect",
      title: `${m.entity.company} just raised: reconnect with ${contact?.name || contact?.email || "your contact"}?`,
      reasoning: `SEC Form D filed ${f.filedOn} by ${f.name} reports ${sold} sold.${m.strength === "officer" ? ` ${m.entity.name} is named on it as an officer.` : ""}`,
      uncertainties: [
        ...(m.strength === "name" ? [`Matched on the company name alone. Check that ${f.name} is the company ${contact?.name || "your contact"} is at.`] : []),
        "A Form D reports the amount sold to date, which can include earlier closes; it is not necessarily a new round.",
      ],
      payload: { contactId: m.entity.contactId, signalId: signal.id, url: f.url },
      dedupeKey: `reconnect:signal:${signal.id}`,
      contactId: m.entity.contactId, dealId: m.entity.dealId,
    });
  }
  return n;
}

/* ---------------- Decisions ---------------- */

export type ApproveResult = { action: ActionRow; draftId: number | null; message: string };

/** Take a pending suggestion atomically, so a double click cannot carry it out twice. */
async function claimAction(userId: string, id: number): Promise<ActionRow> {
  const db = requireDb();
  const [a] = await db.update(schema.crmActions).set({ status: "done", decidedAt: new Date() })
    .where(and(eq(schema.crmActions.id, id), eq(schema.crmActions.userId, userId), eq(schema.crmActions.status, "pending"))).returning();
  if (a) return a;
  const [existing] = await db.select({ status: schema.crmActions.status }).from(schema.crmActions)
    .where(and(eq(schema.crmActions.id, id), eq(schema.crmActions.userId, userId)));
  throw new Error(existing ? `This suggestion was already ${existing.status}` : "Suggestion not found");
}

async function latestThreadFor(userId: string, contactId: number | null, dealId: number | null) {
  if (!contactId && !dealId) return null;
  const cond = dealId ? eq(schema.crmThreads.dealId, dealId) : eq(schema.crmThreads.contactId, contactId!);
  const [t] = await requireDb().select().from(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), cond)).orderBy(desc(schema.crmThreads.lastMessageAt)).limit(1);
  return t ?? null;
}

/**
 * Carry out a suggestion. Anything that involves email produces a draft for review, never a send.
 * `input` carries what the person supplied on the card: the email address for "add_contact".
 */
export async function approveAction(userId: string, id: number, input: { email?: string } = {}): Promise<ApproveResult> {
  const db = requireDb();
  const a = await claimAction(userId, id);
  try {
    return await carryOut(userId, a, input);
  } catch (e) {
    // Put it back so it can be tried again.
    await db.update(schema.crmActions).set({ status: "pending", decidedAt: null }).where(eq(schema.crmActions.id, a.id));
    throw e;
  }
}

async function carryOut(userId: string, a: ActionRow, input: { email?: string } = {}): Promise<ApproveResult> {
  const db = requireDb();
  const p = a.payload as Record<string, unknown>;
  let draftId: number | null = null;
  let message = "Done.";

  if (a.kind === "move_stage") {
    if (!isStage(p.to) || typeof p.dealId !== "number") throw new Error("This suggestion is missing its deal or stage");
    await moveDeal(userId, p.dealId, p.to);
    message = `Moved to ${STAGE_LABEL[p.to]}.`;
  } else if (a.kind === "follow_up") {
    if (typeof p.threadId !== "number") throw new Error("This suggestion is missing its thread");
    const d = await createDraft(userId, p.threadId, {
      kind: "follow_up", meta: { actionId: a.id },
      instruction: `The reader's last email in this thread has had no reply for ${p.waited ?? "several"} days. Write a short, friendly follow-up that adds one useful line and makes replying easy. No guilt, no "just bumping this".`,
    });
    draftId = d.id; message = "Follow-up drafted. It is in the review queue, unsent.";
  } else if (a.kind === "check_in") {
    const t = await latestThreadFor(userId, a.contactId, a.dealId);
    if (t) {
      const d = await createDraft(userId, t.id, {
        kind: "follow_up", meta: { actionId: a.id },
        instruction: "This deal has gone quiet. Write a short check-in asking where things stand and whether there is anything the reader can send or answer. Do not imply any decision on the reader's side.",
      });
      draftId = d.id; message = "Check-in drafted. It is in the review queue, unsent.";
    } else {
      message = "No email thread with this deal to reply in, so the reminder is cleared.";
    }
  } else if (a.kind === "reconnect") {
    if (typeof p.contactId !== "number") throw new Error("This suggestion is missing its contact");
    const r = await draftReconnect(userId, p.contactId, { signalId: typeof p.signalId === "number" ? p.signalId : undefined, actionId: a.id });
    draftId = r.draft?.id ?? null;
    message = r.draft ? "Reconnection drafted. It is in the review queue, unsent." : `Not drafted: ${r.reason}`;
  } else if (a.kind === "update_deal") {
    // Changes a meeting stated; the person accepted them, so they are written now, and only these fields.
    if (typeof p.dealId !== "number" || !Array.isArray(p.changes)) throw new Error("This suggestion is missing its deal or changes");
    const patch = dealPatch(p.changes as { field: string; to: unknown }[]);
    if (!Object.keys(patch).length) throw new Error("Nothing in this suggestion can be applied");
    const [row] = await db.update(schema.crmDeals).set({ ...patch, updatedAt: new Date() }).where(and(eq(schema.crmDeals.id, p.dealId), eq(schema.crmDeals.userId, userId))).returning();
    if (!row) throw new Error("Deal not found");
    message = `${row.name} updated.`;
  } else if (a.kind === "update_contact") {
    if (typeof p.contactId !== "number" || !p.changes || typeof p.changes !== "object") throw new Error("This suggestion is missing its contact");
    const c = p.changes as { title?: string; company?: string };
    await updateContact(userId, p.contactId, { ...(c.title ? { title: c.title } : {}), ...(c.company ? { company: c.company } : {}) });
    message = "Contact updated.";
  } else if (a.kind === "review_contact") {
    if (typeof p.contactId !== "number") throw new Error("This suggestion is missing its contact");
    const [c] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.id, p.contactId), eq(schema.crmContacts.userId, userId)));
    if (c) await db.update(schema.crmContacts).set({ tags: c.tags.filter((t) => t !== "needs review"), updatedAt: new Date() }).where(eq(schema.crmContacts.id, c.id));
    message = "Kept in your contacts.";
  } else if (a.kind === "add_contact") {
    const email = (input.email ?? "").trim().toLowerCase();
    if (!email) throw Object.assign(new Error(`Add ${typeof p.name === "string" && p.name ? `${p.name}'s` : "their"} email address first.`), { status: 400 });
    const c = await addContact(userId, { email, name: typeof p.name === "string" ? p.name : "", title: typeof p.title === "string" ? p.title : "", company: typeof p.company === "string" ? p.company : "" });
    if (a.meetingId) await requireDb().insert(schema.meetingLinks).values({ meetingId: a.meetingId, userId, kind: "contact", refId: c.id, how: "manual" }).onConflictDoNothing();
    message = `${c.name || c.email} added to your contacts.`;
  }

  const [action] = await db.update(schema.crmActions).set({ draftId }).where(eq(schema.crmActions.id, a.id)).returning();
  return { action, draftId, message };
}

/**
 * Dismiss a suggestion. Rejecting a contact a meeting created removes it again, with its meeting
 * entries, unless something else (an email, a deal, a draft) has used it since.
 */
export async function dismissAction(userId: string, id: number): Promise<void> {
  const db = requireDb();
  const [a] = await db.update(schema.crmActions).set({ status: "dismissed", decidedAt: new Date() })
    .where(and(eq(schema.crmActions.id, id), eq(schema.crmActions.userId, userId), eq(schema.crmActions.status, "pending"))).returning();
  const contactId = (a?.payload as { contactId?: unknown } | undefined)?.contactId;
  if (a?.kind !== "review_contact" || typeof contactId !== "number") return;
  const [[mail], [deal], [draft]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.contactId, contactId), sql`${schema.crmThreads.category} <> 'meeting'`)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), eq(schema.crmDeals.contactId, contactId))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.contactId, contactId), sql`${schema.crmDrafts.status} <> 'discarded'`)),
  ]);
  if ((mail?.n ?? 0) + (deal?.n ?? 0) + (draft?.n ?? 0) > 0) return;
  await db.delete(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.contactId, contactId), eq(schema.crmThreads.category, "meeting")));
  await db.delete(schema.meetingLinks).where(and(eq(schema.meetingLinks.userId, userId), eq(schema.meetingLinks.kind, "contact"), eq(schema.meetingLinks.refId, contactId)));
  await db.delete(schema.crmContacts).where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.userId, userId)));
}
