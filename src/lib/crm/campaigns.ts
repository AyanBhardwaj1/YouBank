import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { loadUserContext } from "@/lib/ai/persona";
import { getStartup } from "@/lib/vc/directory";
import { directoryRecord } from "./agent";
import { upsertContact } from "./db";
import { CAMPAIGN_STATUSES, isLeadStatus, needsConsent, normalizeSteps, type CampaignStatus, type LeadStatus } from "./model";
import { qualifyLeads, writeStep } from "./outreach";
import { pool } from "./scan";
import { isSendMode, renderPlaybook, selectPlaybook } from "./autopilot-rules";
import { ANGLES, availableAngles, chooseArm, formatVariant, lessonsFor, ownExamples } from "./engine";
import { asEntries, listPlaybook } from "./knowledge";
import { getSettings, personaFor, standingOrders } from "./settings";

export type CampaignRow = typeof schema.crmCampaigns.$inferSelect;
export type LeadRow = typeof schema.crmCampaignLeads.$inferSelect;

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/* ---------------- Campaigns ---------------- */

async function own(userId: string, id: number): Promise<CampaignRow> {
  const [c] = await requireDb().select().from(schema.crmCampaigns).where(and(eq(schema.crmCampaigns.id, id), eq(schema.crmCampaigns.userId, userId)));
  if (!c) throw new Error("Campaign not found");
  return c;
}

function campaignValues(input: Partial<CampaignRow>, base?: CampaignRow) {
  const cap = Math.round(Number(input.dailyCap ?? base?.dailyCap ?? 10));
  return {
    name: (input.name ?? base?.name ?? "").toString().trim().slice(0, 120) || "Untitled campaign",
    goal: (input.goal ?? base?.goal ?? "").toString().slice(0, 1000),
    icp: (input.icp ?? base?.icp ?? "").toString().slice(0, 3000),
    instructions: (input.instructions ?? base?.instructions ?? "").toString().slice(0, 3000),
    steps: normalizeSteps(input.steps ?? base?.steps),
    dailyCap: Number.isFinite(cap) ? Math.min(50, Math.max(1, cap)) : 10,
    sendMode: isSendMode(input.sendMode) ? input.sendMode : (base?.sendMode ?? "default"),
    consentRegions: typeof input.consentRegions === "boolean" ? input.consentRegions : (base?.consentRegions ?? false),
    status: (CAMPAIGN_STATUSES as readonly string[]).includes(input.status ?? "") ? (input.status as CampaignStatus) : (base?.status ?? "draft"),
    updatedAt: new Date(),
  };
}

export async function createCampaign(userId: string, input: Partial<CampaignRow>): Promise<CampaignRow> {
  const [row] = await requireDb().insert(schema.crmCampaigns).values({ userId, ...campaignValues(input) }).returning();
  return row;
}

export async function updateCampaign(userId: string, id: number, input: Partial<CampaignRow>): Promise<CampaignRow> {
  const base = await own(userId, id);
  const [row] = await requireDb().update(schema.crmCampaigns).set(campaignValues(input, base)).where(eq(schema.crmCampaigns.id, id)).returning();
  return row;
}

/** Deleting a campaign withdraws its unsent drafts too; anything already sent stays in the inbox. */
export async function deleteCampaign(userId: string, id: number): Promise<void> {
  const db = requireDb();
  await own(userId, id);
  const leadIds = (await db.select({ id: schema.crmCampaignLeads.id }).from(schema.crmCampaignLeads).where(eq(schema.crmCampaignLeads.campaignId, id))).map((l) => l.id);
  if (leadIds.length) {
    await db.update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
      .where(and(inArray(schema.crmDrafts.campaignLeadId, leadIds), eq(schema.crmDrafts.status, "pending")));
  }
  await db.delete(schema.crmCampaigns).where(eq(schema.crmCampaigns.id, id));
}

export type CampaignStats = {
  leads: number; byStatus: Record<string, number>; contacted: number; replied: number; replyRate: number | null;
  emailsSent: number; pendingDrafts: number; dealsOpened: number; repliesByStep: number[]; needsEmail: number;
};

