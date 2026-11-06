/**
 * The Book's dates as a calendar file (iCalendar, RFC 5545) for Outlook, Google Calendar or Apple Calendar:
 * each position's next earnings date and its catalysts, as all-day events, with the thesis's state, what the
 * next report must show and a link back to the position. Each event's UID names the position (and the
 * catalyst), not the date, and SEQUENCE grows with each download, so re-importing after a date moves updates
 * the event rather than adding a second one. One earnings event per ticker, however many positions hold it.
 * Pure; tested in scripts/test-book.ts.
 */
import { escapeText, foldLine } from "@/lib/calendar/ical";
import type { Evaluation } from "./position";

/** Text and long lines as iCalendar wants them: the shared helpers (src/lib/calendar/ical.ts). */
export { escapeText as icsText, foldLine as fold };

const day = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso: string) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
const STATE: Record<Evaluation["verdict"], string> = { intact: "intact", watch: "on watch", broken: "broken", unknown: "not checked (no data)" };

export function bookCalendar(evals: Evaluation[], origin: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//YouBank//The Book//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:YouBank: the Book"];
  // Minutes since 2026: grows with every download, so an import replaces the copy it has.
  const sequence = Math.max(0, Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60_000));
  const event = (uid: string, date: string, summary: string, description: string, url: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@youbank`, `DTSTAMP:${stamp}`, `SEQUENCE:${sequence}`, `DTSTART;VALUE=DATE:${day(date)}`, `DTEND;VALUE=DATE:${nextDay(date)}`, `SUMMARY:${escapeText(summary)}`, `DESCRIPTION:${escapeText(description)}`, `URL:${url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  };
  const earningsFor = new Set<string>();
  for (const e of evals) {
    const url = `${origin}/app/book?position=${encodeURIComponent(e.positionId)}`;
    const side = `${e.direction === "long" ? "Long" : "Short"} ${e.ticker}${e.weight !== null ? `, ${e.weight}% of NAV` : ""}`;
    const state = `The thesis is ${STATE[e.verdict]}: ${e.summary}`;
    if (e.earnings && e.earnings.inDays >= 0 && !earningsFor.has(e.ticker)) {
      earningsFor.add(e.ticker);
      const bars = (e.nextPrint ?? []).filter((b) => !b.settled).map((b) => b.line);
      event(`book-earnings-${e.ticker}`, e.earnings.date, `${e.ticker} earnings${e.earnings.estimated ? " (estimated)" : ""}`, [side, state, ...(bars.length ? ["What the report must show:", ...bars] : []), url].join("\n"), url);
    }
    for (const c of e.catalysts) {
      if (c.inDays < 0) continue;
      event(`book-${e.positionId}-catalyst-${c.id}`, c.date, `${e.ticker}: ${c.label}`, [side, state, url].join("\n"), url);
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
