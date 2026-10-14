/**
 * US equity market hours (NYSE and Nasdaq share them), worked out from the exchanges' published holiday
 * rules rather than a hard-coded list, so it does not go stale. Pure, for tests.
 *
 * Regular session 9:30 to 16:00 Eastern; early close 13:00 on the day after Thanksgiving, on Christmas
 * Eve and on 3 July (when they are weekdays and not themselves holidays). Holidays: New Year's Day,
 * Martin Luther King Jr. Day, Washington's Birthday, Good Friday, Memorial Day, Juneteenth (from 2022),
 * Independence Day, Labor Day, Thanksgiving and Christmas. A holiday on a Saturday is observed the Friday
 * before, on a Sunday the Monday after; New Year's Day on a Saturday is not moved into December.
 * Unscheduled closures (a national day of mourning, a storm) are not known in advance: the broker's
 * own rejection covers those.
 */

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** The n-th given weekday (0 Sunday) of a month; n = -1 for the last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) { const first = dow(y, m, 1); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7; }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDay - ((dow(y, m, lastDay) - weekday + 7) % 7);
}

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
export function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

function observed(y: number, m: number, d: number, isNewYear = false): string | null {
  const w = dow(y, m, d);
  if (w === 6) return isNewYear ? null : iso(y, m, d - 1);
  if (w === 0) return iso(y, m, d + 1);
  return iso(y, m, d);
}

/** The full-day market holidays of a year, as YYYY-MM-DD. */
export function holidays(y: number): Set<string> {
  const out = new Set<string>();
  const add = (s: string | null) => { if (s) out.add(s); };
  add(observed(y, 1, 1, true));
  // New Year's Day of next year falling on a Saturday is not observed on 31 December (exchange rule).
  out.add(iso(y, 1, nthWeekday(y, 1, 1, 3)));
  out.add(iso(y, 2, nthWeekday(y, 2, 1, 3)));
  const e = new Date(`${easter(y)}T00:00:00Z`); e.setUTCDate(e.getUTCDate() - 2); out.add(e.toISOString().slice(0, 10));
  out.add(iso(y, 5, nthWeekday(y, 5, 1, -1)));
  if (y >= 2022) add(observed(y, 6, 19));
  add(observed(y, 7, 4));
  out.add(iso(y, 9, nthWeekday(y, 9, 1, 1)));
  out.add(iso(y, 11, nthWeekday(y, 11, 4, 4)));
  add(observed(y, 12, 25));
  return out;
}

/** Days that close at 13:00 Eastern. */
export function earlyCloses(y: number): Set<string> {
  const out = new Set<string>();
  const hol = holidays(y);
  const tg = nthWeekday(y, 11, 4, 4);
  out.add(iso(y, 11, tg + 1));
  for (const [m, d] of [[12, 24], [7, 3]] as const) {
    const s = iso(y, m, d), w = dow(y, m, d);
    if (w >= 1 && w <= 5 && !hol.has(s)) out.add(s);
  }
  return out;
}

/** Wall-clock parts of an instant in New York (handles daylight saving through the platform's time-zone data). */
export function newYorkParts(at: Date): { date: string; minutes: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: wd };
}

export type MarketState = { open: boolean; date: string; reason: "open" | "weekend" | "holiday" | "before open" | "after close"; closesAt: string | null; nextOpen: string };

export function isTradingDay(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const w = dow(y, m, d);
  return w !== 0 && w !== 6 && !holidays(y).has(date);
}

/** The next trading day on or after a date. */
export function nextTradingDay(date: string, inclusive = true): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!inclusive) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 14; i++) {
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(s)) return s;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Whether the regular session is open at an instant, and when it next opens (Eastern, "YYYY-MM-DD 09:30 ET"). */
export function marketState(at: Date = new Date()): MarketState {
  const { date, minutes, weekday } = newYorkParts(at);
  const y = Number(date.slice(0, 4));
  const close = earlyCloses(y).has(date) ? 13 * 60 : 16 * 60;
  const trading = isTradingDay(date);
  const reason: MarketState["reason"] = weekday === 0 || weekday === 6 ? "weekend" : !trading ? "holiday" : minutes < 9 * 60 + 30 ? "before open" : minutes >= close ? "after close" : "open";
  const open = reason === "open";
  const nextDay = reason === "before open" ? date : nextTradingDay(date, false);
  return { open, date, reason, closesAt: open ? `${close === 13 * 60 ? "13:00" : "16:00"} ET` : null, nextOpen: open ? date : `${nextDay} 09:30 ET` };
}
