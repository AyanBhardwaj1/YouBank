/** The Book (src/lib/book/position.ts): pnpm exec tsx scripts/test-book.ts */
import { derive } from "@/lib/metrics";
import type { CompanyData } from "@/lib/types";
import { alertsFor, gateAlerts, needsPoint, normalizeBookState, recordHistory, streakOf } from "@/lib/book/alerts";
import { netSelling, windowFilings, type InsiderFact } from "@/lib/book/insiders";
import { filingLine, isFresh, latestPeriodic, type FilingFact } from "@/lib/book/filings";
import type { InsiderTx } from "@/lib/edgar/insiders";
import { nextPrint } from "@/lib/book/print";
import { calibrationOf, closedFrom, forecastAlerts, closedReturn, normalizeJournal, scorecard, scorecardLine, type ClosedPosition } from "@/lib/book/journal";
import { calibration, calibrationLine, normalizeConviction, freshForecast, PAST_FORECASTS_MAX, resolveForecast, supersede } from "@/lib/book/forecast";
import { draftLetter, lintLetter } from "@/lib/book/letter";
import { sizingCheck, spearman } from "@/lib/book/sizing";
import { weekBrief } from "@/lib/book/week";
import { bullPrompt, chairPrompt, committeeFrom, normalizeCommittee } from "@/lib/book/committee";
import { bookCalendar, fold, icsText } from "@/lib/book/calendar";
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
ok("a point a day; no data adds none", [h.a, h.b], [[{ d: "2026-11-02", v: "intact", s: 100, p: 180 }], []]);
h = recordHistory(h, [mk("a", "watch", { score: 83 })], day("2026-11-02"));
ok("a second check the same day replaces the first", h.a, [{ d: "2026-11-02", v: "watch", s: 83, p: 180 }]);
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
ok("no answer when the year-before quarters disagree with the reported year-before LTM (a restatement)", [nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }], { ...qco, ltm: { revenue: 4300, priorRevenue: 3700 } } as unknown as CompanyData).length, nextPrint([{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }], { ...qco, ltm: { revenue: 4300, priorRevenue: 3500 } } as unknown as CompanyData).length], [0, 1]);
ok("at most: a ceiling the staying quarters already pass cannot hold", nextPrint([{ id: "r", metric: "revenue", op: "<=", value: 3000 }], qco)[0].line, "LTM revenue at or below $3,000M cannot hold after next quarter: the three quarters that stay already exceed it.");
ok("evaluate carries it", evaluate({ ...t, criteria: [{ id: "g", metric: "revenue_growth", op: ">=", value: 20 }] }, { ...co, quarters: qs, ltm: { ...co.ltm, revenue: 4300, priorRevenue: 3500 } } as unknown as CompanyData, d, [], now).nextPrint?.[0]?.need, 1140);

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

console.log("stop-loss from entry");
const stop = { id: "s1", metric: "return_since_entry" as const, op: ">=" as const, value: -15 };
const sLong = checkCriterion(stop, co, d, null, { entry: 150, direction: "long" }), sShort = checkCriterion(stop, co, d, null, { entry: 150, direction: "short" }), sNone = checkCriterion(stop, co, d, null, { entry: null, direction: "long" });
ok("measured in the position's favour from the entry: a long up 20% holds, a short at the same prices is down 20% and fails", [sLong.state, sLong.shown, sShort.state, sShort.shown, sShort.evidence?.source.includes("against the entry of $150")], ["pass", "20.0%", "fail", "-20.0%", true]);
ok("no entry price: no figure, and why", [sNone.state, sNone.note], ["unknown", "Needs the position's entry price."]);
ok("evaluate passes the position's entry and side", evaluate({ ...t, entry: 150, criteria: [stop] }, co, d, [], now).checks[0].state, "pass");
ok("a draft keeps an entry price the person stated, and never a weight", [draftToPosition({ ticker: "AAPL", direction: "long", thesis: "Services keep compounding.", pillars: [], criteria: [stop], catalysts: [], entry: 150 })?.entry, draftToPosition({ ticker: "AAPL", direction: "long", thesis: "Services keep compounding.", pillars: [], criteria: [], catalysts: [], entry: null, weight: 9 })?.entry, draftToPosition({ ticker: "AAPL", direction: "long", thesis: "Services keep compounding.", pillars: [], criteria: [], catalysts: [], entry: 150, weight: 9 })?.weight], [150, null, null]);
ok("the drafting prompt says how to write a stop-loss", DRAFT_SYSTEM.includes("return_since_entry >= -15"), true);

