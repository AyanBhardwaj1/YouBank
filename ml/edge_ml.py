"""
YouBank Edge ML service: Modal app ``youbank-edge-ml``.

One authenticated HTTP entry point (``api``) dispatches to one Modal function per task,
plus a ``status`` endpoint for async calls. Tasks:

    health, geo.refine, geo.embed_change, docs.parse, docs.rerank, audio.transcribe,
    graph.train, synth.tabular, synth.series, topics.map

CPU only. Every task reports wall seconds and an estimated cost at Modal list prices.
Large outputs go to Cloudflare R2 under ``ml/``; results carry the R2 key.

Deploy:   cd ml && .venv/bin/modal deploy edge_ml.py
Staging:  cd ml && EDGE_ML_APP=youbank-edge-ml-staging .venv/bin/modal deploy edge_ml.py
          (the app name also names the two web endpoints, so a staging copy never touches production's URLs)
API and task contracts: ml/README.md
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import math
import os
import re
import threading
import time
import traceback
import urllib.error
import urllib.request

import modal

try:  # FastAPI exists only in the API image; the string annotations below resolve there.
    from fastapi import Request
    from fastapi.responses import JSONResponse
except ImportError:  # task images and the machine running `modal deploy`
    Request = JSONResponse = None  # type: ignore[assignment,misc]

APP_NAME = os.environ.get("EDGE_ML_APP", "").strip() or "youbank-edge-ml"
if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", APP_NAME):
    raise ValueError(f"EDGE_ML_APP must be a short lowercase Modal app name, not {APP_NAME!r}")
# Containers import this module again; passing the name keeps `health` and the endpoint labels consistent there.
APP_ENV = {"EDGE_ML_APP": APP_NAME}
app = modal.App(APP_NAME)
SECRET = modal.Secret.from_name("youbank-edge")
SECRET_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "INNGEST_EVENT_KEY", "EDGE_ML_SECRET")

# ---------------------------------------------------------------------------------------------
# Cost estimate. Modal list prices (USD), CPU containers:
#   CPU     $0.0000131  per physical core-second
#   Memory  $0.00000222 per GiB-second
# costUsd = seconds * (cores * CPU_USD_PER_CORE_SECOND + GiB * MEM_USD_PER_GIB_SECOND)
# `seconds` is the task's own wall time inside its container (container boot is not included).
# ---------------------------------------------------------------------------------------------
CPU_USD_PER_CORE_SECOND = 0.0000131
MEM_USD_PER_GIB_SECOND = 0.00000222
# GPU tasks: Modal's GPU and its list price per second (T4 $0.59 an hour), added to the CPU and memory above.
GPU_TASKS: dict[str, tuple[str, float]] = {"graph.train.gpu": ("T4", 0.59 / 3600)}

# task name -> (Modal function name, CPU cores, memory MiB, timeout seconds, max containers)
TASKS: dict[str, tuple[str, float, int, int, int]] = {
    "health": ("health", 0.25, 512, 60, 1),
    "geo.refine": ("geo_refine", 2.0, 7168, 600, 2),  # all four models loaded (a fallback in a warm container): 6.4 GB
    "geo.embed_change": ("geo_embed_change", 1.0, 2048, 300, 2),
    "docs.parse": ("docs_parse", 2.0, 4096, 900, 3),
    "docs.rerank": ("docs_rerank", 4.0, 2048, 120, 3),
    "audio.transcribe": ("audio_transcribe", 4.0, 8192, 3600, 2),
    "graph.train": ("graph_train", 2.0, 4096, 1800, 1),
    # The same training on a GPU, wider and longer, only when a person asks for it (premium: edge.graph-gpu).
    "graph.train.gpu": ("graph_train_gpu", 2.0, 8192, 1800, 1),
    "synth.tabular": ("synth_tabular", 2.0, 4096, 1800, 1),
    "synth.series": ("synth_series", 2.0, 4096, 1800, 1),
    "topics.map": ("topics_map", 2.0, 4096, 600, 1),
}
SCALEDOWN_SECONDS = 60
INNGEST_URL = "https://inn.gs/e/"
DONE_EVENT = "edge/ml.done"

# ---------------------------------------------------------------------------------------------
# Images: one per task family, debian_slim + Python 3.11, torch from the CPU wheel index.
# Versions are pinned so `health` can report exactly what is deployed.
# ---------------------------------------------------------------------------------------------
PY = "3.11"
TORCH_INDEX = "https://download.pytorch.org/whl/cpu"
PYPI_INDEX = "https://pypi.org/simple"
PINS = {
    "fastapi": "0.141.1",
    "boto3": "1.43.100",
    "torch": "2.13.0+cpu",
    "torchvision": "0.28.0+cpu",
    "timm": "1.0.29",
    "einops": "0.8.2",
    "rasterio": "1.4.4",
    "planetary-computer": "1.0.0",
    "segment-anything": "1.0",
    "opencv-python-headless": "4.13.0.92",
    "huggingface-hub": "1.33.0",
    "pillow": "12.3.0",
    "pdfplumber": "0.11.10",
    "pypdfium2": "5.13.0",
    "pytesseract": "0.3.13",
    "python-docx": "1.2.0",
    "python-pptx": "1.0.2",
    "openpyxl": "3.1.5",
    "extract-msg": "0.56.1",
    "langdetect": "1.0.9",
    "beautifulsoup4": "4.15.0",
    "lxml": "6.1.3",
    "faster-whisper": "1.2.1",
    "torch-geometric": "2.8.0.post1",
    "scikit-learn": "1.9.1",
    "umap-learn": "0.5.12",
    # added with Prithvi-EO-2.0, SAM 2.1, Parakeet and the reranker
    "setuptools": "84.0.0",
    "wheel": "0.48.0",
    "hydra-core": "1.3.7",
    "iopath": "0.1.10",
    "onnx-asr": "0.12.0",
    "onnxruntime": "1.30.0",
    "tokenizers": "0.23.2",
    "safetensors": "0.8.0",
    "pyarrow": "25.0.1",
}
MODELS = {
    # geo.refine: the current pair, then the fallbacks for the pair below
    "prithvi2": {"repo": "ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL", "revision": "63adbd39c271da4c42f447e69b1a7c91a338cdc9",
                 "file": "Prithvi_EO_V2_300M_TL.pt", "license": "Apache-2.0",
                 "sha256": "3629cedfbb350faafcb0dac902ae0d3c927e25ce8d9e0024aa1276ec66956ddb"},
    "sam2": {"url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
             "file": "sam2.1_hiera_base_plus.pt", "config": "configs/sam2.1/sam2.1_hiera_b+.yaml", "license": "Apache-2.0",
             "sha256": "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5",
             # Meta's code at a pinned commit (the PyPI package named `sam2` is not Meta's)
             "code": "https://github.com/facebookresearch/sam2/archive/2b90b9f5ceec907a1c18123530e92e794ad901a4.tar.gz"},
    "prithvi": {"repo": "ibm-nasa-geospatial/Prithvi-EO-1.0-100M", "revision": "f3a9ea7a1723621b0aeceb4de993093704d712c5",
                "file": "Prithvi_EO_V1_100M.pt", "license": "Apache-2.0"},
    "sam": {"url": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth", "file": "sam_vit_b_01ec64.pth",
            "sha256": "ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912", "license": "Apache-2.0"},
    # audio.transcribe: Parakeet for English, Whisper for other languages and as the fallback
    "parakeet": {"repo": "istupakov/parakeet-tdt-0.6b-v2-onnx", "revision": "0bbb45a3365852604aef28b538a8f066f4ccaa85",
                 "origin": "nvidia/parakeet-tdt-0.6b-v2", "quantization": "int8", "license": "CC-BY-4.0"},
    "silero": {"repo": "istupakov/silero-vad-onnx", "revision": "b3e3ee3cce4c11ceb63b1a0b229d916069c1ddf6", "license": "MIT"},
    "whisper": {"repo": "Systran/faster-whisper-small", "revision": "536b0662742c02347bc0e980a01041f333bce120",
                "compute": "int8", "license": "MIT"},
    # docs.rerank
    "reranker": {"repo": "cross-encoder/ettin-reranker-32m-v1", "revision": "b33e5ceb5110773ea9cf5e00c9bedc83a8c2afdd",
                 "license": "Apache-2.0"},
}
PRITHVI2_DIR = "/models/prithvi2"
SAM2_CKPT = "/models/sam2/sam2.1_hiera_base_plus.pt"
PRITHVI_DIR = "/models/prithvi"
SAM_CKPT = "/models/sam/sam_vit_b_01ec64.pth"
PARAKEET_DIR = "/models/parakeet-tdt-0.6b-v2"
SILERO_DIR = "/models/silero-vad"
WHISPER_DIR = "/models/whisper-small"
RERANK_DIR = "/models/ettin-reranker-32m"


def _pin(*names: str) -> list[str]:
    return [f"{n}=={PINS[n]}" for n in names]


def _threads(n: float) -> dict[str, str]:
    k = str(max(1, int(n)))
    return {"OMP_NUM_THREADS": k, "MKL_NUM_THREADS": k, "OPENBLAS_NUM_THREADS": k,
            "NUMEXPR_NUM_THREADS": k, "NUMBA_NUM_THREADS": k, "TOKENIZERS_PARALLELISM": "false"}


def _hw_threads(cores: float) -> int:
    """Threads for a function reserving `cores`: Modal's cpu=N is N physical cores, 2N hyperthreads, and ONNX Runtime
    ran clearly faster with one thread per hyperthread (reranker, 100 passages at cpu=4: 6.8 s with 4, 4.4 s with 8)."""
    n = max(1, int(round(cores * 2)))
    try:
        n = min(n, len(os.sched_getaffinity(0)))
    except Exception:
        pass
    return n


def _torch_image(*extra: str) -> modal.Image:
    return modal.Image.debian_slim(python_version=PY).pip_install(
        *_pin("torch", *extra), index_url=TORCH_INDEX, extra_index_url=PYPI_INDEX)


api_image = modal.Image.debian_slim(python_version=PY).pip_install(
    f"fastapi[standard]=={PINS['fastapi']}", *_pin("boto3"))

_P, _S = MODELS["prithvi"], MODELS["sam"]
geo_image = (
    _torch_image("torchvision")
    .pip_install(*_pin("timm", "einops", "rasterio", "planetary-computer", "segment-anything",
                       "opencv-python-headless", "huggingface-hub", "pillow", "boto3"))
    .run_commands(
        "python -c \"from huggingface_hub import hf_hub_download as d; "
        f"[d('{_P['repo']}', n, revision='{_P['revision']}', local_dir='{PRITHVI_DIR}') "
        f"for n in ('{_P['file']}', 'config.json', 'prithvi_mae.py')]\"",
        f"mkdir -p /models/sam && python -c \"import urllib.request as u; u.urlretrieve('{_S['url']}', '{SAM_CKPT}')\"",
        # Meta names SAM checkpoints after the first hex digits of their MD5; the SHA-256 is pinned too.
        f"python -c \"import hashlib; b = open('{SAM_CKPT}', 'rb').read(); "
        "assert hashlib.md5(b).hexdigest().startswith('01ec64'); "
        f"assert hashlib.sha256(b).hexdigest() == '{_S['sha256']}'\"",
        f"python -c \"import sys; sys.path.insert(0, '{PRITHVI_DIR}'); "
        "import prithvi_mae, segment_anything, cv2, rasterio, timm, planetary_computer; print('geo image ok')\"",
    )
    # Prithvi-EO-2.0-300M-TL and SAM 2.1 base+ sit on top, so the layers above (the fallbacks) stay cached.
    .pip_install(*_pin("setuptools", "wheel", "hydra-core", "iopath"))
    .run_commands(
        # no CUDA extension on CPU (it only fills mask holes, which the image predictor does not use by default)
        f"SAM2_BUILD_CUDA=0 pip install --no-build-isolation --no-deps '{MODELS['sam2']['code']}'",
        "python -c \"from huggingface_hub import hf_hub_download as d; "
        f"[d('{MODELS['prithvi2']['repo']}', n, revision='{MODELS['prithvi2']['revision']}', local_dir='{PRITHVI2_DIR}') "
        f"for n in ('{MODELS['prithvi2']['file']}', 'config.json', 'prithvi_mae.py')]\"",
        f"mkdir -p /models/sam2 && python -c \"import urllib.request as u; u.urlretrieve('{MODELS['sam2']['url']}', "
        f"'{SAM2_CKPT}')\"",
        "python -c \"import hashlib; h = lambda p: hashlib.file_digest(open(p, 'rb'), 'sha256').hexdigest(); "
        f"assert h('{PRITHVI2_DIR}/{MODELS['prithvi2']['file']}') == '{MODELS['prithvi2']['sha256']}'; "
        f"assert h('{SAM2_CKPT}') == '{MODELS['sam2']['sha256']}'; print('geo v2 weights ok')\"",
        f"cd / && python -c \"from sam2.build_sam import build_sam2; build_sam2('{MODELS['sam2']['config']}', "
        f"'{SAM2_CKPT}', device='cpu'); print('sam2 ok')\"",
    )
)
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff,.TIF",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "1",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "VSI_CACHE": "TRUE",
}

# AlphaEarth annual embeddings on source.coop: a compact copy of the dataset's file index (path, year, UTM zone and
# bounds of every 8192 x 8192 COG) is baked in, so a call only reads the VRTs/COGs it needs.
AEF_BASE = "https://data.source.coop/tge-labs/aef/v1/annual"
AEF_INDEX = "/models/aef/index.parquet"
AEF_COLUMNS = ("path", "year", "utm_zone", "crs", "utm_west", "utm_south", "utm_east", "utm_north",
               "wgs84_west", "wgs84_south", "wgs84_east", "wgs84_north")
HTTP_UA = "YouBank-Edge-ML/1.0 (+https://youbank-nu.vercel.app)"  # source.coop's CDN refuses urllib's default agent
aef_image = (
    modal.Image.debian_slim(python_version=PY)
    .pip_install(*_pin("rasterio", "pyarrow", "pillow", "boto3"))
    .run_commands(
        "mkdir -p /models/aef && python -c \"import shutil, pyarrow.parquet as pq, urllib.request as u; "
        f"r = u.urlopen(u.Request('{AEF_BASE}/aef_index.parquet', headers={{'User-Agent': '{HTTP_UA}'}}), timeout=300); "
        "shutil.copyfileobj(r, open('/tmp/aef.parquet', 'wb')); t = pq.read_table('/tmp/aef.parquet'); "
        f"pq.write_table(t.select([c for c in {AEF_COLUMNS!r} if c in t.column_names]), '{AEF_INDEX}', "
        "compression='zstd'); print(t.num_rows, t.column_names)\" && rm /tmp/aef.parquet",
    )
)
# Each VRT is a warped VRT over /vsis3/us-west-2.opendata.source.coop/...: a public bucket, read unsigned and
# path-style (the bucket name has dots). Without these, GDAL hunts for AWS credentials and the open fails or hangs.
# The COGs are band-interleaved in 1024 px blocks, so a site window is 64 block fetches per year; GDAL_NUM_THREADS
# lets the warper fetch them in parallel (one year, 254 x 254 px: 10.5 s -> 1.5 s, identical pixels).
AEF_ENV = {**GDAL_ENV, "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff,.TIF,.vrt", "GDAL_HTTP_USERAGENT": HTTP_UA,
           "AWS_NO_SIGN_REQUEST": "YES", "AWS_REGION": "us-west-2", "AWS_VIRTUAL_HOSTING": "FALSE",
           "GDAL_NUM_THREADS": "8"}

docs_image = (
    modal.Image.debian_slim(python_version=PY)
    .apt_install("tesseract-ocr", "tesseract-ocr-eng", "tesseract-ocr-fra", "tesseract-ocr-deu", "tesseract-ocr-spa")
    .pip_install(*_pin("pdfplumber", "pypdfium2", "pytesseract", "pillow", "python-docx", "python-pptx", "openpyxl",
                       "extract-msg", "langdetect", "beautifulsoup4", "lxml", "boto3"))
    .run_commands("tesseract --list-langs")
)

_W = MODELS["whisper"]
audio_image = (
    modal.Image.debian_slim(python_version=PY)
    .apt_install("ffmpeg")
    .pip_install(*_pin("faster-whisper", "huggingface-hub", "boto3"))
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download as s; "
        f"s('{_W['repo']}', revision='{_W['revision']}', local_dir='{WHISPER_DIR}')\"",
        f"python -c \"from faster_whisper import WhisperModel; WhisperModel('{WHISPER_DIR}', device='cpu', "
        "compute_type='int8'); print('whisper ok')\"",
    )
    # Parakeet TDT 0.6B v2 (int8 ONNX through onnx-asr, no NeMo) and the Silero VAD it segments with, on top.
    .pip_install(*_pin("onnx-asr", "onnxruntime"))
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download as s; "
        f"s('{MODELS['parakeet']['repo']}', revision='{MODELS['parakeet']['revision']}', local_dir='{PARAKEET_DIR}', "
        "allow_patterns=['config.json', 'vocab.txt', 'nemo128.onnx', '*.int8.onnx']); "
        f"s('{MODELS['silero']['repo']}', revision='{MODELS['silero']['revision']}', local_dir='{SILERO_DIR}', "
        "allow_patterns=['config.json', 'silero_vad.onnx'])\"",
        f"python -c \"import onnx_asr; onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v2', '{PARAKEET_DIR}', "
        f"quantization='int8'); onnx_asr.load_vad('silero', '{SILERO_DIR}'); print('parakeet ok')\"",
    )
)

# fp32 ONNX export of the encoder; the CrossEncoder head (2_Dense, 3_LayerNorm, 4_Dense) runs in numpy. The repo's
# int8 export was left out: its scores drifted (Spearman 0.80 against sentence-transformers) and it was barely faster.
RERANK_ONNX = "onnx/model.onnx"
rerank_image = (
    modal.Image.debian_slim(python_version=PY)
    .pip_install(*_pin("onnxruntime", "tokenizers", "safetensors", "huggingface-hub"))
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download as s; "
        f"s('{MODELS['reranker']['repo']}', revision='{MODELS['reranker']['revision']}', local_dir='{RERANK_DIR}', "
        "allow_patterns=['tokenizer.json', 'tokenizer_config.json', 'config.json', 'modules.json', '*_Pooling/*', "
        f"'*_Dense/*', '*_LayerNorm/*', '{RERANK_ONNX}'])\"",
    )
)

graph_image = _torch_image().pip_install(*_pin("torch-geometric", "scikit-learn", "boto3"))
# The GPU variant: PyPI's torch wheel carries CUDA (the CPU index's does not).
graph_gpu_image = modal.Image.debian_slim(python_version=PY).pip_install(
    f"torch=={PINS['torch'].split('+')[0]}", *_pin("torch-geometric", "scikit-learn", "boto3"))

synth_image = _torch_image().pip_install(*_pin("scikit-learn", "boto3"))

topics_image = (
    modal.Image.debian_slim(python_version=PY)
    .pip_install(*_pin("umap-learn", "scikit-learn", "boto3"))
    # Run UMAP once at build time so numba's on-disk cache ships in the image (shorter cold starts). Numba keys
    # its cache on the CPU model, so compile for a generic x86-64 target that every Modal host can reuse.
    .env({"NUMBA_CPU_NAME": "generic"})
    .run_commands("python -c \"import numpy as np, umap; "
                  "umap.UMAP(n_neighbors=10, random_state=0).fit_transform(np.random.default_rng(0).normal(size=(200, 16)))\"")
)


# ---------------------------------------------------------------------------------------------
# Shared helpers: JSON hygiene, R2, Inngest, the task envelope.
# ---------------------------------------------------------------------------------------------
def _jsonable(o):
    """Plain-JSON copy of o: numpy scalars/arrays to Python, NaN/inf to None, dates to ISO strings."""
    if o is None or isinstance(o, (str, bool)):
        return o
    if type(o).__module__ == "numpy" and hasattr(o, "tolist"):
        # numpy.float64 subclasses float, so it would pass the checks below unchanged; unpickling it then needs
        # numpy (the api/status containers and local callers have none), so convert every numpy value here.
        return _jsonable(o.tolist())
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, int):
        return o
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if hasattr(o, "tolist"):
        return _jsonable(o.tolist())
    if hasattr(o, "isoformat"):
        return o.isoformat()
    try:
        f = float(o)
        return f if math.isfinite(f) else None
    except Exception:
        return str(o)


def _dumps(obj) -> bytes:
    return json.dumps(_jsonable(obj), separators=(",", ":"), allow_nan=False, ensure_ascii=False).encode()


def _digest(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else json.dumps(p, sort_keys=True, default=str).encode())
        h.update(b"\x00")
    return h.hexdigest()


_R2_CLIENT = None


def _r2():
    global _R2_CLIENT
    if _R2_CLIENT is None:
        import boto3
        from botocore.config import Config

        _R2_CLIENT = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"},
                          request_checksum_calculation="when_required", response_checksum_validation="when_required"),
        )
    return _R2_CLIENT


def _bucket() -> str:
    return os.environ["R2_BUCKET"]


def _r2_get(key: str) -> bytes:
    if not isinstance(key, str) or not key:
        raise ValueError("R2 keys must be non-empty strings")
    try:
        return _r2().get_object(Bucket=_bucket(), Key=key)["Body"].read()
    except Exception as e:
        if type(e).__name__ in ("NoSuchKey",) or "NoSuchKey" in str(e) or "404" in str(e):
            raise FileNotFoundError(f"R2 object not found: {key}") from None
        raise


def _r2_put(key: str, body: bytes, content_type: str) -> str:
    if not key.startswith("ml/"):
        raise ValueError("outputs must live under ml/")
    _r2().put_object(Bucket=_bucket(), Key=key, Body=body, ContentType=content_type)
    return key


def _put_json(key: str, obj) -> str:
    return _r2_put(key, _dumps(obj), "application/json")


def _input_keys(inp: dict, field: str = "key") -> list[str]:
    """A single R2 key, or a list of keys (`parts`, uploaded in 4 MB pieces) to concatenate in order."""
    parts = inp.get("parts")
    ref = inp.get(field)
    if isinstance(parts, list) and parts:
        return [str(k) for k in parts]
    if isinstance(ref, list) and ref:
        return [str(k) for k in ref]
    if isinstance(ref, str) and ref:
        return [ref]
    raise ValueError(f"input needs '{field}' (an R2 key) or 'parts' (R2 keys to concatenate in order)")


def _fetch_bytes(inp: dict, field: str = "key") -> bytes:
    return b"".join(_r2_get(k) for k in _input_keys(inp, field))


def _fetch_to_file(inp: dict, path: str, field: str = "key") -> tuple[str, int]:
    """Stream the input (key or parts) to a local file; returns (sha256, bytes)."""
    h, n = hashlib.sha256(), 0
    with open(path, "wb") as f:
        for k in _input_keys(inp, field):
            try:
                body = _r2().get_object(Bucket=_bucket(), Key=k)["Body"]
            except Exception as e:
                if "NoSuchKey" in type(e).__name__ or "NoSuchKey" in str(e):
                    raise FileNotFoundError(f"R2 object not found: {k}") from None
                raise
            for chunk in iter(lambda: body.read(1 << 20), b""):
                f.write(chunk)
                h.update(chunk)
                n += len(chunk)
    return h.hexdigest(), n


def _load_json_ref(inp: dict, field: str):
    return json.loads(_fetch_bytes(inp, field))


def _notify_done(data: dict) -> int | None:
    """POST the edge/ml.done event to Inngest. Returns the HTTP status (None if unreachable)."""
    key = os.environ.get("INNGEST_EVENT_KEY", "")
    if not key:
        return None
    event = {"name": DONE_EVENT, "data": data}
    if data.get("callId"):
        event["id"] = f"edge-ml-done-{data['callId']}"  # Inngest de-duplicates on id
    body = _dumps([event])
    status = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(INNGEST_URL + key, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:  # the message never includes the URL, so the key stays private
            status = e.code
            if 400 <= e.code < 500 and e.code != 429:
                return e.code
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return status


def _redact(text: str) -> str:
    """Remove secret values from error text before it leaves the container (e.g. the R2 account id inside an
    endpoint URL in a botocore error)."""
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "INNGEST_EVENT_KEY", "EDGE_ML_SECRET"):
        v = os.environ.get(k)
        if v and len(v) >= 6:
            text = text.replace(v, "***")
    return text


def _call_id() -> str | None:
    try:
        return modal.current_function_call_id()
    except Exception:
        return None


def _execute(task: str, req: dict, impl) -> dict:
    """Run a task, time it, price it, and (for async calls) announce the result on Inngest."""
    started = time.monotonic()
    _, cores, mem_mib, timeout, _ = TASKS[task]
    gib = mem_mib / 1024
    is_async = bool(req.get("async"))
    call_id = _call_id()
    sent = threading.Lock()
    done = {"sent": False}

    def envelope(ok: bool, result, error):
        seconds = round(time.monotonic() - started, 3)
        cost = seconds * (cores * CPU_USD_PER_CORE_SECOND + gib * MEM_USD_PER_GIB_SECOND + GPU_TASKS.get(task, ("", 0.0))[1])
        return {"ok": ok, "task": task, "result": _jsonable(result), "error": error, "seconds": seconds,
                "costUsd": round(cost, 7), "callId": call_id}

    def announce(env: dict) -> dict:
        if not is_async:
            return env
        with sent:
            if done["sent"]:
                return env
            done["sent"] = True
        data = {k: env[k] for k in ("callId", "task", "ok", "result", "error", "seconds", "costUsd")}
        data["correlation"] = req.get("correlation") or ""
        env["notified"] = _notify_done(data)
        print(f"[{task}] edge/ml.done sent for {call_id}: HTTP {env['notified']}")
        return env

    watchdog = None
    if is_async:  # Modal kills the container at the timeout; say so on Inngest just before that happens.
        watchdog = threading.Timer(max(5, timeout - 15),
                                   lambda: announce(envelope(False, None, f"timed out after {timeout}s")))
        watchdog.daemon = True
        watchdog.start()
    try:
        result, ok, error = impl(dict(req.get("input") or {})), True, None
    except Exception as e:
        traceback.print_exc()
        result, ok, error = None, False, _redact(f"{type(e).__name__}: {e}")[:2000]
    finally:
        if watchdog is not None:
            watchdog.cancel()
    env = announce(envelope(ok, result, error))
    print(f"[{task}] ok={env['ok']} seconds={env['seconds']} costUsd={env['costUsd']} callId={call_id}")
    return env


def _task_function(task: str, image: modal.Image, env: dict | None = None):
    name, cpu, mem, timeout, max_containers = TASKS[task]
    gpu = GPU_TASKS.get(task, (None, 0.0))[0]
    return app.function(
        name=name, image=image, cpu=cpu, memory=mem, timeout=timeout, secrets=[SECRET],
        max_containers=max_containers, scaledown_window=SCALEDOWN_SECONDS,
        env={**_threads(cpu), **APP_ENV, **(env or {})}, **({"gpu": gpu} if gpu else {}),
    )


# ---------------------------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------------------------
def _health(inp: dict) -> dict:
    import platform

    checks = {"secrets": all(os.environ.get(k) for k in SECRET_KEYS)}
    try:
        _r2().list_objects_v2(Bucket=_bucket(), Prefix="ml/", MaxKeys=1)
        checks["r2"] = True
    except Exception as e:
        checks["r2"] = False
        checks["r2Error"] = type(e).__name__
    versions = {"python": platform.python_version(), "modal": modal.__version__, **PINS}
    hf = lambda k: f"{MODELS[k]['repo']}@{MODELS[k]['revision'][:12]}"  # noqa: E731
    models = {
        "prithvi2": hf("prithvi2"),
        "sam2": MODELS["sam2"]["file"],
        "prithvi": hf("prithvi"),
        "sam": MODELS["sam"]["file"],
        "parakeet": f"{hf('parakeet')} ({MODELS['parakeet']['quantization']})",
        "whisper": f"{hf('whisper')} ({MODELS['whisper']['compute']})",
        "reranker": hf("reranker"),
    }
    resources = {t: {"cpu": c, "memoryMiB": m, "timeout": s, "maxContainers": k} for t, (_, c, m, s, k) in TASKS.items()}
    return {"app": APP_NAME, "versions": versions, "tasks": list(TASKS), "models": models,
            "resources": resources, "checks": checks}


# ---------------------------------------------------------------------------------------------
# geo.refine: Prithvi-EO patch-embedding change + Segment Anything masks at each blob.
# Primary pair: Prithvi-EO-2.0-300M-TL + SAM 2.1 base+. Fallback pair, loaded only when a primary model fails to
# load or run (or with input.legacy): Prithvi-EO-1.0-100M + SAM ViT-B, computed exactly as before.
# ---------------------------------------------------------------------------------------------
STAC_API = "https://planetarycomputer.microsoft.com/api/stac/v1"
S2_BANDS = ("B02", "B03", "B04", "B8A", "B11", "B12")  # HLS Blue, Green, Red, Narrow NIR, SWIR1, SWIR2
PRITHVI_IMG = 224
GEO_NAMES = {"prithvi2": "Prithvi-EO-2.0-300M-TL", "sam2": "sam2.1_hiera_base_plus",
             "prithvi": "Prithvi-EO-1.0-100M", "sam": "sam_vit_b_01ec64"}
# Metadata Prithvi-EO-2.0-TL gets with each date: the box centre (lon, lat). The acquisition date is left out: the
# checkpoint's learned weight on it is ~1e-6 (location's is 0.058), and on the Orla test scene adding it changed no
# z-score. The last layer's tokens separated the new pond from the rest of the scene better than layers 12 or 18.
PRITHVI2_COORDS = ("location",)
_GEO: dict = {}
_GEO_ERRORS: dict = {}


def _load_py(name: str, path: str):
    """Import a model-code file under its own module name (both Prithvi repos ship a `prithvi_mae.py`)."""
    import importlib.util
    import sys

    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return sys.modules[name]


def _encoder_state(path: str) -> dict:
    """The encoder half of a Prithvi MAE checkpoint, without the fixed sin-cos position tables."""
    import torch

    try:
        sd = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:  # pinned revision from a trusted repo
        sd = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(sd, dict) and "model" in sd and isinstance(sd["model"], dict):
        sd = sd["model"]
    if any(k.startswith("encoder.") for k in sd):
        sd = {k[len("encoder."):]: v for k, v in sd.items() if k.startswith("encoder.")}
    else:
        sd = {k: v for k, v in sd.items() if not k.startswith(("decoder", "mask_token"))}
    return {k: v for k, v in sd.items() if "pos_embed" not in k}  # fixed sin-cos buffers are rebuilt by the model


def _load_prithvi() -> dict:
    """Prithvi-EO-1.0-100M (the fallback), as before: 3 frames, encoder only."""
    import numpy as np

    mod = _load_py("prithvi_mae_v1", f"{PRITHVI_DIR}/prithvi_mae.py")  # model code shipped in the HF repo
    with open(f"{PRITHVI_DIR}/config.json") as f:
        cfg = json.load(f)["pretrained_cfg"]
    enc = mod.PrithviViT(img_size=cfg["img_size"], patch_size=tuple(cfg["patch_size"]), num_frames=cfg["num_frames"],
                         in_chans=cfg["in_chans"], embed_dim=cfg["embed_dim"], depth=cfg["depth"],
                         num_heads=cfg["num_heads"], mlp_ratio=cfg["mlp_ratio"])
    missing, unexpected = enc.load_state_dict(_encoder_state(f"{PRITHVI_DIR}/{MODELS['prithvi']['file']}"), strict=False)
    missing = [m for m in missing if "pos_embed" not in m]
    if missing or unexpected:
        raise RuntimeError(f"Prithvi weights did not match: missing={missing[:5]} unexpected={unexpected[:5]}")
    enc.eval()
    return {"prithvi": enc, "mean": np.asarray(cfg["mean"], np.float32), "std": np.asarray(cfg["std"], np.float32),
            "grid": cfg["img_size"] // cfg["patch_size"][-1], "frames": cfg["num_frames"]}


def _load_prithvi2() -> dict:
    """Prithvi-EO-2.0-300M-TL encoder, one date per sample (num_frames=1; its temporal patch size is 1)."""
    import numpy as np
    import torch

    mod = _load_py("prithvi_mae_v2", f"{PRITHVI2_DIR}/prithvi_mae.py")
    with open(f"{PRITHVI2_DIR}/config.json") as f:
        cfg = json.load(f)["pretrained_cfg"]
    kwargs = dict(img_size=cfg["img_size"], patch_size=tuple(cfg["patch_size"]), num_frames=1, in_chans=cfg["in_chans"],
                  embed_dim=cfg["embed_dim"], depth=cfg["depth"], num_heads=cfg["num_heads"], mlp_ratio=cfg["mlp_ratio"],
                  coords_encoding=list(cfg.get("coords_encoding") or []),
                  coords_scale_learn=bool(cfg.get("coords_scale_learn")))
    sd = _encoder_state(f"{PRITHVI2_DIR}/{MODELS['prithvi2']['file']}")
    grid = (1, cfg["img_size"] // cfg["patch_size"][1], cfg["img_size"] // cfg["patch_size"][2])
    pos = torch.from_numpy(mod.get_3d_sincos_pos_embed(cfg["embed_dim"], grid, add_cls_token=True)).float().unsqueeze(0)
    try:  # build on the meta device: skips the random init of 300M weights that the checkpoint replaces anyway
        with torch.device("meta"):
            enc = mod.PrithviViT(**kwargs)
        missing, unexpected = enc.load_state_dict({**sd, "pos_embed": pos}, strict=False, assign=True)
        for name, buf in list(enc.named_buffers()):
            if buf.is_meta and name.endswith("scale"):  # fixed (non-learned) coordinate scales are ones
                enc.get_submodule(name.rsplit(".", 1)[0]).register_buffer("scale", torch.ones(1))
        if any(t.is_meta for t in [*enc.parameters(), *enc.buffers()]):
            raise RuntimeError("tensors left on the meta device")
    except Exception as e:
        print(f"[geo.refine] meta-device load of Prithvi-EO-2.0 failed ({type(e).__name__}: {e}); plain load")
        enc = mod.PrithviViT(**kwargs)
        missing, unexpected = enc.load_state_dict(sd, strict=False)
    missing = [m for m in missing if "pos_embed" not in m]
    if missing or unexpected:
        raise RuntimeError(f"Prithvi-EO-2.0 weights did not match: missing={missing[:5]} unexpected={unexpected[:5]}")
    enc.eval()
    return {"prithvi": enc, "mean": np.asarray(cfg["mean"], np.float32), "std": np.asarray(cfg["std"], np.float32),
            "grid": grid[1], "coords": set(kwargs["coords_encoding"])}


def _load_sam() -> dict:
    """Segment Anything ViT-B (the fallback)."""
    import torch
    from segment_anything import SamPredictor, sam_model_registry

    sam = sam_model_registry["vit_b"]()
    sam.load_state_dict(torch.load(SAM_CKPT, map_location="cpu", weights_only=True))
    sam.eval()
    return {"sam": SamPredictor(sam)}


def _load_sam2() -> dict:
    """SAM 2.1 Hiera base+ image predictor (Meta's code, CPU, no CUDA extension)."""
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    return {"sam": SAM2ImagePredictor(build_sam2(MODELS["sam2"]["config"], SAM2_CKPT, device="cpu"))}


_GEO_LOADERS = {"prithvi2": _load_prithvi2, "sam2": _load_sam2, "prithvi": _load_prithvi, "sam": _load_sam}


def _geo_model(kind: str) -> dict:
    """One geo model, loaded once per container. A failed load is remembered and re-raised, so later calls go
    straight to the fallback instead of paying for the failure again."""
    if kind in _GEO:
        return _GEO[kind]
    if kind in _GEO_ERRORS:
        raise RuntimeError(_GEO_ERRORS[kind])
    import torch

    torch.set_num_threads(_hw_threads(TASKS["geo.refine"][1]))  # 4 threads on 2 cores: SAM 2 15.4 s -> 10.2 s
    t0 = time.monotonic()
    try:
        model = _GEO_LOADERS[kind]()
    except Exception as e:
        traceback.print_exc()
        _GEO_ERRORS[kind] = _redact(f"{GEO_NAMES[kind]} did not load: {type(e).__name__}: {e}")[:500]
        raise RuntimeError(_GEO_ERRORS[kind]) from None
    model["loadSeconds"] = round(time.monotonic() - t0, 2)
    print(f"[geo.refine] loaded {GEO_NAMES[kind]} in {model['loadSeconds']} s")
    _GEO[kind] = model
    return model


def _s2_stack(item_id: str, bbox: list[float], out: int = PRITHVI_IMG):
    """Six HLS-equivalent Sentinel-2 L2A bands over bbox, warped to an out x out lon/lat grid.
    Returns (reflectance x 10000 as float32 [6, out, out], valid mask, scene info)."""
    from concurrent.futures import ThreadPoolExecutor

    import numpy as np
    import planetary_computer
    import rasterio
    import requests
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.vrt import WarpedVRT

    r = requests.get(f"{STAC_API}/collections/sentinel-2-l2a/items/{item_id}", timeout=30)
    if r.status_code == 404:
        raise ValueError(f"Sentinel-2 item not found on Planetary Computer: {item_id}")
    r.raise_for_status()
    item = r.json()
    props = item.get("properties", {})
    baseline = str(props.get("s2:processing_baseline") or "00.00")
    try:  # from processing baseline 04.00 (Jan 2022) L2A digital numbers carry a +1000 offset
        offset = 1000.0 if float(baseline) >= 4.0 else 0.0
    except ValueError:
        offset = 0.0
    hrefs = {b: planetary_computer.sign(item["assets"][b]["href"]) for b in S2_BANDS}  # sign serially (token cache)
    transform = from_bounds(*bbox, out, out)

    def read(band: str):
        with rasterio.Env(**GDAL_ENV):
            with rasterio.open(hrefs[band]) as src:
                with WarpedVRT(src, crs="EPSG:4326", transform=transform, width=out, height=out,
                               resampling=Resampling.bilinear, src_nodata=0, nodata=0) as vrt:
                    return vrt.read(1, out_dtype="float32")

    with ThreadPoolExecutor(len(S2_BANDS)) as ex:
        dn = np.stack(list(ex.map(read, S2_BANDS)))
    valid = (dn > 0).all(0)
    refl = np.clip(dn - offset, 0, None).astype(np.float32)
    info = {"scene": item_id, "date": str(props.get("datetime", ""))[:10], "cloud": props.get("eo:cloud_cover"),
            "baseline": baseline, "offset": offset, "validFraction": round(float(valid.mean()), 4)}
    return refl, valid, info


def _fetch_png(url: str):
    import numpy as np
    import requests
    from PIL import Image

    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("image urls must be https")
    last = None
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=90)
            if r.status_code == 200:
                return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"))
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = type(e).__name__
        time.sleep(1 + 2 * attempt)
    raise RuntimeError(f"could not fetch image ({last})")


