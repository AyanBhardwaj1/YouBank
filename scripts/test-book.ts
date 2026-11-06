/** The Book (src/lib/book/position.ts): pnpm exec tsx scripts/test-book.ts */
import { derive } from "@/lib/metrics";
import type { CompanyData } from "@/lib/types";
import { alertsFor, gateAlerts, needsPoint, normalizeBookState, recordHistory, streakOf } from "@/lib/book/alerts";
import { netSelling, windowFilings, type InsiderFact } from "@/lib/book/insiders";
import { filingLine, isFresh, latestPeriodic, type FilingFact } from "@/lib/book/filings";
import type { InsiderTx } from "@/lib/edgar/insiders";
import { nextPrint } from "@/lib/book/print";
import { normalizeProposals, proposalFrom, PROPOSALS_MAX, withProposal } from "@/lib/book/proposals";
import { bookRows, byUrgency, checkCriterion, defaultTemplate, DRAFT_SYSTEM, draftToPosition, headroomOf, evaluate, fmtMetric, normalizeBook, normalizePosition, parseImport, POSITIONS_MAX, redTeamPrompt, SAMPLE_BOOK, summarize, TEMPLATES, type Position } from "@/lib/book/position";

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
ok("stored state is cleaned", normalizeBookState({ verdicts: { a: "broken", b: "nonsense" }, checkedAt: 5, history: { "bad id!": [], c: [] , abcd: [{ d: "2026-11-01", v: "intact", s: 100 }, { d: "x", v: "intact" }] } }), { verdicts: { a: "broken" }, checkedAt: null, history: { abcd: [{ d: "2026-11-01", v: "intact", s: 100 }] }, muted: [] });

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
ok("the daily check carries the history forward", alertsFor({ verdicts: {}, checkedAt: null, history: { a: [{ d: "2026-11-01", v: "intact", s: 100 }] }, muted: [] }, [mk("a", "intact")], day("2026-11-02")).next.history.a.length, 2);

console.log("headroom");
ok("percentages in points; past the line is negative", [growth.headroom?.shown, gm.headroom?.shown], ["+4.7 pts", "−3.2 pts"]);
ok("a price stop as a share of the stop", checkCriterion(t.criteria[2], co, d).headroom?.shown, "+20.0%");
ok("an at-most criterion counts room downwards; a zero threshold uses the unit", [headroomOf({ id: "x", metric: "ev_revenue", op: "<=", value: 10 }, 8).shown, headroomOf({ id: "x", metric: "net_debt", op: "<=", value: 0 }, -400).shown], ["+20.0%", "+$400M"]);
ok("no data, no headroom", checkCriterion({ id: "x", metric: "pe", op: "<=", value: 40 }, co, d).headroom, null);

console.log("drafting from words");
const drafted = draftToPosition({ ticker: "snow", direction: "long", thesis: "AI workloads re-accelerate consumption", pillars: ["AI data", ""], criteria: [{ metric: "revenue_growth", op: ">=", value: 20, note: "" }, { metric: "net_revenue_retention", op: ">=", value: 120, note: "" }, { metric: "gross_margin", op: ">=", value: 70, note: "suggested: margins must follow" }], catalysts: [{ label: "Q3", date: "next week" }], weight: 99, id: "attacker-id", redTeam: { at: "x", text: "y", sources: [] } });
ok("a draft is cleaned like a saved position: unknown metrics, bad dates and server fields dropped", [drafted?.ticker, drafted?.criteria.map((c) => c.metric), drafted?.catalysts.length, drafted?.weight, drafted?.id === "attacker-id", !!drafted?.redTeam, drafted?.criteria[1].note], ["SNOW", ["revenue_growth", "gross_margin"], 0, null, false, false, "suggested: margins must follow"]);
ok("no ticker, no draft", draftToPosition({ ticker: "", thesis: "x" }), null);
ok("the brief lists every metric with its unit", ["revenue_growth", "ev_revenue", "US$ millions", "given as percent"].every((w) => DRAFT_SYSTEM.includes(w)), true);

