/**
 * The NYSE trading calendar for market-date logic: the "latest trading day", freshness of a quote and
 * how long quote-like answers stay cached. Every date here is a New York trading date; nothing uses the
 * UTC date (at 8 pm ET the UTC date is already tomorrow). Pure.
 *
 * 2025-2027 come from the exchange's published table; other years fall back to the holiday rules in
 * copytrade/markethours.ts (a test checks the two agree for 2025-2027, apart from the unscheduled closure).
 * Sources (research notes, datalayer/research.md §4.8, refs [61]):
 * - NYSE Holidays & Trading Hours, https://www.nyse.com/markets/hours-calendars
 * - ICE press release 2025-12-23, "NYSE Group Announces 2026, 2027 and 2028 Holiday and Early Closings
 *   Calendar", https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
 * - 2025-01-09: markets closed for the national day of mourning for President Carter (NYSE notice).
 * Early closes are at 1:00 pm ET; the core session is 9:30 am to 4:00 pm ET.
 */
import { earlyCloses as ruleEarlyCloses, holidays as ruleHolidays, newYorkParts } from "@/lib/copytrade/markethours";
import { isoDay, nyLocalToIso } from "./canonical";

export const NYSE_HOLIDAYS: Record<number, readonly string[]> = {
  2025: ["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"],
  2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
  2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
};
export const NYSE_EARLY_CLOSES: Record<number, readonly string[]> = {
  2025: ["2025-07-03", "2025-11-28", "2025-12-24"],
  2026: ["2026-11-27", "2026-12-24"],
  2027: ["2027-11-26"],
};

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;
const MINUTE_MS = 60_000;
/** Quote-like answers: a minute while the market is open, half an hour otherwise. */
const OPEN_TTL_MS = MINUTE_MS;
const CLOSED_TTL_MS = 30 * MINUTE_MS;
/** How far behind a quote may be before it reads as stale (covers a 15-minute delayed feed and caching). */
const STALE_GRACE_MS = 30 * MINUTE_MS;

const yearOf = (date: string) => Number(date.slice(0, 4));
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function isHoliday(date: string): boolean {
  const y = yearOf(date);
  return NYSE_HOLIDAYS[y] ? NYSE_HOLIDAYS[y].includes(date) : ruleHolidays(y).has(date);
}

export function isEarlyClose(date: string): boolean {
  const y = yearOf(date);
  return NYSE_EARLY_CLOSES[y] ? NYSE_EARLY_CLOSES[y].includes(date) : ruleEarlyCloses(y).has(date);
}

export const isTradingDay = (date: string): boolean => weekday(date) !== 0 && weekday(date) !== 6 && !isHoliday(date);

/** Minutes after midnight New York time when the session on `date` closes. */
export const closeMinutes = (date: string): number => (isEarlyClose(date) ? EARLY_CLOSE_MIN : CLOSE_MIN);

/** The New York calendar date at an instant. */
export const marketDate = (at: Date = new Date()): string => newYorkParts(at).date;

/** The New York calendar year at an instant (YTD starts here, not at the UTC new year). */
export const marketYear = (at: Date = new Date()): number => yearOf(marketDate(at));

/** The last trading day strictly before `date`. */
export function previousTradingDay(date: string): string {
  let d = addDays(date, -1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDays(d, -1);
  return d;
}

/** Whether the regular session is open at an instant. */
export function isMarketOpen(at: Date = new Date()): boolean {
  const { date, minutes } = newYorkParts(at);
  return isTradingDay(date) && minutes >= OPEN_MIN && minutes < closeMinutes(date);
}

/** The most recent session that has opened: today once the bell has rung on a trading day, else the one before. */
export function latestTradingDay(at: Date = new Date()): string {
  const { date, minutes } = newYorkParts(at);
  return isTradingDay(date) && minutes >= OPEN_MIN ? date : previousTradingDay(date);
}

/** The instant the most recent completed session closed. */
export function lastSessionClose(at: Date = new Date()): string {
  const { date, minutes } = newYorkParts(at);
  const day = isTradingDay(date) && minutes >= closeMinutes(date) ? date : previousTradingDay(date);
  const close = closeMinutes(day);
  return nyLocalToIso(day, `${Math.floor(close / 60)}:${String(close % 60).padStart(2, "0")}`);
}

/** How long a quote-like answer stays cached: a minute in session, half an hour when closed (holidays and early closes included). */
export const quoteTtlMs = (at: Date = new Date()): number => (isMarketOpen(at) ? OPEN_TTL_MS : CLOSED_TTL_MS);

/** Whether a quote stamped `asOf` is behind: in session, more than the grace old; when closed, from before the last close. */
export function isStaleQuote(asOf: string, at: Date = new Date()): boolean {
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return false;
  const expected = isMarketOpen(at) ? at.getTime() : Date.parse(lastSessionClose(at));
  return t < expected - STALE_GRACE_MS;
}

export { etClock } from "./units";

/** Nasdaq-style stamps in New York time ("Oct 20, 2026 4:00 PM ET", "DATA AS OF Jul 2, 2026") as an ISO instant; a date alone means its close. */
export function parseEtStamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/^\s*data as of\s*/i, "").trim();
  const day = isoDay(s);
  if (!day) return null;
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(s);
  if (!m) { const c = closeMinutes(day); return nyLocalToIso(day, `${Math.floor(c / 60)}:${String(c % 60).padStart(2, "0")}`); }
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return nyLocalToIso(day, `${h}:${m[2]}`);
}
