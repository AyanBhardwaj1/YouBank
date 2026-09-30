# Edge: product and technical spec

Edge is a new pinnable YouBank tab that gives every role an alternative-data edge. It brings four
frontier AI techniques together as modules. People combine them on a visual canvas, watch what
matters, and get a visual feed of what changed:

| Module | UI name | What it gives you |
|---|---|---|
| RAG 2.0 | **Documents · RAG** | Cited answers across filings, calls, data rooms, the workspace, news and the web. |
| GNN | **Networks · GNN** | Relationship graphs, and predictions trained on them. |
| Synthetic data | **Scenarios · Synthetic data** | Realistic simulated markets, company what-ifs and practice data, always labeled. |
| GeoAI | **Earth · GeoAI** | Satellite, shipping and hazard intelligence on real assets. |

This spec records the decisions made with the founder in a 20-round Q&A on 2026-09-29. "Done" means
every decision below, at full depth, working end to end on real data, with the Permian hero demo
polished.

## Who it is for and how it ships

- **Audience.** Every YouBank role. The modules are the same for everyone; each role gets its own
  starter canvases, suggested watches and feed ranking.
- **Release.** An opt-in beta ("Try Edge beta" in Settings), free during the beta. It is bounded by
  the per-person AI caps and by the beta limits: 5 watches and 3 deployed monitors per person, with
  busy periods queueing rather than failing.
- **Tab.** "Edge", pinnable in the top bar like every other feature.
- **Onboarding.** Edge reads the person's role and watchlist, builds a starter canvas and three
  watches (for example, their firm's assets), and runs them, so the feed is alive on day one.
- **Mobile.** The feed, alerts and published stories work on phones. Building canvases works on
  desktop and tablet.

## Screens

- **Home: a visual feed plus canvases.** A Newsroom-style feed of visual updates about everything
  the person watches: maps, networks, scenario charts and evidence boards. Canvases are one click
  away.
- **Watch items:**
  - companies and their assets (plants, rigs, pipelines, mines, stores, ports, data centers,
    suppliers);
  - places drawn on the map;
  - people and networks (public roles only);
  - themes and sectors.
- **Feed ranking.** A blend of four signals, tunable per person with a slider:
  - relevance to your watches and role;
  - size of the change;
  - novelty (not yet in the news);
  - confidence.
- **Feed scope.** Your own watches, your team's, and anonymized "trending across Edge".
- **Cards.** Each card shows a confidence level, a short "why we think so", and its sources.
  History goes back 12 months, built up per watch.
- **Deal what-ifs.** Both kinds:
  - **Automatic:** when the Newsroom detects a deal or rumor touching a watch, Edge builds the
    pro-forma picture: combined footprint, overlaps, network changes and likely divestitures.
  - **Manual:** a what-if tool for any combination of companies.
- **Visual style.** Mixed per module: satellite and 2D maps for places, networks for relationships,
  charts for scenarios, and 3D where it adds something (terrain, a site). Transitions are
  cinematic, and respect reduced-motion.

## The canvas

- **Nodes.** Module nodes that work with sensible defaults and expand into editable steps (for
  example, Networks expands into "pull supply graph", "filter", "score contagion" and "rank").
- **AI builder.** Describe a goal and AI lays out the nodes and wires. While you build, it suggests
  the next node and flags broken wiring.
- **Running.** Data visibly flows along the wires, and each node shows a live mini preview (a map
  thumbnail, a graph, a chart). The results panel fills in as steps finish.
- **Run modes.** Run on demand, then "Deploy" a working canvas as a monitor that re-runs on a
  schedule and alerts on changes.
- **History.**
  - Like Studio: undo, named checkpoints, and every run saved with its inputs, outputs and cost.
  - Branches: fork a canvas into variants (a bull and a bear case) and compare their outputs side
    by side.
- **Sharing.** Team co-editing like Studio, following team roles (viewers look, editors change).
- **Story mode.** "Publish" turns a run into a scrolling visual report (map, then graph, then
  scenarios, then a cited memo) that exports to PDF or PowerPoint.
- **Outputs.** Every canvas can produce:
  - a cited memo or brief;
  - a live signal with alerts;
  - a push into Studio;
  - a dataset export (CSV or Excel);
  - the visuals.
- **Starter canvases:**
  1. Asset watch + deal pro-forma. This is the hero.
  2. Supply-chain shock memo.
  3. Target + buyer finder.
  4. Data room diligence.

## Hero demo: Permian gas pipelines from space, then a deal

1. Edge watches a company's Permian gas-gathering and transmission network (for example, Energy
   Transfer, Kinder Morgan or Enterprise Products). It uses:
   - EIA and HIFLD pipeline maps;
   - facilities that AI extracts from filings;
   - Sentinel-2 imagery, with change detection for new laterals, compressor stations and
     construction scars.
