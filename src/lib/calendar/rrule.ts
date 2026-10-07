/**
 * RFC 5545 recurrence rules (RRULE), parsed and expanded. Pure.
 *
 * Expansion works in wall time (see tz.ts): every occurrence is a local clock reading in the event's
 * own zone, which the caller turns into an instant afterwards. Supported: FREQ from YEARLY down to
 * SECONDLY, INTERVAL, COUNT, UNTIL, BYDAY (with ordinals such as 2TU or -1FR), BYMONTHDAY (negative
 * counts from the month's end), BYMONTH, BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND, BYSETPOS
 * and WKST, following RFC 5545 section 3.3.10's expand-or-limit table and python-dateutil's defaults
 * where the RFC is silent (a YEARLY rule with only BYMONTHDAY runs in every month).
 *
 * DTSTART always counts as the first occurrence, as the RFC says, even when it does not itself match
 * the rule.
 */
import { wallDay, wallOf, wallParts } from "./tz";

export type Freq = "YEARLY" | "MONTHLY" | "WEEKLY" | "DAILY" | "HOURLY" | "MINUTELY" | "SECONDLY";
export type ByDay = { day: number; n: number };

export type Rule = {
  freq: Freq;
  interval: number;
  count: number | null;
  /** The raw UNTIL value; the caller turns it into wall time in the event's zone. */
  until: string | null;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  byYearDay: number[];
  byWeekNo: number[];
  byHour: number[];
  byMinute: number[];
  bySecond: number[];
  bySetPos: number[];
  wkst: number;
};

const FREQS: Freq[] = ["YEARLY", "MONTHLY", "WEEKLY", "DAILY", "HOURLY", "MINUTELY", "SECONDLY"];
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

const DAY = 86_400_000;
/** A rule that matches nothing (BYMONTHDAY=30 in February only) must not spin forever. */
const MAX_PERIODS = 50_000;

const ints = (v: string | undefined, lo: number, hi: number, allowNegative = false): number[] =>
  (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(Number)
    .filter((n) => Number.isInteger(n) && (allowNegative ? n !== 0 && Math.abs(n) >= lo && Math.abs(n) <= hi : n >= lo && n <= hi));

/** "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z" -> a Rule, or null when it is not one. */
export function parseRule(text: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const piece of text.replace(/^RRULE:/i, "").split(";")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim().toUpperCase()] = piece.slice(i + 1).trim();
  }
  const freq = (parts.FREQ ?? "").toUpperCase() as Freq;
  if (!FREQS.includes(freq)) return null;
  const byDay: ByDay[] = [];
  for (const raw of (parts.BYDAY ?? "").split(",")) {
    const m = raw.trim().toUpperCase().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (m) byDay.push({ day: WEEKDAYS.indexOf(m[2] as (typeof WEEKDAYS)[number]), n: m[1] ? Number(m[1]) : 0 });
  }
  const interval = Number(parts.INTERVAL ?? 1);
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  const wkst = WEEKDAYS.indexOf((parts.WKST ?? "MO").toUpperCase() as (typeof WEEKDAYS)[number]);
  return {
    freq,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    count: count !== null && Number.isInteger(count) && count > 0 ? count : null,
    until: parts.UNTIL || null,
    byDay,
    byMonthDay: ints(parts.BYMONTHDAY, 1, 31, true),
    byMonth: ints(parts.BYMONTH, 1, 12),
    byYearDay: ints(parts.BYYEARDAY, 1, 366, true),
    byWeekNo: ints(parts.BYWEEKNO, 1, 53, true),
    byHour: ints(parts.BYHOUR, 0, 23),
    byMinute: ints(parts.BYMINUTE, 0, 59),
    bySecond: ints(parts.BYSECOND, 0, 60),
    bySetPos: ints(parts.BYSETPOS, 1, 366, true),
    wkst: wkst >= 0 ? wkst : 1,
  };
}

