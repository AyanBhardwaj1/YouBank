# Edge next: new AI and technology features

The design for Edge's next round. It proposes 14 new features. Each one is specified closely enough for the
builder to implement it and for the pricing work to tier it. Written on 2026-10-05 against the
premium-features branch: plan gating, the premium scope (`src/lib/billing/use.ts`), `requireFeature`, and the
feature registry (`src/lib/billing/features/*.ts`).

**Who reads this.**
- **The builder** implements the chosen set in section 5, in that order. Sections 3 and 4 are the spec.
- **The pricing work** tiers everything using the "Free and premium" part of each feature and the cost table in
  section 6.

**How to read a feature.** Every feature has the same parts:
- the pitch, the problem and who it is for;
- how it works: data, models, uncertainty, audit;
- where it plugs into Edge;
- the UI on desktop and phone;
- free against premium;
- tests, size and risks.

Sizes: **S** is under a week of builder time, **M** is one to two weeks, **L** is two to four weeks.

---

## Contents

1. [The bar these features meet](#1-the-bar-these-features-meet)
2. [Research: the frontier and the competition](#2-research-the-frontier-and-the-competition)
3. [Shared foundations (build these first)](#3-shared-foundations-build-these-first)
4. [The features](#4-the-features)
   - E1 [Precedent Engine](#e1-precedent-engine)
   - E2 [Calibrated Claims](#e2-calibrated-claims)
   - E3 [Alt-Data Pulse](#e3-alt-data-pulse)
   - E4 [Deal Radar](#e4-deal-radar)
   - E5 [Call Desk](#e5-call-desk)
   - E6 [LBO Stress Lab](#e6-lbo-stress-lab)
   - E7 [Thesis Agent](#e7-thesis-agent)
   - E8 [Management Track Record](#e8-management-track-record)
   - E9 [Supply-Chain Atlas](#e9-supply-chain-atlas)
   - E10 [Patent and Tech Landscape](#e10-patent-and-tech-landscape)
   - E11 [Buyer Simulator](#e11-buyer-simulator)
   - E12 [Regulatory Shock Simulator](#e12-regulatory-shock-simulator)
   - E13 [Voice Analyst](#e13-voice-analyst)
   - E14 [Deal Aftermath](#e14-deal-aftermath)
5. [Ranking, the chosen set and build order](#5-ranking-the-chosen-set-and-build-order)
6. [Premium features proposed (for the pricing work)](#6-premium-features-proposed-for-the-pricing-work)
7. [Licences to keep out (additions)](#7-licences-to-keep-out-additions)
8. [Open questions for the owner](#8-open-questions-for-the-owner)
9. [Sources](#9-sources)

## At a glance

| # | Feature | One line | Size | Rank | This round |
|---|---|---|---|---|---|
| E1 | **Precedent Engine** | A real precedent-transactions database built from EDGAR merger documents. Every field is quoted, and "deals like this one" are found by meaning. | L | 1 | **Yes (2)** |
| E2 | **Calibrated Claims** | Every claim in an answer or memo gets a calibrated support probability. Strict mode carries a stated, tested error rate. | M | 2 | **Yes (1)** |
| E3 | **Alt-Data Pulse** | Hiring, attention, government contracts, layoffs and patents as time series per company, with change-points that have a stated false-alarm rate. | M | 3 | **Yes (3)** |
| E4 | **Deal Radar** | A calibrated probability that a company announces a sale or a material acquisition in the next 6 or 12 months. It fuses weak public signals and keeps a public track record. | L | 6 | **Yes (4)** |
| E5 | **Call Desk** | Evasive answers on earnings calls, scored with calibrated probabilities. A ledger tracks every quantified promise management made against what it then reported. | M | 4 | **Yes (5)** |
| E6 | **LBO Stress Lab** | An LBO run over thousands of labelled synthetic macro and operating paths: IRR fans, covenant-breach odds, and the gentlest scenario that breaks the deal. | M | 5 | **Yes (6)** |
| E7 | **Thesis Agent** | An autonomous investigation that runs for days. It keeps a claim tree with probabilities, sets kill criteria as monitors, and has a red team. | L | 7 | **Yes (7)** |
| E8 | **Management Track Record** | Said-against-did, capital allocation, insider behaviour and pay against performance, each with shrinkage intervals. Public roles only. | M | 8 | Next |
| E9 | **Supply-Chain Atlas** | Supplier and customer links from contracts, filings, EIA fuel receipts and AIS, plus inferred links with calibrated odds. Shocks are propagated with uncertainty. | L | 11 | Next |
| E10 | **Patent and Tech Landscape** | Patent maps from patent embeddings, buyer and target technology fit, and citation dependencies. | M | 9 | Next |
| E11 | **Buyer Simulator** | A counterfactual sale process: buyers modelled as agents with valuations, capacity and participation odds, run through auction formats and calibrated on proxy "Background" sections. | L | 12 | Later |
| E12 | **Regulatory Shock Simulator** | Proposed rules mapped to the companies they hit, with cost ranges from the rule's own impact analysis and event-study priors from similar past rules. | M | 13 | Later |
| E13 | **Voice Analyst** | Hold to talk on a phone. Speech is recognised on the device, answers are cited, and a commute brief reads the feed aloud. Live conversation is premium. | M | 10 | Stretch |
| E14 | **Deal Aftermath** | Did past deals deliver their synergies? Synthetic-control estimates against announced synergies, with placebo tests. | M | 14 | Later |

---

## 1. The bar these features meet

Edge's existing modules set the bar. Each feature below meets all of these:

- **Real data with citations.** Every number names its source, licence, retrieval time and method in
  `edge_provenance`, the same way ground changes, flaring and graph findings already do.
- **Calibrated models with stated error.** Today's examples:
  - the deal model's scorecard: hits@10 with a 90% bootstrap interval against fair baselines;
  - the 0.25 and 0.6 confidence lines for ground changes;
  - the realism score for synthetic data.

  New probabilities go further. Each is logged when it is made, scored when it resolves, and shown with a
  reliability diagram (the forecast ledger, F3).
- **Audit trails.** Card CSV exports, saved runs, and every model version recorded.
- **UI on every surface.** The feed and alert cards, the canvas node, the Terminal code, and pushes to Studio,
  CRM and Newsroom where they fit. The phone layout is designed, not an afterthought.
- **Tests.** Pure functions sit in `scripts/test-edge.ts` (no network, no database), with fixtures for parsers.
  Quality metrics live in `scripts/eval-*.ts` scripts against the test branch.
- **Free first.** The core runs on free or public-domain data and free-tier compute. Paid layers follow
  `docs/premium.md`: they spend only on explicit use, the server checks the plan, and a free fallback always
  stays.
- **Honesty.** Synthetic output is labelled everywhere. A model that does not beat its baseline says so. "Not
  found" and "not enough data" are valid answers.

---

## 2. Research: the frontier and the competition

Web search was available for this round (2026-10-05), and results were checked against the providers' pages
where possible. arXiv itself could not be fetched from the sandbox, so details of papers come from search
summaries and abstracts. Items marked *(prior knowledge)* rest on my own knowledge and should be checked
before launch copy is written.

### 2.1 What is new, and what Edge takes from it

| Area | What changed in 2025–2026 | What Edge takes | Features |
|---|---|---|---|
| **AI agents** | Long-horizon agents that plan, call tools, and keep running over days are now normal. AlphaSense shipped custom agents and an AI interviewer for expert calls (March 2026). Hebbia builds spreadsheets and decks in chat (May 2026). Rogo automates earnings summaries and target decks. | An agent that runs on Edge's own audited tools, never free browsing. It holds a budget, and every step is logged. | E7, E13 |
| **LLM reasoning and verification** | Conformal factuality splits an answer into sub-claims, scores each, and filters with a calibrated threshold, so the unsupported-claim rate stays under a chosen level (Mohri and Hashimoto 2024, with adaptive and coherent variants in 2025–26). Recent work also warns that "calibration is not verification". | A claim-level support probability that combines Edge's quote check, reranker score, an NLI checker and number checks. The Strict threshold is conformal, and its measured rate is shown. | E2, used by E1, E5, E7 |
| **Multimodal and audio** | Evasion detection on earnings calls has a benchmark. EvasionBench (arXiv 2601.09142) has 84K training pairs and 1K human-validated pairs. Its Eva-4B classifier, Apache-2.0 on Qwen3-4B-Instruct, reaches 84.9% macro-F1 against frontier LLMs. Audio encoders add signal (arXiv 2609.13893). | Q&A pairs scored as direct, intermediate or fully evasive, with calibrated probabilities. The free path is a rubric on the small model; the premium path ensembles Eva-4B. Never called "lies". | E5 |
| **Forecasting foundation models** | Chronos-2 (120M parameters, Apache-2.0) handles multivariate series and covariates, and leads GIFT-Eval over TimesFM-2.5 and TiRex. TimesFM 3.0 and Moirai 2.0 weights are non-commercial. | Chronos-2 on the ML service as the free driver forecaster for rate and commodity anchors. TimesFM stays premium through BigQuery, as it is today. | E6, E3 (nowcast) |
| **Graph ML and relational FMs** | KumoRFM 2.0 is a relational foundation model, strong on RelBench, but production use needs a licence. ULTRA is MIT. Temporal link prediction benchmarks (TGB-Seq) show simple baselines are hard to beat. | Keep GraphSAGE plus fair baselines. Add LightGBM hazard models over graph features (E4) and inferred supply links (E9). A KumoRFM licence would be enterprise-only. | E4, E9 |
| **Alternative data** | Harmonic tracks 35M+ companies and 195M+ people, with headcount by department refreshed daily. PitchBook refreshes company data every 3–4 months. Free substitutes exist: public applicant-tracking APIs (Greenhouse, Lever, Ashby, SmartRecruiters), Wikipedia pageviews, CrUX popularity ranks, USAspending, WARN notices and PatentsView. | A per-company signal store with change-point detection that states its false-alarm rate, plus "tells" (IPO-readiness and integration hires). | E3, feeds E4 |
| **Geospatial AI** | Embedding fields (AlphaEarth) and Prithvi-EO-2.0 are already in Edge. AIS has free US-waters archives (NOAA Marine Cadastre, CC0) and a free live stream (aisstream.io, terms to check). | Port calls at mapped terminals as supply links. AIS stays a premium layer for live global coverage. | E9 |
| **Knowledge graphs** | GLEIF Level-2 parent records are CC0. Wikidata is CC0. OpenSanctions is CC BY-NC and needs a commercial licence. | An entity crosswalk joins CIK, LEI, domain, ATS board, patent assignee and award recipient, each link with evidence. | F1, E3, E9, E10 |
| **Causal inference** | Synthetic control and double ML are mature (Abadie et al.; EconML and DoWhy, both MIT). Event studies are standard. | Synthetic control for synergy realisation (E14). Event-study priors for rules (E12). | E12, E14 |
| **Simulation and agent-based models** | LLM bidders reproduce known auction behaviour qualitatively (AuctionArena, InfoBid, Horton's work), but their valuations are not calibrated. | Numbers come from a quantitative agent model calibrated on proxy "Background of the Merger" funnels. LLM personas only write the narrative. | E11 |
| **Synthetic data** | Edge already uses GJR-GARCH-t filtered historical simulation, Entropy Pooling and realism v2. | Reuse it as the macro engine under LBO paths. Entropy Pooling finds the gentlest breaking scenario. | E6 |
| **Voice** | OpenAI gpt-realtime-2.1 costs $32 per million audio-input tokens and $64 per million output, about $0.06–0.11 a minute. On-device ASR and TTS run in the browser (Transformers.js v4 WebGPU, Moonshine *(prior knowledge, MIT)*, Kokoro-82M *(prior knowledge, Apache-2.0)*). | Free voice on the device. The realtime conversation is premium. | E13 |
| **Computer use and browser agents** | Claude, OpenAI and Gemini all offer computer-use APIs at about $0.01–0.20 a task. Screenshots make them 3–10× the tokens. | Not in this round. Open-web browsing raises compliance and MNPI questions, so E7 uses typed tools only. It is listed as a future premium tool for IR sites without feeds (open question 6). | E7 (later) |
| **On-device AI** | Transformers.js v4 rewrote its WebGPU runtime. Small embedders and ASR now run in the browser. | Voice on the device. A later "clean room" option could embed and redact on the device before upload (open question 7). | E13 |
| **Real-time data** | Live sources are mostly paid (AIS, options, consensus). Edge's daily pass and hourly monitors cover filings and public signals. | Stay on public near-real-time sources: EDGAR's latest filings, Federal Register, ATS boards. Live AIS is premium. | E3, E4, E12 |

### 2.2 Competitors and adjacent tools

| Tool | What it does now | Where Edge can be different |
|---|---|---|
| AlphaSense (with Tegus) | Search over 200K+ expert transcripts, custom agents (March 2026), AI-led expert calls and "Channel Checks", diligence workspaces for M&A and PE | Edge has no expert network, and pretending otherwise would be wrong. It differs through public-data probabilities with track records, plus physical evidence from Earth. |
| Hebbia | Matrix-style document grids, spreadsheets and decks in chat, integrations with FactSet, Third Bridge, ICE and Intralinks | Edge already has evidence boards and checked quotes. Calibrated Claims (E2) goes further: a stated error rate. |
| Rogo | Bank-grade research assistant: earnings summaries, target presentations, buyer lists | Rogo's buyer lists are LLM-written. Edge's (E4, the GNN, E11) are scored models with backtests. |
| Brightwave *(prior knowledge)* | Research agents for funds that synthesise filings and news into reports | E7 adds days-long monitoring, kill criteria and probability tracking, not just one report. |
| Bloomberg *(prior knowledge)* | AI summaries of news and transcripts, document search inside the Terminal | Edge is free or cheap, open about its methods, and adds alternative data. |
| Palantir for finance *(prior knowledge)* | Ontologies, entity resolution and agent workflows over a firm's own data | F1, the crosswalk, is a small open ontology. Edge does not compete on deployment services. |
| Kpler, Vortexa | Commodity flows from AIS and terminals, licensed | E9 uses the free subset: US AIS archives, EIA fuel receipts and Census port trade. Kpler and Vortexa stay premium bring-your-own licences. |
| Orbital Insight *(prior knowledge)* | Geospatial analytics, such as tank fill and footfall | Edge Earth already covers part of this for free (Sentinel, lidar, flaring). |
| PitchBook, Harmonic | Private-company databases. Harmonic leads on people and headcount signals with daily refresh. | E3 gives a free hiring and attention pulse on any company with a public ATS board. E1 builds precedents from public filings, including private targets through ASC 805 notes. |

**The gap every competitor leaves:** no one publishes the calibration of its predictions. A deal tool whose
probabilities come with a public, automatically scored track record (F3) is new. It also suits the compliance
buyers who already ask Edge for audit trails.

---

## 3. Shared foundations (build these first)

Five pieces of infrastructure are shared across the features. Building them once is what lets the builder
deliver seven features in one round. All tables go in one additive migration, `drizzle/0016_edge_next.sql`. As
with 0013 and 0014, it is applied by hand: first on a Neon branch, then on production with the owner's
approval. The schema goes in `src/db/schema.ts`, beside the other `edge_*` tables.

### F1. Entity crosswalk (`edge_entity_ids`)

**Why.** Every new source names a company in its own way. Edge has to know that the same company is:
- CIK 1276187 at the SEC;
- Greenhouse board `energytransfer`;
- the recipient with a given UEI on USAspending;
- PatentsView assignee `…`;
- Wikidata `Q…`;
- the domain `energytransfer.com`.

**Table.**
```
edge_entity_ids(
  id serial pk, node_id int not null,            -- edge_nodes.id
  scheme text not null,                          -- cik | ticker | lei | uei | domain | wikidata | wikipedia | greenhouse | lever | ashby | smartrecruiters | patentsview | github | naics | crux_origin
  value text not null,
  confidence real not null default 1,            -- 1 for registry facts; < 1 for matches
  method text not null default '',               -- 'sec registry' | 'wikidata P856' | 'careers-page link' | 'name match (jaro 0.94)'
  evidence_url text not null default '',
  verified_by text not null default '',          -- '' (auto) | user id who confirmed or corrected
  created_at, updated_at,
  unique(scheme, value)
)
```

**How links are made, most to least certain:**
- SEC (CIK and ticker; existing `tickers.ts`).
- GLEIF (LEI with Level-2 parents; CC0; `https://api.gleif.org/api/v1/lei-records`).
- Wikidata (CC0; SPARQL at `https://query.wikidata.org/`): official website (P856), CIK (P5531), LEI (P1278) and
  ticker, giving domains and Wikipedia titles.
- The company's own careers page. Fetch the homepage and its `/careers` link, and look for Greenhouse, Lever,
  Ashby or SmartRecruiters embeds. The match is kept with the page URL as evidence.
- Name matching for patent assignees and award recipients. Edge already has `normName`; add Jaro-Winkler plus
  token overlap. A match below 0.9 goes to a review queue instead of being used.

People can confirm or correct a link ("Is this the right jobs board?"). A correction is logged and wins over
automatic links.

**Code.**
- `src/lib/edge/entities/` with `crosswalk.ts` (pure scoring and normalising), `resolve.ts`, and `sources/`
  (wikidata, gleif, careers).
- Routes: `GET /api/edge/entities?node=`, `POST /api/edge/entities` (confirm or correct; editors only).

**Tests.**
- Name normalisation.
- Jaro-Winkler thresholds on 40 fixture pairs (true pairs and traps: "Energy Transfer" against "Energy
  Transfer Equity", "Apple" against "Apple Hospitality").
- Careers-page detection on saved HTML fixtures.

### F2. Signal series store (`edge_series`) and the change library

**Table.** Weekly points per entity and metric. Daily raw pulls go to R2 as JSON lines, kept 400 days.
```
edge_series(
  node_id int not null, metric text not null,    -- jobs.open | jobs.new | jobs.dept.<d> | jobs.tell.<t> | wiki.views | crux.rank | usasp.obligated | usasp.awards | warn.employees | patents.grants | patents.apps | github.stars
  period date not null,                          -- the Monday of the week (or the month's first day for monthly metrics)
  value double precision not null,
  source text not null, retrieved_at timestamptz not null default now(),
  primary key (node_id, metric, period)
)
```

**Budget.** About 1,000 entities × 12 metrics × 52 weeks is about 620K rows a year, roughly 50 MB. That fits
beside the documents only on the paid Neon plan (open question 1). The daily pass refreshes watched entities;
the rest refresh weekly.

**Change library** (`src/lib/edge/series/`, pure):
- `robustZ`: log changes against a 26-week median and MAD.
- `seasonalNaive`: residuals against 52 weeks earlier, when a seasonal fit beats non-seasonal on the series'
  own backtest.
- `bocpd`: Bayesian online change-point detection (Adams and MacKay 2007) with a Student-t observation model
  and a hazard of 1/52. It gives a posterior probability that a change point fell in the last k weeks.
- `placeboRate`: runs the detector on block-shuffled copies of the same series to measure false alarms per
  entity-year.

**What a card says.** "Change probability 0.93; at this threshold the detector raises about one false alarm
every 4 company-years on this kind of series." That sentence is the stated error.

### F3. Forecast ledger and calibration (`edge_forecasts`)

Every probability Edge states about the future goes into an append-only ledger with a machine-checkable
resolution rule. A job resolves forecasts when their window closes, and a "Track record" view shows each
model's scores. No competitor does this. It is the feature that makes the others credible.

```
edge_forecasts(
  id bigserial pk,
  kind text not null,            -- deal_target | deal_acquirer | thesis_claim | guidance | evasion_followup | buyer_win | rule_final
  subject text not null,         -- node:123 | thesis:5:claim:3 | doc:88:commitment:4
  question text not null,        -- "Announces an agreement to be acquired by 2027-04-05"
  probability real not null,     -- calibrated point estimate
  low real, high real,           -- calibrated interval (Venn-Abers or bootstrap)
  base_rate real,                -- the reference-class rate shown beside it
  opens_at timestamptz not null, closes_at timestamptz not null,
  rule jsonb not null,           -- {type:'deal', role:'target', node:123} | {type:'xbrl', cik, concept, period, op:'>=', value} | {type:'manual'}
  model text not null, model_version text not null,
  owner_id text,                 -- null for shared (public-data) forecasts
  supersedes bigint,             -- the previous forecast of the same question
  resolved_at timestamptz, outcome real,      -- 1 | 0 | fraction; null until resolved
  resolution_source text not null default '', -- the filing or deal that settled it
  created_at timestamptz not null default now()
)
index (kind, closes_at) where resolved_at is null; index (subject)
```

**Rules.**
- Forecasts are never edited. A new score inserts a new row that `supersedes` the old one.
- Scoring uses only the forecast standing at a fixed horizon (for example, the score 12 months before the
  close), so frequent re-scoring cannot flatter the record.
- `manual` rules (for some thesis claims) are resolved by the owner with a note, and they are scored
  separately from the automatic ones.

**Calibration library** (`src/lib/edge/calib/`, pure, all tested on synthetic data with known probabilities):
- `isotonic` (pool-adjacent-violators);
- `platt`;
- `temperature` (multi-class);
- `vennAbers`, which gives a lower and upper calibrated probability, used for the interval shown;
- `splitConformal` (wrapping the existing `conformalQuantile` in `src/lib/inference/forecast.ts`);
- `brier`, `logLoss`, `murphy` (reliability, resolution and uncertainty), `ece`, `reliabilityBins`;
- `bootstrapCi`.

**Jobs and UI.**
- Daily resolver in the Edge daily pass: `resolveDue()`, rule type by rule type.
- `GET /api/edge/track?kind=`: reliability bins, Brier against the base-rate Brier, n, and the latest 20
  resolved forecasts with their outcomes.
- A **Track record** tab in Edge: one panel per model with a reliability diagram, Brier skill with a 90%
  interval, and a "resolved last month" list. It is public inside Edge, and the shared forecasts are
  anonymised.

### F4. Deal database (`edge_deals`, `edge_deal_fields`)

This is specified with E1, because the Precedent Engine builds it. It is listed here because E4 (labels), E6
(exit multiples), E8 (capital allocation), E11 (funnels) and E14 (cases) all read it.

### F5. Agent runtime (`edge_agents`, `edge_agent_steps`)

This is specified with E7. It is a small, typed runtime on Inngest. E13 reuses its tool registry for voice.

### Conventions every feature follows

- **New finding kinds** go in `edge_detections.kind`, with a `noveltyOf` base in `feed.ts`, an `isBig` rule in
  `notify.ts`, a chip in the feed, and a card component in `Cards.tsx`. They are listed per feature below.
- **Provenance subjects:** `deal:<id>`, `deal_field:<id>`, `series:<node>:<metric>`, `forecast:<id>`,
  `call:<docId>`, `thesis:<id>`, alongside the existing `detection:<id>`.
- **Canvas.** Two new value kinds in `canvas/catalog.ts`:
  - `deals`: a precedent set;
  - `series`: signal series.

  Each needs `evidenceOf`, `rowsOf`, `metricOf` and `kindOfValue` branches in `values.ts`.
- **Premium.** Ids follow `edge.<name>` in `src/lib/billing/features/premium.ts`, with `costPerUseUsd` and
  `perUse`. Keyed layers also get an entry in `src/lib/edge/premium.ts`. Background passes never open the
  premium scope.
- **ML service.** New tasks go in `TASKS` in `ml/edge_ml.py`, deployed to staging and smoke-tested
  (`ml/smoke.py`) before production, as now. Long calls use `edge/ml.done`. Do not add Modal crons (the free
  plan has five); Inngest or the daily pass triggers them.

---

## 4. The features

### E1. Precedent Engine

**Pitch.** A real precedent-transactions database built from EDGAR's own merger documents. Every term is quoted
from its source, and "deals like this one" are retrieved by meaning, not only by SIC code.

**Problem, and who it is for.**
- The problem today:
  - The Terminal's `PREC` lists EDGAR full-text hits.
  - Terms are extracted one deal at a time by an AI workflow.
  - `static-data.ts` still holds "sample precedents … until a deal database exists".
  - Licensed databases (Capital IQ, Mergermarket, PitchBook) are what banks use, and they cost five figures.
- Who it is for:
  - **M&A bankers**: the precedents page, fairness-style multiple ranges, deal-protection benchmarks;
  - **corporate development**: what similar acquirers paid and how long approval took;
  - **PE**: entry and exit multiples;
  - **students**: real precedent sets with sources.

The banker research (`docs/research/banker-ma-coverage.md`) ranked a precedent extractor as "the single biggest
data gap today".

**How it works.**

*Data.*

| Source | URL | Licence | Use |
|---|---|---|---|
| EDGAR full-text search | `https://efts.sec.gov/LATEST/search-index` (existing `efts()` in `graph/deals.ts`) | US government work, free to reuse; SEC's fair-access rules (10 requests a second, a declared User-Agent; existing `edgarFetch`) | Finds DEFM14A, PREM14A, DEFM14C, S-4 and S-4/A, SC TO-T, SC 14D9, SC 13E3, 425, and 8-K Item 1.01 with EX-2.1 and Item 2.01 |
| EDGAR submissions and filing HTML | `https://data.sec.gov/submissions/CIK##########.json`, `https://www.sec.gov/Archives/edgar/data/...` | as above | The documents themselves, parsed by the existing `docs/html.ts` (`partsFromHtml`, tables kept whole) |
| XBRL company facts | `https://data.sec.gov/api/xbrl/companyfacts/` | as above | The target's LTM revenue and EBITDA at announcement (existing `impliedMultiples`), and acquirers' ASC 805 notes (`BusinessCombinationConsiderationTransferred1`, acquired revenue) for private targets |
| Newsroom deal tracker | `news_deals` (existing) | Headlines only; the tracker's own computed fields | Seeds deals, dates and the unaffected price |
| Prices | Nasdaq, with FMP as backup (existing `history`) | as today | Premiums at 1 day, 30 days and the unaffected date (existing `premiumOf`) |

*Fields extracted, each with a verbatim quote, its document URL and section:*
- **Parties and type:** buyer type (strategic, sponsor or sponsor-backed), consideration (cash, stock, mix,
  exchange ratio, CVR) and per-share value.
- **Size and price:** equity value, enterprise value, premiums, EV/LTM revenue, EV/LTM EBITDA.
- **Deal protection:** termination fee (as a percentage of equity), reverse termination fee, go-shop days,
  financing commitments and lenders.
- **Advisers:** advisers and their disclosed fees.
- **Fairness opinions:** ranges by method (DCF, selected companies, selected transactions), plus the **list of
  precedents and peers the bankers chose**.
- **Background of the Merger timeline:**
  - first contact;
  - the number of parties contacted;
  - NDAs signed;
  - IOIs received;
  - final bids;
  - the sign date.
- **Management projections** (the summary table).
- **Synergies announced.**
- **Approvals:** regulatory approvals (HSR, a second request, CFIUS, FERC, state commissions) and
  sign-to-close days.
- **Outcome:** completed, terminated or topped.

*Extraction method* (`src/lib/edge/deals/extract.ts`):
1. Locate the sections by their headings in the parsed parts ("Background of the Merger", "Opinion of …",
   "Termination Fee", "Interests of …", "Certain Unaudited Prospective Financial Information"). Use keyword
   retrieval over the parts (existing `anyTermsQuery` logic), so no full proxy (often 1–5 MB) is ever sent to a
   model. One call reads one section, about 6–12K tokens.
2. The small model (`gpt-6-luna`, existing `small()` with `structured()`) returns
   `{field, value, unit, quote}`.
3. **Deterministic checks:**
   - the quote must pass the existing `quoteFound`;
   - the value must be re-parsed from the quote by a number parser (`parseMoney`, `parsePercent`,
     `parseDays`), or it is dropped;
   - units are normalised to USD millions.
4. **Cross-field consistency:**
   - EV ≈ equity value + net debt from XBRL, within 5%;
   - the extracted premium ≈ the premium computed from prices, within 2 points;
   - termination fee % ≈ fee ÷ equity value.

   A failed check lowers the field's confidence and names the conflict.
5. **Field confidence is calibrated.** About 150 deals are labelled by hand, field by field (the builder
   produces candidates and the owner, or an agent with a human spot-check, confirms them). Isotonic regression
   per field family maps check results to the probability that the field is right. The UI shows: "Termination
   fee 3.1% · checked · fields at this confidence were right 97% of the time on 150 labelled deals".

*Retrieval: "deals like this one"* (`src/lib/edge/deals/similar.ts`):
- A deal's text vector is the target's 10-K Item 1 business description, from the last 10-K before
  announcement, plus the stated rationale paragraph. It is embedded at 512 dimensions with the existing
  `embedTexts`.
- A structured kernel scores the same size bucket (log EV), sector (SIC and NAICS), buyer type, year
  (decayed), geography and consideration.
- The score is `0.6 × cosine + 0.4 × kernel`. The weights are tuned by the evaluation below and then
  frozen.
- Every result shows why it matched: "same SIC 4922; both gas gathering in the Permian; sponsor buyer; within
  0.5× size".
- **The evaluation needs no labelling.** Fairness opinions list the precedent transactions the bankers chose
  (the "Selected Precedent Transactions Analysis" table). Recall@10 against those choices, on deals whose
  chosen precedents are already in the database, measures retrieval. The same tables of selected public
  companies give a free evaluation for `COMPS` peer suggestions later.

*The multiple range for a target:*
- the median and interquartile range of the retrieved set (trimmed);
- a **split-conformal 80% interval**: kNN regression of log EV/EBITDA on the retrieval score, calibrated on
  deals held out by year, with the coverage achieved printed ("82% on 2024–25 deals").

**Uncertainty and audit.**
- Each field has its calibrated confidence, and each multiple range its tested coverage.
- Rows in `edge_provenance` (`deal_field:<id>`): document URL, section, method
  (`luna section-read v1 + number check`), model version, retrieval time.
- Exports include the quote column.

**Plugs into Edge.**
- **Tables (F4):**
  ```
  edge_deals(id serial pk, kind text, status text, announced_at date, signed_at date, closed_at date,
    acquirer_node int, target_node int, acquirer_name text, target_name text, buyer_type text,
    sic text, naics text, country text, equity_usd_mm real, ev_usd_mm real, ev_revenue real, ev_ebitda real,
    premium_1d real, premium_unaffected real, consideration text, outcome text,
    news_cluster_id int, sources jsonb, embedding halfvec(512), updated_at timestamptz,
    unique(target_node, announced_at))
  edge_deal_fields(id bigserial pk, deal_id int, field text, value jsonb, quote text, doc_url text,
    section text, confidence real, checks jsonb, method text, model_version text, verified_by text,
    created_at timestamptz)
  ```
- **Reuses:**
  - `graph/deals.ts`: the efts search, `sameGroup`, the "who is buying whom" read;
  - the `acquired` links in `edge_links`, kept in sync: one deal, one link;
  - `docs/html.ts` and `docs/text.ts`;
  - `news/deals.ts` (`premiumOf`, `impliedMultiples`).
- **New code:** `src/lib/edge/deals/` (`discover.ts`, `extract.ts`, `checks.ts`, `similar.ts`, `range.ts`,
  `store.ts`, `jobs.ts`).
- **Routes:**
  - `GET /api/edge/deals?q=&sic=&from=&to=&buyer=&min=&max=`;
  - `GET /api/edge/deals/[id]`;
  - `POST /api/edge/deals/similar` (`{ticker | dealId | text, filters}`);
  - `POST /api/edge/deals/[id]/reread` (premium, stronger model).
- **Jobs:**
  - the daily pass finds new merger documents, about 2–10 a day;
  - an Inngest function `edge/deals.backfill` works through 2015 to today in slices of 50 deals a day under
    the AI caps. About 2,500–3,000 US public-target deals, roughly six to eight weeks to complete. It can run
    faster if the owner raises `NEWS_AI_BUDGET_USD`-style caps for Edge.
- **Canvas:** a new node `deals.precedents`. Its input is companies or a pro-forma; its outputs are `deals` (a
  new kind) and `table`. It feeds `out.memo`, `out.studio`, `scen.lbo` (E6) and `buyers.simulate` (E11).
- **Terminal:** `PREC <ticker>` shows the engine's set and range when the database covers the sector. It keeps
  today's live EDGAR search as the "Find more" tab.
- **Elsewhere:** Newsroom deal cards gain "Terms" (termination fee, go-shop, number of bidders) when a record
  exists. Studio gets "Precedents" sheets through the existing `push.ts`.
- **Feed:** no new card kind. `deal_proforma` cards show the record's key terms.

**UI.**
- **Desktop.** A new Edge view, "Deals":
  - **Search** with chips for filters (sector, size, buyer type, years, consideration) and a "Like…" box that
    takes a ticker, a deal or a sentence.
  - **Results table:** target, buyer, date, EV, EV/EBITDA, premium, termination fee, then the "why similar"
    chips. A strip above the table shows the multiple distribution with the conformal band.
  - **The deal page:**
    - a horizontal process timeline (first contact → NDAs → IOIs → sign → close) with counts;
    - the field list, where each value opens the existing `CitationViewer` at the quoted passage;
    - the fairness ranges drawn as a small football field;
    - "Use as precedent set" sends the set to Studio or the canvas.
- **Phone.** Results become cards (target, buyer, EV/EBITDA, premium). The deal page stacks, the timeline is
  vertical, and quotes open in the bottom sheet.

**Free and premium.**
- **Free:** search, similar deals, every extracted field, ranges, the Terminal and canvas. Cost drivers:
  - about $0.005–0.01 a deal on the small model, once, shared by everyone;
  - embeddings at about $0.00002 a deal.
- **Premium possibilities:**
  - "Re-read with the stronger model or exact-span citations" on one deal: about $0.24 on gpt-5.6-sol
    (40K tokens in, 4K out);
  - exports above 50 rows;
  - **private precedent library** (Deal Team or Enterprise): upload your own CIMs and closing memos, which are
    read the same way into private `edge_deals` rows (`owner_id`/`team_id`), about $0.05 a document;
  - an hourly check of new merger filings in chosen sectors.

**Test plan.**
- **Unit** (`test-edge.ts`):
  - `parseMoney` ("$1.2 billion", "$950 million", "approximately $3.10 per share");
  - `parsePercent` and the days parser;
  - every consistency check;
  - the premium arithmetic against `premiumOf`;
  - kernel and score symmetry;
  - split-conformal coverage on synthetic data (it must reach ≥ the nominal level within its sampling error);
  - section location on three saved proxies (fixtures under `scripts/fixtures/deals/`).
- **Evaluation** (`scripts/eval-precedents.ts`):
  - field accuracy by family on the labelled set;
  - recall@10 of banker-chosen precedents (target ≥ 0.5 to start; report the number honestly);
  - coverage of the multiple interval.

**Size: L.**

**Risks.**
- Proxies vary widely in layout. Section location will miss some, so a field is left blank rather than
  guessed.
- Private-target coverage is thin (ASC 805 notes give the price, often without EBITDA).
- Non-US deals are out of scope.
- The fairness-opinion evaluation depends on parsing tables. Some are images, so OCR through the ML service is
  the fallback.
- Neon storage: about 40 MB for 3,000 deals with their quotes.

---

### E2. Calibrated Claims

**Pitch.** Each claim in an Edge answer or memo carries a calibrated probability that its sources support it.
Strict mode holds a stated, tested error rate: "at most 5% unsupported claims; measured 3.2% on 312 held-out
claims".

**Problem, and who it is for.**
- Edge's Strict mode already checks that every quote exists. A real quote can still fail to support the claim
  built on it (a wrong period, a wrong entity, a number that was transformed).
- Compliance teams and MDs want a number they can rely on, not a promise.
- For everyone, but above all bankers writing for committees, and regulated firms.

**How it works.**
- **Features of each claim and its cited passages:**
  - the quote check result (exact, near, failed);
  - the reranker score of the cited passage (existing free cross-encoder, or Voyage or Cohere when premium);
  - an **NLI entailment probability** from a small checker on the ML service. A new task `docs.verify` runs a
    DeBERTa-v3-class NLI cross-encoder or a MiniCheck RoBERTa or DeBERTa checker. Check each model card's
    licence: MIT or Apache only, and the Bespoke-MiniCheck-7B is non-commercial;
  - a **number check:** every number in the claim must appear in a cited passage, or be derivable from them by
    `calc` (sums, ratios, growth), done deterministically by `src/lib/edge/claims/numbers.ts`;
  - entity and period agreement (the ticker or company name and the fiscal period in the claim match the
    passage's header line, which Edge already embeds);
  - the number of independent passages agreeing.
- **The combiner:** logistic regression over these features, giving a raw score, then isotonic calibration,
  giving the support probability.
- **The conformal filter** (Mohri and Hashimoto 2024, split conformal):
  - on a held-out calibration set, choose the threshold τ so that among claims scoring ≥ τ the unsupported
    share is ≤ α, with finite-sample correction;
  - Strict uses α = 5% by default, with 10% and 2% available;
  - Balanced shows every claim with its dot and does not filter.
- **The calibration set** (`scripts/fixtures/claims.jsonl`):
  - 300–400 claims from real Edge answers over the evaluation filings, labelled "supported" or "unsupported"
    with the reason;
  - generated by running `scripts/eval-docs.ts` questions, auto-labelled by a second model, then spot-checked
    by a human (the owner reviews about 100);
  - the set grows from user reports ("This claim is wrong"), which are reviewed before inclusion.
- **Shared verifier:** the Precedent Engine (E1), Call Desk (E5) and Thesis Agent (E7) use the same verifier
  on their claims.

**Uncertainty and audit.**
- A footer on every Strict answer: "Shown claims meet a 5% unsupported-claim target. On 312 held-out claims,
  3.2% (90% CI 1.7–5.1%) of claims above this line were unsupported. Calibration set v3, 2026-10-…"
- The claim's features and probability are stored in `edge_answers.answer.claims[].support`. The verifier
  version is recorded in provenance.

**Plugs into Edge.**
- **Extends** `docs/answer.ts` (after `checkFound`) and `canvas/executors/outputs.ts` (`out.memo`). Story mode
  shows the dots.
- **New code:**
  - `src/lib/edge/claims/` (`features.ts`, `numbers.ts`, `combine.ts`, `conformal.ts`);
  - the ML task `docs.verify` (CPU, about 0.2 s for each claim and passage pair).
- **No new tables:** answers already store JSON. The calibration set is a fixture, and the model weights are
  JSON in R2.
- **Route:** `POST /api/edge/answers/[id]/report` (flag a claim).

**UI.**
- **Desktop:**
  - each claim has a small dot (green ≥ 0.9, amber 0.6–0.9, red below);
  - hover shows "92% supported: quote exact, numbers match, NLI 0.97";
  - Strict hides claims below τ under "2 claims held back (below the 5% line)" with a reveal;
  - the evidence board colours wires by support.
- **Phone:** dots inline; tap opens a bottom sheet with the passage and the reasons.

**Free and premium.**
- **Free:** everything above. The cost is ML CPU: about 30 claim and passage pairs × 0.2 s ≈ $0.0003 an answer.
- **Premium possibility:** "Cross-check with a second provider" sends the claims and passages to another
  provider's model as a judge (for example, Claude Sonnet when the answer was written by OpenAI), whose verdict
  joins the features. About $0.03 an answer.

**Test plan.**
- **Unit:**
  - the number extractor and derivations ("up 12%" from 100 → 112);
  - period and entity matching;
  - the conformal threshold on synthetic scores with known labels (the unsupported rate above τ must be ≤ α in
    95% of 1,000 resamples);
  - isotonic monotonicity;
  - the filter respects τ.
- **Evaluation:** `scripts/eval-claims.ts` reports the AUROC of support, ECE, and the realised rate at α of 2%,
  5% and 10% on the held-out half.

**Size: M.**

**Risks.**
- The calibration set has to match real use. Drift is possible as question types change, so the evaluation
  re-runs in preflight against the fixture and monthly against fresh answers.
- NLI models are weak on tables, so table claims rely on the number check.

---

### E3. Alt-Data Pulse

**Pitch.** Free alternative data, per company, as time series:
- hiring by department and location;
- web and Wikipedia attention;
- federal contract awards;
- layoff notices;
- patents;
- developer traction.

Change points come with a stated false-alarm rate. **Tells** pick out an IPO-readiness hire or a post-merger
integration team before anyone announces anything.

**Problem, and who it is for.**
- Harmonic, Revelio and Similarweb charge enterprise prices for these signals.
- For private companies, VC and PE have little else.
- For public ones, the signals lead filings by months.
- For **VC/PE**: private targets and portfolio monitoring, through `/app/vc` startups. For **bankers and corp
  dev**: what a target or competitor is building. For **markets**: early read-throughs.

**How it works.**

*Data.*

| Signal | Source and URL | Licence and terms | Notes |
|---|---|---|---|
| Job postings | Greenhouse `https://boards-api.greenhouse.io/v1/boards/{token}/jobs`, Lever `https://api.lever.co/v0/postings/{company}?mode=json`, Ashby `https://api.ashbyhq.com/posting-api/job-board/{org}`, SmartRecruiters `https://api.smartrecruiters.com/v1/companies/{id}/postings` | Public, unauthenticated APIs meant for embedding job boards. Store counts, titles, departments, locations and first and last seen. Keep descriptions no longer than 30 days, and only to classify. Link back. | Board tokens come from F1's careers-page detection. Workday and SuccessFactors are excluded (no public API; their terms forbid scraping), so large incumbents have thin coverage and the UI says so. |
| Wikipedia attention | `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{title}/daily/{from}/{to}` | Wikimedia analytics data is CC0 *(prior knowledge; confirm on the API's docs page)* | The title comes from Wikidata (F1) |
| Web popularity | Chrome UX Report on BigQuery, monthly tables' `experimental.popularity.rank` (buckets: top 1K … 1M) | CrUX is published under CC BY 4.0 per Google's CrUX docs (confirm). The BigQuery sandbox's free 1 TB of queries a month covers it. | Coarse, but a bucket move (for example top 50K → top 10K) is meaningful. Cloudflare Radar is **excluded** (CC BY-NC). |
| Federal awards | USAspending `https://api.usaspending.gov/api/v2/search/spending_by_award/`, subawards `/api/v2/subawards/` | Public domain; no key | Recipients matched by UEI (F1). New awards over $10M become findings. |
| Layoff notices (WARN) | State labour departments' WARN pages (start with TX, CA, NY, WA, IL, NJ, OH, FL; URLs in a source registry, since they move) | Public records | Parsers per state. The free aggregator WARN Feed (39 states, CSV/JSON) is a fallback, with its terms checked first. |
| Patents | PatentsView PatentSearch API `https://search.patentsview.org/api/v1/patent/` and bulk files on the USPTO Open Data Portal | CC BY 4.0 (attribution in provenance) | Grants and pre-grant publications by disambiguated assignee |
| Developer traction | GitHub REST API (org repos, stars, contributors) | GitHub API terms; 5,000 requests an hour with a token | Only for companies with a GitHub org in F1 |
| Private raises | SEC Form D (already in `/app/vc`) | Public | Joined as events on the timeline |

*Processing.*
- **Departments and tells** (`src/lib/edge/pulse/titles.ts`): rules first, then the small model in batches of
  200 titles for the rest (about $0.002 per 1,000 titles). Tell families:

  | Tell | Example titles |
  |---|---|
  | **IPO readiness** | SEC reporting manager, SOX, Head of Investor Relations, equity plan administrator, at a private company |
  | **M&A integration** | integration manager, integration management office, TSA, carve-out, "Day 1" |
  | **Corporate development** | Head of Corp Dev, M&A associate |
  | **Restructuring** | restructuring director, interim CFO |
  | **Geographic expansion** | a new country or metro |
  | **Plant build-out** | hiring by a new site location |

  Each tell is a weekly count in `edge_series` (`jobs.tell.ipo`, and so on).
- **Change detection** (F2): BOCPD plus robust z per metric. A finding needs the change probability ≥ 0.9 and
  a move that matters (for example, open postings −40% or +60% over 6 weeks, or ≥ 3 tell postings in 30 days
  where there were 0).
- **Board-moved guard.** When a board goes to zero while the careers page now links somewhere else, the
  finding is "jobs board moved", not "hiring stopped". F1 re-detects the board.
- **Nowcast (public companies only, shown only where it is earned):**
  - regress next-quarter revenue growth (XBRL) on lagged signal changes, with the company's own ridge
    regression shrunk toward a sector pooled model;
  - compare against the naive seasonal forecast with a Diebold-Mariano test on rolling origins;
  - show the nowcast with a conformal interval only when the test gives p < 0.1. Otherwise the panel says
    "signals only: no tested revenue link for this company".
  - Chronos-2 (Apache-2.0, covariates) is the second candidate, run on the ML service as a new task
    `series.forecast`.

**Uncertainty and audit.**
- Every finding states:
  - its change probability;
  - the detector's placebo false-alarm rate for that metric family;
  - the coverage (for example, "1 of 3 known job boards for this company").
- Provenance per series point (`series:<node>:<metric>`), with source URL, licence, retrieval time and
  method version. Raw pulls stay in R2 for 400 days for re-audit.

**Plugs into Edge.**
- **Tables:** F1 and F2.
- **New code:** `src/lib/edge/pulse/`:
  - `sources/` (greenhouse, lever, ashby, smartrecruiters, wikimedia, crux, usaspending, warn/, patentsview,
    github);
  - `titles.ts`, `ingest.ts`, `findings.ts`, `nowcast.ts`.
- **Jobs:**
  - the daily pass refreshes watched entities;
  - an Inngest cron `edge/pulse.weekly` does the rest of the universe plus the top 500 of `/app/vc` by recent
    activity, in batches of 25 a step to save Inngest executions (about 60 executions a week);
  - CrUX is a monthly BigQuery query.
- **Finding kinds:** `hiring_shift`, `hiring_tell`, `attention_spike`, `contract_award`, `layoff_notice`,
  `patent_shift`. Each gets a `noveltyOf` base of 0.8, because these rarely reach the news.
  - `isBig`: a tell with ≥ 3 postings, a layoff notice of ≥ 250 employees, or a contract over $100M.
- **Canvas:** a new node `pulse.signals`. Its input is companies; its outputs are `series` (a new kind) and
  `findings`. `out.signal` accepts a series: "alert when engineering postings fall 30%".
- **Terminal:** `PULSE <ticker>`. In `/app/vc`, a startup's page gets a Pulse strip.
- **CRM:** a tell at a company where the person has contacts becomes a CRM signal (existing `crm.ts` path).
  For example: "Acme is hiring an integration lead: a reason to reconnect".
- **Feeds into:** Deal Radar (E4) features and Management Track Record (E8).

**UI.**
- **Desktop.** A company's **Pulse** panel shows small multiples, one chart per metric:
  - weekly lines with shaded change points;
  - an events rail (Form D raises, WARN notices, awards);
  - the tells list (title, location, first seen, link);
  - a postings map by metro (MapLibre, reused);
  - "Compare with peers": index lines against a chosen peer group (`PG`).
  - A coverage badge says which sources answered.
- **Phone.** A stack of sparklines with the latest value and change. Tap expands to a full-width chart. The
  tells list sits below.

**Free and premium.**
- **Free:** every source above. Cost drivers:
  - BigQuery stays inside the sandbox;
  - title classification is about $0.002 per 1,000 titles;
  - there are no paid APIs.
- **Premium possibilities:**
  - licensed panels with a bring-your-own key (Enterprise): Revelio Labs or Coresignal for workforce data,
    Similarweb for traffic, Apptopia for apps. Adapters live in `src/lib/edge/premium/`, gated as usual;
  - a 2-year history backfill on request through licensed archives;
  - a daily rather than weekly refresh for up to 50 companies (a plan perk, cost about $0).

**Test plan.**
- **Unit:**
  - each ATS parser on saved JSON fixtures;
  - the title rules (60 labelled titles);
  - BOCPD detects a step change within 3 weeks on synthetic series and stays under the false-alarm target on
    stationary noise;
  - the placebo shuffle;
  - board-moved logic;
  - the WARN parsers for two states on saved files;
  - the Diebold-Mariano test on known cases.
- **Evaluation:** `scripts/eval-pulse.ts` reports detector precision on 2025 events with known causes (layoff
  announcements, funding rounds).

**Size: M.**

**Risks.**
- Coverage bias toward technology and private companies.
- ATS terms may change.
- Entity mistakes (handled by F1's review queue).
- Wikipedia spikes from news are not fundamentals, and the card says what caused the spike when the Newsroom
  has a matching story.
- WARN state formats drift: each parser has a "last good" date, and a stale parser is flagged in Settings →
  Labs.

---

### E4. Deal Radar

**Pitch.** A calibrated probability that a company announces an agreement to be sold, or a material
acquisition, in the next 6 or 12 months. It fuses weak public signals and keeps a public, automatically
scored track record.

(Code name `odds`, finding kind `deal_odds`. This avoids confusion with the existing Sentinel-1 "radar change"
and the documents "change radar". The UI name is **Deal Radar**; the Terminal code is `ODDS`.)

**Problem, and who it is for.**
- Coverage bankers spend their time guessing who is in play.
- Event-driven investors try to anticipate targets.
- Corp dev wants to know when a competitor's asset might come loose.
- The GNN gives *who would buy*, but not *when*.
- The academic record is honest about how hard this is. Takeover-prediction models (Palepu 1986, and
  Cremers, Nair and John 2009) reach modest discrimination, so a calibrated probability against the base rate
  is the honest product, not a "will be acquired" list.

**How it works.**

*Events (labels).*
- **Target:** an announced agreement to be acquired or merged (≥ 50% of equity), a take-private, or a tender
  offer, from F4 `edge_deals`, `news_deals` and 8-K Item 1.01 with EX-2.1.
- **Acquirer:** an announced acquisition worth ≥ 10% of the acquirer's EV.
- **Strategic review announced** is a secondary label, found by searching 8-Ks and press releases for
  "strategic alternatives".

*Universe.* US-listed operating companies with XBRL facts, about 5,000. Monthly panel since 2012, about 800K
company-months.

*Features* (each with its source and a dated as-of, so nothing from the future leaks in):

| Family | Features | Source |
|---|---|---|
| Classic takeover-likelihood | log market cap, EV/EBITDA and Tobin's q against the sector median, ROA, leverage, cash/assets, sales growth, a growth–resource mismatch flag, 12-month return | XBRL (SEC Financial Statement Data Sets for history: `https://www.sec.gov/dera/data/financial-statement-data-sets`), prices |
| Industry wave | deals in the same SIC2 over 12 months (Harford 2005), against the sector's long-run rate | F4 deal database |
| Shareholders | new 13Ds in 12 months, 13D amendments, a 13G→13D switch, insider net buying or selling (Form 4), sponsor stakes | EDGAR submissions; existing graph links |
| Governance and events (8-K) | 5.02 CEO or CFO departure; 3.03 rights plan; 5.03 bylaw changes; change-in-control severance adopted; 1.01 credit-agreement amendments; language about advisers retained or strategic alternatives | 8-K items (existing `eventFlags`) plus text search |
| Text change | new risk factors that mention a strategic review or transaction; MD&A shifts | existing change radar (`docs/changes.ts`) |
| Graph | the GNN's target score and rank; how many candidate buyers score highly; interlocks with acquisitive companies | existing `edge_predictions`, `metrics.ts` |
| Debt | maturities within 24 months against cash; going-concern language | XBRL plus the DDIS data |
| Alternative data | hiring freeze, integration and corp-dev tells at likely buyers, WARN | E3 |
| Market | abnormal volume and run-up over 20 days against a year (pre-announcement drift is documented, so the 1–3 month horizon gains most) | Nasdaq history |
| News | Newsroom clusters naming the company with "explore a sale", "takeover interest" or "approach" in 30 days | `news_clusters` |

*Model* (on the ML service, new tasks `odds.train` and `odds.score`):
- **The model:**
  - a discrete-time hazard: one row per company-month, target "event within H months";
  - LightGBM (MIT), with monotone constraints where economics is unambiguous (for example, more 13Ds never
    lowers the odds);
  - two horizons (6 and 12 months) and two roles (target and acquirer).
- **Validation:**
  - rolling-origin, by year (train ≤ year t, test year t+1);
  - an embargo of one horizon between train and test.
- **Calibration:**
  - isotonic on the most recent out-of-time year;
  - **Venn-Abers** intervals per company (F3), shown as "14% (11–18%)".
- **Baselines, on the same split:**
  - the base rate;
  - a Palepu-style logit;
  - the GNN target score alone.

  The scorecard states plainly whether the model beats each, as Networks' scorecard already does.
- **Reported metrics, each with a bootstrap 90% CI:**
  - AUROC, PR-AUC;
  - Brier and Brier skill against the base rate;
  - reliability diagram;
  - **top-1% lift** ("of companies in our top 1% a year ago, 9% announced a sale within 12 months, against a
    2.4% base rate").
- **Reasons:**
  - LightGBM's TreeSHAP contributions (`pred_contrib`), giving the top three signals with direction;
  - each is linked to its evidence: the 13D filing, the 8-K, the job posting, the news cluster;
  - a "what would move it" list: the features with the largest marginal effect on the company's own row.

*Pipeline.*
- **Features:** a TypeScript feature builder (`src/lib/edge/odds/features.ts`, pure functions plus loaders)
  writes monthly feature rows to R2 as JSON lines. It is the only place features are defined.
- **Backfill:** a one-off script `scripts/backfill-odds.ts` uses EDGAR at under 10 requests a second (about
  5,000 submissions and 5,000 company-facts calls, about 20 minutes, plus Financial Statement Data Sets
  quarterly zips).
- **Training and scoring:**
  - `odds.train` reads the rows, trains, evaluates and writes the model and metrics to R2 and `edge_models`
    (kind `odds-target-12m` and so on). It runs monthly and on admin request, a few CPU minutes, about $0.05;
  - `odds.score` runs weekly for the whole universe and daily for watched companies, writing to
    `edge_predictions` (kind `odds_target_12m`) and F3 `edge_forecasts` for watched companies plus the top 200.
- **Resolution:** F3's resolver settles each forecast from F4 and 8-Ks.

**Uncertainty and audit.**
- Every number is shown beside the sector base rate and its interval, with the model version and its
  scorecard one click away.
- Provenance per score lists the evidence documents behind the top reasons.
- The Track record tab shows how the model's past probabilities turned out.

**Plugs into Edge.**
- **Reuses:**
  - graph predictions and `eventFlags`;
  - the change radar;
  - Newsroom clusters;
  - E3 series;
  - F4;
  - the deal model's scorecard component.
- **New code:**
  - `src/lib/edge/odds/` (`features.ts`, `labels.ts`, `score.ts`, `cards.ts`, `explain.ts`);
  - Modal tasks `odds.train` and `odds.score`;
  - routes `GET /api/edge/odds?ticker=` and `GET /api/edge/odds/board?scope=watched|movers|screen`
    (`screen` is premium).
- **Finding kind** `deal_odds`, posted when either holds:
  - the 12-month odds pass both 2× the sector base rate and 10%;
  - the odds rise by ≥ 5 points in a week with a new dated signal.

  `isBig`: p ≥ 0.25 and a rise of ≥ 8 points. `noveltyOf` base 0.8.
- **CRM:** contacts at the company get a signal ("12-month sale odds rose to 22%: activist 13D, CFO left").
- **Canvas:** a new node `odds.score`. Its input is companies; its outputs are `ranking` and `table`. The
  "Target + buyer finder" starter canvas gains it beside `net.graph`.
- **Terminal:** `ODDS <ticker>` and `ODDS` (the board). `EDGE <ticker>` shows the odds line.
- **Thesis Agent (E7)** uses it as a tool. **Buyer Simulator (E11)** uses acquirer odds as participation
  priors.

**UI.**
- **Desktop.** A new view, **Deal Radar**:
  - **The board** has tabs for your watches, the week's movers and (premium) a screener. Each row shows:
    - a probability bar with its interval whisker and a tick at the sector base rate;
    - a 26-week sparkline;
    - the top three reason chips ("Activist 13D · Mar", "CFO departed", "Integration hires at KMI").
  - **The company page:**
    - the probability over time, annotated with dated events;
    - a SHAP waterfall;
    - "what would move it";
    - the likely buyers from the GNN (linking to Networks);
    - the model's reliability diagram and scorecard.
  - A plain-English line: "This is a statistical estimate from public data, not a rumour or advice."
- **Phone.** Board rows become cards with the bar and the first reason. The company page stacks
  (probability, reasons, buyers). Alerts arrive as push.

**Free and premium.**
- **Free:** odds for watched companies and the weekly movers list (top 25), with reasons and the track
  record. Cost: training about $0.05 a month and scoring about $0.01 a week on Modal CPU; card text on the
  small model, about $0.0005 a card.
- **Premium possibilities:**
  - the **universe screener** (filter all ~5,000 by odds, sector and size; export; about $0 per use, a perk);
  - custom horizons (3 months);
  - acquirer-target pairing (the joint odds that X buys Y within 12 months = acquirer odds × GNN pair
    probability, calibrated on pairs);
  - daily re-scoring on demand.

**Test plan.**
- **Unit:**
  - each feature function on fixtures (8-K item flags, the 13G→13D switch, abnormal volume, wave counts);
  - **the no-look-ahead test:** the feature builder, given a cut-off date, must never read a filing dated after
    it (a fixture with a "future" filing must not change the row);
  - label building (affiliate roll-ups excluded, using `isDealVehicle` and `sameGroup`);
  - isotonic and Venn-Abers on synthetic data;
  - card thresholds.
- **Evaluation:** `scripts/eval-odds.ts` prints the out-of-time scorecard for each horizon and role.
- **ML:** a smoke test for both tasks on a 200-company sample.

**Size: L.**

**Risks.**
- Label noise (rumours that never sign, roll-ups).
- Low base rates make intervals wide. That is honest, and must be shown.
- Users may read odds as tips. The copy avoids "will", and every card carries the base rate.
- Leakage through restated XBRL: use as-filed values from the Financial Statement Data Sets.
- Reputational risk if a named company complains. The odds are statistical, built on public data, explained,
  and logged with a track record; legal review of the copy before launch (open question 3).

---

### E5. Call Desk

**Pitch.** It reads every analyst question on an earnings call and scores the answer as direct, partial or
evasive, with calibrated probabilities. It also keeps a ledger of every quantified promise management made
(guidance, timelines, targets) and settles each one automatically when the filing that proves or disproves it
arrives.

**Problem, and who it is for.**
- Edge already transcribes calls and scores hedging and tone per turn (`docs/tone.ts`). But hedging is not
  the same as dodging a question.
- Research ties evasive answers to later earnings misses and poor returns:
  - Larcker and Zakolyukina 2012, "Detecting deceptive discussions in conference calls" *(prior knowledge)*;
  - the EvasionBench paper (2026).
- Who it is for:
  - **markets and equity research**: tone shifts;
  - **bankers**: management credibility before a pitch;
  - **PE and credit**: do they hit their numbers;
  - **corp dev**: how a competitor talks about an asset.
- The product never says "lie". It says "did not answer the question asked", with the question, the answer
  and the reason side by side.

**How it works.**

*Data.*
- Calls and recordings already in the library:
  - uploads or a direct audio link, often from investor-relations webcast replays;
  - transcripts that companies file as 8-K exhibits (EX-99.2 or EX-99.3, free and public domain), picked up
    by the filing watch when a watched company files one.
- Guidance comes from 8-K Item 2.02 EX-99.1 earnings releases and from the calls.
- Actuals come from XBRL company facts and 10-Q and 10-K filings.
- Licensed transcript vendors are not used. A bring-your-own transcript licence could be an Enterprise
  option later.

*Q&A segmentation* (`src/lib/edge/calls/qa.ts`, pure):
- find the Q&A section (operator cues, "question-and-answer session");
- use the speaker turns from transcription (Parakeet with names guessed from words, or the premium
  speaker-labelled path);
- tag analysts from the operator's introductions ("…from Morgan Stanley");
- pair each analyst question (and its follow-up) with the management answers until the next analyst.

*Evasion classifier.* Three classes, as EvasionBench defines them: **direct** (answers the core question with
specific information), **intermediate** (related information that sidesteps the core) and **fully evasive**.
- **Free path:** the small model with a fixed rubric. Structured output with:
  - the class;
  - sub-tags (refused, deferred offline, answered a different question, no number given when one was asked,
    a pivot to prepared remarks);
  - the dodging phrase as a verbatim quote, checked by `quoteFound`.

  About 30 pairs × 900 tokens is roughly $0.005 a call.
- **Premium path:** Eva-4B (`FutureMa/Eva-4B`, Apache-2.0, base Qwen3-4B-Instruct-2507), run on the ML service
  as a new GPU task `calls.evasion` (a T4, 4B parameters in bf16). It is ensembled with the rubric output by
  averaging calibrated probabilities. EvasionBench's own data comes from S&P Capital IQ transcripts, so **only
  the weights are used**, never the dataset.
- **Calibration:**
  - temperature scaling, then per-class isotonic regression, on Edge's own labelled set: about 300 Q&A pairs
    from transcripts that companies filed on EDGAR;
  - labelled by two passes (a model, then a human for disagreements), stored as a fixture;
  - report macro-F1 and ECE.

*Call level.*
- The evasion rate per call is the expected number of fully evasive pairs ÷ pairs, with a **Beta-binomial
  posterior**.
- It is compared with the company's own last four calls and the sector.
- "Evasion rose" is stated only when the posterior probability that the rate increased is ≥ 0.9.
- Evaded topics are clustered by embedding ("Permian volumes", "the leverage target").

*Commitments ledger* (`src/lib/edge/calls/commitments.ts`):
- **Extraction:** from releases and calls, extract quantified forward statements: guidance ranges (revenue,
  EPS, EBITDA, capex, production, volumes), dated milestones ("close in Q2", "start-up by year-end 2027") and
  targets (leverage ≤ 3.5×).
- **Each statement becomes an F3 forecast** of kind `guidance`:
  - the stated range is the "forecast";
  - the rule names the XBRL concept, period and comparison;
  - milestone rules name an 8-K item or a phrase in the next 10-Q, resolved by a check of the small model
    with a quote.
- **Resolution:** the daily pass resolves them when the 10-Q or 10-K lands, as hit, missed low, missed high,
  withdrawn or raised.
- **Concepts are mapped deterministically** (revenue → `Revenues` and `RevenueFromContractWithCustomer…`,
  with the filer's own concept as in the comps engine). An unmapped metric resolves "manual" and is listed,
  not guessed.

**Uncertainty and audit.**
- Every pair shows its class probabilities and the quote that drove them.
- Every call-level statement carries its posterior interval.
- The commitments ledger links each promise to its source (release or call timestamp) and its resolution
  filing.
- Provenance subject `call:<docId>` records the classifier version and calibration set version.

**Plugs into Edge.**
- **Reuses:**
  - `docs/uploads.ts` (transcription), `tone.ts`;
  - `CitationViewer` (audio jumps to the second);
  - `filingwatch.ts` (new filed transcripts and earnings releases for watched companies);
  - E2's verifier for extracted commitments;
  - F3.
- **Storage:** pairs and scores go in `edge_docs.meta.qa` (a call has about 20–50 pairs), plus a summary row
  per call. No new table beyond F3.
- **New code:** `src/lib/edge/calls/` (`qa.ts`, `evasion.ts`, `calibrate.ts`, `commitments.ts`,
  `resolve.ts`), Modal `calls.evasion`.
- **Routes:**
  - `POST /api/edge/calls/[docId]/read` (runs the classifier; free or premium path);
  - `GET /api/edge/calls/[docId]`;
  - `GET /api/edge/commitments?ticker=`.
- **Finding kinds:**
  - `call_evasion`: evasion up with posterior ≥ 0.9;
  - `guidance_result`: a commitment resolved; `isBig` when a miss is outside the range by > 5%;
  - `commitment_due`: within 30 days.
- **Canvas:** a new node `calls.read`. Its input is docs or companies; its outputs are `table` (pairs or
  commitments) and `memo`.
- **Terminal:** `CALL <ticker>` (latest call) and `EE` gains "Promises kept".
- **Feeds** Management Track Record (E8).

**UI.**
- **Desktop.** The call viewer gains a Q&A timeline: a horizontal strip with one segment per question,
  coloured by evasion probability.
  - Clicking a segment opens question and answer side by side, with the dodge phrase highlighted. Audio plays
    from the question.
  - Panels for "What they avoided" (topics) and speakers (from `tone.ts`).
  - A **Promises** tab: a table of commitments with status chips (open, hit, missed, withdrawn), source links
    and due dates, plus a hit-rate summary with a Beta interval.
- **Phone.** A list of Q&A cards (analyst, firm, class chip). Swiping moves between questions; tap plays the
  audio. Promises show as a short list with status chips.

**Free and premium.**
- **Free:** the rubric classifier (about $0.005 a call), commitments (about $0.003 a quarter per company),
  calibration, the ledger.
- **Premium possibilities:**
  - **Eva-4B ensemble**: about $0.03 a call on a T4, cold start included (for example, 90 s at $0.59 an hour
    plus CPU and memory);
  - speaker labels (the existing premium feature);
  - "Compare across the peer set's last calls" (up to six calls, about $0.05).

**Test plan.**
- **Unit:**
  - Q&A segmentation on two fixture transcripts (one diarized, one not);
  - analyst and firm parsing from the operator's lines;
  - Beta-binomial posterior and the "rose" probability;
  - commitment parsing of ranges, units, periods ("$4.2–4.4 billion", "mid-single-digit growth" → unmapped);
  - resolution against XBRL fixtures (hit, missed, unmapped);
  - temperature scaling.
- **Evaluation:** `scripts/eval-calls.ts` reports macro-F1 and ECE on the held-out half of the labelled pairs
  for the rubric, Eva-4B and the ensemble.

**Size: M.**

**Risks.**
- Recordings are not always available, and diarization errors misattribute answers. Mitigation: show a
  speaker-confidence badge, and skip pairs whose roles are unclear.
- Defamation risk is managed by observable wording and quotes.
- Eva-4B training data provenance (Capital IQ) is a licence question for the weights' use. Check with
  counsel before turning premium on (open question 4).

---

### E6. LBO Stress Lab

**Pitch.** Run an LBO over thousands of labelled synthetic macro and operating paths, not one base case. It
gives the IRR fan, the odds of a covenant breach by year, the maximum price at a hurdle with confidence, and
the gentlest plausible scenario that breaks the deal.

**Problem, and who it is for.**
- LBO models are run on three hand-made cases.
- Lenders and investment committees ask "what breaks this?", and the answer is a guess.
- For **PE**: returns and the maximum price. For **leveraged finance and credit**: covenant headroom. For
  **bankers**: sponsor ability to pay. For **students**: intuition.

**How it works.**
- **Inputs:**
  - **the company:** LTM revenue, EBITDA, capex, working capital, D&A and tax rate from XBRL (existing
    `getCompanyData`), or typed in for private targets;
  - **entry multiple:** default is the median EV/EBITDA of similar sponsor deals from E1, with the conformal
    band shown;
  - **structure:** tranches as rows (term loan B at SOFR + spread with a floor and amortisation; senior notes
    at a fixed coupon; second lien; revolver), fees and minimum cash;
  - **covenants:** maximum net leverage and minimum interest cover, or covenant-lite with a springing
    revolver test;
  - **cash and exit:** sweep percentage, exit year, exit-multiple rule.
- **Macro paths** (reusing Scenarios):
  - **Factors:** the factor engine (GJR-GARCH-t with filtered historical simulation, the t-copula,
    `scen/models.ts`) extended to monthly steps over 5–7 years.
  - **Rates:** a new driver. 3-month bills and the 10-year yield from the Treasury curve (existing), with SOFR
    history from the New York Fed's public API (`https://markets.newyorkfed.org/api/rates/secured/sofr/`). A
    two-regime AR(1) on the monthly short rate, joined to the factors through the copula. Chronos-2 can give
    the median path's anchor (the ML task `series.forecast` from E3). TimesFM stays premium, as today.
  - **Refinancing spread:** there is no free high-yield spread history that may feed a model (FRED is
    excluded by its terms). The spread is modelled as a function of the equity-factor drawdown, using
    published historical ranges (cited) and **labelled as an assumption** the user can override.
- **Operating paths:**
  - revenue and EBITDA respond to factors through the company's own history (existing `scen/company.ts`
    betas, with costs 30% fixed);
  - margins mean-revert;
  - idiosyncratic quarters are resampled from the company's own residuals.
- **The engine** (`src/lib/edge/scen/lbo.ts`, pure, vectorised over paths):
  - the existing `lbo-returns` calculator's maths (in `src/lib/workflows/packs/banker.ts`: sources and uses,
    schedule, sweep, attribution) is refactored into a shared pure function, so both use the same code and
    agree exactly on a zero-volatility path;
  - quarterly covenant tests;
  - floating interest by path;
  - breach and default events.
- **Exit multiple per path:** drawn from E1's deal multiples, conditioned on the market level at exit. Deal
  EV/EBITDA is regressed on a sector public-multiple index at the time, which couples multiple compression to
  the macro path.
- **Outputs:**
  - IRR and MOIC distributions (fan and histogram);
  - P(IRR < 0), P(MOIC < 1×);
  - P(covenant breach) by year;
  - P(equity value < 50% of entry);
  - returns attribution as distributions;
  - **the maximum entry price at a 20% IRR with ≥ 60% probability** (bisection over price).
- **Reverse stress test** (new, `scen/reverse.ts`):
  - find the scenario with the **smallest relative entropy** to the base distribution (Entropy Pooling,
    existing `scen/views.ts`) in which the covenant breaches by year N;
  - report it in words, with its plausibility. For example: "Rates +170bp with EBITDA −11% breaches the 6.0×
    test in Q7. Under the base model that view has an effective probability of about 1 in 15."
  - This uses Edge's existing machinery in a way no LBO tool does.
- **Labelling:** synthetic everywhere, as Scenarios requires: recipe, seed and realism score on every chart
  and sheet.

**Uncertainty and audit.**
- Every output is a distribution with its seed.
- Assumptions (spread model, margin reversion) are listed and editable.
- **Validation view:** for sponsor deals in F4 with public post-LBO filings (high-yield issuers file 10-Ks),
  check whether realised EBITDA paths fell inside the model's 80% band in a backtest from the deal date. The
  coverage achieved is shown, with n.
- The run is saved like scenarios (`edge_scenarios` kind `lbo`) with provenance for its inputs.

**Plugs into Edge.**
- **Reuses:**
  - `scen/models.ts`, `views.ts`, `company.ts`, `realism.ts`, `store.ts`, `run.ts` (refine on the ML service);
  - the `lbo-returns` calculator's maths (refactored);
  - E1 for entry and exit multiples;
  - Studio push.
- **New code:** `scen/lbo.ts`, `scen/rates.ts`, `scen/reverse.ts`, and the tab component
  `src/components/edge/scen/LboTab.tsx`.
- **Routes:**
  - `POST /api/edge/scenarios` with `kind: "lbo"` (preview of 1,000 paths inline, about 1–2 s);
  - `POST /api/edge/scenarios/[id]/refine` (20,000 paths on the ML service, `synth.series` style).
- **Canvas:** a new node `scen.lbo`. Inputs are companies (required), deals (optional) and scenario
  (optional, its macro driver); outputs are `scenario` and `table`.
- **Terminal:** `LBO <ticker>` opens the lab with defaults. The Tools LBO calculator gains "Stress this".
- **No feed kind.** As an exception, a monitored LBO canvas can alert when breach odds cross a line, through
  `out.signal`.

**UI.**
- **Desktop.** A Scenarios tab, "LBO":
  - **left:** company, a structure builder (tranche rows with drag order), covenants, exit;
  - **right:**
    - the IRR fan over time;
    - a breach heatmap (years × covenant);
    - the attribution waterfall with bands;
    - the max-price curve (price against P(IRR ≥ hurdle));
    - the "gentlest path to breach" card;
  - "Send to Studio" pushes a SYNTHETIC-labelled scenario sheet.
- **Phone.** A simplified lab: entry multiple and leverage sliders, then the IRR distribution, breach odds
  and the breach scenario sentence. Editing tranches is desktop and tablet only, like canvases.

**Free and premium.**
- **Free:** 1,000 paths, a 5-year horizon, the reverse stress test, Studio push. The cost is browser or
  serverless CPU only.
- **Premium possibilities:**
  - "Refine" to 20,000 paths and 7 years on the ML service (about $0.01);
  - TimesFM anchors (existing premium);
  - a saved tranche library per team;
  - a live Excel link (perk).

**Test plan.**
- **Unit:**
  - the refactored LBO maths equals the old calculator to the cent on its fixtures;
  - covenant logic (springing tests);
  - the IRR solver on known cash flows;
  - the rate model's stationarity and fit;
  - reverse stress returns a scenario that breaches and minimises entropy among candidates (a toy case with a
    known answer);
  - seeds reproduce;
  - realism of the rate paths against block-bootstrap bands.
- **Evaluation:** the validation coverage script `scripts/eval-lbo.ts`.

**Size: M.**

**Risks.**
- The spread proxy is the weakest link, so it is labelled and overridable.
- False precision: bands are always shown, never a single IRR.
- Private-target inputs are typed in, so outputs are only as good as the inputs.

---

### E7. Thesis Agent

**Pitch.** State a thesis ("ET buys a Permian gatherer within 12 months", "Is Permian midstream consolidation
over?"). An agent investigates it for days:
- it builds and runs Edge canvases;
- it keeps a tree of claims with probabilities that move as evidence arrives;
- it sets the kill criteria as monitors;
- a red team argues the other side;
- it writes a living memo that says what changed.

**Problem, and who it is for.**
- Theses are tracked in heads and stale memos.
- AlphaSense, Hebbia, Rogo and Brightwave all write *one-off* reports. Nobody keeps a thesis alive, honestly
  scored, against kill criteria.
- For **PE and VC deal teams**, **corp dev** (an M&A thesis), **bankers** (an idea a coverage MD wants
  watched) and **markets**.

**How it works.**
- **Runtime (F5)** (`src/lib/edge/agent/`):
  ```
  edge_agents(id serial pk, owner_id text, team_id int, title text, thesis text, status text,  -- planning | running | paused | done | stopped
    horizon_end date, budget_usd real, spent_usd real, model text, cadence text,               -- daily | twice-weekly
    canvas_ids jsonb, memo jsonb, created_at, updated_at)
  edge_agent_steps(id bigserial pk, agent_id int, day date, kind text,                          -- plan | tool | evidence | update | redteam | memo | approval
    tool text, input jsonb, output jsonb, cost jsonb, error text, created_at)
  ```
  The claims are F3 `edge_forecasts` of kind `thesis_claim`, with subject `thesis:<id>:claim:<n>`, a parent
  in `rule.parent` and `manual` or automatic rules.
- **Typed tool registry** (`agent/tools.ts`). Each tool is a thin, permission-checked wrapper over existing
  functions, with a cost estimate:

  | Tool | Wraps |
  |---|---|
  | `ask_documents` | `askDocuments`, Strict |
  | `change_radar` | `changeRadar` |
  | `graph_findings` | predictions, exposure, red flags |
  | `deal_odds` | E4 |
  | `pulse` | E3 |
  | `precedents` | E1 |
  | `scenario` | Scenarios run, synthetic-labelled |
  | `earth_findings` | ground changes, flaring, permits for a company |
  | `newsroom_search` | clusters |
  | `web_research` | the assistant's existing tool, with its keep-only-if-retrieved rule |
  | `create_canvas` / `deploy_monitor` | the canvas AI builder and the monitor; within the person's monitor limit |
  | `draft_intro` | the existing CRM intro draft under autopilot rules; **never sends on its own** |

  There is no free browsing and no code execution. Premium tools (reranking, the stronger model) work only
  inside the person's premium scope, which is re-checked by id (`premiumScopeById`) on every tick.
- **Plan (day 0):**
  - the agent turns the thesis into 3–8 claims, each falsifiable with a resolution rule where possible
    ("XYZ announces an acquisition ≥ $1B by 2027-04"; "Permian gathering volumes keep growing ≥ 5% a year in
    EIA data");
  - each claim gets a prior from a reference class: base rates from F4 or E4 where available, else a stated
    subjective prior marked as such;
  - it sets evidence plans and 2–4 **kill criteria**, each deployed as a canvas monitor with `out.signal`;
  - **the person approves the plan before anything runs.**
- **Ticks (daily or twice weekly, an Inngest function `edge/agent.tick`):**
  - read the deltas since the last tick: monitor outputs, new filings and cards for the thesis's companies,
    the feed;
  - run up to N tool calls (budgeted);
  - extract evidence items `{claim, direction, strength, quote, source}`, checked by E2's verifier (only
    supported evidence counts).
- **Updating:**
  - each evidence item moves its claim by a fixed **likelihood-ratio ladder** (weak 1.5, moderate 3, strong
    8) in log-odds space, capped per tick;
  - the ladder is a stated rule, not a hidden model judgement;
  - parent probabilities combine children by declared logic (all, any, weighted);
  - the ladder's calibration is itself tracked in the ledger, so after enough resolved claims the Track
    record shows whether the agent is over- or under-confident, and the ladder is re-fitted.
- **Red team (each tick that moves a claim by ≥ 10 points):**
  - a second prompt, from a different provider when both keys exist, writes the strongest counter-case and
    must cite evidence;
  - its points enter as evidence only if they pass the verifier;
  - once a week the agent writes a pre-mortem: "If this thesis fails, the likeliest reason is…".
- **Memo:** a living memo (`out.memo` format, Calibrated Claims dots) with "What changed since <date>", the
  claim tree, the evidence log and the kill-criteria status. It can be published as a Story.
- **Budget and safety:**
  - hard caps on dollars, steps a tick, ticks and horizon, with the AI caps on top;
  - every step is logged with its inputs, outputs and cost;
  - an approval step is needed for anything that spends premium money or drafts outreach;
  - the agent stops itself when the budget is reached or every claim has resolved.

**Uncertainty and audit.**
- Claim probabilities are shown as "agent estimate" with their prior, the evidence log and the ladder
  version.
- Resolved claims feed F3, so the agent itself has a public track record.
- The full step log exports as CSV or JSON for compliance.

**Plugs into Edge.**
- **Reuses:**
  - the canvas engine and the AI builder (`canvas/build.ts`);
  - monitors, stories, the docs answerer;
  - E1–E5 as tools;
  - the deep-research protocol for weekly syntheses on the premium path (`src/lib/ai/deep.ts`).
- **New code:** `src/lib/edge/agent/` (`runtime.ts`, `tools.ts`, `plan.ts`, `update.ts`, `redteam.ts`,
  `memo.ts`).
- **Routes:**
  - `POST /api/edge/agents` (create from a thesis; returns the plan to approve);
  - `POST /api/edge/agents/[id]/approve`, `/pause`, `/stop`, `/evidence` (a person adds evidence);
  - `GET /api/edge/agents/[id]` (with steps paged).
- **Finding kind** `thesis_update` (owner-only, `owner_id` set). It posts when a claim moves ≥ 10 points or a
  kill criterion fires; `isBig` when a kill criterion fires.
- **Feed and notifications:** the person's daily digest gains "Your theses".

**UI.**
- **Desktop.** A **Theses** view: a list of theses with an overall probability dial and a sparkline. A
  thesis page shows:
  - the claim tree with probabilities, priors and sparklines;
  - the evidence stream (source card, direction arrow, strength chip, quote; tap to cite);
  - the red-team panel;
  - kill criteria with live monitor state;
  - the agent log (every tool call, its cost and output, filterable);
  - budget, pause, stop and override controls. An override is logged and shown as a "person override".
- **Phone.** A thesis card in the feed ("31% → 38%: Targa's 10-Q added a strategic-review risk factor").
  Tapping opens a stacked page (claims, latest evidence, kill criteria). Plan approval and pause work on the
  phone.

**Free and premium.**
- **Free:**
  - one active thesis, 14-day horizon, daily ticks;
  - the small model for extraction and gpt-5.6-sol only for the weekly memo;
  - about $0.02–0.05 a tick for routing and extraction, plus what each tool costs. A document question is the
    largest item: about $0.22 on the default answer model, the figure `edge.batch-ask` uses. The free version
    caps it at two document questions a tick, about $0.50 a tick at most;
  - about $0.15 a week for the memo.
- **Premium possibilities:**
  - up to 5 theses (Pro) or team theses (Deal Team);
  - a 90-day horizon;
  - a flagship weekly synthesis using the deep-research protocol (about $2.50 a pass, as `ai.deep-research`);
  - ticks twice daily on filing days;
  - a red team on a second provider (about $0.05 a tick).

**Test plan.**
- **Unit:**
  - plan schema validation (every claim has a rule or `manual`, a prior in (0, 1), at least one evidence
    plan);
  - log-odds update maths and caps;
  - parent combination;
  - budget enforcement (a tool call that would exceed the budget is refused before it runs);
  - tick idempotence (re-running a tick with the same step ids does nothing twice);
  - premium tools are refused without scope;
  - the evidence verifier gate.
- **Replay test:** a recorded set of tool outputs drives three ticks deterministically. The probabilities and
  memo sections match a snapshot.

**Size: L.**

**Risks.**
- Cost runaways (hard caps).
- Confident-sounding drift (the verifier gate, the ladder and the red team).
- Over-trust (the track record and the "agent estimate" label).
- Inngest execution budget: about 15 steps a tick; with 100 active theses at daily ticks that is about 45K a
  month. That exceeds the free tier (open question 2), so the free version is limited to one thesis per person
  and batches tool calls inside one step where safe.

---

### E8. Management Track Record

**Pitch.** A management team's public record in one place: what they said against what they did, how their
deals turned out, how they bought back stock, how insiders traded, and how pay tracked performance. Every
component carries a shrinkage interval, and there is no single opaque grade.

**Problem, and who it is for.**
- "Management quality" is the top diligence question in PE and credit, and it is answered by anecdote.
- For **PE** (backing a team), **credit** (trusting guidance), **bankers** (pitch preparation) and **activists
  and markets**.

**How it works.** The components, each from public data:

| Component | Measure | Source |
|---|---|---|
| Said against did | Guidance hit rate and bias (E5 ledger), Beta-binomial with an empirical-Bayes prior from the sector | E5, XBRL |
| Capital allocation | Acquisitions (F4) followed within 3 years by goodwill impairment (`GoodwillImpairmentLoss`), ROIC against the cost of capital trend (existing `WACC`), buyback timing (repurchase dollars against the average price percentile) | F4, XBRL, prices |
| Insiders | Open-market purchases (Form 4 code P) against sales; plan (10b5-1) share | Form 4 (existing graph parse) |
| Stability | CEO and CFO tenure and turnover (8-K 5.02), auditor changes, restatements | existing `eventFlags` |
| Pay against performance | Compensation actually paid against total shareholder return, from the proxy's tagged pay-versus-performance table (Inline XBRL `ecd:` taxonomy, required since fiscal 2022) | DEF 14A XBRL |
| Candour | E5 evasion trend | E5 |
| Board | Interlocks, overboarding, shared directors with counterparties | existing graph |

- **Shrinkage:** empirical Bayes per component (Beta-binomial for rates, normal-normal for continuous) toward
  the sector distribution, giving a percentile with an 80% credible interval. Components are never averaged
  into one score unless the person asks, and the weights are then shown.
- **Validation:**
  - does a component predict 3-year forward ROIC change, guidance misses or E4 events?
  - correlations with bootstrap intervals are reported on the panel;
  - a component that predicts nothing is labelled "descriptive".
- **People:** only public roles, using filings about officers and directors. No personal life and no
  location, as Edge's compliance section requires.

**Uncertainty and audit.** Intervals on every component; provenance to each filing; the method version.

**Plugs into Edge.**
- **Reuses:** E5, F4, the graph and Form 4 parsing, the WACC model, F3.
- **New code:** `src/lib/edge/mgmt/` and a route `GET /api/edge/mgmt?ticker=`.
- **Finding kind** `mgmt_shift`: a component moves out of its interval (for example, a third guidance miss in
  a row).
- **Terminal:** `MGMT <ticker>`. Canvas node `mgmt.score` (companies → table).

**UI.**
- **Desktop.** One row per component with a bar, its interval and the sector median tick. Each row expands to
  its evidence (the promises table, the deals with impairment dates, a buyback-against-price chart, a tenure
  timeline).
- **Phone.** Component rows that expand in place.

**Free and premium.** Free throughout: about $0.003 a quarter per company, from E5's extraction. A possible
premium is the peer comparison export.

**Test plan.**
- Beta-binomial and normal-normal shrinkage against closed-form cases.
- The buyback timing percentile.
- Parsing of the pay-versus-performance XBRL from a saved proxy.
- Impairment linkage to an acquisition (fixture).

**Size: M** (after E5 and E1).

**Risks.** Small samples (shrinkage handles them, and the UI says "little data"). Attribution across CEO
changes: the record is split by CEO tenure.

---

### E9. Supply-Chain Atlas

**Pitch.** It turns supplier and customer links from contracts, filings, power-plant fuel receipts and ship
movements into Edge's graph. Inferred links carry calibrated odds, and supply shocks propagate through them
with the uncertainty shown.

**Problem, and who it is for.**
- Edge's supply graph today is only the 10-K major-customer disclosures (10%+ customers).
- Real exposure sits in the long tail, and in physical flows that filings never name.
- For **credit and markets**: contagion. For **corp dev and PE**: vertical integration targets and supplier
  risk in diligence. For **energy bankers**: who supplies whom.

**How it works.**

*Data.*

| Source | URL | Licence | Gives |
|---|---|---|---|
| USAspending prime awards and FFATA subawards | `https://api.usaspending.gov/api/v2/subawards/` | Public domain | Prime → subcontractor links with amounts and dates (defence, aerospace, IT services) |
| EIA-923 fuel receipts | `https://www.eia.gov/electricity/data/eia923/` | Public domain | Coal, gas and oil deliveries by supplier to each power plant, with quantity and cost: real supplier → utility links |
| EIA-860 plant data | `https://www.eia.gov/electricity/data/eia860/` | Public domain | Plant owners and operators (into F1) |
| NOAA Marine Cadastre AIS | `https://hub.marinecadastre.gov/` (vessel traffic) | CC0, US waters, released with a lag | Port calls at Edge's mapped terminals: which vessel types and operators visit whose terminals |
| Census port-level trade | `https://api.census.gov/data/timeseries/intltrade/imports/porths` | Public domain | HS-code flows by port and month, a sector-level check on terminal activity |
| BEA input-output tables | `https://www.bea.gov/industry/input-output-accounts-data` | Public domain | Industry-to-industry requirements, a prior for which links are plausible |
| 10-K text and 8-K 1.01 agreements | EDGAR | Public | Named suppliers, "sole source" language, supply and offtake agreements, each quoted |

*Methods.*
- **Extraction:** supplier mentions come from 10-K Item 1 and 1A and from 8-K Item 1.01 agreement summaries,
  read by the small model with quotes (E2-verified).
- **Entity resolution:** award recipients, EIA supplier names and AIS operators are matched to graph nodes
  through F1, with review below 0.9.
- **Inference of missing links:**
  - candidates are company pairs whose industries the BEA tables connect strongly, within a distance of
    plants and terminals;
  - a LightGBM link model uses features (I-O coefficient, distance, 10-K text similarity of products,
    common neighbours, size ratio) and is trained on known links (disclosed plus awards plus EIA) with a
    held-out set;
  - inferred links are kept at p ≥ 0.5, **drawn dashed and labelled "inferred, p = 0.62"**;
  - precision@k on held-out known links is reported.
- **Shock propagation:** the existing `exposure()` (graph contagion) runs as a Monte Carlo over link
  uncertainty. Each inferred link is present with its probability, and known links carry their disclosed
  share. The result is an exposure distribution per company: a median with a 10–90% range.

**Uncertainty and audit.**
- Every link carries its source (an award id, an EIA row, an AIS summary, a quote) or its inference
  probability.
- Exposure is shown as a range.
- AIS-derived links say "observed port calls, not contracts".

**Plugs into Edge.**
- **Extends:**
  - `edge_links` with new kinds: `supplies` (from awards, EIA, quotes), `calls_at` (AIS), `inferred_supply`;
  - `attrs` holds `{p, amount, period}`.
- **New code:** `src/lib/edge/graph/supply/` (`usaspending.ts`, `eia923.ts`, `ais.ts`, `extract.ts`,
  `infer.ts`). AIS is processed on the ML service (new task `ais.portcalls`): monthly files are large, and only
  aggregated port calls per terminal polygon reach Postgres.
- **Networks** gains a "Supply" finding, and the `net.graph` node gains `finding: "supply"`. The
  supply-shock starter canvas uses it.
- **Finding kinds:** `supply_link` (a new disclosed or observed link for a watched company) and
  `supply_shock` (a watched company is exposed to a fresh event: a WARN notice, flaring or a ground change at a
  supplier's site).

**UI.**
- **Desktop.**
  - A layered upstream and downstream view in Networks (tiers left and right of the company), with link
    width by amount and dashed links for inferred ones.
  - A map mode with arcs for EIA fuel deliveries and AIS port-call links (deck.gl arcs, already loaded for 3D).
  - An exposure panel with ranges.
- **Phone.** Tier lists (suppliers, customers), each row with source chips. The map is read-only.

**Free and premium.**
- **Free:** every source above. AIS processing is about $0.02 a month on the ML service; extraction is about
  $0.01 per company.
- **Premium possibilities (bring your own licence):**
  - live global AIS (aisstream.io once its terms allow commercial use; Spire);
  - bills of lading (Panjiva, ImportGenius);
  - Kpler or Vortexa flows.

**Test plan.**
- The EIA-923 parser on a fixture year.
- Subaward parsing.
- AIS port-call aggregation on a synthetic track crossing a terminal polygon.
- Link-model features.
- Monte Carlo exposure with a known two-link case (analytic expectation).

**Size: L.**

**Risks.**
- Resolution errors create false links (the review queue helps).
- Bias toward government suppliers and energy.
- AIS lag makes it a structure signal, not a live one.
- Inferred links could mislead, so they are dashed, carry their p, and never feed alerts unless p ≥ 0.8.

---

### E10. Patent and Tech Landscape

**Pitch.** Maps of who is building what, from US patents:
- technology clusters;
- each company's territory and momentum;
- citation dependencies;
- a buyer–target **technology fit** score, which research ties to which mergers happen.

**Problem, and who it is for.**
- Tech, healthcare and industrials bankers need tech-fit arguments.
- Corp dev scouts acquisition targets by technology.
- VC maps white space.
- Bena and Li (2014, *Journal of Finance*) found that technological overlap predicts which companies merge
  *(prior knowledge)*. That is a free, evidence-backed signal for E4 and the GNN.

**How it works.**
- **Data:**
  - PatentsView (CC BY 4.0): grants and pre-grant publications, CPC codes, disambiguated assignees and
    citations, through the PatentSearch API (`https://search.patentsview.org/api/v1/`, free key) and the bulk
    tables on the USPTO Open Data Portal;
  - assignees are resolved to graph nodes and startups through F1.
- **Scope:**
  - patents of assignees in the graph universe, watched companies and the top 2,000 `/app/vc` startups, plus
    any CPC subclass a person maps;
  - about 300–600K patents.
- **Embeddings:**
  - PaECTER (`mpi-inno-comp/paecter`, a citation-informed patent encoder; **confirm the weights' licence on
    the model card before use**; the paper is CC BY 4.0) on the ML service CPU in batches (new task
    `patents.embed`);
  - the fallback is `text-embedding-3-small` on abstracts (about $3 for 500K abstracts).
- **Storage:**
  - vectors live in R2 (they would exceed Neon's budget);
  - Postgres keeps per-assignee-year centroids and CPC count vectors only (`edge_series` for counts; a small
    `edge_tech_profiles(node_id, year, centroid halfvec(512), cpc jsonb)` table).
- **Analyses:**
  - **the map:** UMAP on a sample (existing `topics.map`), with clusters named by the small model from their
    top CPC titles and claims;
  - **tech fit:** Jaffe cosine of CPC vectors and centroid similarity for a buyer–target pair, as a
    percentile among all pairs in the sector;
  - **citation dependency:** the share of a company's citations to another's patents;
  - **momentum:** applications against grants by cluster, labelled with the 18-month publication lag.
  - Tech fit and dependency become **features for E4 and the GNN**, evaluated by the backtest before they are
    kept.
- **People:** inventor-level tracking is **not** offered. Inventors are private individuals, so only
  aggregate counts are used.

**Uncertainty and audit.**
- Lags are stated: grants trail filing by about 2–3 years, and publications by 18 months.
- Fit percentiles state their reference set.
- PatentsView attribution goes in provenance and the UI footer.

**Plugs into Edge.**
- **New code:** `src/lib/edge/patents/`, the ML task `patents.embed`, the `edge_tech_profiles` table.
- **Routes:** `GET /api/edge/patents?ticker=`, `GET /api/edge/patents/fit?a=&b=`.
- **Canvas:** a node `patents.map` (companies → table and graph).
- **Networks reason paths** gain "tech fit: 94th percentile" when it is used.
- **Finding kind** `patent_shift` (through E3).

**UI.**
- **Desktop.**
  - A landscape scatter (deck.gl, already in the bundle for 3D) coloured by company, with cluster labels.
  - A company panel (territory, momentum and top cited-by).
  - A pair view: two companies' territories overlaid, with the fit score.
- **Phone.** Ranked lists (clusters, top patents, fit score) with no scatter.

**Free and premium.**
- **Free:** the scope above. Embedding is about $0.30 of ML CPU per 500K patents, or about $3 with OpenAI
  embeddings.
- **Premium possibilities:** user-defined landscapes over large CPC areas (an ML run, about $0.50–2.00), and
  claim-level semantic search.

**Test plan.**
- Jaffe cosine.
- Assignee resolution fixtures.
- The CPC parser.
- The fit percentile on a toy set.
- Backtest gating (a feature that does not improve E4's out-of-time Brier is not kept).

**Size: M.**

**Risks.** Assignee names (subsidiaries, holding companies: F1 and GLEIF parents help). US-only coverage. Weak
signal for software companies that patent little.

---

### E11. Buyer Simulator

**Pitch.** A counterfactual sale process. Plausible buyers are simulated as agents with valuations, capacity
and participation odds, then run through auction formats. It gives the likely clearing premium, who wins, what
one more bidder is worth, and the risk the process fails. It is calibrated on the bidder funnels disclosed in
merger proxies.

**Problem, and who it is for.**
- Sell-side bankers decide the buyer list, the process format and price expectations on judgement.
- For **sell-side M&A**, **sponsors** (should we bid, and what will it take) and **corp dev** (should we
  pre-empt).

**How it works.**
- **The buyer set:**
  - the GNN's likely buyers;
  - E4 acquirer odds;
  - sponsors active in the sector over 5 years (F4);
  - the person's additions.
- **Each buyer's valuation:** V_i = the target's standalone value (comps or DCF from Terminal models) × (1 +
  s_i), where:
  - s_i is drawn from a distribution conditioned on overlap features (Earth pro-forma overlap where mapped,
    shared customers, tech fit from E10, sector);
  - the distribution is fitted from **announced synergies as a percentage of target revenue in F4**;
  - a private noise term is added.
- **Each buyer's ability to pay:**
  - strategics: leverage headroom to a chosen net debt/EBITDA plus stock currency (XBRL, prices);
  - sponsors: E6's maximum price at the hurdle.
- **Participation:** a logit on fit, capacity, recent deal activity and E4 acquirer odds, calibrated so the
  simulated funnel (contacted → NDA → IOI → final bid) matches the **funnels extracted from "Background of the
  Merger" sections in F4**, by sector and size.
- **Mechanics:**
  - a broad or targeted auction (two rounds: IOIs, then sealed final bids with best-and-final), or a
    negotiated sale with a go-shop;
  - bidders shade bids by a rule from auction theory, with a common-value component for the winner's curse;
  - the board reserve is the low end of the fairness range or the 52-week high;
  - 10,000 Monte Carlo runs.
- **Outputs:**
  - the distribution of the clearing premium and EV/EBITDA;
  - each buyer's win probability;
  - the **value of one more bidder** (cf. Bulow and Klemperer 1996, *prior knowledge*);
  - the probability of a failed process;
  - the expected funnel counts.
- **LLM role:** optional persona memos ("why Buyer X would bid, and its constraints"), each citing the
  buyer's 10-K strategy passages through E2. **They never set numbers.** The literature (AuctionArena, InfoBid,
  Horton) shows LLM bidders behave plausibly but are not calibrated valuers.
- **Validation:**
  - for completed F4 deals, the simulator is run as of the announcement date minus 6 months, with the actual
    buyer hidden;
  - the score is the log-likelihood of the actual premium and the rank of the actual winner, logged in F3
    (kind `buyer_win`);
  - the scorecard shows the predicted against realised premium distribution (PIT histogram).

**Uncertainty and audit.** Every output is a distribution, and every parameter's source (a fitted
distribution with n deals) is listed. Labelled SYNTHETIC, as Scenarios is.

**Plugs into Edge.**
- **Reuses:** `proforma.ts` (overlaps), graph predictions, E1, E4, E6, E10, the Scenarios store and labelling.
- **New code:** `src/lib/edge/scen/auction.ts` (pure), a canvas node `buyers.simulate` (companies + deals →
  scenario, table), and a route through `POST /api/edge/scenarios` with `kind: "auction"`.
- **Studio:** a "Buyer universe and process" slide and sheet.

**UI.**
- **Desktop.**
  - A buyer table (fit, capacity, participation, win probability, median bid).
  - A clearing-premium histogram against F4's sector premiums.
  - A funnel chart.
  - A "+1 bidder" what-if.
  - Format switches.
- **Phone.** Read-only results: top 5 buyers by win probability, the premium range and the failure risk.

**Free and premium.**
- **Free:** 2,000 runs and the quantitative model.
- **Premium possibilities:** 20,000 runs on the ML service (about $0.01); persona memos on the stronger model
  (about $0.10 a buyer); a saved process-design comparison report.

**Test plan.**
- The auction with known valuations reproduces second-price and English outcomes.
- The bid-shading rule's equilibrium in a symmetric case.
- Funnel calibration recovers parameters from synthetic funnels.
- Reproducible seeds.
- The backtest harness on fixture deals.

**Size: L.**

**Risks.**
- Calibration data is thin: proxy funnels exist only for public targets.
- Synergy distributions are wide, so the honest ranges are wide.
- It must not be presented as a valuation opinion.

---

### E12. Regulatory Shock Simulator

**Pitch.** When a rule is proposed, Edge shows which companies it hits and by how much, with a range. The
range comes from the rule's own regulatory impact analysis and from how similar past rules moved the companies
they affected. It also states the odds that the rule becomes final.

**Problem, and who it is for.**
- Regulatory risk is read rule by rule.
- For **sector bankers** (healthcare, energy, financials, telecom), **corporate finance** (planning) and
  **markets**.

**How it works.**
- **Data (all public):**
  - Federal Register API (`https://www.federalregister.gov/api/v1/documents.json`), which the Newsroom
    already reads;
  - regulations.gov v4 (`https://api.regulations.gov/v4/`, free api.data.gov key) for dockets and comment
    counts;
  - the Unified Agenda (`https://www.reginfo.gov/public/do/eAgendaMain`) for stages and timetables;
  - the eCFR API for the current text.
- **Mapping a rule to companies:**
  - rules often list affected NAICS codes and annualised costs in their Regulatory Flexibility Act and
    impact-analysis sections, extracted with quotes;
  - companies are matched by NAICS or SIC (F1), plus 10-K text similarity to the rule's summary, plus
    segment revenue exposure (XBRL segments);
  - the result is an exposure score with a range.
- **Cost allocation:** the impact analysis's annual cost is allocated by revenue share, giving a
  labelled-estimate range of EPS impact.
- **Event-study prior:**
  - similar past rules (by embedding) and their affected firms' abnormal returns at proposal and final dates;
  - a market or factor model with the existing betas;
  - shown as a CAR distribution with a CI;
  - it says "few analogues" when n < 10.
- **Odds of finalisation:** base rates by agency and rule type from Federal Register history (proposed →
  final within 24 months), adjusted by stage and comment volume. Logged in F3 (kind `rule_final`).

**Uncertainty and audit.** Ranges everywhere; quotes from the rule; analogues listed; base rates with n.

**Plugs into Edge.**
- **Reuses:** the Newsroom's Federal Register reader, `scen/data.ts` betas, docs ingest (rules become
  `edge_docs` with source `web`), F1, F3.
- **New code:** `src/lib/edge/reg/`.
- **Finding kinds:** `reg_exposure` (a watched company appears in a new rule's exposure set) and
  `comment_deadline`.
- **Canvas node** `reg.impact` (companies or a rule URL → table, memo).
- **Terminal** `REG <ticker>`.

**UI.**
- **Desktop.** A rule page with:
  - the summary, stage and the odds of becoming final;
  - affected companies ranked by exposure, with range bars;
  - the analogues' CAR chart;
  - the comment timeline.
- **Phone.** The rule card, top exposed companies and the deadline.

**Free and premium.** Free: about $0.01 a rule on the small model. A possible premium: a custom rule
what-if, where a person pastes a draft rule (about $0.05).

**Test plan.** NAICS extraction on fixture rules; abnormal-return maths; the base-rate computation; exposure
ranking on a toy set.

**Size: M.**

**Risks.** Many rules lack company-level costs, so ranges are wide. Analogues are imperfect. It is not legal
advice.

---

### E13. Voice Analyst

**Pitch.** Hold to talk on a phone and ask "What changed at Targa this week?" or "Read me my digest." Speech
is recognised on the device. Answers are grounded in Edge, with citations on screen. Live back-and-forth
conversation is the premium option.

**Problem, and who it is for.**
- Deal people are mobile: commuting, between meetings.
- Edge's feed works on phones, but questions need typing.
- For **MDs and partners** above all, and **analysts** preparing on the move.

**How it works.**
- **Free path:**
  - **speech-to-text on the device:** Moonshine (MIT *(prior knowledge)*) through Transformers.js (WebGPU,
    with a WASM fallback);
  - if the device cannot run it, the clip goes to the existing `audio.transcribe` task (Parakeet);
  - Edge never uses the browser's built-in recognition, which in Chrome sends audio to Google.
  - **routing:** an intent router (the small model, structured output) maps the question to Edge tools from
    E7's registry: feed summary, ask documents (Strict), company overview, odds, pulse, thesis status;
  - **the answer:** a short spoken script plus on-screen citations;
  - **speech:** text-to-speech on the device with Kokoro-82M (Apache-2.0 *(prior knowledge)*), with the
    browser's `speechSynthesis` as fallback.
- **Commute brief:** the daily digest is read aloud with voice controls ("next", "more on that", "save",
  "remind me tomorrow").
- **Voice notes:** "Note on Targa: CFO sounded cautious on volumes" becomes a CRM note on the contact or
  company (existing CRM paths). Edge **never sends an email by voice**; drafts only.
- **Premium path:**
  - OpenAI `gpt-realtime-2.1` over WebRTC, with an ephemeral key minted by the server after
    `requireFeature`;
  - function calls go to the same tool registry;
  - a session cap (for example, 10 minutes) and a per-day cap.

**Uncertainty and audit.**
- Spoken answers say when something is uncertain or not found, in the same Strict wording.
- The transcript and citations are saved to the person's history (`edge_answers` with source `voice`).
- Audio is not stored unless the person saves it.

**Plugs into Edge.**
- **Reuses:** E7's tool registry, the docs answerer, the feed, the digest, CRM notes.
- **New code:** `src/components/edge/voice/` (the push-to-talk sheet and the on-device model loader in a Web
  Worker), `src/lib/edge/voice/` (router, script writer).
- **Routes:** `POST /api/edge/voice/ask` (text in, script and citations out); `POST /api/edge/voice/session`
  (premium realtime key).

**UI.**
- **Phone first.** A floating hold-to-talk button on Edge pages, a sheet with live transcript bubbles,
  citation chips that open the viewer, and big controls in commute mode. It works with the screen locked via
  the Media Session API for the brief.
- **Desktop.** The same, from a keyboard shortcut.
- **Accessibility:** captions always on; a reduced-motion waveform.

**Free and premium.**
- **Free:** on-device speech, so the model cost is only the answer:
  - about $0.001–0.01 for feed, overview, odds and pulse questions, on the small model;
  - a document question costs what Ask costs today, about $0.22 on the default answer model.
- **Premium:** realtime conversation at about $0.06–0.11 a minute (OpenAI list prices, July 2026), capped per
  day.

**Test plan.**
- Intent router fixtures (40 utterances → the tool and its arguments).
- Script length limits.
- The no-send guard (a "send it" intent becomes a draft).
- The ephemeral-key route checks the plan.
- On-device loader fallback logic (a mock with WebGPU missing goes to WASM, then to server ASR).

**Size: M.**

**Risks.**
- On-device model download size (Moonshine tiny or base is about 30–60 MB, cached), so it is lazy-loaded on
  first use with a progress bar.
- Noisy environments; the transcript is shown for confirmation.
- Realtime cost runaways (hard caps).

---

### E14. Deal Aftermath

**Pitch.** Did past deals deliver? For completed acquisitions, Edge estimates realised cost synergies and
value creation against a synthetic control built from peers, compares them with the synergies announced, and
reports placebo-tested significance.

**Problem, and who it is for.**
- Synergy assumptions in merger models are rarely checked against history.
- For **corp dev** (benchmarks for the next deal), **bankers** (credible synergy cases), **PE** (operating
  value creation) and E8 (capital allocation).

**How it works.**
- **Cases:** completed deals in F4 where both sides filed XBRL before closing and the acquirer files after.
- **Pre-period:** the pro-forma combined company (acquirer + target, summed by concept) for 8–12 quarters.
- **Donor pool:** sector peers without major deals in the window.
- **Synthetic control** (Abadie, Diamond and Hainmueller 2010): a non-negative, sum-to-one weighting of donors
  that matches the combined company's pre-period SG&A/revenue, COGS/revenue and revenue growth.
- **Post-period effect:** the gap over 8 quarters.
- **Inference:** placebo tests in space (each donor treated as if acquired), giving a permutation p-value and
  the post/pre RMSPE ratio.
- **Stock leg:**
  - CAR at announcement (market model, existing betas);
  - 1–3-year buy-and-hold abnormal returns against the synthetic portfolio, labelled with the known
    limitations of long-horizon tests.
- **Comparison:** realised cost savings in dollars against the announced synergies (extracted in F4).
- **Benchmarks:** realisation ratios by sector, with medians and IQR, which feed E6 and E11's synergy priors.

**Uncertainty and audit.**
- Placebo p-values and pre-period fit quality are shown.
- A poor pre-period fit (RMSPE above a threshold) gives "not estimable", not a number.

**Plugs into Edge.**
- **Reuses:** F4, XBRL, Scenarios' betas, the comps engine's concept mapping.
- **New code:** `src/lib/edge/aftermath/` (pure synthetic control by quadratic programming with a small
  active-set solver).
- **Canvas node** `aftermath.track` (deals → table).
- Shown on the E1 deal page as a "Did it work?" tab, and in E8.

**UI.**
- **Desktop.**
  - The combined company against the synthetic control (with the pre-period fit shaded).
  - The gap chart.
  - The placebo spaghetti plot.
  - Announced against realised bars.
- **Phone.** A summary card ("SG&A/revenue −1.8pp against synthetic, p = 0.07; announced ≈ −2.4pp") with the
  gap chart.

**Free and premium.** Free (CPU only). A possible premium: sector benchmark exports.

**Test plan.**
- Synthetic control recovers a planted effect on simulated panels.
- Placebo p-values are uniform under the null.
- The QP solver against known solutions.
- Pro-forma concept summation.

**Size: M.**

**Risks.**
- Accounting changes and other deals contaminate effects.
- Few clean cases per sector.
- Attribution is never certain, so the wording is "consistent with".

---

## 5. Ranking, the chosen set and build order

### 5.1 Impact × feasibility

- **Impact** (1–5): how often deal professionals would use it, how much it changes a decision, and whether
  any competitor already does it.
- **Feasibility** (1–5): free data that exists today, reuse of Edge's code, model risk, and builder time.
- **Shared** names the foundations and features each one reuses or feeds. It breaks ties.

| Rank | Feature | Impact | Feasibility | Score | Size | Shared | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | E1 Precedent Engine | 5 | 4 | 20 | L | builds F4; feeds E4, E6, E8, E11, E14 | Docs (html, text), graph deals |
| 2 | E2 Calibrated Claims | 4 | 5 | 20 | M | builds the calibration library (F3); verifier for E1, E5, E7 | Docs answer |
| 3 | E3 Alt-Data Pulse | 4 | 4 | 16 | M | builds F1 and F2; feeds E4, E8, E10 | F1, F2 |
| 4 | E5 Call Desk | 4 | 4 | 16 | M | feeds F3 (guidance), E8 | Docs audio, E2 |
| 5 | E6 LBO Stress Lab | 4 | 4 | 16 | M | reuses Scenarios; feeds E11 | Scenarios, E1 (exit multiples; optional) |
| 6 | E4 Deal Radar | 5 | 3 | 15 | L | first big user of F3; feeds E7, E11 | F3, F4, graph; E3 optional |
| 7 | E7 Thesis Agent | 5 | 3 | 15 | L | builds F5; uses everything | F3, E1–E5 as tools |
| 8 | E8 Management Track Record | 4 | 3 | 12 | M | | E5, F4 |
| 9 | E10 Patent and Tech Landscape | 3 | 4 | 12 | M | feeds E4 and the GNN | F1, F2 |
| 10 | E13 Voice Analyst | 3 | 4 | 12 | M | reuses F5's tools | F5 |
| 11 | E9 Supply-Chain Atlas | 4 | 2.5 | 10 | L | | F1, graph |
| 12 | E11 Buyer Simulator | 4 | 2.5 | 10 | L | | F4, E4, E6 |
| 13 | E12 Regulatory Shock Simulator | 3 | 3 | 9 | M | | F1, F3 |
| 14 | E14 Deal Aftermath | 3 | 3 | 9 | M | | F4 |

### 5.2 The set for this round: seven features, in this order

The builder implements **F1–F3, then E2, E1, E3, E4, E5, E6 and E7**. E13 (Voice) is a stretch goal if time
remains, because it is mostly UI over E7's tool registry. The order puts the foundations and the cheapest
calibrated feature first. Every later step then reuses something already built:

```
F1 crosswalk ─┐
F2 series ────┼──► E3 Pulse ──────────────┐
F3 ledger + calib ─► E2 Claims ─┐         │
                                ├─► E1 Precedents (F4) ─► E4 Deal Radar ─┐
                                │                    └─► E6 Stress Lab   ├─► E7 Thesis Agent (F5) ─► (E13 Voice)
                                └─► E5 Call Desk (guidance → F3) ─────────┘
```

**Scope for this round** (what to deliver now; the rest of each spec is next round):

| Step | Deliver now | Leave for later |
|---|---|---|
| 0. Foundations | Migration `0016_edge_next.sql` (`edge_entity_ids`, `edge_series`, `edge_forecasts`, `edge_deals`, `edge_deal_fields`, `edge_agents`, `edge_agent_steps`); `entities/` (SEC, Wikidata and careers-page sources); `series/` (robustZ, BOCPD, placebo); `calib/` (all functions); the resolver in the daily pass; the Track record tab (reliability diagram and Brier skill) | GLEIF parents; the review-queue UI beyond a simple list |
| 1. E2 | Features, `docs.verify` on the ML service, combiner, conformal Strict, dots in Ask and memos, the calibration fixture (≥ 300 claims), `eval-claims.ts`, the report route | Premium cross-check (register the feature id; the build can follow) |
| 2. E1 | Discovery (DEFM14A, SC TO-T, SC 14D9, 8-K 1.01 with EX-2.1, S-4), section location, extraction with checks and calibrated confidence, the backfill job, similar deals, ranges with conformal bands, the Deals view, `PREC` integration, the `deals.precedents` node, `eval-precedents.ts` | Private precedent library; ASC 805 private targets; re-read with the stronger model (register the id) |
| 3. E3 | Greenhouse, Lever and Ashby; Wikipedia; USAspending; WARN for TX, CA and NY; PatentsView counts; titles and tells; change detection; the Pulse panel; the `pulse.signals` node; finding kinds and CRM signal | CrUX, GitHub, SmartRecruiters, more WARN states, the nowcast and `series.forecast` |
| 4. E4 | The 12-month target model (features without E3 if it slips), `odds.train` and `odds.score`, Venn-Abers, the scorecard with baselines, the board for watched companies and movers, the company page, the `deal_odds` card, `ODDS`, the forecasts logged to F3, `eval-odds.ts` | The acquirer model, the 6-month horizon, the premium screener and pairs |
| 5. E5 | Q&A segmentation, the rubric classifier with calibration on the labelled fixture, the call-level posterior, the commitments ledger for revenue, EPS, EBITDA, capex and production guidance with XBRL resolution, the call viewer additions, the Promises tab, `CALL` | Eva-4B GPU (premium), peer comparisons, milestone (non-XBRL) commitments beyond 8-K items |
| 6. E6 | The shared LBO maths refactor, rates driver, operating paths, exit multiples from E1, the breach and max-price outputs, the reverse stress test, the LBO tab, the `scen.lbo` node, `LBO <ticker>` | Refine on the ML service (premium), the backtest validation script if F4's sponsor deals are too few |
| 7. E7 | Runtime and tables, the tool registry over Docs, Graph, E1, E3, E4, E5, E6 and Earth; plan → approve → daily ticks; the evidence verifier gate; the likelihood-ratio ladder; the red team (same provider allowed); the living memo; the Theses view; `thesis_update` cards | Weekly deep pass (premium), team theses, cadence twice daily |

**New ML service tasks this round:**
- `docs.verify` (CPU);
- `odds.train` (CPU);
- `odds.score` (CPU);
- `calls.evasion` (GPU), registered but used only by premium.

Each goes to the staging app first with a smoke test, as now.

**New Inngest functions:**
- `edge/deals.backfill`;
- `edge/pulse.weekly`;
- `edge/agent.tick`.

The forecast resolver runs inside the existing daily pass.

**What must stay true** (preflight):
- `scripts/test-edge.ts` grows with every pure function above.
- The new evaluation scripts run against the test branch and print their metrics into the PR description.
- Background jobs never open the premium scope.
- Every new finding kind has provenance.

### 5.3 Monthly run-rate of the chosen set at beta scale

Assumptions: 200 active beta users, 300 watched companies, and about 2,000 universe companies for Pulse.

| Item | Estimate | Limit it must fit |
|---|---|---|
| AI (small model): E1 extraction (3,000 deals over two months), Pulse titles, Call Desk, Claims, Thesis | $25–60 in the first two months (the backfill), then about $10–20 | The app's AI caps; the E1 backfill is throttled to fit |
| Modal CPU: docs.verify, odds.*, AIS later | About $3–6 | $25 Edge cap within the $30 credit |
| Inngest executions: pulse (about 250 a month), deals backfill (about 1,800), agent ticks (one free thesis each, about 15 a tick) | About 10–30K | 45K guard (`EDGE_INNGEST_MONTHLY`) |
| Postgres: deals and fields (about 40 MB), series (about 50 MB a year), forecasts (under 10 MB) | About 100 MB | Needs the paid Neon plan (open question 1) |
| R2: raw pulls, feature rows, models | Under 1 GB | 9 GB guard |

---

## 6. Premium features proposed (for the pricing work)

These are proposed entries for `src/lib/billing/features/premium.ts`, in its format. The minimum plan here is
a **suggestion**; the pricing work decides. Costs are rough costs to us per use, from the list prices in this
repo (`src/lib/ai/pricing.ts`, `docs/edge-roadmap.md`) and the providers' pages, as of 2026-10-05.

| id | Name | Description | Suggested plan | Metered | Cost per use (USD) | Per use |
|---|---|---|---|---|---|---|
| `edge.deals-reread` | Re-read a deal with the stronger model | One deal's documents re-read by gpt-5.6-sol (or with exact-span citations) | pro | yes | 0.24 | a deal: about 40K tokens in at $4 and 4K out at $20 per million |
| `edge.deals-export` | Precedent exports | Export more than 50 precedents with quotes | pro | no | 0 | a perk |
| `edge.deals-private` | Private precedent library | Your own CIMs and closing memos read into private precedents | team | yes | 0.05 | a document: about 4 sections on the small model plus embeddings |
| `edge.claims-crosscheck` | Second-provider claim check | Each claim judged by a second provider's model, as an extra verification signal | pro | yes | 0.03 | an answer: about 10K tokens in at $2 and 1K out at $10 per million (Claude Sonnet 5.5) |
| `edge.pulse-daily` | Daily Pulse | Daily instead of weekly refresh for up to 50 companies | pro | no | 0 | a perk (free APIs) |
| `edge.pulse-licensed` | Licensed alternative data | Bring-your-own Revelio, Coresignal, Similarweb or Apptopia keys | enterprise | no | 0 | covered by the customer's own licence |
| `edge.odds-screener` | Deal Radar screener | Filter and export the whole universe by sale or acquisition odds | pro | no | 0.001 | a screen: one database query over stored scores |
| `edge.odds-pairs` | Buyer–target odds | Joint odds that a given buyer acquires a given target | pro | no | 0.001 | a pair: stored scores combined |
| `edge.calls-eva` | Evasion ensemble (Eva-4B) | Call Q&A scored by the Eva-4B classifier on a GPU, ensembled with the free rubric | pro | yes | 0.03 | a call: about 90 s of a Modal T4 at $0.59 an hour plus CPU and memory |
| `edge.calls-peers` | Peer call comparison | Evasion and promises compared across up to six peers' latest calls | pro | yes | 0.05 | six calls' summaries on the small model plus the comparison |
| `edge.lbo-refine` | LBO refine | 20,000 paths over 7 years on the ML service | pro | yes | 0.01 | one refine: a few CPU minutes on Modal |
| `edge.thesis-plus` | More theses | Up to 5 active theses, 90-day horizons, twice-daily ticks on filing days | pro | yes | 0.25 | a tick: routing and extraction plus about one document question |
| `edge.thesis-deep` | Weekly deep synthesis | A weekly deep-research pass on the flagship model for each thesis | pro | yes | 2.5 | a pass, as `ai.deep-research` |
| `edge.thesis-team` | Team theses | Theses shared and co-edited by a team | team | no | 0 | a perk |
| `edge.voice-realtime` | Live voice analyst | Real-time spoken conversation with Edge (gpt-realtime-2.1) | pro | yes | 0.1 | a minute, at about $0.06–0.11 a minute |

Later features (not this round) would add:

| id | Name | Suggested plan | Metered | Cost per use (USD) | Per use |
|---|---|---|---|---|---|
| `edge.supply-licensed` | Licensed flows (AIS, bills of lading) | enterprise | no | 0 | bring your own licence |
| `edge.patents-landscape` | Custom patent landscapes | pro | yes | 1.0 | an ML embedding run over a CPC area |
| `edge.auction-refine` | Buyer Simulator refine | pro | yes | 0.01 | 20,000 runs |
| `edge.auction-personas` | Buyer persona memos | pro | yes | 0.1 | a buyer on the stronger model |
| `edge.reg-whatif` | Draft-rule what-if | pro | yes | 0.05 | a pasted draft rule |

Every free feature above stays free, with a free fallback where a premium path exists, as `docs/premium.md`
requires. Background passes (weekly Pulse, Deal Radar scoring, agent ticks of free theses) never open the
premium scope. A premium thesis's ticks re-check the owner's plan by id (`premiumScopeById`) before each paid
step, as background work a person started.

---

## 7. Licences to keep out (additions)

| Thing | Why |
|---|---|
| Cloudflare Radar data | CC BY-NC 4.0: non-commercial. Use CrUX (CC BY 4.0) for web popularity instead. |
| OpenSanctions bulk data and API without a licence | CC BY-NC; business use needs a paid licence. Possible Enterprise add-on, not free. |
| UN Comtrade | "Internal use only", no re-dissemination, even on paid tiers. Use the Census trade API (public domain) for US flows. |
| EvasionBench's dataset | Built from S&P Capital IQ transcripts. Use the Eva-4B weights (Apache-2.0) only, and confirm with counsel. |
| Workday and SuccessFactors career sites | No public API, and their terms forbid automated collection. |
| Hoberg-Phillips TNIC data | Academic data library with no clear commercial licence. Use it only as an offline benchmark, if at all; Edge computes its own 10-K similarity. |
| Bespoke-MiniCheck-7B | Non-commercial. Use MIT or Apache NLI checkers only. |
| KumoRFM | Licensed (free only for prototyping); keep out unless an Enterprise contract pays for it. |
| aisstream.io | Free stream, but commercial terms unconfirmed. Keep it premium and off until checked. |

(The existing list in `docs/edge-roadmap.md` section 5 still applies: TimesFM 3.0 and Moirai weights,
SDV/ctgan, jina, `@cosmograph`, FRED in models, Carbon Mapper without an agreement, and so on.)

---

## 8. Open questions for the owner

1. **Neon paid plan.** The chosen set adds about 100 MB in year one (deals, series, forecasts), beyond Edge's
   self-imposed 180 MB of document text. Is the paid Neon plan from the launch audit in place, or should the
   series store go to R2 with only the latest points in Postgres?
2. **Inngest.** Agent ticks and the weekly Pulse fit the free 50K executions only with one free thesis per
   person. Is a paid Inngest tier acceptable once Thesis Agent usage grows, or should free theses tick every
   other day?
3. **Legal review of Deal Radar and Call Desk wording.** Named-company sale odds and "evasive answer" labels
   are statistical and use only public data, but a review of the copy, disclaimers and the takedown process
   is advisable before launch beyond the beta.
4. **Eva-4B.** Is a model whose training data came from a licensed transcript database acceptable to use
   commercially (the weights are Apache-2.0)? If not, the premium path uses a model fine-tuned on Edge's own
   labelled pairs instead.
5. **Labelling time.** E2 (300 claims), E1 (150 deals' fields) and E5 (300 Q&A pairs) need human spot-checks
   of model-drafted labels: about 6–8 hours of the owner's (or a contractor's) time. Who does it?
6. **Browser agents.** Should a computer-use tool (reading IR sites without feeds, for example for webcast
   links) be planned for the Thesis Agent next round as an Enterprise-only option, given compliance concerns
   about open-web automation?
7. **On-device clean room.** Is there demand from regulated users for embedding and redacting data-room
   documents in the browser before upload? It is technically feasible with Transformers.js, but it would
   change the Documents architecture.
8. **Backfill budget.** The E1 backfill (about $15–30 of small-model tokens) runs at 50 deals a day under the
   current caps, about two months to finish. Raise the Edge AI cap temporarily to finish in a week?
9. **Universe.** Deal Radar is specified for all ~5,000 US-listed companies, while the graph is energy-first.
   Is a launch on all sectors (scores for all, reasons richer in energy) acceptable, or should it launch on
   energy and two more sectors first?

---

## 9. Sources

Checked on 2026-10-05 with web search. arXiv itself could not be fetched from the sandbox, so papers were read
through their abstracts and search summaries. Items marked *(prior knowledge)* in the text should be confirmed
before launch copy.

- **Competitors:**
  - AlphaSense: custom agents and AI-led expert calls (press, 24 March 2026), Channel Checks, the Tegus
    library;
  - Hebbia: spreadsheets and decks in chat (4 May 2026), integrations;
  - Rogo: funding and product coverage;
  - Harmonic against PitchBook (harmonic.ai blog: 35M+ companies, 195M+ people, department headcount, daily
    refresh).
- **Evasion:**
  - EvasionBench, arXiv 2601.09142;
  - Eva-4B model card, huggingface.co/FutureMa/Eva-4B (Apache-2.0; base Qwen3-4B-Instruct-2507; three
    classes);
  - "Lie to me: detecting managerial evasiveness in earnings calls via conversational audio encoders", arXiv
    2609.13893;
  - Larcker and Zakolyukina 2012 *(prior knowledge)*.
- **Verification:**
  - Mohri and Hashimoto, "Language models with conformal factuality guarantees" (ICML 2024);
  - adaptive and coherent conformal factuality (2025–26);
  - "Calibration is not verification", arXiv 2609.25959.
- **Forecasting:**
  - Chronos-2, arXiv 2510.15821 and huggingface.co/amazon/chronos-2 (Apache-2.0, covariates, GIFT-Eval);
  - TimesFM 3.0 and Moirai licences per `docs/edge-roadmap.md`.
- **Graph:** KumoRFM (kumo.ai research pages; RelBench); ULTRA (MIT).
- **Simulation:** InfoBid (arXiv 2503.22726), AuctionArena (arXiv 2310.05746), Horton, "Learning from
  synthetic labs: language models as auction participants".
- **Data and licences:**
  - PatentsView (CC BY 4.0; Q4 2025 update; USPTO Open Data Portal);
  - USAspending API (no key, public domain);
  - GLEIF Level-2 (CC0);
  - Cloudflare Radar (CC BY-NC 4.0);
  - CrUX on BigQuery (popularity buckets; CC BY 4.0 per its documentation);
  - Greenhouse and Lever public job-board APIs (no authentication);
  - NOAA Marine Cadastre AIS (CC0);
  - aisstream.io (free stream, terms to check);
  - OpenSanctions (CC BY-NC, commercial licence);
  - UN Comtrade (internal use only);
  - WARN data aggregators (WARN Feed, WARN Firehose, WARNTracker);
  - regulations.gov v4 API (free key);
  - Federal Register API;
  - Hoberg-Phillips data library (TNIC);
  - PaECTER (arXiv 2402.19411; huggingface.co/mpi-inno-comp/paecter).
- **Voice and on-device:**
  - OpenAI gpt-realtime-2.1 pricing ($32 and $64 per million audio tokens; about $0.06–0.11 a minute);
  - Transformers.js v3 and v4 WebGPU;
  - computer-use API comparisons (2026).
- **Finance research** *(prior knowledge)*:
  - Palepu 1986 (takeover prediction);
  - Cremers, Nair and John 2009;
  - Harford 2005 (merger waves);
  - Bena and Li 2014 (technology overlap and mergers);
  - Hoberg and Phillips 2010 (text-based product similarity and mergers);
  - Bulow and Klemperer 1996;
  - Abadie, Diamond and Hainmueller 2010 (synthetic control);
  - Adams and MacKay 2007 (BOCPD);
  - Vovk and Petej (Venn-Abers predictors);
  - Meucci 2008 (Entropy Pooling, already used in Edge).
