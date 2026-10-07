/**
 * Google Calendar over the Calendar API v3. Server only.
 *
 * OAuth is the same flow as the Gmail connector (src/lib/crm/gmail.ts): offline access for a refresh
 * token, a state nonce in an httpOnly cookie, tokens encrypted at rest. It uses its own client when
 * GOOGLE_CALENDAR_CLIENT_ID is set and otherwise reuses the Gmail client (GOOGLE_CLIENT_ID), asking
 * only for calendar scopes; that client then also needs the Calendar API enabled and this app's
 * calendar callback URL added to its redirect URIs.
 *
 * Scopes: `calendar.readonly` (calendar list and free/busy) and `calendar.events` (read and write
 * events). Both are Google "sensitive" scopes, not "restricted" like Gmail's, so verification is the
 * lighter review.
 *
 * Sync: events are read with singleEvents=true, so Google expands series into instances, then
 * incrementally with the nextSyncToken. A 410 means the token expired and the window is read afresh.
 * Push: events.watch channels post to /api/calendar/webhooks/google; they last up to 7 days and are
 * renewed by the sync cron.
 */
import { randomUUID } from "node:crypto";
import { emailFromIdToken, jsonCall, ProviderError, tokenRequest, type CalendarProvider, type CalendarRef, type Fetch, type ProviderPatch, type PushCapable, type PushChannel } from "../provider";
import type { Attendee, EventDraft, EventRef, Interval, RemoteCalendar, RemoteEvent, SyncPage, WriteOptions } from "../types";
import { findVideoLink } from "../video";
import { describeWithLink } from "../ical-write";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
];

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const LABEL = "Google Calendar";

