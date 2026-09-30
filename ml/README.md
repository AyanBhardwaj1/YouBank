# YouBank Edge ML service (Modal)

`ml/edge_ml.py` is one Modal app, **`youbank-edge-ml`**, that runs the Edge tab's machine-learning work on CPU:
satellite change confirmation, document parsing, transcription, M&A link prediction, synthetic data and topic maps.
The Next.js app calls one authenticated HTTP endpoint; each task runs in its own Modal function with its own image.

| | URL |
|---|---|
| Task entry point | `https://bhardwajayan000--youbank-edge-ml.modal.run` |
| Async status | `https://bhardwajayan000--youbank-edge-ml-status.modal.run` |

Both are `POST` with a JSON body and require `Authorization: Bearer <EDGE_ML_SECRET>` (constant-time compare,
`401` otherwise). Modal's own proxy auth is off; the bearer check is the only gate.

## Calling it

```json
{"task": "docs.parse", "input": {"key": "uploads/abc.pdf", "mime": "application/pdf", "name": "abc.pdf"},
 "async": false, "correlation": "doc:123"}
```

* **Sync** (`async: false`): `{"ok": true, "task", "result": {...}, "seconds", "costUsd"}` or
  `{"ok": false, "task", "error", "seconds", "costUsd"}`, HTTP 200 either way. Bad requests are `400` (unknown task,
  non-JSON body, `input` not an object); infrastructure failures (a crashed or killed function) are `500`.
  Modal answers a request still running after 150 s with a `303` redirect to a URL that keeps waiting (fetch follows
  it). Use async for anything that can take long.
* **Async** (`async: true`): returns at once with `{"ok": true, "callId": "fc-..."}`. When the task finishes,
  success or failure, the task function posts one event to `https://inn.gs/e/<INNGEST_EVENT_KEY>`:

  ```json
  [{"name": "edge/ml.done", "id": "edge-ml-done-<callId>",
    "data": {"callId", "task", "correlation", "ok", "result", "error", "seconds", "costUsd"}}]
  ```
  `id` lets Inngest drop duplicates. `result` is the same object the sync call returns. If a task is about to hit
  its Modal timeout, a watchdog sends the event with `ok: false, error: "timed out after Ns"` 15 s before the kill.
  An out-of-memory kill sends nothing, so poll `status` as a fallback for jobs you have not heard back about.
* **Status** `POST {"callId": "fc-..."}` returns `{"done": false}` while running, or
  `{"done": true, "ok", "result", "error", "task", "seconds", "costUsd"}`. A call that crashed reports
  `done: true, ok: false` with the error; Modal keeps results for a limited time (`error: "result expired"` after).
  A malformed id is `400`.

**Cost**: every task reports `seconds` (its own wall time inside the container) and
`costUsd = seconds × (cores × 0.0000131 + GiB × 0.00000222)` at Modal list prices (constants at the top of
`edge_ml.py`; they equal `modal billing rates`: $0.0473/core-h, $0.008/GiB-h). Modal also bills the container's
start-up and its idle time before scale-down (60 s), which `costUsd` leaves out: an isolated call really costs about
`costUsd + (start-up + 60 s) × rate`, e.g. ≈ $0.003 more for a 2-core/4 GiB task.

## R2

Inputs are keys in `R2_BUCKET`. A file can be one key (`"key"`) or several keys (`"parts"`) concatenated in order
(uploads arrive in 4 MB pieces); `graphKey`, `dataKey` and `vectorsKey` also accept a list of keys, or `parts`.
Every output is written under `ml/`:

| Task | Output |
|---|---|
| docs.parse | `ml/parsed/<sha256[:40]>[-ocr-force\|-ocr-off].json` |
| audio.transcribe | `ml/transcripts/<sha256[:40]>[-<language>].json` |
| graph.train | `ml/predictions/<version>.json`, `ml/models/gnn-<version>.pt` |
| synth.tabular | `ml/synthetic/tab-<hash>.json` |
| synth.series | `ml/synthetic/ts-<hash>.json` |
| topics.map | `ml/topics/<hash>.json` |

Keys are content-addressed (same input and options, same key); graph versions are UTC timestamps
(`20260930T215443Z`).

## Tasks

