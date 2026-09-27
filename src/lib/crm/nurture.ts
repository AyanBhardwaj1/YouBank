import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { loadUserContext } from "@/lib/ai/persona";
import { directoryRecord } from "./agent";
import type { DraftRow } from "./db";
import { CONTACT_KINDS, DAY_MS } from "./model";
import { writeNurture, type HistoryItem } from "./outreach";
import { nurtureCandidates, pool, type ContactActivity } from "./scan";
import { isSendMode, renderPlaybook, selectPlaybook } from "./autopilot-rules";
import { lessonsFor, ownExamples } from "./engine";
import { asEntries, listPlaybook } from "./knowledge";
import { getSettings, personaFor, standingOrders } from "./settings";

export type RuleRow = typeof schema.crmNurtureRules.$inferSelect;

/* ---------------- Rules ---------------- */

export async function listRules(userId: string) {
  const db = requireDb();
  const rules = await db.select().from(schema.crmNurtureRules).where(eq(schema.crmNurtureRules.userId, userId)).orderBy(schema.crmNurtureRules.createdAt);
  const log = await db.select().from(schema.crmNurtureLog).where(eq(schema.crmNurtureLog.userId, userId)).orderBy(desc(schema.crmNurtureLog.createdAt)).limit(60);
  const contactIds = [...new Set(log.map((l) => l.contactId))];
  const contacts = contactIds.length
    ? await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email }).from(schema.crmContacts).where(inArray(schema.crmContacts.id, contactIds))
    : [];
  const who = new Map(contacts.map((c) => [c.id, c.name || c.email]));
  return { rules, log: log.map((l) => ({ ...l, contact: who.get(l.contactId) ?? "" })) };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function ruleValues(input: Partial<RuleRow>, base?: RuleRow) {
  return {
    name: (input.name ?? base?.name ?? "Reconnect").toString().trim().slice(0, 120) || "Reconnect",
    enabled: input.enabled ?? base?.enabled ?? true,
    cadenceDays: clamp(input.cadenceDays ?? base?.cadenceDays, 14, 1095, 180),
    anchor: (input.anchor ?? base?.anchor) === "last_contact" ? "last_contact" : "last_sent",
    kinds: (Array.isArray(input.kinds) ? input.kinds : base?.kinds ?? []).filter((k) => (CONTACT_KINDS as readonly string[]).includes(k)),
    minExchanges: clamp(input.minExchanges ?? base?.minExchanges, 1, 50, 2),
    dailyCap: clamp(input.dailyCap ?? base?.dailyCap, 1, 25, 5),
    instructions: (input.instructions ?? base?.instructions ?? "").toString().slice(0, 3000),
    sendMode: isSendMode(input.sendMode) ? input.sendMode : (base?.sendMode ?? "default"),
  };
}

export async function createRule(userId: string, input: Partial<RuleRow>): Promise<RuleRow> {
  const [row] = await requireDb().insert(schema.crmNurtureRules).values({ userId, ...ruleValues(input) }).returning();
  return row;
}

export async function updateRule(userId: string, id: number, input: Partial<RuleRow>): Promise<RuleRow> {
  const db = requireDb();
  const [base] = await db.select().from(schema.crmNurtureRules).where(and(eq(schema.crmNurtureRules.id, id), eq(schema.crmNurtureRules.userId, userId)));
  if (!base) throw new Error("Rule not found");
  const [row] = await db.update(schema.crmNurtureRules).set(ruleValues(input, base)).where(eq(schema.crmNurtureRules.id, id)).returning();
  return row;
}

export async function deleteRule(userId: string, id: number): Promise<void> {
  await requireDb().delete(schema.crmNurtureRules).where(and(eq(schema.crmNurtureRules.id, id), eq(schema.crmNurtureRules.userId, userId)));
}

/* ---------------- Who is due ---------------- */