console.log("earnings dates");
const withE = evaluate({ ...t, catalysts: [] }, co, d, [], now, { date: "2026-11-07", estimated: true });
ok("the next earnings date shows with days to go, and counts as a near catalyst", [withE.earnings, withE.summary.includes("earnings in 1 days") || withE.verdict === "broken"], [{ date: "2026-11-07", estimated: true, inDays: 1 }, true]);
ok("far, past or missing dates are left out", [evaluate(t, co, d, [], now, { date: "2027-06-01", estimated: false }).earnings, evaluate(t, co, d, [], now, { date: "2026-10-01", estimated: false }).earnings, evaluate(t, co, d, [], now, { date: null, estimated: false }).earnings], [null, null, null]);
const eAlert = alertsFor(first.next, [{ ...mk("c", "intact"), earnings: { date: "2026-11-07", estimated: true, inDays: 1 } }], now).alerts;
ok("earnings tomorrow alerts once per date", eAlert.map((a) => [a.title, a.key]), [["C reports tomorrow (estimated)", "book:c:earnings:2026-11-07"]]);

console.log("export");
const rows = bookRows([ev, evaluate({ ...t, id: "nocrit", criteria: [] }, co, d, [], now)], [t]);
ok("a header, a row per criterion, and one for a position without criteria; headroom as a number with its unit", [rows.length, rows[0][0], rows[1][10], rows[1][13], rows[1][14], rows[2][13], rows[3][14], rows[4][10]], [5, "ticker", "Revenue growth (LTM, y/y)", 4.7, "pts", -3.2, "% of threshold", ""]);

console.log("insider selling");
const tx = (code: string, shares: number | null, price: number | null, date = "2026-10-01", derivative = false) => ({ filed: date, owner: "o", relationship: "", security: "Common", date, code, codeLabel: "", shares, price, owned: null, acquired: code === "P", derivative, url: "" }) as InsiderTx;
ok("sales less purchases, open market only, in $M", netSelling([tx("S", 100_000, 50), tx("P", 20_000, 50), tx("M", 1e6, 1), tx("F", 5e4, 50), tx("S", 1e5, 50, "2026-07-01"), tx("S", 1e5, 50, "2026-10-01", true)], "2026-08-08"), { value: 4, trades: 2, priced: true });
const amend = (x: InsiderTx) => ({ ...x, amendment: true });
ok("a Form 4/A replaces the lines it restates (no double count); a trade-free amendment changes nothing", [netSelling([tx("S", 100_000, 50), amend(tx("S", 100_000, 50))], "2026-08-08").value, netSelling([tx("S", 100_000, 50), amend(tx("S", 100_000, 40))], "2026-08-08").value, netSelling([tx("S", 100_000, 50), tx("S", 100_000, 50, "2026-10-02"), amend(tx("S", 100_000, 50))], "2026-08-08").value, netSelling([tx("S", 100_000, 50), amend(tx("M", 1e5, 1, "2026-10-01", true))], "2026-08-08").value], [5, 4, 10, 5]);
ok("a counted trade without a price makes the figure incomplete", netSelling([tx("S", 1000, null)], "2026-08-08").priced, false);
const recent = { filingDate: ["2026-11-01", "2026-10-20", "2026-09-01", "2026-07-01"], form: ["4", "8-K", "4/A", "4"] };
ok("filings in the window; complete when the list reaches back before it", [windowFilings(recent, true, "2026-08-08"), windowFilings({ filingDate: ["2026-11-01", "2026-10-01"], form: ["4", "4"] }, true, "2026-08-08").complete, windowFilings({ filingDate: ["2026-11-01", "2026-10-01"], form: ["4", "4"] }, false, "2026-08-08").complete], [{ indexes: [0, 2], complete: true }, false, true]);
const fact = (value: number | null, complete: boolean): InsiderFact => ({ value, complete, filings: 3, trades: 2, since: "2026-08-08", asOf: "2026-11-06T21:30:00Z", url: "https://www.sec.gov/x", note: complete ? "" : "1 of 3 Form 4 filings could not be read" });
const ins = { id: "i1", metric: "insider_selling" as const, op: "<=" as const, value: 5 };
ok("$M amounts: decimals under $10M, the minus before the $", [fmtMetric("insider_selling", 0.45), fmtMetric("insider_selling", 4.56), fmtMetric("insider_selling", -3), fmtMetric("net_debt", -12345), fmtMetric("revenue", 61858.4), fmtMetric("insider_selling", -0.001)], ["$0.45M", "$4.6M", "-$3.0M", "-$12,345M", "$61,858M", "$0.00M"]);
ok("a complete figure is checked, with its filings as evidence", [checkCriterion(ins, co, d, fact(4, true)).state, checkCriterion(ins, co, d, fact(4.6, true)).state, checkCriterion(ins, co, d, fact(4, true)).evidence?.source, checkCriterion(ins, co, d, fact(8, true)).state], ["pass", "near", "SEC Form 4 filings (3 filed, 2 open-market trades)", "fail"]);
ok("an incomplete or missing figure is no data, with the reason, never a pass", [checkCriterion(ins, co, d, fact(0, false)).state, checkCriterion(ins, co, d, fact(0, false)).note, checkCriterion(ins, co, d, null).state, checkCriterion(ins, co, d, null).note], ["unknown", "No complete figure: 1 of 3 Form 4 filings could not be read.", "unknown", "Worked out from Form 4 filings after each US close."]);

