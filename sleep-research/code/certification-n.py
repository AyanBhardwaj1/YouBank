"""Labels needed before a stratum can be certified: smallest n such that an exact one-sided binomial test
rejects "bad rate >= alpha" at level delta when the observed bad count is floor(rate * n).
Run: python3 sleep-research/code/certification-n.py"""
from math import comb
def ok(n, k, alpha, delta):
    return sum(comb(n, i) * alpha**i * (1 - alpha)**(n - i) for i in range(k + 1)) <= delta
def need(rate, alpha, delta):
    for n in range(1, 3000):
        if ok(n, int(rate * n), alpha, delta):
            return n
    return None
for a, d in [(0.1, 0.1), (0.05, 0.05), (0.1, 0.05)]:
    print(f"alpha={a} delta={d} n_at_bad_rate_0%={need(0, a, d)} n_at_3%={need(0.03, a, d)} n_at_5%={need(0.05, a, d)}")