/** A Rule back to its RRULE value (without the "RRULE:" name). */
export function formatRule(r: Rule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval !== 1) out.push(`INTERVAL=${r.interval}`);
  if (r.count) out.push(`COUNT=${r.count}`);
  if (r.until) out.push(`UNTIL=${r.until}`);
  const list = (k: string, v: number[]) => { if (v.length) out.push(`${k}=${v.join(",")}`); };
  if (r.byDay.length) out.push(`BYDAY=${r.byDay.map((b) => `${b.n || ""}${WEEKDAYS[b.day]}`).join(",")}`);
  list("BYMONTHDAY", r.byMonthDay); list("BYMONTH", r.byMonth); list("BYYEARDAY", r.byYearDay); list("BYWEEKNO", r.byWeekNo);
  list("BYHOUR", r.byHour); list("BYMINUTE", r.byMinute); list("BYSECOND", r.bySecond); list("BYSETPOS", r.bySetPos);
  if (r.wkst !== 1) out.push(`WKST=${WEEKDAYS[r.wkst]}`);
  return out.join(";");
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const daysInYear = (y: number) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
const dow = (dayWall: number) => new Date(dayWall).getUTCDay();

/** Days (wall midnights) in [first, last] that a BYDAY list picks, ordinals counted within that span. */
function byDayIn(first: number, last: number, byDay: ByDay[]): number[] {
  const out: number[] = [];
  for (const b of byDay) {
    const matches: number[] = [];
    const shift = (b.day - dow(first) + 7) % 7;
    for (let d = first + shift * DAY; d <= last; d += 7 * DAY) matches.push(d);
    if (b.n === 0) out.push(...matches);
    else {
      const pick = b.n > 0 ? matches[b.n - 1] : matches[matches.length + b.n];
      if (pick !== undefined) out.push(pick);
    }
  }
  return out;
}

function monthDays(y: number, m: number, byMonthDay: number[]): number[] {
  const n = daysInMonth(y, m);
  return byMonthDay.map((d) => (d > 0 ? d : n + d + 1)).filter((d) => d >= 1 && d <= n).map((d) => wallOf(y, m, d));
}

function yearDays(y: number, byYearDay: number[]): number[] {
  const n = daysInYear(y), jan1 = wallOf(y, 1, 1);
  return byYearDay.map((d) => (d > 0 ? d : n + d + 1)).filter((d) => d >= 1 && d <= n).map((d) => jan1 + (d - 1) * DAY);
}

/** The first day of week 1 of a year: the week (starting on WKST) that holds at least four of its days. */
function week1Start(y: number, wkst: number): number {
  const jan1 = wallOf(y, 1, 1);
  const offset = (dow(jan1) - wkst + 7) % 7;
  return offset <= 3 ? jan1 - offset * DAY : jan1 + (7 - offset) * DAY;
}

function weekNoDays(y: number, weeks: number[], wkst: number): number[] {
  const w1 = week1Start(y, wkst), total = Math.round((week1Start(y + 1, wkst) - w1) / (7 * DAY));
  const jan1 = wallOf(y, 1, 1), dec31 = wallOf(y, 12, 31);
  const out: number[] = [];
  for (const raw of weeks) {
    const n = raw > 0 ? raw : total + raw + 1;
    if (n < 1 || n > total) continue;
    for (let i = 0; i < 7; i++) {
      const d = w1 + ((n - 1) * 7 + i) * DAY;
      if (d >= jan1 && d <= dec31) out.push(d);
    }
  }
  return out;
}

const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Expand every candidate day of one period into date-times. */
function withTimes(days: number[], r: Rule, h0: number, mi0: number, s0: number): number[] {
  const hs = r.byHour.length ? r.byHour : [h0];
  const ms = r.byMinute.length ? r.byMinute : [mi0];
  const ss = r.bySecond.length ? r.bySecond : [s0];
  const out: number[] = [];
  for (const d of days) for (const h of hs) for (const m of ms) for (const s of ss) out.push(d + ((h * 60 + m) * 60 + s) * 1000);
  return out;
}

