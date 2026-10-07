# YouBank for desktop

A Tauri v2 app for Windows, macOS and Linux. It is two things in one window:

1. **The YouBank site, with native extras.** The main window loads the live site
   (`https://youbank-nu.vercel.app`), with a tray icon and quick actions, native notifications,
   `youbank://` links, one instance at a time, a remembered window size and place, an offline screen that
   retries, updates from GitHub Releases, and a global hotkey for quick ask.
2. **A local agent.** With the person's consent, part by part: it indexes folders of PDFs, Word, Excel and
   PowerPoint files into Edge documents, keeps Studio workbooks in step with real `.xlsx` files on disk
   (and lets the AI edit them), shows alerts, runs scheduled briefs and checks while it sits in the
   tray, and listens to meetings with the meeting copilot.

The basic app and everything the site does are free. Three parts need a paid plan, because they cost us
money each time they run (see `src/lib/billing/features/desktop.ts`): indexing more than 25 local files,
scheduled AI tasks, and AI edits to local Office files. Recording meetings and their transcripts are free;
live suggestions during a call, and notes past three meetings a month, need a plan
(`src/lib/billing/features/meetings.ts`). The server checks the plan every time.

- [Run it](#run-it)
- [Build installers](#build-installers)
- [Release](#release)
- [Signing and updates: the secrets](#signing-and-updates-the-secrets)
- [Architecture](#architecture)
- [The meeting copilot](#the-meeting-copilot)
- [Permissions and safety](#permissions-and-safety)
- [The server side](#the-server-side)
- [Checks](#checks)
- [Known limits](#known-limits)

## Run it

You need Rust (stable, 1.85 or later), Node 20+ with pnpm, and your system's webview libraries:

- **Windows:** WebView2 (already on Windows 10 and 11) and the Visual Studio C++ build tools.
- **macOS:** Xcode command line tools (`xcode-select --install`).
- **Linux (Debian, Ubuntu):**
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    libdbus-1-dev libxdo-dev libssl-dev libasound2-dev build-essential pkg-config
  ```
  Connecting needs a Secret Service keyring (GNOME Keyring or KWallet), which desktops have by default.
  The meeting copilot records through PulseAudio (or PipeWire's pulse server, the default on current
  desktops); `pactl` and `wmctrl`, when installed, help it notice calls.

```bash
cd desktop
pnpm install          # the Tauri CLI only; the app's own pages need no build step
pnpm dev              # builds the Rust side and opens the app against production
```

Point it at another copy of the site with `YOUBANK_URL`:

```bash
YOUBANK_URL=http://localhost:3000 pnpm dev      # your local `pnpm dev` of the site
YOUBANK_URL=https://staging.example.com pnpm dev
```

Only `https://` addresses, or `http://` to `localhost` or `127.0.0.1`, are accepted; anything else falls
back to production. The address can also be set in the app (desktop agent → App) and takes effect on the
next start. A non-production address gets the same three website commands as production (see below), added
at start-up.

Logs go to the platform's log folder (for example `~/.local/share/com.youbank.desktop/logs` on Linux,
`~/Library/Logs/com.youbank.desktop` on macOS, `%LOCALAPPDATA%\com.youbank.desktop\logs` on Windows).
Settings are in the app config folder (`settings.json`); the file index, Office links, alert cursor and
task history are JSON files in the app data folder.

## Build installers

```bash
cd desktop
pnpm build                                   # every installer this system can make, in src-tauri/target/release/bundle
pnpm tauri build --target universal-apple-darwin   # macOS: one .dmg for Apple silicon and Intel
pnpm tauri build --debug --bundles deb       # a quick Linux package for testing
```

| System | Installers |
|---|---|
| Windows | `.exe` (NSIS, installs for the current user, no administrator) and `.msi` (for IT deployment) |
| macOS | `.dmg` and `.app`, universal |
| Linux | `.AppImage` and `.deb` (the `.deb` registers `youbank://` through its desktop entry) |

`pnpm icons` regenerates `src-tauri/icons` from the site's `src/app/icon.svg`.

## Release

The workflow `.github/workflows/desktop.yml` builds on Windows, macOS (universal) and Ubuntu and uploads
the installers to a **draft** GitHub Release on `AyanBhardwaj1/YouBank`:

```bash
git tag desktop-v0.2.0
git push origin desktop-v0.2.0
```

The version comes from the tag (it is written into `tauri.conf.json` for the build). It can also be run
by hand (Actions → Desktop → Run workflow), which uses the version already in `tauri.conf.json`. Check
the draft, then publish it. Once published:

- `/download` on the site offers it, picking the right file for the visitor's system (it reads the
  newest published `desktop-v*` release through GitHub's API, cached for ten minutes);
- installed apps find it within six hours through `/api/desktop/update`, which points the updater at
  that release's `latest.json`, and offer "Restart to update".

Pull requests that touch `desktop/` run the checks job instead: formatting, Clippy, the Rust unit tests
and the pages' script check.

## Signing and updates: the secrets

All optional. Without them the workflow still builds working, unsigned installers, and the app does not
update itself. Add them under the repository's Settings → Secrets and variables → Actions.

| Secret | For | How to get it |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Signing updates | `pnpm tauri signer generate -w ~/.tauri/youbank.key`; paste the private key file's contents |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing updates | The password you gave it (empty if none) |
| `TAURI_UPDATER_PUBKEY` (variable or secret) | Checking updates | The public key the same command printed (`youbank.key.pub`) |
| `APPLE_CERTIFICATE` | macOS signing | Your "Developer ID Application" certificate exported as `.p12`, then `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | macOS signing | The `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | macOS signing | For example `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization | Your Apple ID, an app-specific password from appleid.apple.com, and your team id |
| `WINDOWS_CERTIFICATE` | Windows signing | Your code-signing certificate as `.pfx`, then `base64` of it |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows signing | The `.pfx` password |

How the update key works: the committed `tauri.conf.json` has an empty `pubkey` and
`createUpdaterArtifacts: false`. When both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_UPDATER_PUBKEY` are set,
the workflow adds the public key and turns the updater artifacts on (`src-tauri/ci.conf.json`, passed with
`--config`), so the release carries `latest.json` and `.sig` files. Keep the private key safe: losing it
means installed apps can no longer be updated, and anyone holding it can ship updates.

Unsigned builds: Windows SmartScreen says "Windows protected your PC" (More info → Run anyway); macOS
says the app is from an unidentified developer (right-click → Open). The download page says so.

## Architecture

```
desktop/
  package.json            the Tauri CLI; scripts for dev, build, icons and checks
  scripts/check-frontend.js   parses the pages and checks every command they call is registered and allowed
  src/                    the app's own pages: plain HTML, CSS and ES modules, no build step
    index.html, boot.js     start-up, first-run welcome, offline screen with retry
    quickask.html/.js       the floating quick ask window
    agent.html/.js          the desktop agent's settings: account, files, Office, alerts, tasks, meetings, app
    pill.html/.js           the meeting pill: the offer, the consent step, the recording time and Stop
    copilot.html/.js        the copilot window during a meeting: transcript, brief, suggestions, ask
    app.js, styles.css      shared helpers and the colours (light and dark follow the system)
  src-tauri/
    tauri.conf.json         bundle targets, CSP, deep-link scheme, updater endpoints
    capabilities/local.json   what the app's own pages may call (every app command)
    Info.plist              macOS usage strings for the microphone and system audio
    capabilities/remote.json  what the website may call (three commands)
    build.rs                the app's command list; generates one permission per command
    linux/youbank.desktop   the .deb's desktop entry (passes youbank:// links to the app)
    src/
      lib.rs        plugins, start-up, the connection watcher, the command list
      windows.rs    main / quick ask / agent windows; navigation rules; offline; downloads
      settings.rs   settings.json; the site address (YOUBANK_URL, setting, production)
      state.rs      what the app holds; the keychain; the connected account
      api.rs        calls to /api/desktop/**, errors as sentences
      pairing.rs    connecting with a code; disconnecting
      alerts.rs     native notifications; the alerts poller
      tasks.rs      the scheduler and its four tasks
      files.rs      folder indexing: fingerprints, the server check, 4 MB part uploads, watching
      office.rs     Studio pull and push, linking a workbook, AI edits, backups
      ask.rs        quick ask: streams the answer from the server to the window
      updater.rs    update checks and "Restart to update"
      tray.rs       the tray menu; the red recording dot
      capture.rs    meeting audio: microphone and system audio, 16 kHz chunks with levels
      detect.rs     noticing Zoom, Teams, Meet, Webex and Slack calls
      meetings.rs   the copilot: offer, consent, recording, sending chunks, "notes ready"
      deeplink.rs   youbank:// links
      commands.rs   every command a page may call
```

**Windows.**
- `main` starts on the app's own `index.html`: the first-run welcome, or a reachability check (the
  site's `robots.txt`), then the site. Every minute the app checks the site still answers; after two
  misses it shows the offline screen, which retries every 15 seconds and returns to the page the person
  was on.
- `quickask` is a small frameless window on top of everything, opened by the global hotkey (default
  Ctrl+Shift+Space, ⌘⇧Space on a Mac), the tray, `youbank://ask?q=…`, or the site.
- `agent` holds the settings for everything local.

Closing the main window keeps the app in the tray (unless switched off), so alerts and tasks keep
running; Quit in the tray menu ends it. "Start when I sign in" starts it hidden in the tray.

**Links.** `youbank://ticker/AAPL`, `youbank://deal/42`, `youbank://studio/17`, `youbank://edge`,
`news`, `crm`, `settings`, `youbank://ask?q=…`, `youbank://agent/files` and
`youbank://open?path=/app/…`. A link only ever becomes a page under `/app` on the configured site, a
quick ask question, or a section of the agent window. A second launch (or a link opened while the app
runs) goes to the running app.

**Signing in.** The app has its own device token, separate from the browser session, so alerts, tasks and
files work with the window closed:
1. Connect asks `/api/desktop/pair/start` for a code and opens `/desktop/connect?code=…` in the main
   window (or the browser), where the person, already signed in, approves it.
2. The app polls `/api/desktop/pair/poll` with a secret only it holds and collects the token once.
3. The token goes into the keychain (Keychain on macOS, Credential Manager on Windows, the Secret Service
   on Linux) under the site's host name, so staging and production never share one. It never reaches a
   page: every call that uses it is made from Rust.
4. Disconnecting in the app, or in Settings → Desktop app on the site, revokes it at once; the next call
   gets a 401 and the app forgets it.

**Local files.** For each folder the person adds:
1. Walk it (8 levels deep, up to 5,000 files): PDF, Word, Excel and PowerPoint files up to 200 MB,
   skipping hidden files and Office's `~$` lock files.
2. Fingerprint each (SHA-256), reusing the fingerprint when size and modified time are unchanged.
3. Ask the server which are new or changed (`POST /api/desktop/files { check }`), by a hash of each path
   and its fingerprint: the server never learns where a file lives.
4. Upload those: start (the server may already have the same content from another folder or computer and
   links it instead), send 4 MB parts through Edge's own upload, complete. A changed file replaces its
   old document.
5. Watch the folder. New or changed files are uploaded at once if the person chose that for the folder;
   otherwise they get a notification and the files wait.

**Office.** Pulled files go to `Documents/YouBank` (or a folder the person picks). Each link remembers the
Studio change it reflects and the file's fingerprint at the last pull or push. Saving a linked workbook
is noticed by the folder watcher; it is pushed at once or the person is told, as they chose. A push from
a file older than Studio's latest change is refused, and the app offers to pull a fresh copy (after a
backup) or to overwrite. An AI edit pushes the file, runs the Studio agent on the document, keeps a
backup and pulls the result back into the file. Every overwrite keeps the previous file in the folder's
`.backups`.

**Tasks.** Once a minute the scheduler runs what is due: the morning brief and the Edge brief at a time of
day (only within four hours of it, so a laptop opened in the evening does not send the morning brief),
the email agent's status and watch checks every few hours. A run that fails waits for its next slot.

## The meeting copilot

Off until the person accepts its screen (desktop agent → Meetings). Then:

1. **Noticing a call.** Every 15 seconds (while "notice calls" is on) the app looks at running processes,
   which apps use the microphone (`pactl` recording streams on Linux, the microphone privacy store in the
   registry on Windows) and window titles (`wmctrl` on Linux, `tasklist` on Windows). A call in Zoom,
   Teams, Meet (a browser tab), Webex or a Slack huddle brings up the **pill**, a small window on top in
   the top right corner: "Zoom call detected. Start the meeting copilot?", with Not now and Never for
   Zoom. Apps and words the person chose never to record are never offered. An app the person set (on
   the site) to start on its own starts without asking, with the indicator.
2. **Consent.** Start shows the reminder that some places require everyone's consent before a call is
   recorded, and a Copy notice button with the text to paste in the meeting chat (set on the site). Only
   "Start recording" records. The tray's "Start meeting copilot…" goes to the same step.
3. **Recording** (`capture.rs`, through cpal): the microphone, and what the computer plays: WASAPI
   loopback on Windows; CoreAudio's process tap on macOS 14.2 and later (macOS asks for "Screen & System
   Audio Recording" the first time; `Info.plist` carries the usage strings); the default output's monitor
   source through PulseAudio or PipeWire on Linux. Where system audio cannot be opened (older macOS, no
   PulseAudio, permission refused) the copilot records the microphone alone and the pill says so: the
   others are still heard through speakers, not through headphones. Loopback delivers nothing during
   silence, so gaps are filled to keep the two tracks in time. Both are mixed to 16 kHz mono and cut
   into WAV chunks of about 30 seconds, each starting one second before the last ended, with the
   microphone and system levels every quarter second (how the server knows which lines were the
   person's own).
4. **While it records** the tray icon has a red dot, its tooltip says so, and its menu offers Stop; the
   pill shows a pulsing dot, the time, what has been sent, a Copilot button and Stop (Stop, Stop and
   delete, Keep recording). The copilot window shows the rolling transcript, the people and deals
   (pick them from Relationships), what YouBank knows about them (free), live suggestions (Pro, a switch
   for this meeting only, about once a minute) and an ask box.
5. **Sending** (`meetings.rs`). Chunks are written to the app data folder (`meetings/<id>/`) and sent in
   order to `PUT /api/desktop/meetings/:id/chunks/:seq`; each is deleted once YouBank has transcribed it,
   or moved to `Documents/YouBank/Meetings` if the person keeps a local copy. Offline, chunks wait and
   are retried with a back-off. A stopped meeting is ended on YouBank only after its last chunk is
   through, even across a restart; Stop and delete removes the local chunks and the meeting.
6. **Notes ready.** The app checks every 20 seconds until the notes are written, then shows "Meeting
   notes ready" with the summary; "Open latest alert" in the tray opens the meeting in Relationships.
   Notes for meetings recorded elsewhere (the notetaker, another computer) arrive with the alerts, if
   "Meeting notes ready" is on there.

The settings that follow the person across computers (the notice, never-record apps and words,
auto-start, retention, notes) live on the site; this computer keeps whether it notices calls, records
system audio, keeps a local copy and opens the copilot window on start.

## Permissions and safety

- **The website gets three commands, nothing else.** `capabilities/remote.json` lets the site call
  `desktop_info` (version, system, connected or not), `open_quick_ask` and `open_agent`. It has no file,
  shell, dialog, keychain, notification or network access through the app. This was checked against a
  test page: `desktop_info` answered; `get_state`, `scan_files`, `open_external` and the dialog plugin
  were all refused. A custom site address gets exactly the same list at start-up (`windows.rs`).
- **The app's own pages** (`capabilities/local.json`) may call the app's commands, listen to its events,
  hide a window and drag the frameless quick ask window. No plugin's JavaScript API is enabled for them;
  pickers, notifications, opening files and links all go through Rust commands that check their input
  (`open_local` only opens files the app manages; `open_external` only opens web links; `open_site` only
  paths on the configured site).
- **Navigation.** The main window only loads the configured site, the app's own pages and the sign-in
  pages the site hands off to (Google and Neon Auth, over https). Other links open in the browser.
  `file:`, `javascript:` and other schemes are refused (`blob:` URLs the site made, and `data:` URLs
  that are not pages, such as CSV, are allowed for the site's own downloads; such pages match no
  capability, so they get no app commands; HTML, SVG and XML `data:` URLs are refused). Downloads go to the
  Downloads folder without overwriting anything.
- **Consent.** Local files, Excel and PowerPoint, alerts and scheduled tasks each start with a screen
  saying exactly what they do, and stay off until accepted. The Rust side keeps anything without consent
  switched off whatever a page sends.
- **Meetings.** Nothing records until the person agrees to the consent step (or set that app to start on
  its own, on the site). The red dot and the pill show for the whole recording. Audio stays on this
  computer only until it is transcribed, unless the person keeps a copy. Live suggestions spend only
  while switched on for that meeting, and the server checks the switch and the plan on every call.
- **Money.** Nothing that costs money runs without a person asking: uploading files is a click (or a
  folder the person set to upload on its own), an AI edit is a click, and a scheduled AI task runs only
  after the person switched it on for this computer. The server keeps its own copy of the switches
  (`desktop_devices.settings`) and refuses a scheduled AI task that is off there, and every premium route
  calls `requireFeature` first. Polling for alerts only reads.
- **CSP.** The app's pages allow only their own scripts (`script-src 'self'`) and inline styles.

## The server side

All in the main Next.js app (see the root README):

| Route | What |
|---|---|
| `POST /api/desktop/pair/start`, `/poll` | Connecting with a code (anyone; limited per address) |
| `POST /api/desktop/pair/approve` | The signed-in person approves a code (browser session only) |
| `GET, DELETE /api/desktop/devices` | The account's connected computers, for Settings |
| `GET, PUT, DELETE /api/desktop/me` | Who the app is connected as, its plan and desktop features; the task switches; disconnect |
| `POST /api/desktop/ask` | Quick ask (the terminal assistant, streamed) |
| `GET /api/desktop/notifications` | New bell alerts, email agent questions and deal news since a time |
| `POST /api/desktop/tasks/:task` | `morning-brief`, `autopilot-status` (free); `edge-brief`, `watch-check` (premium) |
| `POST, DELETE /api/desktop/files`, `PUT …/:id/part`, `POST …/:id/complete` | Local files into Edge documents |
| `GET, POST /api/desktop/studio`, `GET, POST …/:id`, `POST …/:id/agent` | List, link, pull, push, AI edit |
| `GET /api/desktop/update` | Redirects the updater to the newest desktop release's `latest.json` |
| `GET, POST, PUT /api/desktop/meetings` | Recent meetings, copilot settings and plan; start a meeting (after consent); save the settings |
| `PUT /api/desktop/meetings/:id/chunks/:seq` | One chunk of audio (raw WAV, levels in the query), transcribed and dropped |
| `GET, PATCH /api/desktop/meetings/:id`, `POST …/end` | State and the latest transcript; who and what it is about; end (or discard) |
| `GET …/:id/brief`, `PUT, POST …/:id/live`, `POST …/:id/ask`, `GET /api/desktop/meetings/search` | The free brief; live suggestions on or off and one round (premium); ask; contact and deal search |

Desktop tokens (`ybd_…`) only work on these routes, and Office add-in tokens do not work on them. The
tables are in `drizzle/0017_desktop.sql`.

## Checks

```bash
cd desktop
pnpm check:web     # the pages parse; every command they call is registered and allowed
pnpm check:rust    # cargo fmt --check, clippy -D warnings, 27 unit tests
```

The unit tests cover the link parser, the navigation rules, site addresses, settings defaults and
cleaning, the scheduler's timing, which files are indexed and which folders are too broad, path hashing,
file names, the streaming parser (including a character split across two network chunks), and for the
meeting copilot: downmixing, resampling, levels, WAV headers, mixing, filling loopback's silent gaps,
overlapping chunks, call detection from process, microphone and window snapshots (and the `pactl`,
registry, `tasklist` and `wmctrl` parsers), the never-record rules, which send failures wait and which
drop, and the recording dot.

The capture was also run on Linux against a PulseAudio server with two null sinks: a tone played into
the "microphone" for the first eight seconds and another into the speakers' monitor after that came
back as two chunks (0–31.7 s and 30.7–37.7 s, overlapping by a second), with the microphone levels high
in the first part and the system levels high in the second. `capture.rs` and `detect.rs` also compile
and pass Clippy for Windows (`x86_64-pc-windows-msvc`) and macOS (`aarch64-apple-darwin`); they were not
run there.

The app was also run end to end under Xvfb on Linux against a stand-in for the `/api/desktop/**` routes:
first-run and offline screens, the website's command allow-list, connecting with a code and keeping the
token in a Secret Service keyring, the task switches reaching the server, alerts polling, the scheduler,
indexing a folder (a 5 MB PDF sent as a 4 MB and a 1 MB part, the lock file and the `.txt` skipped),
pulling a Studio workbook, noticing a local save and pushing it with its base change, quick ask streaming
an answer, `youbank://` links and a second launch handing over to the running app.

## Known limits

- **Clicking a notification** does not open the page on Windows and Linux (the notification plugin has no
  click events on desktop). "Open latest alert" in the tray opens the most recent one.
- **Decks go one way.** A deck pulls as `.pptx`; edits made in PowerPoint are not read back into Studio.
- **Files up to 4 MB** can be pushed to Studio or linked, as with Studio's own import (the host's request
  limit). Indexing has no such limit (200 MB, in parts).
- **Signing in with Google inside the window** depends on Google accepting the system webview. If it
  refuses, sign in to YouBank in the browser and choose "Connect in my browser": the app connects all the
  same, though the window itself then needs its own sign-in.
- **Deal notifications** cover news about deals (Edge findings, filings), not stage changes, which the
  person usually made themselves.
- **Linux without a keyring** (some minimal window managers) cannot stay connected; the app says so.
- **Meeting copilot.** Windows loopback and the macOS process tap were not run on those systems. On
  macOS, calls are noticed from processes only (window titles would need the Accessibility permission),
  so Meet in a browser is not noticed there, and macOS before 14.2 records the microphone only.
  Transcription always happens on YouBank's server (no local model). Speaker names beyond "You" depend on
  the notes step naming the diarizer's per-chunk labels.
- The installers have only been built for Linux here (a `.deb`); the Windows and macOS builds run in the
  release workflow.
