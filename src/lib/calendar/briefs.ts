/**
 * Meeting prep briefs. Server only.
 *
 * Two layers, deliberately apart:
 * - The assembled brief is free and immediate: for each attendee, the contact record, recent emails
 *   from Relationships, what they know and care about (contact knowledge), funding and news signals;
 *   for each company, the startup directory record, its listing if it is public (with a link into the
 *   terminal) and recent stories from the Newsroom; the deals involved and their stage; and when you
 *   last met. Only YouBank's own database and the SEC's free listing are read.
 * - The AI brief turns that into objectives, talking points, questions and watch-outs. It runs only on
 *   a click (premium "calendar.ai_brief"), or in the morning run for people who switched it on
 *   (premium "calendar.auto_brief"). Never on a page load, a sync or a prefetch.
 */
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { runAsUser } from "@/lib/ai/usage";
import { requireFeature } from "@/lib/billing/entitlements";
import type { CurrentUser } from "@/lib/auth/user";
import { directoryRecord } from "@/lib/crm/agent";
import { contactKnowledge } from "@/lib/crm/insights";
import { STAGE_LABEL, type Stage } from "@/lib/crm/model";
import { tickerByName } from "@/lib/edgar/tickers";
import { describeFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { domainOf, isPerson, nameFromEmail, normalizeEmail, PUBLIC_DOMAINS } from "./match";
import { getMeeting, type Meeting } from "./meetings";
import { canUseById, getPrefs, zoneFor } from "./prefs";
import { loadLinkContext } from "./sync";
import { utcToWall, wallDay, wallToUtc, zoneOrUtc } from "./tz";
import { localDate } from "./expand";

export type BriefEmail = { date: string | null; direction: string; subject: string; snippet: string };
export type BriefPerson = {
  email: string; name: string; title: string; company: string; contactId: number | null; kind: string; notes: string;
  lastEmailAt: string | null; recentEmails: BriefEmail[]; talkingPoints: string[]; signals: { title: string; url: string }[];
};
export type BriefCompany = {
  name: string; domain: string;
  listing: { ticker: string; name: string; terminalUrl: string } | null;
  directory: { oneLiner: string; stage: string; raised: string; investors: string; location: string } | null;
  news: { headline: string; date: string; url: string }[];
};
export type BriefDeal = { id: number; name: string; stage: string; status: string; nextStep: string; nextStepDue: string | null; amountUsd: number | null; round: string; notes: string };
export type AssembledBrief = {
  meeting: Pick<Meeting, "id" | "title" | "start" | "end" | "location" | "videoUrl" | "videoProvider" | "description" | "external">;
  people: BriefPerson[]; companies: BriefCompany[]; deals: BriefDeal[]; previousMeetings: { title: string; date: string }[];
};

const snippet = (s: string, n = 280) => s.replace(/\s+/g, " ").trim().slice(0, n);
const str = (v: unknown) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

/** Everything YouBank already knows about a meeting's people, companies and deals. Free. */
export async function assembleBrief(userId: string, eventId: number): Promise<AssembledBrief | null> {
  const db = requireDb();
  const m = await getMeeting(userId, eventId);
  if (!m) return null;
  const ctx = await loadLinkContext(userId);
  const self = new Set(ctx.selfEmails.map(normalizeEmail));
  const everyone = [...(m.organizer ? [m.organizer] : []), ...m.attendees].filter((a) => isPerson(a.email) && !a.self && !self.has(normalizeEmail(a.email)));
  // Colleagues are listed after the people from outside, and their company is not researched.
  const internal = new Set(ctx.selfEmails.map(domainOf).filter((d) => d && !PUBLIC_DOMAINS.has(d)));
  const unique = [...new Map(everyone.map((a) => [normalizeEmail(a.email), a])).values()]
    .sort((x, y) => Number(internal.has(domainOf(x.email))) - Number(internal.has(domainOf(y.email)))).slice(0, 12);
  const contactByEmail = new Map(ctx.contacts.map((c) => [normalizeEmail(c.email), c]));
  const contactIds = unique.map((a) => contactByEmail.get(normalizeEmail(a.email))?.id).filter((x): x is number => !!x);

  const fullContacts = contactIds.length ? await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), inArray(schema.crmContacts.id, contactIds))) : [];
  const cById = new Map(fullContacts.map((c) => [c.id, c]));

  const people: BriefPerson[] = await Promise.all(unique.map(async (a): Promise<BriefPerson> => {
    const c = cById.get(contactByEmail.get(normalizeEmail(a.email))?.id ?? -1);
    const where = c
      ? and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.contactId, c.id))
      : and(eq(schema.crmThreads.userId, userId), or(eq(schema.crmMessages.fromAddress, a.email.toLowerCase()), sql`${schema.crmThreads.participants} @> ${JSON.stringify([{ address: a.email.toLowerCase() }])}::jsonb`));
    const mail = await db.select({ sentAt: schema.crmMessages.sentAt, direction: schema.crmMessages.direction, subject: schema.crmMessages.subject, body: schema.crmMessages.body })
      .from(schema.crmMessages).innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
      .where(where).orderBy(desc(schema.crmMessages.sentAt)).limit(4).catch(() => []);
    const knowledge = c ? await contactKnowledge(userId, c.id).catch(() => null) : null;
    const signals = c ? await db.select({ title: schema.crmSignals.title, url: schema.crmSignals.url }).from(schema.crmSignals)
      .where(and(eq(schema.crmSignals.userId, userId), eq(schema.crmSignals.contactId, c.id))).orderBy(desc(schema.crmSignals.createdAt)).limit(3).catch(() => []) : [];
    return {
      email: a.email, name: c?.name || a.name || nameFromEmail(a.email), title: c?.title ?? "", company: c?.company ?? "", contactId: c?.id ?? null, kind: c?.kind ?? "", notes: snippet(c?.notes ?? "", 600),
      lastEmailAt: mail[0]?.sentAt?.toISOString() ?? null,
      recentEmails: mail.map((x) => ({ date: x.sentAt?.toISOString().slice(0, 10) ?? null, direction: x.direction, subject: x.subject, snippet: snippet(x.body) })),
      talkingPoints: (knowledge?.talkingPoints ?? []).slice(0, 4).map((t) => `${t.topic}: ${t.why}`), signals,
    };
  }));

  // Companies, by domain: the directory, a public listing, and recent stories.
  const domains = new Map<string, { name: string; startupId: number | null }>();
  for (const p of people) {
    const d = domainOf(p.email);
    if (!d || PUBLIC_DOMAINS.has(d) || internal.has(d) || domains.has(d)) continue;
    const c = p.contactId ? cById.get(p.contactId) : undefined;
    domains.set(d, { name: p.company || d.split(".")[0].replace(/^\w/, (x) => x.toUpperCase()), startupId: c?.startupId ?? null });
  }
  const since = new Date(Date.now() - 21 * 86_400_000);
  const companies: BriefCompany[] = await Promise.all([...domains.entries()].slice(0, 5).map(async ([domain, info]): Promise<BriefCompany> => {
    const [dir, listing, news] = await Promise.all([
      directoryRecord(info.startupId).catch(() => null),
      tickerByName(info.name).catch(() => null),
      info.name.length >= 4
        ? db.select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, at: schema.newsClusters.firstSeenAt }).from(schema.newsClusters)
          .where(and(gte(schema.newsClusters.firstSeenAt, since), ilike(schema.newsClusters.headline, `%${info.name.replace(/[%_\\]/g, "")}%`)))
          .orderBy(desc(schema.newsClusters.importance)).limit(3).catch(() => [])
        : Promise.resolve([]),
    ]);
    return {
      name: info.name, domain,
      listing: listing ? { ticker: listing.ticker, name: listing.name, terminalUrl: `/app/terminal?ticker=${encodeURIComponent(listing.ticker)}` } : null,
      directory: dir ? { oneLiner: str(dir.oneLiner), stage: str(dir.fundingStage), raised: str(dir.raised), investors: str(dir.investors).slice(0, 200), location: str(dir.location) } : null,
      news: news.map((n) => ({ headline: n.headline, date: n.at.toISOString().slice(0, 10), url: `/app/news?story=${n.id}` })),
    };
  }));

  const dealRows = m.deals.length ? await db.select().from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.id, m.deals.map((d) => d.id)))) : [];
  const deals: BriefDeal[] = dealRows.map((d) => ({
    id: d.id, name: d.name, stage: STAGE_LABEL[d.stage as Stage] ?? d.stage, status: d.status, nextStep: d.nextStep, nextStepDue: d.nextStepDue?.toISOString().slice(0, 10) ?? null,
    amountUsd: d.amountUsd, round: d.round, notes: snippet(d.notes, 600),
  }));

  const previous = contactIds.length
    ? await db.select({ title: schema.calendarEvents.title, startsAt: schema.calendarEvents.startsAt }).from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, userId), lt(schema.calendarEvents.endsAt, new Date(m.start)), or(...contactIds.map((id) => sql`${schema.calendarEvents.contactIds} @> ${JSON.stringify([id])}::jsonb`))))
      .orderBy(desc(schema.calendarEvents.startsAt)).limit(3).catch(() => [])
    : [];

  return {
    meeting: { id: m.id, title: m.title, start: m.start, end: m.end, location: m.location, videoUrl: m.videoUrl, videoProvider: m.videoProvider, description: snippet(m.description, 1500), external: m.external },
    people, companies, deals, previousMeetings: previous.map((p) => ({ title: p.title, date: p.startsAt.toISOString().slice(0, 10) })),
  };
}

