"""
Local checks for the LBO Stress Lab's refine (ml/lbo_core.py): python ml/test_lbo_core.py (numpy only).

The engine must give the same numbers as the TypeScript engine (src/lib/edge/scen/lbo.ts) on the fixture paths in
scripts/fixtures/lbo/engine.json (steady, shocked, springing and yearly cases); the simulation must be
reproducible from its seed and sensible (higher leverage never lowers the breach odds); the refine must return
the per-path outcomes the app summarises.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lbo_core  # noqa: E402

passed = failed = 0


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label} {detail}")


cases = json.load(open(os.path.join(HERE, "..", "scripts", "fixtures", "lbo", "engine.json")))
for i, c in enumerate(cases):
    st, p, want = c["structure"], c["path"], c["result"]
    sp = np.array([p["revolverSpreadBps"]]) if "revolverSpreadBps" in p else None
    r = lbo_core.lbo_paths(st, np.array([p["ebitda"]]), np.array([p["sofr"]]), np.array([p["exitMultiple"]]), sp)
    same = (abs(r["irr"][0] - want["irr"]) < 1e-9 and abs(r["moic"][0] - want["moic"]) < 1e-9 and abs(r["exitEquity"][0] - want["exitEquity"]) < 1e-6
            and int(r["firstBreach"][0]) == want["firstBreach"] and int(r["defaulted"][0]) == want["defaulted"]
            and all(int(r["lev"][y][0]) == int(want["yearly"][y]["lev"]) and int(r["cov"][y][0]) == int(want["yearly"][y]["cov"]) for y in range(len(want["yearly"])))
            and abs(r["paydown"][0] - want["attribution"]["paydown"]) < 1e-6)
    check(f"engine case {i + 1} matches the TypeScript engine (IRR {want['irr']:.4f}, first breach {want['firstBreach']})", same,
          f"got irr {r['irr'][0]} breach {r['firstBreach'][0]}")

# A small synthetic spec: two factors, default-like structure.
rng = np.random.default_rng(3)
months = 240
v = 0.0016
H = []
for _ in range(months):
    z = rng.standard_normal()
    e = math.sqrt(v) * z
    v = 0.0001 + 0.1 * e * e + 0.85 * v
    H.append([0.006 + e, 0.1 * rng.standard_normal()])
Hn = np.array(H)
Z = ((Hn - Hn.mean(0)) / Hn.std(0)).tolist()
st = cases[0]["structure"]
spec = {
    "structure": st,
    "macro": {"fits": [{"mu": 0.006, "omega": 0.0001, "alpha": 0.1, "gamma": 0.05, "beta": 0.8, "lastVar": 0.0016}, {"mu": 0.0, "omega": 0.001, "alpha": 0.1, "gamma": 0.0, "beta": 0.8, "lastVar": 0.01}],
              "Z": Z, "market": 0, "rates": 1, "sector": -1},
    "rates": {"regimes": [{"mu": 2.75, "phi": 0.03, "sigma": 0.12}, {"mu": 2.0, "phi": 0.06, "sigma": 0.45}], "P": [[0.97, 0.03], [0.15, 0.85]], "start": 4.0, "startRegime": 0, "basis": 0.05, "rho": 0.5},
    "op": {"revenue0": 1000, "ebitda0": 200, "growthQ": math.log(1.05) / 4, "betaMarket": 0.5, "betaSector": 0, "residSd": 0.04, "residuals": [], "fixedShare": 0.3, "costInflQ": math.log(1.025) / 4, "marginKappa": 0.25, "marginSd": 0.01},
    "exit": {"base": 10, "sigma": 0.2, "elasticity": 0.5}, "spread": {"baseBps": 350, "slopeBpsPerPct": 25, "capBps": 1500},
    "paths": 2000, "seed": 11, "hurdle": 0.2, "confidence": 0.6, "breakYear": 3,
}
a = lbo_core.refine(spec)
b = lbo_core.refine(spec)
check("the refine is reproducible from its seed", a["outcomes"]["irr"][:50] == b["outcomes"]["irr"][:50])
o = a["outcomes"]
check("it returns every per-path array the app summarises", all(k in o for k in ("irr", "moic", "firstBreach", "lev", "cov", "ltmE", "netDebt", "rateChange", "ebitdaChange", "marketByYear", "exitNoise")) and len(o["irr"]) == 2000 and len(o["lev"]) == st["years"])
med = float(np.median(o["irr"]))
check("the median IRR is plausible for the structure (between -30% and +40%)", -0.3 < med < 0.4, med)
heavy = {**spec, "structure": {**st, "tranches": [{**st["tranches"][0], "turns": 5.5}] + st["tranches"][1:]}}
hb = lbo_core.refine(heavy)["summary"]["breachAny"]
check("more leverage never lowers the breach odds", hb >= a["summary"]["breachAny"], (hb, a["summary"]["breachAny"]))
mp = a["maxPrice"]
check("the max-price curve falls as the price rises", all(mp["curve"][k]["prob"] >= mp["curve"][k + 1]["prob"] - 1e-9 for k in range(len(mp["curve"]) - 1)))
check("the max price clears the confidence line", mp["multiple"] is None or lbo_core.prob_above(st, lbo_core.simulate({**spec, "paths": 2000}, np.random.default_rng(11)), mp["multiple"], 0.2) >= 0.6 - 1e-9)
try:
    lbo_core.refine({**spec, "paths": 50000})
    check("more than 20,000 paths is refused", False)
except ValueError:
    check("more than 20,000 paths is refused", True)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
