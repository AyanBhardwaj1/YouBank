/**
 * iCloud and any CalDAV server (Fastmail, Nextcloud, Yahoo, Zoho, Radicale, Baïkal) over WebDAV.
 * Server only.
 *
 * Sign-in is an app-specific password (iCloud, Yahoo and Fastmail all require one; it can be revoked
 * on its own, without changing the account password). It is encrypted at rest like a mailbox
 * password and never shown again.
 *
 * Protocol, in the order a connection uses it:
 * 1. Discovery (RFC 6764 and 4791): PROPFIND current-user-principal on the server (or its
 *    /.well-known/caldav), then calendar-home-set on the principal, then the home's children, keeping
 *    collections that are calendars and hold VEVENTs.
 * 2. Reading: a calendar-query REPORT with a time-range filter returns every resource with an event
 *    in the window (the server evaluates recurrence for the filter); YouBank expands the series itself
 *    (expand.ts), because servers differ on <expand>.
 * 3. Changes: sync-collection (RFC 6578) with the collection's sync-token lists changed and deleted
 *    resources, which are re-read with calendar-multiget. Servers without sync-tokens are read in full.
 * 4. Writing: PUT a whole .ics resource, with If-None-Match: * to create and If-Match: <etag> to change,
 *    so an edit made elsewhere in the meantime is refused rather than overwritten. One occurrence of a
 *    series is changed with an override or cancelled with an EXDATE inside the same resource.
 * 5. Invitations: servers with scheduling (iCloud, Fastmail, Nextcloud) send them for any event with an
 *    ORGANIZER and ATTENDEEs (RFC 6638 implicit scheduling). When the person chooses not to notify,
 *    attendees are written with SCHEDULE-AGENT=CLIENT, which tells the server to stay quiet.
 */
import { XMLParser } from "fast-xml-parser";
import { expandCalendar, type Instance } from "../expand";
import { formatDateTime, parseCalendar, propOf, serializeICal, setProp, type ICalComponent } from "../ical";
import { buildEventCalendar, cancelOccurrence, overrideOccurrence, patchEvent } from "../ical-write";
import { ProviderError, kindForStatus, type CalendarProvider, type CalendarRef, type Fetch, type ProviderPatch } from "../provider";
import type { EventDraft, EventRef, Interval, RemoteCalendar, RemoteEvent, SyncPage, WriteOptions } from "../types";

/** Servers people pick from a list; "custom" takes a URL. */
export const CALDAV_PRESETS: Record<string, { label: string; url: string; appPasswordUrl: string; note: string }> = {
  icloud: { label: "iCloud", url: "https://caldav.icloud.com/", appPasswordUrl: "https://account.apple.com/account/manage", note: "Sign in with your Apple ID email and an app-specific password (Sign-In and Security, App-Specific Passwords)." },
  fastmail: { label: "Fastmail", url: "https://caldav.fastmail.com/dav/", appPasswordUrl: "https://app.fastmail.com/settings/security/apps", note: "Create an app password with CalDAV access." },
  yahoo: { label: "Yahoo", url: "https://caldav.calendar.yahoo.com/", appPasswordUrl: "https://login.yahoo.com/account/security", note: "Generate an app password under Account Security." },
  nextcloud: { label: "Nextcloud", url: "", appPasswordUrl: "", note: "Use https://<your-server>/remote.php/dav and an app password from Settings, Security." },
  zoho: { label: "Zoho", url: "https://calendar.zoho.com/caldav/", appPasswordUrl: "https://accounts.zoho.com/home#security/app_password", note: "Generate an application-specific password." },
};

export type CalDavConfig = { serverUrl: string; username: string; password: string; email?: string; homeUrl?: string };

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"';

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true, htmlEntities: true,
  isArray: (name) => ["response", "propstat", "comp", "href"].includes(name),
});

type Prop = Record<string, unknown>;
type DavResponse = { href: string; status: string; props: Prop };

const textOf = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"]);
  return "";
};

/** A 207 multistatus as plain responses, each with the props of its 200 propstat. */
export function parseMultistatus(xml: string, base: string): { responses: DavResponse[]; syncToken: string } {
  const doc = parser.parse(xml) as { multistatus?: { response?: unknown[]; "sync-token"?: unknown } };
  const ms = doc.multistatus ?? {};
  const responses: DavResponse[] = [];
  for (const r of (ms.response ?? []) as Record<string, unknown>[]) {
    const href = textOf(r.href);
    if (!href) continue;
    let props: Prop = {};
    for (const ps of (r.propstat ?? []) as Record<string, unknown>[]) {
      if (/\s200\s/.test(` ${textOf(ps.status)} `) || /200/.test(textOf(ps.status))) props = { ...props, ...((ps.prop ?? {}) as Prop) };
    }
    responses.push({ href: new URL(href, base).toString(), status: textOf(r.status), props });
  }
  return { responses, syncToken: textOf(ms["sync-token"]) };
}

