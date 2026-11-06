/** The Book (src/lib/book/position.ts): pnpm exec tsx scripts/test-book.ts */
import { derive } from "@/lib/metrics";
import type { CompanyData } from "@/lib/types";
import { alertsFor, needsPoint, normalizeBookState, recordHistory, streakOf } from "@/lib/book/alerts";
import { byUrgency, checkCriterion, defaultTemplate, headroomOf, evaluate, fmtMetric, normalizeBook, normalizePosition, parseImport, POSITIONS_MAX, redTeamPrompt, SAMPLE_BOOK, summarize, TEMPLATES, type Position } from "@/lib/book/position";

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

console.log("getting a book in");
const sheet = parseImport("Ticker\tSide\tWeight\tEntry\tThesis\nSNOW\tLong\t4.5%\t$150.00\tAI workloads re-accelerate consumption\ninTC\tshort\t3\t30\tFoundry burns cash\n\tlong\t2\t10\tno ticker here");
ok("a pasted sheet: header skipped, cells read by what they hold", sheet.rows, [{ ticker: "SNOW", direction: "long", weight: 4.5, entry: 150, thesis: "AI workloads re-accelerate consumption" }, { ticker: "INTC", direction: "short", weight: 3, entry: 30, thesis: "Foundry burns cash" }]);
ok("a line without a ticker is reported, not guessed", sheet.problems.length, 1);
ok("column order is free; a negative weight is a short; quoted commas stay", parseImport('"Cheap, and getting cheaper", -2.5, BRK.B').rows, [{ ticker: "BRK.B", direction: "short", weight: 2.5, entry: null, thesis: "Cheap, and getting cheaper" }]);
ok("semicolons; a bare ticker", parseImport("MSFT;5;410\nAAPL").rows.map((r) => [r.ticker, r.weight, r.entry]), [["MSFT", 5, 410], ["AAPL", null, null]]);
ok("duplicates are reported; the cap holds", [parseImport("MSFT\nMSFT").problems.length, parseImport(Array.from({ length: 30 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${i}`).join("\n")).rows.length], [1, POSITIONS_MAX]);
ok("templates by side", [defaultTemplate("long").id, defaultTemplate("short").id], ["growth", "short"]);
ok("the sample book is valid and says it is a sample", SAMPLE_BOOK.map((p) => { const n = normalizePosition({ ...p, id: `sample-${p.ticker.toLowerCase()}` }); return !!n && n.criteria.length === p.criteria.length && n.thesis.startsWith("Sample:"); }), [true, true, true, true, true]);

console.log("alerts");
const mk = (id: string, verdict: "intact" | "watch" | "broken" | "unknown", extra: Partial<typeof ev> = {}) => ({ ...ev, positionId: id, ticker: id.toUpperCase(), verdict, catalysts: [], ...extra });
const first = alertsFor(normalizeBookState(null), [mk("a", "broken"), mk("b", "watch"), mk("c", "intact")], now);
ok("first sight: only a thesis already broken alerts", first.alerts.map((a) => [a.positionId, a.kind, a.urgent]), [["a", "broken", true]]);
ok("the baseline is kept", first.next.verdicts, { a: "broken", b: "watch", c: "intact" });
const second = alertsFor(first.next, [mk("a", "broken"), mk("b", "broken"), mk("c", "watch")], new Date("2026-11-07T21:30:00Z"));
ok("changes alert: watch→broken, intact→watch; still broken says nothing", second.alerts.map((a) => [a.positionId, a.kind]), [["b", "broken"], ["c", "watch"]]);
ok("the alert names the criterion and the weight", second.alerts[0].reasons, ["Gross margin (LTM) 66.8% vs at least 70.0%", "4.5% of NAV"]);
const third = alertsFor(second.next, [mk("a", "intact"), mk("b", "unknown"), mk("c", "watch")], new Date("2026-11-08T21:30:00Z"));
ok("recovery alerts; no data keeps the last verdict quietly", [third.alerts.map((a) => [a.positionId, a.kind]), third.next.verdicts.b], [[["a", "recovered"]], "broken"]);
ok("keys are per position, verdict and day: a re-run dedupes", alertsFor(first.next, [mk("b", "broken")], new Date("2026-11-07T23:00:00Z")).alerts[0].key, second.alerts[0].key);
const cat = alertsFor(first.next, [mk("c", "intact", { catalysts: [{ id: "q3", label: "Q3 earnings", date: "2026-11-07", inDays: 1 }, { id: "x", label: "Investor day", date: "2026-11-20", inDays: 14 }] })], now);
ok("a catalyst tomorrow alerts once per date; later ones do not", cat.alerts.map((a) => [a.kind, a.title, a.key]), [["catalyst", "C: Q3 earnings tomorrow", "book:c:catalyst:q3:2026-11-07"]]);
ok("stored state is cleaned", normalizeBookState({ verdicts: { a: "broken", b: "nonsense" }, checkedAt: 5, history: { "bad id!": [], c: [] , abcd: [{ d: "2026-11-01", v: "intact", s: 100 }, { d: "x", v: "intact" }] } }), { verdicts: { a: "broken" }, checkedAt: null, history: { abcd: [{ d: "2026-11-01", v: "intact", s: 100 }] } });

console.log("history");
const day = (iso: string) => new Date(`${iso}T21:30:00Z`);
let h = recordHistory({}, [mk("a", "intact", { score: 100 }), mk("b", "unknown")], day("2026-11-02"));
ok("a point a day; no data adds none", [h.a, h.b], [[{ d: "2026-11-02", v: "intact", s: 100 }], []]);
h = recordHistory(h, [mk("a", "watch", { score: 83 })], day("2026-11-02"));
ok("a second check the same day replaces the first", h.a, [{ d: "2026-11-02", v: "watch", s: 83 }]);
h = recordHistory(h, [mk("a", "watch", { score: 83 })], day("2026-11-03"));
h = recordHistory(h, [mk("a", "broken", { score: 67 })], day("2026-11-05"));
ok("closed positions drop out of the history", Object.keys(h), ["a"]);
ok("the streak counts from the first day of the current verdict", [streakOf(h.a, day("2026-11-06")), streakOf(h.a.slice(0, 2), day("2026-11-06"))], [{ since: "2026-11-05", verdict: "broken", days: 1 }, { since: "2026-11-02", verdict: "watch", days: 4 }]);
ok("a read records today's point only when it is missing", [needsPoint(h, [mk("a", "broken")], day("2026-11-05")), needsPoint(h, [mk("a", "broken")], day("2026-11-06")), needsPoint(h, [mk("a", "unknown")], day("2026-11-06"))], [false, true, false]);
ok("history is capped", recordHistory({ a: Array.from({ length: 200 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: "intact" as const, s: 100 })) }, [mk("a", "intact")], day("2026-11-06")).a.length, 180);
ok("the daily check carries the history forward", alertsFor({ verdicts: {}, checkedAt: null, history: { a: [{ d: "2026-11-01", v: "intact", s: 100 }] } }, [mk("a", "intact")], day("2026-11-02")).next.history.a.length, 2);

console.log("headroom");
ok("percentages in points; past the line is negative", [growth.headroom?.shown, gm.headroom?.shown], ["+4.7 pts", "−3.2 pts"]);
ok("a price stop as a share of the stop", checkCriterion(t.criteria[2], co, d).headroom?.shown, "+20.0%");
ok("an at-most criterion counts room downwards; a zero threshold uses the unit", [headroomOf({ id: "x", metric: "ev_revenue", op: "<=", value: 10 }, 8).shown, headroomOf({ id: "x", metric: "net_debt", op: "<=", value: 0 }, -400).shown], ["+20.0%", "+$400M"]);
ok("no data, no headroom", checkCriterion({ id: "x", metric: "pe", op: "<=", value: 40 }, co, d).headroom, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
