/**
 * The shapes every calendar provider is translated into. Pure types, safe to import anywhere.
 *
 * One vocabulary for four very different sources (Google's JSON, Microsoft Graph's JSON, CalDAV's
 * iCalendar over WebDAV, and a bare .ics feed) is what lets the rest of YouBank (the calendar view,
 * linking to Relationships, meeting briefs, scheduling, the meeting copilot) ignore where an event
 * came from.
 */

export type ProviderId = "google" | "microsoft" | "caldav" | "ics";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: "Google Calendar",
  microsoft: "Microsoft 365 / Outlook",
  caldav: "iCloud / CalDAV",
  ics: "Subscription (ICS link)",
};

/** A person on an event. `self` marks the calendar owner when the provider says so. */
export type Attendee = {
  email: string;
  name: string;
  /** accepted | declined | tentative | needsAction | unknown */
  response: string;
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
};

export type EventStatus = "confirmed" | "tentative" | "cancelled";

/** A half-open interval in epoch milliseconds: [start, end). */
export type Interval = { start: number; end: number };

/** A calendar as the provider lists it. */
export type RemoteCalendar = {
  remoteId: string;
  name: string;
  color: string;
  timezone: string;
  canWrite: boolean;
  primary: boolean;
};

/**
 * One occurrence of an event, already expanded: recurring series arrive as their instances in the
 * sync window, so everything downstream deals in plain intervals.
 */
export type RemoteEvent = {
  /** Unique within its calendar and stable across syncs (a provider id, or href#recurrence for CalDAV). */
  remoteId: string;
  /**
   * The unit the provider changes as a whole. For CalDAV and ICS that is the resource (all instances
   * of a series live in one .ics), so a change replaces every row in the group. Elsewhere it is the
   * remoteId itself.
   */
  group: string;
  icalUid: string;
  /** For an instance of a series: its original start (ISO), as RECURRENCE-ID names it. */
  recurrenceId: string | null;
  /** The provider's id for the series this instance belongs to, if any. */
  seriesId: string | null;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  timezone: string;
  status: EventStatus;
  /** False for events marked "free" (TRANSP:TRANSPARENT, showAs free). */
  busy: boolean;
  organizer: Attendee | null;
  attendees: Attendee[];
  videoUrl: string;
  htmlLink: string;
  etag: string;
  /** CalDAV: the resource URL to PUT/DELETE. */
  href: string;
};

/** What a sync call returns. */
export type SyncPage = {
  upserts: RemoteEvent[];
  /** Rows to delete by remoteId (a cancelled Google instance, a Graph @removed). */
  removed: string[];
  /** Groups whose rows are all replaced by the upserts that carry the same group (CalDAV, ICS). */
  replacedGroups: string[];
  /** True when this was a full read of the window, so anything not returned is gone. */
  full: boolean;
  /** Token for the next incremental read, or null where the provider has none. */
  nextToken: string | null;
};

/** What YouBank asks a provider to create, or to change. */
export type EventDraft = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  timezone: string;
  attendees: { email: string; name?: string }[];
  /** A link the person pasted (Zoom, Meet, Teams...). Written to the location and description. */
  videoUrl?: string;
  /** Ask the provider to create its own meeting link (Google Meet, Teams). */
  addConference?: boolean;
};

/** Which stored event a change applies to. */
export type EventRef = {
  remoteId: string;
  icalUid: string;
  recurrenceId: string | null;
  seriesId: string | null;
  etag: string;
  href: string;
};

/** `instance` changes one occurrence of a series; `series` changes them all. */
export type ChangeScope = "instance" | "series";

export type WriteOptions = { sendInvites: boolean; scope?: ChangeScope; organizerEmail?: string };

/** The sync window: 30 days back, 90 ahead. */
export const WINDOW_PAST_DAYS = 30;
export const WINDOW_FUTURE_DAYS = 90;
export const DAY_MS = 86_400_000;

export function syncWindow(now = Date.now()): Interval {
  return { start: now - WINDOW_PAST_DAYS * DAY_MS, end: now + WINDOW_FUTURE_DAYS * DAY_MS };
}

/** Working hours for scheduling, in the person's own time zone. Days are 0 (Sunday) to 6. */
export type WorkHours = { start: string; end: string; days: number[] };

export const DEFAULT_WORK_HOURS: WorkHours = { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