/** Per-contact email activity, and whether something is already in flight for them. */
export async function contactActivity(userId: string, ruleId?: number): Promise<ContactActivity[]> {
  const db = requireDb();
  const contacts = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.userId, userId));
  const stats = await db.execute(sql`
    select t.contact_id as "contactId",
           max(m.sent_at) filter (where m.direction = 'outbound') as "lastSentAt",
           max(m.sent_at) as "lastContactAt",
           count(m.id)::int as "exchanges"
    from ${schema.crmThreads} t join ${schema.crmMessages} m on m.thread_id = t.id
    where t.user_id = ${userId} and t.contact_id is not null
    group by t.contact_id`);
  const byContact = new Map((stats.rows as { contactId: number; lastSentAt: string | null; lastContactAt: string | null; exchanges: number }[]).map((r) => [Number(r.contactId), r]));

  const pending = await db.select({ contactId: schema.crmDrafts.contactId }).from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"), inArray(schema.crmDrafts.kind, ["nurture", "campaign"]), isNotNull(schema.crmDrafts.contactId)));
  const inCampaign = await db.select({ contactId: schema.crmCampaignLeads.contactId, email: schema.crmCampaignLeads.email }).from(schema.crmCampaignLeads)
    .where(and(eq(schema.crmCampaignLeads.userId, userId), inArray(schema.crmCampaignLeads.status, ["qualified", "active"])));
  const busyIds = new Set([...pending.map((p) => p.contactId), ...inCampaign.map((l) => l.contactId)].filter((x): x is number => x != null));
  const busyEmails = new Set(inCampaign.map((l) => l.email));

  const evaluated = new Map<number, Date>();
  if (ruleId) {
    const rows = await db.select({ contactId: schema.crmNurtureLog.contactId, at: sql<string>`max(${schema.crmNurtureLog.createdAt})` })
      .from(schema.crmNurtureLog).where(eq(schema.crmNurtureLog.ruleId, ruleId)).groupBy(schema.crmNurtureLog.contactId);
    for (const r of rows) evaluated.set(r.contactId, new Date(r.at));
  }

  const asDate = (v: string | Date | null | undefined) => (v ? new Date(v) : null);
  return contacts.map((c) => {
    const s = byContact.get(c.id);
    return {
      contactId: c.id, kind: c.kind, optedOut: !!c.optedOutAt,
      lastSentAt: asDate(s?.lastSentAt), lastContactAt: asDate(s?.lastContactAt), exchanges: s?.exchanges ?? 0,
      busy: busyIds.has(c.id) || busyEmails.has(c.email), lastEvaluatedAt: evaluated.get(c.id) ?? null,
    };
  });
}

/** Who a rule would look at if it ran now, without calling the model. Powers the preview in the UI. */
export async function previewRule(userId: string, rule: RuleRow) {
  const due = nurtureCandidates(await contactActivity(userId, rule.id), rule, new Date());
  const ids = due.slice(0, 50).map((d) => d.contactId);
  const contacts = ids.length ? await requireDb().select().from(schema.crmContacts).where(inArray(schema.crmContacts.id, ids)) : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return { total: due.length, sample: due.slice(0, 50).map((d) => ({ ...d, name: byId.get(d.contactId)?.name ?? "", email: byId.get(d.contactId)?.email ?? "", company: byId.get(d.contactId)?.company ?? "" })) };
}

/* ---------------- Writing a reconnection ---------------- */

async function historyFor(userId: string, contactId: number): Promise<HistoryItem[]> {
  const rows = await requireDb().select({
    direction: schema.crmMessages.direction, sentAt: schema.crmMessages.sentAt, subject: schema.crmMessages.subject, body: schema.crmMessages.body,
  }).from(schema.crmMessages)
    .innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
    .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.contactId, contactId)))
    .orderBy(desc(schema.crmMessages.sentAt)).limit(6);
  return rows.reverse().map((m) => ({
    direction: m.direction === "outbound" ? "outbound" : "inbound", sentAt: m.sentAt?.toISOString().slice(0, 10) ?? null, subject: m.subject, body: m.body,
  }));
}

export type ReconnectOutcome = { draft: DraftRow | null; reason: string };

/**
 * Decide whether to write to a quiet contact and, if so, put a draft in the review queue.
 * Used by nurture rules and by approving a "reconnect" suggestion. Nothing is sent.
 */
