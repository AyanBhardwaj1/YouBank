/**
 * Finding times to meet. Pure.
 *
 * Given when someone is busy (merged across all their calendars), their working hours and zone, and
 * how long the meeting is, propose a handful of times that are actually free: aligned to the half
 * hour on their own clock, padded by a buffer either side of other meetings, never sooner than a
 * minimum notice, and spread out (at most two a day, a morning and an afternoon where possible) so
 * the other side has a real choice rather than five adjacent half hours on Tuesday.
 */
import { utcToWall, wallDay, wallParts, wallToUtc, zoneOrUtc } from "./tz";
import { DEFAULT_WORK_HOURS, type Interval, type WorkHours } from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Sort and merge overlapping or touching intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** The free gaps inside `window` once `busy` is taken out. */
export function freeWithin(window: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

const minutesOf = (hhmm: string, fallback: number) => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : fallback;
};

export function normalizeWorkHours(raw: unknown): WorkHours {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<WorkHours>;
  const start = typeof r.start === "string" && /^\d{1,2}:\d{2}$/.test(r.start) ? r.start : DEFAULT_WORK_HOURS.start;
  const end = typeof r.end === "string" && /^\d{1,2}:\d{2}$/.test(r.end) ? r.end : DEFAULT_WORK_HOURS.end;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_WORK_HOURS.days;
  return minutesOf(end, 0) > minutesOf(start, 0) ? { start, end, days: days.length ? days : DEFAULT_WORK_HOURS.days } : DEFAULT_WORK_HOURS;
}

export type SlotOptions = {
  busy: Interval[];
  /** Search from here (UTC ms)... */
  from: number;
  /** ...to here. */
  to: number;
  durationMin: number;
  timezone: string;
  workHours?: WorkHours;
  /** Kept clear either side of other meetings. Default 10. */
  bufferMin?: number;
  /** Start times are multiples of this on the person's clock. Default 30. */
  stepMin?: number;
  /** Nothing sooner than this from now. Default 120. */
  minNoticeMin?: number;
  maxSlots?: number;
  maxPerDay?: number;
  now?: number;
};

/** Up to `maxSlots` free times, earliest days first, at most `maxPerDay` a day and spread within it. */
export function findSlots(o: SlotOptions): Interval[] {
  const zone = zoneOrUtc(o.timezone);
  const hours = normalizeWorkHours(o.workHours);
  const dur = Math.max(5, Math.round(o.durationMin)) * MINUTE;
  const buffer = Math.max(0, o.bufferMin ?? 10) * MINUTE;
  const step = Math.max(5, o.stepMin ?? 30) * MINUTE;
  const maxSlots = o.maxSlots ?? 6;
  const maxPerDay = o.maxPerDay ?? 2;
  const now = o.now ?? Date.now();
  const earliest = Math.max(o.from, now + (o.minNoticeMin ?? 120) * MINUTE);
  const busy = mergeIntervals(o.busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer })));
  const clashes = (s: number, e: number) => busy.some((b) => b.start < e && b.end > s);
  const startMin = minutesOf(hours.start, 9 * 60), endMin = minutesOf(hours.end, 18 * 60);

  const out: Interval[] = [];
  for (let day = wallDay(utcToWall(zone, earliest)); day <= wallDay(utcToWall(zone, o.to)) && out.length < maxSlots; day += DAY) {
    if (!hours.days.includes(wallParts(day).dow)) continue;
    const dayEnd = wallToUtc(zone, day + endMin * MINUTE);
    const free: Interval[] = [];
    for (let w = day + startMin * MINUTE; ; w += step) {
      const s = wallToUtc(zone, w), e = s + dur;
      if (e > dayEnd || e > o.to) break;
      if (s < earliest || clashes(s, e)) continue;
      free.push({ start: s, end: e });
    }
    // Spread: the first free time, then the first at least two and a half hours after it, and so on.
    const picked: Interval[] = [];
    for (const f of free) {
      if (picked.length >= maxPerDay) break;
      const last = picked[picked.length - 1];
      if (!last || f.start >= last.end + 150 * MINUTE) picked.push(f);
    }
    for (const f of free) {
      if (picked.length >= maxPerDay) break;
      if (!picked.some((p) => p.start < f.end && p.end > f.start)) picked.push(f);
    }
    out.push(...picked.sort((a, b) => a.start - b.start).slice(0, maxSlots - out.length));
  }
  return out;
}

/** "Tue 7 Oct, 10:00–10:30" on the person's clock. */
export function formatSlot(slot: Interval, timezone: string): string {
  const tz = zoneOrUtc(timezone).id;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(slot.start);
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day}, ${t.format(slot.start)}–${t.format(slot.end)}`;
}

/** A short zone label for an email: "ET", "CET", or the IANA name when Intl has no abbreviation. */
export function zoneLabel(timezone: string, at = Date.now()): string {
  const tz = zoneOrUtc(timezone).id;
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
  return part.replace(/^(E|C|M|P)[SD]T$/, "$1T");
}