console.log("calendar");
const calEv = { ...evaluate({ ...t, id: "abcd", catalysts: [{ id: "c1", label: "Investor day; Q&A, live", date: "2026-11-20" }, { id: "c0", label: "Past", date: "2026-11-01" }] }, co, d, [], now, { date: "2026-11-19", estimated: true }), nextPrint: [{ criterionId: "g", metric: "revenue_growth" as const, op: ">=" as const, need: 1140, yoy: 0.14, lastYoy: 0.21, yearAgo: "Q5", settled: false, line: "At least $1,140M of revenue next quarter keeps it." }] };
const ics = bookCalendar([calEv], "https://youbank.example", now);
const vevents = ics.split("BEGIN:VEVENT").length - 1;
ok("an all-day event for the next earnings and each coming catalyst (not past ones), with CRLF lines", [vevents, ics.includes("DTSTART;VALUE=DATE:20261119\r\nDTEND;VALUE=DATE:20261120"), ics.includes("SUMMARY:SNOW earnings (estimated)"), ics.includes("SUMMARY:SNOW: Investor day\\; Q&A\\, live"), ics.endsWith("END:VCALENDAR\r\n"), ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)], [2, true, true, true, true, true]);
ok("the earnings event says what the report must show and links to the position", [ics.replace(/\r\n /g, "").includes("What the report must show:\\nAt least $1\\,140M"), ics.replace(/\r\n /g, "").includes("URL:https://youbank.example/app/book?position=abcd")], [true, true]);
const twice = bookCalendar([calEv, { ...calEv, positionId: "efgh", catalysts: [] }], "https://youbank.example", now);
const moved = bookCalendar([{ ...calEv, earnings: { date: "2026-11-24", estimated: false, inDays: 18 } }], "https://youbank.example", new Date(now.getTime() + 3_600_000));
const uidOf = (x: string) => /UID:(book-earnings-[^\r]+)/.exec(x)?.[1];
const seqOf = (x: string) => Number(/SEQUENCE:(\d+)/.exec(x)?.[1]);
ok("one earnings event per ticker; a moved date keeps the UID with a higher SEQUENCE; a lone CR is escaped", [twice.split("SUMMARY:SNOW earnings").length - 1, uidOf(moved) === uidOf(ics), seqOf(moved) > seqOf(ics), icsText("a\rb")], [1, true, true, "a\\nb"]);
ok("text escaping and folding (never inside a character)", [icsText("a;b,c\\d\ne"), fold("x".repeat(80)).split("\r\n ").map((l) => l.length), fold("é".repeat(40)).split("\r\n ").every((l) => !l.includes("\uFFFD"))], ["a\\;b\\,c\\\\d\\ne", [75, 5], true]);