### `health`
Input `{}`. Result `{"app", "versions": {python, modal, <every pinned library>}, "tasks", "models", "resources",
"checks": {"secrets", "r2"}}`. Library versions are the exact pins the images are built from.

### `geo.refine`: confirm satellite changes with geospatial foundation models
Input
```json
{"bbox": [minx, miny, maxx, maxy], "size": 256,
 "before": {"scene": "<Sentinel-2 L2A item id>", "url": "<512px true-colour PNG url>"},
 "after":  {"scene": "...", "url": "..."},
 "blobs": [{"kind": 2, "x": 33, "y": 235.5, "bbox": [29, 224, 38, 248], "pixels": 204}]}
```
* **Prithvi** (`ibm-nasa-geospatial/Prithvi-EO-1.0-100M`, Apache-2.0; encoder only, loaded with the repo's own
  `prithvi_mae.py`): the six HLS bands (Sentinel-2 B02, B03, B04, B8A, B11, B12) are read for the bbox from the Planetary
  Computer STAC item (signed COG hrefs, windowed reads warped to a 224×224 lon/lat grid over the bbox, bilinear), the
  L2A +1000 offset is removed for processing baseline ≥ 04.00, then the model's means/stds normalise. Each date is
  one frame repeated 3 times; the last encoder layer's 14×14 patch tokens are averaged over time and compared by cosine
  distance. Per blob: overlap-weighted mean patch distance over the blob's bbox, and its z-score against all valid
  patches (patches with ≥ 50 % nodata in either date are left out).
* **Segment Anything** (ViT-B `sam_vit_b_01ec64.pth`, Apache-2.0): a positive point at each blob centroid (scaled from
  the size grid to the PNG), best of SAM's three masks by predicted IoU, on both PNGs. Per blob: `areaPx` (after mask,
  pixels of the PNG grid), `iou` (before vs after mask at that point), and the after mask's outline as ≤ 40 points in
  size-grid coordinates.

Result
```json
{"prithvi": {"model": "Prithvi-EO-1.0-100M", "blobs": [{"distance", "z"}], "grid": 14, "mean", "std", "validPatches", "map": [[14×14]]},
 "sam": {"model": "sam_vit_b_01ec64", "blobs": [{"areaPx", "iou", "polygon": [[x, y], ...], "score", "areaBeforePx"}], "imageSize": [w, h]},
 "scenes": {"before": {"scene", "date", "cloud", "baseline", "offset", "validFraction"}, "after": {...}}, "size": 256}
```
Blob order is the input order. A real change shows a high Prithvi `z` and a low SAM `iou`. A point prompt only sees
what is under the centroid: for a blob made of separate pieces (two ponds side by side) the centroid can fall between
them and SAM segments the gap (see the third Orla blob below).

### `docs.parse`: any document to pages of text and tables
Input `{"key" | "parts", "mime", "name", "ocr": "auto" | "force" | "off", "ocrLang"?: "eng" | "eng+fra" ...}`.
The type is sniffed from content, then mime, then name.

* PDF: text layer and ruled tables with pdfplumber; pages with under 25 characters of text (every page with
  `ocr: "force"`) are rendered at 200 dpi with pypdfium2 and OCR'd with Tesseract, two pages in parallel, with word boxes.
* Images (PNG/JPEG/TIFF incl. multi-page/GIF/WebP/BMP): OCR with word boxes.
* DOCX: paragraphs and tables in order, split into pages at hard and rendered page breaks.
* PPTX: one page per slide (text in reading order, tables, speaker notes in `text` and `notes`).
* XLSX: one page per sheet, rows as a table. CSV/TSV: one table.
* EML: headers, body (HTML converted to text and tables), attachment names. MSG (extract-msg): the same.
* HTML: text and `<table>`s. Anything else is decoded as text (form feeds split pages).

Language: `langdetect`, seeded, on the first 20k characters (`und` when there is too little text). OCR languages
installed: eng, fra, deu, spa. NUL characters are stripped (Outlook pads fields with them; Postgres rejects them).
Writes `{"pages": [{"n", "text", "tables": [[[cell]]], "words"?: [{"t", "x0", "y0", "x1", "y1"}], "width"?, "height"?,
"ocr"?, "notes"?, "sheet"?}], "meta": {"pages", "lang", "ocrPages", "title", "kind", "name", "mime", "sha256",
"bytes", "truncated", "attachments"?}}`. Word boxes are in PDF points from the top-left for PDF pages
(`width`/`height` = page size in points) and in pixels for images. Returns
`{"key", "pages", "chars", "lang", "ocrPages", "kind", "title"}`. Caps: 400k table cells; OCR stops about 150 s
before the 900 s timeout and marks the remaining pages `ocrSkipped` with `meta.truncated: true`.

