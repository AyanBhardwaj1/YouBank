/**
 * From iCalendar text to the meetings in a window. Pure.
 *
 * Used for CalDAV servers (iCloud, Fastmail, Nextcloud, Yahoo) and ICS subscriptions, which hand over
 * raw iCalendar and leave recurrence to the client. Google and Microsoft expand series themselves.
 *
 * A series is a master VEVENT (DTSTART plus RRULE and RDATE, minus EXDATE) and any number of
 * overrides: VEVENTs with the same UID and a RECURRENCE-ID naming the occurrence they replace. An
 * override may move its occurrence anywhere, including into the window from outside it, so overrides
 * are placed by their own start and the occurrence they replace is suppressed wherever it was.
 */
import { childrenOf, dateValuesOf, parseCalendar, parseDateValue, parseDuration, parseUtcOffset, propOf, propsOf, textOf, unescapeText, type DateValue, type ICalComponent } from "./ical";
import { expandRule, parseRule, type Rule } from "./rrule";
import { canonicalZoneName, fixedZone, ianaZone, offsetFromLabel, utcToWall, wallOf, wallParts, wallToUtc, UTC_ZONE, type Zone } from "./tz";
import type { Attendee, EventStatus, Interval } from "./types";
import { findVideoLink } from "./video";

const DAY = 86_400_000;
const MINUTE = 60_000;

/* ---------------- Zones defined inside the file ---------------- */

type Observance = { start: number; from: number; to: number; rule: Rule | null; rdates: number[] };

/**
 * A zone from a VTIMEZONE block: each STANDARD and DAYLIGHT observance says when it starts (in the
 * local time before it), the offsets either side, and how it recurs. The offset at an instant is the
 * one set by the latest onset before it. Onsets are worked out per year and cached.
 */
export function ruleZone(vtz: ICalComponent): Zone | null {
  const obs: Observance[] = [];
  for (const c of vtz.components) {
    if (c.name !== "STANDARD" && c.name !== "DAYLIGHT") continue;
    const start = parseDateValue(propOf(c, "DTSTART")?.value ?? "");
    const from = parseUtcOffset(propOf(c, "TZOFFSETFROM")?.value ?? "");
    const to = parseUtcOffset(propOf(c, "TZOFFSETTO")?.value ?? "");
    if (!start || from === null || to === null) continue;
    const rr = propOf(c, "RRULE");
    obs.push({ start: start.wall, from, to, rule: rr ? parseRule(rr.value) : null, rdates: dateValuesOf(c, "RDATE").map((d) => d.wall) });
  }
  if (!obs.length) return null;
  const earliest = [...obs].sort((a, b) => a.start - b.start)[0];
  const cache = new Map<number, { at: number; to: number }[]>();
  const onsets = (y: number) => {
    let list = cache.get(y);
    if (list) return list;
    list = [];
    const from = wallOf(y, 1, 1), to = wallOf(y, 12, 31, 23, 59, 59);
    for (const o of obs) {
      const walls = new Set<number>(o.rdates.filter((w) => w >= from && w <= to));
      if (o.start >= from && o.start <= to) walls.add(o.start);
      if (o.rule) {
        const until = o.rule.until ? parseDateValue(o.rule.until) : null;
        // UNTIL in a VTIMEZONE is UTC; in local time before the onset that is UTC plus TZOFFSETFROM.
        const untilWall = until ? (until.utc ? until.wall + o.from * MINUTE : until.wall) : null;
        for (const w of expandRule(o.rule, o.start, { from, to, until: untilWall, max: 400 })) walls.add(w);
      }
      for (const w of walls) list.push({ at: w - o.from * MINUTE, to: o.to });
    }
    list.sort((a, b) => a.at - b.at);
    cache.set(y, list);
    return list;
  };
  const id = propOf(vtz, "TZID")?.value ?? "";
  return {
    id,
    offsetAt(t: number) {
      const y = new Date(t).getUTCFullYear();
      let best: { at: number; to: number } | null = null;
      for (const yy of [y - 1, y]) for (const o of onsets(yy)) if (o.at <= t && (!best || o.at >= best.at)) best = o;
      return best ? best.to : earliest.from;
    },
  };
}

