# Calendar

Connects the calendars people already use, reads and writes them, and ties meetings to Relationships:
who a meeting is with, which deal it is about, what to know before it, and when to meet next.

| Provider | How it connects | Read | Write and invite | Changes arrive by |
|---|---|---|---|---|
| Google Calendar | OAuth 2.0, Calendar API v3 | yes | yes (Google sends invitations) | push (events.watch) and polling |
| Microsoft 365 / Outlook.com | OAuth 2.0, Microsoft Graph | yes | yes (Graph sends invitations) | push (Graph subscriptions) and polling |
| iCloud and any CalDAV server (Fastmail, Nextcloud, Yahoo, Zoho) | user name and app-specific password | yes | yes (server-side scheduling, RFC 6638) | polling (sync-collection) |
| Any ICS link (webcal://, .ics) | the link | yes | no, read only | polling (conditional GET) |

Free: connecting one account, the calendar view, linking to Relationships, the assembled meeting
brief, and creating, rescheduling and cancelling meetings. Premium (see `src/lib/billing/features/calendar.ts`):
AI meeting briefs, morning auto-briefs, more than one calendar account, and smart scheduling in drafts.

## Setting it up

All secrets are stored encrypted with `EMAIL_TOKEN_SECRET` (the same key as mailboxes). Without it, every
provider shows "Not set up yet" in Settings, Calendar, and nothing else changes.

### Database

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm exec tsx scripts/apply-sql.mts drizzle/0018_calendar.sql
```

New tables only (`calendar_accounts`, `calendar_calendars`, `calendar_events`, `calendar_prefs`,
`calendar_briefs`), all `IF NOT EXISTS`. Until it is applied, `/app/calendar` shows the command and the
Relationships tabs simply show no meetings.

### Google Calendar

1. In Google Cloud, enable the **Google Calendar API**. Either create an OAuth client of type *Web
   application* for the calendar, or reuse the Gmail client.
2. Add `https://<site>/api/calendar/oauth/google/callback` as an authorised redirect URI (and the
   `http://localhost:3000/...` one for local work). `<site>` is `NEXT_PUBLIC_SITE_URL` (lib/site).
3. On the consent screen, add the scopes `calendar.readonly` and `calendar.events`. Both are
   *sensitive*, not *restricted*, so verification is the lighter review; until then up to 100 test users work.
4. Set `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Without them the Gmail client
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) is used. `GOOGLE_CALENDAR_REDIRECT_URI` overrides the callback.
5. Push notifications: Google posts to `https://<site>/api/calendar/webhooks/google`. The address must be
   public HTTPS with a valid certificate. If Google refuses the channel, polling still works.

### Microsoft 365 and Outlook.com

1. In Microsoft Entra ID, **App registrations**, register an app. For work and personal accounts choose
   *Accounts in any organizational directory and personal Microsoft accounts*.
2. Add a **Web** redirect URI: `https://<site>/api/calendar/oauth/microsoft/callback`.
3. **API permissions**, Microsoft Graph, delegated: `Calendars.ReadWrite`, `User.Read`, `offline_access`,
   `openid`, `email`.
4. **Certificates & secrets**: create a client secret.
5. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT` (`common` by default, or
   a tenant id to restrict to one organisation). `MICROSOFT_REDIRECT_URI` overrides the callback.
6. Push notifications: Graph posts to `https://<site>/api/calendar/webhooks/microsoft` after a validation
   handshake the route answers.

### iCloud and CalDAV

No server setup. People choose a service (iCloud, Fastmail, Yahoo, Nextcloud, Zoho, or another server by
address), and enter their user name and an **app-specific password**:

- iCloud: account.apple.com, Sign-In and Security, App-Specific Passwords.
- Fastmail: Settings, Privacy & Security, app passwords with CalDAV access.
- Yahoo: Account Security, generate an app password.
- Nextcloud: `https://<server>/remote.php/dav`, an app password from Settings, Security.

YouBank signs in and lists the calendars before saving anything.

### ICS links

Paste any `webcal://` or `https://...ics` link. Private links carry a key, so the link itself is encrypted.

### Sync schedule

- `vercel.json` runs `/api/cron/calendar` daily at 06:15 UTC and `/api/cron/calendar-briefs` at 10:45 UTC.
  This is the floor on Vercel Hobby.
