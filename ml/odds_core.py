"""
Deal Radar (E4) training and scoring, without Modal or R2: pure numpy, scikit-learn and LightGBM, so it can be
tested locally (ml/smoke.py and scripts) and imported by the odds.train and odds.score tasks in edge_ml.py.

The panel is the TypeScript feature builder's output (src/lib/edge/odds/features.ts is the only place features are
defined): JSON lines of [cik, t, sic, y, listed, ...features], y null while a window is open.

Training (train_odds):
  - a discrete-time hazard model: LightGBM on company-months, target "an announced sale within 12 months", with
    monotone constraints where economics is unambiguous (passed in with the features);
  - rolling-origin validation by year with an embargo of one horizon (test year Y learns from months before Y-1);
  - the same splits for the baselines: the base rate and a Palepu-style logit on the classic features;
  - metrics with bootstrap 90% intervals: AUROC, PR-AUC, Brier, Brier skill against the base rate, top-1% lift,
    and reliability bins with Jeffreys intervals;
  - inductive Venn-Abers calibration: a proper training model (months before the calibration year minus one)
    scores the most recent fully labelled year, kept as the calibration set.
Scoring (score_odds): the calibrated point estimate with its Venn-Abers interval, TreeSHAP contributions
(pred_contrib) per feature, and "what would move it" (one feature changed, re-scored).
"""
from __future__ import annotations

import json
import math

PALEPU = ["logAssets", "revGrowth", "roa", "leverage", "cashRatio", "mismatch", "wave"]
BINARY = {"mismatch", "switch13g", "proxyFight", "lateFiling"}
COUNTS = {"sc13d", "sc13dA", "officerChange", "rightsPlan", "bylaws"}
SECTORS = {"energy": ("13", "29", "46", "49"), "tech": ("737", "357", "367"), "health": ("283", "384", "80")}


def sector_of(sic: str) -> str:
    for k, prefixes in SECTORS.items():
        if any(str(sic).startswith(p) for p in prefixes):
            return k
    return "other"


def parse_panel(text: str, n_features: int):
    import numpy as np

    ciks, ts, sics, ys = [], [], [], []
    X = []
    for line in text.splitlines():
        if not line.strip():
            continue
        a = json.loads(line)
        ciks.append(str(a[0])); ts.append(str(a[1])); sics.append(str(a[2])); ys.append(a[3])
        row = [float("nan") if v is None else float(v) for v in a[5:5 + n_features]]
        row += [float("nan")] * (n_features - len(row))
        X.append(row)
    y = np.array([np.nan if v is None else float(v) for v in ys])
    return ciks, ts, sics, y, np.asarray(X, dtype=float).reshape(-1, n_features)


def _jeffreys(k: int, n: int, level: float = 0.9):
    from scipy.stats import beta

    if n == 0:
        return 0.0, 1.0
    a = (1 - level) / 2
    return float(beta.ppf(a, k + 0.5, n - k + 0.5)) if k > 0 else 0.0, float(beta.ppf(1 - a, k + 0.5, n - k + 0.5)) if k < n else 1.0


def reliability_bins(p, y, bins: int = 10):
    import numpy as np

    out = []
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        m = (p >= lo) & ((p < hi) if i < bins - 1 else (p <= hi))
        n = int(m.sum())
        if not n:
            continue
        k = int(y[m].sum())
        low, high = _jeffreys(k, n)
        out.append({"lo": lo, "hi": hi, "n": n, "meanP": float(p[m].mean()), "rate": k / n, "low": low, "high": high})
    return out


def _metrics(p, y):
    import numpy as np
    from sklearn.metrics import average_precision_score, roc_auc_score

    auc = float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else float("nan")
    ap = float(average_precision_score(y, p)) if y.sum() > 0 else float("nan")
    brier = float(np.mean((p - y) ** 2))
    return auc, ap, brier


def _top_lift(p, y, share: float = 0.01):
    import numpy as np

    order = np.argsort(-p)
    n = max(1, int(round(len(p) * share)))
    rate, base = float(y[order[:n]].mean()), float(y.mean()) if len(y) else float("nan")
    return {"n": n, "rate": rate, "base": base, "lift": rate / base if base > 0 else float("nan")}


def _boot(stat, p, y, draws: int = 300, seed: int = 17):
    import numpy as np

    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(draws):
        idx = rng.integers(0, len(p), len(p))
        v = stat(p[idx], y[idx])
        if v == v and math.isfinite(v):
            vals.append(v)
    if not vals:
        return None
    vals.sort()
    return [vals[int(0.05 * (len(vals) - 1))], vals[int(0.95 * (len(vals) - 1))]]


