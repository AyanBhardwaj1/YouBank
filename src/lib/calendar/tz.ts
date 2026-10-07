/**
 * Time zones for calendar maths. Pure; uses only the runtime's Intl data.
 *
 * Recurrence is expanded in *wall time* (the clock on the wall where the event happens), then each
 * occurrence is turned into an instant. That is the only way a weekly 9:00 meeting stays at 9:00 on
 * both sides of a daylight-saving change. A wall time is carried as a plain number: the epoch
 * milliseconds it would be if that wall clock were UTC (`Date.UTC(y, m, d, h, mi, s)`), so date
 * arithmetic on it never meets a DST jump.
 *
 * Calendars name zones in three ways, and all three turn up in the wild:
 * - IANA names (`America/New_York`), which Intl knows;
 * - Windows names (`Eastern Standard Time`), which Outlook and Exchange write into .ics files;
 * - custom VTIMEZONE blocks with their own rules, sometimes under made-up ids
 *   (`/mozilla.org/20050126_1/Europe/Berlin`, `GMT+0100 (CET)`).
 * `resolveZone` tries each, and a VTIMEZONE's rules are evaluated with the same RRULE engine as
 * events (see `ruleZone`).
 */

/** Anything that can say its UTC offset, in minutes east of UTC, at an instant. */
export type Zone = { id: string; offsetAt(utcMs: number): number };

const MINUTE = 60_000;
const DAY = 86_400_000;

export const UTC_ZONE: Zone = { id: "UTC", offsetAt: () => 0 };

export function fixedZone(minutes: number, id = ""): Zone {
  return { id: id || `UTC${minutes >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`, offsetAt: () => minutes };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(tz, new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      }));
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

/** Whether the runtime knows this IANA name. */
export function isIanaZone(tz: string): boolean {
  return !!tz && formatterFor(tz) !== null;
}

function ianaOffset(f: Intl.DateTimeFormat, utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  // Seconds are dropped before comparing: the instant itself may carry milliseconds.
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / MINUTE);
}

export function ianaZone(tz: string): Zone | null {
  const f = formatterFor(tz);
  if (!f) return null;
  return { id: tz, offsetAt: (t) => ianaOffset(f, t) };
}

/** The wall time an instant shows in a zone. */
export function utcToWall(zone: Zone, utcMs: number): number {
  return utcMs + zone.offsetAt(utcMs) * MINUTE;
}

/**
 * The instant a wall time names in a zone, as RFC 5545 section 3.3.5 rules it:
 * - a time that happens twice (the hour after clocks go back) means the first of the two;
 * - a time that never happens (the hour skipped when clocks go forward) is read with the offset in
 *   force before the gap, so 02:30 on a spring-forward night lands at 03:30.
 */
export function wallToUtc(zone: Zone, wall: number): number {
  const before = zone.offsetAt(wall - DAY);
  const after = zone.offsetAt(wall + DAY);
  const valid = [before, after].filter((o, i, all) => all.indexOf(o) === i).map((o) => wall - o * MINUTE).filter((t) => zone.offsetAt(t) * MINUTE === wall - t);
  if (valid.length) return Math.min(...valid);
  return wall - before * MINUTE;
}

/** Wall-time parts, for display and for rules that look at weekdays and dates. */
export type WallParts = { y: number; m: number; d: number; h: number; mi: number; s: number; dow: number };

export function wallParts(wall: number): WallParts {
  const d = new Date(wall);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}

export const wallOf = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);

/** The wall-time midnight of the day containing `wall`. */
export const wallDay = (wall: number) => Math.floor(wall / DAY) * DAY;

/* ---------------- Windows zone names ---------------- */

/**
 * Windows time-zone names to IANA, for the zones people actually meet in. From the Unicode CLDR
 * windowsZones table (territory 001). Outlook writes these into invitations.
 */
const WINDOWS: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12", "Hawaiian Standard Time": "Pacific/Honolulu", "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles", "Pacific Standard Time (Mexico)": "America/Tijuana", "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver", "Central America Standard Time": "America/Guatemala", "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City", "Canada Central Standard Time": "America/Regina", "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time": "America/New_York", "US Eastern Standard Time": "America/Indianapolis", "Atlantic Standard Time": "America/Halifax",
  "SA Western Standard Time": "America/La_Paz", "Newfoundland Standard Time": "America/St_Johns", "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires", "Greenland Standard Time": "America/Godthab", "UTC": "Etc/UTC", "Coordinated Universal Time": "Etc/UTC",
  "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest", "Romance Standard Time": "Europe/Paris", "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos", "GTB Standard Time": "Europe/Bucharest", "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev", "Israel Standard Time": "Asia/Jerusalem", "South Africa Standard Time": "Africa/Johannesburg",
  "Egypt Standard Time": "Africa/Cairo", "Turkey Standard Time": "Europe/Istanbul", "Arabic Standard Time": "Asia/Baghdad", "Arab Standard Time": "Asia/Riyadh",
  "Russian Standard Time": "Europe/Moscow", "E. Africa Standard Time": "Africa/Nairobi", "Iran Standard Time": "Asia/Tehran", "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi", "India Standard Time": "Asia/Calcutta", "Nepal Standard Time": "Asia/Katmandu", "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok", "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore", "Taipei Standard Time": "Asia/Taipei",
  "W. Australia Standard Time": "Australia/Perth", "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul", "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Eastern Standard Time": "Australia/Sydney", "E. Australia Standard Time": "Australia/Brisbane", "New Zealand Standard Time": "Pacific/Auckland",
  "Hong Kong Standard Time": "Asia/Hong_Kong", "Mountain Standard Time (Mexico)": "America/Chihuahua",
};

/** An IANA name for whatever a calendar called its zone, or null. */
export function canonicalZoneName(raw: string): string | null {
  const tz = raw.trim().replace(/^"|"$/g, "");
  if (!tz) return null;
  if (/^(Z|UTC|GMT|Etc\/UTC|Etc\/GMT)$/i.test(tz)) return "UTC";
  if (isIanaZone(tz) && tz.includes("/")) return tz;
  if (WINDOWS[tz]) return WINDOWS[tz];
  // "/mozilla.org/20050126_1/Europe/Berlin", "/softwarestudio.org/Olson_20011030_5/America/New_York"
  const segments = tz.split("/").filter(Boolean);
  for (let i = Math.max(0, segments.length - 3); i < segments.length - 1; i++) {
    const candidate = segments.slice(i).join("/");
    if (isIanaZone(candidate)) return candidate;
  }
  return isIanaZone(tz) ? tz : null;
}

/** "(UTC-05:00) Eastern Time", "GMT+0100", "UTC+5:30" -> minutes east of UTC. */
export function offsetFromLabel(raw: string): number | null {
  const m = raw.match(/(?:UTC|GMT)\s*([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

/** A zone for a stored name, falling back to UTC. Used for the person's own zone. */
export function zoneOrUtc(tz: string | null | undefined): Zone {
  const name = tz ? canonicalZoneName(tz) : null;
  return (name && ianaZone(name)) || UTC_ZONE;
}