console.log("track record");
const pos = { ...t, id: "trk1", ticker: "SNOW", direction: "long" as const, entry: 150, createdAt: "2026-06-01T00:00:00.000Z" };
const hist = [{ d: "2026-10-01", v: "intact" as const, s: 100, p: 170 }, { d: "2026-10-10", v: "broken" as const, s: 50, p: 160 }, { d: "2026-10-11", v: "broken" as const, s: 50, p: 155 }];
const c1 = closedFrom(pos, "broken", hist, 140, "thesis_broke", "  margins  ", new Date("2026-10-13T15:00:00Z"));
ok("a close keeps the exit, the reason, the verdict and the first day the thesis broke with its price", [c1.exit, c1.reason, c1.note, c1.verdictAtClose, c1.brokeOn, c1.priceAtBreak, c1.openedAt.slice(0, 10)], [140, "thesis_broke", "margins", "broken", "2026-10-10", 160, "2026-06-01"]);
ok("return in the position's favour", [Math.round(closedReturn(c1)! * 1000) / 1000, Math.round(closedReturn({ entry: 100, exit: 80, direction: "short" })! * 1000) / 1000, closedReturn({ entry: null, exit: 80, direction: "long" })], [-0.067, 0.2, null]);
const mk2 = (id: string, entry: number, exit: number, reason: ClosedPosition["reason"], brokeOn: string | null = null, priceAtBreak: number | null = null, closedAt = "2026-10-20T00:00:00.000Z", direction: "long" | "short" = "long"): ClosedPosition => ({ ...c1, id, entry, exit, reason, brokeOn, priceAtBreak, closedAt, direction });
const book2 = [mk2("a1", 100, 130, "target"), mk2("a2", 100, 90, "thesis_broke", "2026-10-17", 95), mk2("a3", 100, 80, "thesis_broke", "2026-09-01", 98), mk2("a4", 100, 110, "other")];
const sc = scorecard(book2);
ok("hit rate, average, payoff, by reason", [sc.closed, sc.hitRate, sc.avgReturn, sc.avgWin, sc.avgLoss, sc.payoff, sc.byReason.map((r) => [r.reason, r.n, r.avgReturn])], [4, 0.5, 0.025, 0.2, -0.15, 1.3333, [["thesis_broke", 2, -0.15], ["target", 1, 0.3], ["other", 1, 0.1]]]);
ok("discipline: broken theses, exits within five days, median days to exit", [sc.broke, sc.exitedOnBreak, sc.medianDaysToExit], [2, 1, 26]);
ok("the counterfactual: out on the break against the exit taken", sc.counterfactual, { n: 2, onBreak: -0.035, taken: -0.15 });
ok("one line for a person", scorecardLine(sc), "4 closed; 50% winners; average +2.5%; payoff 1.33x; 1 of 2 broken theses exited within 5 days (median 26 days).");
ok("an empty record says so", [scorecard([]).hitRate, scorecardLine(scorecard([]))], [null, "No closed positions yet."]);
ok("stored records are cleaned: junk dropped, duplicates once, unknown reason is other", normalizeJournal([c1, c1, { id: "x" }, { ...c1, id: "trk2", reason: "vibes", exit: -5 }]).map((x) => [x.id, x.reason, x.exit]), [["trk1", "thesis_broke", 140], ["trk2", "other", null]]);

