/**
 * Calendar checks: pnpm exec tsx scripts/test-calendar.ts
 *
 * The pure parts (iCalendar reading and writing, recurrence with time zones and daylight saving,
 * attendee matching, slot finding, video links) and the four provider adapters against recorded
 * responses in scripts/fixtures/calendar. No network, no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldLine, parseCalendar, parseICal, parseLine, serializeICal, unescapeText, escapeText, parseDuration } from "@/lib/calendar/ical";
import { expandRule, formatRule, parseRule } from "@/lib/calendar/rrule";
import { canonicalZoneName, ianaZone, wallOf, wallToUtc, utcToWall } from "@/lib/calendar/tz";
import { expandCalendar } from "@/lib/calendar/expand";
import { buildEventCalendar, cancelOccurrence, overrideOccurrence, patchEvent } from "@/lib/calendar/ical-write";
import { linkMeeting, normalizeEmail, titleMentions } from "@/lib/calendar/match";
import { findSlots, formatSlot, freeWithin, mergeIntervals } from "@/lib/calendar/slots";
import { findVideoLink, videoProvider } from "@/lib/calendar/video";
import { runAdapterTests } from "./fixtures/calendar/adapters";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const wallIso = (w: number) => new Date(w).toISOString().slice(0, 16);
const H = 3_600_000, DAY = 86_400_000;
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "calendar", name), "utf8");

console.log("iCalendar reading and writing");
{
  const p = parseLine('ATTENDEE;CN="Ruiz, Maya";PARTSTAT=ACCEPTED;X-NOTE="a:b;c":mailto:maya@ledgerline.io');
  ok("quoted parameters keep : ; and ,", p, { name: "ATTENDEE", params: { CN: "Ruiz, Maya", PARTSTAT: "ACCEPTED", "X-NOTE": "a:b;c" }, value: "mailto:maya@ledgerline.io" });
  ok("value may contain colons", parseLine("URL:https://zoom.us/j/123?pwd=x:y")?.value, "https://zoom.us/j/123?pwd=x:y");
  ok("text unescaping", unescapeText("Line one\\nLine two\\, with comma\\; semi \\\\ slash"), "Line one\nLine two, with comma; semi \\ slash");
  ok("text escaping inverts", unescapeText(escapeText("a,b;c\\d\ne")), "a,b;c\\d\ne");
  const folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A very long\r\n  summary that was folded\r\nDESCRIPTION:tab\r\n\tfolded\nEND:VEVENT\r\nEND:VCALENDAR";
  const cal = parseCalendar(folded);
  ok("unfolds space and tab continuations, bare LF", [cal.components[0].props[0].value, cal.components[0].props[1].value], ["A very long summary that was folded", "tabfolded"]);
  const long = `DESCRIPTION:${"Überprüfung der Bewertung ".repeat(8)}`;
  const f = foldLine(long);
  ok("folded lines are at most 75 octets", f.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75), true);
  ok("folding never splits a UTF-8 character", f.includes("�"), false);
  ok("folding round-trips", parseLine(f.replace(/\r\n /g, ""))?.value, long.slice("DESCRIPTION:".length));
  const text = fixture("recurring.ics");
  const once = parseICal(text);
  const twice = parseICal(serializeICal(once[0]));
  ok("parse → serialize → parse is stable", JSON.stringify(twice), JSON.stringify(once));
  ok("serializer writes CRLF", serializeICal(once[0]).includes("\r\nEND:VCALENDAR\r\n"), true);
  ok("durations", [parseDuration("PT1H30M"), parseDuration("-P1D"), parseDuration("P2W"), parseDuration("P")], [5_400_000, -DAY, 14 * DAY, null]);
  ok("truncated file still reads", parseICal("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:cut off").length, 1);
}

console.log("\nRecurrence rules");
{
  const ex = (rule: string, start: number, to = wallOf(2030, 1, 1), from = start) => expandRule(parseRule(rule)!, start, { from, to, until: null }).map(wallIso);
  ok("DAILY;COUNT=3", ex("FREQ=DAILY;COUNT=3", wallOf(2026, 10, 5, 9)), ["2026-10-05T09:00", "2026-10-06T09:00", "2026-10-07T09:00"]);
  ok("WEEKLY;BYDAY=MO,WE,FR;COUNT=5", ex("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5", wallOf(2026, 10, 5, 9)), ["2026-10-05T09:00", "2026-10-07T09:00", "2026-10-09T09:00", "2026-10-12T09:00", "2026-10-14T09:00"]);
  ok("every other week (INTERVAL=2)", ex("FREQ=WEEKLY;INTERVAL=2;COUNT=3", wallOf(2026, 10, 6, 15)), ["2026-10-06T15:00", "2026-10-20T15:00", "2026-11-03T15:00"]);
  ok("last Friday of the month", ex("FREQ=MONTHLY;BYDAY=-1FR;COUNT=3", wallOf(2026, 10, 30, 16)), ["2026-10-30T16:00", "2026-11-27T16:00", "2026-12-25T16:00"]);
  ok("the 31st skips short months", ex("FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3", wallOf(2026, 10, 31, 9)), ["2026-10-31T09:00", "2026-12-31T09:00", "2027-01-31T09:00"]);
  ok("last weekday of the month (BYSETPOS=-1)", ex("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3", wallOf(2026, 10, 30, 9)), ["2026-10-30T09:00", "2026-11-30T09:00", "2026-12-31T09:00"]);
  ok("YEARLY first Sunday of November", ex("FREQ=YEARLY;BYMONTH=11;BYDAY=1SU;COUNT=3", wallOf(2026, 11, 1, 2)), ["2026-11-01T02:00", "2027-11-07T02:00", "2028-11-05T02:00"]);
  ok("YEARLY by week number", ex("FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO;COUNT=2", wallOf(2026, 5, 11, 9)), ["2026-05-11T09:00", "2027-05-17T09:00"]);
  ok("UNTIL is inclusive", expandRule(parseRule("FREQ=DAILY")!, wallOf(2026, 10, 5, 9), { from: 0, to: wallOf(2027, 1, 1), until: wallOf(2026, 10, 7, 9) }).map(wallIso), ["2026-10-05T09:00", "2026-10-06T09:00", "2026-10-07T09:00"]);
  ok("DTSTART counts even off-rule", ex("FREQ=WEEKLY;BYDAY=TU;COUNT=2", wallOf(2026, 10, 5, 9)), ["2026-10-05T09:00", "2026-10-06T09:00"]);
  const full = ex("FREQ=WEEKLY;BYDAY=TU,TH", wallOf(2024, 1, 2, 9), wallOf(2026, 12, 31)).filter((w) => w >= "2026-10-01");
  const skipped = ex("FREQ=WEEKLY;BYDAY=TU,TH", wallOf(2024, 1, 2, 9), wallOf(2026, 12, 31), wallOf(2026, 10, 1));
  ok("jumping to the window matches full expansion", skipped, full);
  ok("an impossible rule ends", ex("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", wallOf(2026, 1, 1, 9)), ["2026-01-01T09:00"]);
  ok("format round-trips", formatRule(parseRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1FR;WKST=SU;COUNT=4")!), "FREQ=MONTHLY;INTERVAL=2;COUNT=4;BYDAY=2TU,-1FR;WKST=SU");
}

console.log("\nTime zones and daylight saving");
{
  const ny = ianaZone("America/New_York")!;
  ok("NY: 09:00 EDT is 13:00Z", iso(wallToUtc(ny, wallOf(2026, 10, 26, 9))), "2026-10-26T13:00:00Z");
  ok("NY: 09:00 EST is 14:00Z", iso(wallToUtc(ny, wallOf(2026, 11, 2, 9))), "2026-11-02T14:00:00Z");
  ok("a skipped time (02:30 on spring-forward) lands an hour later", iso(wallToUtc(ny, wallOf(2026, 3, 8, 2, 30))), "2026-03-08T07:30:00Z");
  ok("a repeated time (01:30 on fall-back) is the first one", iso(wallToUtc(ny, wallOf(2026, 11, 1, 1, 30))), "2026-11-01T05:30:00Z");
  ok("utcToWall inverts", wallIso(utcToWall(ny, Date.parse("2026-11-02T14:00:00Z"))), "2026-11-02T09:00");
  ok("Windows zone names", canonicalZoneName("Pacific Standard Time"), "America/Los_Angeles");
  ok("Mozilla-style prefixed names", canonicalZoneName("/mozilla.org/20050126_1/Europe/Berlin"), "Europe/Berlin");

  const win = { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-30T00:00:00Z") };
  const inst = expandCalendar(fixture("recurring.ics"), win);
  const weekly = inst.filter((i) => i.uid === "weekly-ny@test").map((i) => iso(i.start));
  ok("weekly 09:00 New York holds 09:00 across the November change", weekly.slice(3, 6), ["2026-10-26T13:00:00Z", "2026-11-09T14:00:00Z", "2026-11-16T14:00:00Z"]);
  ok("EXDATE removes 2 Nov", weekly.includes("2026-11-02T14:00:00Z"), false);
  const moved = inst.find((i) => i.uid === "weekly-ny@test" && i.recurrenceId === "2026-10-19T13:00:00.000Z");
  ok("RECURRENCE-ID override moves 19 Oct to 20 Oct 11:00", moved && [iso(moved.start), moved.summary], ["2026-10-20T15:00:00Z", "Weekly pipeline (moved)"]);
  ok("…and the original slot is gone", weekly.includes("2026-10-19T13:00:00Z"), false);
  const custom = inst.filter((i) => i.uid === "custom-tz@test").map((i) => iso(i.start));
  ok("a custom VTIMEZONE follows its own rules across DST", custom.slice(0, 2), ["2026-10-29T13:00:00Z", "2026-11-05T14:00:00Z"]);
  const london = inst.filter((i) => i.uid === "london-daily@test").map((i) => iso(i.start));
  ok("Europe/London across the October change", london, ["2026-10-23T07:30:00Z", "2026-10-24T07:30:00Z", "2026-10-25T08:30:00Z", "2026-10-26T08:30:00Z"]);
  const allDay = inst.find((i) => i.uid === "offsite@test");
  ok("all-day events keep their dates", allDay && [iso(allDay.start), iso(allDay.end), allDay.allDay], ["2026-10-14T00:00:00Z", "2026-10-16T00:00:00Z", true]);
  const floating = inst.find((i) => i.uid === "floating@test");
  ok("floating times use X-WR-TIMEZONE", floating && iso(floating.start), "2026-10-08T16:00:00Z");
  const dur = inst.find((i) => i.uid === "duration@test");
  ok("DURATION instead of DTEND", dur && (dur.end - dur.start) / 60_000, 45);
  ok("cancelled occurrences are dropped", inst.some((i) => i.uid === "weekly-ny@test" && i.recurrenceId === "2026-11-23T14:00:00.000Z"), false);
  ok("windows TZID event", iso(inst.find((i) => i.uid === "outlook@test")!.start), "2026-10-12T17:00:00Z");
  ok("video link from the description", inst.find((i) => i.uid === "weekly-ny@test")!.videoUrl, "https://acme.zoom.us/j/81234567890?pwd=abc");
  ok("attendees and organizer", inst.find((i) => i.uid === "outlook@test")!.attendees.map((a) => [a.email, a.name, a.response]), [["maya@ledgerline.io", "Ruiz, Maya", "accepted"], ["sam@youbank.test", "Sam", "needsAction"]]);
}

console.log("\nWriting and editing events");
{
  const start = new Date("2026-10-20T15:00:00Z"), end = new Date("2026-10-20T15:30:00Z");
  const { uid, calendar } = buildEventCalendar({ title: "Intro, Ledgerline; diligence", start, end, timezone: "America/New_York", attendees: [{ email: "Maya@Ledgerline.io", name: "Maya Ruiz" }], videoUrl: "https://meet.google.com/abc-defg-hij" }, { organizer: { email: "me@youbank.test", name: "Me" }, now: Date.parse("2026-10-05T12:00:00Z") });
  const text = serializeICal(calendar);
  const back = expandCalendar(text, { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-01T00:00:00Z") });
  ok("a built event reads back", back.map((b) => [b.uid === uid, b.summary, iso(b.start), iso(b.end), b.videoUrl, b.attendees.map((a) => a.email), b.organizer?.email]), [[true, "Intro, Ledgerline; diligence", "2026-10-20T15:00:00Z", "2026-10-20T15:30:00Z", "https://meet.google.com/abc-defg-hij", ["maya@ledgerline.io"], "me@youbank.test"]]);

  const series = parseCalendar(fixture("recurring.ics"));
  cancelOccurrence(series, "weekly-ny@test", "2026-10-26T13:00:00.000Z");
  const master = series.components.find((c) => c.name === "VEVENT" && c.props.some((p) => p.name === "UID" && p.value === "weekly-ny@test") && !c.props.some((p) => p.name === "RECURRENCE-ID"))!;
  ok("EXDATE written in the series' own zone", master.props.filter((p) => p.name === "EXDATE").map((p) => [p.params.TZID, p.value]).pop(), ["America/New_York", "20261026T090000"]);
  overrideOccurrence(series, "weekly-ny@test", "2026-11-09T14:00:00.000Z", { start: new Date("2026-11-10T16:00:00Z"), end: new Date("2026-11-10T16:30:00Z") });
  const after = expandCalendar(serializeICal(series), { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-30T00:00:00Z") }).filter((i) => i.uid === "weekly-ny@test").map((i) => iso(i.start));
  ok("cancelled occurrence is gone after the edit", after.includes("2026-10-26T13:00:00Z"), false);
  ok("override moves the 9 Nov occurrence", [after.includes("2026-11-09T14:00:00Z"), after.includes("2026-11-10T16:00:00Z")], [false, true]);
  const one = parseCalendar(text);
  patchEvent(one, uid, { title: "Renamed", start: new Date("2026-10-21T15:00:00Z"), end: new Date("2026-10-21T16:00:00Z") });
  const moved = expandCalendar(serializeICal(one), { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-01T00:00:00Z") })[0];
  ok("patching a one-off event", [moved.summary, iso(moved.start), moved.sequence], ["Renamed", "2026-10-21T15:00:00Z", 1]);
}

console.log("\nLinking attendees to Relationships");
{
  ok("Gmail dots and +tags normalise", [normalizeEmail("Maya.Ruiz+cal@GoogleMail.com"), normalizeEmail("bob+x@acme.io")], ["mayaruiz@gmail.com", "bob@acme.io"]);
  const contacts = [
    { id: 1, email: "maya@ledgerline.io", name: "Maya", company: "Ledgerline", domain: "ledgerline.io" },
    { id: 2, email: "mayaruiz@gmail.com", name: "Maya personal", company: "", domain: "" },
    { id: 3, email: "cfo@northwind.com", name: "Pat", company: "Northwind", domain: "northwind.com" },
  ];
  const deals = [{ id: 10, name: "Ledgerline", contactId: 1, status: "open" }, { id: 11, name: "Northwind Holdings", contactId: 3, status: "open" }, { id: 12, name: "Old deal", contactId: 1, status: "lost" }, { id: 13, name: "Acme", contactId: null, status: "open" }];
  const links = linkMeeting({
    title: "Diligence call",
    organizer: { email: "me@youbank.test", name: "Me", response: "accepted", organizer: true },
    attendees: [
      { email: "Maya.Ruiz+work@gmail.com", name: "", response: "accepted" },
      { email: "ceo@northwind.com", name: "Lee", response: "needsAction" },
      { email: "colleague@youbank.test", name: "", response: "accepted" },
      { email: "c_123@resource.calendar.google.com", name: "Room 4", response: "accepted" },
    ],
  }, contacts, deals, ["me@youbank.test"]);
  ok("contacts link by exact (normalised) email only", links.contactIds, [2]);
  ok("deals link through the company domain; closed deals do not", links.dealIds, [11]);
  ok("external when someone outside is invited", links.external, true);
  const internal = linkMeeting({ title: "Team sync", organizer: null, attendees: [{ email: "colleague@youbank.test", name: "", response: "accepted" }] }, contacts, deals, ["me@youbank.test"]);
  ok("internal-only meeting", [internal.external, internal.contactIds, internal.dealIds], [false, [], []]);
  ok("deal named in the title", linkMeeting({ title: "Acme <> YouBank: next steps", organizer: null, attendees: [] }, contacts, deals, []).dealIds, [13]);
  ok("short names are not trusted in titles", titleMentions("Co-working session", "Co"), false);
  ok("contact via deal contact", linkMeeting({ title: "x", organizer: null, attendees: [{ email: "maya@ledgerline.io", name: "", response: "" }] }, contacts, deals, []).dealIds, [10]);
}

console.log("\nFinding free times");
{
  const now = Date.parse("2026-10-05T12:00:00Z"); // Monday 08:00 in New York
  const busy = [
    { start: Date.parse("2026-10-05T13:00:00Z"), end: Date.parse("2026-10-05T17:00:00Z") }, // 09:00-13:00 ET Mon
    { start: Date.parse("2026-10-06T13:00:00Z"), end: Date.parse("2026-10-06T14:00:00Z") }, // 09:00-10:00 ET Tue
  ];
  const slots = findSlots({ busy, from: now, to: now + 7 * DAY, durationMin: 30, timezone: "America/New_York", now, maxSlots: 4 });
  ok("first slots respect busy time and the 10-minute buffer", slots.map((s) => formatSlot(s, "America/New_York")), ["Mon 5 Oct, 13:30–14:00", "Mon 5 Oct, 16:30–17:00", "Tue 6 Oct, 10:30–11:00", "Tue 6 Oct, 13:30–14:00"]);
  ok("never sooner than the minimum notice", slots.every((s) => s.start >= now + 2 * H), true);
  const weekend = findSlots({ busy: [], from: Date.parse("2026-10-10T00:00:00Z"), to: Date.parse("2026-10-12T23:00:00Z"), durationMin: 60, timezone: "Europe/London", now, maxSlots: 1 });
  ok("weekends skipped by default", weekend.map((s) => formatSlot(s, "Europe/London")), ["Mon 12 Oct, 09:00–10:00"]);
  const dst = findSlots({ busy: [], from: Date.parse("2026-11-02T00:00:00Z"), to: Date.parse("2026-11-03T00:00:00Z"), durationMin: 30, timezone: "America/New_York", now, maxSlots: 1 });
  ok("09:00 local after the clocks change is 14:00Z", dst.map((s) => iso(s.start)), ["2026-11-02T14:00:00Z"]);
  ok("merge intervals", mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 2, end: 6 }]), [{ start: 1, end: 8 }]);
  ok("free gaps", freeWithin({ start: 0, end: 10 }, [{ start: 2, end: 4 }, { start: 3, end: 6 }]), [{ start: 0, end: 2 }, { start: 6, end: 10 }]);
}

console.log("\nVideo links");
{
  ok("Zoom in a description, trailing punctuation dropped", findVideoLink("Join here: https://acme.zoom.us/j/81234567890?pwd=abc."), "https://acme.zoom.us/j/81234567890?pwd=abc");
  ok("Teams link", videoProvider(findVideoLink("", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=y")), "Microsoft Teams");
  ok("Meet code", findVideoLink("meet.google.com/abc-defg-hij is the room, https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  ok("no link", findVideoLink("Board room, 3rd floor"), "");
}

console.log("\nProvider adapters against recorded responses");
void runAdapterTests(ok).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, (e) => {
  console.log(`  FAIL adapters threw: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