def _lgbm(X, y, monotone, seed: int = 0, max_rows: int = 400_000):
    import lightgbm as lgb
    import numpy as np

    rng = np.random.default_rng(seed)
    pos = np.where(y == 1)[0]
    neg = np.where(y == 0)[0]
    share = min(1.0, max(0.02, (max_rows - len(pos)) / max(1, len(neg))))
    keep_neg = neg[rng.random(len(neg)) < share]
    idx = np.concatenate([pos, keep_neg])
    w = np.concatenate([np.ones(len(pos)), np.full(len(keep_neg), 1.0 / share)])
    model = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.04, num_leaves=15, min_child_samples=60, subsample=0.8, subsample_freq=1,
                               colsample_bytree=0.8, reg_lambda=1.0, monotone_constraints=list(monotone), random_state=seed, verbose=-1, n_jobs=2)
    model.fit(X[idx], y[idx], sample_weight=w)
    return model


def _palepu_fit(X, y, cols):
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    Z = X[:, cols]
    mean = np.nanmean(Z, axis=0)
    mean = np.where(np.isfinite(mean), mean, 0.0)
    sd = np.nanstd(Z, axis=0)
    sd = np.where(sd > 1e-12, sd, 1.0)
    Zs = np.where(np.isfinite(Z), (Z - mean) / sd, 0.0)
    m = LogisticRegression(C=0.5, max_iter=500, class_weight=None).fit(Zs, y)
    return lambda Xn: m.predict_proba(np.where(np.isfinite(Xn[:, cols]), (Xn[:, cols] - mean) / sd, 0.0))[:, 1]


def train_odds(text: str, features: list[dict], seed: int = 0, min_positives: int = 20) -> dict:
    """Train, validate and calibrate; returns the model, the calibration set and the scorecard's numbers."""
    import numpy as np

    keys = [f["key"] for f in features]
    mono = [int(f.get("monotone") or 0) for f in features]
    ciks, ts, sics, y, X = parse_panel(text, len(keys))
    years = np.array([int(t[:4]) for t in ts])
    lab = ~np.isnan(y)
    if int(np.nansum(y)) < 40:
        raise ValueError(f"only {int(np.nansum(y))} sales in the panel; the model needs at least 40")
    pcols = [keys.index(k) for k in PALEPU if k in keys]
    P, Y, B, L, used = [], [], [], [], []
    for yr in sorted(set(years[lab].tolist())):
        tr = lab & (np.array(ts) < f"{yr - 1}-01-01")
        te = lab & (years == yr)
        if y[tr].sum() < min_positives or not te.any():
            continue
        used.append(int(yr))
        m = _lgbm(X[tr], y[tr], mono, seed)
        P.append(m.predict_proba(X[te])[:, 1]); Y.append(y[te])
        B.append(np.full(int(te.sum()), float(y[tr].mean())))
        L.append(_palepu_fit(X[tr], y[tr], pcols)(X[te]))
    if not used:
        raise ValueError("no year has enough earlier sales to test on")
    P, Y, B, L = (np.concatenate(a) for a in (P, Y, B, L))
    auc, ap, brier = _metrics(P, Y)
    base_brier = float(np.mean((B - Y) ** 2))
    skill = 1 - brier / base_brier if base_brier > 0 else float("nan")
    mean_b = float(B.mean())
    pal_auc = _metrics(L, Y)[0]
    pal_skill = 1 - float(np.mean((L - Y) ** 2)) / base_brier if base_brier > 0 else float("nan")
    lift = _top_lift(P, Y)
    nan = lambda v: None if v is None or (isinstance(v, float) and not math.isfinite(v)) else v  # noqa: E731
    auc_ci = _boot(lambda p, t: _metrics(p, t)[0], P, Y)
    skill_ci = _boot(lambda p, t: 1 - float(np.mean((p - t) ** 2)) / max(1e-12, float(np.mean((mean_b - t) ** 2))), P, Y)
    scorecard = {
        "model": {
            "auroc": {"value": nan(auc), "ci": auc_ci}, "prAuc": {"value": nan(ap), "ci": _boot(lambda p, t: _metrics(p, t)[1], P, Y)},
            "brier": {"value": brier, "ci": _boot(lambda p, t: float(np.mean((p - t) ** 2)), P, Y)}, "skill": {"value": nan(skill), "ci": skill_ci},
            "lift": {**{k: nan(v) for k, v in lift.items()}, "ci": _boot(lambda p, t: _top_lift(p, t)["rate"], P, Y)},
        },
        "palepu": {"auroc": {"value": nan(pal_auc), "ci": _boot(lambda p, t: _metrics(p, t)[0], L, Y)}, "skill": {"value": nan(pal_skill), "ci": None}},
        "base": {"brier": base_brier}, "years": used, "n": int(len(Y)), "positives": int(Y.sum()), "bins": reliability_bins(P, Y),
        "beats": {"palepu": bool(auc_ci[0] > pal_auc) if auc_ci and pal_auc == pal_auc else None, "base": bool(skill_ci[0] > 0) if skill_ci else None}, "text": "",
    }
    # Inductive Venn-Abers: the proper training model scores the latest fully labelled year.
    cal_year = int(years[lab].max())
    proper = lab & (np.array(ts) < f"{cal_year - 1}-01-01")
    cal = lab & (years == cal_year)
    model = _lgbm(X[proper], y[proper], mono, seed)
    cs, cy = model.predict_proba(X[cal])[:, 1], y[cal]
    if len(cs) > 8000:
        # A uniform subsample: keeping every positive would change the base rate calibration learns.
        keep = np.random.default_rng(23).choice(len(cs), size=8000, replace=False)
        cs, cy = cs[keep], cy[keep]
    q = {}
    for j, k in enumerate(keys):
        col = X[proper, j]
        col = col[np.isfinite(col)]
        if len(col):
            q[k] = [float(np.quantile(col, 0.25)), float(np.quantile(col, 0.75))]
    rates = {}
    last5 = lab & (years > int(years[lab].max()) - 5)
    for s in set(sector_of(x) for x in sics):
        msk = last5 & np.array([sector_of(x) == s for x in sics])
        if msk.any():
            rates[s] = float(y[msk].mean())
    importance = dict(zip(keys, (float(v) for v in model.booster_.feature_importance(importance_type="gain"))))
    return {
        "model": model, "calibration": {"scores": cs.tolist(), "labels": cy.tolist(), "year": cal_year, "quantiles": q, "features": keys},
        "scorecard": scorecard, "calibrationSummary": {"year": cal_year, "n": int(len(cs)), "positives": int(cy.sum())}, "sectorRates": rates,
        "trainedThrough": f"{cal_year - 2}-12", "info": {"rows": int(len(y)), "labelled": int(lab.sum()), "importance": importance, "years": used},
    }


