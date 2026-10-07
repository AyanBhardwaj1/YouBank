/**
 * The provider adapters against recorded responses. Each adapter gets a `fetch` that answers from the
 * files in this folder, shaped as the providers document them (Google Calendar v3, Microsoft Graph
 * v1.0, iCloud's CalDAV server, a plain .ics feed), and records every request so the tests can check
 * what would have been sent: methods, headers, query strings and bodies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "@/lib/calendar/provider";
import { ProviderError } from "@/lib/calendar/provider";
import { GoogleCalendar, googleAuthUrl } from "@/lib/calendar/providers/google";
import { MicrosoftCalendar } from "@/lib/calendar/providers/microsoft";
import { CalDavCalendar, parseMultistatus } from "@/lib/calendar/providers/caldav";
import { IcsCalendar, normalizeFeedUrl } from "@/lib/calendar/providers/ics";
import { isPrivateAddress } from "@/lib/calendar/net";
import { parseCalendar, propsOf } from "@/lib/calendar/ical";

type Ok = (label: string, got: unknown, want: unknown) => void;
type Call = { method: string; url: string; headers: Record<string, string>; body: string };
type Route = { method?: string; test: (url: string, call: Call) => boolean; status?: number; file?: string; text?: string; headers?: Record<string, string> };

const dir = __dirname;
const file = (name: string) => readFileSync(join(dir, name), "utf8");
const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

/** A fetch that replays `routes` in order of first match, recording each call. */
function replay(routes: Route[]): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f: Fetch = async (url, init = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
    const call: Call = { method: (init.method ?? "GET").toUpperCase(), url, headers, body: typeof init.body === "string" ? init.body : "" };
    calls.push(call);
    const r = routes.find((x) => (!x.method || x.method === call.method) && x.test(url, call));
    if (!r) return new Response(`no fixture for ${call.method} ${url}`, { status: 599 });
    const body = r.file ? file(r.file) : r.text ?? "";
    return new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { fetch: f, calls };
}