- For a fifteen-minute sync, deploy the relay in `neon/calendar.ts` on the production branch:
  ```bash
  neon functions deploy calendar --src neon/calendar.ts --env YOUBANK_URL=https://<site> --env AUTOPILOT_SECRET=<secret>
  neon triggers create --function-slug calendar --name calendar-heartbeat --cron '*/15 * * * *'
  ```
- Both cron routes accept `CRON_SECRET` or `AUTOPILOT_SECRET` as a bearer token.
- `CALENDAR_POOL` sets how many accounts sync at once (default 4).

### Environment

| Variable | Needed for | Default |
|---|---|---|
| `EMAIL_TOKEN_SECRET` | every provider (encryption) | none |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google | falls back to the Gmail client |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Google, when the callback is not on the site address | `<site>/api/calendar/oauth/google/callback` |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft | none |
| `MICROSOFT_TENANT` | Microsoft | `common` |
| `MICROSOFT_REDIRECT_URI` | Microsoft, when the callback is not on the site address | `<site>/api/calendar/oauth/microsoft/callback` |
| `CALENDAR_PUSH` | `off` turns push notifications off | on (when the site is public HTTPS) |
| `CALENDAR_PUSH_URL` | push to a tunnel during local work | the site address |
| `CALENDAR_POOL` | sync concurrency | 4 |

## How it works

### Code map

| Piece | Where |
|---|---|
| Shared types, sync window | `src/lib/calendar/types.ts` |
| iCalendar reader and writer (RFC 5545) | `src/lib/calendar/ical.ts`, `ical-write.ts` |
| Recurrence (RRULE) | `src/lib/calendar/rrule.ts` |
| Time zones (IANA, Windows names, VTIMEZONE rules) | `src/lib/calendar/tz.ts` |
| Expanding a calendar into occurrences in a window | `src/lib/calendar/expand.ts` |
| Provider contract | `src/lib/calendar/provider.ts` |
| Adapters | `src/lib/calendar/providers/{google,microsoft,caldav,ics}.ts` |
| Fetching from user-supplied servers safely | `src/lib/calendar/net.ts` |
| Accounts, tokens, reconnect state | `src/lib/calendar/accounts.ts` |
| Sync, linking, pruning | `src/lib/calendar/sync.ts`, `match.ts` |
| Push channels | `src/lib/calendar/push.ts` |
| Reading meetings back, the copilot API | `src/lib/calendar/meetings.ts` |
| Free/busy and slot finding | `src/lib/calendar/scheduling.ts`, `slots.ts` |
| Create, reschedule, cancel | `src/lib/calendar/write.ts` |
| Meeting briefs | `src/lib/calendar/briefs.ts` |
| Preferences, plan checks without a session | `src/lib/calendar/prefs.ts` |
| UI | `src/components/calendar/*`, `/app/calendar`, Settings, Calendar |

### The iCalendar layer

The parser keeps the file's tree (components, properties with raw values and parameters). Parsing and
writing back gives the same calendar, so editing one occurrence in a CalDAV resource keeps alarms,
attachments and client extensions. It handles folding (including inside multi-byte characters), quoted
parameters, TEXT escaping, bare LF line endings and truncated feeds.

Recurrence is expanded in **wall time**: the event's local clock reading, turned into an instant only at the
end. A weekly 09:00 meeting stays at 09:00 across a daylight-saving change, and RFC 5545's rules for
skipped and repeated local times are followed. Supported: every FREQ, INTERVAL, COUNT, UNTIL, BYDAY with
ordinals, BYMONTHDAY (negative too), BYMONTH, BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND, BYSETPOS,
WKST, RDATE, EXDATE, and RECURRENCE-ID overrides (including ones that move an occurrence into the window
from outside it). Zones resolve in this order: IANA names, names that contain one
(`/mozilla.org/.../Europe/Berlin`), Windows names (Outlook), the file's own VTIMEZONE rules (evaluated with
the same RRULE engine), and offsets in labels.

New events are written in UTC. Edits keep the zone the event already uses.

### Sync

The window is 30 days back and 90 ahead. Each shown calendar is read incrementally where the provider allows:

- Google: `nextSyncToken`; a 410 means a full read.
- Graph: the calendarView delta link, restarted daily because its window is fixed.
- CalDAV: sync-collection (RFC 6578) with calendar-multiget for changed resources.
- ICS: ETag or Last-Modified.

Every calendar is also read in full once a day, whatever its provider: an incremental read reports only
what changed, so without it an unchanged weekly series would stop at the end of the first window.