def _iso(s, y):
    from sklearn.isotonic import IsotonicRegression

    return IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(s, y)


def venn_abers(cal_s, cal_y, s: float):
    """Inductive Venn-Abers: isotonic fits with the case labelled 0 and 1; the point estimate p1 / (1 - p0 + p1)."""
    import numpy as np

    xs = np.append(cal_s, s)
    p0 = float(_iso(xs, np.append(cal_y, 0.0)).predict([s])[0])
    p1 = float(_iso(xs, np.append(cal_y, 1.0)).predict([s])[0])
    low, high = min(p0, p1), max(p0, p1)
    return high / (1 - low + high), low, high


def score_odds(booster, calibration: dict, rows: list[dict]) -> list[dict]:
    """Calibrated odds, intervals, TreeSHAP contributions and moves for feature rows [{id, x}]."""
    import numpy as np

    keys = calibration["features"]
    cs, cy = np.asarray(calibration["scores"], float), np.asarray(calibration["labels"], float)
    iso = _iso(cs, cy)
    q = calibration.get("quantiles", {})
    X = np.asarray([[float("nan") if v is None else float(v) for v in r["x"]] for r in rows], float).reshape(-1, len(keys))
    raw = booster.predict(X)
    contrib = booster.predict(X, pred_contrib=True)
    out = []
    for i, r in enumerate(rows):
        p, low, high = venn_abers(cs, cy, float(raw[i]))
        p0 = float(iso.predict([raw[i]])[0])
        moves = []
        for j, k in enumerate(keys):
            x = X[i, j]
            if k in BINARY or k in COUNTS:
                alt = 0.0 if (x == x and x >= 1) else 1.0
            elif k in q and x == x:
                alt = q[k][1] if x <= (q[k][0] + q[k][1]) / 2 else q[k][0]
            else:
                continue
            if alt == x:
                continue
            z = X[i].copy(); z[j] = alt
            to = float(iso.predict([booster.predict(z.reshape(1, -1))[0]])[0])
            moves.append({"key": k, "to": round(to, 4), "up": bool(alt > (x if x == x else 0.0)), "d": abs(to - p0)})
        moves.sort(key=lambda m: -m["d"])
        out.append({
            "id": r["id"], "p": float(p), "low": float(low), "high": float(high),
            "contribs": [{"feature": k, "contrib": float(contrib[i, j]), "value": None if X[i, j] != X[i, j] else float(X[i, j])} for j, k in enumerate(keys)],
            "moves": [{k: v for k, v in m.items() if k != "d"} for m in moves[:3]],
        })
    return out