console.log("calibration");
ok("a conviction is a 1-99% chance and a date, as percent or fraction; anything else is none", [normalizeConviction({ p: 70, by: "2027-02-01", at: "2026-11-01" }), normalizeConviction({ p: 0.7, by: "2027-02-01", source: "Claude (connected)" })?.source, normalizeConviction({ p: 100, by: "2027-02-01" }), normalizeConviction({ p: 50, by: "soon" }), normalizeConviction({ p: 50, by: "2026-10-01", at: "2026-11-01" })], [{ p: 0.7, by: "2027-02-01", at: "2026-11-01", source: "You" }, "Claude (connected)", null, null, null]);
const conv = { p: 0.8, by: "2026-12-31", at: "2026-10-15", source: "You" };
const hBreak = [{ d: "2026-11-01", v: "intact" as const, s: 100 }, { d: "2026-11-20", v: "broken" as const, s: 40 }];
ok("a break before the date resolves 0; the date passing without one resolves 1; still open is unresolved", [resolveForecast(conv, hBreak, new Date("2026-11-25T00:00:00Z")), resolveForecast(conv, [{ d: "2026-11-01", v: "intact", s: 100 }], new Date("2027-01-02T00:00:00Z")), resolveForecast(conv, [], new Date("2026-11-25T00:00:00Z"))], [{ outcome: 0, resolvedOn: "2026-11-20" }, { outcome: 1, resolvedOn: "2026-12-31" }, { outcome: null, resolvedOn: null }]);
ok("a break before the forecast was made does not count against it", resolveForecast({ ...conv, at: "2026-11-25" }, hBreak, new Date("2027-01-05T00:00:00Z")), { outcome: 1, resolvedOn: "2026-12-31" });
ok("a closed record keeps the first break after the forecast", closedFrom(normalizePosition({ ...t, id: "cv09", conviction: { p: 60, by: "2027-01-31", at: "2026-11-05" } })!, "broken", hBreak, 100, "thesis_broke", "", new Date("2026-11-25T00:00:00Z")).convictionBrokeOn, "2026-11-20");
ok("closed early without a break is not counted as a win; a break after the date does not count against it", [resolveForecast(conv, [], new Date("2027-03-01T00:00:00Z"), "2026-12-01T00:00:00Z").outcome, resolveForecast(conv, [], new Date("2027-03-01T00:00:00Z"), "2027-02-01T00:00:00Z", "2027-01-15").outcome], [null, 1]);
const cal = calibration([
  { ticker: "A", p: 0.8, by: "x", source: "You", outcome: 1, resolvedOn: "x" }, { ticker: "B", p: 0.8, by: "x", source: "You", outcome: 0, resolvedOn: "x" },
  { ticker: "C", p: 0.6, by: "x", source: "Claude (connected)", outcome: 1, resolvedOn: "x" }, { ticker: "D", p: 0.9, by: "x", source: "You", outcome: null, resolvedOn: null },
]);
ok("Brier, bias, buckets and by source", [cal.n, cal.open, cal.brier, cal.bias, cal.buckets.map((b) => [b.label, b.n, b.avgP, b.held]), cal.bySource], [3, 1, 0.28, 0.067, [["50-70%", 1, 0.6, 1], ["70-90%", 2, 0.8, 0.5]], [{ source: "You", n: 2, brier: 0.34 }, { source: "Claude (connected)", n: 1, brier: 0.16 }]]);
ok("one line for a person", [calibrationLine(cal), calibrationLine(calibration([]))], ["Brier 0.280 over 3 resolved forecasts (0 is perfect, 0.25 a coin flip): overconfident by 7 points; 1 still open.", "No forecasts yet: give a position a conviction and a date."]);
const withConv = normalizePosition({ ...t, id: "cv01", conviction: { p: 75, by: "2026-12-31", at: "2026-10-01" } })!;
const closedConv = closedFrom(withConv, "broken", hBreak, 100, "thesis_broke", "", new Date("2026-11-25T00:00:00Z"));
const prConv = proposalFrom({ ticker: "AMD", direction: "long", thesis: "Share gains continue.", conviction_pct: 65, review_by: "2027-03-31" }, "Claude (connected)", now);
ok("an AI app's proposal carries its own forecast, marked as its", "proposal" in prConv ? [prConv.proposal.position.conviction?.p, prConv.proposal.position.conviction?.by, prConv.proposal.position.conviction?.source] : prConv, [0.65, "2027-03-31", "Claude (connected)"]);
ok("positions and their closes keep the forecast; open and closed are scored together", [withConv.conviction, closedConv.conviction?.p, calibrationOf([withConv], { cv01: [{ d: "2026-11-01", v: "intact", s: 100 }] }, [{ ...closedConv, id: "cv02" }], new Date("2027-01-05T00:00:00Z")).n], [{ p: 0.75, by: "2026-12-31", at: "2026-10-01", source: "You" }, 0.75, 2]);

const fcPos = normalizePosition({ ...t, id: "fc01", ticker: "CRWD", conviction: { p: 70, by: "2026-12-31", at: "2026-11-01" } })!;
const brokeToday = forecastAlerts([fcPos], { fc01: [{ d: "2026-11-05", v: "intact", s: 100 }, { d: "2026-11-06", v: "broken", s: 50 }] }, now);
const heldToday = forecastAlerts([fcPos], { fc01: [{ d: "2026-12-30", v: "intact", s: 100 }] }, new Date("2026-12-31T21:30:00Z"));
ok("a forecast that resolves today alerts once: a miss on its break day, a hit on its date; nothing on other days", [brokeToday.map((a) => [a.title, a.key]), heldToday.map((a) => a.title), forecastAlerts([fcPos], { fc01: [{ d: "2026-11-06", v: "broken", s: 50 }] }, new Date("2026-11-08T21:30:00Z")).length], [[["CRWD: your 70% forecast missed", "book:fc01:forecast:2026-11-01:2026-12-31"]], ["CRWD: your 70% forecast held"], 0]);

