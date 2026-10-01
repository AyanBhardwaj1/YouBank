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
  - Paid imagery (Planet) is built and switched off until its key is set; AIS ship data is planned
    (see `docs/edge-roadmap.md`).
- **Asset locations:**
  - public maps;
  - AI extraction from filings and news, geocoded;
  - uploads (KMZ/KML, shapefiles, CSV);
  - drawing on the map.
- **Analysis.** Geospatial foundation models (NASA/IBM Prithvi, Segment Anything) in the ML service
  detect changes, and a vision LLM explains them in words.
- **Terrain.** Free elevation data, best first:
  - USGS 3DEP lidar at 2 m, where it has been flown;
  - USGS 3DEP at 10 m across the United States;
  - Copernicus at 30 m worldwide.
- **What terrain gives.**
  - For a site: its slope, relief, and where it sits against the ground around it.
  - Under a ground change: the ground before it, and the earth new bare ground took to level (balanced
    cut and fill).
  - For a pipeline: its elevation profile.
- **3D.** The map tilts over the terrain with shaded relief, and plants stand as columns by capacity.
  On the Networks map, deal and ownership links rise as arcs.

## Everywhere else in YouBank

- **Terminal.** `EDGE <ticker>` opens the overview, and GEO, NET, SIM and ASK open panels beside DES
  and COMPS.
- **Newsroom.** Deal cards show an inline pro-forma map that opens the full what-if in Edge.
- **Studio and the Office add-in.** Edge results are pushed with review: Studio and the Excel add-in
  list what is waiting and what it would add, and an accepted push is one run in History that can be
  undone. Accepted changes reach Excel through the add-in's sync, and PowerPoint through its deck
  refresh.
- **CRM.** Intro requests drafted from warm paths under the person's autopilot setting, and Edge
  findings on the contacts and pipeline deals at the companies concerned.
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
| 2 | Canvas and run engine; platform services (R2 files, Inngest jobs, the Modal ML service, free-tier meters) | Built (2026-09-30) |
| 3 | Documents · RAG | Built (2026-09-30) |
| 4 | Networks · GNN | Built (2026-09-30) |
| 5 | Scenarios · Synthetic data | Built (2026-09-30) |
| 6 | Integrations (Terminal, Newsroom, Studio, Office, CRM), story mode, monitors, alerts and the digest, onboarding canvas, audit export | Built (2026-09-30) |
| Upgrade round | New free data and models in every module, speed and accessibility work, paid upgrades built behind switches (see below and `docs/edge-roadmap.md`) | Built (2026-10-01) |

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

### What milestone 3 does (Documents · RAG)

- **Sources.** SEC filings (10-K, 10-Q, 8-K with Exhibit 99 press releases, proxies, S-4s; read once
  and shared), uploads (PDF with OCR for scans, Word, Excel, PowerPoint, email as .eml/.msg, text,
  CSV, HTML, images), recordings (uploads or a direct audio link; YouTube forbids downloads), the
  person's workspace (CRM mail and notes, Studio models and decks, tool runs, saved stories), the
  Newsroom archive and the live web. Files arrive in 4 MB parts (`src/lib/edge/docs/uploads.ts`);
  the ML service parses and transcribes them; passages are embedded (512 dimensions) and indexed for
  both vector and keyword search (`store.ts`).
- **Answers** (`answer.ts`). Sub-queries, hybrid search fused by reciprocal rank, a reranker, then an
  answer written only from numbered passages. Every quote is checked against its passage in any
  script (`text.ts`: only articles, hyphenated line breaks and marked omissions may differ). Strict
  drops what fails and says "not found"; balanced marks inference as analysis. Contradictions are
  flagged; quotes in other languages get a translation. Progress streams to the page.
- **Screens** (`src/components/edge/docs/`). Ask with scope and strictness; the evidence board
  (claims wired to passages, contradictions in red); the source viewer (a PDF page drawn with pdf.js
  and the quote highlighted, a recording playing from the quoted second with speaker hedging and
  tone, or the passage in context); the library with the 500 MB and 300 file quota meter and team
  sharing; the change radar (a company's latest 10-K or 10-Q against the previous one, section by
  section, with word-level edits; or any two documents or calls compared by meaning, edits and tone);
  and the topic map (UMAP on the ML service, principal components here as the fallback).
- **Feed.** When a watched company files a 10-K or 10-Q, a card lists what its risk factors added,
  dropped and reworded (`filingwatch.ts`, from the daily cron).

