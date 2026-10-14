"""
LBO Stress Lab (E6): the 20,000-path refine for the ML service (lbo.refine), kept apart from Modal so it is tested
locally (python ml/test_lbo_core.py, numpy only). It mirrors src/lib/edge/scen/lbo.ts (the LBO engine) and
src/lib/edge/scen/stress.ts (the macro, rate and operating paths) line for line, vectorised over paths:

- macro: GJR-GARCH(1,1) per factor with filtered historical simulation (whole real months of standardised
  shocks resampled and scaled to each path's simulated volatility);
- rates: the two-regime AR(1) short rate, its shock correlated with the 10-year factor's;
- operating: revenue at the company's own median pace plus its market beta plus resampled residual quarters,
  costs 30% fixed, a mean-reverting margin shock; the exit multiple moves with the market over the hold;
- the buyout: tranches in order of seniority, interest on beginning balances, taxes, capex, working capital,
  amortisation, the sweep (revolver first), a revolver that draws to keep minimum cash at a spread tied to the
  equity drawdown, covenant tests on LTM figures (or springing), liquidity defaults, the exit.

The app summarises the per-path outcomes this returns exactly as it summarises its own 1,000-path preview, so
the two cannot drift apart in what they report. Random draws differ from the app's (numpy's generator), so the
refine agrees with the preview in distribution, and the engine agrees exactly on any given path (the fixture).
"""
from __future__ import annotations

import math

import numpy as np


def _rate(tr: dict, sofr, spread=None):
    if tr.get("floating"):
        s = tr.get("spreadBps", 0.0) if spread is None else spread
        return np.maximum(tr.get("floorPct", 0.0), sofr) / 100 + s / 10000 + (100 - tr.get("oid", 100.0)) / 4 / 100
    return np.zeros_like(sofr) + tr.get("fixedPct", 0.0) / 100


def sources_uses(st: dict) -> dict:
    e0, m = float(st["ebitda0"]), float(st["entryMultiple"])
    if not (e0 > 0 and m > 0):
        raise ValueError("Entry EBITDA and entry multiple must be positive.")
    tev = e0 * m
    debt0 = sum(t["turns"] * e0 for t in st["tranches"] if t["kind"] != "revolver")
    fees = debt0 * st["financeFeePct"] / 100 + tev * st["txnFeePct"] / 100
    uses = tev + fees + st["minCash"]
    equity = uses - debt0
    if equity <= 0:
        raise ValueError("Leverage exceeds the purchase price plus fees: reduce the debt turns.")
    return {"entryTev": tev, "debt0": debt0, "fees": fees, "uses": uses, "equity": equity}


