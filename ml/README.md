# YouBank Edge ML service (Modal)

`ml/edge_ml.py` is one Modal app, **`youbank-edge-ml`**, that runs the Edge tab's machine-learning work on CPU:
satellite change confirmation, AlphaEarth embedding change, document parsing and reranking, transcription, M&A link
prediction, synthetic data and topic maps. The Next.js app calls one authenticated HTTP endpoint; each task runs in its
own Modal function with its own image.

The app name comes from `EDGE_ML_APP` (default `youbank-edge-ml`) and also names both web endpoints, so a staging copy
deployed with `EDGE_ML_APP=youbank-edge-ml-staging` gets its own URLs and never touches production's:

| | Production | Staging copy |
|---|---|---|
| Task entry point | `https://bhardwajayan000--youbank-edge-ml.modal.run` | `https://bhardwajayan000--youbank-edge-ml-staging.modal.run` |
| Async status | `https://bhardwajayan000--youbank-edge-ml-status.modal.run` | `https://bhardwajayan000--youbank-edge-ml-staging-status.modal.run` |

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
| audio.transcribe | `ml/transcripts/<sha256[:40]>[-<language>][-<engine>].json` (`-<engine>` only when `engine` is forced) |
| graph.train | `ml/predictions/<version>.json`, `ml/models/gnn-<version>.pt` |
| synth.tabular | `ml/synthetic/tab-<hash>.json` |
| synth.series | `ml/synthetic/ts-<hash>.json` |
| topics.map | `ml/topics/<hash>.json` |

Keys are content-addressed (same input and options, same key); graph versions are UTC timestamps
(`20260930T215443Z`). `geo.refine`, `geo.embed_change` and `docs.rerank` write nothing; their results come back inline.

Results are plain JSON: numpy values are converted inside the task container (before 2026-10-01 a numpy float in
`geo.refine`'s result could not be unpickled by the numpy-free `api`/`status` containers, so that task's sync and
status-poll paths failed; the Inngest event path was unaffected).

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
 "blobs": [{"kind": 2, "x": 33, "y": 235.5, "bbox": [29, 224, 38, 248], "pixels": 204}],
 "legacy": false}
```
Two models look at every changed area. Since 2026-10-01 the pair is **Prithvi-EO-2.0-300M-TL + SAM 2.1 base+**. The
original pair, **Prithvi-EO-1.0-100M + SAM ViT-B**, is the fallback: a new model that fails to load or to run is
replaced by its predecessor for that call (a failed load is remembered for the container's life, so later calls skip
straight to the fallback), and `legacy: true` forces the original pair. The result says which models ran.

* **Imagery** (unchanged): the six HLS bands (Sentinel-2 B02, B03, B04, B8A, B11, B12) are read for the bbox from the
  Planetary Computer STAC item (signed COG hrefs, windowed reads warped to a 224×224 lon/lat grid over the bbox,
  bilinear), the L2A +1000 offset is removed for processing baseline ≥ 04.00, and each model's own means/stds normalise.
  Model loading runs in parallel with these downloads.
* **Prithvi-EO-2.0-300M-TL** (`ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL`, pinned revision, SHA-256 checked,
  Apache-2.0; encoder only, from the repo's own `prithvi_mae.py`, built on the meta device so the 300M weights load
  without a random init first): each date is its own sample of one frame (the model's temporal patch size is 1), with
  the box centre as location metadata (lon, lat). The acquisition date is not passed: the checkpoint's learned weight
  on it is about 1e-6 (location's is 0.058) and adding it changed no z-score on the Orla scene. The last layer's 14×14
  patch tokens of the two dates are compared by cosine distance (layers 12 and 18 were noisier). Per blob:
  overlap-weighted mean patch distance over the blob's bbox, and its z-score against all valid patches (patches with
  ≥ 50 % nodata in either date are left out).
* **SAM 2.1 base+** (`sam2.1_hiera_base_plus.pt` from dl.fbaipublicfiles.com, SHA-256 checked, Apache-2.0; Meta's
  `sam2` code at commit `2b90b9f` installed from GitHub without the CUDA extension, since the PyPI package named `sam2`
  is not Meta's): a positive point at each blob centroid (scaled from the size grid to the PNG), the best of three
  masks by predicted IoU, on both PNGs. Per blob: `areaPx` (after mask, pixels of the PNG grid), `iou` (before vs after
  mask at that point), and the after mask's outline as ≤ 40 points in size-grid coordinates.
* **Fallbacks**, computed exactly as before: Prithvi-EO-1.0-100M (each date one frame repeated 3 times, last-layer
  tokens averaged over time) and Segment Anything ViT-B (`sam_vit_b_01ec64.pth`, MD5 prefix and SHA-256 checked).

Result
```json
{"prithvi": {"model": "Prithvi-EO-2.0-300M-TL", "blobs": [{"distance", "z"}], "grid": 14, "mean", "std", "validPatches",
             "map": [[14×14]], "coords": ["location"]},
 "sam": {"model": "sam2.1_hiera_base_plus", "blobs": [{"areaPx", "iou", "polygon": [[x, y], ...], "score", "areaBeforePx"}],
         "imageSize": [w, h]},
 "scenes": {"before": {"scene", "date", "cloud", "baseline", "offset", "validFraction"}, "after": {...}}, "size": 256,
 "modelVersion": "Prithvi-EO-2.0-300M-TL + sam2.1_hiera_base_plus",
 "timings": {"fetch", "loadWait", "prithvi", "sam", "maxRssMiB"},
 "fallbacks": {"prithvi": "<error>", "sam": "<error>"}}
