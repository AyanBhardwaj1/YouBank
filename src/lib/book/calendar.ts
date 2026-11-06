/**
 * The Book's dates as a calendar file (iCalendar, RFC 5545) for Outlook, Google Calendar or Apple Calendar:
 * each position's next earnings date and its catalysts, as all-day events, with the thesis's state, what the
 * next report must show and a link back to the position. Pure; tested in scripts/test-book.ts.
 */
import type { Evaluation } from "./position";

/** Text as iCalendar wants it: backslash, semicolon, comma and newlines escaped. */
export const icsText = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets folded (a CRLF and a space), never inside a UTF-8 character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const day = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso: string) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
const STATE: Record<Evaluation["verdict"], string> = { intact: "intact", watch: "on watch", broken: "broken", unknown: "not checked (no data)" };

export function bookCalendar(evals: Evaluation[], origin: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//YouBank//The Book//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:YouBank: the Book"];
  const event = (uid: string, date: string, summary: string, description: string, url: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@youbank`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(date)}`, `DTEND;VALUE=DATE:${nextDay(date)}`, `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(description)}`, `URL:${url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  };
  for (const e of evals) {
    const url = `${origin}/app/book?position=${encodeURIComponent(e.positionId)}`;
    const side = `${e.direction === "long" ? "Long" : "Short"} ${e.ticker}${e.weight !== null ? `, ${e.weight}% of NAV` : ""}`;
    const state = `The thesis is ${STATE[e.verdict]}: ${e.summary}`;
    if (e.earnings && e.earnings.inDays >= 0) {
      const bars = (e.nextPrint ?? []).filter((b) => !b.settled).map((b) => b.line);
      event(`book-${e.positionId}-earnings-${e.earnings.date}`, e.earnings.date, `${e.ticker} earnings${e.earnings.estimated ? " (estimated)" : ""}`, [side, state, ...(bars.length ? ["What the report must show:", ...bars] : []), url].join("\n"), url);
    }
    for (const c of e.catalysts) {
      if (c.inDays < 0) continue;
      event(`book-${e.positionId}-catalyst-${c.id}-${c.date}`, c.date, `${e.ticker}: ${c.label}`, [side, state, url].join("\n"), url);
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
