# The meeting copilot

The copilot listens to a person's meetings and files what it learns into Relationships. It listens in
one of two ways, and everything after the audio is shared.

| | Desktop capture | Notetaker bot |
|---|---|---|
| How | The desktop app records the microphone and what the computer plays | A participant joins the meeting link (Recall.ai) |
| Started by | The person, after a consent prompt; or an app they set to start on its own | A click ("Send the notetaker to this meeting"), or an auto-join rule they switched on |
| Speakers | "You" for certain (from the microphone levels); others labelled per 30-second chunk and named by the notes step | Each participant's name, from the meeting app |
| Cost | Free (transcription: OpenAI about $0.36 an hour, or the ML service's free credits) | Premium, `meetings.bot`, about $0.65 an hour |

## The pieces

| Piece | Where |
|---|---|
| Tables | `drizzle/0019_meetings.sql`: `meetings`, `meeting_chunks`, `meeting_links`, `meeting_settings`, and `crm_actions.meeting_id` |
| Vocabulary and settings | `src/lib/meetings/model.ts` |
| Transcription | `src/lib/meetings/transcribe.ts`: the `Transcriber` interface, OpenAI and the ML service |
| Stitching | `src/lib/meetings/stitch.ts`: chunks into one transcript; "You" from the levels; rendering for models |
| Matching | `src/lib/meetings/match.ts`: participants to contacts |
| Notes | `src/lib/meetings/notes.ts` (schema and parser), `pipeline.ts` (`writeNotes`, `finishMeeting`) |
| Proposed changes | `src/lib/meetings/diff.ts` |
| Filing into Relationships | `src/lib/meetings/crm.ts` |
| The bot | `src/lib/meetings/bot.ts`: `MeetingBotProvider`, Recall.ai, webhook signatures |
| Context | `src/lib/meetings/context.ts`: `MeetingContextSource` (and the calendar's place) |
| During the meeting | `src/lib/meetings/copilot.ts`: the brief, live suggestions, ask |
| Pages and the app | `src/lib/meetings/views.ts`; routes under `/api/meetings/**` and `/api/desktop/meetings/**` |
| Web UI | Relationships → Meetings: `src/components/crm/MeetingsPanel.tsx`, `MeetingDetail.tsx`, `MeetingSettings.tsx` |
| Desktop | `desktop/src-tauri/src/capture.rs`, `detect.rs`, `meetings.rs`; `desktop/src/pill.*`, `copilot.*`, the agent's Meetings section |
| Premium | `src/lib/billing/features/meetings.ts` |
| Tests | `scripts/test-meetings.ts` (83 checks, fixtures only); the desktop crate's unit tests |

## Desktop capture, step by step

1. **Noticing a call** (`detect.rs`, every 15 seconds while the copilot is on and "notice calls" is on):
   running processes, apps using the microphone (PulseAudio/PipeWire recording streams on Linux, the
   microphone privacy store on Windows) and window titles (Meet tabs, call windows). A call in Zoom,
   Teams, Meet, Webex or a Slack huddle brings up the pill: "Zoom call detected. Start the meeting
   copilot?", with Not now and Never for Zoom. Apps and words the person chose never to record are not
   offered.
2. **Consent.** Start shows the reminder that some places require everyone's consent to record, and a
   notice to copy into the meeting chat. Only "Start recording" records. The server stores when, and
   whether the notice was copied (`meetings.consent`).
3. **Recording** (`capture.rs`): microphone plus system audio (WASAPI loopback on Windows, CoreAudio's
   process tap on macOS 14.2+, the output's monitor source on Linux), mixed to 16 kHz mono WAV in chunks
   of about 30 seconds that overlap by one second, with microphone and system levels every 0.25 s.
   Where system audio cannot be opened, it records the microphone alone and says so. The tray icon gets
   a red dot; the pill shows the time and Stop (Stop, or Stop and delete).
4. **Sending** (`meetings.rs`): chunks wait on disk and go in order to
   `PUT /api/desktop/meetings/:id/chunks/:seq`, which transcribes them and answers with the segments for
   the copilot window. A chunk is deleted once it is through (or moved to Documents/YouBank/Meetings if
   the person keeps a local copy). Offline, they wait; a meeting is ended on the server only once every
   chunk has arrived, even across a restart.
5. **Ending.** `POST /api/desktop/meetings/:id/end`; the notes are written after the answer. The app
   checks every 20 seconds and shows "Meeting notes ready", which (like every alert) the tray's
   "Open latest alert" opens at Relationships → Meetings.

## After the meeting

`finishMeeting` (`pipeline.ts`), automatically when a meeting ends and the person left automatic notes
on, within the free monthly allowance (`MEETINGS_FREE_NOTES`, 3) or the plan (`meetings.notes`):

1. The transcript is stitched from its chunks.
2. One model pass (the `draft` route: a mid-size model at low effort) writes the notes: summary,
   decisions, action items with owners and dates (relative dates worked out from the meeting date),
   open questions, speaker names for anonymous labels, each participant's sentiment, interest, signals,
   new facts and topics, deal terms stated, and follow-up emails. `parseNotes` checks every field.
3. `applyMeetingToCrm` files it, the way the email agent stores what it reads:
   - participants are matched to contacts (email first; a name only when exactly one contact fits it
     well); a new person with an email becomes a contact tagged "needs review" with a keep-or-remove
     suggestion; a person with only a name becomes an "add contact" suggestion that asks for the email;
   - each contact gets a meeting entry on their timeline: a `crm_threads` row (category `meeting`,
     linked to the deal) with one `crm_messages` row carrying their topics, what they know and what they
     asked, which is contact knowledge (`drizzle/0010_contact_knowledge.sql`). Relationship strength,
     nurture and quiet-deal checks all see it; the inbox leaves it out;
   - deal terms that differ from the deal become `update_deal` suggestions (from → to, with the words
     that said it), and a stage change a `move_stage` suggestion. Nothing is written until accepted;
   - a stated title or company that differs from the contact's becomes an `update_contact` suggestion;
   - follow-up drafts go into the review queue (`crm_drafts`, kind `follow_up`, `meta.meetingId`).
     Autopilot never sends them.
4. Run again ("Rewrite notes", or after linking a contact), nothing is done twice.

Unlinking a contact from a meeting removes its timeline entry and keeps it unlinked when the meeting is
filed again. Deleting a meeting deletes its transcript and timeline entries; contacts it added stay.
Transcripts older than the person's retention setting are deleted (notes stay).

## The notetaker bot

`sendBot` checks `meetings.bot`, creates the Recall bot with `recording_config.transcript` (Recall's own
streaming transcription) and `metadata.youbank_meeting`, and stores its id. Progress arrives by webhook
at `POST /api/meetings/webhook`, verified with `RECALL_WEBHOOK_SECRET` (Svix: HMAC-SHA256 of
`id.timestamp.body`, five-minute tolerance; the Standard Webhooks header names work too). Without
webhooks, opening the meeting polls the bot (free, at most every 20 seconds). When the recording is done
and the transcript ready, the transcript and participant list are stored as chunk 0 and the meeting
goes through the same notes step. The hours are recorded in the AI usage ledger at $0.65 an hour.

Recall's endpoints were written from its documentation and tested against recorded fixtures only;
check them against a live account before relying on it (see Known gaps).

## Live copilot

The copilot window (desktop) shows the rolling transcript, the people and deals picked (search
Relationships), and the **brief**: who each person is, their deal and stage, their last emails, your
notes on them, and a listed company's numbers from the terminal's cached record. The brief reads only
the database and costs nothing.

**Live suggestions** (`meetings.live`) are a switch per meeting, stored on the meeting on the server.
While it is on, the window asks about once a minute (the server allows two a minute) and gets up to
three questions to ask, facts to remember and things to be careful about, from a small model over the
last few minutes and the brief. The server refuses when the switch is off, the meeting has ended or the
plan does not include it; ending the meeting turns it off.

**Ask about this meeting** (desktop window and the meeting page) answers from the transcript and notes
with quotes, within the person's normal daily AI allowance.

## Calendar: where it plugs in

The calendar integration is built on another branch and is not a dependency. It will expose
`getMeetingAt(userId, time)`, `getUpcomingMeetings(userId, window)` and `GET /api/calendar/upcoming`.

`src/lib/meetings/context.ts` defines

```ts
interface MeetingContextSource {
  id: string;
  contextAt(userId: string, at: Date, hint: ContextHint): Promise<Partial<MeetingContext> | null>;
  upcoming?(userId: string, windowMs: number): Promise<UpcomingMeeting[]>;
}
```

with three sources on this branch: `app` (the detected app and window title, cleaned), `bot` (the
bot's participant list) and `manual` (contacts and deals picked). The block marked **CALENDAR** in that
file shows the source to add: in the calendar's own code, call `registerContextSource({ id: "calendar",
contextAt, upcoming })`. A registered source is asked first, so an invite's title and attendees (with
emails, which match contacts for certain) win over a window title.

Auto-join: `autoJoinDue(upcoming, settings, alreadySent)` picks the meetings to send the notetaker to
(the person switched auto-join on, the link is joinable, it starts within three minutes, the
never-record rules allow it, not already sent). Once a calendar source exists, a cron (or the calendar's
own sync) calls `upcomingMeetings(userId, 10 * 60_000)`, then `autoJoinDue`, then
`sendBot(user, { meetingUrl, title }, "auto")` for each. That loop is not wired yet, because without a
calendar it would never find anything.

## Configuration

| Variable | Needed for |
|---|---|
| `OPENAI_API_KEY` | Speaker-labelled transcription (and the notes, if OpenAI is the AI provider) |
| `MEETINGS_TRANSCRIBE` | Force an engine: `openai` or `ml` (default: OpenAI when its key is set, else the ML service) |
| `MEETINGS_TRANSCRIBE_MODEL` | Default `gpt-4o-transcribe-diarize`; `gpt-4o-transcribe` or `gpt-4o-mini-transcribe` give text without speakers |
| `EDGE_ML_URL`, `EDGE_ML_SECRET`, `R2_*` | The ML service fallback (the chunk passes through R2 for seconds) |
| `RECALL_API_KEY` | The notetaker bot |
| `RECALL_REGION` or `RECALL_API_URL` | Recall's region (default `us-west-2`) |
| `RECALL_WEBHOOK_SECRET` | Verifying Recall's webhooks (`whsec_…`); point Recall at `<site>/api/meetings/webhook` |

## Known gaps

- **Not run against live services.** OpenAI transcription, Recall.ai and the notes model were not
  called (no network here); the parsing of their answers is tested with fixtures written from their
  documentation and SDK types.
- **Platforms.** Capture was run end to end on Linux against PulseAudio (the microphone and the monitor
  source both recorded, levels separating the two). The Windows (WASAPI loopback) and macOS (CoreAudio
  tap) paths compile and pass Clippy for those targets but were not run on those systems. macOS before
  14.2 records the microphone only. The ScreenCaptureKit route the brief mentioned was not used: cpal's
  CoreAudio tap gives the same audio without a second capture stack.
- **Detection on macOS** sees processes only (Zoom's in-meeting helper); Meet in a browser and Teams
  calls are not noticed there, because window titles need the Accessibility permission.
- **Local transcription** is not offered; chunks are always transcribed on the server.
- **Speaker labels** from a diarizing model restart every chunk; the notes step names those it can, and
  the rest read "Speaker". The person's own lines are "You" only when system audio was captured.
- **Clicking a notification** does nothing on Windows and Linux (as for every desktop alert); "Open
  latest alert" in the tray opens the notes.
- **Auto-join** waits for a calendar source.
