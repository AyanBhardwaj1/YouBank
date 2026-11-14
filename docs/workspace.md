# Workspace: desk, looks and flow

How each person's YouBank is set up for them and stays theirs to change: features shown, the Home page,
how the app looks, and the pieces that make it quick to move around (the command palette, the desk inbox,
shortcuts). No migration: everything is kept in `profiles.extra`.

## Where state lives

| Key in `profiles.extra` | What | Cleaned by |
|---|---|---|
| `desk` | Home layout (`focus`, `home`, `desk`); widgets in order with `on` and an optional `size`; features `hidden` from the navigation; `notes`; `source` (`auto`, `ai`, `you`); `setupAt` | `normalizeDesk` (`src/lib/desk/desk.ts`) |
| `look` | scale, radius, font, accent (`theme` or `#rrggbb`), background, wallpaper, motion, contrast, `system` with `lightTheme` and `darkTheme` | `normalizeLook` |
| `looks` | saved looks: `{ name, theme, look }`, at most 12 | `normalizePresets` |
| `watchlist` | the person's own tickers, at most 30; absent means the role's list (`src/lib/roles.ts`) | `normalizeWatchlist` (`src/lib/desk/watchlist.ts`) |
| `starredTools` | starred tool ids, at most 24 | `normalizeStarred` |
| `theme`, `nav`, `ai` | as before | |

Browser only (localStorage): the palette's recent commands (`yb-palette-recent`), Jump back in
(`yb-recent-pages`), What's new seen (`yb-whats-new-seen`), installed (`yb-installed`).

The look is also mirrored in the `yb-look` cookie, so the server renders `<html>` with the right
`data-*` attributes and CSS variables (`lookAttrs`) and the first paint is already right. Only values that
pass `normalizeLook` reach a style attribute: an accent is `theme` or a plain six-digit hex.

## Saving

- `/api/prefs` POST merges a patch into `extra` under a row lock (`updateExtra`, `src/lib/prefs/extra.ts`).
  Saves sent together each land.
- In the browser, `WorkspaceProvider` queues its saves one at a time, so quick successive clicks are
  stored in order.
- Notes save after an 800 ms pause and are flushed with `keepalive` when the page hides.
- The desk setup (`/api/desk/setup`) merges after its model call, so notes typed meanwhile stay.
- Profile completion sets the desk up only the first time the survey is finished.

## Setting it up for the person

- `recommendDesk(role, words)` is pure and tested. The role picks the starting set; keywords in the
  survey's goals or a sentence switch features on ("crypto", "outreach", "backtest"); layout words pick
  Focus, Home or Desk; named features are pinned first in the top bar.
- `setupFromWords` asks a small model for the same choice, constrained to the same vocabularies, and
  falls back to the rules.
- Onboarding's "Look and feel" step can override the layout and set a style and wallpaper.

## Home

- `HomeDashboard.tsx` renders the three layouts. `home/Widgets.tsx` dispatches widget ids to components.
- Widgets: `checklist`, `brief`, `agenda`, `waiting` (the desk inbox), `watchlist`, `movers`, `start`,
  `ask`, `runs`, `notes`, `private`, `saved`, `markets`, `calc`, `recent`.
- **Adding a widget:**
  1. Add its id to `WIDGETS` with a label and hint.
  2. Optionally add it to a layout's defaults in `LAYOUT_WIDGETS`.
  3. Add a case in `Widget()`.
  4. Existing desks get it switched off; new desks get the layout's defaults.
- **Arrange mode** (`home/Arrange.tsx`) edits `desk.widgets` in place with `moveWidget`, `nudgeWidget`
  (within a column on Desk) and `toggleWidget`.
- **Anything that depends on the time** (greeting, date, market hours, Join) reads `useNow()`, which is
  null during hydration. The server's clock and time zone never meet the browser's (React error 418).

## Desk inbox

- `/api/desk/inbox` lists the agent's questions, drafts, suggested follow-ups and unread alerts. Its
  `?counts=1` mode drives the badge on Home's tab (`src/lib/client/waiting.ts`).
- Every decision goes to the endpoint that owns the item (`inboxRequest` in `src/lib/desk/inbox.ts`).
  Sending still teaches the engine, and approving a suggestion still only makes a draft.
- The agent's questions also post a bell notification (kind `agent`). It reads as done when the draft's
  questions are settled.

## Codes

- `yb1.`: a look (style plus every look setting), from `lookCode` and `readLookCode`.
- `yb2.`: a whole setup (layout, shown widgets with widths, hidden features, style, look; never notes),
  from `setupCode` and `readSetupCode`, cleaned for the reader's role.

Both are base64url JSON, and every value goes through the same normalizers as stored preferences.

## Command palette

- `CommandPalette.tsx` is the shell: ⌘K, the `yb:palette` event, and preloading.
- `PalettePanel.tsx` is the panel, loaded on first use.
- Ranking is `src/lib/palette.ts`. It also offers:
  - tickers;
  - the AI;
  - the person's contacts and deals (`/api/crm/search`).
- In the terminal, ⌘K is the terminal's own; the top bar's search opens the palette there. Terminal
  commands are handed to an open terminal with the `yb:terminal-run` event.