### `audio.transcribe`
Input `{"key" | "parts", "mime", "language": "auto" | "en" | ...}`. ffmpeg converts to 16 kHz mono WAV;
faster-whisper `small` (int8, CPU, 4 threads, weights in the image, VAD filter, beam 5) transcribes. Writes
`{"language", "languageProbability", "duration", "segments": [{"start", "end", "text"}], "model", "sha256"}`;
returns `{"key", "language", "duration", "segments": <count>}`. Audio over 2 h is refused so a job stays inside
the 3600 s timeout; long files were not benchmarked (the 11 s test clip takes about 3–5 s warm, mostly fixed overhead).

### `graph.train`: M&A link prediction
Input `{"graphKey", "splitDate": "YYYY-MM-DD", "topK": 20, "epochs"?: 40, "seed"?: 0}`, where the JSON at `graphKey`
is `{"nodes": [{"id", "kind", "features"}], "edges": [{"s", "d", "kind", "t"}], "deals": [{"acquirer", "target", "t"}]}`.
Only dated deals between `company` nodes are used (`info.droppedDeals` counts the rest).

**Model** (PyTorch Geometric, CPU): relational GraphSAGE, 2 layers × 64, one mean-aggregating `SAGEConv` per edge kind
and direction plus the deal relation, node-kind embedding, and per-relation log-degree inputs (how many past deals,
board seats... a node has). Score for acquirer a → target b = ⟨P·h_a, Q·h_b⟩ (rank 16) + role biases + learned weights
on log common neighbours per kind of shared node (shared fund, director, advisor...) and a direct-link flag.

**Training without leakage**: every example is "the graph as it stood at cut c → deals after c". Deals before the
end date are split into up to 10 time windows (after a 30 % warm-up of history); each window's snapshot holds only
edges dated before the window starts (undated edges count as always known) and only earlier deals, and the window's
deals are the positives, with 5 corrupted targets and 5 corrupted acquirers each. So a deal's consequences (an
ownership edge dated at the deal, later board seats) never sit in the graph the model learns that deal from. Adam
lr 0.01, weight decay 3e-3, dropout 0.3, 40 passes over the windows by default (`epochs` overrides; chosen on the
synthetic graph, where results were flat from about 20 to 40 epochs and validation-based stopping was noisier).

**Backtest**: train on the windows before `splitDate`, then from the `splitDate` snapshot rank every deal on/after it
twice: the real target among all companies for the real acquirer, and the real acquirer among all companies for the
real target (filtered: other true deals are not counted as misses). **Baseline**: logistic regression on
`[f_a, f_b, f_a·f_b, |f_a−f_b|]` of standardised features, same pre-split deals and negatives. Then the model is
retrained on all windows and top-K acquirers and targets are written for every company (pairs that already did a
deal are skipped).

Returns
```json
{"version", "modelKey", "predictionsKey",
 "metrics": {"gnn": {"hits5", "hits10", "mrr", "n", "asTarget": {...}, "asAcquirer": {...}}, "baseline": {...}},
 "info": {"splitDate", "nodes", "companies", "edges", "edgeKinds", "deals", "trainDeals", "testDeals", "droppedDeals", "windows", "epochs", "epochsRun", "trainSeconds"}}
```
`n` counts rankings (2 per test deal). The predictions file is
`{"version", "topK", "splitDate", "acquirers": {"<nodeId>": [[candidateId, score], ...]}, "targets": {...}, "metrics"}`;
`acquirers[x]` are likely buyers of x, `targets[x]` likely targets for x. Scores are sigmoid outputs of a model
trained with negative sampling: a ranking, not a calibrated probability. Each training run stops at 400 s.