A full read replaces the calendar's stored events. An incremental read upserts, deletes, and replaces a
CalDAV resource's occurrences as a group. An event moved out of the window is deleted. Google and Microsoft
expand series on their side; CalDAV and ICS are expanded by `expand.ts`.

Each stored event carries `contact_ids`, `deal_ids` and `external`, computed when it is written and
refreshed on every cron pass (`relinkUser`):

- A contact links only on its own email address, compared in normal form (lower case, `+tag` removed,
  Gmail dots ignored).
- A deal links through a linked contact, through an attendee from the deal contact's company domain, or
  through the deal's name appearing as a phrase in the title. Only open deals link.
- Rooms, resources and group calendars are ignored.

A refresh-token failure marks the account `needs_reauth` with the reason. The calendar page and Settings
then show **Reconnect**, which signs the same account in again; that is always allowed, whatever the plan.

### Push

After a sync, the cron makes sure each shown Google or Microsoft calendar has a channel. Google channels
last up to 7 days and Graph subscriptions under 3; both are renewed a day before they lapse. A random secret
travels with each channel (Google's token, Graph's clientState), is stored encrypted, and is checked on every
notification. A notification syncs only that calendar, after the response. Unknown or forged calls get the
same plain 200 or 202. Polling stays on.

### Meeting briefs

`GET /api/calendar/events/:id/brief` assembles, for free, what YouBank already holds:

- per attendee: the contact, the last four emails in Relationships, talking points from contact knowledge,
  and funding and news signals;
