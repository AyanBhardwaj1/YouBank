/**
 * Pilot P1 v2 for idea A1, after the plan review (traces/plan/round1_response.md): realistic error types.
 *
 * Eval type: synthetic_proxy. Same payload generator as v1 (code/probe-verify.ts), seed 20261031.
 * Error types for the wrong figure:
 *   perturb      - true value ±3–30% (v1's only error type)
 *   wrong_field  - another field's true value (prior-year revenue as LTM revenue, operating cash flow as FCF,
 *                  gross profit as operating income, market cap as EV, operating margin as gross margin)
 *   wrong_scale  - the true dollar value written 1000× off ("$2.4 million" for $2.4 billion); dollar figures only
 * Verifier modes:
 *   pool         - Edge checkNumbers as-is over every company's payload (baseline)
 *   entity_typed - only the cited company's payload, money serialised as "$1,950.3 million", ratios as "67.3%"
 *                  and "2.5x", direct matches only (no pairwise derivations)
 *   field_bound  - entity_typed, but each figure is checked only against the one field it claims to state
 *                  (what calc-by-reference / field-level citations would give)
 * Run: pnpm exec tsx sleep-research/code/probe-verify-v2.ts > sleep-research/runs/probe-verify-v2.json
 */
import { checkNumbers } from "../../src/lib/edge/claims/numbers";

let seed = 20261031;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a: number, b: number) => a + (b - a) * rand();
const logU = (a: number, b: number) => Math.exp(between(Math.log(a), Math.log(b)));

type Co = { revenue: number; prior: number; gp: number; oi: number; da: number; ocf: number; capex: number; ni: number; cash: number; debt: number; shares: number; price: number };
function company(): Co {
  const revenue = logU(200, 80_000);
  return { revenue, prior: revenue / between(0.9, 1.4), gp: revenue * between(0.3, 0.85), oi: revenue * between(-0.2, 0.35), da: revenue * between(0.02, 0.08), ocf: revenue * between(-0.05, 0.4), capex: revenue * between(0.01, 0.12), ni: 0, cash: revenue * between(0.05, 1), debt: revenue * between(0, 1.2), shares: logU(50, 3000), price: logU(5, 900) };
}

/** Field values (USD mm, fractions, multiples), the single source of truth for payloads and figures. */
function fields(c: Co): Record<string, { v: number; unit: "usd" | "pct" | "x" }> {
  const fcf = c.ocf - c.capex, mcap = c.price * c.shares, ev = mcap + c.debt - c.cash;
  return {
    revenue: { v: c.revenue, unit: "usd" }, prior_ltm_revenue: { v: c.prior, unit: "usd" }, gross_profit: { v: c.gp, unit: "usd" }, operating_income: { v: c.oi, unit: "usd" },
    operating_cash_flow: { v: c.ocf, unit: "usd" }, capex: { v: c.capex, unit: "usd" }, fcf: { v: fcf, unit: "usd" }, cash: { v: c.cash, unit: "usd" }, debt: { v: c.debt, unit: "usd" },
    market_cap: { v: mcap, unit: "usd" }, enterprise_value: { v: ev, unit: "usd" },
    revenue_growth: { v: c.revenue / c.prior - 1, unit: "pct" }, gross_margin: { v: c.gp / c.revenue, unit: "pct" }, operating_margin: { v: c.oi / c.revenue, unit: "pct" }, fcf_margin: { v: fcf / c.revenue, unit: "pct" },
    ev_to_ltm_revenue: { v: ev / c.revenue, unit: "x" },
  };
}

const money = (mm: number) => `$${mm.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} million`;
const ser = (f: { v: number; unit: string }, typed: boolean) => (!typed ? (f.unit === "usd" ? Math.round(f.v * 10) / 10 : f.v) : f.unit === "usd" ? money(f.v) : f.unit === "pct" ? `${(f.v * 100).toFixed(1)}%` : `${f.v.toFixed(1)}x`);
const payload = (c: Co, typed: boolean) => Object.fromEntries(Object.entries(fields(c)).map(([k, f]) => [k, ser(f, typed)]));

