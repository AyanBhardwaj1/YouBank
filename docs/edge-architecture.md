# Edge: architecture and operations

How Edge is put together and how to run it. What it does for users is in `docs/edge-spec.md`.

## What runs where

| Part | Where | What it holds or does |
|---|---|---|
| Pages and API | The Next.js app on Vercel (Hobby, functions in `cle1`) | `/app/edge`, `/story/[slug]`, the Terminal, Newsroom, Studio and CRM hooks; `/api/edge/*` |
| Database | Neon Postgres with PostGIS and pgvector | the `edge_*` tables below; signals in `crm_signals`; alerts in `news_notifications` |
| Files | Cloudflare R2, through `aws4fetch` (`src/lib/edge/infra/r2.ts`) | uploads (in 4 MB parts), transcripts, parsed documents, graph exports and models, factor history, large scenario results, exports |
| Background jobs | Inngest (`src/lib/edge/functions.ts`, served at `/api/inngest`) | canvas runs, monitors, the digest, document reading, the graph, scenario refinement |
| ML service | Modal app `youbank-edge-ml` (`ml/edge_ml.py`), scales to zero | `geo.refine`, `docs.parse`, `audio.transcribe`, `graph.train`, `synth.tabular`, `synth.series`, `topics.map`, `health` |
| Public data | fetched on demand, cached | EIA maps and prices, Sentinel-2 via Microsoft Planetary Computer, SEC EDGAR, Kenneth French's library, the Treasury curve, Nasdaq (FMP as backup) |
| Language models | the app's OpenAI/Anthropic setup, under the AI spend caps | answers, memos, card text, intro drafts |

## Code map (`src/lib/edge/`)

| Area | Files |
|---|---|
| Access and the beta | `access.ts` (`requireEdge`, prefs, limits), `onboard.ts` (first canvas) |
| Earth | `assets.ts`, `detect.ts`, `change.ts`, `refine.ts`, `proforma.ts`, `dealwatch.ts`, `sources/` |
| Watches, feed, alerts | `watches.ts`, `feed.ts`, `notify.ts`, `alerts.ts`, `digest.ts`, `crm.ts`, `provenance.ts` |
| Documents | `docs/` (ingest, chunking, answers, change radar, topics, filing watch) |
| Networks | `graph/` (parse, ingest, store, algorithms, deals, training, findings, jobs) |
| Scenarios | `scen/` (stats, models, data, drivers, market, company, tables, practice, store, run) |
| Canvas | `canvas/` (catalog, engine, values, executors per module, outputs, story, studio) |
| Across the app | `overview.ts` (Terminal EDGE), `links.ts`, `push.ts` (Studio and Office), `intros.ts` (CRM), `story.ts` |
| Platform | `infra/` (R2, jobs, ML client, usage meters), `functions.ts`, `runtime.ts` |

## Tables

- **Earth and the feed.**
  - `edge_assets`: pipelines, plants and counties, PostGIS.
  - `edge_detections`: every finding, any module.
  - `edge_provenance`: the audit trail per subject.
  - `edge_watches`.
  - `edge_alerts`: `immediate`, `digest` and `digested` per person and subject, so nobody hears twice.
- **Documents.**
  - `edge_files`: R2 objects.
  - `edge_docs`.
  - `edge_chunks`: halfvec(512) embeddings.
  - `edge_answers`.
- **Networks.**
  - `edge_nodes` and `edge_links`, with as-of dates and source URLs.
  - `edge_models`: deal model versions and metrics.
  - `edge_predictions`.
- **Scenarios.** `edge_scenarios`: the spec, a preview, and an R2 key for large results.
- **Canvas.**
  - `edge_canvases`, `edge_canvas_events`.
  - `edge_runs`, `edge_run_steps`.
  - `edge_monitors`.
  - `edge_stories`.
- **Across the app and metering.**
  - `edge_pushes`: Studio pushes, `pending`, `accepted`, `dismissed` or `superseded`.
  - `edge_usage`: free-tier meters.

Migrations are `drizzle/0013_edge.sql` and `drizzle/0014_edge_platform.sql`. They are applied by hand:
first on a Neon branch, then on production with the owner's approval.

## Background work

| What | Trigger | Notes |
|---|---|---|
| Daily pass | Vercel cron `/api/cron/edge`, 07:30 UTC | Checks watches, scans deals and filings, notifies watchers, runs the graph's daily slice. Sends digests itself only when Inngest is not configured. |
| Canvas runs | `edge/canvas.run` | One step per block, retried; monitors re-run deployed canvases hourly (`20 * * * *`). |
| Digest | `35 * * * *` | Each person at their morning brief's hour, in their time zone. |
| Ground check | `edge/detection.created` | `geo.refine` on Modal (Prithvi, Segment Anything) raises or lowers confidence. |
| Document reading | `edge/doc.uploaded` | `docs.parse` or `audio.transcribe`, then embedding. |
| Graph | weekly `0 4 * * 0`, `edge/graph.refresh`, `edge/graph.ingest`, `edge/graph.train` | Training runs `graph.train` on Modal. New cards notify watchers. |
| Scenario refinement | `edge/scenario.refine` | 10,000 paths, or `synth.series`. |

Long ML calls are asynchronous:
1. The job starts the call and waits for `edge/ml.done` with the call id (`step.waitForEvent`).
2. Modal posts that event to Inngest when the call finishes.

Without Inngest keys, work that can runs inline after the response.

## Free-tier guards

`src/lib/edge/infra/usage.ts` meters every call. It stops before these limits, each overridable by an
environment variable:

| Meter | Default stop | Variable |
|---|---|---|
| Modal compute | $25 a month (free credit $30) | `EDGE_MODAL_MONTHLY_USD` |
| Inngest executions | 45,000 a month (free 50,000) | `EDGE_INNGEST_MONTHLY` |
| R2 storage | 9 GB (free 10 GB) | `EDGE_R2_MAX_GB` |
| R2 operations | 0.9M class A, 9M class B a month | |
| Document text in Postgres | 180 MB | `EDGE_DOCS_DB_MB` |

At a limit, runs queue or fall back:
- ground checks keep the pixel method;
- large results stay as previews;
- uploads are refused with the reason.

## Configuration (names only)

- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- **Inngest:** `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`; `INNGEST_DEV` for local work.
- **ML service:** `EDGE_ML_URL`, `EDGE_ML_STATUS_URL`, `EDGE_ML_SECRET`. The Modal secret
  `youbank-edge` holds the R2 keys, `R2_BUCKET`, `INNGEST_EVENT_KEY` and `EDGE_ML_SECRET`, so the
  service reads and writes R2 and posts `edge/ml.done` itself.
- **Links in emails:** `YOUBANK_URL`, or Vercel's production URL.

Values live in `.env.local` (not committed), the Vercel project's environment, and the Modal secret.

## Operations

- **Checks:** `bash scripts/preflight.sh`. It runs typecheck, lint, every test suite (Edge: 200+
  checks in `scripts/test-edge.ts`) and the build.
- **Deploy the app:** merge to `main`, then `vercel --prod --yes`.
- **After any change to `functions.ts`:** re-sync Inngest with
  `curl -X PUT https://youbank-nu.vercel.app/api/inngest`.
- **Deploy the ML service:** `cd ml && ../ml/.venv/bin/modal deploy edge_ml.py`. Then check
  `EDGE_ML_STATUS_URL` for the task list and versions.
- **Rebuild the graph or retrain the deal model:** admins use Networks (POST
  `/api/edge/graph/refresh` or `/train`). Both run on Inngest.
- **Roll back:** promote the previous deployment in Vercel. The Edge migrations are additive.