### What milestone 4 does (Networks · GNN)

- **The graph** (`src/lib/edge/graph/`), built from EDGAR for the listed energy universe (about 210
  companies by industry code) plus every watched company, refreshed weekly and on demand:
  - Form 4: directors, officers and 10% owners, with their trades;
  - Schedule 13D/13G (old text and new XML): 5% holders and exits, and stakes the company holds;
  - Exhibit 21: subsidiaries, matched to listed companies, so joint ventures show as shared ones;
  - the 10-K: named customers and suppliers with their share of revenue (read by a small model,
    kept only when quoted);
  - deals: merger filings found with EDGAR full-text search (a small model reads one to say who is
    buying whom, quoting it), 8-K Item 2.01 completions, and the Newsroom's deal tracker with its
    advisers. Affiliate roll-ups and internal reorganizations are kept as links but not as deals;
  - 8-K items (auditor changes, restatements, delisting notices, impairments, departures);
  - size from XBRL and headquarters located with the Census geocoder.
- **The deal model.** A relational GraphSAGE model on the ML service, trained on rolling time
  snapshots and backtested on the most recent deals against a features-only baseline; retrained on
  Sundays and when a new deal is announced. Its scorecard reads "the actual buyer was among its top 5
  likely buyers for n of the last m deals".
- **Findings** (`findings.ts`). Likely buyers and targets, each explained by up to three paths
  through the graph (never through index funds that hold everyone) and by what the two share on the
  ground (processing plants within 25 km on Earth's maps); exposure to a shock, through customers,
  suppliers, joint ventures and controlling stakes; red flags (restatements, auditor changes, insider
  exits and selling clusters, circular ownership, a director on both sides of a business
  relationship); warm introductions from the person's CRM contacts (and their teammates', when they
  opt in); the ownership tree.
- **Screens** (`src/components/edge/net/`). A force network on a canvas, the map-anchored view and
  the ownership tree, beside tabs for each finding, with every step linked to its filing. Feed
  cards post new red flags of watched companies and changes in their likely buyers.

### What milestone 5 does (Scenarios · Synthetic data)