console.log("LP letter");
const letterEv = evaluate(t, co, d, [], now);
const letter = draftLetter({ firm: "Northwind Capital", period: "Q4 2026", now, evals: [letterEv], summary: summarize([letterEv]), closed: [{ ...c1, closedAt: "2026-10-13T15:00:00.000Z" }], record: scorecard([c1]), calibration: calibration([{ ticker: "A", p: 0.8, by: "x", source: "You", outcome: 1, resolvedOn: "x" }]), risk: { betaNet: 12.3, var95: 0.8, worst: { label: "COVID crash", pnl: -3.4 } }, ai: { outputs: 42, reviewedShare: 12, verifiedShare: 91, ledgerOn: true } });
ok("the draft covers the book, closes, process, risk and AI use, with a disclaimer", ["## The book (Q4 2026)", "## What we closed, and why", "**SNOW**", "## Our process, measured", "Calibration of our conviction", "## Risk", "## How we use AI", "42 AI outputs", "91% of the figures", "Northwind Capital", "not fund performance"].map((x) => letter.includes(x)), Array(11).fill(true));
ok("the draft passes its own compliance pass", lintLetter(letter, { ledgerOn: true }).filter((f) => f.severity !== "info").map((f) => [f.rule, f.excerpt]), []);
const lint = lintLetter("We guarantee strong results. Our fund is the best in its class. We returned 32% for investors. Gross return was 18%. A backtest shows we would have gained 40% since 2015. Our AI-powered process finds alpha.", { ledgerOn: false });
ok("the compliance pass flags promises, superlatives, performance without a period, gross without net, hypotheticals and unbacked AI claims", lint.map((f) => [f.rule, f.severity]), [["Promissory or guaranteeing language", "high"], ["Unsupported superlative", "medium"], ["Performance without a time period", "medium"], ["Performance without a time period", "medium"], ["Gross performance without net", "high"], ["Hypothetical performance", "medium"], ["AI claim without a record", "high"]]);
ok("text after a horizontal rule is still checked; the draft's own disclaimer is not", [lintLetter("Fine.\n---\nP.S. We guarantee it.", { ledgerOn: true }).length, lintLetter(letter, { ledgerOn: true }).filter((f) => f.severity !== "info").length], [1, 0]);
{
  const both2 = calibration([{ ticker: "A", p: 0.8, by: "x", source: "You", outcome: 1, resolvedOn: "x" }, { ticker: "A", p: 0.6, by: "x", source: "AI committee", outcome: 1, resolvedOn: "x" }]);
  const l2 = draftLetter({ firm: "N", period: "Q4 2026", now, evals: [letterEv], summary: summarize([letterEv]), closed: [], record: scorecard([]), calibration: both2, risk: null, ai: null });
  ok("the letter sets the PM's calibration beside the AI committee's, and still passes its own check", [l2.includes("its Brier score is 0.160 on 1 resolved forecast, against 0.040 on 1 for our own"), lintLetter(l2, { ledgerOn: false }).filter((f) => f.severity !== "info").length], [true, 0]);
}
ok("a 1% conviction is 1%, not 100%", normalizeConviction({ p: 1, by: "2027-02-01", at: "2026-11-01" })?.p, 0.01);
ok("a period makes performance acceptable; an AI claim with the ledger on is a note, not a fault", [lintLetter("We returned 12% in 2026, net of fees.", { ledgerOn: false }).length, lintLetter("Machine learning helps us screen.", { ledgerOn: true }).map((f) => f.severity)], [0, ["info"]]);