2. When a deal touches the network, the combined footprint appears with overlaps, adjacency by
   county, likely divestitures (antitrust overlap) and GNN buyer predictions with their reasons.
3. The results flow into a cited memo, a Studio map slide and a scenario sheet.

## Modules

### Documents · RAG

- **Sources:**
  - SEC filings and earnings calls;
  - uploads (data rooms): PDF, Excel, PowerPoint, Word, scans (OCR, with tables extracted as
    tables), email threads (.eml/.msg);
  - the workspace: CRM mail and notes, Studio models and decks, tool runs, Newsroom saves;
  - the Newsroom archive;
  - the live web.
  - Non-English documents are searched in English and cited in the original, with a translation.
- **Audio and video.** Earnings calls and investor days; podcasts, conferences and YouTube; and the
  user's own recordings. All are transcribed with speakers and timestamps, and tone and hedging are
  flagged.
- **Strictness, switchable per question.**
  - **Strict** is the default for memos: every claim quotes a passage, a checker removes anything
    unsupported, and the answer says "not found" when the evidence is missing.
  - **Balanced** is the default for exploring: inference is marked as analysis.
- **Answer form.** Adapts to the question: a direct answer first, then a table, timeline or memo,
  with citations everywhere.
- **Citations.** Open a side viewer at the exact page with the passage highlighted. Audio jumps to
  the timestamp.
- **Visuals, by context:**
  - an evidence board for answers (claims linked to passages, contradictions in red);
  - a change radar for filings and calls (what changed quarter to quarter);
  - a topic map for big corpora.
- **Uploads.** Private to the uploader, shareable with a team. Kept until deleted; deletion also
  removes embeddings and transcripts. A per-person beta quota of about 500 MB and 300 files, shown
  as a meter.

### Networks · GNN

- **Graphs:**
  - ownership and control (Exhibit 21, 13D/13G, Form 4);
  - boards and executives (interlocks, moves);
  - supply chain (10%+ customers, news, trade);
  - deals and investors (M&A history, syndicates, advisers, lenders).
- **Models.** Real trained GNNs in v1. They retrain weekly, and predictions for affected companies
  refresh when a relevant deal or filing lands.
- **Findings:**
  - likely acquirers and targets;
  - warm intro paths;
  - contagion and exposure;
  - hidden links and red flags (shared directors, related parties, circular ownership, sudden
    insider exits).
- **Trust.**
  - A backtest scorecard per prediction type (for example, "the actual buyer was in its top 5 for
    11 of the last 20 energy deals").
  - Explanations as reason paths drawn on the graph, with citations.
- **Views.** Switchable: a force network, a map-anchored view (nodes at real HQs and assets), and
  ownership trees.
- **CRM.** Teams can pool contacts, opt-in, so warm-intro paths use everyone's network. A warm
  path becomes an intro request drafted through the person's autopilot rules (it may send within
  their limits).

### Scenarios · Synthetic data

- **Uses:**
  - market scenarios and stress tests;
  - company what-ifs that feed Studio;
  - filling data gaps (as labeled estimates with ranges);
  - practice and demo data.
- **Methods, by data type:**
  - statistical models for markets (bootstrap, copulas, GARCH, regimes);
  - deep generative models (diffusion or TimeGAN, CTGAN) for complex joint data;
  - an LLM for documents.
- **Scenario drivers:**
  - history replays (2008, 2020, the 2022 rate shock, oil in 2014–16);
  - live-event scenarios proposed from the Newsroom, GeoAI and the graph;
  - shocks the person sets;
  - AI-imagined tail risks, with their reasoning.
- **Size.** A 1,000-path preview in seconds; "Refine" runs 10,000+ in the background.
- **Honesty.**
  - Synthetic data is labeled everywhere: a visible "synthetic" tag with its recipe and seed on
    every number, chart and Studio cell.
  - A validation view shows real and synthetic data side by side, with a realism score.
  - Practice companies are fully fictional.

### Earth · GeoAI

- **Targets:**
  - industrial and energy: construction, flaring, storage fill levels, drilling activity;
  - shipping and trade;
  - hazards and climate: wildfire, flood, hurricane, drought and heat, against watched assets;
  - consumer and real estate: activity, construction starts, night lights.
