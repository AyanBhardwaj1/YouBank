/**
 * Pilot P1 for idea A1 (verify every figure): how does the existing deterministic number check
 * (src/lib/edge/claims/numbers.ts) behave on chat-style tool payloads?
 *
 * Eval type: synthetic_proxy. Payloads mimic the shape of get_company_financials / get_trading_comps
 * (src/lib/ai/tools.ts summarize(): USD millions as bare numbers, margins and growth as raw fractions).
 * Answers are written the way an analyst writes them. Wrong figures are true figures perturbed by 3-30%.
 *
 * Measures, per payload size (1, 5, 15 companies):
 *   - true-accept rate of correct figures, by figure type
 *   - false-accept rate of wrong figures, split into direct matches and arithmetic derivations
 * Seeded; prints JSON. Run: pnpm exec tsx sleep-research/code/probe-verify.ts > sleep-research/runs/probe-verify.json
 */
import { checkNumbers } from "../../src/lib/edge/claims/numbers";

/**
 * Modes (the verifier variants under test):
 *   pool          - the Edge check as-is over every payload in the answer's context (baseline)
 *   entity        - only the cited entity's own payload, derivations on
 *   entity_direct - only the cited entity's payload, direct matches only (derivations must come from calc)
 *   entity_typed  - as entity_direct, with ratio fields serialised with their unit ("67.3%", "2.5x")
 */
const MODE = (process.argv[2] ?? "pool") as "pool" | "entity" | "entity_direct" | "entity_typed";

let seed = 20261031;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a: number, b: number) => a + (b - a) * rand();
const logU = (a: number, b: number) => Math.exp(between(Math.log(a), Math.log(b)));

type Co = { revenue: number; prior: number; gp: number; oi: number; da: number; ocf: number; capex: number; ni: number; cash: number; debt: number; shares: number; price: number };