function limitDay(day: number, r: Rule): boolean {
  const p = wallParts(day);
  if (r.byMonth.length && !r.byMonth.includes(p.m)) return false;
  if (r.byMonthDay.length && !monthDays(p.y, p.m, r.byMonthDay).includes(day)) return false;
  if (r.byYearDay.length && !yearDays(p.y, r.byYearDay).includes(day)) return false;
  if (r.byDay.length && !r.byDay.some((b) => b.day === p.dow)) return false;
  return true;
}

function applySetPos(cands: number[], setPos: number[]): number[] {
  if (!setPos.length) return cands;
  return uniqSorted(setPos.map((p) => (p > 0 ? cands[p - 1] : cands[cands.length + p])).filter((x): x is number => x !== undefined));
}

export type ExpandOptions = {
  /** Only occurrences at or after this wall time are returned (COUNT still counts the earlier ones). */
  from: number;
  /** Only occurrences at or before this wall time are returned. */
  to: number;
  /** UNTIL as a wall time in the event's zone, inclusive; null when the rule has none. */
  until: number | null;
  /** Hard cap on what is returned. */
  max?: number;
};

/**
 * The occurrences of `rule` starting at `dtstart` (a wall time), within [from, to], ascending.
 * `dateOnly` is for all-day events, whose occurrences are midnights.
 */