- **Data** (`src/lib/edge/scen/data.ts`). Tickers' daily returns (Nasdaq first, FMP as the backup),
  and daily factors since 2000, all public and none from FRED: the U.S. market and oil and gas stocks
  (Kenneth French's CRSP-based data library), WTI and Henry Hub spot prices (EIA), and the 10-year
  Treasury yield (the Treasury). Rebuilt weekly into R2.
- **Market scenarios** (`market.ts`, `models.ts`). Each ticker's betas to the factors on three years
  of daily returns. Base cases by GARCH(1,1) with a Gaussian copula and Student-t shocks, two
  regimes (a hidden Markov model), a stationary block bootstrap, or (refined) a diffusion model on
  the ML service. Drivers: replays of 2008, 2020, the 2022 rate shock and the 2014-16 oil collapse
  (the factors' real daily moves); written shocks ("oil -30%, rates +150bp", or a sentence a small
  model maps to moves); scenarios proposed from the Newsroom, Earth and the graph, with citations;
  and AI-imagined tail risks with their reasoning. Replays and shocks add each ticker's real
  residual days, resampled. A thousand paths in about a second; "Refine" runs ten thousand (or two
  thousand from the diffusion model) in the background.
- **Honesty.** Every result carries its recipe and seed, and a realism check: synthetic days against
  the real three years (distribution distance, volatility, tails, volatility clustering,
  correlations), scored out of 100 with warnings. On ET, KMI and TRGP the bootstrap scores about 94,
  GARCH about 89, factor scenarios about 86 and the diffusion model about 91.
- **Company what-ifs** (`company.ts`). A company's XBRL history run forward under volume, price and
  cost shocks that fade at a chosen pace: revenue and EBITDA with their own volatility, costs 30%
  fixed and taking the share of a price move estimated from the company's own history, free cash
  flow before interest. Bands per year, the odds of a worse year, and a labeled CSV for Studio.
- **Synthetic tables and gaps** (`tables.ts`). A Gaussian copula copy (or CTGAN on the ML service for
  large tables) with realism against the original; identifying columns are replaced, never copied.
  Missing cells are estimated from the most similar rows, with ranges, and marked as estimates.
- **Practice data** (`practice.ts`). Fictional companies (names and tickers checked against every
  listed company) with financials drawn from real energy companies' ratios, prices from resampled
  real market days, practice documents in the library, and a workbook to download.
- **Canvas.** The Scenarios block (any driver, for wired-in companies, findings or deals) and the
  Synthetic data block (a labeled copy of a wired-in table).

### What milestone 6 does (Edge across YouBank)

- **Alerts and the digest** (`notify.ts`, `digest.ts`).
  - New findings are matched against everyone's watches.
  - Big ones alert at once through the person's Newsroom channels and quiet hours:
    - a ground change of 2+ hectares at confidence 0.6 or more;
    - a deal that screens high;
    - a filing that rewrote its risk factors;
    - a high-severity red flag.
  - The rest go into a daily visual digest: up to six findings, drawn as in the feed (satellite
    before and after, a filing's edits, a deal's footprint, a model's picks).
  - The digest is sent hourly by the job runner at each person's morning-brief hour, in their time
    zone, through the brief's channels. It always goes to the bell. Each finding is sent once.
- **Terminal** (`src/components/terminal/screens/EdgeScreens.tsx`). With the beta on:
  - **EDGE** is one company across Edge: findings, likely buyers and targets with the first reason
    path, red flags, assets on the map, and Watch.
  - **GEO** is its plants and pipelines with the ground changes on a map.
  - **NET** is the relationship graph and the findings tabs.
  - **SIM** runs a stress: `SIM`, `SIM 2008`, `SIM oil -30%`.
  - **ASK** asks the company's filings and the person's documents, with checked quotes.
  - Without the beta, GEO and NET stay tickers (GEO Group, Cloudflare); with it, `NET DES` reaches
    Cloudflare, as `PG DES` already did.
- **Newsroom.** A merger's story shows its pro-forma map when both sides own mapped assets, with
  "Open the what-if" (`/app/edge?view=whatif&parties=ET,TRGP&place=permian`). The deal tracker links
  each merger to the what-if.
- **Studio and Office** (`push.ts`, the Push to Studio block, Send to Studio on scenarios and answers).
  - A push adds new sheets and slides only, never edits to existing cells. Text that looks like a
    formula is kept as text, and synthetic tables say so in their first row.
  - The push waits in Studio's side panel and the Excel add-in until someone with edit rights
    accepts or dismisses it. A newer push from the same source replaces a waiting one.
  - Accepting commits it as one "Edge" run that History can undo; Excel picks it up on its next sync.
- **CRM** (`intros.ts`, `crm.ts`).
  - "Draft an intro request" on a warm path writes the email in the person's voice, to the contact or,
    for a teammate's pooled contact, to the teammate.
  - The request follows a new autopilot setting, "Intro requests from Edge's warm paths" (default
    Ask me). Off keeps copy-only.
  - Findings become signals on contacts and open pipeline deals at the companies named, matched as
    the Newsroom matches. A big one also suggests reconnecting, for approval.
- **Stories, onboarding and audit.**
  - The Story block publishes a scrolling report, private until shared, with PowerPoint and PDF.
  - Turning the beta on builds and runs a first canvas for the person's role.
  - The feed exports every card's audit trail as CSV.

### What the 3D and terrain release adds (2026-10-01)

- **Terrain** (`terrain.ts`, `ground.ts`, `/api/edge/terrain`).
  - Elevation comes from Microsoft Planetary Computer as raw arrays.
    - USGS 3DEP lidar, a bare-earth model at 2 m, from the newest survey flown before the change.
    - Else USGS 3DEP seamless at 10 m.
    - Else Copernicus GLO-30.
    - Tiles that cover parts of a site are merged on one grid.
  - For a ground change, the elevation is read on its change mask's grid, two cells to each mask cell.
  - Results:
    - slope (Horn's method) and relief;
    - where each change sits, as the share of the surrounding ground that is lower;
    - for new bare ground, the earth moved to level it flat at the height that balances cut and fill,
      plus a topsoil range.
  - Pipelines are sampled about 500 times along their EIA line. That gives climb and descent (with a
    noise threshold), extremes, and the steepest stretch.
  - Results are kept a month, and a finding's elevation source joins its audit trail.
  - On the test branch, Permian sites read 2018 and 2019 lidar. A 5 ha pad on a 1.5° slope came to
    about 27,000 m³ each way, and the Gulf Coast Express profile ran from 932 m to 19 m.
- **Where it shows.**
  - Ground-change cards have Terrain, with "See it in 3D".
  - On the map, clicking a pipeline shows its profile, and clicking a plant shows its ground.
  - The canvas Terrain block makes one row per site for memos, exports and Studio.
- **3D** (`EarthMap.tsx`, `net/NetMap.tsx`).
  - Earth maps (the region map, the what-if, Newsroom deal maps and Terminal GEO) get a 3D switch.
    It adds terrain from AWS Open Data's Terrain Tiles, relief exaggerated 1, 2 or 4 times, shaded
    relief, a sky, and plant columns sized by capacity until zoomed in close.
  - The Networks map's 3D switch tilts the map and draws each link as a raised arc. deck.gl draws the
    arcs on its own canvas, loaded only when 3D is first switched on.
- **Not done:** true 3D change detection needs paid data (see Known limits). That covers stockpile
  volumes, tank fill from shadows, and the height of new construction.

### What the October upgrade round adds (2026-10-01)

Everything here is free to run. Paid upgrades are built behind switches and stay off; administrators
see them, live, in Settings → Labs → Edge upgrades (`src/lib/edge/premium.ts`, `docs/edge-roadmap.md`).

- **Feed.**
  - Ranking reads only the light columns of each finding; full rows (with the images) are read only for
    the cards on screen. The first page and the person's Edge state arrive with the page itself, so the
    first paint needs no further request.
  - Kind chips (Ground, Radar, Flaring, Methane, Permits, Deals, Filings, Red flags, Model picks), a
    fortnight brief across the watches, skeletons shaped like the cards, Try again on errors, keyboard
    tab rows, the view kept in the address, a phone layout (module chips, the watch panel folded), and
    the views other than the feed loaded only when opened. The audit log now exports every finding, not
    the first 40.
- **Earth.**
  - **Flaring** (`flares.ts`): every mapped plant, daily, against NASA FIRMS's last seven days of VIIRS
    heat detections from three satellites (375 m). A plant that flared on three days or more (or two hot
    days) becomes a card: the days and radiant heat, a Sentinel-2 shortwave-infrared image where the
    flare glows (hot pixels counted), its weekly record, and in New Mexico what operators nearby reported
    flaring and venting to the OCD that month (C-115B). One card per plant a week, refreshed while the
    week runs; a chronic flare is not news again for two weeks unless it worsens.
  - **Radar change** (`radar.ts`, `sources/s1.ts`): watched plants in Sentinel-1 radar, which sees
    through cloud. Three passes now against three a year before on the same orbit, a per-pixel majority
    to beat speckle, and new persistent bright objects (steel and structures) counted, with damp ground
    and plant clutter guarded against. Each site is read every six days, a dozen a day.
  - **Drilling permits** (`permits.ts`): new permits within 10 km of each plant. New Mexico's OCD dates
    its approvals, so a jump (five or more in 30 days and twice the earlier pace) becomes a card. Texas's
    public map service has no dates, so Texas shows the count of permitted, undrilled locations on the
    map, and Edge keeps its own first-seen record; Texas cards start after 120 days of it.
  - **Sites in 3D**: the newest NAIP aerial photo (0.6 m) draped on the ground, with tanks, towers and
    other structures raised from USGS lidar heights, tank capacity estimated. **Month by month**: the
    clearest Sentinel-2 image of each month for two years, played like a film.
  - The map's asset data is slimmed and cached for the day; markers no longer re-upload the assets; the
    Terminal's GEO screen lists every kind of Earth finding.
- **Documents.**
  - Keyword search matches any term (it required all of them), ranked by how many distinct terms a
    passage holds; quoted phrases and exclusions work.
  - New ingests read filings from their HTML: passages of about 500 tokens that start at headings and
    keep tables whole (header and units repeated when a table must split), with a header line (company,
    form, period, section) embedded and matched by keyword search.
  - The answer model reads the chosen passages with their neighbours (about 8,000 tokens, it was about
    3,000; `EDGE_CONTEXT_CHARS` raises it), and claims whose quotes fail get one second reading by the
    small model.
  - A reranker step: Voyage or Cohere when their keys are set, else the ML service's free cross-encoder,
    warmed when the Ask panel opens. A 30-question eval (`scripts/eval-docs.ts`) measured the search
    before and after: fused recall@5 0.85 → 0.97 on the three-filing set.
  - The PDF viewer renders in a worker; the library polls only while visible and backs off on errors;
    the citation viewer traps focus.
- **Networks.**
  - Influence (PageRank) and communities (label propagation over binding links) for the whole graph,
    with the people who bridge clusters; node size by influence.
  - Ownership rings of any length (strongly connected components), "Who owns it" by integrated
    ownership (Vitali, Glattfelder and Battiston 2011), and a Clayton Act section 8 screen of shared
    directors and officers at competitors above the FTC's 2026 threshold ($54,402,000), labelled a screen,
    not legal advice. Seats count as shared only when both were held at the same time.
  - The deal model's scorecard now shows hits@10 with a 90% bootstrap interval and fair baselines on
    the same split (Adamic-Adar, acquisitiveness), and says plainly when the model does not beat one. A
    direction swap in the scorecard (buyers read the targets' figure) is fixed.
  - Public views (company, subgraph, map, tree, owners) are cached for everyone, keyed by the graph's
    version; the overview reads aggregates instead of up to 8,000 rows; plant pairs are one query.
- **Scenarios.**
  - The default generator is GJR-GARCH with Student-t shocks (falls raise volatility more than rises)
    drawing whole real days of shocks (filtered historical simulation); a t-copula is the alternative.
    Realism v2 scores each stylised fact against bands from a block bootstrap of the real data, and a
    copy check catches generators that replay history.
  - Narratives become views per factor (median, range, probability, horizon, a historical analog),
    anchored to the analog's severity, checked for plausibility, with unmentioned factors filled by
    their conditional means, then imposed on the paths by Entropy Pooling; a result is refused when too
    few effective scenarios remain.
  - Synthetic tables default to sequential trees (CART) with an 80/20 holdout and privacy checks (DCR
    share, NNDR, exact copies, a membership-inference test).
- **Canvas.** Dragging a block no longer rebuilds every block; runs poll a light view and fetch the
  full run once at the end; selection, Delete and multi-select work; the compare view is a proper
  dialog; phones get the inspector as a bottom sheet; a loading skeleton.
- **ML service** (Modal, version 8, smoke-tested on a staging copy first; about $0.30 of credit to build
  and test).
  - Satellite checks use Prithvi-EO-2.0-300M-TL and Segment Anything 2.1, with the older pair as the
    fallback; on Orla the unchanged control area's score fell from 0.14 to 0.07 while the new pond stayed
    at 0.99.
  - English audio is transcribed by NVIDIA's Parakeet TDT 0.6B v2 (CC BY 4.0) with word timings, other
    languages by Whisper: word errors 3.1% against 7.2% on a LibriSpeech sample.
  - New tasks: `docs.rerank` (a cross-encoder, ettin-reranker-32m) and `geo.embed_change` (year-over-year
    change in Google DeepMind's AlphaEarth embeddings, which picked out Orla's new ponds and stayed quiet at
    three unchanged plants). The latter is not wired into the app yet.
- **Platform.** Edge's small AI steps use gpt-6-luna (half the price of gpt-5.6-luna, checked on the
  account for text and images; `EDGE_SMALL_MODEL` overrides it). The upgrades registry and its Settings
  panel. A FIRMS archive backfill of the flaring record once a free MAP_KEY is set.

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

- **Imagery is hotlinked.** Card and digest images are rendered on request by Microsoft Planetary
  Computer's data API. R2 is now set up; copying crops there, so heavy traffic does not lean on MPC,
  is a follow-up.
- **The data is old or coarse in places.**
  - EIA plant capacities are from 2017.
  - The EIA pipeline map has transmission and intrastate lines, not most gathering, so a gatherer
    like Targa shows no pipeline kilometres.
  - A county is a rough antitrust market. Cards say so.
- **Only the Permian is mapped so far.** Other basins need their asset maps loaded (the same EIA
  layers cover the U.S.).
- **Detection is pixel-based, confirmed by foundation models.** Each new change is sent to Prithvi and
  Segment Anything on the ML service, which raise or lower its confidence. The pixel method stays as
  the free fallback.
- **Graph coverage is energy first.** The deal model trains on the energy universe; companies from
  other industries are mapped when watched or asked about, and their predictions improve as the
  universe grows. Private companies appear only through filings that name them.
- **MPC is sometimes slow.** One pass saw a request take over a minute. Every check has a deadline,
  and a site that times out is simply checked on the next pass.
- **Terrain is a snapshot, not a change.**
  - Lidar surveys are dated, for example 2018 or 2019 in the Permian. Cut and fill therefore assume
    the survey predates the work, and a card says so when it may not.
  - Measuring 3D change itself needs sub-metre imagery or repeated lidar, which are not free. That
    covers stockpile volumes, tank fill levels and construction height.
  - Pipeline profiles follow EIA's drawn line, which only approximates the route.