- **Data, all free by default:**
  - imagery: Sentinel-2, Landsat, VIIRS;
  - hazards: NASA FIRMS, NOAA;
  - public asset maps: EIA, HIFLD, OpenStreetMap, global plant and mine databases.
  - Paid imagery (Planet) and AIS ship data are built, but switched off until there is a budget.
- **Asset locations:**
  - public maps;
  - AI extraction from filings and news, geocoded;
  - uploads (KMZ/KML, shapefiles, CSV);
  - drawing on the map.
- **Analysis.** Geospatial foundation models (NASA/IBM Prithvi, Segment Anything) in the ML service
  detect changes, and a vision LLM explains them in words.

## Everywhere else in YouBank

- **Terminal.** `EDGE <ticker>` opens the overview, and GEO, NET, SIM and ASK open panels beside DES
  and COMPS.
- **Newsroom.** Deal cards show an inline pro-forma map that opens the full what-if in Edge.
- **Studio and the Office add-in.** Maps, networks and scenario sheets are pushed live with review:
  Studio shows "update available" with a diff, and accepted updates are tracked in history. The
  add-in handles Excel and PowerPoint.
- **CRM.** Warm-intro drafts, and Edge findings attached to accounts.
- **Alerts.** Big changes go out immediately (in-app, email, push, Slack, through the Newsroom's
  delivery), and everything else goes into a daily visual digest.

## Compliance

- **Audit trail.** A full trail for every datum: source, license, retrieval time, and method with
  model version. Any memo or signal exports an audit log for compliance teams.
- **People.** Public roles only; no tracking of individuals' movements or personal lives.
- **Synthetic data.** Never passes for real (see Scenarios).

## Architecture

| Part | Choice | Free tier (checked 2026-09-29) |
|---|---|---|
| App | The existing Next.js 16 app on Vercel; Edge lives under `/app/edge` with routes under `/api/edge` | |
| Canvas | React Flow (xyflow) with custom module nodes | open source |
| Maps and 3D | MapLibre GL with free vector tiles and terrain; deck.gl layers | open source |
| Networks | WebGL graph renderer (sigma.js or cosmos) for large networks | open source |
| Database | Neon Postgres: pgvector for embeddings, edge tables for the graph, runs and audit trail | needs the paid Neon plan from the launch audit |
| Files | Cloudflare R2 (S3 API): uploads, audio, imagery tiles, model artifacts | 10 GB-month, 1M/10M operations, free egress |
| Workflows | Inngest: every canvas step is a retryable step; schedules, fan-out, run history | 50k executions/month, 5 concurrent steps |
| ML service | Python on Modal: GNN training and inference (PyTorch Geometric), Prithvi/SAM change detection, deep generative models, transcription; scales to zero | $30 compute/month, 5 crons |
| LLMs | The existing OpenAI/Anthropic setup, under the AI spend caps | |

- **Edge budget.** $0 until revenue. Everything degrades gracefully at free-tier limits: runs queue
  and paid sources stay off.
- **Metering.** Each run records its cost (AI, ML seconds, storage).
- **Accounts the founder creates.** Modal, Inngest and Cloudflare R2. Their keys go in `.env.local`
  and are then pushed to Vercel.

## Build status

| Milestone | Scope | Status |
|---|---|---|
| 1 | Edge tab and beta switch, watches, the feed, Earth · GeoAI on the Permian (EIA maps, Sentinel-2 before and after, the deal pro-forma map) | Built (2026-09-30) |
| 2 | Canvas and run engine | Next |
| 3 | Documents · RAG | |
| 4 | Networks · GNN | |
| 5 | Scenarios · Synthetic data | |
| 6 | Integrations (Terminal, Newsroom, Studio, CRM), story mode, monitors and alerts, onboarding canvas | |

### What milestone 1 does

- **Switch.** Settings, Labs, "Try the Edge beta" (or the button on `/app/edge`). Turning it on pins
  the tab, seeds three watches (the Permian, then the person's firm and watchlist names that have
  mapped assets, falling back to ET and KMI) and checks them straight away. Turning it off hides the
  tab and stops the daily checks for that person; their watches are kept.
- **Watches.** Companies (by ticker) and places (the Permian, Delaware and Midland basins, the Waha
  hub, or a drawn box under about 500 km across). Five each during the beta. Team members' watches
  show in each other's feeds.