/**
 * Resolve a TZID: an IANA name (or something that contains one), a Windows name, a VTIMEZONE in the
 * same file, an offset in a label, and only then the fallback. A known IANA zone wins over the file's
 * own VTIMEZONE because the runtime's rules carry the zone's whole history.
 */
export function zoneResolver(cal: ICalComponent, fallback: Zone): (tzid: string | null) => Zone {
  const defined = new Map<string, ICalComponent>();
  for (const vtz of childrenOf(cal, "VTIMEZONE")) {
    const id = propOf(vtz, "TZID")?.value;
    if (id) defined.set(id, vtz);
  }
  // A floating time belongs to the calendar's own zone when it names one (Apple and Google do).
  const wr = propOf(cal, "X-WR-TIMEZONE")?.value;
  const floating = (wr && ianaZone(canonicalZoneName(wr) ?? "")) || fallback;
  const cache = new Map<string, Zone>();
  return (tzid) => {
    if (!tzid) return floating;
    const hit = cache.get(tzid);
    if (hit) return hit;
    const name = canonicalZoneName(tzid);
    const vtz = defined.get(tzid);
    const label = offsetFromLabel(tzid);
    const z = (name && ianaZone(name)) || (vtz && ruleZone(vtz)) || (label !== null ? fixedZone(label) : null) || fallback;
    cache.set(tzid, z);
    return z;
  };
}

/* ---------------- Events ---------------- */

export type ParsedEvent = {
  uid: string;
  recurrenceId: DateValue | null;
  start: DateValue;
  end: DateValue | null;
  durationMs: number | null;
  rule: Rule | null;
  rdates: DateValue[];
  exdates: DateValue[];
  summary: string;
  description: string;
  location: string;
  status: EventStatus;
  busy: boolean;
  organizer: Attendee | null;
  attendees: Attendee[];
  url: string;
  sequence: number;
  conference: string;
};

const mailto = (v: string) => v.replace(/^mailto:/i, "").trim().toLowerCase();

function person(p: { params: Record<string, string>; value: string }, organizer = false): Attendee {
  const partstat = (p.params.PARTSTAT ?? "").toUpperCase();
  return {
    email: mailto(p.value),
    name: unescapeText(p.params.CN ?? "").replace(/^"|"$/g, ""),
    response: partstat === "ACCEPTED" ? "accepted" : partstat === "DECLINED" ? "declined" : partstat === "TENTATIVE" ? "tentative" : partstat === "NEEDS-ACTION" ? "needsAction" : organizer ? "accepted" : "unknown",
    ...(p.params.ROLE?.toUpperCase() === "OPT-PARTICIPANT" ? { optional: true } : {}),
    ...(organizer ? { organizer: true } : {}),
  };
}