export function expandRule(rule: Rule, dtstart: number, opts: ExpandOptions): number[] {
  const r = rule;
  const s = wallParts(dtstart);
  const max = opts.max ?? 5000;
  const stopAt = Math.min(opts.to, opts.until ?? Infinity);
  const out: number[] = [];
  let emitted = 0;
  const emit = (t: number): boolean => {
    emitted++;
    if (t >= opts.from && t <= opts.to) out.push(t);
    return (r.count !== null && emitted >= r.count) || out.length >= max;
  };
  if (dtstart > stopAt) return out;
  if (emit(dtstart)) return out;

  const startDay = wallDay(dtstart);
  const weekStart0 = startDay - ((s.dow - r.wkst + 7) % 7) * DAY;
  const unit = r.freq === "HOURLY" ? 3_600_000 : r.freq === "MINUTELY" ? 60_000 : r.freq === "SECONDLY" ? 1000 : 0;

  // Without COUNT, periods before the window cannot matter: jump to just before it.
  let first = 0;
  if (r.count === null && opts.from > dtstart) {
    const f = wallParts(opts.from);
    const gap = r.freq === "YEARLY" ? f.y - s.y
      : r.freq === "MONTHLY" ? (f.y - s.y) * 12 + (f.m - s.m)
      : r.freq === "WEEKLY" ? Math.floor((wallDay(opts.from) - weekStart0) / (7 * DAY))
      : r.freq === "DAILY" ? Math.floor((wallDay(opts.from) - startDay) / DAY)
      : Math.floor((opts.from - dtstart) / unit);
    first = Math.max(0, (Math.floor(gap / r.interval) - 1) * r.interval);
  }

  for (let i = first, guard = 0; guard < MAX_PERIODS; i += r.interval, guard++) {
    let periodStart: number;
    let cands: number[];
    if (r.freq === "YEARLY") {
      const y = s.y + i;
      periodStart = wallOf(y, 1, 1);
      if (periodStart > stopAt) break;
      let days: number[];
      if (r.byWeekNo.length) {
        days = weekNoDays(y, r.byWeekNo, r.wkst);
        days = days.filter((d) => (r.byDay.length ? r.byDay.some((b) => b.day === dow(d)) : dow(d) === s.dow));
        if (r.byMonth.length) days = days.filter((d) => r.byMonth.includes(wallParts(d).m));
      } else if (r.byYearDay.length && !r.byMonth.length && !r.byMonthDay.length && !r.byDay.length) {
        days = yearDays(y, r.byYearDay);
      } else if (r.byDay.length) {
        days = r.byMonth.length
          ? r.byMonth.flatMap((m) => byDayIn(wallOf(y, m, 1), wallOf(y, m, daysInMonth(y, m)), r.byDay))
          : byDayIn(wallOf(y, 1, 1), wallOf(y, 12, 31), r.byDay);
        if (r.byMonthDay.length) days = days.filter((d) => monthDays(wallParts(d).y, wallParts(d).m, r.byMonthDay).includes(d));
        if (r.byYearDay.length) days = days.filter((d) => yearDays(y, r.byYearDay).includes(d));
      } else if (r.byMonthDay.length) {
        const months = r.byMonth.length ? r.byMonth : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        days = months.flatMap((m) => monthDays(y, m, r.byMonthDay));
        if (r.byYearDay.length) days = days.filter((d) => yearDays(y, r.byYearDay).includes(d));
      } else if (r.byYearDay.length) {
        days = yearDays(y, r.byYearDay).filter((d) => r.byMonth.includes(wallParts(d).m));
      } else {
        const months = r.byMonth.length ? r.byMonth : [s.m];
        days = months.filter((m) => s.d <= daysInMonth(y, m)).map((m) => wallOf(y, m, s.d));
      }
      cands = withTimes(uniqSorted(days), r, s.h, s.mi, s.s);
    } else if (r.freq === "MONTHLY") {
      const idx = s.y * 12 + (s.m - 1) + i;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      periodStart = wallOf(y, m, 1);
      if (periodStart > stopAt) break;
      if (r.byMonth.length && !r.byMonth.includes(m)) continue;
      let days: number[];
      if (r.byDay.length) {
        days = byDayIn(periodStart, wallOf(y, m, daysInMonth(y, m)), r.byDay);
        if (r.byMonthDay.length) { const md = monthDays(y, m, r.byMonthDay); days = days.filter((d) => md.includes(d)); }
      } else if (r.byMonthDay.length) {
        days = monthDays(y, m, r.byMonthDay);
      } else {
        days = s.d <= daysInMonth(y, m) ? [wallOf(y, m, s.d)] : [];
      }
      if (r.byYearDay.length) days = days.filter((d) => yearDays(y, r.byYearDay).includes(d));
      cands = withTimes(uniqSorted(days), r, s.h, s.mi, s.s);
    } else if (r.freq === "WEEKLY") {
      periodStart = weekStart0 + i * 7 * DAY;
      if (periodStart > stopAt) break;
      const wanted = r.byDay.length ? r.byDay.map((b) => b.day) : [s.dow];
      let days: number[] = [];
      for (let k = 0; k < 7; k++) { const d = periodStart + k * DAY; if (wanted.includes(dow(d))) days.push(d); }
      if (r.byMonth.length) days = days.filter((d) => r.byMonth.includes(wallParts(d).m));
      cands = withTimes(days, r, s.h, s.mi, s.s);
    } else if (r.freq === "DAILY") {
      periodStart = startDay + i * DAY;
      if (periodStart > stopAt) break;
      cands = limitDay(periodStart, r) ? withTimes([periodStart], r, s.h, s.mi, s.s) : [];
    } else {
      periodStart = dtstart + i * unit;
      if (periodStart > stopAt) break;
      const p = wallParts(periodStart);
      const ok = limitDay(wallDay(periodStart), r)
        && (!r.byHour.length || r.byHour.includes(p.h)) && (!r.byMinute.length || r.byMinute.includes(p.mi)) && (!r.bySecond.length || r.bySecond.includes(p.s));
      cands = ok ? [periodStart] : [];
    }
    for (const c of applySetPos(cands, r.bySetPos)) {
      if (c <= dtstart) continue;
      if (c > stopAt) return out;
      if (emit(c)) return out;
    }
  }
  return out;
}