/** The funnel: sourced, qualified, contacted, replied, and deals that came out of it. */
export function statsFor(campaign: CampaignRow, leads: LeadRow[], drafts: { campaignLeadId: number | null; status: string }[], deals: { contactId: number | null; createdAt: Date }[]): CampaignStats {
  const byStatus: Record<string, number> = {};
  for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
  const contacted = leads.filter((l) => l.lastSentAt).length;
  const replied = leads.filter((l) => l.repliedAt).length;
  const steps = normalizeSteps(campaign.steps);
  const repliesByStep = steps.map((_, i) => leads.filter((l) => l.repliedAt && l.repliedAtStep === i).length);
  const leadAdded = new Map(leads.filter((l) => l.contactId).map((l) => [l.contactId!, l.createdAt]));
  const dealsOpened = deals.filter((d) => d.contactId && leadAdded.has(d.contactId) && d.createdAt >= leadAdded.get(d.contactId)!).length;
  return {
    leads: leads.length, byStatus, contacted, replied, replyRate: contacted ? replied / contacted : null,
    emailsSent: drafts.filter((d) => d.status === "sent").length, pendingDrafts: drafts.filter((d) => d.status === "pending").length,
    dealsOpened, repliesByStep,
    needsEmail: leads.filter((l) => !l.email && (l.status === "qualified" || l.status === "review" || l.status === "sourced")).length,
  };
}

async function loadFunnel(userId: string, campaigns: CampaignRow[]) {
  const db = requireDb();
  const ids = campaigns.map((c) => c.id);
  if (ids.length === 0) return { leads: [] as LeadRow[], drafts: [] as { campaignLeadId: number | null; status: string }[], deals: [] as { contactId: number | null; createdAt: Date }[] };
  const leads = await db.select().from(schema.crmCampaignLeads).where(inArray(schema.crmCampaignLeads.campaignId, ids)).orderBy(desc(schema.crmCampaignLeads.fit), asc(schema.crmCampaignLeads.id));
  const leadIds = leads.map((l) => l.id);
  const contactIds = leads.map((l) => l.contactId).filter((x): x is number => x != null);
  const [drafts, deals] = await Promise.all([
    leadIds.length ? db.select({ campaignLeadId: schema.crmDrafts.campaignLeadId, status: schema.crmDrafts.status }).from(schema.crmDrafts).where(inArray(schema.crmDrafts.campaignLeadId, leadIds)) : [],
    contactIds.length ? db.select({ contactId: schema.crmDeals.contactId, createdAt: schema.crmDeals.createdAt }).from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.contactId, contactIds))) : [],
  ]);
  return { leads, drafts, deals };
}

export async function listCampaigns(userId: string) {
  const campaigns = await requireDb().select().from(schema.crmCampaigns).where(eq(schema.crmCampaigns.userId, userId)).orderBy(desc(schema.crmCampaigns.createdAt));
  const { leads, drafts, deals } = await loadFunnel(userId, campaigns);
  const leadCampaign = new Map(leads.map((l) => [l.id, l.campaignId]));
  return campaigns.map((c) => ({
    ...c,
    stats: statsFor(c, leads.filter((l) => l.campaignId === c.id), drafts.filter((d) => d.campaignLeadId && leadCampaign.get(d.campaignLeadId) === c.id), deals),
  }));
}

export async function getCampaign(userId: string, id: number) {
  const campaign = await own(userId, id);
  const { leads, drafts, deals } = await loadFunnel(userId, [campaign]);
  return { campaign, leads, stats: statsFor(campaign, leads, drafts, deals) };
}

/* ---------------- Leads ---------------- */

export type LeadInput = { email?: string; name?: string; company?: string; notes?: string; startupId?: number | null };

/**
 * Add people to a campaign, from the startup directory or a pasted list.
 *
 * YouBank's directory has companies and founders but no email addresses, and none are guessed: a
 * directory lead without an address waits until someone supplies one. Duplicates within the
 * campaign are skipped, and anyone who has opted out is added as opted out so they are never written to.
 */
