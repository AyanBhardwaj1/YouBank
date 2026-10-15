/**
 * QF3: the NYSE trading calendar, by rule (copytrade/markethours.ts: holidays, early closes) plus the
 * unscheduled closures a rule cannot know, and the time conversions point-in-time code needs ("the next
 * session open after this filing was accepted"). Pure.
 */
import { earlyCloses, isTradingDay as ruleTradingDay, newYorkParts } from "@/lib/copytrade/markethours";

/** Full-day closures outside the holiday rules (exchange notices), 2001 on. */
export const SPECIAL_CLOSURES = new Set([
  "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", // September 11
  "2004-06-11", // President Reagan's funeral
  "2007-01-02", // President Ford's funeral
  "2012-10-29", "2012-10-30", // Hurricane Sandy
  "2018-12-05", // President George H. W. Bush's funeral
  "2025-01-09", // President Carter's funeral
]);

/** Juneteenth became an exchange holiday in 2022; markethours already starts it then. Good Friday is always closed. */
export function isSession(date: string): boolean {
  return ruleTradingDay(date) && !SPECIAL_CLOSURES.has(date);
}

const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function nextSession(date: string, inclusive = true): string {
  let d = inclusive ? date : addDays(date, 1);
  for (let i = 0; i < 20 && !isSession(d); i++) d = addDays(d, 1);
  return d;
}

export function prevSession(date: string, inclusive = true): string {
  let d = inclusive ? date : addDays(date, -1);
  for (let i = 0; i < 20 && !isSession(d); i++) d = addDays(d, -1);
  return d;
}

/** Sessions from `from` to `to` inclusive. */
export function sessions(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = nextSession(from); d <= to; d = nextSession(d, false)) out.push(d);
  return out;
}

/** The session `k` sessions after `date` (k = 0: the next session on or after it). */
export function addSessions(date: string, k: number): string {
  let d = nextSession(date);
  for (let i = 0; i < k; i++) d = nextSession(d, false);
  return d;
}

/** Minutes east of UTC for New York on a date (-240 in daylight saving time, -300 otherwise). */
export function newYorkOffsetMinutes(date: string): number {
  const noonUtc = new Date(`${date}T16:00:00Z`);
  const p = newYorkParts(noonUtc);
  return p.minutes - 16 * 60;
}

/** A New York wall-clock time on a date, as an ISO instant ("2026-10-15", "09:30" -> "2026-10-15T13:30:00.000Z"). */
export function newYorkTime(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m - newYorkOffsetMinutes(date)) * 60_000;
  return new Date(t).toISOString();
}

export const sessionOpen = (date: string) => newYorkTime(date, "09:30");
export const sessionClose = (date: string) => newYorkTime(date, earlyCloses(Number(date.slice(0, 4))).has(date) ? "13:00" : "16:00");

/**
 * The first moment trading on information public at `at` is consistent with a backtest: the next session's
 * open when it became public outside the session (or after 15:45, too late to act that day), else the same
 * session's close. Rule 1 of the contract: trade no earlier than the next session open after asOf; used here
 * as the conservative "next open".
 */
export function nextOpenAfter(at: string | Date): string {
  const t = new Date(at);
  const { date, minutes } = newYorkParts(t);
  if (isSession(date) && minutes < 9 * 60 + 30) return sessionOpen(date);
  return sessionOpen(nextSession(date, false));
}

/**
 * When a filing's figures count as known (QF3): its EDGAR acceptance time, rounded up to the next session's open
 * when accepted after 16:00 New York time (or on a non-session day). With only a filing date (company facts
 * carry `filed`, not the acceptance time), the conservative end of that day: usable from the next session open.
 */
export function knownAtOf(accepted: string | null, filedDate?: string): string {
  if (accepted) {
    const { date, minutes } = newYorkParts(new Date(accepted));
    if (isSession(date) && minutes >= 9 * 60 + 30 && minutes < 16 * 60) return new Date(accepted).toISOString();
    return nextOpenAfter(accepted);
  }
  if (!filedDate) throw new Error("knownAtOf needs an acceptance time or a filing date");
  return sessionOpen(nextSession(filedDate, false));
}