export async function draftReconnect(userId: string, contactId: number, opts?: {
  ruleInstructions?: string; ruleId?: number; signalId?: number; actionId?: number;
}): Promise<ReconnectOutcome> {
  const db = requireDb();
  const [contact] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.userId, userId)));
  if (!contact) throw new Error("Contact not found");
  if (contact.optedOutAt) return { draft: null, reason: `${contact.name || contact.email} asked not to be contacted.` };

  const [ctx, settings, history, directory, signals, playbook] = await Promise.all([
    loadUserContext(userId), getSettings(userId), historyFor(userId, contactId), directoryRecord(contact.startupId),
    db.select().from(schema.crmSignals).where(and(eq(schema.crmSignals.userId, userId), eq(schema.crmSignals.contactId, contactId),
      gte(schema.crmSignals.createdAt, new Date(Date.now() - 180 * DAY_MS)))).orderBy(desc(schema.crmSignals.createdAt)).limit(3),
    listPlaybook(userId),
  ]);
  const last = history.length ? history[history.length - 1].sentAt : null;
  const daysQuiet = last ? Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS) : 0;

  const [lessons, examples] = await Promise.all([lessonsFor(userId, "nurture"), ownExamples(userId, history.map((h) => h.body).join(" "))]);
  const { data, provider, model } = await writeNurture({
    persona: personaFor(ctx, settings), orders: [standingOrders(settings), lessons, examples].filter(Boolean).join("\n\n"), ruleInstructions: opts?.ruleInstructions ?? "", daysQuiet,
    playbook: renderPlaybook(selectPlaybook(asEntries(playbook), history.map((h) => h.body).join("\n"))),
    contact: { name: contact.name, email: contact.email, title: contact.title, company: contact.company, kind: contact.kind, notes: contact.notes },
    directory, signals: signals.map((s) => `${s.title}. ${s.detail}`), history,
  }, { prefs: ctx.prefs });

  if (!data.reachOut || !data.body.trim()) return { draft: null, reason: data.reason };

  const [draft] = await db.insert(schema.crmDrafts).values({
    userId, kind: "nurture", contactId, toAddresses: [{ name: contact.name, address: contact.email }],
    subject: data.subject, body: data.body, originalBody: data.body, rationale: data.reason,
    citations: data.openQuestions.map((q) => ({ label: q, url: "" })),
    meta: { ruleId: opts?.ruleId, signalId: opts?.signalId, actionId: opts?.actionId }, provider, model,
    confidence: data.confidence, sensitive: data.sensitive,
  }).returning();
  return { draft, reason: data.reason };
}

/* ---------------- Running a rule ---------------- */

export type RuleRunResult = { ruleId: number; considered: number; drafted: number; skipped: number; draftIds: number[]; errors: string[] };

/**
 * Look at who is due under a rule, up to what is left of today's cap, and draft for the ones worth
 * writing to. Every decision is logged with its reason, which is also what stops the same person
 * being asked about again inside the cadence.
 */
export async function runRule(userId: string, rule: RuleRow, deadline: number): Promise<RuleRunResult> {
  const db = requireDb();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ n: today }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmNurtureLog)
    .where(and(eq(schema.crmNurtureLog.ruleId, rule.id), gte(schema.crmNurtureLog.createdAt, startOfDay)));
  const room = Math.max(0, rule.dailyCap - today);
  const due = nurtureCandidates(await contactActivity(userId, rule.id), rule, new Date()).slice(0, room);

  const out: RuleRunResult = { ruleId: rule.id, considered: due.length, drafted: 0, skipped: 0, draftIds: [], errors: [] };
  const { errors } = await pool(due, 3, deadline, async (c) => {
    const r = await draftReconnect(userId, c.contactId, { ruleInstructions: rule.instructions, ruleId: rule.id });
    await db.insert(schema.crmNurtureLog).values({
      userId, ruleId: rule.id, contactId: c.contactId, outcome: r.draft ? "drafted" : "skipped", reason: r.reason.slice(0, 500), draftId: r.draft?.id ?? null,
    });
    if (r.draft) { out.drafted++; out.draftIds.push(r.draft.id); } else out.skipped++;
  });
  out.errors.push(...errors);
  await db.update(schema.crmNurtureRules).set({ lastRunAt: new Date() }).where(eq(schema.crmNurtureRules.id, rule.id));
  return out;
}