export async function addLeads(userId: string, campaignId: number, items: LeadInput[]): Promise<{ added: number; skipped: number }> {
  const db = requireDb();
  await own(userId, campaignId);
  const existing = await db.select({ email: schema.crmCampaignLeads.email, startupId: schema.crmCampaignLeads.startupId })
    .from(schema.crmCampaignLeads).where(eq(schema.crmCampaignLeads.campaignId, campaignId));
  const seenEmail = new Set(existing.map((e) => e.email).filter(Boolean));
  const seenStartup = new Set(existing.map((e) => e.startupId).filter((x): x is number => x != null));

  let added = 0, skipped = 0;
  for (const raw of items.slice(0, 200)) {
    const email = (raw.email ?? "").trim().toLowerCase();
    if (email && !EMAIL.test(email)) { skipped++; continue; }
    const startup = raw.startupId ? await getStartup(raw.startupId).catch(() => null) : null;
    if ((email && seenEmail.has(email)) || (!email && startup && seenStartup.has(startup.id)) || (!email && !startup)) { skipped++; continue; }

    const company = (raw.company ?? "").trim() || startup?.name || "";
    const contact = email ? await upsertContact(userId, { email, name: raw.name, company, startupId: startup?.id ?? null }) : null;
    await db.insert(schema.crmCampaignLeads).values({
      campaignId, userId, email, contactId: contact?.id ?? null, startupId: startup?.id ?? null,
      name: (raw.name ?? "").trim().slice(0, 200), company: company.slice(0, 200), notes: (raw.notes ?? "").slice(0, 1000),
      status: contact?.optedOutAt ? "opted_out" : "sourced",
    });
    if (email) seenEmail.add(email);
    if (startup) seenStartup.add(startup.id);
    added++;
  }
  return { added, skipped };
}

/** "email, name, company" per line; a line with only an address is fine. */
export function parseLeadList(text: string): LeadInput[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const cells = line.split(/\t|,/).map((c) => c.trim());
    const email = cells.find((c) => EMAIL.test(c.replace(/^<|>$/g, "")))?.replace(/^<|>$/g, "") ?? "";
    const rest = cells.filter((c) => c && c.replace(/^<|>$/g, "") !== email);
    return { email, name: rest[0] ?? "", company: rest[1] ?? "", notes: rest.slice(2).join(", ") };
  }).filter((l) => l.email);
}

/** A person's decision about one lead: supply an address, overrule the agent's verdict, add notes. */
export async function updateLead(userId: string, leadId: number, fields: { email?: string; status?: string; notes?: string; name?: string }): Promise<LeadRow> {
  const db = requireDb();
  const [lead] = await db.select().from(schema.crmCampaignLeads).where(and(eq(schema.crmCampaignLeads.id, leadId), eq(schema.crmCampaignLeads.userId, userId)));
  if (!lead) throw new Error("Lead not found");
  const set: Partial<LeadRow> = {};
  if (fields.name !== undefined) set.name = fields.name.trim().slice(0, 200);
  if (fields.notes !== undefined) set.notes = fields.notes.slice(0, 1000);
  if (fields.email !== undefined) {
    const email = fields.email.trim().toLowerCase();
    if (email && !EMAIL.test(email)) throw new Error("That is not an email address");
    if (lead.lastSentAt && email !== lead.email) throw new Error("This lead has already been written to, so the address cannot change");
    set.email = email;
    if (email) {
      const c = await upsertContact(userId, { email, name: set.name ?? lead.name, company: lead.company, startupId: lead.startupId });
      set.contactId = c.id;
      if (c.optedOutAt) set.status = "opted_out";
    }
  }
  if (fields.status !== undefined && set.status !== "opted_out") {
    const allowed: LeadStatus[] = ["qualified", "disqualified", "review", "sourced"];
    if (!isLeadStatus(fields.status) || !allowed.includes(fields.status)) throw new Error("That status is set by the agent, not by hand");
    if (lead.lastSentAt) throw new Error("This lead is already in the sequence");
    set.status = fields.status;
    if (fields.status === "qualified" || fields.status === "disqualified") set.fitReason = `${lead.fitReason ? `${lead.fitReason} ` : ""}(Set by you.)`.trim();
  }
  const [row] = await db.update(schema.crmCampaignLeads).set(set).where(eq(schema.crmCampaignLeads.id, leadId)).returning();
  return row;
}

export async function removeLead(userId: string, leadId: number): Promise<void> {
  const db = requireDb();
  await db.update(schema.crmDrafts).set({ status: "discarded", decidedAt: new Date() })
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.campaignLeadId, leadId), eq(schema.crmDrafts.status, "pending")));
  await db.delete(schema.crmCampaignLeads).where(and(eq(schema.crmCampaignLeads.id, leadId), eq(schema.crmCampaignLeads.userId, userId)));
}

/* ---------------- Qualification ---------------- */

/**
 * Whether anyone on YouBank sent this person a first campaign email in the last 30 days. Many users
 * will reach the same founders; one cold first touch per person per month is the platform's limit.
 */