### `synth.tabular`: CTGAN-style synthetic tables (own implementation, no sdv/ctgan)
Input `{"dataKey": <JSON array of row objects, or {"rows": [...]}>, "columns": [{"name", "type": "num" | "cat"}],
"n", "seed", "epochs"}` (epochs default 300). Mode-specific normalisation of numeric columns with a Dirichlet-process
`BayesianGaussianMixture` (≤ 10 modes), one-hot categoricals (any JSON value), conditional generator with
training-by-sampling (log-frequency), residual generator 256-256, PacGAN (pac 10) WGAN-GP critic 256-256, Adam 2e-4,
Gumbel-softmax τ 0.2. Batch 500, smaller for small tables so every epoch makes ≥ 8 updates. Numeric nulls get a
missing-indicator column; integers stay integers; values are clipped to the observed range. Writes
`{"columns", "rows", "n", "seed", "recipe", "quality"}`; `quality` compares real and synthetic per column (numeric:
mean, std, median, p90 and the Kolmogorov–Smirnov statistic `ks`; categorical: total variation). Returns
`{"key", "n", "epochs", "seed", "epochsRun"}`.

### `synth.series`: diffusion (DDPM) synthetic return windows
Input `{"dataKey": {"columns", "rows": [[value per column] per day]}, "window": 60, "n", "seed", "steps"
(training iterations, default 2000), "diffusionSteps"?: 200, "kind"?: "returns" | "prices", "calibrate"?: true}`.
Columns are standardised and every overlapping window is a training example. The denoiser is a 1-D dilated residual
conv net (32 channels, dilations 1-2-4-8-16, sinusoidal time embedding), with ε-prediction, a cosine schedule, AdamW
with cosine decay, EMA 0.995, and ancestral sampling with x₀ clipping. `kind: "prices"` trains on log returns.
**Calibration** (on by default): on short histories the denoiser partly memorises the few independent windows and
blends them, which shrinks sample variance (≈ 0.55× on the smoke data; on 20k rows of i.i.d. data the samples match
without it). The generated paths are rescaled per column to the training mean and standard deviation; the factors are
in `recipe.calibrationScale`. Writes `{"columns", "paths": [[[value per column] per day] per path], "seed", "recipe",
"stats"}` (stats: real vs synthetic mean, std, excess kurtosis, lag-1 autocorrelation of returns and of absolute
returns, correlation matrix); returns `{"key", "n", "window", "steps", "seed"}`.

### `topics.map`
Input `{"vectorsKey": {"ids", "vectors"}, "k"?: int, "seed"?: 42}`. Vectors are L2-normalised; an exact cosine kNN
(scikit-learn, N ≤ 20k; pynndescent above) feeds UMAP (15 neighbours, min_dist 0.1) to 2-D; KMeans runs on the 2-D map,
k by best silhouette over 4..12 unless given. Clusters are renumbered largest first; coordinates are scaled into
[0, 1] keeping the aspect ratio. Writes `{"points": [{"id", "x", "y", "cluster"}], "clusters": [{"id", "size", "x",
"y"}], "k", "silhouette", "method"}`; returns `{"key", "k", "points", "silhouette"}`.

## Resources

CPU only, no GPUs, no warm pools (`min_containers` unset), containers stop 60 s after their last input.

| Function | CPU | Memory | Timeout | Max containers | $/hour while running |
|---|---|---|---|---|---|
| api / status / health | 0.25 | 0.5 GiB | 3900 / 60 / 60 s | 2 / 1 / 1 | 0.016 |
| geo_refine | 2 | 4 GiB | 600 s | 2 | 0.126 |
| docs_parse | 2 | 4 GiB | 900 s | 3 | 0.126 |
| audio_transcribe | 4 | 8 GiB | 3600 s | 2 | 0.253 |
| graph_train | 2 | 4 GiB | 1800 s | 1 | 0.126 |
| synth_tabular, synth_series | 2 | 4 GiB | 1800 s | 1 each | 0.126 |
| topics_map | 2 | 4 GiB | 600 s | 1 | 0.126 |

## Measured (smoke run 20260930T172302)

Cold = first call after the containers had scaled down (includes container start and model load); warm = the next
call. Latency is what the caller waited; `seconds`/`costUsd` are the task's own numbers.