- per company domain: the startup directory record, a public listing (SEC's free list) linked into the
  terminal, and Newsroom stories from the last three weeks;
- the deals involved and their stage;
- when you last met.

Colleagues are listed last, and their company is not looked up.

`POST` writes the AI brief: objectives, talking points, questions, watch-outs, and a line per person. It is
one structured call on the "draft" route. It runs only on that request, and `requireFeature(user,
"calendar.ai_brief")` is checked before any spend. The spend is recorded in the AI usage ledger, so it counts
against the AI allowance and credits.

**Morning auto-briefs** run only for people who turned on "Auto-brief my external meetings each morning".
Turning the switch on checks `calendar.auto_brief`, and `/api/cron/calendar-briefs` checks the plan again for
each person. The run happens once per local day, after 06:00 in the person's zone, for at most eight of
that day's external meetings without a brief. It stops at the first failure, such as a spend limit.

### Scheduling

`findSlots(userId, { durationMin, days, from, max })` in `scheduling.ts` works like this:

1. It asks each provider for busy time live (Google freeBusy, Graph getSchedule, CalDAV reads). A provider
   that does not answer falls back to stored events.
2. It merges the busy time from every calendar.
3. It proposes free times on the person's clock inside their working hours, aligned to the half hour, with a
   ten-minute buffer and two hours' notice.
4. It returns at most two times a day, spread apart.

The scheduler (from the calendar, a contact or a deal) uses it. The person can also type any other time.

The Relationships email agent calls `schedulingNote(userId, text)` when it drafts a reply or a new email. If
the thread is about meeting (it is triaged as "scheduling" or mentions a call), the person has a calendar
connected, and their plan includes `calendar.smart_scheduling`, the note lists three or four real free times.
The agent may offer them; it never books anything.

## Meeting copilot API (stable)

Server functions in `src/lib/calendar/meetings.ts`. Additive changes only: new fields may appear, and
existing ones keep their meaning.

```ts
getMeetingAt(userId: string, time: Date, opts?: { leadMinutes?: number /* default 10 */ }): Promise<Meeting | null>
getUpcomingMeetings(userId: string, window?: { from?: Date; to?: Date; hours?: number /* default 24 */; limit?: number }): Promise<Meeting[]>
```

`getMeetingAt` returns the meeting in progress at `time`, or one starting within `leadMinutes`. All-day
events and events marked free are never returned. When several overlap, the one with a video link wins, then
the one that started most recently.

`getUpcomingMeetings` returns meetings starting in the window, soonest first.

```ts
type Meeting = {
  id: number;                  // stable while the event stays in the sync window
  calendarId: number; calendarName: string; color: string;
  provider: "google" | "microsoft" | "caldav" | "ics"; canWrite: boolean;
  title: string; description: string; location: string;
  start: string; end: string;  // ISO instants; all-day events use UTC midnights of their dates
  allDay: boolean; timezone: string; status: "confirmed" | "tentative"; busy: boolean; recurring: boolean;
  organizer: { email: string; name: string; response: string } | null;
  attendees: { email: string; name: string; response: string; optional?: boolean; organizer?: boolean; self?: boolean; contactId: number | null }[];
  contacts: { id: number; email: string; name: string; title: string; company: string }[];
  deals: { id: number; name: string; stage: string; status: string }[];
  external: boolean;           // someone from outside the person's organisation is invited
  videoUrl: string;            // "" when there is none
  videoProvider: string;       // "Zoom", "Google Meet", "Microsoft Teams", "Webex", ... or ""
  htmlLink: string;            // the event in its own calendar, when the provider gives one
};
```

Over HTTP, with a signed-in session:

- `GET /api/calendar/upcoming?hours=24&limit=50` returns `{ meetings: Meeting[] }`. `hours` is 1 to 168.
- `GET /api/calendar/upcoming?at=<ISO>&lead=10` returns `{ meeting: Meeting | null }`. An empty `at` means now.

The desktop app or meeting bot will need its own token auth on top of this; the route only knows sessions
today. For the brief behind a meeting, use `GET /api/calendar/events/:id/brief`.

## Routes

| Route | What |
|---|---|
| `GET /api/calendar` | accounts (no secrets), calendars, preferences, setup status, CalDAV presets |
| `GET /api/calendar/events?from&to` | meetings in a range (at most 62 days) |
| `POST /api/calendar/events` | create a meeting `{ calendarId?, title, start, end, attendees, videoUrl?, addConference?, sendInvites? }` |
| `GET`, `PATCH`, `DELETE /api/calendar/events/:id` | read; reschedule or edit `{ start?, end?, scope, sendInvites }`; cancel `?scope=instance\|series&notify=1\|0` |
| `GET`, `POST /api/calendar/events/:id/brief` | assembled brief and stored AI brief; write the AI brief (premium) |
| `POST /api/calendar/slots` | free times `{ durationMin, days, from?, max }` |
| `GET /api/calendar/upcoming` | the copilot API, above |
| `GET /api/calendar/people` | last met and next meeting for contacts and deals; `?contactId=` or `?dealId=` for one |
| `POST /api/calendar/accounts` | connect CalDAV or subscribe to an ICS link |
| `DELETE /api/calendar/accounts/:id` | disconnect (push stopped, then the account, calendars, events and secrets deleted) |
| `PATCH /api/calendar/calendars/:id` | `{ visible }`, `{ default: true }` |
| `GET`, `PATCH /api/calendar/prefs` | zone, working hours, default length, meeting link, auto-brief (premium to switch on) |
| `POST /api/calendar/sync` | sync now |
| `GET /api/calendar/oauth/:provider/connect`, `.../callback` | Google and Microsoft sign-in |
| `POST /api/calendar/webhooks/google`, `.../microsoft` | push notifications |
| `GET`, `POST /api/cron/calendar`, `/api/cron/calendar-briefs` | sync (free) and morning briefs (opted-in, premium) |

## Tests

`pnpm exec tsx scripts/test-calendar.ts` runs 119 checks, with no network and no database:

- iCalendar parsing and round trips;
- RRULE expansion;
- time zones and DST, including custom VTIMEZONEs, Windows and Mozilla zone names, and floating times;
- editing occurrences;
- attendee-to-contact and deal matching;
- slot finding;
- video links;
- the network guard;
- all four adapters against responses in `scripts/fixtures/calendar/`.

The fixtures are shaped from each provider's documentation (Google Calendar v3, Graph v1.0, iCloud's CalDAV
answers, an ICS feed). They were written by hand, not captured from live accounts, because OAuth could not
be run here.

## Known limits

- **No live OAuth.** Google, Microsoft and iCloud have not been run against real accounts. The adapters are
  tested only against fixtures.
- **Moving a whole series by an offset:**
  - It is implemented for all three writable providers.
  - Changing a series' length is refused.
  - On Graph, moving a series to another weekday may need its recurrence pattern changed, which is not done.
- **Some RRULE parts are not handled:** `EXRULE` (deprecated) and `RSCALE`. `BYWEEKNO` keeps only the days that
  fall inside the year.
- **Free/busy covers only the person's own calendars.** Other attendees' availability is not consulted.
- **Microsoft all-day events** are read through a UTC Prefer header and rounded to the nearest midnight.
- **The copilot route has no device-token auth.** It only knows sessions.
