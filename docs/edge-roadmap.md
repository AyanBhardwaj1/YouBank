# Edge roadmap: what shipped free, what comes next, and the paid upgrades

Prices and licences were checked on 30 September 2026 against providers' pricing pages, model cards and
licence files. Every paid upgrade below costs nothing until its setting is added in Vercel; the code
falls back to the free method without it. Administrators see the same list, live, in
**Settings → Labs → Edge upgrades**, with which settings are present (names only, never values).
The registry behind that list is `src/lib/edge/premium.ts`.

## 1. Shipped in this round (all free)

The full list is in `docs/edge-spec.md` under "What the October upgrade round adds". In short:

| Module | New | Measured |
|---|---|---|
| Feed | Light ranking with full rows only for the page; the first page and state sent with the page; kind chips; the fortnight brief; card-shaped skeletons, Try again, keyboard tabs, the view in the address, a phone layout, lazy views | Feed request 0.42 s warm (49 KB for 12 cards); the audit export no longer stops at 40 findings |
| Earth | Flaring at every plant (NASA FIRMS VIIRS, Sentinel-2 shortwave infrared, New Mexico's reported volumes); radar change (Sentinel-1); drilling permits (New Mexico dated, Texas counted); sites in 3D (NAIP and lidar); month-by-month imagery | On the test branch: 4 flaring plants, 15 radar changes, 2 permit jumps; assets 671 → 544 KB and 2 s → 0.16 s cached |
| Documents | Any-term keyword search; table-aware passages of about 500 tokens from filing HTML; headers; wider context; a second reading for unverified quotes; a reranker step (free on the ML service, Voyage or Cohere when keyed); a retrieval eval | Fused recall@5 0.85 → 0.97 and MRR 0.76 → 0.79 on the eval's three-filing set; library list 0.34–0.40 s → 0.06–0.13 s |
| Networks | Influence, communities and bridging people; ownership rings of any length; who ultimately owns a company; a section 8 interlock screen; fair baselines with intervals; shared caches | Company view 0.70–0.80 s → 0.13–0.19 s cached; overview 100–127 KB → 6–11 KB; plant pairs 17 queries → 1 |
| Scenarios | GJR-GARCH-t with filtered historical simulation as the default; realism v2 with bootstrap bands and a copy check; narrative → views → Entropy Pooling; sequential-tree tables with privacy checks | Realism v2 across 11 real datasets: 98.6 (new default) against 97.5 (old GARCH) and 86.6 (bootstrap, caught copying) |
| Canvas | Drag without rebuilding every block; light run polling; selection and Delete; a dialog for compare; a phone bottom sheet; a loading skeleton | |
| ML service | Prithvi-EO-2.0 and SAM 2.1 for satellite checks; Parakeet for English speech; a free cross-encoder reranker; AlphaEarth change maps (not wired in yet) | geo.refine warm 24.6 → 12.9 s; Parakeet word errors 3.1% against Whisper's 7.2%; reranker 4.5 s warm for 100 passages; about $0.30 of Modal credit for the whole upgrade |
| Platform | gpt-6-luna for Edge's small steps (half the price); the upgrades registry and its Settings panel | |

## 2. Paid upgrades that are ready: set the key and redeploy

| Upgrade | Module | What gets better | Cost | Turn on |
|---|---|---|---|---|
| Voyage rerank-3 | Documents | A cross-encoder reranks about 100 fused candidates before the model picks the passages it quotes. Published finance tests show reranking as the largest single retrieval gain (FinanceBench hybrid F1 37.6 → 44.1 with headers plus a reranker). | $0.05 per million tokens (rerank-3-lite $0.02). The first 200M tokens are free. Without a card on file the limit is 3 requests a minute, and opting out of training needs a card. At 1,000 questions a month (about 100 passages of 400 tokens each) that is about 40M tokens: inside the free allowance. | `VOYAGE_API_KEY` |
| Cohere Rerank 4 | Documents | The same step with Cohere, used only when Voyage is not set. | $2.00–2.50 per 1,000 searches. Trial keys may not be used in production. | `COHERE_API_KEY` |
| A larger answer model | Documents | Harder multi-period questions answered by a stronger model (for example `gpt-5.6-sol`). | On the existing OpenAI key: gpt-5.6-sol is $4 in / $20 out per million tokens, about 10–20× the default per answer. The daily AI spend caps still apply. | `EDGE_ANSWER_MODEL=gpt-5.6-sol` |
| Planet imagery | Earth | Site panels list PlanetScope (3 m, daily) and SkySat (50 cm) scenes with thumbnails, to check a Sentinel-2 change at a finer scale. | Search and thumbnails come with any Planet account. Buying scenes: PlanetScope about $2.25/km² (250 km² minimum), SkySat archive $6/km² (25 km² minimum), new SkySat captures $12–40/km². | `PLANET_API_KEY` |
| FIRMS archive | Earth | Each plant's flaring record is filled back 12 weeks once, so the first flaring cards already say whether a flare is new or chronic. | Free (a NASA FIRMS MAP_KEY, email only). | `FIRMS_MAP_KEY` |
| Carbon Mapper methane | Earth | Methane plumes from Tanager and EMIT near watched plants, with kg/h and uncertainty (about 1,100 Permian plumes since 2025). | Reading is free, but the licence is non-commercial: YouBank needs a commercial agreement (price on request). | `CARBON_MAPPER_LICENSED=1` (exactly 1; nothing is read from Carbon Mapper otherwise) |
| A larger ML budget | Platform | More satellite checks, parsing and training a month before Edge falls back to built-in methods. | Modal CPU $0.047 per core-hour beyond the $30 monthly credit. | `EDGE_MODAL_MONTHLY_USD` (default 25) |
| More document storage | Platform | Room for many more uploaded documents. | Neon paid plan, billed by use (neon.com/pricing). Neon's free plan stops at 512 MB a branch; Edge stops itself at 180 MB of document text. | Upgrade Neon, then `EDGE_DOCS_DB_MB` |

## 3. Paid upgrades that are planned (code not yet written)

| Upgrade | Module | What gets better | Cost | What it takes |
|---|---|---|---|---|
| Speaker-labelled transcripts (OpenAI `gpt-4o-transcribe-diarize`) | Documents | Who said what on earnings calls, so tone and quotes read by speaker. Today: Whisper small, no speakers. | $0.006 a minute (an hour-long call about $0.36) on the existing OpenAI key. | Split audio into 25 MB pieces, map diarized segments to turns; `EDGE_TRANSCRIBE=openai`. About 1 day. |
| LlamaParse for hard PDFs | Documents | Scanned and table-heavy data-room PDFs read with layout and tables intact. | 10,000 credits a month free, then $1.25 per 1,000 credits. | Route PDFs the built-in parser flags as hard; `LLAMA_CLOUD_API_KEY`. About 1 day. |
| Mistral OCR 4.1 | Documents | The same, for scans. | $4 per 1,000 pages. | `MISTRAL_API_KEY`. Half a day once LlamaParse's path exists. |
| Anthropic Citations | Documents | Quotes returned as exact spans of the source by the model itself. | Haiku 4.5 $1 / $5; Sonnet 5.5 $2 / $10 per million tokens; quoted text is not billed as output. Cannot be combined with structured output. | An answer path through the Messages API; `ANTHROPIC_API_KEY`, `EDGE_CITATIONS=anthropic`. 2–3 days. |
| voyage-context-4 or voyage-4 embeddings | Documents | Contextual embeddings without an LLM call per passage; +3–8 nDCG expected on finance retrieval (FinMTEB: 3-small 0.664, voyage-3-large 0.746). | $0.02–0.12 per million tokens, 200M free. | Re-embed every passage (dimensions change: a migration). Test after the reranker. |
| Modal GPU for documents and speech | Documents | Qwen3-Reranker-4B (MTEB-R 69.8 vs 61.8), PaddleOCR-VL 1.6 (OmniDocBench 96.3), pyannote speaker labels. | T4 $0.59/h, L4 $0.80/h; a short T4 run per document or call. | GPU variants of the ML tasks; `EDGE_ML_GPU=1`. pyannote also needs a free Hugging Face token (`HF_TOKEN`) after accepting its terms. |
| EOG Nightfire volumes | Earth | Flared gas volume per flare, not just radiant heat. | Signed licence; commercial users pay a negotiated yearly fee. | Read the nightly files and attach volumes to flaring cards. |
| Umbra or ICEYE radar spotlight | Earth | 25 cm–1 m radar that can read floating-roof tank fill. | Umbra $675 (1 m) to $3,250 (25 cm) per 5×5 km image. | Per-order adapter; only for named sites. |
| Pléiades Neo | Earth | 30 cm optical archive. | About $22.50/km² archive, 5 km² minimum. | Order adapter. |
| GHGSat, Kayrros, Kpler, Vortexa, Spire AIS | Earth | Facility methane, flows and ships. | Enterprise quotes only. | Contracts first. |
| TimesFM 3.0 via BigQuery | Scenarios | Forecasts from the top-ranked time-series model (its open weights are non-commercial). | BigQuery rates. | A BigQuery adapter beside the free Chronos-2 path. |
| Prior Labs TabPFN 2.5+ | Scenarios | Stronger small-table models. | Prior Labs Pro / Max / on-prem; prices not published. | Only if the free TabICLv2 path falls short. |
| NVIDIA Kumo Relational | Networks | A relational foundation model for link prediction. | Free only for prototyping; production NVIDIA AI Enterprise about $4,500 per GPU a year. A September 2026 forum thread reports it missing from NVIDIA's catalog. | Not recommended now. |
| Vercel Pro and a Neon paid plan | Platform | Commercial use, higher function limits, and the 512 MB storage ceiling gone (see `docs/launch-readiness.md`). | Vercel Pro $20 a seat a month; Neon by use. | Account changes only. |

## 4. Free improvements for the next round

Ranked by value for effort from the research (sources in section 6).

**Documents**
1. A BM25 index with `lakebase_bm25` (Neon's text-search extension; `pg_search` is deprecated) over passages plus title, ticker, form, period and section. Needs a migration, so it waits for your OK.
2. Grow the retrieval eval from 30 to 100–150 questions, and run an embedding A/B while the corpus is still empty.
3. Speaker labels (pyannote community-1 on a short GPU run, or the OpenAI path in section 3) on top of Parakeet's transcripts.
(Done this round: the ettin cross-encoder reranker and Parakeet, both on the ML service.)

**Earth**
1. Wire the ML service's new `geo.embed_change` (AlphaEarth annual embeddings, CC BY 4.0) into ground-change cards as a second opinion, then a basin-wide new-pad finder from it, checked against OpenStreetMap (72,369 tanks, 43,137 wells in the Permian box) and Texas RRC records.
2. OWLv2 (Apache-2.0) to propose tanks on 0.6 m NAIP for the 3D site models (Prithvi-EO-2.0 and SAM 2.1 shipped this round).
3. Our own methane finder on EMIT enhancement scenes (NASA, no use restrictions, free Earthdata login), labelled experimental.
4. OGIM v3.0 (EDF, CC BY 4.0, 7.6M oil and gas records) as the site and pipeline base map beside EIA's.

**Networks**
1. Deal ranker v2: pair features (Adamic-Adar per link type, typed paths, personalised PageRank, time-decayed past links, acquisitiveness, sale signals, 10-K text similarity, basin overlap, size ratio) in LightGBM LambdaRank or TabICLv2 (BSD-3, CPU), with TreeSHAP over path types for reasons, blended with today's model. About a week.
2. ULTRA (MIT, 168k parameters, CPU) as an extra ensemble member that explains with paths.
3. A WebGL whole-graph view with sigma 3 and graphology (MIT, +43 KiB gzipped), ForceAtlas2 positions precomputed nightly; Louvain communities in 47 ms at 3.8k nodes.

**Scenarios**
1. Narrative → factor views → conditional fill of the unmentioned factors → Entropy Pooling over the simulated paths, severity anchored to historical analogs (LLM scenarios run mild: CVaR ×1.1–1.35 against ×4.45 in 2008).
2. GJR-GARCH and a t-copula or filtered historical simulation, and a realism score scored against block-bootstrap bands.
3. Synthetic tables: a sequential-CART generator (synthpop-style) as the default, ForestFlow (MIT) for fidelity, MOSTLY AI TabularARGN (Apache-2.0) for differential privacy; retire the GAN. Privacy checks: DCR share, NNDR, exact matches, membership-inference AUC.
4. Chronos-2-small or TiRex-2 (Apache-2.0) forecasts for the drivers (oil, gas, rates) as quantiles, turned into joint paths through the copula. Not for daily returns, where these models do poorly.

## 5. Licences to keep out

| Thing | Why |
|---|---|
| SDV, ctgan, copulas, deepecho, rdt | BSL-1.1 forbids offering a "Synthetic Data Service", which Scenarios is. |
| TabPFN 2.5 / 3 / 3.5 weights | Non-commercial (only v2 allows commercial use, with credit, up to 10k rows). |
| TimesFM 3.0 weights, Moirai 2.0 | Non-commercial. |
| `@cosmograph/*` | CC BY-NC. Use `@cosmos.gl/graph` (MIT) if a GPU graph view is ever needed. |
| jina v4/v5 embeddings and rerankers, ctxl rerankers, NVIDIA nemotron embeddings | Non-commercial. |
| ColQwen2.5 | Its base model is non-commercial; visual retrieval also costs about 257 KB of vectors a page. |
| Carbon Mapper, UNEP IMEO MARS, FracTracker data | Non-commercial without an agreement. |
| Marker 2.0 weights | Free only under $5M of funding or revenue. |
| Gemini's free tier | Prompts may be read by reviewers and used to improve Google products: public filings and news only, never uploads. |
| Mistral's free plan | Trains on your data unless you opt out. |

## 6. Sources

Research notes from this round are summarised above; the main sources:
- Retrieval: Anthropic, "Contextual Retrieval"; FinanceBench (arXiv 2311.11944); arXiv 2402.05131 (chunking on financial reports); Databricks long-context RAG study; ViDoRe V3; neon.com/docs/extensions/lakebase-text.
- Models and prices: huggingface.co (ettin-reranker, Qwen3-Reranker, Chronos-2, TiRex-2, TimesFM 3.0, Prithvi-EO-2.0, SAM 2.1, OWLv2), docs.voyageai.com/docs/pricing, cohere.com/pricing, developers.openai.com/api/docs/pricing, platform.claude.com/docs/en/about-claude/pricing, modal.com/pricing, planet.com pricing pages.
- Earth data: firms.modaps.eosdis.nasa.gov, gis.emnrd.nm.gov (C-115B), api.carbonmapper.org (terms of 13 January 2026), planetarycomputer.microsoft.com (sentinel-1-rtc, naip, 3dep), source.coop (AlphaEarth).
- Networks: MASS (PLoS One 2026), EdgeReMIND (arXiv 2609.17916), TGB-Seq (ICLR 2025), ULTRA (github.com/DeepGraphLearning/ULTRA), FTC 2026 interlocking-directorate thresholds.
- Scenarios: Ericson et al. 2024 (arXiv 2401.10370), Soleimani 2025 (arXiv 2512.07867), Meucci 2008 (Entropy Pooling), skfolio.

## 7. Round log

- **2026-10-01, upgrade round.** Research across the four modules (geospatial data and models,
  document AI and retrieval, graph models and analytics, time series and synthetic data, model APIs and
  free tiers), then the free improvements above, built by module, reviewed and deployed together.
  Paid upgrades were built behind their keys and left off. Open follow-ups:
  - Texas permit dates (none in the public map service; Edge's own record starts 2026-10-01).
  - Radar thresholds were calibrated on 82 Permian plants in dry September; the wet season is untested.
  - Scenarios' constant conditional correlation under-reproduces correlations rising in a crisis (DCC
    is the next step).
  - Existing documents keep their old passages until re-read.
  - Duplicate graph entities for some holders (for example two BlackRock nodes) split their stakes.