const hrefIn = (v: unknown, base: string): string => {
  const h = textOf((v as { href?: unknown } | undefined)?.href);
  return h ? new URL(h, base).toString() : "";
};

/** The safe file name for a new resource: the UID without characters servers trip on. */
const resourceName = (uid: string) => `${uid.replace(/[^A-Za-z0-9._-]/g, "_")}.ics`;

export class CalDavCalendar implements CalendarProvider {
  readonly id = "caldav" as const;
  readonly writable = true;
  private readonly auth: string;
  constructor(private readonly cfg: CalDavConfig, private readonly f: Fetch = fetch) {
    this.auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`, "utf8").toString("base64")}`;
  }

  private async dav(method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
    const res = await this.f(url, {
      method, body, signal: AbortSignal.timeout(30_000),
      headers: { authorization: this.auth, ...(body ? { "content-type": method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}), ...headers },
    });
    if (res.status === 401 || (res.status === 403 && method === "PROPFIND")) throw new ProviderError("The server did not accept that user name and app password.", "auth", res.status);
    return res;
  }

  private async multistatus(method: string, url: string, body: string, depth: "0" | "1"): Promise<{ responses: DavResponse[]; syncToken: string }> {
    const res = await this.dav(method, url, body, { depth });
    if (res.status !== 207) {
      const kind = kindForStatus(res.status);
      // An expired or unknown sync-token is reported as 403/409 with valid-sync-token, or 410.
      const text = await res.text().catch(() => "");
      if (/valid-sync-token/.test(text) || res.status === 410) throw new ProviderError("The sync token expired", "gone", res.status);
      throw new ProviderError(`The calendar server answered ${res.status} to ${method}.`, kind, res.status);
    }
    return parseMultistatus(await res.text(), url);
  }

  /** Server → principal → calendar home. Cached in the account settings after the first connect. */
  async discoverHome(): Promise<{ homeUrl: string; email: string }> {
    if (this.cfg.homeUrl) return { homeUrl: this.cfg.homeUrl, email: this.cfg.email ?? "" };
    const propfind = (props: string) => `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;
    let principal = "";
    for (const url of [this.cfg.serverUrl, new URL("/.well-known/caldav", this.cfg.serverUrl).toString()]) {
      const r = await this.multistatus("PROPFIND", url, propfind("<d:current-user-principal/>"), "0").catch((e) => { if (e instanceof ProviderError && e.kind === "auth") throw e; return null; });
      principal = r?.responses.map((x) => hrefIn(x.props["current-user-principal"], url)).find(Boolean) ?? "";
      if (principal) break;
    }
    if (!principal) throw new ProviderError("That server did not answer like a CalDAV server. Check the server address.", "other");
    const p = await this.multistatus("PROPFIND", principal, propfind("<c:calendar-home-set/><c:calendar-user-address-set/>"), "0");
    const props = p.responses[0]?.props ?? {};
    const homeUrl = hrefIn(props["calendar-home-set"], principal);
    if (!homeUrl) throw new ProviderError("The server did not say where your calendars are.", "other");
    const addresses = ((props["calendar-user-address-set"] as { href?: unknown[] } | undefined)?.href ?? []).map(textOf);
    const email = addresses.map((a) => a.replace(/^mailto:/i, "").toLowerCase()).find((a) => a.includes("@")) ?? this.cfg.email ?? "";
    return { homeUrl, email };
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const { homeUrl } = await this.discoverHome();
    const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/><c:calendar-timezone/></d:prop></d:propfind>`;
    const r = await this.multistatus("PROPFIND", homeUrl, body, "1");
    const out: RemoteCalendar[] = [];
    for (const x of r.responses) {
      const type = (x.props.resourcetype ?? {}) as Record<string, unknown>;
      if (!("calendar" in type)) continue;
      const comps = ((x.props["supported-calendar-component-set"] as { comp?: { "@_name"?: string }[] } | undefined)?.comp ?? []).map((c) => c["@_name"]);
      if (comps.length && !comps.includes("VEVENT")) continue; // a reminders-only list
      const privs = JSON.stringify(x.props["current-user-privilege-set"] ?? "");
      const tzText = textOf(x.props["calendar-timezone"]);
      out.push({
        remoteId: x.href, name: textOf(x.props.displayname) || "Calendar", color: textOf(x.props["calendar-color"]).slice(0, 7),
        timezone: tzText.match(/TZID:([^\r\n]+)/)?.[1]?.trim() ?? "",
        // Without a privilege set, assume writable and let the server refuse.
        canWrite: privs === '""' || /write/.test(privs), primary: out.length === 0,
      });
    }
    return out;
  }