## Public company pages

- `/c/TICKER` and the `/c` index show SEC data only (no prices).
- A company without a fresh stored record is built from the SEC on first view. Public traffic can build at
  most 300 an hour, and only for tickers the SEC lists.
- See `src/lib/public/company-page.ts`.

## Interfaces

Settings → Style → Interface picks the whole frame of the signed-in app, thirteen ways (`src/lib/desk/interfaces.ts`). A theme only recolours the Classic frame; an interface changes the structure, so switching one feels like opening a different app over the same data and features: where the navigation lives, how Home is composed, how things move, the type and density, the colours, and one signature detail.

| Interface | Navigation (desktop) | Home | Motion | Signature | Suggested for |
|---|---|---|---|---|---|
| Classic | top bar | Focus, Home or Desk | the sliding tab | (unchanged) | everyone (default) |
| Bare | one line of numbered text links | a plain document with a table of contents | none at all | 1–9 jump to pinned pages, / searches | keyboard people |
| Spectacle | a glowing orb that blooms into the features | a title sequence and a reel of tilting cards | pages arrive out of a blur; springs | the orb leans toward the pointer; an aurora and a pointer light | demos, pitches |
| Prompt | a composer along the bottom (no menus) | a conversation, one message per widget | messages type in | type a page's name to go, anything else is asked | people who type |
| Canvas | a floating tool rail | a board you pan and zoom, with a minimap | a zoom-in | selection handles; the dots move with the board | visual thinkers |
| Broadsheet | a nameplate with sections, an edition line | a front page: banner, lead with drop cap, ruled columns | ink settling (fade) | the drop cap and column rules | consultants |
| Cockpit | bracketed function keys (F1…), a status strip | a radar of the watchlist, a big clock, gauges, numbered channels | a boot flicker | blips flare as the sweep passes | markets |
| Glass | an OS menu bar and a magnifying dock; pages in windows | a desktop: clock, Spotlight, icons, widget windows | windows open from the dock | the dock swells under the pointer | VC |
| Swiss | a numbered index rail | a poster: the date as a giant numeral, numbered sections | a hard wipe | the red rule | PE |
| Ledger | thumb tabs cut into the book's edge, a folio strip | an open book: accounts left, journal right | pages turn | the gutter and the tabs | accountants, bankers |
| Blueprint | drawing-sheet tabs, a title block | a drawing whose details draw themselves in | a sheet being drawn | crosshair coordinates in the title block | corporate finance |
| Zen | none (⌘K, the menu, G then a letter) | one calm column, widgets revealed as you scroll | slow fades | a circle that breathes | anyone who wants focus |
| Bento | a dock of big squishy buttons | a box of tiles in every size with your numbers | bounces | tiles squish when pressed | students |

How it fits together:

- `look.ui` in the stored look and the `yb-look` cookie, set on `<html data-ui>` by `lookAttrs`, so the first paint already has it.
- `src/app/interfaces/*.css` (imported from `globals.css`): `base.css` for what they share, then one file per interface with its tokens (scoped to `html[data-ui="x"]:has(.app-frame)`, so the public site never changes), its frame and its Home. The hooks in the frame are `.yb-topbar`, `.yb-side-btn`, `.yb-brand`, `.yb-wordmark`, `.yb-role`, `.yb-pins`, `.yb-pill`, `.yb-right`, `.yb-search`, `.yb-main` and `.yb-tabbar`.
- `src/components/workspace/InterfaceChrome.tsx` places each interface's furniture (edition line, menu-bar clock, rails, dock, orb, composer, thumb tabs, sheet tabs, status strip). The larger pieces live in `src/components/workspace/interfaces/` and load only for the interface that uses them; `Effects.tsx` holds the behaviour (how a page arrives, Bare's keys, Spectacle's light, Blueprint's crosshair, Glass's window title). Page arrivals use the Web Animations API on `.yb-main`, so nothing remounts and no transform is left behind.
- Home: `HomeDashboard` keeps Classic's three layouts and hands every other interface to its own composition in `src/components/workspace/interfaces/homes/` (each a lazily loaded chunk). They reuse the same widgets, stores and Arrange mode through `home/Kit.tsx`; nothing is fetched twice.
- Motion honours `prefers-reduced-motion` and Settings → Style's "Less motion" (`html[data-motion="reduced"]`): springs, sweeps, the aurora, tilt, magnetism and page arrivals stand still.
- On a phone every interface keeps the bottom tab bar, drawn in its own style, and its Home stacks; the desktop furniture is hidden below 768px.
- Interfaces are offered only in Settings (with a live miniature of each, `interfaces/Miniatures.tsx`, pure CSS that plays on hover, focus and for the one in use), never on the landing page or in the command palette; `scripts/test-desk.ts` checks this.

## Tests

`scripts/test-desk.ts`, `test-palette.ts`, `test-inbox.ts`, `test-watchlist.ts`, `test-markets.ts`,
`test-recent.ts`, `test-answer-actions.ts`, `test-cost-preview.ts`, `test-company-page.ts`.