console.log("AI investment committee");
const brief = (text: string) => ({ at: "2026-11-06T10:00:00.000Z", text, sources: [{ id: "S1", label: "10-Q", url: "https://www.sec.gov/x" }, { id: "S2", label: "bad", url: "http://insecure" }] });
const cm = committeeFrom({ decision: "trim", probability: 62.4, rationale: "  The bear's   margin evidence carried it.  ", dissent: "Growth is still 30%.", watch: ["NRR", "", "FCF margin", "Billings", "Extra"] }, brief("For."), brief("Against."), new Date("2026-11-06T12:00:00Z"));
ok("the chair's answer becomes a committee with a 90-day forecast from the AI committee", [cm.decision, cm.rationale, cm.watch, cm.forecast], ["trim", "The bear's margin evidence carried it.", ["NRR", "FCF margin", "Billings"], { p: 0.62, by: "2027-02-04", at: "2026-11-06", source: "AI committee" }]);
ok("a probability out of range is clamped to 1-99", [committeeFrom({ decision: "hold", probability: 140, rationale: "", dissent: "", watch: [] }, brief("a"), brief("b")).forecast?.p, committeeFrom({ decision: "hold", probability: 0, rationale: "", dissent: "", watch: [] }, brief("a"), brief("b")).forecast?.p], [0.99, 0.01]);
const stored = normalizeCommittee(JSON.parse(JSON.stringify({ ...cm, forecast: { ...cm.forecast, source: "You" } })));
ok("a stored committee round-trips, keeps only https sources, and its forecast is always the AI's", [stored?.decision, stored?.bull.sources.map((x) => x.id), stored?.forecast?.source], ["trim", ["S1"], "AI committee"]);
ok("a malformed committee is dropped", [normalizeCommittee({ ...cm, decision: "buy" }), normalizeCommittee({ ...cm, bull: null }), normalizeCommittee(null)], [null, null, null]);
const withCm = normalizePosition({ ...t, id: "cm01", committee: cm })!;
ok("a position keeps its committee", withCm.committee?.decision, "trim");
ok("the bull is briefed with the thesis and the criteria; the chair sees both briefs, labelled", [bullPrompt(withCm, null).includes(withCm.thesis), bullPrompt(withCm, null).includes("FOR"), chairPrompt(withCm, null, "BULLTEXT", "BEARTEXT").includes("Brief FOR (written alone) ---\nBULLTEXT"), chairPrompt(withCm, null, "BULLTEXT", "BEARTEXT").includes("Brief AGAINST (written alone) ---\nBEARTEXT")], [true, true, true, true]);
const both = normalizePosition({ ...withCm, conviction: { p: 80, by: "2027-02-04", at: "2026-11-06" } })!;
const calCm = calibrationOf([both], { cm01: [{ d: "2026-11-20", v: "broken", s: 40 }] }, [], new Date("2026-12-01T00:00:00Z"));
ok("the PM's forecast and the committee's are scored side by side", [calCm.n, calCm.bySource.map((b) => b.source).sort()], [2, ["AI committee", "You"]]);
const closedCm = closedFrom(both, "broken", [{ d: "2026-11-20", v: "broken", s: 40 }], 90, "thesis_broke", "", new Date("2026-11-21T00:00:00Z"));
const reread = normalizeJournal([JSON.parse(JSON.stringify(closedCm))])[0];
ok("a close keeps the committee's forecast and when it broke", [reread?.aiConviction?.p, reread?.aiConvictionBrokeOn, reread?.aiConviction?.source], [0.62, "2026-11-20", "AI committee"]);

console.log("Forecasts cannot be withdrawn");
const f1 = { p: 0.9, by: "2027-01-31", at: "2026-11-01", source: "You" };
const f2 = { p: 0.4, by: "2027-01-31", at: "2026-11-10", source: "You" };
ok("a forecast changed on a later day is kept; one corrected the same day, unchanged, or already kept is not", [supersede([], f1, f2, "2026-11-10"), supersede([], f1, null, "2026-11-10"), supersede([], f1, f2, "2026-11-01"), supersede([], f1, f1, "2026-11-10"), supersede([f1], f1, f2, "2026-11-12")], [[f1], [f1], [], [], [f1]]);
ok("a new or changed forecast is dated today and must resolve after today; an unchanged one keeps its date", [freshForecast({ ...f1, at: "2026-01-01" }, undefined, "2026-11-10").conviction?.at, freshForecast({ ...f1, by: "2026-11-10" }, undefined, "2026-11-10").error, freshForecast({ ...f1, at: "2026-11-10" }, f1, "2026-11-10").conviction?.at, freshForecast({ ...f1, by: "2026-06-01", at: "2026-01-01" }, f1, "2026-11-10").error], ["2026-11-10", "A forecast must resolve after today.", "2026-11-01", "A forecast must resolve after today."]);
ok("a posted forecast cannot claim to be the AI committee's", freshForecast({ ...f1, source: "AI committee" }, undefined, "2026-11-10").conviction?.source, "You");
ok("only the newest twenty are kept", supersede(Array.from({ length: PAST_FORECASTS_MAX }, (_, i) => ({ ...f1, p: (i + 1) / 100 })), f1, f2, "2026-11-10").length, PAST_FORECASTS_MAX);
const pf = normalizePosition({ ...t, id: "pf01", conviction: f2, pastForecasts: [f1, { p: 7 }] })!;
const pfCal = calibrationOf([pf], { pf01: [{ d: "2026-11-05", v: "intact", s: 100 }, { d: "2026-11-08", v: "broken", s: 40 }] }, [], new Date("2026-11-20T00:00:00Z"));
ok("a withdrawn 90% still counts as a miss when the thesis broke after it; the new 40% is still open", [pf.pastForecasts?.length, pfCal.n, pfCal.open, pfCal.brier], [1, 1, 1, 0.81]);
const pfClosed = normalizeJournal([JSON.parse(JSON.stringify(closedFrom(pf, "broken", [{ d: "2026-11-08", v: "broken", s: 40 }], 50, "thesis_broke", "", new Date("2026-11-20T00:00:00Z"))))])[0];
ok("a close keeps the earlier forecasts and their breaks", pfClosed?.pastForecasts, [{ f: f1, brokeOn: "2026-11-08" }]);

