/**
 * Public records as signals: the NRC's reactor status, openFDA recalls and NHTSA vehicle recalls, parsed
 * from fixtures, mapped to listed companies, scored against each company's own pace, and worded as cards.
 *   pnpm exec tsx scripts/test-edge-records.ts
 * The fixtures in scripts/fixtures/edge/ are written to each source's documented format (the NRC's
 * pipe-delimited file, openFDA's enforcement and count responses, the DOT Socrata dataset); the sandbox
 * could not reach the live services, so they are not captured responses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lostMwh, poissonTail, reactorEvents, recallBursts, refuelSeason, vehicleBursts, vehicleMagnitude } from "@/lib/edge/records/logic";
import { FDA_FIRMS, NHTSA_MAKERS, tickerFor } from "@/lib/edge/records/names";
import { PLANTS, plantOf } from "@/lib/edge/records/reactors";
import { reactorCard, recallCard, vehicleCard } from "@/lib/edge/records/scan";
import { nrcDate, parseReactorStatus } from "@/lib/edge/sources/nrc";
import { enforcementUrl, fdaDate, parseCounts, parseEnforcement } from "@/lib/edge/sources/openfda";
import { parseVehicleRecalls, recallsUrl } from "@/lib/edge/sources/nhtsa";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};
const fixture = (f: string) => readFileSync(join(__dirname, "fixtures/edge", f), "utf8");

console.log("NRC reactor status");
ok("US and ISO dates", nrcDate("11/3/2026 12:00:00 AM") === "2026-11-03" && nrcDate("2026-11-13") === "2026-11-13" && nrcDate("Nov 3") === null);
const rows = parseReactorStatus(fixture("nrc-status.txt"));
ok("every row parsed (five units, 46 days)", rows.length === 5 * 46, rows.length);
ok("a header in another order still parses", parseReactorStatus("Power|Unit|ReportDt\n97|Ginna|11/13/2026 12:00:00 AM")[0]?.power === 97);
ok("a file without the columns gives nothing", parseReactorStatus("a|b\n1|2").length === 0);
const events = reactorEvents(rows);
const susq = events.find((e) => e.unit === "Susquehanna 2"), hope = events.find((e) => e.unit === "Hope Creek 1");
ok("a unit that tripped from 100% is an outage, with its days", susq?.kind === "outage" && susq.days === 4 && susq.start === "2026-11-10" && susq.before === 100, susq);
ok("a unit 30 points down for three days is a derate", hope?.kind === "derate" && hope.days === 3 && hope.power === 70, hope);
ok("a steady unit is not an event", !events.some((e) => e.unit === "Vogtle 3"));
ok("a unit offline all month (no normal to compare) is not an event", !events.some((e) => e.unit === "Clinton"));
ok("lost output in megawatt-hours", susq ? lostMwh(susq, 1250) === 4 * 1250 * 24 : false);
ok("refuelling seasons are spring and autumn", refuelSeason("2026-10-02") && !refuelSeason("2026-07-02"));
ok("units map to plants and owners", plantOf("Susquehanna 2")?.tickers.join() === "TLN" && plantOf("Hope Creek 1")?.tickers.join() === "PEG" && plantOf("Salem 1")?.tickers.includes("CEG") === true);
ok("TVA's units have no ticker", plantOf("Browns Ferry 1")?.tickers.length === 0);
ok("an unknown unit maps to nothing", plantOf("Imaginary Point 1") === null);
ok("every plant has a place on the map in the United States", PLANTS.every((p) => p.lat > 24 && p.lat < 50 && p.lon < -66 && p.lon > -125));
const rc = susq ? reactorCard(susq, plantOf(susq.unit)!) : null;
ok("the outage card names the unit, owner and loss", !!rc && rc.title === "Susquehanna 2 has been offline for 4 days (Susquehanna, Talen Energy)" && rc.summary.includes("120,000 MWh") && rc.tickers.join() === "TLN", rc?.title);
ok("and is honest that it may be planned", !!rc && rc.summary.includes("refuelling season") && rc.why.includes("gives no reason"));
ok("its key is stable for the run", rc?.key === "reactor_outage:v1:susquehanna-2:2026-11-10");
const summer = susq ? reactorCard({ ...susq, start: "2026-07-10", latest: "2026-07-13" }, plantOf(susq.unit)!) : null;
ok("a merchant outage outside the refuelling seasons is big enough to alert (0.6)", !!summer && summer.magnitude >= 0.6, summer?.magnitude);
ok("the same in a refuelling season is smaller, and says it may be planned", !!rc && !!summer && rc.magnitude < summer.magnitude && rc.magnitude < 0.6, rc?.magnitude);

console.log("openFDA recalls");
ok("openFDA dates", fdaDate("20261111") === "2026-11-11" && fdaDate("") === "");
const recalls = parseEnforcement(JSON.parse(fixture("openfda-enforcement.json")), "drug");
ok("rows without a firm are dropped", recalls.length === 5, recalls.length);
ok("fields are read", recalls[0].classification === "Class I" && recalls[0].number === "Z-0412-2027" && recalls[0].reportDate === "2026-11-11");
ok("the query asks for a report-date window", enforcementUrl("device", "2026-10-31", "2026-11-14") === "https://api.fda.gov/device/enforcement.json?search=report_date:[20261031+TO+20261114]&limit=1000");
const counts = parseCounts(JSON.parse(fixture("openfda-counts.json")));
ok("count responses", counts.length === 4 && counts[1].count === 20);
ok("filed names map to parents", tickerFor(FDA_FIRMS, "Medtronic MiniMed, Inc.")?.ticker === "MDT" && tickerFor(FDA_FIRMS, "Actavis Pharma, Inc.")?.ticker === "TEVA" && tickerFor(FDA_FIRMS, "Ethicon Endo-Surgery")?.ticker === "JNJ");
ok("an unknown firm maps to nothing", tickerFor(FDA_FIRMS, "Smallville Bakery LLC") === null);
const bursts = recallBursts(recalls, counts, FDA_FIRMS);
const mdt = bursts.find((b) => b.ticker === "MDT"), teva = bursts.find((b) => b.ticker === "TEVA");
ok("a Class I recall is a signal whatever the pace", !!mdt && mdt.signal && mdt.classI === 1, mdt);
ok("subsidiaries sum into the parent's usual pace", !!mdt && Math.abs(mdt.lambda - Math.round((26 * 14 / 351) * 100) / 100) < 1e-9, mdt?.lambda);
ok("three recalls against a usual pace of almost none is a signal", !!teva && teva.k === 3 && teva.signal && teva.p < 0.01, teva);
ok("three against a high usual pace is not", !recallBursts(recalls.filter((r) => r.firm.includes("Teva") || r.firm.includes("Actavis")), [{ firm: "Teva Pharmaceuticals USA, Inc.", count: 200 }], FDA_FIRMS)[0].signal);
ok("Poisson tail", Math.abs(poissonTail(1, 1) - (1 - Math.exp(-1))) < 1e-12 && poissonTail(0, 3) === 1 && poissonTail(3, 0) === 0 && poissonTail(10, 0.5) < 1e-6);
const fc = mdt ? recallCard(mdt, "2026-W46") : null;
ok("a Class I card says so and keeps the recall", !!fc && fc.title.startsWith("Class I FDA recall at Medtronic") && fc.key === "fda_recall:v1:MDT:2026-W46" && (fc.visual.items as unknown[]).length === 1, fc?.title);

console.log("NHTSA vehicle recalls");
const vr = parseVehicleRecalls(JSON.parse(fixture("nhtsa-recalls.json")));
ok("one row per campaign, rows without an id dropped", vr.length === 6, vr.length);
ok("units and dates are read", vr[0].units === 612432 && vr[0].received === "2026-11-10" && vr[0].url.startsWith("https://"));
ok("a park-outside warning is caught", vr.find((r) => r.id === "26V790000")?.parkIt === true && vr[0].parkIt === false);
ok("other field names from NHTSA's flat file work too", parseVehicleRecalls([{ campno: "26V1", mfgname: "GENERAL MOTORS LLC", rcdate: "20261101", potaff: "1,200" }])[0]?.units === 1200);
ok("the query filters by date and sorts newest first", recallsUrl("2026-11-01", 10, "https://x/r.json") === `https://x/r.json?$where=${encodeURIComponent("report_received_date >= '2026-11-01T00:00:00'")}&$order=${encodeURIComponent("report_received_date DESC")}&$limit=10`);
ok("makers map to tickers", tickerFor(NHTSA_MAKERS, "Ford Motor Company")?.ticker === "F" && tickerFor(NHTSA_MAKERS, "Kia America, Inc.")?.ticker === "KIMTF" && tickerFor(NHTSA_MAKERS, "Small Trailer Works LLC") === null);
const vb = vehicleBursts(vr, NHTSA_MAKERS, Date.parse("2026-11-14T12:00:00Z"));
const ford = vb.find((b) => b.ticker === "F"), kia = vb.find((b) => b.ticker === "KIMTF"), tsla = vb.find((b) => b.ticker === "TSLA");
ok("600,000 vehicles in two weeks is a signal", !!ford && ford.signal && ford.units === 612432 && ford.usual > 0, ford);
ok("a park-outside warning is a signal at any size", !!kia && kia.signal && kia.parkIt);
ok("a small software recall is not", !!tsla && !tsla.signal);
ok("magnitude on a log scale", vehicleMagnitude(10_000, false) === 0.25 && vehicleMagnitude(1_000_000, false) === 0.75 && vehicleMagnitude(500, true) === 0.6);
const vc = ford ? vehicleCard(ford, "2026-W46") : null;
ok("the vehicle card", !!vc && vc.title === "Ford recalls 612,432 vehicles in two weeks" && vc.why.includes("not confirmed failures"), vc?.title);
ok("no exclamation marks", ![rc?.summary, fc?.summary, vc?.summary].some((x) => x?.includes("!")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
