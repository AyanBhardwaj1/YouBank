/**
 * Figures matched to their cited source (src/lib/ai/figures.ts): pnpm exec tsx scripts/test-figures.ts
 *
 * Payloads have the shapes get_company_financials and get_trading_comps return (src/lib/ai/tools.ts). The
 * last section injects wrong figures into answers built from generated payloads and checks the
 * pre-registered threshold for the fallback matcher (sleep-research/EXPERIMENT_PLAN.md, K2): at most 10% of
 * perturbed figures (3–30% off) and of 1000x scale slips may match. Seeded; synthetic, not live answers.
 */
import { checkFigures, leavesOf, resolveRef, type ToolRecord } from "@/lib/ai/figures";
import { calcTool } from "@/lib/ai/tools";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const check = (label: string, cond: boolean, detail?: unknown) => ok(label + (cond ? "" : ` (${JSON.stringify(detail)})`), cond, true);

const company = (ticker: string, src: string, px: string, r: { rev: number; prior: number; gp: number; oi: number; fcf: number; ev: number; mcap: number; sic?: string }) => JSON.stringify({
  ticker, name: `${ticker} Inc`, source: src, price_source: px, sic: r.sic ?? "7372 Services-Prepackaged Software", fye: "1231",
  ltm_usd_mm: { period_end: "2026-06-30", revenue: r.rev, prior_ltm_revenue: r.prior, revenue_growth: r.rev / r.prior - 1, gross_profit: r.gp, gross_margin: r.gp / r.rev, operating_income: r.oi, operating_margin: r.oi / r.rev, fcf: r.fcf, fcf_margin: r.fcf / r.rev },
  balance_usd_mm: { as_of: "2026-06-30", cash_and_st_investments: 1200.5, debt: 800, shares_out_mm: 312.4 },
  valuation_usd_mm: { price: 182.33, change_today: "+1.2%", market_cap: r.mcap, enterprise_value: r.ev, ev_to_ltm_revenue: r.ev / r.rev, pe_ltm: 41.2 },
  quarterly_revenue: ["Q2 2026 (2026-06-30): 1430.2"], recent_filings: ["10-Q filed 2026-08-01 for period 2026-06-30"],
});
const rec = (tool: string, output: string, sourceIds: string[]): ToolRecord => ({ tool, input: {}, output, isError: false, sourceIds });