console.log("Sizing against conviction; process against outcome");
ok("rank correlation: perfect, reversed, ties averaged, no spread", [spearman([1, 2, 3], [10, 20, 30]), spearman([1, 2, 3], [30, 20, 10]), spearman([1, 1, 2, 3], [1, 2, 3, 4]), spearman([1, 1, 1], [1, 2, 3])], [1, -1, 0.95, null]);
const sz = sizingCheck([{ ticker: "AAA", weight: 6, p: 0.45 }, { ticker: "BBB", weight: 3, p: 0.8 }, { ticker: "CCC", weight: 2, p: 0.7 }, { ticker: "DDD", weight: 4, p: null }]);
ok("the largest position on the lowest conviction is named once; sizing against conviction is flagged", [sz?.n, sz?.notes.length, sz?.notes[0], sz?.notes[1]?.startsWith("Across 3 positions")], [3, 2, "Your largest position, AAA at 6% of NAV, carries your lowest conviction (45%).", true]);
ok("a book sized with its conviction has nothing to say; too few forecasts says nothing", [sizingCheck([{ ticker: "A", weight: 6, p: 0.9 }, { ticker: "B", weight: 3, p: 0.7 }, { ticker: "C", weight: 1, p: 0.6 }])?.notes, sizingCheck([{ ticker: "A", weight: 6, p: 0.9 }])], [[], null]);
ok("a coin-flip-or-worse thesis sized above the median is noted", sizingCheck([{ ticker: "A", weight: 5, p: 0.4 }, { ticker: "B", weight: 5, p: 0.9 }, { ticker: "C", weight: 1, p: 0.95 }])?.notes.some((n) => n.startsWith("A is 5% of NAV at 40% conviction")), true);
const proc = scorecard([
  { ...c1, id: "q1", ticker: "WIN1", entry: 100, exit: 120, brokeOn: null },
  { ...c1, id: "q2", ticker: "LOSS1", entry: 100, exit: 90, brokeOn: "2026-10-10", closedAt: "2026-10-12T15:00:00.000Z" },
  { ...c1, id: "q3", ticker: "LUCK", entry: 100, exit: 115, brokeOn: "2026-09-01", verdictAtClose: "broken" as const, brokenSince: "2026-09-20", closedAt: "2026-10-12T15:00:00.000Z" },
  { ...c1, id: "q4", ticker: "SAT", entry: 100, exit: 70, brokeOn: "2026-09-01", verdictAtClose: "broken" as const, brokenSince: null, closedAt: "2026-10-12T15:00:00.000Z" },
  { ...c1, id: "q6", ticker: "BLIP", entry: 100, exit: 140, brokeOn: "2026-06-01", verdictAtClose: "intact" as const, closedAt: "2026-10-12T15:00:00.000Z" },
  { ...c1, id: "q5", ticker: "NOEXIT", entry: 100, exit: null },
].map((x) => ({ ...x, direction: "long" as const })));
ok("process against outcome: a prompt exit, an intact thesis or a break that recovered is sound; still broken for over five days at the close is not", proc.process, { earned: ["WIN1", "BLIP"], unlucky: ["LOSS1"], lucky: ["LUCK"], deserved: ["SAT"] });
ok("the broken run at the close is measured from its own start, not the first break ever", closedFrom(normalizePosition({ ...t, id: "bs01" })!, "broken", [{ d: "2026-06-01", v: "broken", s: 0 }, { d: "2026-06-02", v: "intact", s: 100 }, { d: "2026-10-10", v: "broken", s: 0 }, { d: "2026-10-11", v: "broken", s: 0 }], 90, "thesis_broke", "", new Date("2026-10-12T00:00:00Z")).brokenSince, "2026-10-10");
ok("a forecast must look at least 30 days ahead; the same chance and date posted under another name is the same forecast", [freshForecast({ ...f1, by: "2026-11-20" }, undefined, "2026-11-10").error?.includes("30 days"), freshForecast({ ...f1, source: "Claude" }, f1, "2026-11-10").conviction], [true, f1]);
ok("a chair's chance given as a fraction is read as a percent", committeeFrom({ decision: "hold", probability: 0.72, rationale: "", dissent: "", watch: [] }, brief("a"), brief("b")).forecast?.p, 0.72);
const early = calibrationOf([], {}, [{ ...c1, id: "ce1", conviction: { p: 0.8, by: "2027-03-01", at: "2026-09-01", source: "You" }, convictionBrokeOn: null, closedAt: "2026-10-01T00:00:00Z" }], new Date("2026-11-20T00:00:00Z"));
ok("a forecast whose position closed early without a break is counted as unscored, not open", [early.n, early.open, early.closedEarly, calibrationLine(early).includes("closed before its date and left unscored")], [0, 0, 1, true]);