```
`modelVersion` names the pair that produced the result (`Prithvi-EO-1.0-100M + sam_vit_b_01ec64` when it fell back or
with `legacy`); `src/lib/edge/refine.ts` records it as the finding's provenance `modelVersion`, with a licence line
built from the same names (all four models are Apache-2.0). `fallbacks` appears only when a model fell back, with the
reason. `coords` lists the metadata Prithvi-EO-2.0 received; the fallback result has no `coords`. Blob order is the
input order. A real change shows a high Prithvi `z` and a low SAM `iou`. A point prompt only sees what is under the
centroid: for a blob made of separate pieces (two ponds side by side) the centroid can fall between them and SAM
segments the gap (see the third Orla blob below).

### `geo.embed_change`: AlphaEarth embedding change between two years (sync)
Input `{"bbox": [minx, miny, maxx, maxy], "years": [2024, 2025]}` (a box up to 0.06° a side, about 6 km; `years`
defaults to the last two available, 2024 and 2025 today). Reads Google DeepMind's **AlphaEarth Foundations** annual
satellite embeddings (64 dimensions per 10 m pixel, CC BY 4.0) from the public copy at
`https://data.source.coop/tge-labs/aef/v1/annual/{year}/{utm_zone}/*.tiff`:

* The dataset's file index (302,466 COGs, 2017-2025) is baked into the image at build time without its geometry
  columns; a call picks the files of each year that overlap the box in the UTM zone of the box centre.