console.log("concentration");
const ind = summarize([{ ...ev, industry: "Software", weight: 4 }, { ...ev, positionId: "b", industry: "Software", direction: "short", weight: 1 }, { ...ev, positionId: "c", industry: "Semiconductors", weight: 2 }, { ...ev, positionId: "d", industry: "", weight: null }]).byIndustry;
ok("exposure by industry: long, short, net, largest first", ind, [{ industry: "Software", positions: 2, long: 4, short: 1, gross: 5, net: 3 }, { industry: "Semiconductors", positions: 1, long: 2, short: 0, gross: 2, net: 2 }, { industry: "Unclassified", positions: 1, long: 0, short: 0, gross: 0, net: 0 }]);
ok("a company's industry comes with its evaluation", ev.industry, "Unclassified");

console.log("new filings");
const filing: FilingFact = { form: "10-Q", filed: "2026-11-03", url: "https://www.sec.gov/f", counts: { added: 3, removed: 1, changed: 2, unchanged: 40 }, summary: ["New risk: AI capacity costs."], prior: "2026-08-04", asOf: "2026-11-05T21:30:00Z" };
ok("the newest 10-K or 10-Q is found", latestPeriodic({ filings: [{ form: "8-K", filed: "2026-11-04", period: "", title: "", url: "a" }, { form: "10-Q", filed: "2026-11-03", period: "", title: "", url: "b" }] }), { form: "10-Q", filed: "2026-11-03", url: "b" });
ok("one line on what moved", [filingLine(filing), filingLine({ ...filing, counts: { added: 0, removed: 0, changed: 0, unchanged: 9 } })], ["Risk factors: 3 added, 1 removed, 2 reworded paragraphs against the 10-Q filed 2026-08-04.", "Risk factors unchanged from the 10-Q filed 2026-08-04."]);
ok("fresh for two weeks", [isFresh(filing, now), isFresh({ ...filing, filed: "2026-10-01" }, now), isFresh(null, now)], [true, false, false]);
const withF = evaluate(t, co, d, [], now, null, null, filing);
ok("a fresh filing rides on the evaluation; a stale one does not", [withF.filing?.form, evaluate(t, co, d, [], now, null, null, { ...filing, filed: "2026-09-01" }).filing], ["10-Q", null]);
ok("one alert per filing", alertsFor(first.next, [{ ...mk("c", "intact"), filing }], now).alerts.map((a) => [a.title, a.key]), [["C filed its 10-Q", "book:c:filing:10-Q:2026-11-03"]]);
const fAlerts = alertsFor(first.next, [{ ...mk("c", "intact"), filing }], now).alerts;
const offRun = gateAlerts(fAlerts, [], true), onRun = gateAlerts(fAlerts, offRun.muted, false);
ok("alerts off: nothing sent and the filing remembered; back on, it is not sent late; other alerts still go", [offRun.send.length, offRun.muted, onRun.send.length, gateAlerts([...fAlerts, ...eAlert], offRun.muted, false).send.map((a) => a.key)], [0, ["book:c:filing:10-Q:2026-11-03"], 0, ["book:c:earnings:2026-11-07"]]);

