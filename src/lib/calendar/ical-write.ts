/**
 * Writing meetings as iCalendar, and editing an existing resource in place. Pure.
 *
 * New events are written with UTC times. That needs no VTIMEZONE block (which every TZID would
 * otherwise require), every client reads it, and a one-off meeting has no daylight-saving question to
 * answer. Edits keep whatever the resource already used: rescheduling one occurrence of a series in
 * Berlin time adds an override whose RECURRENCE-ID is written exactly as the series' DTSTART is, or
 * servers would not match it to the occurrence it replaces.
 */
import { randomUUID } from "node:crypto";
import { childrenOf, cloneComponent, escapeText, formatDate, formatDateTime, formatDateValue, parseDateValue, propOf, setProp, type ICalComponent, type ICalProp } from "./ical";
import { canonicalZoneName, ianaZone, utcToWall, UTC_ZONE } from "./tz";
import type { EventDraft } from "./types";

export const PRODID = "-//YouBank//Calendar 1.0//EN";

const utcStamp = (ms: number) => formatDateTime(ms, true);

function attendeeProp(a: { email: string; name?: string }, organizer = false): ICalProp {
  const params: Record<string, string> = {};
  if (a.name) params.CN = a.name.replace(/"/g, "'");
  if (!organizer) Object.assign(params, { ROLE: "REQ-PARTICIPANT", PARTSTAT: "NEEDS-ACTION", RSVP: "TRUE" });
  return { name: organizer ? "ORGANIZER" : "ATTENDEE", params, value: `mailto:${a.email.trim().toLowerCase()}` };
}

/** The description with the video link on its own line, so every client shows it. */
export function describeWithLink(description: string | undefined, videoUrl: string | undefined): string {
  const d = (description ?? "").trim();
  if (!videoUrl || d.includes(videoUrl)) return d;
  return [d, `Join: ${videoUrl}`].filter(Boolean).join("\n\n");
}

/**
 * Write DTSTART and DTEND. An event that already names a zone keeps it, so a series edited in
 * Berlin time still follows Berlin's clock changes; anything else is written in UTC.
 */
function setTimes(ev: ICalComponent, draft: Pick<EventDraft, "start" | "end" | "allDay">) {
  if (draft.allDay) {
    setProp(ev, "DTSTART", formatDate(draft.start.getTime()), { VALUE: "DATE" });
    setProp(ev, "DTEND", formatDate(draft.end.getTime()), { VALUE: "DATE" });
  } else {
    const tzid = propOf(ev, "DTSTART")?.params.TZID;
    const zone = tzid ? ianaZone(canonicalZoneName(tzid) ?? "") : null;
    if (tzid && zone) {
      setProp(ev, "DTSTART", formatDateTime(utcToWall(zone, draft.start.getTime()), false), { TZID: tzid });
      setProp(ev, "DTEND", formatDateTime(utcToWall(zone, draft.end.getTime()), false), { TZID: tzid });
    } else {
      setProp(ev, "DTSTART", utcStamp(draft.start.getTime()));
      setProp(ev, "DTEND", utcStamp(draft.end.getTime()));
    }
  }
  setProp(ev, "DURATION", null);
}

/** A new VCALENDAR holding one meeting. `method` is set for iMIP (emailed) invitations only. */
export function buildEventCalendar(draft: EventDraft, opts: { uid?: string; organizer?: { email: string; name?: string } | null; now?: number; method?: "REQUEST" | "CANCEL" } = {}): { uid: string; calendar: ICalComponent } {
  const uid = opts.uid ?? `${randomUUID()}@youbank`;
  const now = opts.now ?? Date.now();
  const ev: ICalComponent = { name: "VEVENT", props: [], components: [] };
  setProp(ev, "UID", uid);
  setProp(ev, "DTSTAMP", utcStamp(now));
  setProp(ev, "CREATED", utcStamp(now));
  setProp(ev, "LAST-MODIFIED", utcStamp(now));
  setTimes(ev, draft);
  setProp(ev, "SUMMARY", escapeText(draft.title.trim() || "Meeting"));
  const description = describeWithLink(draft.description, draft.videoUrl);
  if (description) setProp(ev, "DESCRIPTION", escapeText(description));
  const location = draft.location?.trim() || draft.videoUrl || "";
  if (location) setProp(ev, "LOCATION", escapeText(location));
  if (draft.videoUrl) setProp(ev, "URL", draft.videoUrl);
  setProp(ev, "SEQUENCE", "0");
  setProp(ev, "STATUS", opts.method === "CANCEL" ? "CANCELLED" : "CONFIRMED");
  setProp(ev, "TRANSP", "OPAQUE");
  if (opts.organizer && draft.attendees.length) ev.props.push(attendeeProp(opts.organizer, true));
  for (const a of draft.attendees) ev.props.push(attendeeProp(a));
  const cal: ICalComponent = {
    name: "VCALENDAR",
    props: [{ name: "VERSION", params: {}, value: "2.0" }, { name: "PRODID", params: {}, value: PRODID }, { name: "CALSCALE", params: {}, value: "GREGORIAN" }, ...(opts.method ? [{ name: "METHOD", params: {}, value: opts.method }] : [])],
    components: [ev],
  };
  return { uid, calendar: cal };
}

const bumpSequence = (ev: ICalComponent) => setProp(ev, "SEQUENCE", String((Number(propOf(ev, "SEQUENCE")?.value ?? 0) || 0) + 1));

export type EventPatch = Partial<Pick<EventDraft, "title" | "description" | "location" | "start" | "end" | "allDay" | "attendees" | "videoUrl">>;

/** Apply a change to one VEVENT, in place. */
export function patchVEvent(ev: ICalComponent, patch: EventPatch, now = Date.now()): void {
  if (patch.start && patch.end) setTimes(ev, { start: patch.start, end: patch.end, allDay: patch.allDay });
  if (patch.title !== undefined) setProp(ev, "SUMMARY", escapeText(patch.title));
  if (patch.description !== undefined || patch.videoUrl !== undefined) {
    const d = describeWithLink(patch.description ?? "", patch.videoUrl);
    setProp(ev, "DESCRIPTION", d ? escapeText(d) : null);
  }
  if (patch.location !== undefined) setProp(ev, "LOCATION", patch.location ? escapeText(patch.location) : null);
  if (patch.attendees) {
    const keep = new Map(ev.props.filter((p) => p.name === "ATTENDEE").map((p) => [p.value.replace(/^mailto:/i, "").toLowerCase(), p]));
    ev.props = ev.props.filter((p) => p.name !== "ATTENDEE");
    for (const a of patch.attendees) ev.props.push(keep.get(a.email.toLowerCase()) ?? attendeeProp(a));
  }
  setProp(ev, "DTSTAMP", utcStamp(now));
  setProp(ev, "LAST-MODIFIED", utcStamp(now));
  bumpSequence(ev);
}

const masterOf = (cal: ICalComponent, uid: string) => childrenOf(cal, "VEVENT").find((e) => propOf(e, "UID")?.value.trim() === uid && !propOf(e, "RECURRENCE-ID"));

/**
 * The RECURRENCE-ID for an occurrence, written the way the master's DTSTART is: same zone, same
 * date-or-time form. `recurrenceId` is the stored ISO instant, or YYYY-MM-DD for all-day.
 */
export function recurrenceIdProp(master: ICalComponent, recurrenceId: string): { value: string; params: Record<string, string> } {
  const sp = propOf(master, "DTSTART")!;
  const dv = parseDateValue(sp.value, sp.params)!;
  if (dv.date) return formatDateValue({ wall: Date.parse(`${recurrenceId.slice(0, 10)}T00:00:00Z`), date: true, utc: false, tzid: null });
  const t = Date.parse(recurrenceId);
  if (dv.utc || !dv.tzid) return formatDateValue({ wall: t, date: false, utc: true, tzid: null });
  const zone = ianaZone(canonicalZoneName(dv.tzid) ?? "") ?? UTC_ZONE;
  if (zone === UTC_ZONE) return formatDateValue({ wall: t, date: false, utc: true, tzid: null });
  return formatDateValue({ wall: utcToWall(zone, t), date: false, utc: false, tzid: dv.tzid });
}

const sameRid = (e: ICalComponent, rid: { value: string }) => propOf(e, "RECURRENCE-ID")?.value === rid.value;

/** Cancel one occurrence of a series: an EXDATE on the master, and any override for it removed. */
export function cancelOccurrence(cal: ICalComponent, uid: string, recurrenceId: string, now = Date.now()): boolean {
  const master = masterOf(cal, uid);
  if (!master) return false;
  const rid = recurrenceIdProp(master, recurrenceId);
  master.props.push({ name: "EXDATE", params: rid.params, value: rid.value });
  cal.components = cal.components.filter((e) => !(e.name === "VEVENT" && propOf(e, "UID")?.value.trim() === uid && sameRid(e, rid)));
  setProp(master, "DTSTAMP", utcStamp(now));
  bumpSequence(master);
  return true;
}

/** Change one occurrence of a series: add (or update) its override VEVENT. */
export function overrideOccurrence(cal: ICalComponent, uid: string, recurrenceId: string, patch: EventPatch, now = Date.now()): boolean {
  const master = masterOf(cal, uid);
  if (!master) return false;
  const rid = recurrenceIdProp(master, recurrenceId);
  let ov = childrenOf(cal, "VEVENT").find((e) => propOf(e, "UID")?.value.trim() === uid && sameRid(e, rid));
  if (!ov) {
    ov = cloneComponent(master);
    ov.props = ov.props.filter((p) => !["RRULE", "RDATE", "EXDATE", "EXRULE"].includes(p.name));
    setProp(ov, "RECURRENCE-ID", rid.value, rid.params);
    cal.components.push(ov);
  }
  patchVEvent(ov, patch, now);
  return true;
}

/** Change a one-off event, or a whole series (times move by the same amount for every occurrence). */
export function patchEvent(cal: ICalComponent, uid: string, patch: EventPatch, now = Date.now()): boolean {
  const ev = masterOf(cal, uid) ?? childrenOf(cal, "VEVENT").find((e) => propOf(e, "UID")?.value.trim() === uid);
  if (!ev) return false;
  patchVEvent(ev, patch, now);
  return true;
}