export type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** The client to use, or null when neither a calendar nor a Gmail OAuth client is configured. */
export function googleCalendarConfig(origin: string): OAuthConfig | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_ID ? process.env.GOOGLE_CALENDAR_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${origin}/api/calendar/oauth/google/callback` };
}

export function googleAuthUrl(cfg: OAuthConfig, state: string, loginHint?: string): string {
  const u = new URL(AUTH);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

export const googleExchange = (f: Fetch, cfg: OAuthConfig, code: string) =>
  tokenRequest(f, "Google", TOKEN, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" });

export const googleRefresh = (f: Fetch, cfg: OAuthConfig, refreshToken: string) =>
  tokenRequest(f, "Google", TOKEN, { refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" });

/** The signed-in address: from the id_token, else the primary calendar's id (which is the address). */
export async function googleAddress(f: Fetch, accessToken: string, idToken?: string): Promise<string> {
  const fromToken = emailFromIdToken(idToken);
  if (fromToken) return fromToken;
  const p = await jsonCall<{ id: string }>(f, LABEL, `${API}/calendars/primary`, { headers: { authorization: `Bearer ${accessToken}` } });
  return p.id.toLowerCase();
}

/* ---------------- Google's shapes ---------------- */

type GTime = { dateTime?: string; date?: string; timeZone?: string };
type GPerson = { email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean; optional?: boolean; resource?: boolean };
export type GEvent = {
  id: string; status?: string; htmlLink?: string; summary?: string; description?: string; location?: string; etag?: string;
  start?: GTime; end?: GTime; attendees?: GPerson[]; organizer?: GPerson; transparency?: string; iCalUID?: string;
  recurringEventId?: string; originalStartTime?: GTime; hangoutLink?: string; eventType?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};
type GList = { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };

const dateOnly = (d: string) => new Date(`${d}T00:00:00Z`);

function gPerson(p: GPerson, organizer = false): Attendee {
  return {
    email: (p.email ?? "").toLowerCase(), name: p.displayName ?? "", response: p.responseStatus ?? (organizer ? "accepted" : "unknown"),
    ...(p.optional ? { optional: true } : {}), ...(p.organizer || organizer ? { organizer: true } : {}), ...(p.self ? { self: true } : {}),
  };
}

/** One Google event in YouBank's shape. */
export function fromGoogle(e: GEvent, calTz: string): RemoteEvent {
  const allDay = !!e.start?.date;
  const start = allDay ? dateOnly(e.start!.date!) : new Date(e.start?.dateTime ?? 0);
  const end = allDay ? dateOnly(e.end?.date ?? e.start!.date!) : new Date(e.end?.dateTime ?? e.start?.dateTime ?? 0);
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? e.hangoutLink ?? "";
  const rid = e.originalStartTime ? (e.originalStartTime.date ?? new Date(e.originalStartTime.dateTime ?? 0).toISOString()) : null;
  return {
    remoteId: e.id, group: e.id, icalUid: e.iCalUID ?? e.id, recurrenceId: rid, seriesId: e.recurringEventId ?? null,
    title: e.summary ?? "(no title)", description: e.description ?? "", location: e.location ?? "",
    start, end, allDay, timezone: e.start?.timeZone ?? calTz,
    status: e.status === "cancelled" ? "cancelled" : e.status === "tentative" ? "tentative" : "confirmed",
    busy: e.transparency !== "transparent",
    organizer: e.organizer?.email ? gPerson(e.organizer, true) : null,
    attendees: (e.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => gPerson(a)),
    videoUrl: findVideoLink(video, e.location, e.description), htmlLink: e.htmlLink ?? "", etag: e.etag ?? "", href: "",
  };
}

const enc = encodeURIComponent;

function toGoogleTimes(d: { start: Date; end: Date; allDay?: boolean }, tz: string) {
  return d.allDay
    ? { start: { date: d.start.toISOString().slice(0, 10) }, end: { date: d.end.toISOString().slice(0, 10) } }
    : { start: { dateTime: d.start.toISOString(), timeZone: tz || "UTC" }, end: { dateTime: d.end.toISOString(), timeZone: tz || "UTC" } };
}

/* ---------------- The adapter ---------------- */

export class GoogleCalendar implements CalendarProvider, PushCapable {
  readonly id = "google" as const;
  readonly writable = true;
  constructor(private readonly token: () => Promise<string>, private readonly f: Fetch = fetch) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const t = await this.token();
    return jsonCall<T>(this.f, LABEL, path.startsWith("http") ? path : `${API}${path}`, {
      ...init, headers: { authorization: `Bearer ${t}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const out: RemoteCalendar[] = [];
    let page: string | undefined;
    do {
      const r = await this.call<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; timeZone?: string; accessRole?: string; primary?: boolean; deleted?: boolean }[]; nextPageToken?: string }>(
        `/users/me/calendarList?maxResults=250${page ? `&pageToken=${enc(page)}` : ""}`);
      for (const c of r.items ?? []) {
        if (c.deleted || c.accessRole === "freeBusyReader") continue;
        out.push({ remoteId: c.id, name: c.summaryOverride ?? c.summary ?? c.id, color: c.backgroundColor ?? "", timezone: c.timeZone ?? "", canWrite: c.accessRole === "owner" || c.accessRole === "writer", primary: !!c.primary });
      }
      page = r.nextPageToken;
    } while (page);
    return out;
  }

  async listEvents(cal: CalendarRef, window: Interval, syncToken: string | null): Promise<SyncPage> {
    const upserts: RemoteEvent[] = [], removed: string[] = [];
    let page: string | undefined, next: string | null = null;
    do {
      const q = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
      if (syncToken) q.set("syncToken", syncToken);
      else { q.set("timeMin", new Date(window.start).toISOString()); q.set("timeMax", new Date(window.end).toISOString()); }
      if (page) q.set("pageToken", page);
      let r: GList;
      try {
        r = await this.call<GList>(`/calendars/${enc(cal.remoteId)}/events?${q}`);
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 410) throw new ProviderError("The sync token expired", "gone", 410);
        throw e;
      }
      for (const item of r.items ?? []) {
        // Working-location markers are not meetings.
        if (item.eventType === "workingLocation" || item.eventType === "birthday") continue;
        if (item.status === "cancelled") removed.push(item.id);
        else upserts.push(fromGoogle(item, cal.timezone));
      }
      page = r.nextPageToken;
      if (r.nextSyncToken) next = r.nextSyncToken;
    } while (page);
    return { upserts, removed, replacedGroups: [], full: !syncToken, nextToken: next };
  }

  async createEvent(cal: CalendarRef, d: EventDraft, opts: WriteOptions): Promise<RemoteEvent> {
    const body: Record<string, unknown> = {
      summary: d.title, description: describeWithLink(d.description, d.videoUrl), location: d.location || d.videoUrl || undefined,
      ...toGoogleTimes(d, d.timezone || cal.timezone),
      attendees: d.attendees.map((a) => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) })),
      ...(d.addConference && !d.videoUrl ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    };
    const e = await this.call<GEvent>(`/calendars/${enc(cal.remoteId)}/events?sendUpdates=${opts.sendInvites ? "all" : "none"}&conferenceDataVersion=1`, { method: "POST", body: JSON.stringify(body) });
    return fromGoogle(e, cal.timezone);
  }

  async updateEvent(cal: CalendarRef, ref: EventRef, p: ProviderPatch, opts: WriteOptions & { scope: "instance" | "series" }): Promise<RemoteEvent> {
    const series = opts.scope === "series" && ref.seriesId;
    const id = series ? ref.seriesId! : ref.remoteId;
    const body: Record<string, unknown> = {};
    if (p.title !== undefined) body.summary = p.title;
    if (p.description !== undefined || p.videoUrl !== undefined) body.description = describeWithLink(p.description, p.videoUrl);
    if (p.location !== undefined) body.location = p.location;
    if (p.attendees) body.attendees = p.attendees.map((a) => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) }));
    if (series && p.shiftMs) {
      // Moving a series: shift the master's own start and end, keeping its zone so DST still applies.
      const m = await this.call<GEvent>(`/calendars/${enc(cal.remoteId)}/events/${enc(id)}`);
      const shift = (t?: GTime) => (t?.dateTime ? { dateTime: new Date(Date.parse(t.dateTime) + p.shiftMs!).toISOString(), timeZone: t.timeZone ?? cal.timezone } : t);
      body.start = shift(m.start);
      body.end = shift(m.end);
    } else if (p.start && p.end) {
      Object.assign(body, toGoogleTimes({ start: p.start, end: p.end }, cal.timezone));
    }
    const e = await this.call<GEvent>(`/calendars/${enc(cal.remoteId)}/events/${enc(id)}?sendUpdates=${opts.sendInvites ? "all" : "none"}`, { method: "PATCH", body: JSON.stringify(body) });
    return fromGoogle(e, cal.timezone);
  }

  async deleteEvent(cal: CalendarRef, ref: EventRef, opts: WriteOptions & { scope: "instance" | "series" }): Promise<void> {
    const id = opts.scope === "series" && ref.seriesId ? ref.seriesId : ref.remoteId;
    try {
      await this.call(`/calendars/${enc(cal.remoteId)}/events/${enc(id)}?sendUpdates=${opts.sendInvites ? "all" : "none"}`, { method: "DELETE" });
    } catch (e) {
      // Already gone is what we wanted.
      if (!(e instanceof ProviderError && (e.httpStatus === 410 || e.httpStatus === 404))) throw e;
    }
  }

  async freeBusy(cals: CalendarRef[], window: Interval): Promise<Interval[]> {
    if (!cals.length) return [];
    const r = await this.call<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>("/freeBusy", {
      method: "POST", body: JSON.stringify({ timeMin: new Date(window.start).toISOString(), timeMax: new Date(window.end).toISOString(), items: cals.map((c) => ({ id: c.remoteId })) }),
    });
    return Object.values(r.calendars ?? {}).flatMap((c) => (c.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })));
  }

  async watch(cal: CalendarRef, address: string, token: string): Promise<PushChannel> {
    const id = randomUUID();
    const r = await this.call<{ id: string; resourceId: string; expiration?: string }>(`/calendars/${enc(cal.remoteId)}/events/watch`, {
      method: "POST", body: JSON.stringify({ id, type: "web_hook", address, token, params: { ttl: String(7 * 24 * 3600) } }),
    });
    return { id: r.id, resourceId: r.resourceId, expiresAt: new Date(Number(r.expiration ?? Date.now() + 6 * 86_400_000)).toISOString() };
  }

  async unwatch(channel: PushChannel): Promise<void> {
    await this.call("/channels/stop", { method: "POST", body: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }) }).catch(() => undefined);
  }
}