def lbo_paths(st: dict, ebitda: np.ndarray, sofr: np.ndarray, exit_multiple: np.ndarray, revolver_spread: np.ndarray | None = None) -> dict:
    """The buyout down every path at once. ebitda, sofr: (P, N) annualised run-rates and SOFR %; exit_multiple: (P,)."""
    su = sources_uses(st)
    ppy = int(st["periodsPerYear"])
    N = int(round(st["years"] * ppy))
    P = ebitda.shape[0]
    tr = st["tranches"]
    K = len(tr)
    e0 = float(st["ebitda0"])
    debts = np.array([[0.0 if t["kind"] == "revolver" else t["turns"] * e0 for t in tr]] * P).reshape(P, K)
    orig = debts[0].copy()
    rev = next((k for k, t in enumerate(tr) if t["kind"] == "revolver"), -1)
    rev_cap = tr[rev]["turns"] * e0 if rev >= 0 else 0.0
    cash = np.full(P, float(st["minCash"]))
    prev_e = np.full(P, e0)
    first = np.full(P, -1)
    defaulted = np.full(P, -1)
    ltm_e = np.zeros((P, 0))
    ltm_i = np.zeros((P, 0))
    cov = st["covenants"]
    years = int(st["years"])
    yl, yc = np.zeros(P, bool), np.zeros(P, bool)
    out_lev, out_cov, out_ltm, out_nd = [], [], [], []
    last_e = np.full(P, e0)
    last_net = np.full(P, su["debt0"] - st["minCash"])
    order = ([rev] + [k for k in range(K) if k != rev]) if rev >= 0 else list(range(K))
    for t in range(1, N + 1):
        E = ebitda[:, t - 1]
        s = sofr[:, t - 1]
        e = E / ppy
        interest = np.zeros(P)
        for k in range(K):
            sp = revolver_spread[:, t - 1] if (k == rev and revolver_spread is not None) else None
            interest += debts[:, k] * _rate(tr[k], s, sp) / ppy
        ebit = e * (1 - st["daPct"] / 100)
        taxes = np.maximum(0, ebit - interest) * (st["tax"] / 100)
        dnwc = (E - prev_e) * (st["nwcPct"] / 100)
        fcf = e - interest - taxes - e * (st["capexPct"] / 100) - dnwc
        amort = np.zeros(P)
        for k in range(K):
            pct = tr[k].get("amortPct", 0.0) or 0.0
            if not pct or tr[k]["kind"] == "revolver":
                continue
            a = np.minimum(debts[:, k], orig[k] * pct / 100 / ppy)
            debts[:, k] -= a
            amort += a
        pay = np.maximum(0, fcf - amort) * (st["sweep"] / 100)
        swept = np.zeros(P)
        for k in order:
            if k != rev and not tr[k]["prepayable"]:
                continue
            x = np.minimum(debts[:, k], np.maximum(pay, 0))
            debts[:, k] -= x
            pay -= x
            swept += x
        cash = cash + fcf - amort - swept
        if rev >= 0:
            need = st["minCash"] - cash
            draw = np.where(need > 0, np.minimum(rev_cap - debts[:, rev], need), 0.0)
            draw = np.maximum(draw, 0.0)
            debts[:, rev] += draw
            cash = cash + draw
            defaulted = np.where((cash < 0) & (defaulted < 0), t, defaulted)
        ltm_e = np.concatenate([ltm_e, e[:, None]], axis=1)[:, -ppy:]
        ltm_i = np.concatenate([ltm_i, interest[:, None]], axis=1)[:, -ppy:]
        scale = ppy / ltm_e.shape[1]
        LE = ltm_e.sum(axis=1) * scale
        LI = ltm_i.sum(axis=1) * scale
        net = debts.sum(axis=1) - cash
        with np.errstate(divide="ignore", invalid="ignore"):
            lev = np.where(LE > 0, net / LE, np.inf)
            cover = np.where(LI > 0, LE / LI, np.inf)
        if cov.get("springing"):
            tested = (rev_cap > 0) & (rev >= 0) & (debts[:, rev] > cov.get("springAt", 0.35) * rev_cap) if rev >= 0 else np.zeros(P, bool)
        else:
            tested = np.ones(P, bool)
        lf = tested & (cov.get("maxNetLeverage") is not None) & (lev > (cov.get("maxNetLeverage") or 0))
        cf = tested & (cov.get("minInterestCover") is not None) & (cover < (cov.get("minInterestCover") or 0))
        first = np.where((lf | cf) & (first < 0), t, first)
        yl |= lf
        yc |= cf
        if t % ppy == 0:
            out_lev.append(yl.astype(int))
            out_cov.append(yc.astype(int))
            out_ltm.append(LE.copy())
            out_nd.append(net.copy())
            yl, yc = np.zeros(P, bool), np.zeros(P, bool)
        prev_e = E
        last_e = LE
        last_net = net
    exit_tev = last_e * exit_multiple
    exit_eq = exit_tev - last_net
    moic = exit_eq / su["equity"]
    irr = np.power(np.maximum(moic, 0.0001), 1 / years) - 1
    open_nd = su["debt0"] - st["minCash"]
    return {
        **su, "moic": moic, "irr": irr, "exitEquity": exit_eq, "firstBreach": first, "defaulted": defaulted,
        "lev": out_lev, "cov": out_cov, "ltmE": out_ltm, "netDebt": out_nd, "cash": cash,
        "growth": st["entryMultiple"] * (last_e - e0), "multiple": (exit_multiple - st["entryMultiple"]) * last_e,
        "paydown": open_nd - last_net, "fees": -su["fees"],
    }


def spread_at(sp: dict, drawdown):
    return np.minimum(sp["capBps"], sp["baseBps"] + sp["slopeBpsPerPct"] * np.maximum(0, drawdown) * 100)