async function contactedRecently(email: string): Promise<boolean> {
  if (!email) return false;
  const [row] = await requireDb().select({ id: schema.crmDrafts.id }).from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.kind, "campaign"), eq(schema.crmDrafts.status, "sent"), gte(schema.crmDrafts.sentAt, new Date(Date.now() - 30 * 86_400_000)),
      sql`coalesce((${schema.crmDrafts.meta}->>'step')::int, 0) = 0`, sql`${schema.crmDrafts.toAddresses} @> ${JSON.stringify([{ address: email }])}::jsonb`))
    .limit(1);
  return !!row;
}

/** Score unqualified leads against the ICP, twelve to a call. Unsure verdicts go to a person. */
export async function qualifyCampaign(userId: string, campaignId: number, deadline = Date.now() + 240_000) {
  const db = requireDb();
  const campaign = await own(userId, campaignId);
  const leads = await db.select().from(schema.crmCampaignLeads)
    .where(and(eq(schema.crmCampaignLeads.campaignId, campaignId), eq(schema.crmCampaignLeads.status, "sourced"))).limit(120);
  if (leads.length === 0) return { scored: 0, qualified: 0, disqualified: 0, review: 0, errors: [] as string[] };

  const [ctx, settings] = await Promise.all([loadUserContext(userId), getSettings(userId)]);
  const batches: LeadRow[][] = [];
  for (let i = 0; i < leads.length; i += 12) batches.push(leads.slice(i, i + 12));
  const tally = { scored: 0, qualified: 0, disqualified: 0, review: 0 };

  const { errors } = await pool(batches, 3, deadline, async (batch) => {
    const records = await Promise.all(batch.map((l) => directoryRecord(l.startupId)));
    const { data } = await qualifyLeads({
      icp: campaign.icp, goal: campaign.goal, orders: standingOrders(settings, { forTriage: true }),
      leads: batch.map((l, i) => ({ id: l.id, name: l.name, company: l.company, email: l.email, notes: l.notes, directory: records[i] })),
    }, { prefs: ctx.prefs });
    for (const v of data.leads) {
      if (!batch.some((l) => l.id === v.id)) continue; // ignore ids the model made up
      const status: LeadStatus = v.verdict === "qualified" ? "qualified" : v.verdict === "disqualified" ? "disqualified" : "review";
      await db.update(schema.crmCampaignLeads).set({ status, fit: Math.round(Math.min(100, Math.max(0, v.fit))), fitReason: v.reason.slice(0, 500) })
        .where(and(eq(schema.crmCampaignLeads.id, v.id), eq(schema.crmCampaignLeads.status, "sourced")));
      tally.scored++;
      tally[status === "review" ? "review" : status]++;
    }
  });
  return { ...tally, errors };
}

/* ---------------- Writing the next step ---------------- */

export type PrepareResult = { campaignId: number; drafted: number; draftIds: number[]; waitingForEmail: number; capped: boolean; errors: string[] };

/**
 * Draft whatever is due in a live campaign, up to what is left of today's cap.
 *
 * Due means: qualified and not yet written to, or in the sequence with the next step's date passed.
 * The drafts go to the review queue. The sequence advances only when a person sends one.
 */