/* ---------------- The AI brief ---------------- */

export const AiBrief = z.object({
  summary: z.string(),
  objectives: z.array(z.string()),
  talkingPoints: z.array(z.string()),
  questions: z.array(z.string()),
  watchOuts: z.array(z.string()),
  people: z.array(z.object({ email: z.string(), note: z.string() })),
});
export type AiBrief = z.infer<typeof AiBrief>;

const SYSTEM = `You prepare a professional for a meeting in the next day. You get what their own records say about the meeting: the people, their recent emails, the companies, any deals and their stage, and recent news.

Rules:
- Use only what is in the material. Never invent a fact, a figure, a title or a relationship. If something important is unknown, say so in watchOuts.
- summary: two or three sentences on who this is with and what is at stake.
- objectives: what the reader should try to leave the meeting with, most important first (at most 4).
- talkingPoints: specific things worth raising, each grounded in the material (at most 6).
- questions: good questions to ask them (at most 5).
- watchOuts: open threads, unanswered emails, sensitivities, stale information (at most 4).
- people: one line per attendee on who they are and what to remember about them.
- Be brief and concrete. No filler.`;

/** The stored AI brief for a meeting, if one was made. */
export async function storedBrief(userId: string, eventId: number): Promise<{ content: AiBrief; createdAt: string; trigger: string } | null> {
  const [row] = await requireDb().select().from(schema.calendarBriefs).where(and(eq(schema.calendarBriefs.userId, userId), eq(schema.calendarBriefs.eventId, eventId))).catch(() => []);
  return row ? { content: row.content as AiBrief, createdAt: row.createdAt.toISOString(), trigger: row.trigger } : null;
}

