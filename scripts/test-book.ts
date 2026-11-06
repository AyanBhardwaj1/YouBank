/** The Book (src/lib/book/position.ts): pnpm exec tsx scripts/test-book.ts */
import { derive } from "@/lib/metrics";
import type { CompanyData } from "@/lib/types";
import { byUrgency, checkCriterion, evaluate, fmtMetric, normalizeBook, normalizePosition, POSITIONS_MAX, redTeamPrompt, summarize, TEMPLATES, type Position } from "@/lib/book/position";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

// A company: LTM revenue $4,520M (+24.7%), gross margin 66.8%, op margin -27.7%, FCF $1,010M, net debt -$400M, price $180.
const co = {
  ticker: "SNOW", name: "Snowflake Inc.",
  ltm: { periodEnd: "2026-07-31", revenue: 4520.5, priorRevenue: 3626.4, grossProfit: 3020, operatingIncome: -1250, da: null, sbc: null, ebitda: null, adjEbitda: null, operatingCashFlow: 1100, capex: 90, netIncome: -1200 },
  balance: { asOf: "2026-07-31", cash: 1200, debt: 800, sharesOut: 330 },
  price: { last: 180, change: 2, changePct: 0.011, marketCap: 59400, low52: 120, high52: 220, asOf: "2026-11-05T20:00:00Z", source: "FMP" },
  estimates: { ntmRevenue: null, ntmEbitda: null, source: null },
  sources: { concepts: {}, notes: [], factsUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001640147.json", submissionsUrl: "" },
  quarters: [], filings: [],
} as unknown as CompanyData;
const d = derive(co);
const now = new Date("2026-11-06T12:00:00Z");

console.log("cleaning");
ok("a position needs a ticker and a thesis", [normalizePosition({ ticker: "", thesis: "x" }), normalizePosition({ ticker: "SNOW", thesis: "  " })], [null, null]);
const t = normalizePosition({
  ticker: "$snow", weight: "4.5", entry: 150, thesis: "Consumption growth re-accelerates as AI workloads land.", direction: "long", pillars: ["AI data workloads", "", "Net retention bottoms"],
  criteria: [
    { metric: "revenue_growth", op: ">=", value: 20 },
    { metric: "gross_margin", op: ">=", value: 70 },
    { metric: "price", op: ">=", value: 150, note: "stop" },
    { metric: "bogus", op: ">=", value: 1 },
    { metric: "pe", op: "~", value: 1 },
  ],
  catalysts: [{ label: "Q3 earnings", date: "2026-11-19" }, { label: "bad date", date: "soon" }],
}, "2026-11-06T00:00:00Z")!;
ok("ticker upper-cased, $ dropped; empty pillars dropped", [t.ticker, t.pillars], ["SNOW", ["AI data workloads", "Net retention bottoms"]]);
ok("unknown metrics and operators are dropped", t.criteria.map((c) => c.metric), ["revenue_growth", "gross_margin", "price"]);
ok("weight and entry parse; nonsense is dropped", [t.weight, t.entry, normalizePosition({ ...t, weight: -3, entry: "abc" })?.weight, normalizePosition({ ...t, weight: 500 })?.weight], [4.5, 150, null, null]);
ok("a catalyst needs a real date", t.catalysts.map((c) => c.label), ["Q3 earnings"]);
ok("a red team source must be https", normalizePosition({ ...t, redTeam: { at: "x", text: "y", sources: [{ id: "S1", label: "a", url: "javascript:alert(1)" }, { id: "S2", label: "b", url: "https://sec.gov/x" }] } })?.redTeam?.sources.map((s) => s.id), ["S2"]);
ok("at most POSITIONS_MAX, one per id", normalizeBook([...Array.from({ length: 30 }, (_, i) => ({ ...t, id: `id-${String(i).padStart(4, "0")}` })), { ...t, id: "id-0000" }]).length, POSITIONS_MAX);

console.log("checking criteria");
const growth = checkCriterion(t.criteria[0], co, d);
ok("growth passes with room, from SEC XBRL, with its period", [growth.state, growth.shown, growth.evidence?.source, growth.evidence?.period], ["pass", "24.7%", "SEC XBRL company facts", "LTM to 2026-07-31"]);
const gm = checkCriterion(t.criteria[1], co, d);
ok("gross margin under 70% fails, close or not", [gm.state, gm.shown, gm.target], ["fail", "66.8%", "at least 70.0%"]);
ok("the price stop passes and cites the feed", [checkCriterion(t.criteria[2], co, d).state, checkCriterion(t.criteria[2], co, d).evidence?.source], ["pass", "FMP"]);
ok("within 3 points of a percentage threshold is near", checkCriterion({ id: "x", metric: "revenue_growth", op: ">=", value: 22 }, co, d).state, "near");
ok("within 10% of other thresholds is near", checkCriterion({ id: "x", metric: "price", op: ">=", value: 170 }, co, d).state, "near");
ok("an at-most criterion", checkCriterion({ id: "x", metric: "net_debt", op: "<=", value: 0 }, co, d).state, "pass");
ok("missing data is unknown, never a pass", checkCriterion({ id: "x", metric: "pe", op: "<=", value: 40 }, co, d).state, "unknown");

console.log("the verdict");
const ev = evaluate(t, co, d, [{ id: 1, headline: "Snowflake wins a deal", at: "2026-11-05T00:00:00Z" }], now);
ok("a failed kill criterion breaks the thesis", [ev.verdict, ev.score], ["broken", 67]);
ok("the summary names the criterion", ev.summary, "Kill criterion hit: Gross margin (LTM) is 66.8%, needed at least 70.0%.");
ok("catalysts carry days to go", ev.catalysts.map((c) => [c.label, c.inDays]), [["Q3 earnings", 13]]);
const intact = evaluate({ ...t, criteria: [t.criteria[0]] }, co, d, [], now);
ok("all criteria with room: intact, with the next catalyst", [intact.verdict, intact.summary], ["intact", "All 1 criteria hold; Q3 earnings in 13 days."]);
ok("no data: unknown", evaluate(t, null, null, [], now).verdict, "unknown");
ok("no criteria: watch, asking for one", [evaluate({ ...t, criteria: [] }, co, d, [], now).verdict, evaluate({ ...t, criteria: [] }, co, d, [], now).summary], ["watch", "Add a kill criterion so YouBank can tell you when this thesis breaks."]);
ok("most urgent first", [intact, ev, evaluate({ ...t, criteria: [{ id: "n", metric: "revenue_growth", op: ">=", value: 22 }] }, co, d, [], now)].sort(byUrgency).map((e) => e.verdict), ["broken", "watch", "intact"]);

console.log("formatting and the red team");
ok("units", [fmtMetric("gross_margin", 0.668), fmtMetric("pe", 41.23), fmtMetric("revenue", 4520.5), fmtMetric("price", 180), fmtMetric("rule_of_40", 46.9), fmtMetric("pe", null)], ["66.8%", "41.2x", "$4,521M", "$180.00", "46.9", "n/a"]);
const p = redTeamPrompt(t, ev);
ok("the red team argues the other side with sources and checkable signals", [p.includes("short seller"), p.includes("cite every figure"), p.includes("Gross margin (LTM) 66.8% (fail)"), p.includes("checkable signals")], [true, true, true, true]);
ok("a short thesis gets a bull as its red team", redTeamPrompt({ ...t, direction: "short" } as Position, null).includes("long-only bull"), true);

console.log("P&L and the book");
ok("a long gains when the price rises", Math.round((ev.pnl ?? 0) * 1000) / 1000, 0.2);
const shortEv = evaluate({ ...t, direction: "short", entry: 200 } as Position, co, d, [], now);
ok("a short gains when the price falls", Math.round((shortEv.pnl ?? 0) * 1000) / 1000, 0.1);
ok("no entry, no P&L", evaluate({ ...t, entry: null }, co, d, [], now).pnl, null);
const book = summarize([ev, { ...shortEv, weight: 2 }, { ...intact, weight: 3, pnl: null }]);
ok("exposure: long, short, gross, net", [book.long, book.short, book.gross, book.net], [7.5, 2, 9.5, 5.5]);
ok("at-risk weight counts broken and watch", [book.verdicts.broken, book.atRiskWeight], [2, 6.5]);
ok("P&L contribution weights each position", book.pnlContribution, 1.1);
ok("an empty book has no P&L", summarize([]).pnlContribution, null);
ok("every template normalizes", TEMPLATES.map((x) => normalizePosition({ ticker: "ABC", ...x })?.criteria.length), [3, 3, 3, 3]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