def _blob_rect(b: dict, size: int) -> tuple[float, float, float, float]:
    bb = b.get("bbox")
    if isinstance(bb, (list, tuple)) and len(bb) == 4:
        x0, y0, x1, y1 = (float(v) for v in bb)
    else:
        x0 = x1 = float(b["x"])
        y0 = y1 = float(b["y"])
    if x1 - x0 < 1:
        c = (x0 + x1) / 2
        x0, x1 = c - 0.5, c + 0.5
    if y1 - y0 < 1:
        c = (y0 + y1) / 2
        y0, y1 = c - 0.5, c + 0.5
    return max(0.0, x0), max(0.0, y0), min(float(size), x1), min(float(size), y1)


def _patch_change(dist, valid, blobs: list, size: int) -> dict:
    """Per-blob change from a g x g map of patch cosine distances: overlap-weighted mean distance over the blob's
    bbox and its z-score against every valid patch (patches with >= 50 % nodata in either date are left out)."""
    g = dist.shape[0]
    p = PRITHVI_IMG // g
    patch_valid = valid.reshape(g, p, g, p).mean((1, 3)) >= 0.5
    vals = dist[patch_valid]
    mu = float(vals.mean()) if vals.size else float("nan")
    sd = float(vals.std()) if vals.size > 1 else float("nan")
    cell = size / g
    out = []
    for b in blobs:
        x0, y0, x1, y1 = _blob_rect(b, size)
        wsum = vsum = 0.0
        for i in range(int(y0 // cell), min(g - 1, int(max(y0, y1 - 1e-9) // cell)) + 1):
            for j in range(int(x0 // cell), min(g - 1, int(max(x0, x1 - 1e-9) // cell)) + 1):
                ox = min(x1, (j + 1) * cell) - max(x0, j * cell)
                oy = min(y1, (i + 1) * cell) - max(y0, i * cell)
                if ox > 0 and oy > 0 and patch_valid[i, j]:
                    wsum += ox * oy
                    vsum += ox * oy * dist[i, j]
        d = vsum / wsum if wsum > 0 else None
        z = (d - mu) / sd if d is not None and sd and math.isfinite(sd) and sd > 0 else None
        out.append({"distance": round(d, 5) if d is not None else None, "z": round(z, 3) if z is not None else None})
    return {"blobs": out, "grid": g, "mean": round(mu, 5), "std": round(sd, 5), "validPatches": int(patch_valid.sum()),
            "map": [[round(v, 4) for v in row] for row in dist]}


def _normalised_pair(m: dict, rb, vb, ra, va):
    import numpy as np

    valid = vb & va
    mean, std = m["mean"][:, None, None], m["std"][:, None, None]
    xb = np.where(valid[None], (rb - mean) / std, 0.0).astype(np.float32)
    xa = np.where(valid[None], (ra - mean) / std, 0.0).astype(np.float32)
    return xb, xa, valid


def _prithvi_compare(m: dict, rb, vb, ra, va, blobs: list, size: int) -> dict:
    """Prithvi-EO-1.0 (fallback): each date one frame repeated over the model's 3 time steps; last-layer patch
    tokens averaged over time."""
    import numpy as np
    import torch

    xb, xa, valid = _normalised_pair(m, rb, vb, ra, va)
    frames, g = m["frames"], m["grid"]
    # (B, C, T, H, W): each date is one frame repeated over the model's 3 time steps.
    x = torch.from_numpy(np.stack([xb, xa]))[:, :, None].repeat(1, 1, frames, 1, 1)
    with torch.inference_mode():
        tokens = m["prithvi"].forward_features(x)[-1][:, 1:, :]  # drop CLS -> (2, T*g*g, 768)
    tokens = tokens.reshape(2, frames, g, g, -1).mean(1)  # average over time -> (2, g, g, 768)
    dist = (1 - torch.nn.functional.cosine_similarity(tokens[0], tokens[1], dim=-1)).numpy().astype(float)
    return {"model": GEO_NAMES["prithvi"], **_patch_change(dist, valid, blobs, size)}


def _prithvi2_compare(m: dict, rb, vb, ra, va, blobs: list, size: int, bbox: list, dates: tuple,
                      coords: tuple = PRITHVI2_COORDS, layer: int = -1) -> dict:
    """Prithvi-EO-2.0-TL: both dates encoded independently in one batch (each a single frame), with the
    coordinate metadata named in `coords`; patch tokens of `layer` compared by cosine distance."""
    import datetime as dt

    import numpy as np
    import torch

    xb, xa, valid = _normalised_pair(m, rb, vb, ra, va)
    x = torch.from_numpy(np.stack([xb, xa]))[:, :, None]  # (B=2 dates, C, T=1, H, W)
    kw, used = {}, []
    if "location" in coords and "location" in m["coords"]:
        lon, lat = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        kw["location_coords"] = torch.tensor([[lon, lat], [lon, lat]], dtype=torch.float32)  # (lon, lat) per TerraTorch
        used.append("location")
    if "time" in coords and "time" in m["coords"]:
        try:
            ds = [dt.date.fromisoformat(str(d)[:10]) for d in dates]
            kw["temporal_coords"] = torch.tensor([[[d.year, d.timetuple().tm_yday]] for d in ds], dtype=torch.float32)
            used.append("time")
        except (TypeError, ValueError):
            pass
    with torch.inference_mode():
        tokens = m["prithvi"].forward_features(x, **kw)[layer][:, 1:, :]  # drop CLS -> (2, g*g, 1024)
    g = m["grid"]
    tokens = tokens.reshape(2, g, g, -1)
    dist = (1 - torch.nn.functional.cosine_similarity(tokens[0], tokens[1], dim=-1)).numpy().astype(float)
    return {"model": GEO_NAMES["prithvi2"], **_patch_change(dist, valid, blobs, size), "coords": used}


def _outline(mask, px: float, py: float, sx: float, sy: float, max_points: int = 40) -> list:
    import cv2
    import numpy as np

    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    best = next((c for c in contours if cv2.pointPolygonTest(c, (float(px), float(py)), False) >= 0), None)
    if best is None:
        best = max(contours, key=cv2.contourArea)
    eps = max(0.5, 0.002 * cv2.arcLength(best, True))
    poly = cv2.approxPolyDP(best, eps, True)
    while len(poly) > max_points:
        eps *= 1.35
        poly = cv2.approxPolyDP(best, eps, True)
    return [[round(float(q[0][0]) * sx, 2), round(float(q[0][1]) * sy, 2)] for q in poly]


def _sam_compare(predictor, name: str, img_b, img_a, blobs: list, size: int) -> dict:
    """A positive point at each blob centroid, the best of the three masks by predicted IoU, on both PNGs. Works with
    SAM (SamPredictor) and SAM 2 (SAM2ImagePredictor), which share predict()."""
    import numpy as np
    from PIL import Image

    reset = getattr(predictor, "reset_predictor", None) or predictor.reset_image

    def points(img):
        h, w = img.shape[:2]
        return [(float(b["x"]) * w / size, float(b["y"]) * h / size) for b in blobs]

    def masks_at(img, pts):
        predictor.set_image(img)  # RGB uint8, H x W x 3
        res = []
        for px, py in pts:
            ms, scores, _ = predictor.predict(point_coords=np.array([[px, py]], dtype=np.float32),
                                              point_labels=np.array([1], dtype=np.int32), multimask_output=True)
            k = int(np.argmax(scores))
            res.append((np.asarray(ms[k]).astype(bool), float(scores[k])))
        reset()
        return res

    pa = points(img_a)
    before = masks_at(img_b, points(img_b)) if blobs else []
    after = masks_at(img_a, pa) if blobs else []
    ha, wa = img_a.shape[:2]
    out = []
    for (mb, _sb), (ma, sa), (px, py) in zip(before, after, pa):
        if mb.shape != ma.shape:
            mb = np.asarray(Image.fromarray(mb.astype(np.uint8) * 255).resize((wa, ha), Image.NEAREST)) > 127
        union = int(np.logical_or(mb, ma).sum())
        iou = float(np.logical_and(mb, ma).sum()) / union if union else 0.0
        out.append({"areaPx": int(ma.sum()), "iou": round(iou, 4), "polygon": _outline(ma, px, py, size / wa, size / ha),
                    "score": round(sa, 4), "areaBeforePx": int(mb.sum())})
    return {"model": name, "blobs": out, "imageSize": [wa, ha]}


def _geo_refine(inp: dict) -> dict:
    import resource
    from concurrent.futures import ThreadPoolExecutor

    bbox = [float(v) for v in (inp.get("bbox") or [])]
    if len(bbox) != 4 or not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
        raise ValueError("bbox must be [minx, miny, maxx, maxy] in lon/lat")
    size = int(inp.get("size") or 256)
    blobs = list(inp.get("blobs") or [])
    for b in blobs:
        if "x" not in b or "y" not in b:
            raise ValueError("every blob needs x and y (centroid in the size grid)")
    before, after = inp.get("before") or {}, inp.get("after") or {}
    for side, v in (("before", before), ("after", after)):
        if not v.get("scene") or not v.get("url"):
            raise ValueError(f"{side} needs scene (Sentinel-2 L2A item id) and url (true-colour PNG)")
    legacy = bool(inp.get("legacy"))  # force the original pair (Prithvi-EO-1.0-100M + SAM ViT-B)
    first = ("prithvi", "sam") if legacy else ("prithvi2", "sam2")
    t0 = time.monotonic()

    def preload(kind: str):
        try:
            _geo_model(kind)
        except Exception:
            pass  # remembered in _GEO_ERRORS; the comparison below falls back

    with ThreadPoolExecutor(6) as ex:  # model loading (cold start) overlaps the imagery downloads
        loads = [ex.submit(preload, k) for k in first]
        fb, fa = ex.submit(_s2_stack, before["scene"], bbox), ex.submit(_s2_stack, after["scene"], bbox)
        ib, ia = ex.submit(_fetch_png, before["url"]), ex.submit(_fetch_png, after["url"])
        (rb, vb, info_b), (ra, va, info_a) = fb.result(), fa.result()
        img_b, img_a = ib.result(), ia.result()
        t_fetch = time.monotonic() - t0
        for f in loads:
            f.result()
    t1 = time.monotonic()
    fallbacks = {}
    prithvi = sam = None
    if not legacy:
        try:
            prithvi = _prithvi2_compare(_geo_model("prithvi2"), rb, vb, ra, va, blobs, size, bbox,
                                        (info_b["date"], info_a["date"]))
        except Exception as e:
            traceback.print_exc()
            fallbacks["prithvi"] = _redact(f"{type(e).__name__}: {e}")[:300]
    if prithvi is None:
        prithvi = _prithvi_compare(_geo_model("prithvi"), rb, vb, ra, va, blobs, size)
    t2 = time.monotonic()
    if not legacy:
        try:
            sam = _sam_compare(_geo_model("sam2")["sam"], GEO_NAMES["sam2"], img_b, img_a, blobs, size)
        except Exception as e:
            traceback.print_exc()
            fallbacks["sam"] = _redact(f"{type(e).__name__}: {e}")[:300]
    if sam is None:
        sam = _sam_compare(_geo_model("sam")["sam"], GEO_NAMES["sam"], img_b, img_a, blobs, size)
    t3 = time.monotonic()
    out = {"prithvi": prithvi, "sam": sam, "scenes": {"before": info_b, "after": info_a}, "size": size,
           # which models produced this result, for the finding's provenance
           "modelVersion": f"{prithvi['model']} + {sam['model']}",
           "timings": {"fetch": round(t_fetch, 2), "loadWait": round(t1 - t0 - t_fetch, 2), "prithvi": round(t2 - t1, 2),
                       "sam": round(t3 - t2, 2),
                       "maxRssMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)}}
    if fallbacks:
        out["fallbacks"] = fallbacks
    return out


# ---------------------------------------------------------------------------------------------
# geo.embed_change: Google DeepMind's AlphaEarth annual embeddings for a box in two years -> per-pixel cosine change
# ---------------------------------------------------------------------------------------------
AEF_ATTRIBUTION = "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind."
AEF_MAX_DEG = 0.06  # longest box side in degrees (about 6 km): 64 int8 bands x 2 years stay a few MB
AEF_VMAX = 0.5  # change (1 - cosine) drawn at the top of the PNG's colour ramp
AEF_THRESHOLDS = (0.1, 0.2, 0.3, 0.5)
AEF_RAMP = ((0.0, (0, 0, 4)), (0.25, (87, 16, 110)), (0.5, (188, 55, 84)), (0.75, (249, 142, 9)), (1.0, (252, 255, 164)))
_AEF: dict = {}


def _aef_index() -> dict:
    """The baked index as numpy columns (one row per COG and year)."""
    if not _AEF:
        import numpy as np
        import pyarrow.parquet as pq

        t = pq.read_table(AEF_INDEX)
        _AEF.update({c: (t.column(c).to_numpy() if c.startswith(("utm_w", "utm_s", "utm_e", "utm_n", "wgs84", "year"))
                         else np.asarray(t.column(c).to_pylist(), dtype=object)) for c in t.column_names})
        _AEF["years"] = sorted({int(y) for y in _AEF["year"]})
    return _AEF


def _aef_tiles(year: int, bbox: list) -> list:
    """COGs of `year` that overlap the box, in the UTM zone of the box centre when it has any (one CRS, one grid)."""
    import numpy as np

    ix = _aef_index()
    hit = ((ix["year"] == year) & (ix["wgs84_west"] <= bbox[2]) & (ix["wgs84_east"] >= bbox[0])
           & (ix["wgs84_south"] <= bbox[3]) & (ix["wgs84_north"] >= bbox[1]))
    rows = list(np.nonzero(hit)[0])
    if not rows:
        return []
    lon, lat = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    zone = f"{int((lon + 180) // 6) + 1}{'N' if lat >= 0 else 'S'}"
    same = [i for i in rows if str(ix["utm_zone"][i]) == zone]
    if not same:  # the centre's zone has no file here: use one CRS among those that do
        same = [i for i in rows if str(ix["crs"][i]) == str(ix["crs"][rows[0]])]
    out = []
    for i in same:
        rel = str(ix["path"][i]).split("/annual/", 1)[-1]  # "<year>/<zone>/<name>.tiff"
        out.append({"key": rel, "vrt": f"/vsicurl/{AEF_BASE}/{rel.rsplit('.', 1)[0]}.vrt", "crs": str(ix["crs"][i])})
    return out


def _aef_grid(tiles: list, bbox: list) -> tuple:
    """The output pixel grid: the box in the tiles' UTM CRS, snapped outward to the first tile's 10 m pixels.
    Returns (transform, height, width, crs)."""
    import math as m

    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import transform_bounds

    with rasterio.Env(**AEF_ENV), rasterio.open(tiles[0]["vrt"]) as src:
        t0, crs = src.transform, src.crs
    ub = transform_bounds("EPSG:4326", crs, *bbox, densify_pts=21)
    c0, c1 = m.floor((ub[0] - t0.c) / t0.a), m.ceil((ub[2] - t0.c) / t0.a)
    r0, r1 = m.floor((ub[3] - t0.f) / t0.e), m.ceil((ub[1] - t0.f) / t0.e)
    return t0 * Affine.translation(c0, r0), r1 - r0, c1 - c0, crs.to_string()


def _aef_read(tiles: list, grid: tuple):
    """The 64-band int8 embedding on `grid` (-128 = no data), read through each COG's VRT (the COGs are stored
    bottom-up; the VRTs flip them) with windowed reads."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window

    gt, h, w, _ = grid
    out = None
    with rasterio.Env(**AEF_ENV):
        for t in tiles:
            with rasterio.open(t["vrt"]) as src:
                if out is None:
                    out = np.full((src.count, h, w), -128, np.int8)
                col = round((gt.c - src.transform.c) / src.transform.a)
                row = round((gt.f - src.transform.f) / src.transform.e)
                try:
                    win = Window(col, row, w, h).intersection(Window(0, 0, src.width, src.height))
                except Exception:  # this file does not overlap the box
                    continue
                data = src.read(window=win)
            dr, dc = int(win.row_off - row), int(win.col_off - col)
            sub = out[:, dr:dr + data.shape[1], dc:dc + data.shape[2]]
            ok = data[0] != -128
            sub[:, ok] = data[:, ok]
    return out


def _aef_png(change, valid, scale: float = AEF_VMAX, max_side: int = 256, levels: int = 64) -> str:
    """The change map as a small palette PNG (data URL): `levels` steps of an inferno-like ramp from 0 to `scale`,
    no-data transparent. North up, one pixel per 10 m unless the box is over `max_side` pixels."""
    import base64

    import numpy as np
    from PIL import Image

    v = np.clip(np.nan_to_num(change) / scale, 0, 1).astype(np.float32)
    ok = np.asarray(valid, bool)
    h, w = v.shape
    if max(h, w) > max_side:
        k = max_side / max(h, w)
        size = (max(1, round(w * k)), max(1, round(h * k)))
        v = np.asarray(Image.fromarray(v).resize(size, Image.BILINEAR))  # float32 -> mode "F"
        ok = np.asarray(Image.fromarray(ok.astype(np.uint8) * 255).resize(size, Image.NEAREST)) > 127
    idx = np.clip(np.rint(v * (levels - 1)), 0, levels - 1).astype(np.uint8)
    idx[~ok] = levels  # the transparent entry
    stops = np.array([a for a, _ in AEF_RAMP])
    cols = np.array([c for _, c in AEF_RAMP], np.float32)
    t = np.linspace(0, 1, levels)
    pal = np.stack([np.interp(t, stops, cols[:, ch]) for ch in range(3)], 1).round().astype(np.uint8)
    img = Image.frombytes("P", (idx.shape[1], idx.shape[0]), np.ascontiguousarray(idx).tobytes())
    img.putpalette(pal.reshape(-1).tolist() + [0, 0, 0])
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True, transparency=levels)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _geo_embed_change(inp: dict) -> dict:
    from concurrent.futures import ThreadPoolExecutor

    import numpy as np

    bbox = [float(v) for v in (inp.get("bbox") or [])]
    if len(bbox) != 4 or not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
        raise ValueError("bbox must be [minx, miny, maxx, maxy] in lon/lat")
    if max(bbox[2] - bbox[0], bbox[3] - bbox[1]) > AEF_MAX_DEG:
        raise ValueError(f"the box can be at most {AEF_MAX_DEG} degrees on a side")
    have = _aef_index()["years"]
    years = [int(y) for y in (inp.get("years") or [have[-2], have[-1]])]
    if len(years) != 2 or years[0] == years[1] or any(y not in have for y in years):
        raise ValueError(f"years must be two different years among {have[0]}..{have[-1]}")
    t0 = time.monotonic()
    tiles = {y: _aef_tiles(y, bbox) for y in years}
    for y, ts in tiles.items():
        if not ts:
            raise ValueError(f"no AlphaEarth tiles cover this box in {y}")
    if tiles[years[0]][0]["crs"] != tiles[years[1]][0]["crs"]:
        raise ValueError("the two years' files are in different UTM zones")
    grid = _aef_grid(tiles[years[0]], bbox)  # both years on the same pixels
    with ThreadPoolExecutor(2) as ex:
        a, b = ex.map(lambda y: _aef_read(tiles[y], grid), years)
    t_read = time.monotonic() - t0
    valid = (a[0] != -128) & (b[0] != -128)

    def dequant(x):  # (v / 127.5)^2 * sign(v), as the dataset's README specifies
        v = x.astype(np.float32) / 127.5
        return v * np.abs(v)

    va, vb = dequant(a), dequant(b)
    na, nb = np.sqrt((va * va).sum(0)), np.sqrt((vb * vb).sum(0))
    cos = (va * vb).sum(0) / np.maximum(na * nb, 1e-9)
    change = np.where(valid, np.clip(1.0 - cos, 0.0, 2.0), np.nan).astype(np.float32)
    vals = change[valid]
    q = (lambda p: round(float(np.percentile(vals, p)), 4)) if vals.size else (lambda p: None)
    stats = {"mean": round(float(vals.mean()), 4) if vals.size else None, "median": q(50), "p90": q(90), "p95": q(95),
             "p99": q(99), "max": round(float(vals.max()), 4) if vals.size else None,
             "above": {str(t): round(float((vals > t).mean()), 4) if vals.size else None for t in AEF_THRESHOLDS}}
    gt, h, w, crs = grid
    return {"years": years, "bbox": bbox, "crs": crs, "shape": [h, w], "pixelMeters": round(abs(gt.a), 2),
            "validFraction": round(float(valid.mean()), 4), "stats": stats,
            "png": _aef_png(change, valid), "pngScale": {"vmax": AEF_VMAX, "ramp": "inferno", "nodata": "transparent"},
            "tiles": {str(y): [t["key"] for t in ts] for y, ts in tiles.items()}, "readSeconds": round(t_read, 2),
            "source": "https://source.coop/tge-labs/aef", "license": "CC-BY-4.0", "attribution": AEF_ATTRIBUTION}


# ---------------------------------------------------------------------------------------------
# docs.parse: any document -> pages of text and tables (+ OCR word boxes)
# ---------------------------------------------------------------------------------------------
OCR_DPI = 200
MAX_TABLE_CELLS = 400_000


def _decode_text(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _sniff_kind(data: bytes, mime: str, name: str) -> str:
    n, m, head = name.lower(), mime.lower(), data[:16]
    if data[:1024].find(b"%PDF-") >= 0 and (head.startswith(b"%PDF") or m == "application/pdf" or n.endswith(".pdf")):
        return "pdf"
    if head.startswith(b"PK\x03\x04"):
        import zipfile

        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except zipfile.BadZipFile:
            names = []
        for prefix, kind in (("word/", "docx"), ("ppt/", "pptx"), ("xl/", "xlsx")):
            if any(x.startswith(prefix) for x in names):
                return kind
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "msg"  # OLE2: Outlook .msg (legacy .doc/.xls/.ppt are not supported)
    if (head.startswith(b"\x89PNG") or head[:3] == b"\xff\xd8\xff" or head[:4] in (b"II*\x00", b"MM\x00*")
            or head[:6] in (b"GIF87a", b"GIF89a") or (head[:4] == b"RIFF" and data[8:12] == b"WEBP")
            or (head[:2] == b"BM" and (n.endswith(".bmp") or m == "image/bmp"))):
        return "image"
    if m.startswith("image/"):
        return "image"
    if m == "message/rfc822" or n.endswith(".eml"):
        return "eml"
    if n.endswith(".msg") or m == "application/vnd.ms-outlook":
        return "msg"
    if m in ("text/csv", "text/tab-separated-values", "application/csv") or n.endswith((".csv", ".tsv")):
        return "csv"
    if m in ("text/html", "application/xhtml+xml") or n.endswith((".html", ".htm", ".xhtml")):
        return "html"
    start = data[:4096].lstrip()[:200].lower()
    if start.startswith((b"<!doctype html", b"<html")):
        return "html"
    if re.match(rb"^(received|return-path|mime-version|message-id|delivered-to|from|to|subject|date):", data[:300], re.I):
        return "eml"
    return "text"


def _tsv(rows: list) -> str:
    return "\n".join("\t".join(str(c) for c in r) for r in rows)


def _clean_table(t) -> list:
    rows = [["" if c is None else re.sub(r"\s+", " ", str(c)).strip() for c in row] for row in (t or [])]
    return [r for r in rows if any(r)]


def _trim_rows(rows: list) -> list:
    rows = [list(r) for r in rows]
    while rows and not any(rows[-1]):
        rows.pop()
    width = max((max((i + 1 for i, c in enumerate(r) if c != ""), default=0) for r in rows), default=0)
    return [(r + [""] * width)[:width] for r in rows]


def _ocr_langs(requested: str | None) -> str:
    import pytesseract

    have = set(pytesseract.get_languages(config=""))
    want = [x for x in (requested or "eng").split("+") if x in have]
    return "+".join(want) or "eng"


def _ocr(img, lang: str, scale: float = 1.0) -> tuple[str, list]:
    """Tesseract text plus word boxes (in the caller's coordinate space via `scale`)."""
    import pytesseract
    from pytesseract import Output

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    d = pytesseract.image_to_data(img, lang=lang, config="--oem 1 --psm 3", output_type=Output.DICT)
    words, lines, order = [], {}, []
    for i, raw in enumerate(d["text"]):
        t = (raw or "").strip()
        try:
            conf = float(d["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if not t or conf < 0:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        if key not in lines:
            lines[key] = []
            order.append(key)
        lines[key].append(t)
        x, y, w, h = d["left"][i], d["top"][i], d["width"][i], d["height"][i]
        words.append({"t": t, "x0": round(x * scale, 1), "y0": round(y * scale, 1),
                      "x1": round((x + w) * scale, 1), "y1": round((y + h) * scale, 1)})
    out, prev = [], None
    for key in order:
        if prev is not None and key[:2] != prev[:2]:
            out.append("")
        out.append(" ".join(lines[key]))
        prev = key
    return "\n".join(out), words


def _glued(text: str) -> bool:
    """Whether a page's text lost its spaces ("wefindthatalmost..."): too many implausibly long words."""
    words = text.split()
    if len(words) < 20:
        return False
    return sum(1 for w in words if len(w) > 22) / len(words) > 0.08


def _parse_pdf(data: bytes, ocr: str, lang: str, deadline: float) -> tuple[list, str, int, bool]:
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    import pdfplumber
    import pypdfium2 as pdfium

    pages, need, truncated = [], [], False
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        meta = pdf.metadata or {}
        title = str(meta.get("Title") or "").strip()
        for i, page in enumerate(pdf.pages):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if _glued(text):
                # Some fonts leave word gaps under pdfplumber's default tolerance; a tighter one splits them,
                # and PDFium's own text layer is the last resort.
                try:
                    alt = page.extract_text(x_tolerance=1) or ""
                    if alt and not _glued(alt):
                        text = alt
                    else:
                        alt = pdfium.PdfDocument(data)[i].get_textpage().get_text_range() or ""
                        if alt and not _glued(alt):
                            text = alt
                except Exception:
                    pass
            tables = []
            if time.monotonic() < deadline:
                try:
                    tables = [t for t in (_clean_table(x) for x in page.extract_tables()) if t]
                except Exception:
                    tables = []
            else:
                truncated = True
            pages.append({"n": i + 1, "text": text, "tables": tables,
                          "width": round(float(page.width), 2), "height": round(float(page.height), 2)})
            if ocr == "force" or (ocr == "auto" and len(text.strip()) < 25):
                need.append(i)
            try:
                page.flush_cache()
            except Exception:
                pass
    ocr_pages = 0
    if need:
        doc = pdfium.PdfDocument(data)  # pdfium is not thread-safe: render here, OCR in worker threads
        try:
            futures = {}
            with ThreadPoolExecutor(2) as ex:
                for i in need:
                    if time.monotonic() > deadline:
                        pages[i]["ocrSkipped"] = True
                        truncated = True
                        continue
                    pg = doc[i]
                    img = pg.render(scale=OCR_DPI / 72).to_pil()
                    pg.close()
                    futures[ex.submit(_ocr, img, lang, 72 / OCR_DPI)] = i
                    while sum(not f.done() for f in futures) >= 4:
                        wait([f for f in futures if not f.done()], return_when=FIRST_COMPLETED)
                for f, i in futures.items():
                    text, words = f.result()
                    if ocr == "force" or len(text.strip()) > len(pages[i]["text"].strip()):
                        pages[i]["text"] = text
                    pages[i]["words"] = words
                    pages[i]["ocr"] = True
                    ocr_pages += 1
        finally:
            doc.close()
    return pages, title, ocr_pages, truncated


def _parse_image(data: bytes, ocr: str, lang: str) -> tuple[list, int]:
    from PIL import Image, ImageOps, ImageSequence

    im = Image.open(io.BytesIO(data))
    pages, ocr_pages = [], 0
    for k, frame in enumerate(ImageSequence.Iterator(im)):
        fr = ImageOps.exif_transpose(frame.convert("RGB"))
        rec = {"n": k + 1, "text": "", "tables": [], "width": fr.width, "height": fr.height}
        if ocr != "off":
            rec["text"], rec["words"] = _ocr(fr, lang)
            rec["ocr"] = True
            ocr_pages += 1
        pages.append(rec)
        if k >= 199:
            break
    return pages, ocr_pages


def _parse_docx(data: bytes) -> tuple[list, str]:
    import docx
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    d = docx.Document(io.BytesIO(data))
    pages = [{"text": [], "tables": []}]

    def new_page():
        if pages[-1]["text"] or pages[-1]["tables"]:
            pages.append({"text": [], "tables": []})

    first_heading = ""
    for child in d.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            ppr = child.find(qn("w:pPr"))
            rendered = child.find(".//" + qn("w:lastRenderedPageBreak")) is not None
            before = ppr is not None and ppr.find(qn("w:pageBreakBefore")) is not None
            if rendered or before:
                new_page()
            para = Paragraph(child, d)
            text = para.text
            if text.strip():
                pages[-1]["text"].append(text)
                try:
                    style = (para.style.name if para.style is not None else "") or ""
                except Exception:
                    style = ""
                if not first_heading and (style.startswith("Heading") or style == "Title"):
                    first_heading = text.strip()
            hard = any(br.get(qn("w:type")) == "page" for br in child.iter(qn("w:br")))
            section = ppr is not None and ppr.find(qn("w:sectPr")) is not None
            if hard or section:
                new_page()
        elif tag == "tbl":
            rows = _clean_table([[c.text for c in r.cells] for r in Table(child, d).rows])
            if rows:
                pages[-1]["tables"].append(rows)
                pages[-1]["text"].append(_tsv(rows))
    if len(pages) > 1 and not pages[-1]["text"] and not pages[-1]["tables"]:
        pages.pop()
    out = [{"n": i + 1, "text": "\n".join(p["text"]), "tables": p["tables"]} for i, p in enumerate(pages)]
    title = (d.core_properties.title or "").strip() or first_heading
    return out, title


def _parse_pptx(data: bytes) -> tuple[list, str]:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    prs = Presentation(io.BytesIO(data))
    width = round(prs.slide_width / 12700, 2) if prs.slide_width else None  # EMU -> points
    height = round(prs.slide_height / 12700, 2) if prs.slide_height else None

    def walk(shapes):
        for sh in sorted(shapes, key=lambda s: ((s.top or 0), (s.left or 0))):
            try:
                is_group = sh.shape_type == MSO_SHAPE_TYPE.GROUP
            except Exception:  # some graphic frames do not report a shape type
                is_group = False
            if is_group:
                yield from walk(sh.shapes)
            else:
                yield sh

    pages, title = [], (prs.core_properties.title or "").strip()
    for i, slide in enumerate(prs.slides, 1):
        texts, tables = [], []
        for sh in walk(slide.shapes):
            if getattr(sh, "has_table", False) and sh.has_table:
                rows = _clean_table([[c.text for c in r.cells] for r in sh.table.rows])
                if rows:
                    tables.append(rows)
                    texts.append(_tsv(rows))
            elif getattr(sh, "has_text_frame", False) and sh.has_text_frame:
                t = sh.text_frame.text.strip()
                if t:
                    texts.append(t)
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        if not title and slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            title = slide.shapes.title.text_frame.text.strip()
        text = "\n\n".join(texts) + (f"\n\nSpeaker notes:\n{notes}" if notes else "")
        pages.append({"n": i, "text": text.strip(), "tables": tables, "notes": notes, "width": width, "height": height})
    return pages, title


def _cell_str(v) -> str:
    import datetime as dt

    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() and abs(v) < 1e15 else format(v, ".15g")
    return str(v).strip()


def _parse_xlsx(data: bytes) -> tuple[list, str, bool]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    pages, used, truncated = [], 0, False
    try:
        for i, ws in enumerate(wb.worksheets, 1):
            rows = []
            for row in ws.iter_rows(values_only=True):
                vals = [_cell_str(v) for v in row]
                rows.append(vals)
                used += len(vals)
                if used > MAX_TABLE_CELLS:
                    truncated = True
                    break
            rows = _trim_rows(rows)
            pages.append({"n": i, "text": (f"{ws.title}\n" + _tsv(rows)).strip(), "tables": [rows] if rows else [],
                          "sheet": ws.title})
            if truncated:
                break
        title = (wb.properties.title or "").strip() if wb.properties else ""
    finally:
        wb.close()
    return pages, title, truncated


def _parse_csv(data: bytes, name: str) -> tuple[list, bool]:
    import csv

    text = _decode_text(data)
    delimiter = "\t" if name.lower().endswith(".tsv") else None
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:65536], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    rows, used, truncated = [], 0, False
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        rows.append([c.strip() for c in row])
        used += len(row)
        if used > MAX_TABLE_CELLS:
            truncated = True
            break
    rows = _trim_rows(rows)
    return [{"n": 1, "text": _tsv(rows), "tables": [rows] if rows else []}], truncated


def _html_to(html: str) -> tuple[str, str, list]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript", "template"]):
        t.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    tables = []
    for tb in soup.find_all("table"):
        rows = _clean_table([[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])] for tr in tb.find_all("tr")])
        if rows:
            tables.append(rows)
    lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in soup.get_text("\n").splitlines()]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return title, text, tables


def _parse_eml(data: bytes) -> tuple[list, str, list]:
    import email
    from email import policy

    msg = email.message_from_bytes(data, policy=policy.default)
    headers = [(h, str(msg[h])) for h in ("From", "To", "Cc", "Date", "Subject") if msg[h]]
    body, tables = "", []
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is not None:
        try:
            content = part.get_content()
        except Exception:
            content = _decode_text(part.get_payload(decode=True) or b"")
        if part.get_content_type() == "text/html":
            _, body, tables = _html_to(content)
        else:
            body = content
    attachments = [a.get_filename() or "(unnamed attachment)" for a in msg.iter_attachments()]
    text = "\n".join(f"{h}: {v}" for h, v in headers) + "\n\n" + body.strip()
    if attachments:
        text += "\n\nAttachments: " + ", ".join(attachments)
    return [{"n": 1, "text": text.strip(), "tables": tables}], str(msg["Subject"] or ""), attachments


def _parse_msg(data: bytes) -> tuple[list, str, list]:
    import tempfile

    import extract_msg

    with tempfile.NamedTemporaryFile(suffix=".msg") as f:
        f.write(data)
        f.flush()
        m = extract_msg.openMsg(f.name)
        try:
            subject = str(m.subject or "")
            headers = [("From", m.sender), ("To", m.to), ("Cc", m.cc), ("Date", m.date), ("Subject", subject)]
            body, tables = str(m.body or ""), []
            if not body.strip():
                html = getattr(m, "htmlBody", None)
                if html:
                    _, body, tables = _html_to(html.decode("utf-8", "replace") if isinstance(html, bytes) else str(html))
            attachments = []
            for a in m.attachments:
                attachments.append(str(getattr(a, "longFilename", None) or getattr(a, "shortFilename", None)
                                       or getattr(a, "name", None) or "(unnamed attachment)"))
        finally:
            m.close()
    text = "\n".join(f"{h}: {v}" for h, v in headers if v) + "\n\n" + body.strip()
    if attachments:
        text += "\n\nAttachments: " + ", ".join(attachments)
    return [{"n": 1, "text": text.strip(), "tables": tables}], subject, attachments


def _scrub(o):
    """Drop NUL characters (Outlook pads fields with them; Postgres text columns reject them)."""
    if isinstance(o, str):
        return o.replace("\x00", "")
    if isinstance(o, list):
        return [_scrub(v) for v in o]
    if isinstance(o, dict):
        return {k: _scrub(v) for k, v in o.items()}
    return o


def _detect_lang(text: str) -> str:
    sample = text[:20000]
    if sum(ch.isalpha() for ch in sample) < 20:
        return "und"
    from langdetect import DetectorFactory, detect

    DetectorFactory.seed = 0  # deterministic
    try:
        return detect(sample)
    except Exception:
        return "und"


def _docs_parse(inp: dict) -> dict:
    started = time.monotonic()
    deadline = started + TASKS["docs.parse"][3] - 150
    data = _fetch_bytes(inp)
    name, mime = str(inp.get("name") or ""), str(inp.get("mime") or "")
    ocr = str(inp.get("ocr") or "auto").lower()
    if ocr not in ("auto", "force", "off"):
        raise ValueError("ocr must be auto, force or off")
    kind = _sniff_kind(data, mime, name)
    title, ocr_pages, truncated, extra = "", 0, False, {}
    if kind in ("pdf", "image"):
        lang = _ocr_langs(inp.get("ocrLang"))
        if kind == "pdf":
            pages, title, ocr_pages, truncated = _parse_pdf(data, ocr, lang, deadline)
        else:
            pages, ocr_pages = _parse_image(data, ocr, lang)
    elif kind == "docx":
        pages, title = _parse_docx(data)
    elif kind == "pptx":
        pages, title = _parse_pptx(data)
    elif kind == "xlsx":
        pages, title, truncated = _parse_xlsx(data)
    elif kind == "csv":
        pages, truncated = _parse_csv(data, name)
    elif kind == "eml":
        pages, title, extra["attachments"] = _parse_eml(data)
    elif kind == "msg":
        pages, title, extra["attachments"] = _parse_msg(data)
    elif kind == "html":
        title, text, tables = _html_to(_decode_text(data))
        pages = [{"n": 1, "text": text, "tables": tables}]
    else:
        text = _decode_text(data).replace("\r\n", "\n")
        chunks = text.split("\f") if "\f" in text else [text]
        pages = [{"n": i + 1, "text": c.strip(), "tables": []} for i, c in enumerate(chunks)]
        title = next((ln.strip()[:160] for ln in text.splitlines() if ln.strip()), "")
    pages, title, extra = _scrub(pages), _scrub(title or "").strip(), _scrub(extra)
    all_text = "\n\n".join(p["text"] for p in pages)
    lang = _detect_lang(all_text)
    sha = hashlib.sha256(data).hexdigest()
    key = f"ml/parsed/{sha[:40]}{'' if ocr == 'auto' else '-ocr-' + ocr}.json"
    meta = {"pages": len(pages), "lang": lang, "ocrPages": ocr_pages, "title": title or name, "kind": kind,
            "name": name, "mime": mime, "sha256": sha, "bytes": len(data), "truncated": truncated, **extra}
    _put_json(key, {"pages": pages, "meta": meta})
    return {"key": key, "pages": len(pages), "chars": len(all_text), "lang": lang, "ocrPages": ocr_pages,
            "kind": kind, "title": title or name}


# ---------------------------------------------------------------------------------------------
# docs.rerank: cross-encoder relevance of passages to a query (Ettin reranker 32M, ONNX Runtime on CPU)
# ---------------------------------------------------------------------------------------------
RERANK_MAX_PASSAGES = 256
RERANK_BATCH = 16
_RERANK: dict = {}


def _reranker() -> dict:
    """ONNX session, tokenizer and (when the export stops at the encoder, as this one does) the CrossEncoder head:
    CLS pooling, Dense 384->384 + GELU, LayerNorm, Dense 384->1, read from the repo's sentence-transformers modules.
    Scores match sentence-transformers' CrossEncoder to 4 decimals."""
    if _RERANK:
        return _RERANK
    import numpy as np
    import onnxruntime as ort
    from safetensors.numpy import load_file
    from tokenizers import Tokenizer

    so = ort.SessionOptions()
    so.intra_op_num_threads = _hw_threads(TASKS["docs.rerank"][1])
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(f"{RERANK_DIR}/{RERANK_ONNX}", so, providers=["CPUExecutionProvider"])
    out = sess.get_outputs()[0]
    head = None
    if len(out.shape or []) == 3:  # (batch, tokens, hidden): apply the head ourselves

        def tensors(folder: str) -> dict:
            d = load_file(f"{RERANK_DIR}/{folder}/model.safetensors")
            return {k.rsplit(".", 1)[-1]: v.astype(np.float32) for k, v in d.items()}

        head = {"dense": tensors("2_Dense"), "norm": tensors("3_LayerNorm"), "out": tensors("4_Dense")}
    tok = Tokenizer.from_file(f"{RERANK_DIR}/tokenizer.json")
    tok.no_padding()
    _RERANK.update(sess=sess, head=head, tok=tok, output=out.name, inputs=[i.name for i in sess.get_inputs()],
                   pad=tok.token_to_id("[PAD]") or 0, threads=so.intra_op_num_threads)
    return _RERANK


def _rerank_head(h, head: dict):
    import numpy as np

    erf = np.vectorize(math.erf, otypes=[np.float32])
    x = h @ head["dense"]["weight"].T + head["dense"].get("bias", 0.0)
    x = 0.5 * x * (1.0 + erf(x / math.sqrt(2.0)))  # exact GELU, as torch.nn.GELU
    mu, var = x.mean(-1, keepdims=True), x.var(-1, keepdims=True)
    x = (x - mu) / np.sqrt(var + 1e-5) * head["norm"]["weight"] + head["norm"]["bias"]
    return (x @ head["out"]["weight"].T + head["out"].get("bias", 0.0))[:, 0]


def _docs_rerank(inp: dict) -> dict:
    import numpy as np

    query = str(inp.get("query") or "").strip()
    if not query:
        raise ValueError("query must be a non-empty string")
    raw = inp.get("passages")
    if not isinstance(raw, list):
        raise ValueError("passages must be a list of {id, text}")
    if len(raw) > RERANK_MAX_PASSAGES:
        raise ValueError(f"at most {RERANK_MAX_PASSAGES} passages per call (got {len(raw)})")
    ids, texts = [], []
    for i, p in enumerate(raw):
        if isinstance(p, str):
            p = {"id": i, "text": p}
        if not isinstance(p, dict) or not isinstance(p.get("text"), str):
            raise ValueError(f"passage {i} needs a text string")
        ids.append(p.get("id", i))
        texts.append(p["text"])
    max_len = max(32, min(int(inp.get("maxLength") or 512), 2048))
    r = _reranker()
    if not texts:
        return {"scores": [], "model": MODELS["reranker"]["repo"], "maxLength": max_len, "truncated": 0}
    tok = r["tok"]
    tok.enable_truncation(max_length=max_len, strategy="longest_first")
    enc = tok.encode_batch([(query, t) for t in texts])
    truncated = sum(1 for e in enc if e.overflowing)
    order = sorted(range(len(enc)), key=lambda k: len(enc[k].ids))  # similar lengths together: little padding
    scores = np.zeros(len(enc), np.float32)
    for b in range(0, len(order), RERANK_BATCH):
        idx = order[b:b + RERANK_BATCH]
        width = max(len(enc[k].ids) for k in idx)
        ids_arr = np.full((len(idx), width), r["pad"], np.int64)
        mask = np.zeros((len(idx), width), np.int64)
        for row, k in enumerate(idx):
            n = len(enc[k].ids)
            ids_arr[row, :n] = enc[k].ids
            mask[row, :n] = 1
        feeds = {"input_ids": ids_arr, "attention_mask": mask}
        if "token_type_ids" in r["inputs"]:
            feeds["token_type_ids"] = np.zeros_like(ids_arr)
        res = r["sess"].run([r["output"]], {k: v for k, v in feeds.items() if k in r["inputs"]})[0]
        scores[idx] = _rerank_head(res[:, 0, :], r["head"]) if r["head"] is not None else np.asarray(res).reshape(len(idx))
    ranked = sorted(zip(ids, scores.tolist()), key=lambda x: -x[1])
    return {"scores": [{"id": i, "score": round(float(s), 4)} for i, s in ranked], "model": MODELS["reranker"]["repo"],
            "maxLength": max_len, "truncated": truncated}


# ---------------------------------------------------------------------------------------------
# audio.transcribe: ffmpeg -> 16 kHz mono -> Parakeet TDT 0.6B v2 for English (int8 ONNX, Silero VAD segments,
# word timestamps); faster-whisper small (int8) for other languages and whenever Parakeet fails.
# ---------------------------------------------------------------------------------------------
_WHISPER: dict = {}
_PARAKEET: dict = {}
MAX_AUDIO_SECONDS = 2 * 3600  # keeps worst-case transcription inside the 3600 s timeout at a few times real time
LANG_PROBE_SECONDS = 240  # how much audio language detection looks at (Whisper, speech only, 3 windows)
PARAKEET_NAME = "parakeet-tdt-0.6b-v2 (onnx int8)"
WHISPER_NAME = f"faster-whisper-small ({MODELS['whisper']['compute']})"
# Silero pieces for Parakeet: merge pauses under 1.5 s, cap a piece at 30 s. The model sees each piece whole and ends
# it with a full stop, so short pieces (0.5 s pauses) chopped sentences and cost accuracy: Earnings-22 WER 21.3 % with
# 0.5 s against 19.7 % with 1.5 s (Whisper small: 21.3 %); LibriSpeech 3.1 % (Whisper small: 7.2 %).
PARAKEET_VAD = {"min_silence_duration_ms": 1500, "max_speech_duration_s": 30, "speech_pad_ms": 100, "batch_size": 8}
_ABBREV = {"mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "u.s.", "u.k.", "inc.", "co.", "corp.",
           "ltd.", "no.", "jr.", "sr.", "approx.", "dept.", "est.", "fig.", "jan.", "feb.", "aug.", "sept.", "oct.",
           "nov.", "dec."}


_AUDIO_LOCKS = {"whisper": threading.Lock(), "parakeet": threading.Lock()}


def _whisper():
    with _AUDIO_LOCKS["whisper"]:
        if "model" not in _WHISPER:
            from faster_whisper import WhisperModel

            _WHISPER["model"] = WhisperModel(WHISPER_DIR, device="cpu", compute_type="int8", cpu_threads=4,
                                             num_workers=1)
    return _WHISPER["model"]


def _parakeet():
    """Parakeet with Silero VAD segmentation and token timestamps. A failed load is remembered for the container's
    life, so later calls go straight to Whisper."""
    with _AUDIO_LOCKS["parakeet"]:
        if "error" in _PARAKEET:
            raise RuntimeError(_PARAKEET["error"])
        if "asr" not in _PARAKEET:
            try:
                import onnx_asr
                import onnxruntime as ort

                so = ort.SessionOptions()  # ONNX Runtime would otherwise size its pool by the host's 18+ CPUs
                so.intra_op_num_threads = _hw_threads(TASKS["audio.transcribe"][1])  # 8 vs 4 threads: 20 % faster
                so.inter_op_num_threads = 1
                asr = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v2", PARAKEET_DIR, quantization="int8",
                                          sess_options=so)
                vad = onnx_asr.load_vad("silero", SILERO_DIR, sess_options=so)
                _PARAKEET["asr"] = asr.with_vad(vad, **PARAKEET_VAD).with_timestamps()
            except Exception as e:
                _PARAKEET["error"] = _redact(f"Parakeet did not load: {type(e).__name__}: {e}")[:400]
                raise
    return _PARAKEET["asr"]


def _preload(*loaders):
    """Load models in background threads, so a cold start overlaps the download, ffmpeg and the language check;
    the first real use waits on the model's lock. Errors surface (and are handled) at that first use."""
    for fn in loaders:
        threading.Thread(target=lambda f=fn: _quiet(f), daemon=True).start()


def _quiet(fn):
    try:
        fn()
    except Exception:
        pass


def _wav_head(path: str, seconds: float):
    """The first `seconds` of a 16 kHz mono 16-bit WAV as float32 samples."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        frames = w.readframes(int(seconds * w.getframerate()))
    return np.frombuffer(frames, np.int16).astype(np.float32) / 32768.0


def _detect_language(path: str) -> tuple[str, float]:
    """Whisper's language guess on the speech in the first few minutes."""
    model = _whisper()
    audio = _wav_head(path, LANG_PROBE_SECONDS)
    if hasattr(model, "detect_language"):
        lang, prob, _ = model.detect_language(audio=audio, vad_filter=True, language_detection_segments=3)
        return str(lang), float(prob or 0.0)
    _, info = model.transcribe(audio, language=None, vad_filter=True)  # the lazy segments are never decoded
    return str(info.language), float(info.language_probability or 0.0)


def _word_segments(results) -> list:
    """Parakeet's VAD pieces (token start times relative to each piece) to sentence-sized segments with word
    timings: a segment ends at . ? ! (not after a common abbreviation), at a pause of 1.5 s or more, or past 30 s."""
    words = []
    for r in results:
        toks, ts = list(r.tokens or []), list(r.timestamps or [])
        piece = []
        for tok, t in zip(toks, ts):
            at = float(r.start) + float(t)
            if tok.startswith(" ") or not piece:
                piece.append([tok.strip(), at, at])
            else:
                piece[-1][0] += tok
            piece[-1][2] = at
        piece = [w for w in piece if w[0]]
        for k, w in enumerate(piece):  # a word ends where the next starts (tokens carry start times only)
            nxt = piece[k + 1][1] if k + 1 < len(piece) else float(r.end)
            w[2] = round(max(w[2] + 0.08, min(nxt, w[2] + 0.8)), 2)
            w[1] = round(w[1], 2)
        words += piece
    segs, cur = [], []
    for k, w in enumerate(words):
        cur.append(w)
        nxt = words[k + 1] if k + 1 < len(words) else None
        stop = w[0].rstrip("\"')]}").endswith((".", "?", "!")) and w[0].lower().rstrip("\"')]}") not in _ABBREV
        if nxt is None or stop or nxt[1] - w[2] >= 1.5 or w[2] - cur[0][1] >= 30:
            segs.append({"start": cur[0][1], "end": cur[-1][2], "text": " ".join(x[0] for x in cur).strip(),
                         "words": [{"w": x[0], "s": x[1], "e": x[2]} for x in cur]})
            cur = []
    return segs


def _audio_transcribe(inp: dict) -> dict:
    import subprocess
    import tempfile

    language = str(inp.get("language") or "auto").lower()
    engine = str(inp.get("engine") or "auto").lower()  # auto | parakeet | whisper
    if engine not in ("auto", "parakeet", "whisper"):
        raise ValueError("engine must be auto, parakeet or whisper")
    english_first = engine == "parakeet" or (engine == "auto" and language in ("en", "auto"))
    _preload(*((_parakeet,) if english_first else ()), *((_whisper,) if engine != "parakeet" else ()))
    with tempfile.TemporaryDirectory() as tmp:
        src, wav = os.path.join(tmp, "input.bin"), os.path.join(tmp, "audio16k.wav")
        sha, nbytes = _fetch_to_file(inp, src)
        if nbytes == 0:
            raise ValueError("audio input is empty")
        run = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                              "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
                             capture_output=True, text=True, timeout=1200)
        if run.returncode != 0:
            raise ValueError(f"ffmpeg could not decode the audio: {run.stderr.strip()[-400:]}")
        seconds_audio = (os.path.getsize(wav) - 44) / (16000 * 2)
        if seconds_audio > MAX_AUDIO_SECONDS:
            raise ValueError(f"audio is {seconds_audio / 3600:.1f} h long; the limit is {MAX_AUDIO_SECONDS // 3600} h")
        detected, lang_prob, fallback = None, None, None
        use_parakeet = english_first
        if use_parakeet and language == "auto" and engine == "auto":
            try:
                detected, lang_prob = _detect_language(wav)
            except Exception as e:  # cannot tell: let Whisper decide the language as before
                traceback.print_exc()
                fallback = _redact(f"language detection failed: {type(e).__name__}: {e}")[:300]
            use_parakeet = detected == "en" and (lang_prob or 0.0) >= 0.5
        segs, doc = None, None
        if use_parakeet:
            try:
                segs = _word_segments(_parakeet().recognize(wav))
                doc = {"language": "en", "languageProbability": round(lang_prob if lang_prob is not None else 1.0, 4),
                       "duration": round(seconds_audio, 2), "model": PARAKEET_NAME, "engine": "parakeet"}
            except Exception as e:
                traceback.print_exc()
                fallback = _redact(f"parakeet failed: {type(e).__name__}: {e}")[:300]
                segs = None
        if segs is None:
            segments, info = _whisper().transcribe(wav, language=None if language == "auto" else language,
                                                   beam_size=5, vad_filter=True)
            segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
            doc = {"language": info.language, "languageProbability": round(float(info.language_probability or 0), 4),
                   "duration": round(float(info.duration), 2), "model": WHISPER_NAME, "engine": "whisper"}
    # a forced engine gets its own key, so it never overwrites the default transcript of the same audio
    tid = f"{sha[:40]}{'' if language == 'auto' else '-' + language}{'' if engine == 'auto' else '-' + engine}"
    key = f"ml/transcripts/{tid}.json"
    doc = {**doc, "segments": segs, "sha256": sha}
    if detected is not None:
        doc["detected"] = {"language": detected, "probability": round(lang_prob or 0.0, 4)}
    if fallback:
        doc["fallback"] = fallback
    _put_json(key, doc)
    out = {"key": key, "language": doc["language"], "duration": doc["duration"], "segments": len(segs),
           "model": doc["model"], "engine": doc["engine"]}
    if fallback:
        out["fallback"] = fallback
    return out


# ---------------------------------------------------------------------------------------------
# graph.train: relational GraphSAGE link prediction for M&A (acquirer -> target), rolling time snapshots
# ---------------------------------------------------------------------------------------------
GRAPH_HIDDEN = 64
GRAPH_LAYERS = 2
GRAPH_RANK = 16  # width of the acquirer/target bilinear projections
GRAPH_DROPOUT = 0.3
GRAPH_LR = 0.01
GRAPH_WEIGHT_DECAY = 3e-3
# Passes over the time windows. Chosen on the synthetic test graph: with this regularisation the backtest is flat
# between ~20 and 40 epochs; validation-based early stopping on the latest window was noisier than a fixed count.
GRAPH_DEFAULT_EPOCHS = 40
GRAPH_MAX_WINDOWS = 10
GRAPH_TRAIN_BUDGET = 400.0  # seconds per training run (backtest model, final model)
GRAPH_NEG_PER_POS = 5


def _rank_summary(ranks) -> dict:
    import numpy as np

    r = np.asarray(ranks, float)
    if r.size == 0:
        return {"hits5": None, "hits10": None, "mrr": None, "n": 0}
    return {"hits5": round(float((r <= 5).mean()), 4), "hits10": round(float((r <= 10).mean()), 4),
            "mrr": round(float((1.0 / r).mean()), 4), "n": int(r.size)}


def _graph_train(inp: dict) -> dict:
    """Relational GraphSAGE link prediction trained on rolling time snapshots.

    Every training example is "the graph as it stood at cut c" -> "deals announced after c": the snapshot holds only
    edges dated before c (undated edges are treated as always known) and only deals before c. That is exactly the
    backtest setting, and it keeps consequences of a deal (a new ownership edge, new board seats) out of the graph
    the model learns that deal from."""
    import datetime as dt

    import numpy as np
    import scipy.sparse as sp
    import torch
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from torch import nn
    from torch.nn import functional as F
    from torch_geometric.nn import SAGEConv

    t_start = time.monotonic()
    torch.set_num_threads(2)
    seed = int(inp.get("seed") or 0)
    torch.manual_seed(seed)
    # On the GPU task the model trains on CUDA, wider and for longer (the caller sets hidden, epochs and the budget);
    # everywhere else these are the CPU defaults, so the weekly retraining is unchanged.
    dev = torch.device("cuda" if inp.get("gpu") and torch.cuda.is_available() else "cpu")
    hidden = max(16, min(int(inp.get("hidden") or GRAPH_HIDDEN), 512))
    budget_s = max(60.0, min(float(inp.get("budgetSeconds") or GRAPH_TRAIN_BUDGET), 1500.0))
    rng = np.random.default_rng(seed)
    top_k = max(1, min(int(inp.get("topK") or 20), 200))
    g = _load_json_ref(inp, "graphKey")
    nodes, edges, deals = g.get("nodes") or [], g.get("edges") or [], g.get("deals") or []
    if not nodes:
        raise ValueError("graph has no nodes")

    ids = [int(n["id"]) for n in nodes]
    if len(set(ids)) != len(ids):
        raise ValueError("node ids must be unique")
    index = {nid: i for i, nid in enumerate(ids)}
    N = len(ids)
    kinds = [str(n.get("kind") or "company") for n in nodes]
    kind_names = sorted(set(kinds) | {"company"})
    kind_idx = np.array([kind_names.index(k) for k in kinds], np.int64)
    fdim = max((len(n.get("features") or []) for n in nodes), default=0) or 1
    X = np.zeros((N, fdim), np.float32)
    for i, n in enumerate(nodes):
        f = np.nan_to_num(np.asarray(n.get("features") or [], np.float32), nan=0.0, posinf=0.0, neginf=0.0)
        X[i, :f.size] = f[:fdim]
    f_mean, f_std = X.mean(0), X.std(0) + 1e-6
    Xs = np.clip((X - f_mean) / f_std, -8, 8).astype(np.float32)

    comp = np.nonzero(kind_idx == kind_names.index("company"))[0]
    C = comp.size
    if C < 3:
        raise ValueError("need at least 3 company nodes")
    cpos = -np.ones(N, np.int64)
    cpos[comp] = np.arange(C)

    E = []
    for e in edges:
        s, d = index.get(int(e["s"])), index.get(int(e["d"]))
        if s is None or d is None or s == d:
            continue
        E.append((s, d, str(e.get("kind") or "link"), (str(e.get("t"))[:10] if e.get("t") else None)))
    edge_kinds = sorted({k for _, _, k, _ in E})
    E_src = np.array([s for s, _, _, _ in E], np.int64)
    E_dst = np.array([d for _, d, _, _ in E], np.int64)
    E_kind = np.array([edge_kinds.index(k) for _, _, k, _ in E], np.int64)
    E_t = [t for _, _, _, t in E]

    D, dropped = [], 0
    for x in deals:
        a, b = index.get(int(x["acquirer"])), index.get(int(x["target"]))
        t = str(x.get("t") or "")[:10]
        if a is None or b is None or a == b or cpos[a] < 0 or cpos[b] < 0 or not t:
            dropped += 1
            continue
        D.append((a, b, t))
    D.sort(key=lambda r: r[2])
    if len(D) < 8:
        raise ValueError("need at least 8 dated company-to-company deals")
    D_pairs = np.array([(a, b) for a, b, _ in D], np.int64)
    split = str(inp.get("splitDate") or D[int(len(D) * 0.8)][2])[:10]
    pre_idx = [k for k, (_, _, t) in enumerate(D) if t < split]
    test_pairs = D_pairs[[k for k, (_, _, t) in enumerate(D) if t >= split]].reshape(-1, 2)
    if len(pre_idx) < 6:
        raise ValueError(f"need at least 6 deals before splitDate {split}")
    all_d = D_pairs

    rel_keys = [f"f{j}" for j in range(len(edge_kinds))] + [f"r{j}" for j in range(len(edge_kinds))] + ["fD", "rD"]
    npair = len(kind_names) + 1  # common neighbours by kind of the shared node, plus a direct link
    xt, kt = torch.from_numpy(Xs).to(dev), torch.from_numpy(kind_idx).to(dev)

    def T(a: np.ndarray) -> torch.Tensor:
        return torch.from_numpy(np.asarray(a, np.int64)).to(dev)

    def ei(src: np.ndarray, dst: np.ndarray) -> torch.Tensor:
        return torch.from_numpy(np.stack([src, dst]).astype(np.int64)).reshape(2, -1)

    def build_snapshot(cut: str | None) -> dict:
        """The graph as known before `cut` (None = everything)."""
        emask = np.array([cut is None or t is None or t < cut for t in E_t], bool)
        eidx = {}
        for j in range(len(edge_kinds)):
            sel = emask & (E_kind == j)
            eidx[f"f{j}"], eidx[f"r{j}"] = ei(E_src[sel], E_dst[sel]), ei(E_dst[sel], E_src[sel])
        dsel = np.array([cut is None or t < cut for _, _, t in D], bool)
        dp = D_pairs[dsel].reshape(-1, 2)
        eidx["fD"], eidx["rD"] = ei(dp[:, 0], dp[:, 1]), ei(dp[:, 1], dp[:, 0])
        deg = np.zeros((N, len(rel_keys)), np.float32)  # in-degree per relation: how active each node is
        for r_i, r in enumerate(rel_keys):
            np.add.at(deg[:, r_i], eidx[r][1].numpy(), 1.0)
        src = np.concatenate([E_src[emask], E_dst[emask]])
        dst = np.concatenate([E_dst[emask], E_src[emask]])
        A = sp.csr_matrix((np.ones(src.size, np.float32), (src, dst)), shape=(N, N))
        A.data[:] = 1.0
        A_c = A[comp]
        B = [A_c[:, np.nonzero(kind_idx == k)[0]].tocsr() for k in range(len(kind_names))]
        return {"eidx": {k: v.to(dev) for k, v in eidx.items()}, "deg": torch.from_numpy(np.log1p(deg)).to(dev), "B": B,
                "BT": [b.T.tocsr() for b in B], "Acc": A_c[:, comp].tocsr()}

    def make_windows(idx: list) -> list:
        """Split time-ordered deals into up to GRAPH_MAX_WINDOWS windows after a 30 % warm-up of history:
        each window = (snapshot at the window's first deal date, the window's deals as positives)."""
        n = len(idx)
        K = int(min(GRAPH_MAX_WINDOWS, max(2, n // 25)))
        bounds = [int(round(n * (0.3 + 0.7 * i / K))) for i in range(K + 1)]
        out = []
        for i in range(K):
            lo, hi = bounds[i], bounds[i + 1]
            if hi > lo:
                snap, sup = build_snapshot(D[idx[lo]][2]), D_pairs[idx[lo:hi]]
                out.append((snap, sup, pair_feats(snap, sup[:, 0], sup[:, 1])))
        return out

    def pair_feats(snap: dict, a_nodes: np.ndarray, b_nodes: np.ndarray) -> torch.Tensor:
        ap, bp = cpos[a_nodes], cpos[b_nodes]
        cols = [np.log1p(np.asarray(b[ap].multiply(b[bp]).sum(1)).ravel()) for b in snap["B"]]
        cols.append(np.asarray(snap["Acc"][ap, bp]).ravel())
        return torch.from_numpy(np.stack(cols, 1).astype(np.float32)).to(dev)

    def pair_block(snap: dict, rows_c: np.ndarray) -> torch.Tensor:
        """Pair features of company positions rows_c against every company: (r, C, npair). Symmetric."""
        cols = [np.log1p((b[rows_c] @ bt).toarray()) for b, bt in zip(snap["B"], snap["BT"])]
        cols.append(snap["Acc"][rows_c].toarray())
        return torch.from_numpy(np.stack(cols, -1).astype(np.float32)).to(dev)

    class RelSAGE(nn.Module):
        """GraphSAGE with one mean-aggregating SAGEConv per relation (edge kind x direction, plus deals), node-kind
        embedding and per-relation degree inputs; decoder = asymmetric bilinear acquirer/target score + role biases
        + a learned weight on neighbourhood overlap."""

        def __init__(self):
            super().__init__()
            H = hidden
            self.inp = nn.Linear(fdim + len(rel_keys), H)
            self.kind = nn.Embedding(len(kind_names), H)
            self.convs = nn.ModuleList([nn.ModuleDict({r: SAGEConv(H, H, aggr="mean", root_weight=False)
                                                       for r in rel_keys}) for _ in range(GRAPH_LAYERS)])
            self.selfs = nn.ModuleList([nn.Linear(H, H) for _ in range(GRAPH_LAYERS)])
            self.norms = nn.ModuleList([nn.LayerNorm(H) for _ in range(GRAPH_LAYERS)])
            self.P = nn.Linear(H, GRAPH_RANK, bias=False)
            self.Q = nn.Linear(H, GRAPH_RANK, bias=False)
            self.wa = nn.Linear(H, 1)
            self.wb = nn.Linear(H, 1, bias=False)
            self.pair = nn.Linear(npair, 1, bias=False)

        def encode(self, snap: dict) -> torch.Tensor:
            h = self.inp(torch.cat([xt, snap["deg"]], 1)) + self.kind(kt)
            for convs, lin, norm in zip(self.convs, self.selfs, self.norms):
                out = lin(h)
                for r, conv in convs.items():
                    e = snap["eidx"].get(r)
                    if e is not None and e.numel():
                        out = out + conv(h, e)
                h = F.dropout(F.relu(norm(out)), GRAPH_DROPOUT, self.training)
            return h

        def score(self, h, a, b, pf) -> torch.Tensor:
            ha, hb = h[a], h[b]
            return ((self.P(ha) * self.Q(hb)).sum(-1) + self.wa(ha).squeeze(-1) + self.wb(hb).squeeze(-1)
                    + self.pair(pf).squeeze(-1))

    def gnn_scores(model, snap: dict, rows_nodes: np.ndarray, as_target: bool) -> np.ndarray:
        """as_target=True: row i = s(rows[i] -> every company); False: s(every company -> rows[i])."""
        model.eval()
        with torch.no_grad():
            h = model.encode(snap)
            hc = h[T(comp)]
            HP, HQ = model.P(hc), model.Q(hc)
            wa, wb = model.wa(hc).squeeze(-1), model.wb(hc).squeeze(-1)
            out = []
            rows_c = cpos[np.asarray(rows_nodes, np.int64)]
            for s in range(0, len(rows_c), 256):
                r = rows_c[s:s + 256]
                rt = T(r)
                if as_target:
                    emb = HP[rt] @ HQ.T + wa[rt][:, None] + wb[None, :]
                else:
                    emb = HQ[rt] @ HP.T + wb[rt][:, None] + wa[None, :]
                out.append((emb + model.pair(pair_block(snap, r)).squeeze(-1)).cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, C), np.float32)

    by_acq, by_tgt = {}, {}
    for a, b in all_d:
        by_acq.setdefault(int(a), set()).add(int(b))
        by_tgt.setdefault(int(b), set()).add(int(a))

    def ranks_for(score_fn, pairs: np.ndarray) -> tuple[list, list]:
        """Filtered ranks: the real target among all companies for the real acquirer, and the real acquirer among
        all companies for the real target; other real deals of the anchor are not counted as misses."""
        rt, ra = [], []
        if len(pairs) == 0:
            return rt, ra
        S_t, S_a = score_fn(pairs[:, 0], True), score_fn(pairs[:, 1], False)
        for i, (a, b) in enumerate(pairs):
            for S, anchor, truth, others, ranks in ((S_t, a, b, by_acq.get(int(a), set()), rt),
                                                    (S_a, b, a, by_tgt.get(int(b), set()), ra)):
                s = S[i]
                mask = np.ones(C, bool)
                mask[cpos[anchor]] = False
                for o in others:
                    if o != truth:
                        mask[cpos[o]] = False
                true = s[cpos[truth]]
                ranks.append(1 + float((s[mask] > true).sum()) + 0.5 * float((s[mask] == true).sum() - 1))
        return rt, ra

    def summarize(rt, ra) -> dict:
        out = _rank_summary(rt + ra)
        out["asTarget"], out["asAcquirer"] = _rank_summary(rt), _rank_summary(ra)
        return out

    def negatives(sup: np.ndarray) -> np.ndarray:
        a = np.repeat(sup[:, 0], GRAPH_NEG_PER_POS)
        b = np.repeat(sup[:, 1], GRAPH_NEG_PER_POS)
        neg = np.concatenate([np.stack([a, comp[rng.integers(0, C, a.size)]], 1),
                              np.stack([comp[rng.integers(0, C, b.size)], b], 1)])
        return neg[neg[:, 0] != neg[:, 1]]

    def fit(windows: list, epochs: int, budget: float = budget_s):
        model = RelSAGE().to(dev)
        opt = torch.optim.Adam(model.parameters(), lr=GRAPH_LR, weight_decay=GRAPH_WEIGHT_DECAY)
        t0, ep = time.monotonic(), 0
        for ep in range(1, epochs + 1):
            model.train()
            for wi in rng.permutation(len(windows)):
                snap, sup, pf_sup = windows[wi]
                h = model.encode(snap)
                neg = negatives(sup)
                pos_logit = model.score(h, T(sup[:, 0]), T(sup[:, 1]), pf_sup)
                neg_logit = model.score(h, T(neg[:, 0]), T(neg[:, 1]),
                                        pair_feats(snap, neg[:, 0], neg[:, 1]))
                loss = (F.binary_cross_entropy_with_logits(pos_logit, torch.ones_like(pos_logit))
                        + F.binary_cross_entropy_with_logits(neg_logit, torch.zeros_like(neg_logit)))
                opt.zero_grad()
                loss.backward()
                opt.step()
            if time.monotonic() - t0 > budget:
                break
        return model, ep

    epochs = max(1, min(int(inp.get("epochs") or GRAPH_DEFAULT_EPOCHS), 1000))
    # ---- backtest: train on the pre-split windows, rank deals on/after splitDate from the split snapshot
    pre_windows = make_windows(pre_idx)
    model_bt, epochs_bt = fit(pre_windows, epochs)
    snap_split = build_snapshot(split)
    rt, ra = ranks_for(lambda rows, tgt: gnn_scores(model_bt, snap_split, rows, tgt), test_pairs)
    gnn_metrics = summarize(rt, ra)

    # ---- features-only baseline: logistic regression on the two nodes' features, same pre-split deals
    def pair_x(a_nodes, b_nodes):
        fa, fb = Xs[a_nodes], Xs[b_nodes]
        return np.concatenate([fa, fb, fa * fb, np.abs(fa - fb)], 1)

    train_pairs = D_pairs[pre_idx]
    neg = negatives(train_pairs)
    Xtr = np.concatenate([pair_x(train_pairs[:, 0], train_pairs[:, 1]), pair_x(neg[:, 0], neg[:, 1])])
    ytr = np.concatenate([np.ones(len(train_pairs)), np.zeros(len(neg))])
    scaler = StandardScaler().fit(Xtr)
    lr = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced").fit(scaler.transform(Xtr), ytr)

    def lr_scores(rows_nodes, as_target):
        out = []
        for r in rows_nodes:
            anchor = np.full(C, r)
            px = pair_x(anchor, comp) if as_target else pair_x(comp, anchor)
            out.append(lr.decision_function(scaler.transform(px)))
        return np.asarray(out)

    rt, ra = ranks_for(lr_scores, test_pairs)
    base_metrics = summarize(rt, ra)

    # ---- final model on every window, predictions from the full graph
    model, epochs_final = fit(make_windows(list(range(len(D)))), epochs)
    snap_all = build_snapshot(None)
    done_t, done_a = {}, {}  # completed deals are not predicted again
    for x, y in all_d:
        done_t.setdefault(int(x), []).append(int(cpos[y]))
        done_a.setdefault(int(y), []).append(int(cpos[x]))
    targets, acquirers = {}, {}
    for s in range(0, C, 512):
        rows = comp[s:s + 512]
        for as_target, dest, done in ((True, targets, done_t), (False, acquirers, done_a)):
            S = 1 / (1 + np.exp(-np.clip(gnn_scores(model, snap_all, rows, as_target), -50, 50)))
            for i, r in enumerate(rows):
                sc = S[i].copy()
                sc[cpos[r]] = -1.0
                sc[done.get(int(r), [])] = -1.0
                kth = min(top_k, C - 1)
                order = np.argpartition(-sc, kth - 1)[:kth] if kth > 0 else np.zeros(0, np.int64)
                order = order[np.argsort(-sc[order])]
                dest[str(ids[r])] = [[ids[int(comp[c])], round(float(sc[c]), 4)] for c in order if sc[c] >= 0]

    version = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model_key, pred_key = f"ml/models/gnn-{version}.pt", f"ml/predictions/{version}.json"
    buf = io.BytesIO()
    torch.save({"state_dict": {k: v.cpu() for k, v in model.state_dict().items()}, "version": version, "nodeIds": ids, "kinds": kind_names,
                "edgeKinds": edge_kinds, "relations": rel_keys, "featMean": f_mean.tolist(), "featStd": f_std.tolist(),
                "config": {"hidden": hidden, "layers": GRAPH_LAYERS, "rank": GRAPH_RANK, "features": fdim,
                           "pairFeatures": npair, "epochs": epochs_final}}, buf)
    _r2_put(model_key, buf.getvalue(), "application/octet-stream")
    _put_json(pred_key, {"version": version, "topK": top_k, "splitDate": split, "acquirers": acquirers,
                         "targets": targets, "metrics": {"gnn": gnn_metrics, "baseline": base_metrics}})
    info = {"splitDate": split, "nodes": N, "companies": int(C), "edges": len(E), "edgeKinds": edge_kinds,
            "deals": len(D), "trainDeals": len(pre_idx), "testDeals": int(len(test_pairs)), "droppedDeals": dropped,
            "windows": len(pre_windows), "epochs": epochs, "epochsRun": [epochs_bt, epochs_final],
            "device": dev.type, "hidden": hidden,
            "trainSeconds": round(time.monotonic() - t_start, 1)}
    return {"version": version, "modelKey": model_key, "predictionsKey": pred_key,
            "metrics": {"gnn": gnn_metrics, "baseline": base_metrics}, "info": info}


# ---------------------------------------------------------------------------------------------
# synth.tabular: compact CTGAN-style GAN (own implementation; no sdv / ctgan packages)
# ---------------------------------------------------------------------------------------------
SYNTH_TAB_STEPS_PER_EPOCH = 8  # small tables get smaller batches so every epoch still makes several updates
# Off by default (plain CTGAN): fitting heavy-tailed positive columns in log space helped some columns and hurt others
# on the smoke table. Set a skewness threshold (e.g. 2.0) to turn it on.
SYNTH_TAB_LOG_SKEW = None


def _to_float(v) -> float:
    if v is None or isinstance(v, bool):
        return float(v) if isinstance(v, bool) else float("nan")
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _synth_tabular(inp: dict) -> dict:
    import random
    import warnings
    from collections import Counter

    import numpy as np
    import torch
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.mixture import BayesianGaussianMixture
    from torch import nn
    from torch.nn import functional as F

    t_start = time.monotonic()
    seed = int(inp.get("seed") or 0)
    epochs = max(1, min(int(inp.get("epochs") or 300), 5000))
    n_out = max(1, min(int(inp.get("n") or 1000), 200_000))
    data = _load_json_ref(inp, "dataKey")
    rows = data.get("rows") if isinstance(data, dict) else data
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        raise ValueError("dataKey must hold a JSON array of row objects (or {\"rows\": [...]})")
    columns = inp.get("columns")
    if not columns:
        names = list(rows[0].keys())
        columns = [{"name": c, "type": "num" if all(isinstance(r.get(c), (int, float)) and not isinstance(r.get(c), bool)
                                                    for r in rows[:500] if r.get(c) is not None) else "cat"}
                   for c in names]
    columns = [{"name": str(c["name"]), "type": "num" if c.get("type") == "num" else "cat"} for c in columns]
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    rng = np.random.default_rng(seed)
    N = len(rows)

    # ---- mode-specific normalization + one-hot encoding
    parts, spans, blocks, conds = [], [], [], []
    pos = 0

    def add_onehot(idx: np.ndarray, K: int, conditional: bool) -> int:
        nonlocal pos
        oh = np.zeros((N, K), np.float32)
        oh[np.arange(N), idx] = 1
        parts.append(oh)
        spans.append((pos, K, "softmax"))
        if conditional:
            freq = np.bincount(idx, minlength=K).astype(float)
            conds.append({"start": pos, "dim": K, "freq": freq, "rows": [np.nonzero(idx == k)[0] for k in range(K)]})
        pos += K
        return pos - K

    for col in columns:
        name = col["name"]
        raw = [r.get(name) for r in rows]
        if col["type"] == "num":
            vals = np.array([_to_float(v) for v in raw], float)
            miss = ~np.isfinite(vals)
            ok = vals[~miss]
            if ok.size == 0:
                blocks.append({"kind": "null", "name": name})
                continue
            vals = np.where(miss, np.median(ok), vals)
            lo, hi = float(ok.min()), float(ok.max())
            integer = bool(np.all(np.mod(ok[:5000], 1) == 0))
            n_unique = len(np.unique(ok[:20000]))
            logged = False
            if SYNTH_TAB_LOG_SKEW is not None and lo > 0 and ok.size > 10:
                zs = (ok - ok.mean()) / (ok.std() + 1e-12)
                if float((zs ** 3).mean()) > SYNTH_TAB_LOG_SKEW:  # heavy right tail: fit the mixture on log values
                    logged, ok, vals = True, np.log(ok), np.log(vals)
            span = float(ok.max() - ok.min())
            if n_unique > 1:
                bgm = BayesianGaussianMixture(n_components=min(10, n_unique), weight_concentration_prior_type="dirichlet_process",
                                              weight_concentration_prior=0.001, max_iter=200, n_init=1, random_state=seed)
                fit_vals = ok if ok.size <= 20000 else rng.choice(ok, 20000, replace=False)
                with warnings.catch_warnings():  # a few non-converged EM runs are expected and harmless here
                    warnings.simplefilter("ignore", ConvergenceWarning)
                    bgm.fit(fit_vals.reshape(-1, 1))
                keep = bgm.weights_ > 0.005
                means = bgm.means_.reshape(-1)[keep]
                stds = np.sqrt(bgm.covariances_.reshape(-1)[keep])
                probs = bgm.predict_proba(vals.reshape(-1, 1))[:, keep]
            else:
                means, stds, probs = np.array([float(ok.min())]), np.array([1.0]), np.ones((N, 1))
            stds = np.maximum(stds, 1e-6 * max(1.0, span))
            probs = probs + 1e-6
            probs /= probs.sum(1, keepdims=True)
            modes = np.minimum((probs.cumsum(1) < rng.random(N)[:, None]).sum(1), len(means) - 1)
            alpha = np.clip((vals - means[modes]) / (4 * stds[modes]), -0.99, 0.99)
            parts.append(alpha[:, None].astype(np.float32))
            spans.append((pos, 1, "tanh"))
            a_start = pos
            pos += 1
            m_start = add_onehot(modes, len(means), False)
            blk = {"kind": "num", "name": name, "alpha": a_start, "mode": m_start, "K": len(means), "means": means,
                   "stds": stds, "lo": lo, "hi": hi, "integer": integer, "log": logged}
            if miss.any():
                blk["missing"] = add_onehot(miss.astype(np.int64), 2, True)
            blocks.append(blk)
        else:
            keys = [json.dumps(v, sort_keys=True, default=str) for v in raw]
            cats = [k for k, _ in Counter(keys).most_common()]
            lookup = {k: i for i, k in enumerate(cats)}
            idx = np.array([lookup[k] for k in keys], np.int64)
            start = add_onehot(idx, len(cats), True)
            blocks.append({"kind": "cat", "name": name, "start": start, "dim": len(cats), "values": [json.loads(k) for k in cats]})
    if not parts:
        raise ValueError("no usable columns")
    X = torch.from_numpy(np.concatenate(parts, 1).astype(np.float32))
    dim = X.shape[1]

    # ---- conditional vector with training-by-sampling
    n_cond = len(conds)
    cdim = sum(c["dim"] for c in conds)
    c_off = np.cumsum([0] + [c["dim"] for c in conds])[:-1] if n_cond else np.zeros(0, np.int64)
    p_log = [np.log(c["freq"] + 1) / np.log(c["freq"] + 1).sum() for c in conds]
    p_raw = [c["freq"] / c["freq"].sum() for c in conds]

    def sample_cond(B: int, train: bool):
        if not n_cond:
            return None, None, None, None
        col = rng.integers(0, n_cond, B)
        cat = np.zeros(B, np.int64)
        for j in range(n_cond):
            sel = np.nonzero(col == j)[0]
            if sel.size:
                cat[sel] = rng.choice(conds[j]["dim"], size=sel.size, p=(p_log if train else p_raw)[j])
        cond = np.zeros((B, cdim), np.float32)
        cond[np.arange(B), c_off[col] + cat] = 1
        mask = np.zeros((B, n_cond), np.float32)
        mask[np.arange(B), col] = 1
        return torch.from_numpy(cond), torch.from_numpy(mask), col, cat

    def sample_rows(col, cat) -> np.ndarray:
        return np.array([conds[j]["rows"][k][rng.integers(0, conds[j]["rows"][k].size)] for j, k in zip(col, cat)])

    def join(a, b):
        return a if b is None else torch.cat([a, b], 1)

    def activate(raw: torch.Tensor, hard: bool = False) -> torch.Tensor:
        out = []
        for st, d, act in spans:
            seg = raw[:, st:st + d]
            if act == "tanh":
                out.append(torch.tanh(seg))
            elif hard:
                out.append(F.one_hot(seg.argmax(1), d).float())
            else:
                out.append(F.gumbel_softmax(seg, tau=0.2, hard=False))
        return torch.cat(out, 1)

    def cond_loss(raw, cond, mask):
        losses = []
        for j, c in enumerate(conds):
            target = cond[:, c_off[j]:c_off[j] + c["dim"]].argmax(1)
            losses.append(F.cross_entropy(raw[:, c["start"]:c["start"] + c["dim"]], target, reduction="none"))
        return (torch.stack(losses, 1) * mask).sum() / raw.size(0)

    class Residual(nn.Module):
        def __init__(self, i, o):
            super().__init__()
            self.fc, self.bn = nn.Linear(i, o), nn.BatchNorm1d(o)

        def forward(self, x):
            return torch.cat([F.relu(self.bn(self.fc(x))), x], 1)

    class Generator(nn.Module):
        def __init__(self, i, hidden, o):
            super().__init__()
            layers, d = [], i
            for h in hidden:
                layers.append(Residual(d, h))
                d += h
            layers.append(nn.Linear(d, o))
            self.seq = nn.Sequential(*layers)

        def forward(self, x):
            return self.seq(x)

    class Discriminator(nn.Module):
        def __init__(self, i, hidden, pac):
            super().__init__()
            self.pac, self.pacdim = pac, i * pac
            layers, d = [], i * pac
            for h in hidden:
                layers += [nn.Linear(d, h), nn.LeakyReLU(0.2), nn.Dropout(0.5)]
                d = h
            layers.append(nn.Linear(d, 1))
            self.seq = nn.Sequential(*layers)

        def forward(self, x):
            return self.seq(x.reshape(-1, self.pacdim))

        def penalty(self, real, fake, lam=10.0):
            alpha = torch.rand(real.size(0) // self.pac, 1, 1).repeat(1, self.pac, real.size(1)).reshape(-1, real.size(1))
            mix = (alpha * real + (1 - alpha) * fake).requires_grad_(True)
            out = self(mix)
            grad = torch.autograd.grad(out, mix, torch.ones_like(out), create_graph=True, retain_graph=True)[0]
            return ((grad.reshape(-1, self.pacdim).norm(2, dim=1) - 1) ** 2).mean() * lam

    pac = 10 if N >= 20 else 1
    B = max(pac, min(500, max((N // SYNTH_TAB_STEPS_PER_EPOCH) // pac * pac, pac * 5), (N // pac) * pac))
    zdim = 128
    G = Generator(zdim + cdim, (256, 256), dim)
    Dn = Discriminator(dim + cdim, (256, 256), pac)
    optG = torch.optim.Adam(G.parameters(), lr=2e-4, betas=(0.5, 0.9), weight_decay=1e-6)
    optD = torch.optim.Adam(Dn.parameters(), lr=2e-4, betas=(0.5, 0.9), weight_decay=1e-6)
    steps = max(1, N // B)
    budget = TASKS["synth.tabular"][3] - 240
    epochs_run = 0
    for _ in range(epochs):
        for _ in range(steps):
            z = torch.randn(B, zdim)
            cond, _, col, cat = sample_cond(B, True)
            if cond is None:
                real, c_real = X[torch.from_numpy(rng.integers(0, N, B))], None
            else:
                perm = rng.permutation(B)
                real = X[torch.from_numpy(sample_rows(col[perm], cat[perm]))]
                c_real = cond[torch.from_numpy(perm)]
            fake = activate(G(join(z, cond))).detach()
            fake_in, real_in = join(fake, cond), join(real, c_real)
            loss_d = -(Dn(real_in).mean() - Dn(fake_in).mean()) + Dn.penalty(real_in, fake_in)
            optD.zero_grad()
            loss_d.backward()
            optD.step()

            z = torch.randn(B, zdim)
            cond, mask, _, _ = sample_cond(B, True)
            raw = G(join(z, cond))
            loss_g = -Dn(join(activate(raw), cond)).mean()
            if cond is not None:
                loss_g = loss_g + cond_loss(raw, cond, mask)
            optG.zero_grad()
            loss_g.backward()
            optG.step()
        epochs_run += 1
        if time.monotonic() - t_start > budget:
            break

    # ---- sample and invert the transform
    G.eval()
    outs = []
    with torch.no_grad():
        for s in range(0, n_out, B):
            b = min(B, n_out - s)
            cond = sample_cond(b, False)[0]
            outs.append(activate(G(join(torch.randn(b, zdim), cond)), hard=True).numpy())
    Y = np.concatenate(outs)
    cols_out = {}
    for blk in blocks:
        if blk["kind"] == "null":
            cols_out[blk["name"]] = [None] * n_out
        elif blk["kind"] == "cat":
            k = Y[:, blk["start"]:blk["start"] + blk["dim"]].argmax(1)
            cols_out[blk["name"]] = [blk["values"][i] for i in k]
        else:
            alpha = np.clip(Y[:, blk["alpha"]], -1, 1)
            k = Y[:, blk["mode"]:blk["mode"] + blk["K"]].argmax(1)
            v = alpha * 4 * blk["stds"][k] + blk["means"][k]
            v = np.clip(np.exp(np.minimum(v, 700)) if blk["log"] else v, blk["lo"], blk["hi"])
            vals = [int(round(x)) for x in v] if blk["integer"] else [round(float(x), 6) for x in v]
            if "missing" in blk:
                gone = Y[:, blk["missing"]:blk["missing"] + 2].argmax(1) == 1
                vals = [None if g else x for g, x in zip(gone, vals)]
            cols_out[blk["name"]] = vals
    names = [c["name"] for c in columns]
    synth_rows = [{c: cols_out[c][i] for c in names} for i in range(n_out)]

    # ---- fidelity summary (real vs synthetic)
    quality = {}
    for blk in blocks:
        name = blk["name"]
        if blk["kind"] == "num":
            r = np.array([_to_float(x[name]) for x in rows])
            s_ = np.array([_to_float(x) for x in cols_out[name]])
            r, s_ = r[np.isfinite(r)], s_[np.isfinite(s_)]
            q = {"realMean": float(r.mean()), "realStd": float(r.std()), "realMedian": float(np.median(r)),
                 "realP90": float(np.quantile(r, 0.9))}
            if s_.size:
                grid = np.sort(np.concatenate([r, s_]))  # two-sample Kolmogorov-Smirnov statistic
                ks = np.abs(np.searchsorted(np.sort(r), grid, "right") / r.size
                            - np.searchsorted(np.sort(s_), grid, "right") / s_.size).max()
                q.update(synthMean=float(s_.mean()), synthStd=float(s_.std()), synthMedian=float(np.median(s_)),
                         synthP90=float(np.quantile(s_, 0.9)), ks=round(float(ks), 4))
            quality[name] = q
        elif blk["kind"] == "cat":
            rc = Counter(json.dumps(x.get(name), sort_keys=True, default=str) for x in rows)
            sc = Counter(json.dumps(x, sort_keys=True, default=str) for x in cols_out[name])
            tv = 0.5 * sum(abs(rc[k] / N - sc[k] / n_out) for k in set(rc) | set(sc))
            quality[name] = {"totalVariation": round(tv, 4)}
    recipe = {"model": "ctgan-style GAN (own PyTorch implementation): mode-specific normalization with "
                       "BayesianGaussianMixture, conditional generator with training-by-sampling, PacGAN WGAN-GP critic",
              "epochs": epochs, "epochsRun": epochs_run, "batch": B, "pac": pac, "zdim": zdim, "generator": [256, 256],
              "discriminator": [256, 256], "lr": 2e-4, "gumbelTau": 0.2, "gpLambda": 10.0, "dataKey": inp.get("dataKey"),
              "trainRows": N, "columns": columns, "modes": {b["name"]: b["K"] for b in blocks if b["kind"] == "num"},
              "logColumns": [b["name"] for b in blocks if b.get("log")],
              "trainSeconds": round(time.monotonic() - t_start, 1)}
    sid = _digest(inp.get("dataKey"), inp.get("parts"), columns, n_out, seed, epochs)[:24]
    key = f"ml/synthetic/tab-{sid}.json"
    _put_json(key, {"columns": columns, "rows": synth_rows, "n": n_out, "seed": seed, "recipe": recipe, "quality": quality})
    return {"key": key, "n": n_out, "epochs": epochs, "seed": seed, "epochsRun": epochs_run}


# ---------------------------------------------------------------------------------------------
# synth.series: DDPM over windows of multivariate returns (1-D conv denoiser, cosine schedule)
# ---------------------------------------------------------------------------------------------
SERIES_CHANNELS = 32
SERIES_EMA = 0.995
SERIES_DILATIONS = (1, 2, 4, 8, 16)  # receptive field ~76 days


def _series_stats(W) -> dict:
    """Stylized facts of windows W (paths, days, columns), pooled over paths."""
    import numpy as np

    flat = W.reshape(-1, W.shape[-1])
    mu, sd = flat.mean(0), flat.std(0) + 1e-12
    kurt = (((flat - mu) / sd) ** 4).mean(0) - 3

    def lag1(A):
        a = A - A.mean(1, keepdims=True)
        num = (a[:, 1:] * a[:, :-1]).sum((0, 1))
        den = (a * a).sum((0, 1)) + 1e-12
        return num / den

    corr = np.corrcoef(flat.T) if flat.shape[1] > 1 else np.ones((1, 1))
    return {"mean": mu.tolist(), "std": sd.tolist(), "excessKurtosis": kurt.tolist(), "acf1": lag1(W).tolist(),
            "acf1Abs": lag1(np.abs(W)).tolist(), "corr": np.round(corr, 4).tolist()}


def _synth_series(inp: dict) -> dict:
    import copy

    import numpy as np
    import torch
    from torch import nn
    from torch.nn import functional as F

    t_start = time.monotonic()
    seed = int(inp.get("seed") or 0)
    window = max(8, min(int(inp.get("window") or 60), 512))
    n_paths = max(1, min(int(inp.get("n") or 100), 5000))
    steps = max(100, min(int(inp.get("steps") or 2000), 50_000))
    K = max(50, min(int(inp.get("diffusionSteps") or 200), 1000))
    kind = str(inp.get("kind") or "returns")
    calibrate = inp.get("calibrate", True) is not False
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    gen = torch.Generator().manual_seed(seed)
    d = _load_json_ref(inp, "dataKey")
    cols = [str(c) for c in d.get("columns") or []]
    R = np.asarray(d.get("rows") or [], float)
    if R.ndim != 2 or R.shape[1] != len(cols) or not cols:
        raise ValueError("dataKey must hold {\"columns\": [...], \"rows\": [[value per column] per day]}")
    R = R[np.isfinite(R).all(1)]
    if kind == "prices":
        if (R <= 0).any():
            raise ValueError("prices must be positive")
        R = np.diff(np.log(R), axis=0)
    T, C = R.shape
    if T < window + 20:
        raise ValueError(f"need at least window + 20 = {window + 20} rows, got {T}")
    mu, sd = R.mean(0), R.std(0) + 1e-12
    Z = ((R - mu) / sd).astype(np.float32)
    wins = np.lib.stride_tricks.sliding_window_view(Z, window, axis=0)  # (T-window+1, C, window)
    data = torch.from_numpy(np.ascontiguousarray(wins))

    # cosine noise schedule (Nichol & Dhariwal 2021)
    s = 0.008
    tt = np.arange(K + 1, dtype=np.float64) / K
    f = np.cos((tt + s) / (1 + s) * math.pi / 2) ** 2
    betas = np.clip(1 - (f[1:] / f[0]) / (f[:-1] / f[0]), 1e-8, 0.999)
    alphas = 1 - betas
    abar = np.cumprod(alphas)
    betas_t, alphas_t, abar_t = (torch.tensor(x, dtype=torch.float32) for x in (betas, alphas, abar))

    class TimeEmb(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.dim = dim

        def forward(self, t):
            half = self.dim // 2
            freqs = torch.exp(-math.log(10000.0) * torch.arange(half, dtype=torch.float32) / half)
            a = t.float()[:, None] * freqs[None]
            return torch.cat([a.sin(), a.cos()], 1)

    class Block(nn.Module):
        def __init__(self, ch, tdim, dil):
            super().__init__()
            self.n1, self.c1 = nn.GroupNorm(8, ch), nn.Conv1d(ch, ch, 3, padding=dil, dilation=dil)
            self.t = nn.Linear(tdim, ch)
            self.n2, self.c2 = nn.GroupNorm(8, ch), nn.Conv1d(ch, ch, 3, padding=1)

        def forward(self, x, te):
            h = self.c1(F.silu(self.n1(x))) + self.t(te)[:, :, None]
            return x + self.c2(F.silu(self.n2(h)))

    class Denoiser(nn.Module):
        def __init__(self, c, ch=SERIES_CHANNELS, tdim=96, dils=SERIES_DILATIONS):
            super().__init__()
            self.temb = nn.Sequential(TimeEmb(tdim), nn.Linear(tdim, tdim), nn.SiLU(), nn.Linear(tdim, tdim))
            self.inp = nn.Conv1d(c, ch, 3, padding=1)
            self.blocks = nn.ModuleList([Block(ch, tdim, dl) for dl in dils])
            self.out = nn.Sequential(nn.GroupNorm(8, ch), nn.SiLU(), nn.Conv1d(ch, c, 3, padding=1))
            nn.init.zeros_(self.out[-1].weight)
            nn.init.zeros_(self.out[-1].bias)

        def forward(self, x, t):
            te, h = self.temb(t), self.inp(x)
            for b in self.blocks:
                h = b(h, te)
            return self.out(h)

    model = Denoiser(C)
    ema = copy.deepcopy(model).eval()
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=steps, eta_min=1e-4)
    batch, budget, it = 64, TASKS["synth.series"][3] - 300, 0
    losses = []
    for it in range(1, steps + 1):
        x0 = data[torch.randint(0, len(data), (batch,), generator=gen)]
        t = torch.randint(0, K, (batch,), generator=gen)
        eps = torch.randn(x0.shape, generator=gen)
        ab = abar_t[t][:, None, None]
        loss = F.mse_loss(model(ab.sqrt() * x0 + (1 - ab).sqrt() * eps, t), eps)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        with torch.no_grad():
            for pe, pm in zip(ema.parameters(), model.parameters()):
                pe.mul_(SERIES_EMA).add_(pm.detach(), alpha=1 - SERIES_EMA)
        losses.append(loss.item())
        if time.monotonic() - t_start > budget:
            break

    paths = []
    with torch.no_grad():
        for s0 in range(0, n_paths, 256):
            b = min(256, n_paths - s0)
            x = torch.randn((b, C, window), generator=gen)
            for t in range(K - 1, -1, -1):
                eps = ema(x, torch.full((b,), t, dtype=torch.long))
                x0 = ((x - (1 - abar_t[t]).sqrt() * eps) / abar_t[t].sqrt()).clamp(-10, 10)
                if t > 0:
                    ab_prev = abar_t[t - 1]
                    mean = (ab_prev.sqrt() * betas_t[t] / (1 - abar_t[t])) * x0 \
                        + (alphas_t[t].sqrt() * (1 - ab_prev) / (1 - abar_t[t])) * x
                    var = betas_t[t] * (1 - ab_prev) / (1 - abar_t[t])
                    x = mean + var.sqrt() * torch.randn(x.shape, generator=gen)
                else:
                    x = x0
            paths.append(x.permute(0, 2, 1).numpy())
    Pz = np.concatenate(paths)  # (paths, days, columns), standardized units
    # On short histories the denoiser partly memorizes the few independent windows and blends them, which shrinks
    # the variance of the samples (on 20k rows of i.i.d. data the samples match without this). Calibration rescales
    # each column to the training mean and standard deviation; shapes, tails and correlations stay as generated.
    scale = np.ones(C)
    if calibrate:
        m_s, s_s = Pz.reshape(-1, C).mean(0), Pz.reshape(-1, C).std(0) + 1e-12
        m_r, s_r = Z.mean(0), Z.std(0)
        scale = s_r / s_s
        Pz = (Pz - m_s) * scale + m_r
    P = Pz * sd + mu
    real = np.transpose(wins, (0, 2, 1)) * sd + mu
    stats = {"real": _series_stats(real), "synthetic": _series_stats(P)}
    recipe = {"model": f"DDPM (own PyTorch implementation), 1-D dilated conv denoiser, epsilon prediction, EMA {SERIES_EMA}",
              "diffusionSteps": K, "schedule": "cosine", "trainSteps": steps, "stepsRun": it, "batch": batch,
              "window": window, "channels": SERIES_CHANNELS, "dilations": list(SERIES_DILATIONS), "lr": 1e-3,
              "units": "log returns" if kind == "prices" else "returns (as given)", "trainRows": int(T),
              "calibrated": calibrate, "calibrationScale": {c: round(float(x), 4) for c, x in zip(cols, scale)},
              "windows": int(len(data)), "finalLoss": round(float(np.mean(losses[-100:])), 5),
              "dataKey": inp.get("dataKey"), "trainSeconds": round(time.monotonic() - t_start, 1)}
    sid = _digest(inp.get("dataKey"), inp.get("parts"), window, n_paths, steps, K, seed, kind)[:24]
    key = f"ml/synthetic/ts-{sid}.json"
    _put_json(key, {"columns": cols, "paths": np.round(P, 7).tolist(), "seed": seed, "recipe": recipe, "stats": stats})
    return {"key": key, "n": n_paths, "window": window, "steps": steps, "seed": seed}


# ---------------------------------------------------------------------------------------------
# topics.map: UMAP to 2-D + KMeans (k by silhouette over 4..12 unless given)
# ---------------------------------------------------------------------------------------------
def _topics_map(inp: dict) -> dict:
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    d = _load_json_ref(inp, "vectorsKey")
    ids, V = d.get("ids") or [], np.asarray(d.get("vectors") or [], np.float32)
    if V.ndim != 2 or len(ids) != V.shape[0] or not len(ids):
        raise ValueError("vectorsKey must hold {\"ids\": [...], \"vectors\": [[...], ...]} of equal length")
    N = len(ids)
    V = V / np.clip(np.linalg.norm(V, axis=1, keepdims=True), 1e-12, None)
    seed = int(inp.get("seed") or 42)
    if N >= 8:
        import umap

        k_nn = max(2, min(15, N - 1))
        knn = None
        if N <= 20000:  # exact cosine kNN; also skips pynndescent's per-call JIT compilation on cold starts
            from sklearn.neighbors import NearestNeighbors

            dists, idx = NearestNeighbors(n_neighbors=k_nn, metric="cosine", algorithm="brute").fit(V).kneighbors(V)
            knn = (idx, dists.astype(np.float32), None)
        Y = umap.UMAP(n_components=2, n_neighbors=k_nn, min_dist=0.1, metric="cosine", random_state=seed,
                      init="spectral" if N > 50 else "random", precomputed_knn=knn or (None, None, None)).fit_transform(V)
    elif N >= 2:
        U, S, _ = np.linalg.svd(V - V.mean(0), full_matrices=False)
        Y = U[:, :2] * S[:2] if U.shape[1] >= 2 else np.c_[U[:, :1] * S[:1], np.zeros(N)]
    else:
        Y = np.zeros((N, 2))
    Y = np.asarray(Y, float)
    silhouette = None
    if inp.get("k"):
        k = max(1, min(int(inp["k"]), N))
        labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Y).labels_ if k > 1 else np.zeros(N, int)
        if 1 < k < N:
            silhouette = float(silhouette_score(Y, labels))
    else:
        best = None
        for k in range(4, 13):
            if k >= N:
                break
            lab = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Y).labels_
            sc = float(silhouette_score(Y, lab, sample_size=min(N, 5000), random_state=0))
            if best is None or sc > best[0]:
                best = (sc, k, lab)
        if best is None:
            k, labels = 1, np.zeros(N, int)
        else:
            silhouette, k, labels = best
    # relabel so cluster 0 is the largest; scale coordinates into [0, 1] keeping the aspect ratio
    order = [c for c, _ in sorted(((c, int((labels == c).sum())) for c in range(k)), key=lambda x: -x[1])]
    remap = {c: i for i, c in enumerate(order)}
    labels = np.array([remap[c] for c in labels])
    lo = Y.min(0)
    span = float((Y.max(0) - lo).max()) or 1.0
    Yn = (Y - lo) / span
    points = [{"id": ids[i], "x": round(float(Yn[i, 0]), 5), "y": round(float(Yn[i, 1]), 5), "cluster": int(labels[i])}
              for i in range(N)]
    clusters = [{"id": c, "size": int((labels == c).sum()), "x": round(float(Yn[labels == c, 0].mean()), 5),
                 "y": round(float(Yn[labels == c, 1].mean()), 5)} for c in range(k)]
    tid = _digest(inp.get("vectorsKey"), inp.get("parts"), inp.get("k"), seed)[:24]
    key = f"ml/topics/{tid}.json"
    _put_json(key, {"points": points, "clusters": clusters, "k": k, "silhouette": silhouette,
                    "method": {"umap": {"n_neighbors": max(2, min(15, N - 1)), "min_dist": 0.1, "metric": "cosine",
                                        "random_state": seed},
                               "kmeans": {"space": "umap-2d", "k": k, "chosenBy": "given" if inp.get("k") else "silhouette 4..12"}}})
    return {"key": key, "k": k, "points": N, "silhouette": round(silhouette, 4) if silhouette is not None else None}


# ---------------------------------------------------------------------------------------------
# Modal functions: one per task
# ---------------------------------------------------------------------------------------------
@_task_function("health", api_image)
def health(req: dict) -> dict:
    return _execute("health", req, _health)


@_task_function("geo.refine", geo_image, env={**GDAL_ENV, **_threads(_hw_threads(TASKS["geo.refine"][1]))})
def geo_refine(req: dict) -> dict:
    return _execute("geo.refine", req, _geo_refine)


@_task_function("geo.embed_change", aef_image, env=AEF_ENV)
def geo_embed_change(req: dict) -> dict:
    return _execute("geo.embed_change", req, _geo_embed_change)


@_task_function("docs.parse", docs_image, env={"OMP_THREAD_LIMIT": "1"})
def docs_parse(req: dict) -> dict:
    return _execute("docs.parse", req, _docs_parse)


@_task_function("docs.rerank", rerank_image, env=_threads(_hw_threads(TASKS["docs.rerank"][1])))
def docs_rerank(req: dict) -> dict:
    return _execute("docs.rerank", req, _docs_rerank)


@_task_function("audio.transcribe", audio_image)
def audio_transcribe(req: dict) -> dict:
    return _execute("audio.transcribe", req, _audio_transcribe)


@_task_function("graph.train", graph_image)
def graph_train(req: dict) -> dict:
    return _execute("graph.train", req, _graph_train)


@_task_function("graph.train.gpu", graph_gpu_image)
def graph_train_gpu(req: dict) -> dict:
    return _execute("graph.train.gpu", req, lambda inp: _graph_train({**inp, "gpu": True}))


@_task_function("synth.tabular", synth_image)
def synth_tabular(req: dict) -> dict:
    return _execute("synth.tabular", req, _synth_tabular)


@_task_function("synth.series", synth_image)
def synth_series(req: dict) -> dict:
    return _execute("synth.series", req, _synth_series)


@_task_function("topics.map", topics_image)
def topics_map(req: dict) -> dict:
    return _execute("topics.map", req, _topics_map)


TASK_FUNCTIONS = {
    "health": health,
    "geo.refine": geo_refine,
    "geo.embed_change": geo_embed_change,
    "docs.parse": docs_parse,
    "docs.rerank": docs_rerank,
    "audio.transcribe": audio_transcribe,
    "graph.train": graph_train,
    "graph.train.gpu": graph_train_gpu,
    "synth.tabular": synth_tabular,
    "synth.series": synth_series,
    "topics.map": topics_map,
}


# ---------------------------------------------------------------------------------------------
# HTTP endpoints (bearer auth): the task entry point and the async status poll
# ---------------------------------------------------------------------------------------------
def _authorized(header: str | None) -> bool:
    secret = os.environ.get("EDGE_ML_SECRET", "")
    if not secret or not header:
        return False
    scheme, _, token = header.strip().partition(" ")
    return scheme.lower() == "bearer" and hmac.compare_digest(token.strip().encode(), secret.encode())


def _error(status: int, message: str, **extra):
    return JSONResponse({"ok": False, "error": message, **extra}, status_code=status)


@app.function(image=api_image, cpu=0.25, memory=512, timeout=TASKS["audio.transcribe"][3] + 300, secrets=[SECRET],
              max_containers=2, scaledown_window=SCALEDOWN_SECONDS, env=APP_ENV)
@modal.concurrent(max_inputs=32)
@modal.fastapi_endpoint(method="POST", label=APP_NAME)
async def api(request: Request):
    """POST {"task", "input", "async", "correlation"} with Authorization: Bearer <EDGE_ML_SECRET>."""
    if not _authorized(request.headers.get("authorization")):
        return _error(401, "unauthorized")
    try:
        body = await request.json()
    except Exception:
        return _error(400, "body must be JSON")
    if not isinstance(body, dict):
        return _error(400, "body must be a JSON object")
    task = body.get("task")
    fn = TASK_FUNCTIONS.get(task) if isinstance(task, str) else None
    if fn is None:
        return _error(400, f"unknown task: {task!r}", tasks=list(TASK_FUNCTIONS))
    inp = body.get("input") if body.get("input") is not None else {}
    if not isinstance(inp, dict):
        return _error(400, "input must be a JSON object")
    req = {"task": task, "input": inp, "async": bool(body.get("async")), "correlation": str(body.get("correlation") or "")}
    try:
        if req["async"]:
            call = await fn.spawn.aio(req)
            return {"ok": True, "callId": call.object_id}
        env = await fn.remote.aio(req)
    except Exception as e:
        traceback.print_exc()
        return _error(500, _redact(f"{type(e).__name__}: {e}")[:1000], task=task)
    if env.get("ok"):
        return {"ok": True, "task": task, "result": env.get("result"), "seconds": env.get("seconds"),
                "costUsd": env.get("costUsd")}
    return {"ok": False, "task": task, "error": env.get("error"), "seconds": env.get("seconds"),
            "costUsd": env.get("costUsd")}


@app.function(image=api_image, cpu=0.25, memory=512, timeout=60, secrets=[SECRET], max_containers=1,
              scaledown_window=SCALEDOWN_SECONDS, env=APP_ENV)
@modal.concurrent(max_inputs=32)
@modal.fastapi_endpoint(method="POST", label=f"{APP_NAME}-status")
async def status(request: Request):
    """POST {"callId"} -> {"done": false} or {"done": true, "ok", "result", "error", ...}."""
    if not _authorized(request.headers.get("authorization")):
        return _error(401, "unauthorized")
    try:
        body = await request.json()
    except Exception:
        return _error(400, "body must be JSON")
    call_id = body.get("callId") if isinstance(body, dict) else None
    if not isinstance(call_id, str) or not re.fullmatch(r"fc-[A-Za-z0-9]+", call_id):
        return _error(400, "callId must look like fc-...")
    try:
        env = await modal.FunctionCall.from_id(call_id).get.aio(timeout=0)
    except TimeoutError:
        return {"done": False}
    except modal.exception.OutputExpiredError:
        return {"done": True, "ok": False, "error": "result expired"}
    except modal.exception.NotFoundError:
        return _error(404, "unknown callId")
    except Exception as e:  # the call itself crashed (e.g. timeout or out of memory)
        return {"done": True, "ok": False, "error": _redact(f"{type(e).__name__}: {e}")[:1000]}
    if not isinstance(env, dict):
        return {"done": True, "ok": False, "error": "unexpected result"}
    return {"done": True, "ok": env.get("ok"), "result": env.get("result"), "error": env.get("error"),
            "task": env.get("task"), "seconds": env.get("seconds"), "costUsd": env.get("costUsd")}