async function writeBrief(userId: string, eventId: number, trigger: "click" | "morning"): Promise<AiBrief> {
  const assembled = await assembleBrief(userId, eventId);
  if (!assembled) throw Object.assign(new Error("That meeting is not in your calendar any more."), { status: 404 });
  const ctx = await loadUserContext(userId);
  const prompt = [ctx.persona ? `The reader: ${ctx.persona}` : "", `Meeting material (JSON):\n${JSON.stringify(assembled).slice(0, 40_000)}`].filter(Boolean).join("\n\n");
  const { data, provider, model } = await structured(AiBrief, "calendar_brief", SYSTEM, prompt, { prefs: ctx.prefs, task: "draft", maxTokens: 3000, timeoutMs: 90_000 });
  await requireDb().insert(schema.calendarBriefs).values({ userId, eventId, trigger, content: data, provider, model })
    .onConflictDoUpdate({ target: schema.calendarBriefs.eventId, set: { content: data, provider, model, trigger, createdAt: new Date() } });
  return data;
}

/** A person pressed "Write the brief". Checks the plan before anything is spent. */
export async function generateBrief(user: Pick<CurrentUser, "id" | "email">, eventId: number): Promise<AiBrief> {
  await requireFeature(user, "calendar.ai_brief");
  await rateLimit(`calendar-brief:${user.id}`, 30, 3_600_000, "That is a lot of briefs this hour. Try again in a little while.");
  return writeBrief(user.id, eventId, "click");
}

/**
 * The morning run for one person, if they switched it on and their plan includes it: brief today's
 * external meetings that have no brief yet (at most eight), once per local day, after 06:00 their time.
 */
export async function morningBriefs(userId: string, now = Date.now()): Promise<{ briefed: number; skipped?: string }> {
  const prefs = await getPrefs(userId);
  if (!prefs.autoBrief) return { briefed: 0, skipped: "off" };
  if (!(await canUseById(userId, "calendar.auto_brief"))) return { briefed: 0, skipped: "plan" };
  const tz = zoneFor(prefs);
  const zone = zoneOrUtc(tz);
  const today = localDate(now, zone);
  const wall = utcToWall(zone, now);
  if (prefs.autoBriefLast === today || (wall - wallDay(wall)) < 6 * 3_600_000) return { briefed: 0, skipped: "not yet" };
  // Claim the day first, so an overlapping run cannot brief twice.
  const claimed = await requireDb().update(schema.calendarPrefs).set({ autoBriefLast: today })
    .where(and(eq(schema.calendarPrefs.userId, userId), sql`${schema.calendarPrefs.autoBriefLast} <> ${today}`)).returning({ u: schema.calendarPrefs.userId });
  if (!claimed.length) return { briefed: 0, skipped: "claimed" };
  const dayEnd = wallToUtc(zone, wallDay(wall) + 86_400_000);
  const E = schema.calendarEvents;
  const rows = await requireDb().select({ id: E.id }).from(E).innerJoin(schema.calendarCalendars, eq(schema.calendarCalendars.id, E.calendarId))
    .leftJoin(schema.calendarBriefs, eq(schema.calendarBriefs.eventId, E.id))
    .where(and(eq(E.userId, userId), eq(schema.calendarCalendars.visible, true), eq(E.external, true), eq(E.allDay, false), sql`${E.status} <> 'cancelled'`,
      gte(E.startsAt, new Date(now)), lt(E.startsAt, new Date(dayEnd)), sql`${schema.calendarBriefs.id} is null`))
    .orderBy(E.startsAt).limit(8);
  let briefed = 0;
  for (const r of rows) {
    try {
      await runAsUser(userId, () => writeBrief(userId, r.id, "morning"));
      briefed++;
    } catch (e) {
      describeFailure(e, 500, "calendar-morning-brief");
      break; // a spend limit or an outage: stop for today rather than fail eight times
    }
  }
  return { briefed };
}