function company(): Co {
  const revenue = logU(200, 80_000); // USD mm
  const prior = revenue / between(0.9, 1.4);
  const gp = revenue * between(0.3, 0.85);
  const oi = revenue * between(-0.2, 0.35);
  const da = revenue * between(0.02, 0.08);
  const ocf = revenue * between(-0.05, 0.4);
  const capex = revenue * between(0.01, 0.12);
  return { revenue, prior, gp, oi, da, ocf, capex, ni: oi * between(0.5, 0.9), cash: revenue * between(0.05, 1), debt: revenue * between(0, 1.2), shares: logU(50, 3000), price: logU(5, 900) };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The payload as summarize() would serialise it: raw numbers, fractions for ratios. */
function payload(c: Co, ticker: string, typed = false) {
  const P = (v: number) => (typed ? `${(v * 100).toFixed(1)}%` : v);
  const X = (v: number) => (typed ? `${v.toFixed(1)}x` : v);
  const fcf = c.ocf - c.capex, mcap = c.price * c.shares, ev = mcap + c.debt - c.cash;
  return {
    ticker, ltm_usd_mm: { period_end: "2026-06-30", revenue: r1(c.revenue), prior_ltm_revenue: r1(c.prior), revenue_growth: P(c.revenue / c.prior - 1), gross_profit: r1(c.gp), gross_margin: P(c.gp / c.revenue),
      operating_income: r1(c.oi), operating_margin: P(c.oi / c.revenue), da: r1(c.da), ebitda_reported: r1(c.oi + c.da), operating_cash_flow: r1(c.ocf), capex: r1(c.capex), fcf: r1(fcf), fcf_margin: P(fcf / c.revenue), net_income: r1(c.ni) },
    balance_usd_mm: { as_of: "2026-06-30", cash_and_st_investments: r1(c.cash), debt: r1(c.debt), net_debt: r1(c.debt - c.cash), shares_out_mm: r1(c.shares) },
    valuation_usd_mm: { price: Math.round(c.price * 100) / 100, market_cap: r1(mcap), enterprise_value: r1(ev), ev_to_ltm_revenue: X(ev / c.revenue), pe_ltm: c.ni > 0 ? X(mcap / c.ni) : null },
  };
}

/** True facts about the focus company, written as an analyst would. */
type Fig = { kind: string; value: number; write: (v: number) => string };
function figures(c: Co): Fig[] {
  const usd = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)} billion` : `$${Math.round(v)} million`);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const x = (v: number) => `${v.toFixed(1)}x`;
  const fcf = c.ocf - c.capex, mcap = c.price * c.shares, ev = mcap + c.debt - c.cash;
  return [
    { kind: "usd: revenue", value: c.revenue, write: (v) => `LTM revenue was ${usd(v)}.` },
    { kind: "usd: operating income", value: c.oi, write: (v) => `Operating income came to ${usd(v)}.` },
    { kind: "usd: free cash flow", value: fcf, write: (v) => `Free cash flow was ${usd(v)}.` },
    { kind: "usd: enterprise value", value: ev, write: (v) => `Enterprise value is ${usd(v)}.` },
    { kind: "pct: gross margin", value: c.gp / c.revenue, write: (v) => `Gross margin is ${pct(v)}.` },
    { kind: "pct: revenue growth", value: c.revenue / c.prior - 1, write: (v) => `Revenue grew ${pct(v)} year over year.` },
    { kind: "x: EV/revenue", value: ev / c.revenue, write: (v) => `It trades at ${x(v)} LTM revenue.` },
  ];
}

const SIZES = [1, 5, 15];
const TRIALS = 300;
type Tally = { n: number; ok: number; direct: number; derived: number };
const tally = () => ({ n: 0, ok: 0, direct: 0, derived: 0 });
const out: Record<string, { trueAccept: Record<string, Tally>; falseAccept: Record<string, Tally>; numbersInPayload: number }> = {};

for (const size of SIZES) {
  const res = { trueAccept: {} as Record<string, Tally>, falseAccept: {} as Record<string, Tally>, numbersInPayload: 0 };
  let numCount = 0;
  for (let t = 0; t < TRIALS; t++) {
    const cos = Array.from({ length: size }, company);
    const all = JSON.stringify(cos.map((c, i) => payload(c, `T${i}`)));
    const text = MODE === "pool" ? all : JSON.stringify(payload(cos[0], "T0", MODE === "entity_typed"));
    numCount += (text.match(/-?\d+(?:\.\d+)?/g) ?? []).length;
    for (const f of figures(cos[0])) {
      const tr = (res.trueAccept[f.kind] ??= tally());
      const good = checkNumbers(f.write(f.value), [text]);
      const pass = (r: ReturnType<typeof checkNumbers>) => (MODE === "entity_direct" || MODE === "entity_typed" ? r.found === r.checked : r.share === 1);
      tr.n++; if (pass(good)) { tr.ok++; if (good.found) tr.direct++; else tr.derived++; }
      const fa = (res.falseAccept[f.kind] ??= tally());
      const sign = rand() < 0.5 ? -1 : 1;
      const wrong = f.value * (1 + sign * between(0.03, 0.3));
      const bad = checkNumbers(f.write(wrong), [text]);
      fa.n++; if (pass(bad)) { fa.ok++; if (bad.found) fa.direct++; else fa.derived++; }
    }
  }
  res.numbersInPayload = Math.round(numCount / TRIALS);
  out[`companies_${size}`] = res;
}

const rate = (t: Tally) => Math.round((t.ok / t.n) * 1000) / 1000;
const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, {
  numbersInPayload: v.numbersInPayload,
  trueAccept: Object.fromEntries(Object.entries(v.trueAccept).map(([kind, t]) => [kind, { rate: rate(t), direct: t.direct, derived: t.derived, n: t.n }])),
  falseAccept: Object.fromEntries(Object.entries(v.falseAccept).map(([kind, t]) => [kind, { rate: rate(t), direct: t.direct, derived: t.derived, n: t.n }])),
}]));
console.log(JSON.stringify({ probe: "P1 verify-every-figure on chat-style payloads", mode: MODE, evalType: "synthetic_proxy", seed: 20261031, trialsPerSize: TRIALS, results: summary }, null, 2));
