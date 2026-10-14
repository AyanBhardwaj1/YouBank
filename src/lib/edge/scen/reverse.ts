/**
 * The reverse stress test (E6): the gentlest plausible scenario that breaks the deal. Among scenarios that are
 * a tilt of the simulated distribution along a direction in driver space (rates up, EBITDA down, or any mix),
 * find the one closest to the base model, by relative entropy, under which the covenant breach by year N
 * becomes the even-odds outcome. Each tilt is Entropy Pooling (views.ts) with one view, the driver mix's mean;
 * the mean is set by bisection so the breach probability reaches the target. The winner is reported in words
 * with its plausibility: exp(-relative entropy), the "effective probability" of that view under the base
 * model. The unrestricted minimum (tilting only the breaching paths up) is reported too, as the floor no
 * scenario can beat. Pure, tested on a toy case whose answer is known.
 */
import { entropyPool } from "./views";

export type ReverseResult = {
  ok: boolean; base: number; target: number;
  /** The scenario: mean SOFR change (bp) and mean EBITDA change (fraction) to year N under the tilted model. */
  scenario: { rates: number; ebitda: number } | null; baseMeans: { rates: number; ebitda: number };
  kl: number | null; effective: number | null; floorKl: number | null; direction: { rates: number; ebitda: number } | null;
  quarter: number | null; sentence: string;
};

const klOf = (q: Float64Array, p: number) => { let s = 0; for (const v of q) if (v > 0) s += v * Math.log(v / p); return s; };

/** Relative entropy of the cheapest tilt reaching P(event) = c from p: c ln(c/p) + (1-c) ln((1-c)/(1-p)). Pure. */
export function floorKl(p: number, c: number): number {
  if (p >= c) return 0;
  if (p <= 0) return Infinity;
  return c * Math.log(c / p) + (1 - c) * Math.log((1 - c) / (1 - p));
}

export function reverseStress(drivers: { rates: Float64Array; ebitda: Float64Array }, event: Uint8Array, opts: { target?: number; directions?: number; firstBreach?: Float64Array; covenant?: string; year?: number } = {}): ReverseResult {
  const J = event.length, target = opts.target ?? 0.5, D = opts.directions ?? 48;
  const base = event.reduce((a, b) => a + b, 0) / Math.max(1, J);
  const mean = (x: Float64Array, w?: Float64Array) => { let s = 0; for (let i = 0; i < J; i++) s += (w ? w[i] : 1 / J) * x[i]; return s; };
  const baseMeans = { rates: mean(drivers.rates), ebitda: mean(drivers.ebitda) };
  const empty = { ok: false, base, target, scenario: null, baseMeans, kl: null, effective: null, floorKl: null, direction: null, quarter: null };
  if (J < 50) return { ...empty, sentence: "Too few paths for a reverse stress test." };
  if (base >= target) return { ...empty, ok: true, scenario: baseMeans, kl: 0, effective: 1, floorKl: 0, sentence: `The base case already breaches: ${Math.round(base * 100)}% of paths fail ${opts.covenant ?? "the covenant"} by year ${opts.year ?? "N"}.` };
  if (base === 0) return { ...empty, sentence: `No simulated path breaches ${opts.covenant ?? "the covenant"} by year ${opts.year ?? "N"}, so no tilt of these paths reaches it; the deal survives every scenario drawn.` };
  const sd = (x: Float64Array, m: number) => Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / J) || 1;
  const zr = Float64Array.from(drivers.rates, (v) => (v - baseMeans.rates) / sd(drivers.rates, baseMeans.rates));
  const ze = Float64Array.from(drivers.ebitda, (v) => (v - baseMeans.ebitda) / sd(drivers.ebitda, baseMeans.ebitda));
  const prior = new Float64Array(J).fill(1 / J), ev = Float64Array.from(event);
  let best: { kl: number; q: Float64Array; dir: { rates: number; ebitda: number } } | null = null;
  for (let k = 0; k < D; k++) {
    const a = (2 * Math.PI * k) / D, dr = Math.cos(a), de = Math.sin(a);
    const x = Float64Array.from(zr, (v, i) => dr * v + de * ze[i]);
    // Is the breach more likely at the top of this mix? Otherwise tilting along it cannot help.
    const top = mean(Float64Array.from(x, (v, i) => v * ev[i]), undefined) / Math.max(1e-9, base);
    if (top <= 0) continue;
    const xmax = Math.max(...x);
    let lo = 0, hi = xmax * 0.98, q: Float64Array | null = null;
    const solve = (m: number) => { const r = entropyPool(prior, [x], [m]); return r.ok ? r.q : null; };
    const qHi = solve(hi);
    if (!qHi || mean(ev, qHi) < target) continue;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2, qm = solve(mid);
      if (!qm) { hi = mid; continue; }
      if (mean(ev, qm) >= target) { hi = mid; q = qm; } else lo = mid;
    }
    if (!q) q = qHi;
    const kl = klOf(q, 1 / J);
    if (!best || kl < best.kl) best = { kl, q, dir: { rates: dr, ebitda: de } };
  }
  const fl = floorKl(base, target);
  if (!best) return { ...empty, floorKl: fl, sentence: `No tilt toward higher rates or lower EBITDA makes a breach by year ${opts.year ?? "N"} the even-odds outcome; breaches here come from paths no simple scenario describes (${Math.round(base * 100)}% of paths).` };
  const scenario = { rates: mean(drivers.rates, best.q), ebitda: mean(drivers.ebitda, best.q) };
  let quarter: number | null = null;
  if (opts.firstBreach) {
    const qs: { t: number; w: number }[] = [];
    for (let i = 0; i < J; i++) if (event[i] && opts.firstBreach[i] > 0) qs.push({ t: opts.firstBreach[i], w: best.q[i] });
    qs.sort((a, b) => a.t - b.t);
    const tot = qs.reduce((s, v) => s + v.w, 0);
    let c = 0;
    for (const v of qs) { c += v.w; if (c >= tot / 2) { quarter = v.t; break; } }
  }
  const eff = Math.exp(-best.kl);
  const sign = (v: number, unit: string, dp = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}${unit}`;
  const dRates = scenario.rates - baseMeans.rates, dE = scenario.ebitda;
  const odds = eff >= 0.5 ? "a likely case" : `about 1 in ${Math.max(2, Math.round(1 / eff))}`;
  const sentence = `${dRates >= 25 || dRates <= -25 ? `Rates ${sign(dRates, "bp")} with ` : ""}EBITDA ${sign(dE * 100, "%")} from entry by year ${opts.year ?? "N"} breaches ${opts.covenant ?? "the covenant"}${quarter ? ` in Q${quarter}` : ""}. Under the base model that view has an effective probability of ${odds} (relative entropy ${best.kl.toFixed(2)}; no scenario can be gentler than ${fl.toFixed(2)}).`;
  return { ok: true, base, target, scenario, baseMeans, kl: best.kl, effective: eff, floorKl: fl, direction: best.dir, quarter, sentence };
}
