/**
 * Keeping the stored window of events in step with each provider. Server only, and free: no AI, no
 * paid API (Google, Microsoft and CalDAV reads cost nothing).
 *
 * The window is 30 days back and 90 ahead. Each calendar is read incrementally where the provider
 * allows (Google sync tokens, Graph delta links, CalDAV sync-collection, an ICS feed's ETag) and in
 * full otherwise; a full read replaces everything stored for that calendar in the window. Stored
 * events are linked to Relationships contacts and deals as they are written (match.ts), and links are
 * refreshed on every pass so a contact added today is linked to next week's meeting.
 *
 * Who calls it: the cron (/api/cron/calendar, every 15 minutes through a Neon Function or daily on
 * Vercel Hobby), push notifications from Google and Microsoft, the Sync button, and every write.
 */
import { and, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { describeFailure } from "@/lib/errors";
import { lease } from "@/lib/locks";
import { listAccounts, markNeedsReauth, providerFor, type AccountRow, type CalendarRow } from "./accounts";
import { linkMeeting, type ContactLite, type DealLite } from "./match";
import { ProviderError, type CalendarProvider } from "./provider";
import { syncWindow, type Interval, type RemoteEvent, type SyncPage } from "./types";

export type LinkContext = { contacts: ContactLite[]; deals: DealLite[]; selfEmails: string[] };

/** Everything needed to link one person's meetings: their contacts, open deals and own addresses. */
export async function loadLinkContext(userId: string): Promise<LinkContext> {
  const db = requireDb();
  const [contacts, deals, mail, cals, prefs] = await Promise.all([
    db.select({ id: schema.crmContacts.id, email: schema.crmContacts.email, name: schema.crmContacts.name, company: schema.crmContacts.company, domain: schema.crmContacts.domain })
      .from(schema.crmContacts).where(eq(schema.crmContacts.userId, userId)).limit(5000).catch(() => []),
    db.select({ id: schema.crmDeals.id, name: schema.crmDeals.name, contactId: schema.crmDeals.contactId, status: schema.crmDeals.status })
      .from(schema.crmDeals).where(eq(schema.crmDeals.userId, userId)).limit(2000).catch(() => []),
    db.select({ address: schema.emailAccounts.address }).from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, userId)).catch(() => []),
    db.select({ address: schema.calendarAccounts.address, provider: schema.calendarAccounts.provider }).from(schema.calendarAccounts).where(eq(schema.calendarAccounts.userId, userId)),
    db.select({ email: schema.calendarPrefs.email }).from(schema.calendarPrefs).where(eq(schema.calendarPrefs.userId, userId)).catch(() => []),
  ]);
  const selfEmails = [...mail.map((m) => m.address), ...cals.filter((c) => c.provider !== "ics" && c.address.includes("@")).map((c) => c.address), ...prefs.map((p) => p.email)].filter(Boolean);
  return { contacts, deals, selfEmails };
}

const overlapsWindow = (e: Pick<RemoteEvent, "start" | "end">, w: Interval) => e.start.getTime() < w.end && e.end.getTime() >= w.start;

function rowFor(userId: string, calendarId: number, e: RemoteEvent, ctx: LinkContext): typeof schema.calendarEvents.$inferInsert {
  const links = linkMeeting({ title: e.title, organizer: e.organizer, attendees: e.attendees }, ctx.contacts, ctx.deals, ctx.selfEmails);
  return {
    userId, calendarId, remoteId: e.remoteId.slice(0, 1000), groupKey: e.group.slice(0, 1000), icalUid: e.icalUid.slice(0, 1000), recurrenceId: e.recurrenceId, seriesId: e.seriesId,
    title: e.title.slice(0, 500), description: e.description.slice(0, 20_000), location: e.location.slice(0, 1000),
    startsAt: e.start, endsAt: e.end, allDay: e.allDay, timezone: e.timezone, status: e.status, busy: e.busy,
    organizer: e.organizer, attendees: e.attendees.slice(0, 200), videoUrl: e.videoUrl, htmlLink: e.htmlLink, etag: e.etag, href: e.href,
    contactIds: links.contactIds, dealIds: links.dealIds, external: links.external, updatedAt: new Date(),
  };
}

const ex = (col: string) => sql.raw(`excluded."${col}"`);

