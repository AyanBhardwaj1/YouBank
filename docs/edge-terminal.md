# Edge in the Terminal: Bloomberg-style monitors

Five Terminal functions put Edge's alternative data on dense, keyboard-driven, live-updating screens, the way Bloomberg's MARB, TOP and FIRST put deals and news. They sit in the Terminal's own function registry (`src/lib/functions.ts`, group `edge`), so they work only where Edge does, show up in the command bar's suggestions, the help (`?`) and the rail's "Edge monitors" strip, and open as ordinary panels.

| Mnemonic | Typed as | What it shows | Data sources |
|---|---|---|---|
| **MARB** | `MARB` | Every pending takeover: target and acquirer prices, the offer's value now (a stock leg marked at the acquirer's price), gross spread in dollars and percent, the spread annualised to the expected close, days to close (stated, or an estimate marked `e`), the odds the price implies, Edge deal-watch flags on either party, and prediction-market odds on the deal or its regulator. Enter drills into a deal: its terms, the close estimate's reasoning, the spread since announcement, the flags and markets, and the parties' DES, SAT, ALT and EDGE. | Edge deals database (`edge_deals`, `edge_deal_fields`: per share, exchange ratio, consideration, CVR, approvals, second request, premium), the Newsroom deal tracker (`news_deals`) for deals not read yet, market quotes and daily closes (`src/lib/market/data.ts`), deal-watch cards (`edge_detections` kind `deal_impact`), Kalshi and Polymarket (`src/lib/predict/store.ts`) |
| **SAT** | `SAT XOM` or `XOM SAT` | A company's geospatial signal monitor: a locator map of the sites Edge watches for it (mapped plants, curated satellite sites) with the ones that signalled lit, and one row per flaring, crop, water, ship, radar, ground-change, permit or methane signal with its z-score against the site's own history, the history as a sparkline, when it was observed and a picture (through `edgeImageSrc`). Enter opens the full finding. | `edge_detections` (site kinds), `edge_assets` (EIA plants), `SAT_SITES`, the provenance trail (`edge_provenance`), the flare pass state |
| **FLR** | `FLR` | Every mapped processing plant: owner and ticker, seven days of radiant heat as bars, days flaring, the week's heat, up to twelve weeks of its record, the change against its average week (as a multiple past +100%), its current card, the last satellite pass and when the next is due. `x` lists every plant. | The hourly flare passes: the week of VIIRS hot spots kept between passes (`edge:flares:spots:v1`), the weekly record per plant (`edge:flares:hist:v1`), `edge_job_state` (`edge.flares.pass`), `edge_assets`. Opening FLR or SAT runs a pass after the response when the last is over an hour old, as the feed does. |
| **ALT** | `ALT NVDA` or `NVDA ALT` | A company's alternative data, each row against its own history (percentile and z-score of the latest reading among the earlier ones) with a sparkline: open and new postings, Wikipedia attention, federal awards and obligations, WARN layoffs, patents, the Deal Radar's 12-month sale odds, FDA and NHTSA recall bursts and reactor outages by month, and the prediction markets that move the stock with their month of prices. Enter charts a row. | `edge_series` (Pulse and Deal Radar), `edge_detections` (records), `predictSignalsFor` and `priceHistory` over today's markets |
| **EVTS** | `EVTS`, `EVTS FLR high`, `EVTS XOM` | The live tape of Edge findings across kinds, newest first: New York time, severity, group (FLR, SAT, CH4, PMT, REC, DEAL, ALT, DOC, NET, QNT), tickers, the finding and where. Findings that arrive while it is open are marked NEW. A ticker opens the matching monitor (SAT for site findings, MARB for deals, ALT for records and signals). | `edge_detections` (public and the person's own, 30 days), the flare and records pass states |

## Keys

In any monitor, once its table has focus (a panel opened from the command line takes it when nothing else has): ↑ ↓ or j k move, PgUp PgDn Home End jump, Enter drills in (Esc closes the drill-down), 1–9 sort by the n-th sortable column (again to flip). MARB filters with a (all), c (cash), s (stock), m (mixed), f (flagged), p (with markets), r (reported, not signed). EVTS: ← → change the group, h cycles the minimum severity, a clears the filters. FLR: x toggles every plant.

## Provenance, freshness and failure

Every monitor ends with a source strip: each source's state (live, nothing yet, stale, not answering), as of when, and that the screen is live (MARB and FLR ask again every minute, EVTS every 20 seconds, SAT every two minutes, ALT every five, only while the tab is visible). A source that is down or stale also gets a line in words at the top saying what is shown instead ("the last pass did not complete; showing the last good record"). Each source is read on its own (`attempt` in `src/lib/terminal/edge/common.ts`), so one failing never empties the screen; a failure is logged with `logError` and its text never reaches the page. A refresh that fails keeps the last answer on screen and says so. Market prices also travel in `x-data-sources`, as for every terminal function.

Empty screens say what was looked for and why there is nothing (no pending deals, a company with no mapped sites, a company not in the graph), and where to go instead.

## How the numbers are made (pure, tested in `scripts/test-edge-terminal.ts`)

- **Offer value** (`offerValue`): cash; or the exchange ratio times the acquirer's price now; or both for a mixed deal, whose cash leg is the value stated at signing less the stock at the acquirer's close that day (`cashLeg`). Without the acquirer's price the stated value stands in, marked `*`.
- **Gross spread** (`grossSpread`): offer less the target's price, and that over the target's price. **Annualised** (`annualised`): simple (spread × 365 / days), with the compounded figure beside it. Spreads are gross: before dividends, borrow cost and financing.
- **Expected close** (`expectedClose`): a stated date when there is one; otherwise about six weeks for a tender, four months for a cash merger and five and a half for a stock or mixed one, plus about five months for an HSR second request, two for foreign antitrust and three for a sector regulator (FERC, FCC, state commissions, CFIUS, bank regulators). An estimate already passed is flagged; the return is annualised over at least two weeks, so a deal days from closing (or past its estimate) does not show an absurd rate.
- **Implied odds** (`impliedOdds`): where the target trades between its unaffected price (offer over one plus the stated premium) and the offer, ignoring time value.
- **Spread history** (`spreadHistory`): the offer marked at each day's acquirer close (the last carried over a gap) against the target's close.
- **History**: `percentileRank` (mid-rank for ties), `zScore` (sample standard deviation, at least three points), `vsAverage`, `poissonZ` for permit counts, `monthlyCounts` for records, `sparkPoints` (gaps skipped, never drawn as zero).
- **Site signals** (`siteSignal`): a satellite analysis keeps its own z-score and baseline years; flaring is the week's heat against the weeks before on its record; permits a Poisson z of the month against the 90 days before; methane the rate against earlier plumes; radar and ground change carry no baseline z.
- **Tape** (`groupOf`, `severityOf`, `parseTape`): a deal-watch card keeps its own severity; otherwise size (hectares scaled as the feed does) weighed with confidence.
- **Deal markets** (`marketMatchesDeal`): a market that names the target (by name or ticker) and speaks of a deal, a closing or a regulator.

## From Edge into the Terminal

Every feed card whose kind has a monitor carries a chip in its header ("SAT ET", "ALT PFE", "MARB") that opens it in the Terminal (`terminalLink` in `src/lib/edge/links.ts`).

## Files

- Registry and parsing: `src/lib/functions.ts` (MARB, SAT, FLR, ALT, EVTS; `SAT XOM` and `ALT NVDA` take the ticker after the code).
- Pure logic: `src/lib/terminal/edge-math.ts`, `src/lib/terminal/edge-signals.ts`.
- Server views: `src/lib/terminal/edge/{common,marb,sat,flr,alt,evts}.ts`; route `GET /api/terminal/edge/<marb|spread|sat|flr|alt|evts>`.
- Screens: `src/components/terminal/screens/{edge-kit,MarbScreen,SatScreen,FlrScreen,AltScreen,EvtsScreen,EdgeCardDrill}.tsx`, wired in `Panel.tsx`, `Rail.tsx` and `HelpOverlay.tsx`.

## Not yet

- No stated expected-close date is read from the filings yet (not one of the deal fields), so most closes are estimates.
- Collars, CVR values and dividends to close are not in the spread.
- SAT's map is a locator, not imagery tiles; the full map is GEO.
- Candidates for the next round: SPLC (supply chain from the relationship graph), RV (alt-data signals against peers), ALRT (an alert monitor over watches) and saved multi-panel layouts.