| Task (test input) | Cold latency | Warm latency | costUsd cold / warm |
|---|---|---|---|
| health | 4.6 s (via HTTP 4.2 s) | 0.4 s (HTTP 0.3 s) | $0.000004 / $0.000001 |
| geo.refine (Orla, 3 blobs) | 41.3 s | 24.6 s | $0.00134 / $0.00086 |
| docs.parse (1-page PDF + table) | 5.1 s | 0.5 s | $0.00008 / $0.00002 |
| docs.parse, other 10 formats (warm) | | 0.5–2.4 s each (OCR'd scan 2.4 s) | ≤ $0.00008 |
| audio.transcribe (11 s clip, 2 parts) | 11.5 s | 5.1 s | $0.00061 / $0.00034 |
| graph.train (730 nodes, 600 deals) | 43.5 s | 32.5 s | $0.00140 / $0.00113 |
| synth.tabular (1200 rows, 300 epochs, n 500) | 61.3 s | 51.1 s | $0.00206 / $0.00179 |
| synth.series (800 days × 3, 1500 steps, 64 paths) | 73.7 s | 67.3 s | $0.00248 / $0.00236 |
| topics.map (360 × 32 vectors) | 23.2 s | 1.2 s | $0.00070 / $0.00004 |
| async topics.map via HTTP | spawn 0.3 s, done after 28 s (10 polls), Inngest 200 | | $0.00077 |

Orla (Energy Transfer), 2.5 km box, S2B 2025-09-26 → S2B 2026-09-11 (tile 13SFR, cloud < 0.01 %):

| Blob | Prithvi distance / z | SAM areaPx / IoU |
|---|---|---|
| new pond (kind 2, x 33, y 235.5) | 0.183 / **6.50** | 906 / **0.004** |
| control, unchanged ground (x 220, y 200) | 0.002 / **−0.28** | 222 778 / **0.837** |
| both new ponds as one blob (centroid on the berm) | 0.190 / 6.74 | 238 / 0.001 (segments the berm) |

Synthetic M&A graph (300 companies, 160 people, 30 funds, 40 advisors, 200 subsidiaries, 600 deals, split 2023-07-01,
161 test deals = 322 rankings); the oracle knows the generating probabilities:

| | hits@5 | hits@10 | MRR |
|---|---|---|---|
| GNN | 0.211 | 0.295 | 0.136 |
| features-only baseline | 0.044 | 0.093 | 0.051 |
| oracle (ceiling) | 0.332 | 0.419 | 0.238 |

## Images and models

One `debian_slim` Python 3.11 image per family; torch `2.13.0+cpu` from the PyTorch CPU index; all pins in `PINS`.
Weights are baked in at build time (no downloads on cold start): Prithvi-EO-1.0-100M (pinned HF revision), SAM ViT-B
(MD5 prefix and SHA-256 checked), faster-whisper small (`Systran/faster-whisper-small`, pinned revision, MIT). The
topics image runs UMAP once at build with `NUMBA_CPU_NAME=generic`, so numba's cache is reusable on any host.

## Deploy, secrets, tests

```bash
ml/.venv/bin/modal deploy ml/edge_ml.py      # build (cached) and deploy; URLs stay the same
ml/.venv/bin/modal run ml/smoke.py           # every task cold then warm, HTTP + Inngest checks, R2 cleanup
ml/.venv/bin/modal app logs youbank-edge-ml  # recent logs (-f to follow)
```

The Modal secret `youbank-edge` holds exactly `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`INNGEST_EVENT_KEY` and `EDGE_ML_SECRET`. To rotate, write those six lines to a private temp file, run
`ml/.venv/bin/modal secret create youbank-edge --from-dotenv <file> --force` (the venv has `python-dotenv` for this),
and delete the file. New containers pick up the change.

`smoke.py` builds its fixtures inside Modal: a text PDF with a table, a scanned PDF uploaded in two parts, a PNG,
DOCX, PPTX, XLSX, CSV, EML, a sample MSG, HTML, French text, the public-domain JFK clip in two parts, the synthetic M&A
graph with its oracle, a synthetic table, GARCH-like returns and clustered vectors. It uploads them to `ml/test/<run>/`
and calls every deployed function twice. It then checks HTTP: 401 without a token and with a wrong one, 400 for an
unknown task and a bad callId, health sync, and one async task polled through `status` with its `edge/ml.done` post
answered 200. Finally it deletes every object it wrote. The async event carries `correlation: "smoke:<run>"`, so an
Inngest handler should ignore unknown correlations. `--only`, `--no-http`, `--keep` and `--report-path` adjust a run.