void (async () => {
console.log("leaves are typed by their field names");
const acme = rec("get_company_financials", company("ACME", "S1", "S2", { rev: 5435.2, prior: 4520.1, gp: 3660.7, oi: 701.3, fcf: 1122.9, ev: 54210.4, mcap: 54610.9 }), ["S1", "S2"]);
const leaves = leavesOf(acme);
const find = (p: string) => leaves.find((l) => l.path === p);
ok("USD millions become dollars", find("ltm_usd_mm.revenue")?.value, 5435.2e6);
ok("a margin fraction is a percentage", Math.round((find("ltm_usd_mm.gross_margin")?.value ?? 0) * 10) / 10, 67.4);
ok("EV/revenue is a multiple", find("valuation_usd_mm.ev_to_ltm_revenue")?.unit, "x");
ok("the valuation block answers to the price source and the facts source", find("valuation_usd_mm.enterprise_value")?.sources, ["S2", "S1"]);
ok("the income statement belongs to the facts source only", find("ltm_usd_mm.revenue")?.sources, ["S1"]);
ok("the period is carried", find("ltm_usd_mm.revenue")?.period, "2026-06-30");
ok("SIC codes, years and filing lines are not figures", leaves.some((l) => /sic|fye|recent_filings|quarterly/.test(l.path)), false);
ok("a field's label is readable", find("ltm_usd_mm.prior_ltm_revenue")?.label, "prior LTM revenue");

console.log("figures in an answer");
const answer = "ACME's LTM revenue was $5.4 billion [S1], up 20.2% year over year [S1], with a 67.4% gross margin [S1]. It trades at 10.0x LTM revenue [S2] on an enterprise value of $54.2 billion [S2]. Free cash flow was $1,123 million [S1].";
const r = checkFigures(answer, [acme], [{ id: "S1" }, { id: "S2" }]);
ok("every figure matches its source", r.figures.map((f) => f.status), ["matched", "matched", "matched", "matched", "matched", "matched"]);
ok("the matched field is reported", r.figures[0].field, "revenue");
ok("counts", [r.checkable, r.matched, r.noMatch, r.uncited], [6, 6, 0, 0]);

const wrong = checkFigures("LTM revenue was $5.9 billion [S1]. EV is $54.2 million [S2]. Gross margin is 76.4% [S1].", [acme], [{ id: "S1" }, { id: "S2" }]);
ok("a perturbed figure, a 1000x slip and transposed digits do not match", wrong.figures.map((f) => f.status), ["no_match", "no_match", "no_match"]);

const crossSource = checkFigures("LTM revenue was $5.4 billion [S2]. Operating income was $701 million [S2].", [acme], [{ id: "S1" }, { id: "S2" }]);
ok("a figure cited to the price source is not found among the facts source's values", crossSource.figures.map((f) => f.status), ["no_match", "no_match"]);

const wrongField = checkFigures("LTM revenue was $4.5 billion [S1].", [acme], [{ id: "S1" }]);
ok("a wrong-field figure matches, but the chip names the field it matched", [wrongField.figures[0].status, wrongField.figures[0].field], ["matched", "prior LTM revenue"]);

const calc = rec("calc", JSON.stringify({ results: [{ line: "ev / adj", value: 11.2468 }, { line: "fcf / ni", value: 0.31251 }] }), []);
const derived = checkFigures("EV to adjusted EBITDA is 11.25x [S1], and FCF conversion is 31.3% [S1].", [acme, calc], [{ id: "S1" }]);
ok("figures the run computed with calc count as computed", derived.figures.map((f) => f.status), ["computed", "computed"]);

const text = rec("read_filing", JSON.stringify({ source: "S3", text: "Revenue grew 21% driven by enterprise demand." }), ["S3"]);
const filing = checkFigures("Management says revenue grew 21% [S3]. About 4,000 customers pay over $100k [S3].", [acme, text], [{ id: "S1" }, { id: "S3" }]);
ok("figures citing only filing text are cited, not checked", filing.figures.map((f) => f.status), ["text_only", "text_only", "text_only"]);
ok("an uncited money figure is reported as uncited", checkFigures("Revenue was about $5.4 billion.", [acme]).figures.map((f) => f.status), ["uncited"]);
ok("an uncited plain count is not a claim", checkFigures("There are 3 reasons.", [acme]).figures.length, 0);

console.log("calc by reference and figures near 19xx/20xx");
ok("a reference resolves to the tool's own number", resolveRef([acme], "S1.ltm_usd_mm.revenue"), 5435.2);
ok("a valuation path resolves under the price source", resolveRef([acme], "S2.valuation_usd_mm.enterprise_value"), 54210.4);
ok("an unknown path is null", resolveRef([acme], "S1.ltm_usd_mm.nope"), null);
const ctx = { addSource: () => "S9", value: (ref: string) => resolveRef([acme], ref) };
const out = JSON.parse(await calcTool.run({ script: "S2.valuation_usd_mm.enterprise_value / S1.ltm_usd_mm.revenue" }, ctx)) as { results: { value: number }[]; refs: Record<string, number> };
ok("calc evaluates with referenced values", Math.round(out.results[0].value * 1000) / 1000, 9.974);
ok("calc reports the values it used", out.refs, { "S2.valuation_usd_mm.enterprise_value": 54210.4, "S1.ltm_usd_mm.revenue": 5435.2 });
const tiny = rec("x", JSON.stringify({ source: "S7", yield_pct: 1e-7, big_usd: 3e21 }), ["S7"]);
const tctx = { addSource: () => "S9", value: (ref: string) => resolveRef([tiny], ref) };
const small = JSON.parse(await calcTool.run({ script: "S7.yield_pct * 100\nS7.big_usd / 1e0" .replace("1e0", "1") }, tctx)) as { results?: { value: number }[]; error?: string };
ok("very small and very large referenced values still evaluate", [small.error, small.results?.[0].value, small.results?.[1].value], [undefined, 0.00001, 3e21]);
ok("a bad reference is an error the model can act on", /is not a number in an earlier tool result/.test(await calcTool.run({ script: "S1.ltm_usd_mm.nope * 2" }, ctx)), true);
const nineteen = rec("get_company_financials", company("OLD", "S1", "S2", { rev: 1950.3, prior: 1700, gp: 900, oi: 200, fcf: 150, ev: 5000, mcap: 5200 }), ["S1", "S2"]);
ok("a figure starting 19xx is not taken for a year", checkFigures("Revenue was $1950.3 million [S1].", [nineteen]).figures.map((f) => f.status), ["matched"]);
ok("a year is still not a figure", checkFigures("In 2025 revenue rose [S1].", [nineteen]).figures.length, 0);

console.log("comps grid: each row is its own company");
const comps = rec("get_trading_comps", JSON.stringify({ group: "Infra", rows: [
  { ticker: "ACME", source: "S4", tier: "target", ev_usd_mm: 54210.4, ev_rev_ltm: "10.0x", rev_growth: "20%", gross_margin: "67%", ltm_revenue: "5.4B", ltm_end: "2026-06-30" },
  { ticker: "PEER", source: "S5", tier: "peer", ev_usd_mm: 21000, ev_rev_ltm: "7.1x", rev_growth: "31%", gross_margin: "74%", ltm_revenue: "3.0B", ltm_end: "2026-06-30" },
], peer_count: 1, peer_median: { ev_rev_ltm: "7.1x" } }), ["S4", "S5"]);
const grid = checkFigures("ACME trades at 10.0x [S4] against PEER at 7.1x [S5]; PEER grew 31% [S5].", [comps], [{ id: "S4" }, { id: "S5" }]);
ok("each figure matches its own row", grid.figures.map((f) => f.status), ["matched", "matched", "matched"]);
ok("a peer's multiple cited to the target's row does not match", checkFigures("ACME trades at 7.1x [S4].", [comps], [{ id: "S4" }]).figures[0].status, "no_match");

console.log("injected errors on generated payloads (pre-registered: perturbed and scale slips match at most 10%)");
let seed = 20261102;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a: number, b: number) => a + (b - a) * rand();
const usdW = (mm: number) => (Math.abs(mm) >= 1000 ? `$${(mm / 1000).toFixed(1)} billion` : `$${Math.round(mm)} million`);
const tally = { truth: [0, 0], perturb: [0, 0], scale: [0, 0] };
for (let t = 0; t < 300; t++) {
  const rev = Math.exp(between(Math.log(200), Math.log(80_000)));
  const v = { rev, prior: rev / between(0.9, 1.4), gp: rev * between(0.3, 0.85), oi: rev * between(-0.2, 0.35), fcf: rev * between(-0.05, 0.3), ev: rev * between(1, 15), mcap: rev * between(1, 15) };
  const peers = Array.from({ length: 4 }, (_, i) => rec("get_company_financials", company(`P${i}`, `S${3 + i * 2}`, `S${4 + i * 2}`, { rev: v.rev * between(0.3, 3), prior: v.prior * between(0.3, 3), gp: v.gp * between(0.3, 3), oi: v.oi * between(0.3, 3), fcf: v.fcf * between(0.3, 3), ev: v.ev * between(0.3, 3), mcap: v.mcap * between(0.3, 3) }), [`S${3 + i * 2}`, `S${4 + i * 2}`]));
  const records = [rec("get_company_financials", company("TGT", "S1", "S2", v), ["S1", "S2"]), ...peers];
  const figs: [string, number, (x: number) => string][] = [
    ["S1", v.rev, (x) => `LTM revenue was ${usdW(x)} [S1].`],
    ["S1", v.oi, (x) => `Operating income was ${usdW(x)} [S1].`],
    ["S2", v.ev, (x) => `Enterprise value is ${usdW(x)} [S2].`],
    ["S1", v.gp / v.rev, (x) => `Gross margin is ${(x * 100).toFixed(1)}% [S1].`],
    ["S2", v.ev / v.rev, (x) => `It trades at ${x.toFixed(1)}x LTM revenue [S2].`],
  ];
  for (const [, truth, write] of figs) {
    const run = (x: number) => checkFigures(write(x), records).figures[0]?.status === "matched";
    tally.truth[0]++; if (run(truth)) tally.truth[1]++;
    const off = truth * (1 + (rand() < 0.5 ? -1 : 1) * between(0.03, 0.3));
    // Wrong figures that print the same as the truth at the written precision are not errors a reader could see.
    if (write(off) !== write(truth)) { tally.perturb[0]++; if (run(off)) tally.perturb[1]++; }
    if (/\$/.test(write(truth))) { const slip = rand() < 0.5 ? truth / 1000 : truth * 1000; if (write(slip) !== write(truth)) { tally.scale[0]++; if (run(slip)) tally.scale[1]++; } }
  }
}
const rate = (x: number[]) => x[1] / x[0];
console.log(`       truth matched ${(rate(tally.truth) * 100).toFixed(1)}% (n=${tally.truth[0]}); perturbed matched ${(rate(tally.perturb) * 100).toFixed(1)}% (n=${tally.perturb[0]}); scale slips matched ${(rate(tally.scale) * 100).toFixed(1)}% (n=${tally.scale[0]})`);
check("true figures match at least 97% of the time", rate(tally.truth) >= 0.97, tally.truth);
check("perturbed figures match at most 10%", rate(tally.perturb) <= 0.10, tally.perturb);
check("scale slips match at most 10%", rate(tally.scale) <= 0.10, tally.scale);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