console.log("The week in the book");
{
  const wNow = new Date("2026-11-09T12:00:00Z");
  const pA = normalizePosition({ ...t, catalysts: [], id: "wk01", ticker: "AAA", conviction: { p: 80, by: "2026-11-06", at: "2026-08-01" } })!;
  const pB = normalizePosition({ ...t, id: "wk02", ticker: "BBB" })!;
  const pC = normalizePosition({ ...t, id: "wk03", ticker: "CCC" })!;
  const hist = {
    wk01: [{ d: "2026-10-30", v: "intact" as const, s: 100 }, { d: "2026-11-05", v: "watch" as const, s: 60 }, { d: "2026-11-06", v: "broken" as const, s: 30 }, { d: "2026-11-07", v: "broken" as const, s: 30 }],
    wk02: [{ d: "2026-10-30", v: "intact" as const, s: 100 }, { d: "2026-11-08", v: "intact" as const, s: 100 }],
    wk03: [{ d: "2026-11-01", v: "broken" as const, s: 0 }, { d: "2026-11-04", v: "intact" as const, s: 100 }],
  };
  const evA = { ...evaluate(pA, co, d, [], wNow), earnings: { date: "2026-11-12", estimated: false, inDays: 3 } };
  const wb = weekBrief({ now: wNow, book: [pA, pB, pC], evals: [evA], history: hist, closed: [], proposals: [] });
  ok("a week's brief: what broke and recovered (from where it stood before the week), when the new verdict began, and what is coming", [wb.from, wb.changes.map((c) => [c.ticker, c.from, c.to, c.on]), wb.coming.map((c) => [c.ticker, c.label, c.inDays])], ["2026-11-02", [["AAA", "intact", "broken", "2026-11-06"], ["CCC", "broken", "intact", "2026-11-04"]], [["AAA", "Earnings", 3]]]);
  ok("a forecast that resolved in the week is listed; the headline says it all in one line", [wb.resolved.map((r) => [r.ticker, r.held, r.on]), wb.headline], [[["AAA", false, "2026-11-06"]], "This week: 1 thesis broke (AAA); 1 recovered (CCC); 1 forecast resolved, 0 held; 1 date in the next two weeks."]);
  ok("a quiet week says so", weekBrief({ now: wNow, book: [pB], evals: [], history: { wk02: hist.wk02 }, closed: [], proposals: [] }).headline, "A quiet week: no thesis changed verdict, and all 1 stand as they did.");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