/** Every VEVENT in a calendar, read into plain fields. Events without a start are skipped. */
export function readEvents(cal: ICalComponent): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const ev of childrenOf(cal, "VEVENT")) {
    const sp = propOf(ev, "DTSTART");
    const start = sp ? parseDateValue(sp.value, sp.params) : null;
    if (!start) continue;
    const ep = propOf(ev, "DTEND");
    const rid = propOf(ev, "RECURRENCE-ID");
    const rr = propOf(ev, "RRULE");
    const status = (propOf(ev, "STATUS")?.value ?? "").toUpperCase();
    const org = propOf(ev, "ORGANIZER");
    const organizer = org ? person(org, true) : null;
    const attendees = propsOf(ev, "ATTENDEE").map((a) => person(a)).filter((a) => a.email.includes("@"));
    if (organizer && attendees.some((a) => a.email === organizer.email)) attendees.forEach((a) => { if (a.email === organizer.email) a.organizer = true; });
    out.push({
      uid: propOf(ev, "UID")?.value.trim() ?? "",
      recurrenceId: rid ? parseDateValue(rid.value, rid.params) : null,
      start,
      end: ep ? parseDateValue(ep.value, ep.params) : null,
      durationMs: propOf(ev, "DURATION") ? parseDuration(propOf(ev, "DURATION")!.value) : null,
      rule: rr ? parseRule(rr.value) : null,
      rdates: dateValuesOf(ev, "RDATE"),
      exdates: dateValuesOf(ev, "EXDATE"),
      summary: textOf(ev, "SUMMARY"),
      description: textOf(ev, "DESCRIPTION"),
      location: textOf(ev, "LOCATION"),
      status: status === "CANCELLED" ? "cancelled" : status === "TENTATIVE" ? "tentative" : "confirmed",
      busy: (propOf(ev, "TRANSP")?.value ?? "").toUpperCase() !== "TRANSPARENT",
      organizer,
      attendees,
      url: propOf(ev, "URL")?.value.trim() ?? "",
      sequence: Number(propOf(ev, "SEQUENCE")?.value ?? 0) || 0,
      conference: propOf(ev, "X-GOOGLE-CONFERENCE")?.value ?? propOf(ev, "X-MICROSOFT-ONLINEMEETINGURL")?.value ?? propOf(ev, "X-MICROSOFT-SKYPETEAMSMEETINGURL")?.value ?? "",
    });
  }
  return out;
}

/** One occurrence, ready to store. Times are instants; an all-day event's are UTC midnights of its dates. */
export type Instance = {
  uid: string;
  /** The occurrence this is (ISO instant, or YYYY-MM-DD for all-day), null for a one-off event. */
  recurrenceId: string | null;
  start: number;
  end: number;
  allDay: boolean;
  timezone: string;
  summary: string;
  description: string;
  location: string;
  status: EventStatus;
  busy: boolean;
  organizer: Attendee | null;
  attendees: Attendee[];
  videoUrl: string;
  url: string;
  sequence: number;
};

const isoDate = (wall: number) => new Date(wall).toISOString().slice(0, 10);

/**
 * Every occurrence of every event in `text` (or a parsed calendar) that overlaps `window`.
 * `defaultTz` is used for floating times when the calendar names no zone of its own.
 */
