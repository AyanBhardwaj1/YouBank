/**
 * Any ICS subscription link: read only. Server only.
 *
 * Holiday calendars, a team's published calendar, Outlook's "publish calendar" links, TripIt,
 * sports fixtures. webcal:// is https://. The feed is fetched whole each time (they have no
 * incremental protocol), but conditionally: the ETag or Last-Modified from the last read goes back as
 * If-None-Match / If-Modified-Since, so an unchanged feed costs one 304. Feeds over 5 MB are refused.
 */
import { expandCalendar } from "../expand";
import { ProviderError, readOnlyError, type CalendarProvider, type CalendarRef, type Fetch } from "../provider";
import type { Interval, RemoteCalendar, RemoteEvent, SyncPage } from "../types";
import { parseCalendar, propOf } from "../ical";

const MAX_BYTES = 5 * 1024 * 1024;

/** webcal:// and webcals:// are https:// in practice. */
export function normalizeFeedUrl(raw: string): string {
  return raw.trim().replace(/^webcals?:\/\//i, "https://");
}

export class IcsCalendar implements CalendarProvider {
  readonly id = "ics" as const;
  readonly writable = false;
  constructor(private readonly url: string, private readonly f: Fetch = fetch) {}

  private async fetchFeed(validator: string | null): Promise<{ text: string | null; validator: string }> {
    const headers: Record<string, string> = { accept: "text/calendar, */*;q=0.5", "user-agent": "YouBank-Calendar/1.0" };
    if (validator?.startsWith("etag:")) headers["if-none-match"] = validator.slice(5);
    else if (validator?.startsWith("lm:")) headers["if-modified-since"] = validator.slice(3);
    const res = await this.f(normalizeFeedUrl(this.url), { headers, signal: AbortSignal.timeout(30_000) });
    if (res.status === 304) return { text: null, validator: validator ?? "" };
    if (!res.ok) throw new ProviderError(`The calendar link answered ${res.status}.`, res.status === 401 || res.status === 403 ? "auth" : res.status === 404 ? "notfound" : "other", res.status);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new ProviderError("That calendar feed is larger than 5 MB.", "other");
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ProviderError("That calendar feed is larger than 5 MB.", "other");
    const etag = res.headers.get("etag"), lm = res.headers.get("last-modified");
    return { text, validator: etag ? `etag:${etag}` : lm ? `lm:${lm}` : "" };
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const { text } = await this.fetchFeed(null);
    let name = "";
    let tz = "";
    try {
      const cal = parseCalendar(text ?? "");
      name = propOf(cal, "X-WR-CALNAME")?.value ?? "";
      tz = propOf(cal, "X-WR-TIMEZONE")?.value ?? "";
    } catch {
      throw new ProviderError("That link did not return a calendar (.ics) file.", "other");
    }
    return [{ remoteId: normalizeFeedUrl(this.url), name: name || new URL(normalizeFeedUrl(this.url)).hostname, color: "", timezone: tz, canWrite: false, primary: true }];
  }

  async listEvents(cal: CalendarRef, window: Interval, syncToken: string | null): Promise<SyncPage> {
    const { text, validator } = await this.fetchFeed(syncToken);
    if (text === null) return { upserts: [], removed: [], replacedGroups: [], full: false, nextToken: validator || syncToken };
    const instances = expandCalendar(text, window, { defaultTz: cal.timezone });
    const upserts: RemoteEvent[] = instances.map((i) => ({
      remoteId: `${i.uid}${i.recurrenceId ? `#${i.recurrenceId}` : ""}`, group: i.uid, icalUid: i.uid, recurrenceId: i.recurrenceId, seriesId: null,
      title: i.summary || "(no title)", description: i.description, location: i.location, start: new Date(i.start), end: new Date(i.end), allDay: i.allDay,
      timezone: i.timezone, status: i.status, busy: i.busy, organizer: i.organizer, attendees: i.attendees, videoUrl: i.videoUrl, htmlLink: i.url, etag: "", href: "",
    }));
    // A feed is always whole: what is not in it is gone.
    return { upserts, removed: [], replacedGroups: [], full: true, nextToken: validator || null };
  }

  async createEvent(): Promise<RemoteEvent> { throw readOnlyError(); }
  async updateEvent(): Promise<RemoteEvent | null> { throw readOnlyError(); }
  async deleteEvent(): Promise<void> { throw readOnlyError(); }

  async freeBusy(cals: CalendarRef[], window: Interval): Promise<Interval[]> {
    const out: Interval[] = [];
    for (const c of cals) {
      const page = await this.listEvents(c, window, null);
      for (const e of page.upserts) if (e.busy && !e.allDay && e.status !== "cancelled") out.push({ start: e.start.getTime(), end: e.end.getTime() });
    }
    return out;
  }
}