- **Feed** (`/api/edge/feed`). Findings that touch the person's watches and their team's, plus
  trending ones (counts of watchers only, never who). Ranked by relevance, size, novelty and
  confidence, weighted per role and tunable with sliders. Twelve months of history, 20 cards a page.
- **Ground change** (`src/lib/edge/detect.ts`, `change.ts`). Each watched company's plants,
  least recently checked first, compared with the same 2.5 km box a year earlier in the clearest
  Sentinel-2 scenes (10 m). How a change is found:
  - The newer image is normalized on the pixels that did not change.
  - Sentinel-2's scene classes remove cloud, shadow and vegetation.
  - New bare ground must be much brighter, above the scene's median and pale (caliche, gravel,
    concrete). New dark surfaces must lose 40% of their brightness and not be plant green.
  - Only compact blobs count, and a box that changed everywhere is skipped.
  - A card needs one change of at least 0.5 ha and a confidence of at least 0.25. A small vision
    model describes the change within the AI caps.
- **Deal pro-forma** (`proforma.ts`, `dealwatch.ts`). For any two to four companies, or
  automatically for Newsroom acquisitions and mergers where both sides own mapped assets, it computes:
  - each side's pipeline kilometres, plants and processing capacity;
  - counties both operate in and neighbouring counties;
  - pipelines within a kilometre of each other, and plants within 25 km;
  - each county's processing HHI before and after, screened at 1,800 with a +100 change (2023
    Merger Guidelines), naming the smaller side's plants in flagged counties as likely divestitures.
- **Map.** MapLibre on OpenFreeMap vector tiles, with a Sentinel-2 mosaic of the last 45 days from
  zoom 8. Pipelines and plants are coloured by watched company or deal side. Counties are shaded by
  the screen. Browsers without WebGL get a message instead of a map.
- **Audit trail.** Every card records its sources (name, URL, license, method, model version,
  retrieval time) in `edge_provenance`. "Audit trail (CSV)" on the card exports them.
- **Daily pass.** `/api/cron/edge` at 07:30 UTC. It refreshes the maps weekly, checks each distinct
  watched target of beta users not checked in 20 hours, then scans the last three weeks of deals.

### How the detector was checked

Eight sites were read by eye against the overlay, then 13 findings across ET, EPD, OKE and TRGP. At
the final settings:

| Site | What is there | Result |
|---|---|---|
| Orla (ET) | Two new ponds and two round tanks | Found, confidence 0.75 |
| South Eddy Cryo (EPD) | A new white pad beside the plant | Found, 0.83 |
| Mentone | A drained pit | Found, 0.43 |
| Panther (ET) | A new pad with equipment | Found, 0.41 |
| High Plains (TRGP) | The plant pad extended | Found, 0.27 (a greener year before) |
| Rebel (ET) | A new access road | Found, 0.27 |
| Bone Springs (ET) | A pond filled; irrigated fields greened | The pond found; fields ignored |
| Red Bluff, Arrowhead | Nothing new | Quiet |
| Sale Ranch | A wet year against a dry one (creeks, tracks) | Quiet |
| Snyder (KMI) | Ploughed farm fields | Quiet |

Two false-positive patterns drove the rules. Vegetation darkening once made Red Bluff report 110 ha
of change. Tan soil brightening (farm fields, a dry year) triggered on farmland. Full-distribution
brightness matching was replaced after a synthetic test showed it erases a new pad that is the
brightest thing in view. `scripts/test-edge.ts` (56 checks, in preflight) covers these cases on
synthetic scenes.

### Known limits and follow-ups

- **Imagery is hotlinked.** Card images are rendered on request by Microsoft Planetary Computer's
  data API. Once the Cloudflare R2 keys are in, crops move to R2 so heavy traffic does not lean on
  MPC.
- **The data is old or coarse in places.**
  - EIA plant capacities are from 2017.
  - The EIA pipeline map has transmission and intrastate lines, not most gathering, so a gatherer
    like Targa shows no pipeline kilometres.
  - A county is a rough antitrust market. Cards say so.
- **Only the Permian is mapped so far.** Other basins need their asset maps loaded (the same EIA
  layers cover the U.S.).
- **Detection is pixel-based.** The Prithvi or Segment Anything models on Modal replace or confirm
  it once the Modal keys are in. The pixel method stays as the free fallback.
- **MPC is sometimes slow.** One pass saw a request take over a minute. Every check has a deadline,
  and a site that times out is simply checked on the next pass.