/** How an analyst writes each figure kind; `field` is the field the sentence claims to state. */
const usdW = (mm: number) => (Math.abs(mm) >= 1000 ? `$${(mm / 1000).toFixed(1)} billion` : `$${Math.round(mm)} million`);
const KINDS: { kind: string; field: string; confuse: string; write: (v: number) => string }[] = [
  { kind: "usd: revenue", field: "revenue", confuse: "prior_ltm_revenue", write: (v) => `LTM revenue was ${usdW(v)}.` },
  { kind: "usd: operating income", field: "operating_income", confuse: "gross_profit", write: (v) => `Operating income came to ${usdW(v)}.` },
  { kind: "usd: free cash flow", field: "fcf", confuse: "operating_cash_flow", write: (v) => `Free cash flow was ${usdW(v)}.` },
  { kind: "usd: enterprise value", field: "enterprise_value", confuse: "market_cap", write: (v) => `Enterprise value is ${usdW(v)}.` },
  { kind: "pct: gross margin", field: "gross_margin", confuse: "operating_margin", write: (v) => `Gross margin is ${(v * 100).toFixed(1)}%.` },
  { kind: "pct: revenue growth", field: "revenue_growth", confuse: "fcf_margin", write: (v) => `Revenue grew ${(v * 100).toFixed(1)}% year over year.` },
  { kind: "x: EV/revenue", field: "ev_to_ltm_revenue", confuse: "ev_to_ltm_revenue", write: (v) => `It trades at ${v.toFixed(1)}x LTM revenue.` },
];

type Mode = "pool" | "entity_typed" | "field_bound";
const MODES: Mode[] = ["pool", "entity_typed", "field_bound"];
const ERRORS = ["perturb", "wrong_field", "wrong_scale"] as const;
const SIZE = 5, TRIALS = 300;

type T = { n: number; accepted: number };
const res: Record<Mode, { trueAccept: T; falseAccept: Record<string, T> }> = Object.fromEntries(MODES.map((m) => [m, { trueAccept: { n: 0, accepted: 0 }, falseAccept: Object.fromEntries(ERRORS.map((e) => [e, { n: 0, accepted: 0 }])) }])) as never;

const verdict = (mode: Mode, sentence: string, cos: Co[], field: string) => {
  if (mode === "pool") return checkNumbers(sentence, [JSON.stringify(cos.map((c) => payload(c, false)))]).share === 1;
  const passage = mode === "entity_typed" ? JSON.stringify(payload(cos[0], true)) : JSON.stringify({ [field]: ser(fields(cos[0])[field], true) });
  const r = checkNumbers(sentence, [passage]);
  return r.found === r.checked;
};

for (let t = 0; t < TRIALS; t++) {
  const cos = Array.from({ length: SIZE }, company);
  const f = fields(cos[0]);
  for (const k of KINDS) {
    const truth = f[k.field].v;
    const wrongs: Partial<Record<(typeof ERRORS)[number], number>> = {
      perturb: truth * (1 + (rand() < 0.5 ? -1 : 1) * between(0.03, 0.3)),
      ...(k.confuse !== k.field ? { wrong_field: f[k.confuse].v } : {}),
      ...(f[k.field].unit === "usd" ? { wrong_scale: rand() < 0.5 ? truth / 1000 : truth * 1000 } : {}),
    };
    for (const mode of MODES) {
      res[mode].trueAccept.n++; if (verdict(mode, k.write(truth), cos, k.field)) res[mode].trueAccept.accepted++;
      for (const [e, w] of Object.entries(wrongs)) {
        const cell = res[mode].falseAccept[e]; cell.n++;
        if (verdict(mode, k.write(w as number), cos, k.field)) cell.accepted++;
      }
    }
  }
}

const rate = (x: T) => Math.round((x.accepted / x.n) * 1000) / 1000;
console.log(JSON.stringify({
  probe: "P1 v2: verify-every-figure with realistic error types", evalType: "synthetic_proxy", seed: 20261031, companiesInContext: SIZE, trials: TRIALS,
  results: Object.fromEntries(MODES.map((m) => [m, { trueAccept: { rate: rate(res[m].trueAccept), n: res[m].trueAccept.n }, falseAccept: Object.fromEntries(ERRORS.map((e) => [e, { rate: rate(res[m].falseAccept[e]), n: res[m].falseAccept[e].n }])) }])),
}, null, 2));
