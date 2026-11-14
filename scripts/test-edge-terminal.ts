/**
 * The Terminal's Bloomberg-style Edge functions (MARB, SAT, FLR, ALT, EVTS): the pure arithmetic and
 * mapping behind them. Merger-arbitrage spreads (cash, stock-ratio and mixed deals), annualisation to the
 * expected close, market-implied deal odds, percentiles and z-scores against a company's own history,
 * sparkline geometry, a site signal from each kind of Edge card, the events tape's severity and groups,
 * and the command line's new forms. No network, no database.
 *   pnpm exec tsx scripts/test-edge-terminal.ts
 */
import {
  annualised, cashLeg, expectedClose, spreadHistory, grossSpread, impliedOdds, marketMatchesDeal, monthlyCounts, offerValue, percentileRank, poissonZ, spreadRow, sparkPoints, vsAverage, zScore,
} from "@/lib/terminal/edge-math";
import { groupOf, severityOf, siteSignal, EVENT_GROUPS, flareRow, parseTape } from "@/lib/terminal/edge-signals";
import { parseCommand, needsTicker } from "@/lib/functions";
import { terminalLink } from "@/lib/edge/links";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};
const near = (a: number | null | undefined, b: number, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol;
const NOW = Date.parse("2026-11-14T12:00:00Z");

console.log("offer value");
ok("a cash deal is worth its cash", offerValue({ consideration: "cash", cash: 42.5, ratio: null, stated: 42.5 }, null)?.value === 42.5);
ok("a cash deal with only the stated price uses it", offerValue({ consideration: "cash", cash: null, ratio: null, stated: 30 }, null)?.value === 30);
const stock = offerValue({ consideration: "stock", cash: null, ratio: 0.5, stated: 50 }, 96);
ok("a stock deal is the ratio times the acquirer's price now, not the stated value", near(stock?.value, 48) && stock?.basis === "stock", stock);
const noAcq = offerValue({ consideration: "stock", cash: null, ratio: 0.5, stated: 50 }, null);
ok("a stock deal without the acquirer's price falls back to the stated value, and says so", noAcq?.value === 50 && noAcq.basis === "stated" && /stated/i.test(noAcq.note), noAcq);
const mixed = offerValue({ consideration: "mixed", cash: 20, ratio: 0.25, stated: 45 }, 100);
ok("a mixed deal is the cash plus the ratio times the acquirer's price", near(mixed?.value, 45) && mixed?.basis === "mixed", mixed);
ok("nothing to value is null", offerValue({ consideration: "", cash: null, ratio: null, stated: null }, 100) === null);
ok("a stock deal with no ratio and no stated value is null", offerValue({ consideration: "stock", cash: null, ratio: null, stated: null }, 100) === null);
ok("a negative or zero price is never an offer", offerValue({ consideration: "cash", cash: -1, ratio: null, stated: null }, null) === null);
ok("the cash leg of a mixed deal is the stated value less the stock at signing", near(cashLeg(45, 0.25, 100), 20) && cashLeg(45, null, 100) === null && cashLeg(45, 0.25, null) === null && cashLeg(10, 0.25, 100) === null);

console.log("spread and annualised return");
const s = grossSpread(50, 48);
ok("gross spread in dollars and as a share of the target's price", near(s?.abs, 2) && near(s?.pct, 2 / 48), s);
ok("a target above the offer has a negative spread", (grossSpread(50, 51)?.pct ?? 0) < 0);
ok("no price, no spread", grossSpread(50, 0) === null && grossSpread(Number.NaN, 10) === null);
const a = annualised(0.02, 73);
ok("2% over 73 days is about 10% simple and 10.4% compound", near(a?.simple, 0.1, 1e-9) && near(a?.compound, Math.pow(1.02, 365 / 73) - 1, 1e-9), a);
ok("annualising needs a day or more", annualised(0.02, 0) === null && annualised(0.02, -5) === null);
ok("a loss annualises to a loss", (annualised(-0.01, 100)?.simple ?? 0) < 0);

console.log("implied odds");
ok("halfway between the unaffected price and the offer is 50%", near(impliedOdds(40, 50, 30), 0.5));
ok("at the offer it is 100%, at the unaffected price 0%, clamped beyond", impliedOdds(50, 50, 30) === 1 && impliedOdds(30, 50, 30) === 0 && impliedOdds(55, 50, 30) === 1 && impliedOdds(20, 50, 30) === 0);
ok("no unaffected price or no premium gives no odds", impliedOdds(40, 50, null) === null && impliedOdds(40, 50, 50) === null);

console.log("expected close");
const tender = expectedClose({ kind: "tender", consideration: "cash", announced: "2026-10-01", approvals: [], secondRequest: false }, NOW);
ok("a tender offer is expected within about six weeks of announcement", tender.basis === "estimate" && tender.date === "2026-11-10", tender);
ok("an estimate already passed is flagged as overdue, with a short floor for the return", tender.overdue && tender.days < 0 && tender.daysForReturn >= 14, tender);
const merger = expectedClose({ kind: "merger", consideration: "stock", announced: "2026-09-01", approvals: ["HSR"], secondRequest: false }, NOW);
const sr = expectedClose({ kind: "merger", consideration: "stock", announced: "2026-09-01", approvals: ["HSR", "European Commission"], secondRequest: true }, NOW);
ok("a second request and foreign antitrust push the close out", sr.date > merger.date && /second request/i.test(sr.why) && /foreign|European/i.test(sr.why), { merger, sr });
const stated = expectedClose({ kind: "merger", consideration: "cash", announced: "2026-09-01", approvals: [], secondRequest: false, stated: "2027-03-31" }, NOW);
ok("a stated expected close wins over the estimate", stated.basis === "stated" && stated.date === "2027-03-31" && stated.days === 137, stated);
ok("a bad announcement date still gives an estimate from today", expectedClose({ kind: "merger", consideration: "cash", announced: "", approvals: [], secondRequest: false }, NOW).days > 0);

console.log("a whole arbitrage row");
const row = spreadRow({ consideration: "stock", cash: null, ratio: 0.5, stated: 50 }, { target: 46, acquirer: 96, unaffected: 38 }, 92);
ok("a stock-ratio row: offer, spread, annualised, implied odds", near(row.offer, 48) && near(row.spreadPct, 2 / 46) && near(row.annualised, (2 / 46) * 365 / 92) && near(row.implied, (46 - 38) / (48 - 38)), row);
const blank = spreadRow({ consideration: "cash", cash: 30, ratio: null, stated: 30 }, { target: null, acquirer: null, unaffected: null }, 92);
ok("without a target price the row keeps the offer and leaves the rest empty", blank.offer === 30 && blank.spreadPct === null && blank.annualised === null && blank.implied === null, blank);

console.log("spread history");
const hc = spreadHistory({ consideration: "cash", cash: 50, ratio: null, stated: 50 }, [{ date: "2026-10-01", close: 45 }, { date: "2026-10-02", close: 48 }], []);
ok("a cash deal's spread each day against the target's close", hc.length === 2 && near(hc[0].spreadPct, 50 / 45 - 1) && hc[1].offer === 50, hc);
const hs = spreadHistory({ consideration: "stock", cash: null, ratio: 0.5, stated: 50 }, [{ date: "2026-10-01", close: 45 }, { date: "2026-10-02", close: 46 }, { date: "2026-10-03", close: 47 }], [{ date: "2026-10-01", close: 92 }, { date: "2026-10-03", close: 96 }]);
ok("a stock deal marks the offer at the acquirer's close that day, carrying the last one over a gap", hs.length === 3 && near(hs[0].offer, 46) && near(hs[1].offer, 46) && near(hs[1].spreadPct, 0) && near(hs[2].offer, 48), hs);
ok("a stock deal before the acquirer's first close is skipped", spreadHistory({ consideration: "stock", cash: null, ratio: 0.5, stated: null }, [{ date: "2026-09-30", close: 40 }], [{ date: "2026-10-01", close: 92 }]).length === 0);

console.log("history: percentile, z-score, change against the average");
ok("the top of its history is the 100th percentile", percentileRank([1, 2, 3, 4], 5) === 1);
ok("the bottom is 0", percentileRank([1, 2, 3, 4], 0) === 0);
ok("ties count half (mid-rank)", near(percentileRank([1, 2, 2, 3], 2), 0.5));
ok("no history, no percentile", percentileRank([], 3) === null && percentileRank([Number.NaN], 3) === null);
ok("a z-score needs three points and spread", zScore([1, 1, 1], 2) === null && zScore([1, 2], 3) === null && near(zScore([1, 2, 3], 4), 2));
ok("change against the average", near(vsAverage(15, [10, 10, 10]), 0.5) && vsAverage(5, [0, 0]) === null && vsAverage(5, []) === null);
ok("permits: a Poisson z against the usual pace", near(poissonZ(9, 4), 2.5) && poissonZ(3, 0) === null);
ok("monthly counts, oldest first, last month this one", JSON.stringify(monthlyCounts(["2026-11-02", "2026-11-10", "2026-09-30", "2025-01-01"], 3, NOW)) === "[1,0,2]");

console.log("sparklines");
const pts = sparkPoints([0, 5, 10], 100, 20, 0);
ok("a rising line from bottom left to top right", pts === "0,20 50,10 100,0", pts);
ok("a flat line sits in the middle", sparkPoints([3, 3, 3], 100, 20, 0) === "0,10 50,10 100,10");
ok("gaps are skipped, not drawn as zero", sparkPoints([0, null, 10], 100, 20, 0) === "0,20 100,0");
ok("one point or none draws nothing", sparkPoints([1], 100, 20) === "" && sparkPoints([], 100, 20) === "");

console.log("prediction markets on a deal");
const deal = { target: "Targa Resources", targetTicker: "TRGP", acquirer: "ONEOK", acquirerTicker: "OKE" };
ok("a market on the deal closing matches", marketMatchesDeal({ title: "Will ONEOK complete its acquisition of Targa Resources by June 30?", outcome: "", question: "" }, deal));
ok("a regulator's decision on it matches", marketMatchesDeal({ title: "Will the FTC sue to block the Targa deal?", outcome: "", question: "" }, deal));
ok("a market on the company that is not about the deal does not", !marketMatchesDeal({ title: "Targa Resources stock above $200 on Dec 31?", outcome: "", question: "" }, deal));
ok("another company's deal does not", !marketMatchesDeal({ title: "Will Chevron complete its acquisition of Hess?", outcome: "", question: "" }, deal));
ok("a ticker named in a merger question matches", marketMatchesDeal({ title: "Merger close", outcome: "", question: "Will the OKE-TRGP merger close in 2027?" }, deal));

console.log("site signals from cards");
const flareCard = { id: 1, kind: "flaring", title: "Flaring at Plant A", observedAt: "2026-11-12T12:00:00Z", detectedAt: "2026-11-13T00:00:00Z", magnitude: 0.6, confidence: 0.8, visual: { site: { name: "Plant A", lon: -103.1, lat: 31.9 }, stats: { frpTotal: 40, days: 4 }, history: [{ week: "2026-W40", days: 0, frp: 0 }, { week: "2026-W41", days: 1, frp: 4 }, { week: "2026-W42", days: 0, frp: 0 }, { week: "2026-W43", days: 1, frp: 2 }, { week: "2026-W46", days: 4, frp: 40 }], heat: { url: "https://planetarycomputer.microsoft.com/api/data/v1/item/x.png", date: "2026-11-10" } } };
const f = siteSignal(flareCard);
ok("flaring: this week's heat against the weeks before, with its history and the heat image", !!f && f.value === 40 && (f.z ?? 0) > 2 && f.history.length === 5 && f.thumb?.startsWith("https://planetarycomputer") === true && f.site === "Plant A" && f.lat === 31.9, f);
const satCard = { id: 2, kind: "crop_vigour", title: "Crops", observedAt: "2026-08-01T12:00:00Z", detectedAt: "2026-08-02T00:00:00Z", magnitude: 0.5, confidence: 0.7, visual: { site: { id: "iowa", name: "Central Iowa", lon: -93.5, lat: 42 }, metric: { label: "NDVI", unit: "ndvi", current: 0.61, date: "2026-07-30", baseline: [{ label: "2022", value: 0.72 }, { label: "2023", value: 0.74 }], z: -3.1, pct: -0.16, n: 2 }, image: { url: "https://planetarycomputer.microsoft.com/api/data/v1/item/y.png", date: "2026-07-30", caption: "" } } };
const sat = siteSignal(satCard);
ok("a satellite analysis keeps its own z-score and baseline years, newest last", sat?.z === -3.1 && JSON.stringify(sat?.history) === "[0.72,0.74,0.61]" && sat?.unit === "NDVI", sat);
const permitCard = { id: 3, kind: "permits", title: "Permits", observedAt: "2026-11-01T12:00:00Z", detectedAt: "2026-11-02T00:00:00Z", magnitude: 0.4, confidence: 0.6, visual: { site: { name: "Plant B", lon: -104, lat: 32 }, last30: 9, prior90: 12, windows: [3, 5, 4, 9] } };
const pm = siteSignal(permitCard);
ok("permits: a Poisson z of the month against the 90 days before", near(pm?.z ?? null, 2.5) && JSON.stringify(pm?.history) === "[3,5,4,9]", pm);
const methane = siteSignal({ id: 4, kind: "methane_plume", title: "CH4", observedAt: "2026-10-01T00:00:00Z", detectedAt: "2026-10-01T00:00:00Z", magnitude: 0.5, confidence: 0.5, visual: { site: { name: "Plant C", lon: -103, lat: 31 }, rateKgH: 900, earlier: [{ date: "2026-08-01", rateKgH: 300 }, { date: "2026-07-01", rateKgH: 200 }, { date: "2026-06-01", rateKgH: null }], image: "data:image/png;base64,AAAA" } });
ok("methane: the rate against earlier plumes, oldest first, the picture kept", JSON.stringify(methane?.history) === "[200,300,900]" && methane?.thumb === "data:image/png;base64,AAAA", methane);
const radar = siteSignal({ id: 5, kind: "radar_change", title: "Radar", observedAt: "2026-10-01T00:00:00Z", detectedAt: "2026-10-01T00:00:00Z", magnitude: 0.3, confidence: 0.6, visual: { site: { name: "Plant D", lon: -103, lat: 31 }, stats: { newAreaM2: 1200 }, after: { url: "https://planetarycomputer.microsoft.com/api/data/v1/item/z.png" } } });
ok("radar has no baseline z, but keeps its area and the after image", radar?.z === null && radar?.value === 1200 && !!radar?.thumb, radar);
ok("a card without a site is not a site signal", siteSignal({ id: 6, kind: "filing_change", title: "x", observedAt: null, detectedAt: "2026-10-01T00:00:00Z", magnitude: 0, confidence: 0.5, visual: {} }) === null);

console.log("the events tape");
ok("kinds fall into the tape's groups", groupOf("flaring") === "FLR" && groupOf("crop_vigour") === "SAT" && groupOf("radar_change") === "SAT" && groupOf("fda_recall") === "REC" && groupOf("deal_impact") === "DEAL" && groupOf("hiring_shift") === "ALT" && groupOf("something_new") === "OTHER");
ok("every group has a label", EVENT_GROUPS.every((g) => g.label.length > 0));
ok("a deal-watch card keeps its own severity", severityOf({ kind: "deal_impact", magnitude: 0.1, confidence: 0.5, visual: { severity: "high" } }) === "high");
ok("a big, sure finding is high; a small one low", severityOf({ kind: "flaring", magnitude: 0.9, confidence: 0.85, visual: {} }) === "high" && severityOf({ kind: "flaring", magnitude: 0.1, confidence: 0.4, visual: {} }) === "low");
ok("a ground change's hectares are scaled before judging", severityOf({ kind: "ground_change", magnitude: 4.5, confidence: 0.8, visual: {} }) === "high");
const t1 = parseTape("flr xom high");
ok("the tape's words: a group, a ticker and a severity, in any order", t1.group === "FLR" && t1.ticker === "XOM" && t1.severity === "high", t1);
ok("an empty tape is everything", JSON.stringify(parseTape("")) === JSON.stringify({ group: null, ticker: null, severity: null }));

console.log("flaring rows");
const fr = flareRow({ id: 9, name: "Plant A", company: "Targa", ticker: "TRGP", lon: -103, lat: 32, cap: 250 }, [{ date: "2026-11-08", n: 0, frp: 0, sats: [] }, { date: "2026-11-09", n: 2, frp: 6, sats: ["N20"] }, { date: "2026-11-10", n: 1, frp: 4, sats: ["N21"] }], [{ week: "2026-W44", days: 0, frp: 0 }, { week: "2026-W45", days: 1, frp: 5 }, { week: "2026-W46", days: 2, frp: 10 }], "2026-W46");
ok("days flaring this week, its heat, the 12 weeks, and the change against the weeks before", fr.daysFlaring === 2 && fr.frp7 === 10 && JSON.stringify(fr.weekly) === "[0,5,10]" && near(fr.vsAvg, 10 / 2.5 - 1), fr);
ok("a plant that never flared has no change to show", flareRow({ id: 1, name: "Quiet", company: "", ticker: "", lon: 0, lat: 0, cap: 0 }, [], [], "2026-W46").vsAvg === null);

console.log("the command line");
const cmd = (s: string) => { const r = parseCommand(s, "ET", true); return r.ok ? `${r.command.ticker}|${r.command.fn}|${r.command.arg ?? ""}` : `error:${r.error}`; };
ok("SAT XOM and ALT XOM take the ticker after the code", cmd("SAT XOM") === "XOM|SAT|" && cmd("ALT NVDA") === "NVDA|ALT|", [cmd("SAT XOM"), cmd("ALT NVDA")]);
ok("XOM SAT works too, and SAT alone uses the active ticker", cmd("XOM SAT") === "XOM|SAT|" && cmd("SAT") === "ET|SAT|");
ok("MARB, FLR and EVTS are monitors with no ticker", cmd("MARB") === "|MARB|" && cmd("FLR") === "|FLR|" && cmd("EVTS") === "|EVTS|" && !needsTicker("MARB") && !needsTicker("FLR") && !needsTicker("EVTS"));
ok("EVTS takes words to filter the tape", cmd("EVTS flr high") === "|EVTS|flr high");
ok("FLR stays Fluor's ticker without Edge, and before a function", (() => { const r = parseCommand("FLR", "ET", false); return r.ok && r.command.ticker === "FLR" && r.command.fn === "DES"; })() && cmd("FLR DES") === "FLR|DES|");
ok("other functions keep their rule: FA AAPL is still an error", cmd("FA AAPL").startsWith("error:"));

console.log("links from Edge into the Terminal");
ok("a flaring card opens SAT on its company", JSON.stringify(terminalLink("flaring", ["TRGP"])) === JSON.stringify({ label: "SAT TRGP", href: "/app/terminal?fn=SAT&ticker=TRGP" }));
ok("a deal-watch card opens MARB", terminalLink("deal_impact", ["OKE", "TRGP"])?.href === "/app/terminal?fn=MARB");
ok("a recall or a hiring signal opens ALT", terminalLink("fda_recall", ["PFE"])?.label === "ALT PFE" && terminalLink("hiring_shift", ["NVDA"])?.label === "ALT NVDA");
ok("a card with no ticker, or a kind with no monitor, has no link", terminalLink("flaring", []) === null && terminalLink("filing_change", ["XOM"]) === null && terminalLink("flaring", ["not a ticker!"]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