  private toRemote(href: string, etag: string, list: Instance[]): RemoteEvent[] {
    return list.map((i) => ({
      remoteId: `${i.uid}${i.recurrenceId ? `#${i.recurrenceId}` : ""}`, group: href, icalUid: i.uid, recurrenceId: i.recurrenceId, seriesId: i.recurrenceId ? i.uid : null,
      title: i.summary || "(no title)", description: i.description, location: i.location, start: new Date(i.start), end: new Date(i.end), allDay: i.allDay, timezone: i.timezone,
      status: i.status, busy: i.busy, organizer: i.organizer, attendees: i.attendees, videoUrl: i.videoUrl, htmlLink: "", etag, href,
    }));
  }

  private expand(href: string, etag: string, data: string, window: Interval, tz: string): RemoteEvent[] {
    try {
      return this.toRemote(href, etag, expandCalendar(data, window, { defaultTz: tz }));
    } catch {
      return []; // one unreadable resource must not stop the calendar
    }
  }

  async listEvents(cal: CalendarRef, window: Interval, syncToken: string | null): Promise<SyncPage> {
    if (syncToken) {
      const body = `<?xml version="1.0" encoding="utf-8"?><d:sync-collection ${NS}><d:sync-token>${syncToken.replace(/[<&]/g, "")}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
      const r = await this.multistatus("REPORT", cal.remoteId, body, "1");
      const changed: string[] = [], deleted: string[] = [];
      for (const x of r.responses) {
        if (x.href.replace(/\/$/, "") === cal.remoteId.replace(/\/$/, "")) continue;
        if (/404/.test(x.status)) deleted.push(x.href);
        else if (x.href.endsWith(".ics") || x.props.getetag) changed.push(x.href);
      }
      const upserts: RemoteEvent[] = [];
      for (let i = 0; i < changed.length; i += 50) {
        const hrefs = changed.slice(i, i + 50).map((h) => `<d:href>${new URL(h).pathname}</d:href>`).join("");
        const mg = await this.multistatus("REPORT", cal.remoteId, `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs}</c:calendar-multiget>`, "1");
        for (const x of mg.responses) upserts.push(...this.expand(x.href, textOf(x.props.getetag), textOf(x.props["calendar-data"]), window, cal.timezone));
      }
      return { upserts, removed: [], replacedGroups: [...changed, ...deleted], full: false, nextToken: r.syncToken || syncToken };
    }
    // Take the token first, so a change made during the read is picked up next time.
    const tokenRes = await this.multistatus("PROPFIND", cal.remoteId, `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:sync-token/></d:prop></d:propfind>`, "0").catch(() => null);
    const token = textOf(tokenRes?.responses[0]?.props["sync-token"]) || null;
    const range = `start="${formatDateTime(window.start, true)}" end="${formatDateTime(window.end, true)}"`;
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const r = await this.multistatus("REPORT", cal.remoteId, body, "1");
    const upserts = r.responses.flatMap((x) => this.expand(x.href, textOf(x.props.getetag), textOf(x.props["calendar-data"]), window, cal.timezone));
    return { upserts, removed: [], replacedGroups: [], full: true, nextToken: token };
  }

  /** One resource, with its etag. */
  private async getResource(href: string): Promise<{ cal: ICalComponent; etag: string }> {
    const res = await this.dav("GET", href);
    if (!res.ok) throw new ProviderError(res.status === 404 ? "That event is no longer on the server." : `The calendar server answered ${res.status}.`, kindForStatus(res.status), res.status);
    return { cal: parseCalendar(await res.text()), etag: res.headers.get("etag") ?? "" };
  }

  private async putResource(href: string, cal: ICalComponent, match: { etag?: string; create?: boolean }): Promise<string> {
    const headers: Record<string, string> = match.create ? { "if-none-match": "*" } : match.etag ? { "if-match": match.etag } : {};
    const res = await this.dav("PUT", href, serializeICal(cal), headers);
    if (res.status === 412) throw new ProviderError("This meeting was changed somewhere else in the meantime. Refresh and try again.", "conflict", 412);
    if (!res.ok) throw new ProviderError(`The calendar server refused the change (${res.status}).`, kindForStatus(res.status), res.status);
    return res.headers.get("etag") ?? "";
  }

  /** SCHEDULE-AGENT=CLIENT on every attendee: the server must not send invitations. */
  private quiet(cal: ICalComponent) {
    for (const ev of cal.components) for (const p of ev.props) if (p.name === "ATTENDEE" || p.name === "ORGANIZER") p.params["SCHEDULE-AGENT"] = "CLIENT";
  }

  async createEvent(cal: CalendarRef, d: EventDraft, opts: WriteOptions): Promise<RemoteEvent> {
    const email = opts.organizerEmail || this.cfg.email || "";
    const { uid, calendar } = buildEventCalendar(d, { organizer: email ? { email } : null });
    if (!opts.sendInvites) this.quiet(calendar);
    const href = new URL(resourceName(uid), cal.remoteId.endsWith("/") ? cal.remoteId : `${cal.remoteId}/`).toString();
    const etag = await this.putResource(href, calendar, { create: true });
    return this.expand(href, etag, serializeICal(calendar), { start: d.start.getTime() - 1, end: d.end.getTime() + 1 }, d.timezone)[0];
  }

  async updateEvent(cal: CalendarRef, ref: EventRef, p: ProviderPatch, opts: WriteOptions & { scope: "instance" | "series" }): Promise<RemoteEvent | null> {
    const { cal: ics, etag } = await this.getResource(ref.href);
    const patch = { title: p.title, description: p.description, location: p.location, attendees: p.attendees, videoUrl: p.videoUrl, start: p.start, end: p.end };
    if (opts.scope === "instance" && ref.recurrenceId) {
      overrideOccurrence(ics, ref.icalUid, ref.recurrenceId, patch);
    } else if (p.shiftMs) {
      const master = ics.components.find((c) => c.name === "VEVENT" && propOf(c, "UID")?.value.trim() === ref.icalUid && !propOf(c, "RECURRENCE-ID"));
      const inst = master ? expandCalendar({ ...ics, components: [...ics.components.filter((c) => c.name !== "VEVENT"), { ...master, props: master.props.filter((x) => !["RRULE", "RDATE", "EXDATE"].includes(x.name)) }] }, { start: 0, end: 8.64e15 })[0] : null;
      if (!inst) throw new ProviderError("Could not read the series to move it.", "other");
      patchEvent(ics, ref.icalUid, { ...patch, start: new Date(inst.start + p.shiftMs), end: new Date(inst.end + p.shiftMs) });
    } else {
      patchEvent(ics, ref.icalUid, patch);
    }
    if (!opts.sendInvites) this.quiet(ics);
    await this.putResource(ref.href, ics, { etag: ref.etag || etag });
    return null; // the sync that follows re-reads the resource with all its occurrences
  }

  async deleteEvent(_cal: CalendarRef, ref: EventRef, opts: WriteOptions & { scope: "instance" | "series" }): Promise<void> {
    if (opts.scope === "instance" && ref.recurrenceId) {
      const { cal: ics, etag } = await this.getResource(ref.href);
      cancelOccurrence(ics, ref.icalUid, ref.recurrenceId);
      if (!opts.sendInvites) this.quiet(ics);
      await this.putResource(ref.href, ics, { etag: ref.etag || etag });
      return;
    }
    if (opts.sendInvites) {
      // Implicit scheduling sends a CANCEL when the organiser's copy is deleted; mark it cancelled
      // first for servers that only notify on a change.
      const got = await this.getResource(ref.href).catch(() => null);
      if (got) {
        for (const ev of got.cal.components) if (ev.name === "VEVENT") setProp(ev, "STATUS", "CANCELLED");
        await this.putResource(ref.href, got.cal, { etag: got.etag }).catch(() => undefined);
      }
    }
    const res = await this.dav("DELETE", ref.href);
    if (!res.ok && res.status !== 404) throw new ProviderError(`The calendar server refused to delete it (${res.status}).`, kindForStatus(res.status), res.status);
  }

  async freeBusy(cals: CalendarRef[], window: Interval): Promise<Interval[]> {
    const out: Interval[] = [];
    for (const c of cals) {
      const page = await this.listEvents(c, window, null);
      for (const e of page.upserts) if (e.busy && !e.allDay && e.status !== "cancelled") out.push({ start: e.start.getTime(), end: e.end.getTime() });
    }
    return out;
  }
}