export function expandCalendar(source: string | ICalComponent, window: Interval, opts: { defaultTz?: string; max?: number } = {}): Instance[] {
  const cal = typeof source === "string" ? parseCalendar(source) : source;
  const fallback = (opts.defaultTz && ianaZone(canonicalZoneName(opts.defaultTz) ?? "")) || UTC_ZONE;
  const zoneOf = zoneResolver(cal, fallback);
  const events = readEvents(cal);
  const max = opts.max ?? 5000;

  /** An instant for a DateValue: UTC as written, otherwise through its zone. All-day: the date itself. */
  const instant = (dv: DateValue) => (dv.date ? dv.wall : dv.utc ? dv.wall : wallToUtc(zoneOf(dv.tzid), dv.wall));

  const masters = new Map<string, ParsedEvent>();
  const overrides = new Map<string, ParsedEvent[]>();
  for (const e of events) {
    if (e.recurrenceId) overrides.set(e.uid, [...(overrides.get(e.uid) ?? []), e]);
    else if (!masters.has(e.uid) || (masters.get(e.uid)!.sequence < e.sequence)) masters.set(e.uid, e);
  }

  const out: Instance[] = [];
  const build = (e: ParsedEvent, start: number, durationMs: number, recurrenceId: string | null): Instance => {
    const allDay = e.start.date;
    const tz = allDay ? "" : e.start.utc ? "UTC" : zoneOf(e.start.tzid).id;
    return {
      uid: e.uid, recurrenceId, start, end: start + durationMs, allDay, timezone: tz,
      summary: e.summary, description: e.description, location: e.location, status: e.status, busy: e.busy,
      organizer: e.organizer, attendees: e.attendees, videoUrl: findVideoLink(e.conference, e.location, e.url, e.description), url: e.url, sequence: e.sequence,
    };
  };
  const durationOf = (e: ParsedEvent) => {
    if (e.end) return Math.max(0, instant(e.end) - instant(e.start));
    if (e.durationMs !== null) return Math.max(0, e.durationMs);
    return e.start.date ? DAY : 0;
  };
  const overlaps = (s: number, eEnd: number, allDay: boolean) => {
    // An all-day date is a calendar date, not an instant: allow a day either side for zone differences.
    const pad = allDay ? DAY : 0;
    return s < window.end + pad && (eEnd > window.start - pad || (eEnd === s && s >= window.start - pad));
  };
  const ridKey = (dv: DateValue) => (dv.date ? `d:${isoDate(dv.wall)}` : `t:${instant(dv)}`);

  for (const [uid, m] of masters) {
    const dur = durationOf(m);
    const replaced = new Set((overrides.get(uid) ?? []).map((o) => ridKey(o.recurrenceId!)));
    if (!m.rule && !m.rdates.length) {
      const s = instant(m.start);
      if (m.status !== "cancelled" && overlaps(s, s + dur, m.start.date)) out.push(build(m, s, dur, null));
      continue;
    }
    if (m.status === "cancelled") continue;
    const zone = m.start.date || m.start.utc ? UTC_ZONE : zoneOf(m.start.tzid);
    const toWall = (t: number) => (m.start.date ? t : utcToWall(zone, t));
    const from = toWall(window.start - dur) - DAY, to = toWall(window.end) + DAY;
    let untilWall: number | null = null;
    if (m.rule?.until) {
      const u = parseDateValue(m.rule.until);
      if (u) untilWall = u.date ? u.wall + DAY - 1000 : u.utc ? (m.start.date ? u.wall : utcToWall(zone, u.wall)) : u.wall;
    }
    const walls = new Set<number>(m.rule ? expandRule(m.rule, m.start.wall, { from, to, until: untilWall, max }) : []);
    if (!m.rule) walls.add(m.start.wall);
    for (const r of m.rdates) {
      const w = r.date ? r.wall : r.utc ? toWall(r.wall) : r.tzid ? toWall(wallToUtc(zoneOf(r.tzid), r.wall)) : r.wall;
      if (w >= from && w <= to) walls.add(w);
    }
    const exInstants = new Set<number>(), exDays = new Set<string>();
    for (const x of m.exdates) {
      if (x.date) exDays.add(isoDate(x.wall));
      else exInstants.add(instant(x));
    }
    for (const w of [...walls].sort((a, b) => a - b)) {
      const s = m.start.date ? w : wallToUtc(zone, w);
      const key = m.start.date ? `d:${isoDate(w)}` : `t:${s}`;
      if (replaced.has(key) || exInstants.has(s) || exDays.has(isoDate(w))) continue;
      if (!overlaps(s, s + dur, m.start.date)) continue;
      out.push(build(m, s, dur, m.start.date ? isoDate(w) : new Date(s).toISOString()));
      if (out.length >= max) return out;
    }
  }

  // Overrides, placed by their own start. An override without a master (an invitation to one
  // occurrence only) is shown the same way.
  for (const [uid, list] of overrides) {
    const master = masters.get(uid);
    for (const o of list) {
      if (o.status === "cancelled") continue;
      const rid = o.recurrenceId!;
      if (master && !rid.date && master.exdates.some((x) => !x.date && instant(x) === instant(rid))) continue;
      const s = instant(o.start);
      const dur = o.end || o.durationMs !== null ? durationOf(o) : master ? durationOf(master) : 0;
      if (!overlaps(s, s + dur, o.start.date)) continue;
      out.push(build(o, s, dur, rid.date ? isoDate(rid.wall) : new Date(instant(rid)).toISOString()));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The local date of an instant in a zone, YYYY-MM-DD. */
export function localDate(utcMs: number, zone: Zone): string {
  const p = wallParts(utcToWall(zone, utcMs));
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
