/**
 * Microsoft 365 and Outlook.com over Microsoft Graph. Server only.
 *
 * One app registration serves both work and personal accounts when MICROSOFT_TENANT is "common"
 * (the default). Scopes: Calendars.ReadWrite (read, write and free/busy on the person's own
 * calendars), User.Read (their address) and offline_access (a refresh token).
 *
 * Every request asks Graph for UTC (`Prefer: outlook.timezone="UTC"`), so times never need Windows
 * zone names. All-day events come back as midnight to midnight and are read as dates.
 *
 * Sync: calendarView/delta, which expands series into occurrences within the window and returns a
 * deltaLink for the next read. A delta's window is fixed when it starts, so the sync layer starts a
 * fresh one daily as the window slides. Where delta is refused the window is read with calendarView.
 * Push: Graph subscriptions on the calendar's events post to /api/calendar/webhooks/microsoft; they
 * last under three days and the sync cron renews them.
 *
 * Invitations: Graph sends them itself whenever an event with attendees is created or changed in the
 * organiser's calendar. Cancelling a meeting the person organised uses /cancel, which tells attendees.
 */
import { emailFromIdToken, jsonCall, ProviderError, tokenRequest, type CalendarProvider, type CalendarRef, type Fetch, type ProviderPatch, type PushCapable, type PushChannel } from "../provider";
import type { Attendee, EventDraft, EventRef, Interval, RemoteCalendar, RemoteEvent, SyncPage, WriteOptions } from "../types";
import { findVideoLink } from "../video";
import { describeWithLink } from "../ical-write";

export const MICROSOFT_SCOPES = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];
const API = "https://graph.microsoft.com/v1.0";
const LABEL = "Microsoft 365";

export type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; tenant: string };