console.log("what the next report must show");
const qs = ["2024-10-31", "2025-01-31", "2025-04-30", "2025-07-31", "2025-10-31", "2026-01-31", "2026-04-30", "2026-07-31"].map((end, i) => ({ label: `Q${i + 1}`, end, revenue: 800 + 50 * i }));
const qco = { ticker: "Q", quarters: qs, ltm: { revenue: 4300 } } as unknown as CompanyData;
const bars = nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }, { id: "r", metric: "revenue", op: ">=", value: 3000 }, { id: "m", metric: "gross_margin", op: ">=", value: 60 }], qco);
ok("growth ≥ 20%: next quarter needs 1.2 × 3,700 − 3,300 = $1,140M, +14.0% on the year-ago quarter", [bars.length, bars[0].need, bars[0].yoy, bars[0].lastYoy, bars[0].yearAgo, bars[0].line], [2, 1140, 0.14, 0.2105, "Q5", "At least $1,140M of revenue next quarter (+14.0% y/y against Q5; last quarter +21.1%) keeps LTM revenue growth at or above 20%."]);
ok("a level the three staying quarters already clear is settled", [bars[1].settled, bars[1].line], [true, "LTM revenue at or above $3,000M holds whatever next quarter's revenue is."]);
ok("no answer when the quarters disagree with the LTM, skip a quarter, or are too few", [nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }], { ...qco, ltm: { revenue: 5000 } } as unknown as CompanyData).length, nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }], { ...qco, quarters: qs.filter((_, i) => i !== 3) } as unknown as CompanyData).length, nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }], { ...qco, quarters: qs.slice(2) } as unknown as CompanyData).length], [0, 0, 0]);
ok("at most: a ceiling the staying quarters already pass cannot hold", nextPrint([{ id: "r", metric: "revenue", op: "<=", value: 3000 }], qco)[0].line, "LTM revenue at or below $3,000M cannot hold after next quarter: the three quarters that stay already exceed it.");
ok("evaluate carries it", evaluate({ ...t, criteria: [{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }] }, { ...co, quarters: qs, ltm: { ...co.ltm, revenue: 4300 } } as unknown as CompanyData, d, [], now).nextPrint?.[0].need, 1140);

console.log("proposals from AI apps");
const pr = proposalFrom({ ticker: "nvda", direction: "long", thesis: "Data-center demand outruns supply through 2027.", kill_criteria: [{ metric: "gross_margin", op: ">=", value: 70 }], weight_pct_nav: 3, rationale: "Margins held above 70% for six quarters [S1]." }, "Claude (connected)", now);
ok("a proposal is a cleaned position, with who sent it and why", "proposal" in pr ? [pr.proposal.position.ticker, pr.proposal.position.weight, pr.proposal.position.criteria.length, pr.proposal.from, /^pr-[a-z0-9]+-[a-z0-9]+$/.test(pr.proposal.id)] : pr, ["NVDA", 3, 1, "Claude (connected)", true]);
ok("no ticker or thesis, or criteria none of which can be read: refused with a reason", [("error" in proposalFrom({ ticker: "", thesis: "x" }, "a", now)), ("error" in proposalFrom({ ticker: "NVDA", thesis: "A thesis here", kill_criteria: [{ metric: "vibes", op: ">=", value: 1 }] }, "a", now))], [true, true]);
if ("proposal" in pr) {
  const again = proposalFrom({ ticker: "NVDA", direction: "long", thesis: "Updated thesis for the same name.", kill_criteria: [{ metric: "gross_margin", op: ">=", value: 72 }] }, "Claude (connected)", new Date(now.getTime() + 1000));
  const other = proposalFrom({ ticker: "NVDA", direction: "long", thesis: "Another app's view.", kill_criteria: [{ metric: "gross_margin", op: ">=", value: 65 }] }, "ChatGPT (connected)", now);
  const list = "proposal" in again && "proposal" in other ? withProposal(withProposal(withProposal([], pr.proposal), other.proposal), again.proposal) : [];
  ok("the same app's newer proposal for the same name and side replaces its older one; another app's stays", list.map((x) => [x.from, x.position.thesis.slice(0, 7)]), [["Claude (connected)", "Updated"], ["ChatGPT (connected)", "Another"]]);
  let many = [] as ReturnType<typeof withProposal>;
  for (let i = 0; i < 14; i++) { const x = proposalFrom({ ticker: `T${String.fromCharCode(65 + i)}`, direction: "long", thesis: "A thesis here." }, "a", now); if ("proposal" in x) many = withProposal(many, { ...x.proposal, id: `pr-${i}-abcd` }); }
  ok("at most ten are kept, newest first; stored junk is dropped", [many.length, many[0].position.ticker, normalizeProposals([...many, { id: "x" }, null, { ...many[0] }]).length], [PROPOSALS_MAX, "TN", PROPOSALS_MAX]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