export async function prepareCampaign(userId: string, campaignId: number, deadline = Date.now() + 240_000): Promise<PrepareResult> {
  const db = requireDb();
  const campaign = await own(userId, campaignId);
  const out: PrepareResult = { campaignId, drafted: 0, draftIds: [], waitingForEmail: 0, capped: false, errors: [] };
  if (campaign.status !== "active") { out.errors.push("The campaign is not active. Launch it first."); return out; }
  const steps = normalizeSteps(campaign.steps);
  const now = new Date();

  const leads = await db.select().from(schema.crmCampaignLeads).where(and(
    eq(schema.crmCampaignLeads.campaignId, campaignId),
    or(eq(schema.crmCampaignLeads.status, "qualified"), and(eq(schema.crmCampaignLeads.status, "active"), lte(schema.crmCampaignLeads.nextDueAt, now))),
  )).orderBy(desc(schema.crmCampaignLeads.fit));

  const leadIds = leads.map((l) => l.id);
  const drafts = leadIds.length
    ? await db.select().from(schema.crmDrafts).where(inArray(schema.crmDrafts.campaignLeadId, leadIds)).orderBy(asc(schema.crmDrafts.createdAt))
    : [];
  const waiting = new Set(drafts.filter((d) => d.status === "pending").map((d) => d.campaignLeadId));

  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ n: today }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts)
    .innerJoin(schema.crmCampaignLeads, eq(schema.crmCampaignLeads.id, schema.crmDrafts.campaignLeadId))
    .where(and(eq(schema.crmCampaignLeads.campaignId, campaignId), gte(schema.crmDrafts.createdAt, startOfDay)));
  const room = Math.max(0, campaign.dailyCap - today);

  const due = leads.filter((l) => !waiting.has(l.id) && l.step < steps.length);
  out.waitingForEmail = due.filter((l) => !l.email).length;
  const ready = due.filter((l) => l.email);
  out.capped = ready.length > room;
  if (ready.length === 0 || room === 0) return out;

  const [ctx, settings, playbook] = await Promise.all([loadUserContext(userId), getSettings(userId), listPlaybook(userId)]);
  const [lessons, examples] = await Promise.all([lessonsFor(userId, "campaign"), ownExamples(userId, `${campaign.goal} ${campaign.instructions}`)]);
  const orders = [standingOrders(settings), lessons, examples].filter(Boolean).join("\n\n");
  const book = renderPlaybook(selectPlaybook(asEntries(playbook), `${campaign.goal} ${campaign.icp} ${campaign.instructions}`));
  const threadIds = ready.map((l) => l.threadId).filter((x): x is number => x != null);
  const threads = threadIds.length ? await db.select().from(schema.crmThreads).where(inArray(schema.crmThreads.id, threadIds)) : [];

  const { errors } = await pool(ready.slice(0, room), 3, deadline, async (lead) => {
    const earlier = drafts.filter((d) => d.campaignLeadId === lead.id && d.status === "sent").map((d) => ({ subject: d.subject, body: d.body }));
    const directory = await directoryRecord(lead.startupId);
    if (lead.step === 0 && !campaign.consentRegions && needsConsent(lead.email)) {
      await db.update(schema.crmCampaignLeads).set({ status: "disqualified", fitReason: "Skipped: cold email to this country usually needs prior consent (GDPR, CASL). Tick the consent box on the campaign if you have a lawful basis." })
        .where(eq(schema.crmCampaignLeads.id, lead.id));
      return;
    }
    if (lead.step === 0 && (await contactedRecently(lead.email))) {
      await db.update(schema.crmCampaignLeads).set({ status: "disqualified", fitReason: "Skipped: this person already received a first email sent through YouBank in the last 30 days. One per person per month keeps cold email humane." })
        .where(eq(schema.crmCampaignLeads.id, lead.id));
      return;
    }
    // The first email's opening angle is an experiment: Thompson sampling over what has earned replies,
    // among the angles this lead makes available ("why now" only with a fresh Form D).
    const choice = lead.step === 0 ? await chooseArm(userId, "angle", availableAngles(directory)).catch(() => null) : null;
    const angle = choice?.arm ?? null;
    const { data, provider, model } = await writeStep({
      mode: settings.mode, persona: personaFor(ctx, settings), orders, playbook: book, goal: campaign.goal,
      campaignInstructions: [campaign.instructions, angle ? `Opening for this email: ${ANGLES[angle].instruction}` : ""].filter(Boolean).join("\n"),
      steps, stepIndex: lead.step,
      lead: { name: lead.name, email: lead.email, company: lead.company, notes: lead.notes, fitReason: lead.fitReason },
      directory, earlier,
    }, { prefs: ctx.prefs });

    // Later steps stay in the first email's thread, under its subject.
    const thread = lead.step > 0 ? threads.find((t) => t.id === lead.threadId) : undefined;
    const subject = thread ? `Re: ${thread.subject.replace(/^(re:\s*)+/i, "")}` : data.subject;
    const [draft] = await db.insert(schema.crmDrafts).values({
      userId, kind: "campaign", campaignLeadId: lead.id, contactId: lead.contactId, threadId: thread?.id ?? null,
      toAddresses: [{ name: lead.name, address: lead.email }], subject, body: data.body, originalBody: data.body,
      variant: choice ? formatVariant({ angle: choice.arm, p: choice.propensity.toFixed(3), explore: choice.explore ? "1" : "" }) : "",
      rationale: data.personalization.length ? `Step ${lead.step + 1} of ${steps.length}. Uses: ${data.personalization.join("; ")}` : `Step ${lead.step + 1} of ${steps.length}.`,
      citations: data.openQuestions.map((q) => ({ label: q, url: "" })), meta: { step: lead.step }, provider, model,
      confidence: data.confidence, sensitive: data.sensitive,
    }).returning({ id: schema.crmDrafts.id });
    out.drafted++;
    out.draftIds.push(draft.id);
  });
  out.errors.push(...errors);
  return out;
}