/** Write one page of changes for a calendar. Pure database work; returns how many rows were written. */
export async function applyPage(userId: string, cal: Pick<CalendarRow, "id">, page: SyncPage, window: Interval, ctx: LinkContext): Promise<number> {
  const db = requireDb();
  const E = schema.calendarEvents;
  const upserts = page.upserts.filter((e) => overlapsWindow(e, window));
  const keep = upserts.map((e) => e.remoteId.slice(0, 1000));
  // An incremental read reports changes anywhere in time; one moved out of the window leaves it.
  const movedOut = page.upserts.filter((e) => !overlapsWindow(e, window)).map((e) => e.remoteId.slice(0, 1000));
  for (let i = 0; i < movedOut.length; i += 200) {
    await db.delete(E).where(and(eq(E.calendarId, cal.id), inArray(E.remoteId, movedOut.slice(i, i + 200))));
  }

  if (page.full) {
    await db.delete(E).where(and(eq(E.calendarId, cal.id), ...(keep.length ? [notInArray(E.remoteId, keep)] : [])));
  }
  for (let i = 0; i < page.replacedGroups.length; i += 200) {
    const groups = page.replacedGroups.slice(i, i + 200);
    await db.delete(E).where(and(eq(E.calendarId, cal.id), inArray(E.groupKey, groups), ...(keep.length ? [notInArray(E.remoteId, keep)] : [])));
  }
  for (let i = 0; i < page.removed.length; i += 200) {
    const ids = page.removed.slice(i, i + 200);
    // A removed series master takes its occurrences with it.
    await db.delete(E).where(and(eq(E.calendarId, cal.id), or(inArray(E.remoteId, ids), inArray(E.seriesId, ids))));
  }
  for (let i = 0; i < upserts.length; i += 100) {
    const rows = upserts.slice(i, i + 100).map((e) => rowFor(userId, cal.id, e, ctx));
    await db.insert(E).values(rows).onConflictDoUpdate({
      target: [E.calendarId, E.remoteId],
      set: {
        groupKey: ex("group_key"), icalUid: ex("ical_uid"), recurrenceId: ex("recurrence_id"), seriesId: ex("series_id"), title: ex("title"), description: ex("description"),
        location: ex("location"), startsAt: ex("starts_at"), endsAt: ex("ends_at"), allDay: ex("all_day"), timezone: ex("timezone"), status: ex("status"), busy: ex("busy"),
        organizer: ex("organizer"), attendees: ex("attendees"), videoUrl: ex("video_url"), htmlLink: ex("html_link"), etag: ex("etag"), href: ex("href"),
        contactIds: ex("contact_ids"), dealIds: ex("deal_ids"), external: ex("external"), updatedAt: ex("updated_at"),
      },
    });
  }
  return upserts.length;
}

/** Microsoft's delta windows are fixed at the start; begin a new one once a day as the window slides. */
const DELTA_MAX_AGE = 24 * 3_600_000;

/** Bring one calendar up to date. A stale token falls back to a full read. */
export async function syncCalendar(userId: string, provider: CalendarProvider, cal: CalendarRow, ctx: LinkContext, now = Date.now()): Promise<{ written: number; full: boolean }> {
  const window = syncWindow(now);
  const ref = { remoteId: cal.remoteId, timezone: cal.timezone };
  const stale = provider.id === "microsoft" && cal.windowStart && now - cal.windowStart.getTime() > DELTA_MAX_AGE;
  let token = cal.syncToken && !stale ? cal.syncToken : null;
  let page: SyncPage;
  try {
    page = await provider.listEvents(ref, window, token);
  } catch (e) {
    if (!(token && e instanceof ProviderError && e.kind === "gone")) throw e;
    token = null;
    page = await provider.listEvents(ref, window, null);
  }
  const written = await applyPage(userId, cal, page, window, ctx);
  await requireDb().update(schema.calendarCalendars).set({
    syncToken: page.nextToken ?? "", lastSyncedAt: new Date(now), ...(token ? {} : { windowStart: new Date(now) }),
  }).where(eq(schema.calendarCalendars.id, cal.id));
  return { written, full: page.full };
}

/** Refresh an account's list of calendars: new ones are added (shown), vanished ones removed. */
export async function refreshCalendars(account: AccountRow, provider: CalendarProvider): Promise<CalendarRow[]> {
  const db = requireDb();
  const C = schema.calendarCalendars;
  const remote = await provider.listCalendars();
  const existing = await db.select().from(C).where(eq(C.accountId, account.id));
  const byRemote = new Map(existing.map((c) => [c.remoteId, c]));
  for (const r of remote) {
    const had = byRemote.get(r.remoteId);
    if (had) {
      await db.update(C).set({ name: r.name.slice(0, 200), color: r.color, timezone: r.timezone, canWrite: r.canWrite && provider.writable, isPrimary: r.primary }).where(eq(C.id, had.id));
    } else {
      await db.insert(C).values({ accountId: account.id, userId: account.userId, remoteId: r.remoteId, name: r.name.slice(0, 200), color: r.color, timezone: r.timezone, canWrite: r.canWrite && provider.writable, isPrimary: r.primary, visible: true })
        .onConflictDoNothing();
    }
  }
  const gone = existing.filter((c) => !remote.some((r) => r.remoteId === c.remoteId)).map((c) => c.id);
  if (gone.length) await db.delete(C).where(inArray(C.id, gone));
  return db.select().from(C).where(eq(C.accountId, account.id));
}