export function microsoftConfig(origin: string): OAuthConfig | null {
  const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenant: process.env.MICROSOFT_TENANT || "common", redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/calendar/oauth/microsoft/callback` };
}

const authority = (cfg: OAuthConfig) => `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0`;

export function microsoftAuthUrl(cfg: OAuthConfig, state: string, loginHint?: string): string {
  const u = new URL(`${authority(cfg)}/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

export const microsoftExchange = (f: Fetch, cfg: OAuthConfig, code: string) =>
  tokenRequest(f, "Microsoft", `${authority(cfg)}/token`, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code", scope: MICROSOFT_SCOPES.join(" ") });

export const microsoftRefresh = (f: Fetch, cfg: OAuthConfig, refreshToken: string) =>
  tokenRequest(f, "Microsoft", `${authority(cfg)}/token`, { refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", scope: MICROSOFT_SCOPES.join(" ") });

export async function microsoftAddress(f: Fetch, accessToken: string, idToken?: string): Promise<string> {
  const me = await jsonCall<{ mail?: string | null; userPrincipalName?: string }>(f, LABEL, `${API}/me?$select=mail,userPrincipalName`, { headers: { authorization: `Bearer ${accessToken}` } }).catch(() => null);
  return (me?.mail || me?.userPrincipalName || emailFromIdToken(idToken)).toLowerCase();
}

/* ---------------- Graph's shapes ---------------- */

type MTime = { dateTime: string; timeZone?: string };
type MAddress = { emailAddress?: { name?: string; address?: string } };
export type MEvent = {
  id: string; "@removed"?: { reason?: string }; "@odata.etag"?: string; changeKey?: string;
  subject?: string; bodyPreview?: string; body?: { contentType?: string; content?: string };
  location?: { displayName?: string }; start?: MTime; end?: MTime; isAllDay?: boolean; isCancelled?: boolean; showAs?: string;
  organizer?: MAddress; attendees?: (MAddress & { status?: { response?: string }; type?: string })[];
  onlineMeeting?: { joinUrl?: string } | null; onlineMeetingUrl?: string | null; webLink?: string; iCalUId?: string;
  seriesMasterId?: string | null; type?: string; originalStart?: string | null; isOrganizer?: boolean;
};
type MPage<T> = { value?: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

const RESPONSE: Record<string, string> = { accepted: "accepted", declined: "declined", tentativelyAccepted: "tentative", organizer: "accepted", notResponded: "needsAction", none: "needsAction" };

/** Graph's "2026-10-12T17:00:00.0000000" (UTC by our Prefer header) to a Date. */
const utc = (t?: MTime) => new Date(t?.dateTime ? (/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? t.dateTime : `${t.dateTime.slice(0, 23)}Z`) : 0);

/**
 * An all-day date. Graph keeps all-day events at midnight in their own zone; read through a UTC
 * Prefer header that can come back a few hours either side of midnight, so round to the nearest day.
 */
const allDayDate = (t?: MTime) => { const d = utc(t); return new Date(Math.round(d.getTime() / 86_400_000) * 86_400_000); };

const htmlToText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

export function fromGraph(e: MEvent, calTz: string): RemoteEvent {
  const allDay = !!e.isAllDay;
  const description = e.body?.content ? (e.body.contentType === "html" ? htmlToText(e.body.content) : e.body.content) : (e.bodyPreview ?? "");
  const person = (a: MAddress, organizer = false, response?: string): Attendee => ({
    email: (a.emailAddress?.address ?? "").toLowerCase(), name: a.emailAddress?.name ?? "", response: RESPONSE[response ?? ""] ?? (organizer ? "accepted" : "unknown"), ...(organizer ? { organizer: true } : {}),
  });
  return {
    remoteId: e.id, group: e.id, icalUid: e.iCalUId ?? e.id,
    recurrenceId: e.originalStart ? new Date(e.originalStart).toISOString() : null, seriesId: e.seriesMasterId ?? null,
    title: e.subject || "(no title)", description, location: e.location?.displayName ?? "",
    start: allDay ? allDayDate(e.start) : utc(e.start), end: allDay ? allDayDate(e.end) : utc(e.end), allDay, timezone: calTz,
    status: e.isCancelled ? "cancelled" : e.showAs === "tentative" ? "tentative" : "confirmed",
    busy: e.showAs !== "free" && e.showAs !== "workingElsewhere",
    organizer: e.organizer?.emailAddress?.address ? person(e.organizer, true) : null,
    attendees: (e.attendees ?? []).filter((a) => a.type !== "resource" && a.emailAddress?.address).map((a) => ({ ...person(a, false, a.status?.response), ...(a.type === "optional" ? { optional: true } : {}) })),
    videoUrl: findVideoLink(e.onlineMeeting?.joinUrl, e.onlineMeetingUrl, e.location?.displayName, description),
    htmlLink: e.webLink ?? "", etag: e["@odata.etag"] ?? e.changeKey ?? "", href: "",
  };
}

const graphTime = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
const graphDate = (d: Date) => ({ dateTime: `${d.toISOString().slice(0, 10)}T00:00:00`, timeZone: "UTC" });

/* ---------------- The adapter ---------------- */

export class MicrosoftCalendar implements CalendarProvider, PushCapable {
  readonly id = "microsoft" as const;
  readonly writable = true;
  constructor(private readonly token: () => Promise<string>, private readonly f: Fetch = fetch, private readonly address = "") {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const t = await this.token();
    return jsonCall<T>(this.f, LABEL, path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${t}`, prefer: 'outlook.timezone="UTC", odata.maxpagesize=100', ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const r = await this.call<MPage<{ id: string; name?: string; hexColor?: string; canEdit?: boolean; isDefaultCalendar?: boolean }>>("/me/calendars?$top=100");
    // The mailbox's zone would need MailboxSettings.Read; times arrive in UTC anyway, and the
    // person's own zone (Settings) is used for display and scheduling.
    return (r.value ?? []).map((c) => ({ remoteId: c.id, name: c.name ?? "Calendar", color: c.hexColor ?? "", timezone: "", canWrite: c.canEdit !== false, primary: !!c.isDefaultCalendar }));
  }

  async listEvents(cal: CalendarRef, window: Interval, syncToken: string | null): Promise<SyncPage> {
    const upserts: RemoteEvent[] = [], removed: string[] = [];
    const range = `startDateTime=${new Date(window.start).toISOString()}&endDateTime=${new Date(window.end).toISOString()}`;
    let url: string | undefined = syncToken ?? `${API}/me/calendars/${encodeURIComponent(cal.remoteId)}/calendarView/delta?${range}`;
    let deltaLink: string | null = null;
    let usedDelta = true;
    while (url) {
      let page: MPage<MEvent>;
      try {
        page = await this.call<MPage<MEvent>>(url);
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 410) throw new ProviderError("The delta link expired", "gone", 410);
        // Some calendars (shared, some personal accounts) refuse delta: read the window plainly.
        if (!syncToken && usedDelta && e instanceof ProviderError && [400, 404, 501].includes(e.httpStatus)) {
          usedDelta = false;
          url = `${API}/me/calendars/${encodeURIComponent(cal.remoteId)}/calendarView?${range}&$top=100`;
          continue;
        }
        throw e;
      }
      for (const e of page.value ?? []) {
        if (e["@removed"] || e.isCancelled) removed.push(e.id);
        else if (e.type !== "seriesMaster") upserts.push(fromGraph(e, cal.timezone));
      }
      url = page["@odata.nextLink"];
      if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
    }
    return { upserts, removed, replacedGroups: [], full: !syncToken, nextToken: usedDelta ? deltaLink : null };
  }

  private body(d: Partial<EventDraft> & { start?: Date; end?: Date }) {
    const out: Record<string, unknown> = {};
    if (d.title !== undefined) out.subject = d.title;
    if (d.description !== undefined || d.videoUrl !== undefined) out.body = { contentType: "text", content: describeWithLink(d.description, d.videoUrl) };
    if (d.location !== undefined || d.videoUrl) out.location = { displayName: d.location || d.videoUrl || "" };
    if (d.start && d.end) {
      out.start = d.allDay ? graphDate(d.start) : graphTime(d.start);
      out.end = d.allDay ? graphDate(d.end) : graphTime(d.end);
      out.isAllDay = !!d.allDay;
    }
    if (d.attendees) out.attendees = d.attendees.map((a) => ({ emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) }, type: "required" }));
    return out;
  }

  async createEvent(cal: CalendarRef, d: EventDraft): Promise<RemoteEvent> {
    const body = { ...this.body(d), allowNewTimeProposals: true, ...(d.addConference && !d.videoUrl ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}) };
    const e = await this.call<MEvent>(`/me/calendars/${encodeURIComponent(cal.remoteId)}/events`, { method: "POST", body: JSON.stringify(body) });
    return fromGraph(e, cal.timezone);
  }

  async updateEvent(cal: CalendarRef, ref: EventRef, p: ProviderPatch, opts: WriteOptions & { scope: "instance" | "series" }): Promise<RemoteEvent> {
    const id = opts.scope === "series" && ref.seriesId ? ref.seriesId : ref.remoteId;
    const body = this.body({ ...p, start: p.start, end: p.end });
    if (opts.scope === "series" && ref.seriesId && p.shiftMs) {
      const m = await this.call<MEvent>(`/me/events/${encodeURIComponent(id)}?$select=start,end,isAllDay`);
      body.start = graphTime(new Date(utc(m.start).getTime() + p.shiftMs));
      body.end = graphTime(new Date(utc(m.end).getTime() + p.shiftMs));
    }
    const e = await this.call<MEvent>(`/me/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
    return fromGraph(e, cal.timezone);
  }

  async deleteEvent(_cal: CalendarRef, ref: EventRef, opts: WriteOptions & { scope: "instance" | "series" }): Promise<void> {
    const id = encodeURIComponent(opts.scope === "series" && ref.seriesId ? ref.seriesId : ref.remoteId);
    if (opts.sendInvites) {
      // /cancel tells attendees; it only works for meetings the person organised.
      const cancelled = await this.call(`/me/events/${id}/cancel`, { method: "POST", body: JSON.stringify({ comment: "" }) }).then(() => true, () => false);
      if (cancelled) return;
    }
    try {
      await this.call(`/me/events/${id}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof ProviderError && e.httpStatus === 404)) throw e;
    }
  }

  async freeBusy(cals: CalendarRef[], window: Interval): Promise<Interval[]> {
    if (!cals.length) return [];
    if (this.address) {
      const r = await this.call<{ value?: { scheduleItems?: { status?: string; start: MTime; end: MTime }[] }[] }>("/me/calendar/getSchedule", {
        method: "POST",
        body: JSON.stringify({ schedules: [this.address], startTime: graphTime(new Date(window.start)), endTime: graphTime(new Date(window.end)), availabilityViewInterval: 30 }),
      }).catch(() => null);
      if (r?.value) return r.value.flatMap((s) => (s.scheduleItems ?? []).filter((i) => i.status !== "free" && i.status !== "workingElsewhere").map((i) => ({ start: utc(i.start).getTime(), end: utc(i.end).getTime() })));
    }
    // Fallback: the calendars' own views.
    const out: Interval[] = [];
    for (const c of cals) {
      const page = await this.listEvents(c, window, null);
      for (const e of page.upserts) if (e.busy && !e.allDay && e.status !== "cancelled") out.push({ start: e.start.getTime(), end: e.end.getTime() });
    }
    return out;
  }

  async watch(cal: CalendarRef, address: string, token: string): Promise<PushChannel> {
    const r = await this.call<{ id: string; expirationDateTime: string }>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: address, resource: `me/calendars/${cal.remoteId}/events`, expirationDateTime: new Date(Date.now() + 4000 * 60_000).toISOString(), clientState: token }),
    });
    return { id: r.id, resourceId: cal.remoteId, expiresAt: r.expirationDateTime };
  }

  async renew(channel: PushChannel): Promise<PushChannel> {
    const r = await this.call<{ id: string; expirationDateTime: string }>(`/subscriptions/${encodeURIComponent(channel.id)}`, {
      method: "PATCH", body: JSON.stringify({ expirationDateTime: new Date(Date.now() + 4000 * 60_000).toISOString() }),
    });
    return { ...channel, expiresAt: r.expirationDateTime };
  }

  async unwatch(channel: PushChannel): Promise<void> {
    await this.call(`/subscriptions/${encodeURIComponent(channel.id)}`, { method: "DELETE" }).catch(() => undefined);
  }
}