* Pixels are read through each COG's `.vrt`, because the COGs are stored bottom-up and the VRTs flip them. Each VRT is
  a warped VRT over `/vsis3/us-west-2.opendata.source.coop/...`, read unsigned and path-style
  (`AWS_NO_SIGN_REQUEST`, `AWS_VIRTUAL_HOSTING=FALSE`; without them GDAL hunts for AWS credentials and hangs). The COGs
  are band-interleaved in 1024 px blocks, so a site is 64 block fetches per year; `GDAL_NUM_THREADS=8` fetches them in
  parallel (one year of a 2.5 km box: 10.5 s sequential, 1.5 s parallel, identical pixels). Both years are read on the
  same 10 m UTM grid (the first year's), in parallel.
* De-quantisation as the dataset specifies, `(v / 127.5)² · sign(v)`; -128 is no data. Change is `1 − cosine`
  between the two years' vectors per pixel.

Result
```json
{"years": [2024, 2025], "bbox": [...], "crs": "EPSG:32613", "shape": [h, w], "pixelMeters": 10, "validFraction": 1.0,
 "stats": {"mean", "median", "p90", "p95", "p99", "max", "above": {"0.1", "0.2", "0.3", "0.5"}},
 "png": "data:image/png;base64,...", "pngScale": {"vmax": 0.5, "ramp": "inferno", "nodata": "transparent"},
 "tiles": {"2024": ["2024/13N/<file>.tiff"], "2025": [...]}, "readSeconds",
 "source": "https://source.coop/tge-labs/aef", "license": "CC-BY-4.0",
 "attribution": "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind."}
```
`above` is the share of valid pixels whose change exceeds each threshold; `png` is the change map, north up, one pixel
per 10 m (boxes over 256 px are scaled down), a 64-step palette from 0 (dark) to 0.5 and above (pale yellow), no data
transparent. Show the `attribution` wherever the map or numbers appear.

**Does it separate real changes from quiet sites?** On four Permian plants (2.5 km boxes), checked against Sentinel-2
images of the same boxes:

| Site | 2024 → 2025: share > 0.3 / p99 | 2017 → 2025: share > 0.3 / p99 | What the imagery shows |
|---|---|---|---|
| Orla (Energy Transfer) | **0.71 %** / 0.25 | **4.6 %** / 0.42 | two new ponds in 2025; plant trains, ponds and roads built since 2017 |
| Arrowhead (Energy Transfer) | 0.00 % / 0.07 | 1.0 % / 0.30 | quiet in 2025; built out since 2017 |
| Benedum (WTG) | 0.00 % / 0.14 | 2.1 % / 0.43 | quiet in 2025; some new pads since 2017 |
| Goldsmith (DCP) | 0.00 % / 0.09 | 0.01 % / 0.19 | quiet |

Year over year, Orla's map lights up exactly at the two new ponds and stays dark elsewhere; the quiet sites have no
pixel above 0.3. Over eight years every site drifts (median change about 0.08-0.14 even at Goldsmith), so use the tail
(`above`, `p99`) rather than the mean, and compare like with like (same gap in years). The annual embeddings stop at
2025 (an annual composite, so a change late in a year shows only partly); `geo.refine`'s Sentinel-2 check covers
recent months.

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

### `docs.rerank`: cross-encoder relevance of passages to a query (sync)
Input `{"query": "...", "passages": [{"id": "p1", "text": "..."}, ...], "maxLength"?: 512}` (up to 256 passages; a
passage can also be a bare string, its id then being its index; ids can be any JSON scalar and come back as given).
Model: **`cross-encoder/ettin-reranker-32m-v1`** (Apache-2.0, ModernBERT encoder, 32M parameters, pinned revision),
baked into its own small image. The encoder runs as the repo's fp32 ONNX export in ONNX Runtime; the CrossEncoder head
(CLS pooling, Dense 384→384 with GELU, LayerNorm, Dense 384→1) runs in numpy from the repo's sentence-transformers
module weights. On 100 real passages its scores matched sentence-transformers' `CrossEncoder.predict` to 4 decimals.
The repo's int8 export was not used: its scores drifted (Spearman 0.80 against the reference) and it was barely faster
on Modal's CPUs. Query and passage are encoded as one pair (`[CLS] query [SEP] passage [SEP]`), truncated longest-first
to `maxLength` tokens, batched 16 at a time by length.

Result `{"scores": [{"id", "score"}, ...], "model": "cross-encoder/ettin-reranker-32m-v1", "maxLength": 512,
"truncated": <passages cut at maxLength>}`, **sorted by score, highest first**. Scores are raw logits (higher = more
relevant; not probabilities, not comparable across queries).

### `audio.transcribe`
Input `{"key" | "parts", "mime", "language": "auto" | "en" | ..., "engine"?: "auto" | "parakeet" | "whisper"}`. ffmpeg
converts to 16 kHz mono WAV, then:

* **English goes to Parakeet TDT 0.6B v2** (`nvidia/parakeet-tdt-0.6b-v2`, CC-BY-4.0, run as the int8 ONNX export
  `istupakov/parakeet-tdt-0.6b-v2-onnx` through `onnx-asr`, so no NeMo install; pinned revisions, weights in the image).
  With `language: "auto"` (what the app sends), Whisper first guesses the language from the speech in the first four
  minutes (`detect_language`, VAD on, 3 windows); English with probability ≥ 0.5 goes to Parakeet. Silero VAD cuts the
  audio into pieces (pauses under 1.5 s merged, pieces up to 30 s; the model ends every piece with a full stop, so
  shorter pieces chopped sentences and cost accuracy), Parakeet transcribes them with token timestamps, and the tokens
  are regrouped into words and sentence-sized segments (a segment ends at `.`, `?` or `!` not after a common
  abbreviation, at a pause of 1.5 s or more, or past 30 s).
* **Other languages, `engine: "whisper"`, and any Parakeet failure go to faster-whisper `small`** exactly as before
  (int8, CPU, 4 threads, VAD filter, beam 5, its own language detection). A failure is noted in `fallback`.

Both models load in background threads while the audio downloads and converts. Writes `{"language",
"languageProbability", "duration", "segments": [{"start", "end", "text", "words"?: [{"w", "s", "e"}]}], "model",
"engine": "parakeet" | "whisper", "sha256", "detected"?: {"language", "probability"}, "fallback"?}` (`words` only from
Parakeet; word ends are the next word's start, capped at 0.8 s, since the model gives token start times only); returns
`{"key", "language", "duration", "segments": <count>, "model", "engine", "fallback"?}`. Audio over 2 h is refused so a
job stays inside the 3600 s timeout.

Accuracy and speed, measured on Modal (4 cores) with the production VAD settings and 4 ONNX threads (production now
uses 8, about 20 % faster); WER after lower-casing and stripping punctuation, references as given (Earnings-22
references keep "uh"s and repeated words that neither model writes):

| Test set | Parakeet TDT 0.6B v2 | faster-whisper small |
|---|---|---|
| LibriSpeech validation-clean sample (73 utterances, 8 min) | **3.1 %** WER, 11× real time | 7.2 % WER, 4× real time |
| Earnings-22 (first 60 chunks of one shard, 6 min of earnings calls) | **19.7 %** WER, 11× real time | 21.3 % WER, 4× real time |
| JFK inaugural address 1961 (14 min, one file) | 9× real time, punctuated sentences | 11× real time |

Parakeet runs about 10-11× real time here, not the ~30× quoted for desktop CPUs; one thread per hyperthread (8 on 4
cores) was 20 % faster than 4. On the old, noisy 1961 broadcast Parakeet with short VAD pieces made errors Whisper did
not ("victory of Potty"); the 1.5 s / 30 s pieces fixed those.

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
| geo_refine | 2 | 7 GiB | 600 s | 2 | 0.150 |
| geo_embed_change | 1 | 2 GiB | 300 s | 2 | 0.063 |
| docs_parse | 2 | 4 GiB | 900 s | 3 | 0.126 |
| docs_rerank | 4 | 2 GiB | 120 s | 3 | 0.205 |
| audio_transcribe | 4 | 8 GiB | 3600 s | 2 | 0.253 |
| graph_train | 2 | 4 GiB | 1800 s | 1 | 0.126 |
| synth_tabular, synth_series | 2 | 4 GiB | 1800 s | 1 each | 0.126 |
| topics_map | 2 | 4 GiB | 600 s | 1 | 0.126 |

Threads: Modal's `cpu=N` is N physical cores, 2N hyperthreads, while every container sees the host's 18-20 CPUs, so
thread pools are set explicitly. `geo_refine`, `docs_rerank` and Parakeet use one thread per hyperthread (4, 8, 8),
which measured 20-35 % faster than one per core at the same price; the other functions keep one per core. geo_refine's
memory covers the worst case of all four geo models loaded at once (a fallback in a warm container peaked at 6.4 GB;
the new pair alone uses about 3.4 GB).

## Measured (production smoke run 20261001T002939, after the model upgrade)

Cold = first call after the deploy (container start and model load included); warm = the next call. Latency is what
the caller waited; `seconds`/`costUsd` are the task's own numbers. "Before" rows are the previous models on the same
inputs (today's baseline run against the old deployment, or the 20260930T172302 run where today's could not be read).

| Task (test input) | Cold latency | Warm latency | costUsd cold / warm |
|---|---|---|---|
| health | 4.4 s | 0.15 s | $0.000004 / $0.0000004 |
| geo.refine (Orla, 3 blobs; Prithvi-EO-2.0 + SAM 2.1) | 30.6 s | 12.9 s | $0.00113 / $0.00053 |
| geo.refine, `legacy: true` in the same warm container (loads the old pair) | | 15.9 s | $0.00066 |
| geo.refine before (Prithvi-EO-1.0 + SAM ViT-B) | 37.4 s task time today; 41.3 s latency on 09-30 | 24.6 s | $0.00131 / $0.00086 |
| geo.embed_change (Orla 2.5 km box, 2024 → 2025) | 7.8 s | 1.8 s | $0.000075 / $0.000029 |
| docs.parse (1-page PDF + table) | 8.0 s | 1.0 s | $0.00017 / $0.00003 |
| docs.parse, other 10 formats (warm) | | ≤ 2.0 s each | ≤ $0.00007 |
| docs.rerank (100 passages × ~400 tokens) | 9.0 s | 4.5 s (3.6 s on staging) | $0.00032 / $0.00024 |
| audio.transcribe (11 s clip, 2 parts; Parakeet) | 14.3 s | 3.1 s | $0.00080 / $0.00020 |
| audio.transcribe, French clip (to Whisper) / `engine: "whisper"` | | 8.9 s / 6.6 s | $0.00062 / $0.00045 |
| audio.transcribe before (Whisper only) | 8.7 s | 3.0 s | $0.00042 / $0.00020 |
| graph.train (730 nodes, 600 deals) | 49.2 s | 40.2 s | $0.00162 / $0.00141 |
| synth.tabular (1200 rows, 300 epochs, n 500) | 62.4 s | 52.5 s | $0.00209 / $0.00184 |
| synth.series (800 days × 3, 1500 steps, 64 paths) | 67.6 s | 58.0 s | $0.00226 / $0.00203 |
| topics.map (360 × 32 vectors) | 22.9 s | 1.3 s | $0.00067 / $0.00004 |
| async topics.map via HTTP | spawn 0.2 s, done after 2.6 s (2 polls), Inngest 200 | | $0.00004 |

An isolated call also pays for container start-up and the 60 s idle before scale-down (see Cost above): about
$0.0026 more for geo_refine, $0.0011 for geo_embed_change, $0.0036 for docs_rerank and $0.0044 for audio_transcribe.
Short clips got slower to transcribe (language detection plus loading two models); on many short English clips
Parakeet ran 11× real time against Whisper's 4×, and on one 14-minute file the two were about level (9-11×).

Orla (Energy Transfer), 2.5 km box, S2B 2025-09-26 → S2B 2026-09-11 (tile 13SFR, cloud < 0.01 %), both geo.refine
pairs on the same imagery:

| Blob | Prithvi-EO-2.0 distance / z | SAM 2.1 areaPx / IoU | Prithvi-EO-1.0 distance / z | SAM ViT-B areaPx / IoU |
|---|---|---|---|---|
| new pond (kind 2, x 33, y 235.5) | 0.281 / **6.17** | 993 / **0.014** | 0.183 / **6.50** | 906 / **0.004** |
| control, unchanged ground (x 220, y 200) | 0.006 / **−0.27** | 16 292 / **0.972** | 0.002 / **−0.28** | 222 774 / **0.837** |
| both new ponds as one blob (centroid on the berm) | 0.314 / 6.93 | 4 778 / 0.056 | 0.190 / 6.74 | 238 / 0.001 (segments the berm) |

Prithvi-EO-2.0 separates the pond as clearly as 1.0 and its map is quieter elsewhere (largest z away from the ponds
1.6, against 2.2). SAM 2.1 outlines a local patch at the control point (16 thousand px, IoU 0.97) where SAM ViT-B took
almost the whole image (IoU 0.84), so the app's per-area score for the unchanged control drops from 0.14 to 0.07
(`judge` in `src/lib/edge/refine.ts`) while the pond stays at 0.99.

Synthetic M&A graph (300 companies, 160 people, 30 funds, 40 advisors, 200 subsidiaries, 600 deals, split 2023-07-01,
161 test deals = 322 rankings); the oracle knows the generating probabilities:

| | hits@5 | hits@10 | MRR |
|---|---|---|---|
| GNN | 0.217 | 0.264 | 0.133 |
| features-only baseline | 0.044 | 0.093 | 0.051 |
| oracle (ceiling) | 0.332 | 0.419 | 0.238 |

(Identical in two repeated runs on 2026-10-01; the 0.295 hits@10 recorded on 2026-09-30 came from a run before the
last deploys of that day. graph.train's code and image did not change with the model upgrade.)

## Images and models

One `debian_slim` Python 3.11 image per family; torch `2.13.0+cpu` from the PyTorch CPU index; all pins in `PINS`.
Weights are baked in at build time (no downloads on cold start), each at a pinned revision or checksum:

| Task | Model | Source | Licence |
|---|---|---|---|
| geo.refine | Prithvi-EO-2.0-300M-TL | `ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL@63adbd39c271` (SHA-256 checked) | Apache-2.0 |
| geo.refine | SAM 2.1 Hiera base+ | `dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt` (SHA-256 checked); code `facebookresearch/sam2@2b90b9f` | Apache-2.0 |
| geo.refine (fallback) | Prithvi-EO-1.0-100M | `ibm-nasa-geospatial/Prithvi-EO-1.0-100M@f3a9ea7a1723` | Apache-2.0 |
| geo.refine (fallback) | Segment Anything ViT-B | `sam_vit_b_01ec64.pth` (MD5 prefix and SHA-256 checked) | Apache-2.0 |
| geo.embed_change | AlphaEarth annual embeddings (data, read at call time; index baked in) | `source.coop/tge-labs/aef` v1 | CC-BY-4.0 |
| docs.rerank | Ettin reranker 32M (fp32 ONNX) | `cross-encoder/ettin-reranker-32m-v1@b33e5ceb5110` | Apache-2.0 |
| audio.transcribe | Parakeet TDT 0.6B v2 (int8 ONNX) | `istupakov/parakeet-tdt-0.6b-v2-onnx@0bbb45a33658`, from `nvidia/parakeet-tdt-0.6b-v2` | CC-BY-4.0 |
| audio.transcribe | Silero VAD | `istupakov/silero-vad-onnx@b3e3ee3cce4c` | MIT |
| audio.transcribe (other languages, fallback) | faster-whisper small (int8) | `Systran/faster-whisper-small@536b0662742c` | MIT |

New model layers sit on top of the existing image layers, so the fallback models' layers stayed cached. The topics
image runs UMAP once at build with `NUMBA_CPU_NAME=generic`, so numba's cache is reusable on any host. Parakeet's
CC-BY-4.0 asks for attribution of NVIDIA's model where transcripts are presented as its output.

## Deploy, secrets, tests

```bash
cd ml
EDGE_ML_APP=youbank-edge-ml-staging .venv/bin/modal deploy edge_ml.py   # 1. a staging copy, its own URLs
.venv/bin/modal run smoke.py --target youbank-edge-ml-staging           # 2. smoke it (--only task,task to narrow)
.venv/bin/modal deploy edge_ml.py                                       # 3. production; URLs stay the same
.venv/bin/modal run smoke.py                                            # 4. smoke production
.venv/bin/modal app stop youbank-edge-ml-staging --yes                  # 5. stop the staging copy
.venv/bin/modal app logs youbank-edge-ml                                # recent logs (-f to follow)
.venv/bin/modal app history youbank-edge-ml                             # versions; `modal app rollback youbank-edge-ml vN`
```
The staging copy shares the `youbank-edge` secret (same R2 bucket, same Inngest key), so its async smoke event reaches
production Inngest with correlation `smoke:<run>`; nothing in the app reacts to it (every `waitForEvent` matches on its
own `callId`).

The Modal secret `youbank-edge` holds exactly `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`INNGEST_EVENT_KEY` and `EDGE_ML_SECRET`. To rotate, write those six lines to a private temp file, run
`ml/.venv/bin/modal secret create youbank-edge --from-dotenv <file> --force` (the venv has `python-dotenv` for this),
and delete the file. New containers pick up the change.

`smoke.py` builds its fixtures inside Modal: a text PDF with a table, a scanned PDF uploaded in two parts, a PNG,
DOCX, PPTX, XLSX, CSV, EML, a sample MSG, HTML, French text, the public-domain JFK clip in two parts, French speech from
espeak-ng, the synthetic M&A graph with its oracle, a synthetic table, GARCH-like returns and clustered vectors. It
uploads them to `ml/test/<run>/` and calls every deployed function twice, plus extra calls: geo.refine with
`legacy: true` (the fallback pair), audio.transcribe on the French clip (must go to Whisper) and with
`engine: "whisper"`, geo.embed_change on a quiet site (Goldsmith), and docs.rerank on 100 generated ~400-token
passages where one answers the query. It then checks HTTP: 401 without a token and with a wrong one, 400 for an
unknown task and a bad callId, health sync, and one async task polled through `status` with its `edge/ml.done` post
answered 200. Finally it deletes every object it wrote. The async event carries `correlation: "smoke:<run>"`, so an
Inngest handler should ignore unknown correlations. `--only`, `--no-http`, `--keep`, `--report-path` and `--target` (another
app name, default `$EDGE_ML_APP` or `youbank-edge-ml`) adjust a run.