export type AccountSyncResult = { accountId: number; calendars: number; written: number; error?: string };

/**
 * Sync every shown calendar of one account. Auth failures mark the account for reconnecting and stop;
 * any other failure is recorded on the account and the next calendar is tried.
 */
export async function syncAccount(account: AccountRow, opts: { calendars?: boolean; only?: number[]; ctx?: LinkContext } = {}): Promise<AccountSyncResult> {
  const db = requireDb();
  const release = await lease(`calendar-sync:${account.id}`, 120_000);
  if (!release) return { accountId: account.id, calendars: 0, written: 0, error: "A sync of this account is already running." };
  try {
    const provider = providerFor(account);
    const ctx = opts.ctx ?? await loadLinkContext(account.userId);
    const all = opts.calendars !== false
      ? await refreshCalendars(account, provider)
      : await db.select().from(schema.calendarCalendars).where(eq(schema.calendarCalendars.accountId, account.id));
    const cals = all.filter((c) => c.visible && (!opts.only || opts.only.includes(c.id)));
    let written = 0;
    const errors: string[] = [];
    for (const c of cals) {
      try {
        written += (await syncCalendar(account.userId, provider, c, ctx)).written;
      } catch (e) {
        if (e instanceof ProviderError && e.kind === "auth") throw e;
        errors.push(`${c.name}: ${describeFailure(e, 502, "calendar-sync").message}`);
      }
    }
    // Hidden calendars keep no events.
    const hidden = all.filter((c) => !c.visible).map((c) => c.id);
    if (hidden.length) await db.delete(schema.calendarEvents).where(inArray(schema.calendarEvents.calendarId, hidden));
    await db.update(schema.calendarAccounts).set({ lastSyncAt: new Date(), lastError: errors.join(" · ").slice(0, 500), ...(errors.length ? {} : { status: "connected" }) }).where(eq(schema.calendarAccounts.id, account.id));
    return { accountId: account.id, calendars: cals.length, written, ...(errors.length ? { error: errors[0] } : {}) };
  } catch (e) {
    const message = describeFailure(e, 502, "calendar-sync").message;
    if (e instanceof ProviderError && e.kind === "auth") await markNeedsReauth(account.id, e.message === "This calendar needs to be reconnected." ? "Sign in again to keep this calendar connected." : e.message);
    else await db.update(schema.calendarAccounts).set({ lastError: message.slice(0, 500) }).where(eq(schema.calendarAccounts.id, account.id));
    return { accountId: account.id, calendars: 0, written: 0, error: message };
  } finally {
    await release();
  }
}

/** Sync all of one person's accounts (the Sync button). */
export async function syncUser(userId: string): Promise<AccountSyncResult[]> {
  const ctx = await loadLinkContext(userId);
  const out: AccountSyncResult[] = [];
  for (const a of await listAccounts(userId)) {
    if (a.status === "needs_reauth") { out.push({ accountId: a.id, calendars: 0, written: 0, error: "Needs reconnecting" }); continue; }
    out.push(await syncAccount(a, { ctx }));
  }
  await relinkUser(userId, ctx).catch(() => undefined);
  return out;
}

/**
 * Re-link stored events to contacts and deals, for meetings that did not change but whose people did
 * (a contact added, a deal closed). Only rows whose links differ are written.
 */
export async function relinkUser(userId: string, ctx?: LinkContext): Promise<number> {
  const db = requireDb();
  const E = schema.calendarEvents;
  const c = ctx ?? await loadLinkContext(userId);
  const rows = await db.select({ id: E.id, title: E.title, organizer: E.organizer, attendees: E.attendees, contactIds: E.contactIds, dealIds: E.dealIds, external: E.external })
    .from(E).where(and(eq(E.userId, userId), sql`${E.endsAt} > now() - interval '30 days'`));
  let changed = 0;
  for (const r of rows) {
    const l = linkMeeting({ title: r.title, organizer: r.organizer, attendees: r.attendees }, c.contacts, c.deals, c.selfEmails);
    if (JSON.stringify(l.contactIds) === JSON.stringify(r.contactIds) && JSON.stringify(l.dealIds) === JSON.stringify(r.dealIds) && l.external === r.external) continue;
    await db.update(E).set({ contactIds: l.contactIds, dealIds: l.dealIds, external: l.external }).where(eq(E.id, r.id));
    changed++;
  }
  return changed;
}

/** Drop events that slid out of the back of the window, for everyone. */
export async function pruneOld(now = Date.now()): Promise<void> {
  await requireDb().delete(schema.calendarEvents).where(lt(schema.calendarEvents.endsAt, new Date(syncWindow(now).start)));
}
