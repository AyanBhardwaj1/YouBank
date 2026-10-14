"""
Local checks for the Deal Radar's model code (ml/odds_core.py) on a synthetic panel with a known hazard, so the
odds.train and odds.score tasks are tested before they are deployed (no Modal, no R2):

    python ml/test_odds_core.py        (needs numpy, scipy, scikit-learn and lightgbm)

The panel has the TypeScript layout ([cik, t, sic, y, listed, ...features]); sales follow a logistic hazard in
three features, so the model must beat the base rate and a logit that misses two of them, stay calibrated,
respect its monotone constraints, and return intervals that contain its point estimates.
"""
import json
import math
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import odds_core  # noqa: E402

FEATURES = [{"key": k, "monotone": m} for k, m in [
    ("logAssets", 0), ("logRevenue", 0), ("revGrowth", 0), ("roa", 0), ("leverage", 0), ("cashRatio", 0), ("mismatch", 1), ("wave", 1),
    ("sc13d", 1), ("sc13dA", 1), ("switch13g", 1), ("insider", 0), ("officerChange", 0), ("rightsPlan", 0), ("bylaws", 0), ("agreements", 0),
    ("proxyFight", 1), ("lateFiling", 0), ("activity8k", 0), ("age", 0)]]
KEYS = [f["key"] for f in FEATURES]
passed = failed = 0


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label}  -> {detail}")


def panel(seed=1, companies=900, months=120):
    rng = np.random.default_rng(seed)
    lines = []
    for c in range(companies):
        sic = ["1311", "7372", "2834"][c % 3]
        base = rng.normal(size=len(KEYS))
        sold = False
        for m in range(months):
            year, month = 2012 + m // 12, m % 12 + 1
            t = f"{year}-{month:02d}-01"
            x = base + rng.normal(scale=0.3, size=len(KEYS))
            x[KEYS.index("sc13d")] = float(rng.random() < 0.12)
            x[KEYS.index("proxyFight")] = float(rng.random() < 0.06)
            x[KEYS.index("wave")] = 1 + 0.5 * math.sin(m / 9)
            z = -4.6 + 2.2 * x[KEYS.index("sc13d")] + 2.0 * x[KEYS.index("proxyFight")] + 1.0 * (x[KEYS.index("wave")] - 1) + 0.4 * x[KEYS.index("leverage")]
            p = 1 / (1 + math.exp(-z))
            open_window = (2012 + (m + 12) // 12, (m + 12) % 12 + 1) > (2022, 10)
            y = None if open_window else float(rng.random() < p)
            if sold:
                continue
            lines.append(json.dumps([str(c), t, sic, y, 1, *[round(float(v), 5) for v in x]]))
    return "\n".join(lines)


def main():
    text = panel()
    res = odds_core.train_odds(text, FEATURES)
    sc = res["scorecard"]
    auc, pal = sc["model"]["auroc"]["value"], sc["palepu"]["auroc"]["value"]
    # The panel starts in 2012; 2012's windows close in 2013, so 2014 is the first year a model can be tested on.
    check("trained on rolling origins with a one-horizon embargo (first test year 2014)", len(sc["years"]) >= 4 and sc["years"][0] == 2014, sc["years"])
    check("beats the base rate: Brier skill above zero with its interval", sc["model"]["skill"]["value"] > 0 and sc["model"]["skill"]["ci"][0] > 0, sc["model"]["skill"])
    check("beats the Palepu-style logit (which lacks the 13D and proxy features)", auc > pal + 0.03 and sc["beats"]["palepu"] is True, (auc, pal))
    check("AUROC has a bootstrap 90% interval around it", sc["model"]["auroc"]["ci"][0] <= auc <= sc["model"]["auroc"]["ci"][1], sc["model"]["auroc"])
    bins = sc["bins"]
    check("reliability bins with Jeffreys intervals", all(0 <= b["low"] <= b["rate"] <= b["high"] <= 1 for b in bins) and sum(b["n"] for b in bins) == sc["n"])
    cal = res["calibration"]
    check("the calibration set is the latest labelled year, with positives", cal["year"] == res["calibrationSummary"]["year"] and sum(cal["labels"]) > 0 and len(cal["scores"]) <= 8000)
    booster = res["model"].booster_
    rows = [{"id": str(i), "x": [None if (i == 0 and k == "roa") else 0.0 for k in KEYS]} for i in range(3)]
    rows[1]["x"][KEYS.index("sc13d")] = 1.0
    rows[2]["x"][KEYS.index("sc13d")] = 1.0
    rows[2]["x"][KEYS.index("proxyFight")] = 1.0
    out = odds_core.score_odds(booster, cal, rows)
    check("scores carry a point estimate inside its Venn-Abers interval", all(0 <= s["low"] <= s["p"] <= s["high"] <= 1 for s in out), out[0])
    check("monotone: a 13D and a proxy contest never lower the odds", out[0]["p"] <= out[1]["p"] + 1e-9 <= out[2]["p"] + 2e-9, [s["p"] for s in out])
    check("TreeSHAP contributions per feature, the 13D among the largest when present", len(out[1]["contribs"]) == len(KEYS) and max(out[1]["contribs"], key=lambda c: c["contrib"])["feature"] in ("sc13d", "proxyFight", "wave", "leverage"))
    check("what would move it: up to three re-scored changes", 1 <= len(out[0]["moves"]) <= 3 and all(0 <= m["to"] <= 1 for m in out[0]["moves"]))
    check("a missing value is scored, not rejected", math.isfinite(out[0]["p"]))
    check("sector base rates by SIC group", set(res["sectorRates"]) >= {"energy", "tech", "health"} and all(0 < v < 0.2 for v in res["sectorRates"].values()), res["sectorRates"])
    check("the result is JSON-serialisable (as the task returns it)", bool(json.dumps({k: v for k, v in res.items() if k != "model"})))
    try:
        odds_core.train_odds("\n".join(text.splitlines()[:200]), FEATURES)
        check("too few sales is refused", False, "trained")
    except ValueError as e:
        check("too few sales is refused with a reason", "needs at least 40" in str(e) or "enough earlier" in str(e), str(e))
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