const token = async () => "test-token";
const WINDOW = { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-01T00:00:00Z") };

export async function runAdapterTests(ok: Ok): Promise<void> {
  /* ---------------- Google ---------------- */
  {
    const { fetch, calls } = replay([
      { method: "GET", test: (u) => u.includes("/users/me/calendarList"), file: "google-calendarList.json" },
      { method: "GET", test: (u) => u.includes("/events?") && u.includes("syncToken=STALE"), status: 410, file: "google-410.json" },
      { method: "GET", test: (u) => u.includes("/events?") && u.includes("syncToken="), file: "google-events-incremental.json" },
      { method: "GET", test: (u) => u.includes("/events?") && u.includes("pageToken="), file: "google-events-page2.json" },
      { method: "GET", test: (u) => u.includes("/events?"), file: "google-events-page1.json" },
      { method: "POST", test: (u) => u.includes("/freeBusy"), file: "google-freebusy.json" },
      { method: "POST", test: (u) => u.includes("/events?"), text: JSON.stringify({ id: "created1", status: "confirmed", summary: "Intro", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T15:30:00Z" }, iCalUID: "created1@google.com", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/new-meet-abc" }] } }) },
      { method: "PATCH", test: () => true, text: JSON.stringify({ id: "4pgdvobc55pna", status: "confirmed", summary: "Ledgerline diligence", start: { dateTime: "2026-10-12T15:00:00Z" }, end: { dateTime: "2026-10-12T15:45:00Z" } }) },
      { method: "DELETE", test: () => true, status: 204 },
    ]);
    const g = new GoogleCalendar(token, fetch);
    const cals = await g.listCalendars();
    ok("google: calendars (free/busy-only ones left out)", cals.map((c) => [c.remoteId, c.name, c.canWrite, c.primary]), [["me@youbank.test", "me@youbank.test", true, true], ["team_abc@group.calendar.google.com", "Deal team (shared)", true, false], ["en.usa#holiday@group.v.calendar.google.com", "Holidays in United States", false, false]]);
    const cal = { remoteId: "me@youbank.test", timezone: "America/New_York" };
    const full = await g.listEvents(cal, WINDOW, null);
    ok("google: full read follows pages and keeps the sync token", [full.full, full.nextToken, full.upserts.length], [true, "CPDAlvWDx70CEPDAlvWDx70CGAU=", 3]);
    ok("google: full read asks for expanded instances in the window", calls.filter((c) => c.url.includes("/events?"))[0].url.includes(`singleEvents=true&maxResults=250&timeMin=${encodeURIComponent("2026-10-01T00:00:00.000Z")}`), true);
    const e1 = full.upserts[0];
    ok("google: event fields", [e1.title, iso(e1.start), iso(e1.end), e1.videoUrl, e1.organizer?.email, e1.attendees.map((a) => [a.email, a.response, !!a.self])], ["Ledgerline diligence", "2026-10-12T14:00:00Z", "2026-10-12T14:45:00Z", "https://meet.google.com/abc-defg-hij", "me@youbank.test", [["me@youbank.test", "accepted", true], ["maya@ledgerline.io", "tentative", false]]]);
    ok("google: series instance keeps its series and original start", [full.upserts[1].seriesId, full.upserts[1].recurrenceId], ["weekly123", "2026-10-13T13:00:00.000Z"]);
    ok("google: all-day and free", [full.upserts[2].allDay, iso(full.upserts[2].start), full.upserts[2].busy], [true, "2026-10-14T00:00:00Z", false]);
    const inc = await g.listEvents(cal, WINDOW, "CPDAlvWDx70CEPDAlvWDx70CGAU=");
    ok("google: incremental read: cancelled instance removed, new event added", [inc.full, inc.removed, inc.upserts.map((e) => [e.title, e.status, e.videoUrl])], [false, ["weekly123_20261013T130000Z"], [["Coffee with Pat", "tentative", "https://acme.zoom.us/j/123456789"]]]);
    ok("google: incremental read sends only the sync token", calls.at(-1)!.url.includes("timeMin"), false);
    const stale = await g.listEvents(cal, WINDOW, "STALE").then(() => null, (e) => e);
    ok("google: 410 means a full read is needed", stale instanceof ProviderError && stale.kind === "gone", true);
    const busy = await g.freeBusy([cal, { remoteId: "team_abc@group.calendar.google.com", timezone: "" }], { start: Date.parse("2026-10-05T00:00:00Z"), end: Date.parse("2026-10-06T00:00:00Z") });
    ok("google: free/busy across calendars", busy.map((b) => [iso(new Date(b.start)), iso(new Date(b.end))]), [["2026-10-05T13:00:00Z", "2026-10-05T14:00:00Z"], ["2026-10-05T15:00:00Z", "2026-10-05T15:30:00Z"]]);
    const created = await g.createEvent(cal, { title: "Intro", start: new Date("2026-10-20T15:00:00Z"), end: new Date("2026-10-20T15:30:00Z"), timezone: "America/New_York", attendees: [{ email: "maya@ledgerline.io", name: "Maya" }], addConference: true }, { sendInvites: true });
    const post = calls.filter((c) => c.method === "POST" && c.url.includes("/events?")).at(-1)!;
    const sent = JSON.parse(post.body) as { attendees: unknown; conferenceData?: { createRequest?: { conferenceSolutionKey?: { type?: string } } }; start: unknown };
    ok("google: create sends invitations and asks for a Meet link", [post.url.includes("sendUpdates=all"), post.url.includes("conferenceDataVersion=1"), sent.conferenceData?.createRequest?.conferenceSolutionKey?.type, sent.attendees, sent.start], [true, true, "hangoutsMeet", [{ email: "maya@ledgerline.io", displayName: "Maya" }], { dateTime: "2026-10-20T15:00:00.000Z", timeZone: "America/New_York" }]);
    ok("google: created event carries the new Meet link", created.videoUrl, "https://meet.google.com/new-meet-abc");
    await g.updateEvent(cal, { remoteId: "4pgdvobc55pna", icalUid: "", recurrenceId: null, seriesId: null, etag: "", href: "" }, { start: new Date("2026-10-12T15:00:00Z"), end: new Date("2026-10-12T15:45:00Z") }, { sendInvites: false, scope: "instance" });
    const patch = calls.filter((c) => c.method === "PATCH").at(-1)!;
    ok("google: reschedule without notifying", [patch.url.endsWith("/events/4pgdvobc55pna?sendUpdates=none"), JSON.parse(patch.body).start.dateTime], [true, "2026-10-12T15:00:00.000Z"]);
    await g.deleteEvent(cal, { remoteId: "weekly123_20261013T130000Z", icalUid: "", recurrenceId: "x", seriesId: "weekly123", etag: "", href: "" }, { sendInvites: true, scope: "series" });
    ok("google: cancelling a series deletes the series with notifications", calls.at(-1)!.url.endsWith("/events/weekly123?sendUpdates=all"), true);
    ok("google: auth URL asks for offline access and calendar scopes", ["access_type=offline", "calendar.events", "calendar.readonly", "state=abc"].every((s) => googleAuthUrl({ clientId: "id", clientSecret: "s", redirectUri: "https://x/cb" }, "abc").includes(s)), true);
    ok("google: every call carries the bearer token", calls.every((c) => c.headers.authorization === "Bearer test-token"), true);
  }

  /* ---------------- Microsoft ---------------- */
  {
    const { fetch, calls } = replay([
      { method: "GET", test: (u) => u.endsWith("/me/calendars?$top=100"), file: "microsoft-calendars.json" },
      { method: "GET", test: (u) => u.includes("$deltatoken=R0usmci39OQxqJrxK4"), file: "microsoft-delta-incremental.json" },
      { method: "GET", test: (u) => u.includes("$skiptoken="), file: "microsoft-delta-page2.json" },
      { method: "GET", test: (u) => u.includes("/calendarView/delta?startDateTime="), file: "microsoft-delta-page1.json" },
      { method: "POST", test: (u) => u.endsWith("/me/calendar/getSchedule"), file: "microsoft-schedule.json" },
      { method: "POST", test: (u) => u.endsWith("/cancel"), status: 202 },
      { method: "POST", test: (u) => u.includes("/events"), text: JSON.stringify({ id: "NEW1", subject: "Intro", start: { dateTime: "2026-10-20T15:00:00.0000000" }, end: { dateTime: "2026-10-20T15:30:00.0000000" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3anew" } }) },
      { method: "POST", test: (u) => u.endsWith("/subscriptions"), text: JSON.stringify({ id: "sub-1", expirationDateTime: "2026-10-08T10:00:00Z" }) },
    ]);
    const m = new MicrosoftCalendar(token, fetch, "me@youbank.test");
    const cals = await m.listCalendars();
    ok("microsoft: calendars", cals.map((c) => [c.name, c.canWrite, c.primary, c.color]), [["Calendar", true, true, "#e74856"], ["United States holidays", false, false, ""]]);
    const cal = { remoteId: "AAMkAGI2TGuLAAA=", timezone: "" };
    const full = await m.listEvents(cal, WINDOW, null);
    ok("microsoft: delta follows nextLink to the deltaLink; series masters skipped", [full.nextToken, full.upserts.map((e) => e.remoteId)], ["https://graph.microsoft.com/v1.0/me/calendars/AAMkAGI2TGuLAAA=/calendarView/delta?$deltatoken=R0usmci39OQxqJrxK4", ["AAMkAGI2TGuLAAA=EVT1", "AAMkAGI2TGuLAAA=OCC1", "AAMkAGI2TGuLAAA=DAY1"]]);
    const e = full.upserts[0];
    ok("microsoft: UTC times, Teams link, HTML body as text", [iso(e.start), iso(e.end), e.videoUrl.startsWith("https://teams.microsoft.com/l/meetup-join/"), e.description.startsWith("Prep for the board.")], ["2026-10-12T17:00:00Z", "2026-10-12T18:00:00Z", true, true]);
    ok("microsoft: attendees (rooms dropped), responses mapped", e.attendees.map((a) => [a.email, a.response, !!a.optional]), [["me@youbank.test", "accepted", false], ["ceo@northwind.com", "needsAction", true]]);
    ok("microsoft: occurrence keeps series and tentative status", [full.upserts[1].seriesId, full.upserts[1].status, full.upserts[1].recurrenceId], ["AAMkAGI2TGuLAAA=SERIES", "tentative", "2026-10-13T14:00:00.000Z"]);
    ok("microsoft: all-day read as dates", [full.upserts[2].allDay, iso(full.upserts[2].start), iso(full.upserts[2].end)], [true, "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"]);
    ok("microsoft: asks Graph for UTC", calls.find((c) => c.url.includes("delta"))?.headers.prefer?.includes('outlook.timezone="UTC"'), true);
    const inc = await m.listEvents(cal, WINDOW, full.nextToken);
    ok("microsoft: incremental: @removed and a free hold", [inc.removed, inc.upserts.map((x) => [x.title, x.busy]), inc.nextToken?.endsWith("NEXT2")], [["AAMkAGI2TGuLAAA=EVT1"], [["Free time hold", false]], true]);
    const busy = await m.freeBusy([cal], { start: Date.parse("2026-10-05T00:00:00Z"), end: Date.parse("2026-10-06T00:00:00Z") });
    ok("microsoft: getSchedule, free items ignored", busy.map((b) => iso(new Date(b.start))), ["2026-10-05T13:00:00Z"]);
    const created = await m.createEvent(cal, { title: "Intro", start: new Date("2026-10-20T15:00:00Z"), end: new Date("2026-10-20T15:30:00Z"), timezone: "UTC", attendees: [{ email: "pat@northwind.com" }], addConference: true });
    const body = JSON.parse(calls.filter((c) => c.method === "POST" && c.url.endsWith("/events")).at(-1)!.body);
    ok("microsoft: create asks for Teams with UTC times", [body.isOnlineMeeting, body.onlineMeetingProvider, body.start, body.attendees], [true, "teamsForBusiness", { dateTime: "2026-10-20T15:00:00.000", timeZone: "UTC" }, [{ emailAddress: { address: "pat@northwind.com" }, type: "required" }]]);
    ok("microsoft: created event's Teams link", created.videoUrl, "https://teams.microsoft.com/l/meetup-join/19%3anew");
    await m.deleteEvent(cal, { remoteId: "AAMkAGI2TGuLAAA=EVT1", icalUid: "", recurrenceId: null, seriesId: null, etag: "", href: "" }, { sendInvites: true, scope: "instance" });
    ok("microsoft: cancel with notice uses /cancel", calls.at(-1)!.url.endsWith("/me/events/AAMkAGI2TGuLAAA%3DEVT1/cancel"), true);
    const ch = await m.watch(cal, "https://app.example/api/calendar/webhooks/microsoft", "secret-1");
    const sub = JSON.parse(calls.at(-1)!.body);
    ok("microsoft: subscription carries clientState and the calendar's events", [ch.id, sub.clientState, sub.resource, sub.changeType], ["sub-1", "secret-1", "me/calendars/AAMkAGI2TGuLAAA=/events", "created,updated,deleted"]);
  }

  /* ---------------- CalDAV (iCloud) ---------------- */
  {
    const HOME = "https://p42-caldav.icloud.com/123456789/calendars/"; // the :443 in the response is normalised away
    const CAL = "https://p42-caldav.icloud.com/123456789/calendars/home/";
    const resource = file("caldav-multiget.xml").match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1];
    const { fetch, calls } = replay([
      { method: "PROPFIND", test: (u) => u === "https://caldav.icloud.com/", status: 207, file: "caldav-principal.xml" },
      { method: "PROPFIND", test: (u) => u.endsWith("/principal/"), status: 207, file: "caldav-home.xml" },
      { method: "PROPFIND", test: (u, c) => u === HOME && c.headers.depth === "1", status: 207, file: "caldav-calendars.xml" },
      { method: "PROPFIND", test: (u, c) => u === CAL && c.body.includes("sync-token"), status: 207, file: "caldav-synctoken.xml" },
      { method: "REPORT", test: (u, c) => c.body.includes("calendar-query"), status: 207, file: "caldav-query.xml" },
      { method: "REPORT", test: (u, c) => c.body.includes("sync-collection") && c.body.includes("EXPIRED"), status: 403, text: '<error xmlns="DAV:"><valid-sync-token/></error>' },
      { method: "REPORT", test: (u, c) => c.body.includes("sync-collection"), status: 207, file: "caldav-sync-collection.xml" },
      { method: "REPORT", test: (u, c) => c.body.includes("calendar-multiget"), status: 207, file: "caldav-multiget.xml" },
      { method: "GET", test: (u) => u.endsWith("/weekly.ics"), text: resource, headers: { etag: '"C=103@U=abc"' } },
      { method: "PUT", test: (u, c) => c.headers["if-match"] === '"stale"', status: 412 },
      { method: "PUT", test: () => true, status: 201, headers: { etag: '"C=200@U=abc"' } },
      { method: "DELETE", test: () => true, status: 204 },
    ]);
    const dav = new CalDavCalendar({ serverUrl: "https://caldav.icloud.com/", username: "me@icloud.com", password: "abcd-efgh-ijkl-mnop" }, fetch);
    const home = await dav.discoverHome();
    ok("caldav: discovery finds the home on another host and the address", home, { homeUrl: HOME, email: "me@icloud.com" });
    const cals = await dav.listCalendars();
    ok("caldav: event calendars only, with colour, zone and privileges", cals.map((c) => [c.remoteId, c.name, c.color, c.canWrite, c.timezone]), [[CAL, "Home", "#1BADF8", true, ""], ["https://p42-caldav.icloud.com/123456789/calendars/shared-board/", "Board & investors", "#CC73E1", false, "Europe/London"]]);
    ok("caldav: basic auth on every request", calls.every((c) => c.headers.authorization === `Basic ${Buffer.from("me@icloud.com:abcd-efgh-ijkl-mnop").toString("base64")}`), true);
    const cal = { remoteId: CAL, timezone: "Europe/London" };
    const full = await dav.listEvents(cal, WINDOW, null);
    ok("caldav: full read takes the sync token first, then a time-range query", [full.full, full.nextToken, calls.at(-1)!.body.includes('<c:time-range start="20261001T000000Z" end="20261101T000000Z"/>')], [true, "HwoQEgwAAAh4Z2Y6AAAAAA==", true]);
    ok("caldav: series expanded with its override, across the October change", full.upserts.filter((e) => e.icalUid === "weekly@icloud").map((e) => [iso(e.start), e.title]), [["2026-10-05T08:00:00Z", "Monday stand-up"], ["2026-10-12T09:00:00Z", "Monday stand-up (late)"], ["2026-10-19T08:00:00Z", "Monday stand-up"], ["2026-10-26T09:00:00Z", "Monday stand-up"]]);
    const one = full.upserts.find((e) => e.icalUid === "one-off@icloud")!;
    ok("caldav: one-off event with href, etag, escaped location", [one.href, one.etag, one.location, one.attendees[0]?.email], ["https://p42-caldav.icloud.com/123456789/calendars/home/one-off.ics", '"C=101@U=abc"', "Monmouth, Borough Market", "maya@ledgerline.io"]);
    ok("caldav: group is the resource", new Set(full.upserts.filter((e) => e.icalUid === "weekly@icloud").map((e) => e.group)).size, 1);
    const inc = await dav.listEvents(cal, WINDOW, "HwoQEgwAAAh4Z2Y6AAAAAA==");
    ok("caldav: sync-collection: changed resource re-read, deleted one replaced with nothing", [inc.full, inc.replacedGroups.map((h) => h.split("/").pop()), inc.upserts.map((e) => iso(e.start)), inc.nextToken], [false, ["weekly.ics", "one-off.ics"], ["2026-10-05T08:00:00Z", "2026-10-12T08:00:00Z", "2026-10-26T09:00:00Z"], "HwoQEgwAAAh4Z2Y6AAAAAQ=="]);
    const expired = await dav.listEvents(cal, WINDOW, "EXPIRED").then(() => null, (e) => e);
    ok("caldav: an invalid sync token asks for a full read", expired instanceof ProviderError && expired.kind === "gone", true);

    await dav.createEvent(cal, { title: "Intro", start: new Date("2026-10-20T15:00:00Z"), end: new Date("2026-10-20T15:30:00Z"), timezone: "Europe/London", attendees: [{ email: "maya@ledgerline.io" }] }, { sendInvites: false, organizerEmail: "me@icloud.com" });
    const put = calls.filter((c) => c.method === "PUT").at(-1)!;
    ok("caldav: create PUTs a new .ics with If-None-Match: *", [put.url.startsWith(CAL) && put.url.endsWith("_youbank.ics"), put.headers["if-none-match"], put.headers["content-type"]], [true, "*", "text/calendar; charset=utf-8"]);
    const putCal = parseCalendar(put.body).components[0];
    ok("caldav: no invitations means SCHEDULE-AGENT=CLIENT", propsOf(putCal, "ATTENDEE").map((p) => [p.value, p.params["SCHEDULE-AGENT"]]), [["mailto:maya@ledgerline.io", "CLIENT"]]);

    const ref = { remoteId: "weekly@icloud#2026-10-12T08:00:00.000Z", icalUid: "weekly@icloud", recurrenceId: "2026-10-12T08:00:00.000Z", seriesId: "weekly@icloud", etag: '"C=103@U=abc"', href: `${CAL}weekly.ics` };
    await dav.deleteEvent(cal, ref, { sendInvites: true, scope: "instance" });
    const cancelPut = calls.filter((c) => c.method === "PUT").at(-1)!;
    ok("caldav: cancelling one occurrence adds an EXDATE in the series' zone, If-Match the etag", [cancelPut.headers["if-match"], propsOf(parseCalendar(cancelPut.body).components[0], "EXDATE").map((p) => [p.params.TZID, p.value])], ['"C=103@U=abc"', [["Europe/London", "20261019T090000"], ["Europe/London", "20261012T090000"]]]);
    const conflict = await dav.updateEvent(cal, { ...ref, etag: '"stale"' }, { start: new Date("2026-10-12T10:00:00Z"), end: new Date("2026-10-12T10:30:00Z") }, { sendInvites: true, scope: "instance" }).then(() => null, (e) => e);
    ok("caldav: an edit made elsewhere is refused, not overwritten (412)", conflict instanceof ProviderError && conflict.kind === "conflict", true);
    await dav.deleteEvent(cal, { ...ref, recurrenceId: null, seriesId: null }, { sendInvites: false, scope: "series" });
    ok("caldav: deleting the whole resource", [calls.at(-1)!.method, calls.at(-1)!.url], ["DELETE", `${CAL}weekly.ics`]);
    const ms = parseMultistatus('<d:multistatus xmlns:d="DAV:"><d:response><d:href>a%20b.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response></d:multistatus>', CAL);
    ok("caldav: multistatus hrefs resolve against the request", ms.responses.map((r) => [r.href, r.status]), [[`${CAL}a%20b.ics`, "HTTP/1.1 404 Not Found"]]);
  }

  /* ---------------- ICS subscription ---------------- */
  {
    const feed = file("recurring.ics");
    const { fetch, calls } = replay([
      { method: "GET", test: (u, c) => c.headers["if-none-match"] === '"v1"', status: 304 },
      { method: "GET", test: () => true, text: feed, headers: { etag: '"v1"', "content-type": "text/calendar" } },
    ]);
    const ics = new IcsCalendar("webcal://calendar.example.com/team.ics", fetch);
    ok("ics: webcal becomes https", normalizeFeedUrl("webcal://calendar.example.com/team.ics"), "https://calendar.example.com/team.ics");
    const [c] = await ics.listCalendars();
    ok("ics: one read-only calendar named from the feed's zone", [c.canWrite, c.timezone, c.name], [false, "America/New_York", "calendar.example.com"]);
    const first = await ics.listEvents({ remoteId: c.remoteId, timezone: c.timezone }, WINDOW, null);
    ok("ics: full read, ETag kept for next time", [first.full, first.nextToken, first.upserts.length > 5], [true, 'etag:"v1"', true]);
    const second = await ics.listEvents({ remoteId: c.remoteId, timezone: c.timezone }, WINDOW, first.nextToken);
    ok("ics: unchanged feed costs one 304 and changes nothing", [calls.at(-1)!.headers["if-none-match"], second.full, second.upserts.length], ['"v1"', false, 0]);
    const write = await ics.createEvent().then(() => null, (e) => e);
    ok("ics: writing is refused plainly", write instanceof ProviderError && write.kind === "readonly", true);
  }

  /* ---------------- Network guard ---------------- */
  ok("net: private and metadata addresses are refused", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"].every(isPrivateAddress), true);
  ok("net: public addresses pass", ["17.253.144.10", "8.8.8.8", "2606:4700::1111"].some(isPrivateAddress), false);
}