def simulate(spec: dict, rng: np.random.Generator) -> dict:
    """Every path's quarterly EBITDA, SOFR, revolver spread and exit multiple, plus the drivers the summary needs."""
    st, macro, rates, op, ex, sp = spec["structure"], spec["macro"], spec["rates"], spec["op"], spec["exit"], spec["spread"]
    years = int(st["years"])
    Q, M, P = years * 4, years * 12, int(spec["paths"])
    by = min(int(spec["breakYear"]), years)
    fits = macro["fits"]
    F = len(fits)
    Z = np.asarray(macro["Z"], float)
    mi, ri, si = macro["market"], macro["rates"], macro["sector"]
    mu = np.array([f["mu"] for f in fits])
    om = np.array([f["omega"] for f in fits])
    al = np.array([f["alpha"] for f in fits])
    ga = np.array([f["gamma"] for f in fits])
    be = np.array([f["beta"] for f in fits])
    v = np.tile(np.array([f["lastVar"] for f in fits]), (P, 1))
    mkt_mean_q = 3 * mu[mi] if mi >= 0 else 0.0
    sec_mean_q = 3 * mu[si] if si >= 0 else 0.0
    cost0 = op["revenue0"] - op["ebitda0"]
    regimes = rates["regimes"]
    Pm = np.array(rates["P"])
    r = np.full(P, float(rates["start"]))
    reg = np.full(P, int(rates["startRegime"]))
    rho = float(rates["rho"])
    R = np.full(P, float(op["revenue0"]))
    nu = np.zeros(P)
    cum = np.zeros(P)
    peak = np.zeros(P)
    mq = np.zeros(P)
    sq = np.zeros(P)
    rq = np.zeros(P)
    sofr0 = rates["start"] + rates["basis"]
    sofr_by = np.full(P, sofr0)
    ebitda = np.zeros((P, Q))
    sofr = np.zeros((P, Q))
    spread = np.zeros((P, Q))
    market_by_year = np.zeros((years, P))
    ebitda_change = np.zeros(P)
    resid = np.asarray(op.get("residuals") or [], float)
    phi = np.array([g["phi"] for g in regimes])
    rmu = np.array([g["mu"] for g in regimes])
    sig = np.array([g["sigma"] for g in regimes])
    for m in range(M):
        z = Z[rng.integers(0, Z.shape[0], P)]
        e = np.sqrt(v) * z
        v = om + (al + np.where(e < 0, ga, 0)) * e * e + be * v
        ret = mu + e
        zr = z[:, ri] if ri >= 0 else np.zeros(P)
        eps = rho * zr + math.sqrt(max(0.0, 1 - rho * rho)) * rng.standard_normal(P)
        r = np.maximum(0, r + phi[reg] * (rmu[reg] - r) + sig[reg] * eps)
        reg = np.where(rng.random(P) < Pm[reg, 1], 1, 0)
        mk = ret[:, mi] if mi >= 0 else np.zeros(P)
        mq += mk
        sq += ret[:, si] if si >= 0 else 0
        rq += r + rates["basis"]
        cum += mk
        peak = np.maximum(peak, cum)
        if (m + 1) % 3 == 0:
            t = (m + 1) // 3 - 1
            res = resid[rng.integers(0, len(resid), P)] if len(resid) >= 8 else op["residSd"] * rng.standard_normal(P)
            g = op["growthQ"] + op["betaMarket"] * (mq - mkt_mean_q) + op["betaSector"] * (sq - sec_mean_q) + res
            R = R * np.exp(np.clip(g, -0.5, 0.5))
            nu = (1 - op["marginKappa"]) * nu + op["marginSd"] * rng.standard_normal(P)
            costs = op["fixedShare"] * cost0 * math.exp(op["costInflQ"] * (t + 1)) + (1 - op["fixedShare"]) * cost0 * (R / op["revenue0"])
            ebitda[:, t] = R - costs + nu * R
            sofr[:, t] = rq / 3
            spread[:, t] = spread_at(sp, 1 - np.exp(cum - peak))
            if (t + 1) % 4 == 0:
                market_by_year[(t + 1) // 4 - 1] = cum
            if t + 1 == by * 4:
                sofr_by = sofr[:, t].copy()
                ebitda_change = ebitda[:, t] / op["ebitda0"] - 1
            mq[:] = 0
            sq[:] = 0
            rq[:] = 0
    noise = rng.standard_normal(P)
    expected = mkt_mean_q * Q
    x = np.clip(ex["base"] * np.exp(ex["elasticity"] * (cum - expected) + ex["sigma"] * noise), ex["base"] * 0.3, ex["base"] * 3)
    return {"ebitda": ebitda, "sofr": sofr, "spread": spread, "exit": x, "rateChange": (sofr_by - sofr0) * 100, "ebitdaChange": ebitda_change,
            "marketByYear": market_by_year, "exitNoise": noise}


def prob_above(st: dict, sim: dict, multiple: float, hurdle: float) -> float:
    try:
        r = lbo_paths({**st, "entryMultiple": multiple}, sim["ebitda"], sim["sofr"], sim["exit"], sim["spread"])
    except ValueError:
        return 0.0
    return float(np.mean((r["irr"] >= hurdle) & (r["defaulted"] < 0)))


def max_entry(st: dict, sim: dict, hurdle: float, confidence: float) -> dict:
    centre = st["entryMultiple"]
    curve = [{"multiple": round(centre * k * 10) / 10, "prob": 0.0} for k in (0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5)]
    for c in curve:
        c["prob"] = prob_above(st, sim, c["multiple"], hurdle)
    debt = sum(t["turns"] for t in st["tranches"] if t["kind"] != "revolver") * st["ebitda0"]
    floor = (debt * (1 - st["financeFeePct"] / 100) - st["minCash"]) / (st["ebitda0"] * (1 + st["txnFeePct"] / 100))
    lo = max(1.0, floor + 0.25)
    hi = max(lo + 1, centre * 2)
    if prob_above(st, sim, lo, hurdle) < confidence:
        return {"multiple": None, "tev": None, "hurdle": hurdle, "confidence": confidence, "curve": curve}
    for _ in range(18):
        mid = (lo + hi) / 2
        if prob_above(st, sim, mid, hurdle) >= confidence:
            lo = mid
        else:
            hi = mid
    return {"multiple": lo, "tev": lo * st["ebitda0"], "hurdle": hurdle, "confidence": confidence, "curve": curve}


def refine(spec: dict) -> dict:
    """The refine: simulate, run the buyout down every path, and return the per-path outcomes and the max-price search."""
    paths = int(spec.get("paths") or 20000)
    if not (100 <= paths <= 20000):
        raise ValueError("paths must be between 100 and 20,000")
    st = spec["structure"]
    if int(st.get("years", 5)) > 7:
        raise ValueError("at most seven years")
    rng = np.random.default_rng(int(spec.get("seed") or 1))
    sim = simulate({**spec, "paths": paths}, rng)
    r = lbo_paths(st, sim["ebitda"], sim["sofr"], sim["exit"], sim["spread"])
    lst = lambda a: [float(x) for x in np.asarray(a).ravel()]  # noqa: E731
    outcomes = {
        "irr": lst(r["irr"]), "moic": lst(r["moic"]), "equity": float(r["equity"]), "exitEquity": lst(r["exitEquity"]),
        "firstBreach": [int(x) for x in r["firstBreach"]], "defaulted": [int(x) for x in r["defaulted"]],
        "lev": [[int(x) for x in y] for y in r["lev"]], "cov": [[int(x) for x in y] for y in r["cov"]],
        "ltmE": [lst(y) for y in r["ltmE"]], "netDebt": [lst(y) for y in r["netDebt"]],
        "growth": lst(r["growth"]), "multiple": lst(r["multiple"]), "paydown": lst(r["paydown"]), "fees": float(r["fees"]),
        "rateChange": lst(sim["rateChange"]), "ebitdaChange": lst(sim["ebitdaChange"]), "exitNoise": lst(sim["exitNoise"]), "marketByYear": [lst(y) for y in sim["marketByYear"]],
    }
    mp = max_entry(st, sim, float(spec.get("hurdle", 0.2)), float(spec.get("confidence", 0.6)))
    return {"paths": paths, "outcomes": outcomes, "maxPrice": mp, "summary": {"irrP50": float(np.median(r["irr"])), "breachAny": float(np.mean(r["firstBreach"] > 0))}}
