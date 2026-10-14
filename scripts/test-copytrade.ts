/**
 * Checks for copy trading: 13F parsing (units, amendments, confidential treatment, options), CUSIP
 * mapping, clone weights and blends, the lag-aware backtest's arithmetic, the rebalance diff (fractional
 * and whole shares, cash limits, protected outside positions), order idempotency (a double tap never
 * double-orders), market hours and SnapTrade request signing against signatures the official SDK's own
 * code computed. No network, no database.
 *   pnpm exec tsx scripts/test-copytrade.ts
 */
import { addHoldings, aggregate, compareQuarters, concentration, filingDeadline, isoPeriod, lagDays, latestKnown, parseInfoTable, parsePrimaryDoc, portfolioAsOf, quarterEndOf, splitBetween, turnover, valueMultiplier, type FilingRecord, type Holding } from "@/lib/copytrade/thirteenf";
import { BUILTIN_OVERRIDES, brokerTicker, cusipCheckDigit, isCommonTitle, openFigiJobs, parse13fList, pickFigi, shareClassOf, tickerForClass, validCusip } from "@/lib/copytrade/cusip";
import { blendTargets, cleanRules, cloneTargets } from "@/lib/copytrade/targets";
import { beta, indexFrom, maxDrawdown, metrics, simulate, thin, tradingIndex, type Close, type RebalanceEvent } from "@/lib/copytrade/backtest";
import { limitPrice, proposeOrders, roundUnits, type RebalanceInput } from "@/lib/copytrade/rebalance";
import { approveBatch, clientOrderId, confirmationPhrase, type BatchRow, type CopyStore, type OrderBroker, type OrderRow } from "@/lib/copytrade/orders";
import { earlyCloses, easter, holidays, isTradingDay, marketState, nextTradingDay } from "@/lib/copytrade/markethours";
import { brokerReason, buildQuery, canonicalJson, positionsOf, signRequest } from "@/lib/copytrade/snaptrade";
import { paperCurve, paperRebalance } from "@/lib/copytrade/paper";
import { parseFormIndex } from "@/lib/copytrade/edgar13f";
import { inFilingSeason, pollDue } from "@/lib/copytrade/thirteenf";
import { cleanCopy } from "@/lib/copytrade/portfolios";
import { auditCsv, sameSiteJson } from "@/lib/copytrade/access";
import { CURATED, padCik } from "@/lib/copytrade/funds";
import { COPYTRADE_FEATURES } from "@/lib/billing/features/copytrade";
import { featureById } from "@/lib/billing/features";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ---------------- Fixtures: EDGAR's 13F documents, in the shapes filers send ---------------- */

const PRIMARY = (o: { period: string; amendment?: "RESTATEMENT" | "NEW HOLDINGS"; type?: string; confidential?: boolean }) => `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler" xmlns:com="http://www.sec.gov/edgar/common">
  <headerData><submissionType>${o.amendment ? "13F-HR/A" : "13F-HR"}</submissionType><filerInfo><periodOfReport>${o.period}</periodOfReport></filerInfo></headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>${o.period}</reportCalendarOrQuarter>
      <isAmendment>${o.amendment ? "true" : "false"}</isAmendment>
      ${o.amendment ? `<amendmentNo>1</amendmentNo><amendmentInfo><amendmentType>${o.amendment}</amendmentType><confDeniedExpired>${o.amendment === "NEW HOLDINGS" ? "true" : "false"}</confDeniedExpired></amendmentInfo>` : ""}
      <filingManager><name>Example Capital Management LP</name><address><com:city>New York</com:city></address></filingManager>
      <reportType>${o.type ?? "13F HOLDINGS REPORT"}</reportType>
    </coverPage>
    <summaryPage><otherIncludedManagersCount>1</otherIncludedManagersCount><tableEntryTotal>5</tableEntryTotal><tableValueTotal>1234567</tableValueTotal><isConfidentialOmitted>${o.confidential ? "true" : "false"}</isConfidentialOmitted></summaryPage>
  </formData>
</edgarSubmission>`;

const line = (o: { name: string; title?: string; cusip: string; value: number; shares: number; type?: string; pc?: string; disc?: string; mgr?: string }) => `
  <ns1:infoTable>
    <ns1:nameOfIssuer>${o.name}</ns1:nameOfIssuer><ns1:titleOfClass>${o.title ?? "COM"}</ns1:titleOfClass><ns1:cusip>${o.cusip}</ns1:cusip>
    <ns1:value>${o.value}</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>${o.shares}</ns1:sshPrnamt><ns1:sshPrnamtType>${o.type ?? "SH"}</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
    ${o.pc ? `<ns1:putCall>${o.pc}</ns1:putCall>` : ""}
    <ns1:investmentDiscretion>${o.disc ?? "SOLE"}</ns1:investmentDiscretion>${o.mgr ? `<ns1:otherManager>${o.mgr}</ns1:otherManager>` : ""}
    <ns1:votingAuthority><ns1:Sole>${o.shares}</ns1:Sole><ns1:Shared>0</ns1:Shared><ns1:None>0</ns1:None></ns1:votingAuthority>
  </ns1:infoTable>`;
const TABLE = (lines: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">${lines.join("")}
</ns1:informationTable>`;

const rec = (accession: string, filedOn: string, period: string, holdings: Holding[], extra: Partial<FilingRecord> = {}): FilingRecord => ({ accession, form: "13F-HR", filedOn, period, amendmentType: null, reportType: "HOLDINGS", confidentialOmitted: false, holdings, ...extra });
const H = (cusip: string, value: number, shares: number, extra: Partial<Holding> = {}): Holding => ({ cusip, issuer6: cusip.slice(0, 6), name: cusip, titleOfClass: "COM", value, shares, shareType: "SH", putCall: null, lines: 1, ...extra });

async function main() {
  console.log("13F documents");
  {
    const meta = parsePrimaryDoc(PRIMARY({ period: "09-30-2025", confidential: true }));
    check("primary document: period as ISO, holdings report, not an amendment", meta.period === "2025-09-30" && meta.reportType === "HOLDINGS" && !meta.isAmendment && meta.amendmentType === null, meta);
    check("primary document: confidential treatment, totals and filer name", meta.confidentialOmitted && meta.entryTotal === 5 && meta.valueTotal === 1234567 && meta.filer === "Example Capital Management LP" && meta.otherManagersIncluded === 1, meta);
    const amend = parsePrimaryDoc(PRIMARY({ period: "09-30-2025", amendment: "NEW HOLDINGS" }));
    check("amendment: NEW HOLDINGS, confidential treatment expired", amend.isAmendment && amend.amendmentType === "NEW HOLDINGS" && amend.confidentialDeniedOrExpired && amend.amendmentNo === 1, amend);
    check("amendment: RESTATEMENT", parsePrimaryDoc(PRIMARY({ period: "09-30-2025", amendment: "RESTATEMENT" })).amendmentType === "RESTATEMENT");
    check("13F notice: no holdings of its own", parsePrimaryDoc(PRIMARY({ period: "09-30-2025", type: "13F NOTICE" })).reportType === "NOTICE");
    check("isoPeriod reads MM-DD-YYYY and keeps ISO", isoPeriod("12-31-2024") === "2024-12-31" && isoPeriod("2024-12-31") === "2024-12-31");

    const xml = TABLE([
      line({ name: "APPLE INC", cusip: "037833100", value: 2_300_000_000, shares: 10_000_000 }),
      line({ name: "APPLE INC", cusip: "037833100", value: 230_000_000, shares: 1_000_000, disc: "DFND", mgr: "1" }),
      line({ name: "APPLE INC", cusip: "037833100", value: 50_000_000, shares: 200_000, pc: "Put" }),
      line({ name: "ALPHABET INC", title: "CAP STK CL A", cusip: "02079K305", value: 400_000_000, shares: 2_000_000 }),
      line({ name: "ALPHABET INC", title: "CAP STK CL C", cusip: "02079k107", value: 100_000_000, shares: 500_000 }),
      line({ name: "EXAMPLE CORP", title: "NOTE 2.000% 6/1", cusip: "30161N101", value: 20_000_000, shares: 20_000_000, type: "PRN" }),
    ]);
    const { lines, unitCorrected } = parseInfoTable(xml, "2025-11-14");
    check("information table: every line read, namespace prefixes ignored, CUSIPs upper-cased", lines.length === 6 && lines[4].cusip === "02079K107", lines.map((l) => l.cusip));
    check("information table: put/call, principal and discretion read", lines[2].putCall === "PUT" && lines[5].shareType === "PRN" && lines[1].discretion === "DFND" && lines[1].otherManagers === "1" && !unitCorrected);
    const agg = aggregate(lines);
    const aapl = agg.find((h) => h.cusip === "037833100" && !h.putCall)!;
    check("aggregation sums a security across discretion types and managers, keeps the put apart", aapl.shares === 11_000_000 && aapl.value === 2_530_000_000 && aapl.lines === 2 && agg.some((h) => h.putCall === "PUT"), agg.map((h) => [h.cusip, h.putCall, h.shares]));
    check("aggregation orders by value, largest first", agg[0].cusip === "037833100" && agg[agg.length - 1].shareType === "PRN");

    const oldXml = TABLE([line({ name: "APPLE INC", cusip: "037833100", value: 23_000, shares: 100_000 }), line({ name: "MSFT", cusip: "594918104", value: 30_000, shares: 100_000 }), line({ name: "KO", cusip: "191216100", value: 6_000, shares: 100_000 })]);
    check("filings before 3 January 2023 report thousands of dollars", parseInfoTable(oldXml, "2022-11-14").lines[0].value === 23_000_000);
    const late = parseInfoTable(oldXml, "2023-02-14");
    check("a 2023 filing still in thousands is caught by its implied prices ($0.23 a share) and corrected", late.unitCorrected && late.lines[0].value === 23_000_000, late.lines[0]);
    check("a pre-2023 filing already in dollars is caught too", valueMultiplier([{ value: 23_000_000, shares: 100_000, shareType: "SH", putCall: null }, { value: 30_000_000, shares: 100_000, shareType: "SH", putCall: null }, { value: 6_000_000, shares: 100_000, shareType: "SH", putCall: null }], "2022-08-12").multiplier === 1);
    check("too few lines to judge: the date decides", valueMultiplier([{ value: 1, shares: 100, shareType: "SH", putCall: null }], "2024-05-15").multiplier === 1);
  }

  console.log("\namendments and confidential treatment");
  {
    const q3 = "2025-09-30";
    const original = rec("0001-25-000001", "2025-11-14", q3, [H("037833100", 900, 9), H("594918104", 100, 1)], { confidentialOmitted: true });
    const newHoldings = rec("0001-26-000002", "2026-02-10", q3, [H("191216100", 300, 30), H("594918104", 50, 0.5)], { form: "13F-HR/A", amendmentType: "NEW HOLDINGS" });
    const restated = rec("0001-26-000003", "2026-03-01", q3, [H("037833100", 500, 5)], { form: "13F-HR/A", amendmentType: "RESTATEMENT" });
    const fs = [original, newHoldings, restated];
    const atFiling = portfolioAsOf(fs, q3, "2025-11-14")!;
    check("as first filed: the original only, with the confidential flag", atFiling.holdings.length === 2 && atFiling.confidentialOmitted && atFiling.accessions.length === 1, atFiling);
    check("before the filing date nothing is known", portfolioAsOf(fs, q3, "2025-11-13") === null);
    const afterNew = portfolioAsOf(fs, q3, "2026-02-10")!;
    check("a NEW HOLDINGS amendment adds the confidential positions on the day they were disclosed", afterNew.holdings.length === 3 && afterNew.holdings.find((h) => h.cusip === "594918104")!.value === 150 && !afterNew.restated, afterNew.holdings);
    const afterRestate = portfolioAsOf(fs, q3, "2026-03-31")!;
    check("a RESTATEMENT replaces the report", afterRestate.restated && afterRestate.holdings.length === 1 && afterRestate.holdings[0].value === 500);
    check("adding holdings never mutates the original", original.holdings[1].value === 100 && addHoldings(original.holdings, newHoldings.holdings).length === 3);
    const q4 = rec("0001-26-000004", "2026-02-14", "2025-12-31", [H("037833100", 10, 1)]);
    check("the latest known quarter on a date", latestKnown([...fs, q4], "2026-02-13")!.period === q3 && latestKnown([...fs, q4], "2026-02-14")!.period === "2025-12-31");
    const notice = rec("0002-25-000001", "2025-11-14", q3, [], { reportType: "NOTICE" });
    check("a notice-only quarter has no portfolio", portfolioAsOf([notice], q3, "2026-01-01")!.notice && latestKnown([notice], "2026-01-01") === null);
  }

  console.log("\nquarter over quarter, splits and statistics");
  {
    const prev = [H("AAA000001", 500, 10), H("BBB000002", 300, 100), H("CCC000003", 200, 20), H("DDD000004", 100, 50, { putCall: "CALL" })];
    // AAA split 4:1 (shares x4, price /4, up 10%); BBB bought 50% more; CCC sold out; EEE new.
    const cur = [H("AAA000001", 550, 40), H("BBB000002", 450, 150), H("EEE000005", 100, 10)];
    const ch = compareQuarters(prev, cur);
    const by = Object.fromEntries(ch.map((c) => [c.cusip, c]));
    check("a 4-for-1 split between filings is detected and is not an add", by.AAA000001.split === 4 && by.AAA000001.kind === "unchanged" && near(by.AAA000001.sharesChangePct!, 0), by.AAA000001);
    check("added, new and exited positions", by.BBB000002.kind === "added" && near(by.BBB000002.sharesChangePct!, 0.5) && by.EEE000005.kind === "new" && by.CCC000003.kind === "exited");
    check("options lines stay out of the change list", !by.DDD000004);
    check("buying four times the shares at the same price is an add, not a split", splitBetween({ value: 100, shares: 10 }, { value: 400, shares: 40 }) === null);
    check("a reverse split (1 for 10)", splitBetween({ value: 100, shares: 1000 }, { value: 90, shares: 100 }) === 0.1);
    check("a known split from a price feed is trusted", splitBetween({ value: 100, shares: 10 }, { value: 300, shares: 30 }, 3) === 3);
    const c = concentration([50, 30, 20]);
    check("concentration: HHI and effective number of positions", near(c.hhi, 0.38) && near(c.effectiveN, 1 / 0.38) && near(c.top10, 1));
    check("turnover is half the absolute weight change", near(turnover({ A: 0.5, B: 0.5 }, { A: 0.5, C: 0.5 }), 0.5) && near(turnover({ A: 1 }, { A: 1 }), 0));
    check("filing deadline 45 days after quarter end, rolled past a weekend", filingDeadline("2025-09-30") === "2025-11-14" && filingDeadline("2026-03-31") === "2026-05-15" && filingDeadline("2025-06-30") === "2025-08-14");
    check("quarter end of a date and the filing lag in days", quarterEndOf("2025-08-02") === "2025-09-30" && quarterEndOf("2025-12-31") === "2025-12-31" && lagDays("2025-09-30", "2025-11-14") === 45);
  }

  console.log("\nCUSIP mapping");
  {
    check("CUSIP check digits (Apple, Alphabet C, Visa)", cusipCheckDigit("03783310") === 0 && cusipCheckDigit("02079K10") === 7 && validCusip("92826C839") && !validCusip("037833101"));
    check("every built-in override is a valid CUSIP", Object.keys(BUILTIN_OVERRIDES).every(validCusip));
    const list = parse13fList([
      "  Run Date: 9/30/2025          Run Time: 12:00:00",
      "CUSIP NO      ISSUER NAME                   ISSUER DESCRIPTION          STATUS",
      "037833 10 0 * APPLE INC                     COM",
      "02079K 30 5 * ALPHABET INC                  CAP STK CL A",
      "02079K 10 7 * ALPHABET INC                  CAP STK CL C                ADDED",
      "88160R 10 1   TESLA INC                     COM                         DELETED",
      "037833 10 1   BAD CHECK DIGIT               COM",
    ].join("\n"));
    check("SEC's 13(f) list: rows read by pattern, headers and bad check digits skipped", list.length === 4 && list[0].cusip === "037833100" && list[0].hasOptions && list[0].issuer === "APPLE INC", list);
    check("SEC's 13(f) list: descriptions and statuses", list[1].description === "CAP STK CL A" && list[2].status === "ADDED" && list[3].status === "DELETED" && !list[3].hasOptions, list.slice(1));
    check("share class from a 13F title", shareClassOf("CAP STK CL C") === "C" && shareClassOf("CLASS B") === "B" && shareClassOf("SHS CL A") === "A" && shareClassOf("COM") === null);
    check("common titles versus notes, warrants and preferred", isCommonTitle("COM NEW") && isCommonTitle("SHS CL A") && !isCommonTitle("NOTE 2.000% 6/1") && !isCommonTitle("WTS EXP 01/01/2030") && !isCommonTitle("PFD SER A"));
    const brk = [{ cik: "1067983", ticker: "BRK-B", name: "BERKSHIRE HATHAWAY INC" }, { cik: "1067983", ticker: "BRK-A", name: "BERKSHIRE HATHAWAY INC" }];
    check("a share class picks its listing (Berkshire B)", tickerForClass(brk, "B") === "BRK-B" && tickerForClass(brk, "A") === "BRK-A");
    const goog = [{ cik: "1652044", ticker: "GOOGL", name: "Alphabet Inc." }, { cik: "1652044", ticker: "GOOG", name: "Alphabet Inc." }];
    check("an ambiguous class is left to OpenFIGI or an override (Alphabet C)", tickerForClass(goog, "C") === null && tickerForClass(goog, null) === "GOOGL");
    check("a single listing needs no class", tickerForClass([{ cik: "1", ticker: "KO", name: "COCA COLA CO" }], "A") === "KO");
    check("OpenFIGI: the US composite equity ticker, written as SEC writes classes", pickFigi({ data: [{ ticker: "BRK/B", exchCode: "UN", marketSector: "Equity", figi: "x" }, { ticker: "BRK/B", exchCode: "US", marketSector: "Equity", figi: "BBG000DWG505", securityType: "Common Stock" }] })?.ticker === "BRK-B");
    check("OpenFIGI: no match, or not equity", pickFigi({ warning: "No identifier found." }) === null && pickFigi({ data: [{ ticker: "T 2 1/2 05/31/24", marketSector: "Govt", exchCode: "US" }] }) === null);
    check("OpenFIGI jobs ask for the US listing by CUSIP", JSON.stringify(openFigiJobs(["037833100"])) === JSON.stringify([{ idType: "ID_CUSIP", idValue: "037833100", exchCode: "US" }]));
    check("broker tickers use a dot for classes", brokerTicker("BRK-B") === "BRK.B");
  }

  console.log("\nclone weights");
  {
    const hs = [H("037833100", 500, 1), H("02079K305", 200, 1), H("02079K107", 100, 1), H("191216100", 100, 1), H("999999999", 50, 1), H("594918104", 40, 1), H("166764100", 10, 1), H("037833100", 60, 1, { putCall: "CALL" }), H("30161N101", 30, 1, { shareType: "PRN" })];
    const map: Record<string, { ticker: string; sector: string | null }> = { "037833100": { ticker: "AAPL", sector: "tech" }, "02079K305": { ticker: "GOOGL", sector: "tech" }, "02079K107": { ticker: "GOOG", sector: "tech" }, "191216100": { ticker: "KO", sector: "consumer" }, "594918104": { ticker: "MSFT", sector: "tech" }, "166764100": { ticker: "CVX", sector: "energy" } };
    const r = cloneTargets(hs, { topN: 3, minWeight: 0, excludeTickers: [], excludeSectors: [] }, (c) => map[c]);
    check("options and principal amounts never go into a clone", r.left.some((l) => l.reason === "option") && r.left.some((l) => l.reason === "principal") && !r.targets.some((t) => t.ticker === "AAPL" && t.value > 500));
    check("Alphabet's two classes merge into the class held most", r.targets[1].ticker === "GOOGL" && r.targets[1].value === 300 && r.targets[1].mergedClasses && r.targets[1].cusips.length === 2, r.targets);
    check("top 3 companies, weights rescaled to 100%", r.targets.length === 3 && near(r.targets.reduce((s, t) => s + t.weight, 0), 1) && near(r.targets[0].weight, 500 / 900));
    check("coverage counts unmapped value honestly", r.coverage.unmappedCount === 1 && near(r.coverage.mappedPct, 950 / 1000) && near(r.coverage.clonedPct, 900 / 1000), r.coverage);
    const ex = cloneTargets(hs, { topN: 0, minWeight: 0.05, excludeTickers: ["ko"], excludeSectors: ["Energy"] }, (c) => map[c]);
    check("excluded tickers and sectors, and a minimum weight", !ex.targets.some((t) => ["KO", "CVX"].includes(t.ticker)) && ex.left.some((l) => l.reason === "excluded sector") && ex.left.some((l) => l.reason === "below minimum weight" || l.reason === "excluded ticker"), ex.targets.map((t) => t.ticker));
    const b = blendTargets([{ weight: 1, targets: [{ ticker: "AAPL", weight: 0.6, name: "A", sector: null }, { ticker: "KO", weight: 0.4, name: "K", sector: null }] }, { weight: 3, targets: [{ ticker: "KO", weight: 1, name: "K", sector: null }] }], 0);
    check("a 1:3 blend of two funds", b[0].ticker === "KO" && near(b[0].weight, 0.85) && near(b[1].weight, 0.15), b);
    const rules = cleanRules({ topN: 500, minWeight: 2, excludeTickers: "aapl, brk.b" });
    check("rules from input are bounded and cleaned", rules.topN === 100 && rules.minWeight === 0.25 && rules.excludeTickers.join() === "AAPL,BRK.B");
  }

  console.log("\nbacktest");
  {
    // Twenty trading days. A rises 1% a day; B is flat; SPY rises 0.5% a day.
    const cal = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 5).padStart(2, "0")}`);
    const series = (f: (i: number) => number): Close[] => cal.map((date, i) => ({ date, close: f(i) }));
    const prices = { A: series((i) => 100 * 1.01 ** i), B: series(() => 50), SPY: series((i) => 400 * 1.005 ** i) };
    check("trading index: on or strictly after a date", tradingIndex(cal, "2026-01-07", false) === 2 && tradingIndex(cal, "2026-01-07", true) === 3 && tradingIndex(cal, "2026-01-04", false) === 0 && tradingIndex(cal, "2027-01-01", true) === -1);
    // Quarter end 2026-01-06 (index 1) holds B; filed 2026-01-10 (index 5) and bought the next close (index 6).
    const events: RebalanceEvent[] = [{ date: "2026-01-06", weights: { B: 1 } }, { date: "2026-01-16", weights: { A: 1 } }];
    const lagged = simulate(events.map((e, i) => ({ ...e, date: i === 0 ? "2026-01-10" : "2026-01-20" })), prices, cal, true);
    const nolag = simulate(events, prices, cal, false);
    check("the lagged clone starts at the first close after the filing date", lagged.curve[0].date === "2026-01-11" && lagged.trades[0].date === "2026-01-11", lagged.trades);
    check("the no-lag line starts at the quarter-end close", nolag.curve[0].date === "2026-01-06" && nolag.trades[1].date === "2026-01-16");
    // No-lag: B (flat) until index 11, then A from index 11 to 19: 100 * 1.01^8.
    check("no-lag value: flat in B, then A's rise from its switch day", near(nolag.curve[nolag.curve.length - 1].value, 100 * 1.01 ** 8, 1e-9), nolag.curve.slice(-1));
    // Lagged: B from index 6, switch to A at the first close after 01-20 (index 16), 3 days of A.
    check("lagged value: the 45-day wait costs the move it missed", near(lagged.curve[lagged.curve.length - 1].value, 100 * 1.01 ** 3, 1e-9) && lagged.curve[lagged.curve.length - 1].value < nolag.curve[nolag.curve.length - 1].value);
    const miss = simulate([{ date: "2026-01-05", weights: { A: 0.5, ZZZ: 0.5 } }], prices, cal, false);
    check("a ticker with no prices is left out and the rest scaled up", miss.trades[0].missing.join() === "ZZZ" && near(miss.curve[miss.curve.length - 1].value, 100 * 1.01 ** 19, 1e-9));
    const flat = [{ date: "2025-01-01", value: 100 }, { date: "2026-01-01", value: 121 }];
    check("CAGR over calendar days", near(metrics(flat)!.cagr, 0.21, 2e-4));
    const path = [100, 120, 90, 110, 80, 130].map((value, i) => ({ date: cal[i], value }));
    check("maximum drawdown from the running peak (120 to 80)", near(maxDrawdown(path), 80 / 120 - 1));
    const spy = indexFrom(prices.SPY, cal[0]);
    check("benchmark index starts at 100", spy[0].value === 100 && near(spy[19].value, 100 * 1.005 ** 19));
    const r = cal.map((d, i) => ({ date: d, r: i % 2 ? 0.01 : -0.004 }));
    const lev = r.map((x) => ({ date: x.date, r: 2 * x.r + 0.0001 }));
    check("beta of a doubled series is 2", near(beta(lev, r)!, 2, 1e-9));
    const m = metrics(nolag.curve, spy)!;
    check("volatility and Sharpe on a known path", m.volatility > 0 && m.sharpe !== null && m.from === "2026-01-06");
    check("thinning keeps the first and last points", thin(Array.from({ length: 1000 }, (_, i) => ({ date: String(i), value: i })), 100).at(-1)!.value === 999);
  }

  console.log("\nrebalance");
  {
    const base: RebalanceInput = { targets: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "KO", weight: 0.3 }, { ticker: "NVR", weight: 0.2 }], budgetUsd: 10_000, cash: 20_000, positions: [], managed: {}, prices: { AAPL: 200, KO: 60, NVR: 7_500 }, fractional: false, minOrderUsd: 5, sellOutside: false, cashBufferPct: 0, useSaleProceeds: true, orderType: "Limit", limitBand: 0.005, maxOrderUsd: 0 };
    const whole = proposeOrders(base);
    const units = Object.fromEntries(whole.orders.map((o) => [o.ticker, o.units]));
    check("whole shares: floor of size x weight / price", units.AAPL === 25 && units.KO === 50 && !units.NVR, units);
    check("a share too dear for its slice is skipped with the reason", whole.skipped.some((s) => s.ticker === "NVR" && /whole shares/.test(s.reason)), whole.skipped);
    const frac = proposeOrders({ ...base, fractional: true });
    const fu = Object.fromEntries(frac.orders.map((o) => [o.ticker, o.units]));
    check("fractional shares to 1/10,000", near(fu.NVR, 0.2666, 1e-9) && near(fu.AAPL, 25) && near(roundUnits(1.23456, true), 1.2345, 1e-9), fu);
    check("limit prices on the right side of the last price", limitPrice(200, "BUY", 0.005) === 201 && limitPrice(200, "SELL", 0.005) === 199 && limitPrice(0.5, "BUY", 0.01) === 0.505);
    const tight = proposeOrders({ ...base, cash: 3_000, fractional: true });
    const spent = tight.orders.reduce((s, o) => s + o.boundValue, 0);
    check("buys are scaled to the cash available, checked at the limit price", tight.summary.scaled !== null && spent <= 3_000 + 1e-6 && tight.orders.length === 3, { spent, scaled: tight.summary.scaled });
    const withOutside: RebalanceInput = { ...base, targets: [{ ticker: "KO", weight: 1 }], positions: [{ ticker: "AAPL", units: 40, price: 200 }, { ticker: "KO", units: 100, price: 60 }, { ticker: "TSLA", units: 5, price: 250 }], managed: { AAPL: 30, KO: 20 }, cash: 20_000 };
    const p = proposeOrders(withOutside);
    const sellA = p.orders.find((o) => o.ticker === "AAPL")!;
    check("an exit sells only the copy's own shares, never the 10 held outside", sellA.action === "SELL" && sellA.units === 30 && sellA.reason === "exit" && sellA.fromOutside === 0, sellA);
    check("unrelated holdings are never touched (TSLA)", !p.orders.some((o) => o.ticker === "TSLA") && p.warnings.some((w) => /outside this copy/.test(w)));
    const buyKo = p.orders.find((o) => o.ticker === "KO")!;
    check("the copy buys its own stake on top of shares held outside (KO 20 -> 166)", buyKo.action === "BUY" && buyKo.units === 146 && p.rows.find((r) => r.ticker === "KO")!.outsideUnits === 80, buyKo);
    check("sells come first and pay for buys; the tax caution is raised", p.orders[0].action === "SELL" && sellA.taxCaution && p.warnings.some((w) => /tax/i.test(w)));
    const opt = proposeOrders({ ...withOutside, sellOutside: true });
    const optKo = opt.orders.find((o) => o.ticker === "KO")!;
    const optA = opt.orders.find((o) => o.ticker === "AAPL")!;
    check("with the opt-in, shares held outside count toward the target and can be sold", optKo.units === 66 && optA.units === 40 && optA.fromOutside === 10, { optKo, optA });
    const capped = proposeOrders({ ...base, maxOrderUsd: 1_000 });
    check("the per-order limit cuts an order", capped.orders.find((o) => o.ticker === "AAPL")!.units === 5 && capped.warnings.some((w) => /per-order limit/.test(w)));
    const small = proposeOrders({ ...base, minOrderUsd: 4_000 });
    check("orders under the minimum are skipped", small.orders.length === 1 && small.skipped.some((s) => /minimum/.test(s.reason)), small.orders);
    const managedGone = proposeOrders({ ...base, targets: [], positions: [{ ticker: "KO", units: 5, price: 60 }], managed: { KO: 20 } });
    check("the copy's shares are capped at what the account still holds", managedGone.orders[0].units === 5);
    const dust = proposeOrders({ ...base, targets: [], fractional: true, positions: [{ ticker: "KO", units: 10.00005, price: 60 }], managed: { KO: 10.0001 } });
    check("a fractional exit rounds down, never selling more than the account holds", dust.orders[0].units <= 10.00005 && near(dust.orders[0].units, 10, 1e-9), dust.orders[0]);
    const odd = proposeOrders({ ...base, targets: [], sellOutside: true, positions: [{ ticker: "KO", units: 12.5, price: 60 }], managed: { KO: 12 } });
    check("a whole-share broker's exit sells whole shares only", odd.orders[0].units === 12, odd.orders[0]);
    const market = proposeOrders({ ...base, orderType: "Market" });
    check("market orders carry no limit price", market.orders.every((o) => o.limitPrice === null));
  }

  console.log("\norders: one tap, once");
  {
    const now = new Date("2026-10-13T15:00:00Z");
    const open = marketState(now);
    const mkStore = (batchOver: Partial<BatchRow> = {}) => {
      const batch: BatchRow = { id: 7, userId: "u1", portfolioId: 3, accountId: "acc", status: "proposed", idemKey: null, buyValue: 1_500, sellValue: 0, orderCount: 2, expiresAt: new Date(now.getTime() + 600_000), ...batchOver };
      const orders: OrderRow[] = [0, 1].map((seq) => ({ id: 100 + seq, batchId: 7, seq, clientOrderId: clientOrderId(7, seq), ticker: seq ? "KO" : "AAPL", symbolId: `sym-${seq}`, action: "BUY", units: 5, orderType: "Limit", limitPrice: 100, estValue: 500, status: "pending", brokerageOrderId: null, error: null }));
      const audit: { action: string }[] = [];
      const tick = () => new Promise((r) => setTimeout(r, 1));
      const store: CopyStore = {
        batch: async (id, user) => { await tick(); return id === batch.id && user === batch.userId ? { ...batch } : null; },
        claimBatch: async (_id, _u, key, at) => { await tick(); if (batch.status !== "proposed" || batch.expiresAt.getTime() <= at.getTime()) return false; batch.status = "placing"; batch.idemKey = key; return true; },
        releaseBatch: async (_id, key) => { if (batch.status === "placing" && batch.idemKey === key) { batch.status = "proposed"; batch.idemKey = null; } },
        orders: async () => orders.map((o) => ({ ...o })),
        claimOrder: async (id) => { await tick(); const o = orders.find((x) => x.id === id)!; if (o.status !== "pending") return false; o.status = "submitting"; return true; },
        updateOrder: async (id, patch) => { Object.assign(orders.find((x) => x.id === id)!, patch); },
        finishBatch: async (_id, s) => { batch.status = s; },
        committedValueSince: async () => 0,
        audit: async (e) => { audit.push(e); },
      };
      return { store, batch, orders, audit };
    };
    const mkBroker = (opts: { failImpact?: boolean; hang?: string } = {}) => {
      const placed: string[] = [];
      const broker: OrderBroker = {
        impact: async (o) => { if (opts.failImpact && o.ticker === "KO") throw Object.assign(new Error("Your broker said: Insufficient buying power"), { status: 400 }); return { tradeId: `t-${o.id}`, commission: 0, remainingCash: 1000 }; },
        placeChecked: async (_t, o) => { if (opts.hang === o.ticker) throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); placed.push(o.clientOrderId); return { brokerageOrderId: `b-${o.id}`, status: "ACCEPTED" }; },
        placeForce: async (o) => { placed.push(o.clientOrderId); return { brokerageOrderId: `f-${o.id}`, status: "ACCEPTED" }; },
      };
      return { broker, placed };
    };
    const req = { batchId: 7, user: { id: "u1", email: "a@b.co" }, idemKey: "key-0000-aaaa", confirmation: "", now, maxDayUsd: 50_000, maxOrderUsd: 25_000, market: open };
    {
      const { store, orders, audit } = mkStore();
      const { broker, placed } = mkBroker();
      const [a, b] = await Promise.all([approveBatch(store, broker, req), approveBatch(store, broker, req)]);
      check("two simultaneous taps place each order exactly once", placed.length === 2 && new Set(placed).size === 2, placed);
      check("the second tap is told it was already approved", [a.outcome, b.outcome].sort().join() === "already,placed", [a.outcome, b.outcome]);
      check("orders end placed with the broker's ids", orders.every((o) => o.status === "ACCEPTED" && o.brokerageOrderId?.startsWith("b-")));
      check("the approval and each placement are audited", audit.filter((x) => x.action === "approve").length === 1 && audit.filter((x) => x.action === "order-placed").length === 2);
      const again = await approveBatch(store, broker, req);
      check("a retry with the same key later sends nothing", again.outcome === "already" && placed.length === 2);
      let threw = 0;
      await approveBatch(store, broker, { ...req, idemKey: "another-key-1" }).catch((e) => { threw = e.status; });
      check("a different key after approval is refused (409), nothing sent", threw === 409 && placed.length === 2);
    }
    {
      const { store, orders } = mkStore();
      const { broker, placed } = mkBroker({ failImpact: true, hang: "AAPL" });
      const r = await approveBatch(store, broker, req);
      check("a broker refusal at the check is recorded and not placed", orders.find((o) => o.ticker === "KO")!.status === "rejected" && /buying power/.test(orders.find((o) => o.ticker === "KO")!.error ?? ""));
      check("a placement with no answer is 'unknown' and never retried", orders.find((o) => o.ticker === "AAPL")!.status === "unknown" && placed.length === 0 && r.status === "partial", r);
    }
    {
      let code = 0;
      const { store } = mkStore({ expiresAt: new Date(now.getTime() - 1) });
      await approveBatch(store, mkBroker().broker, req).catch((e) => { code = e.status; });
      check("stale proposals expire", code === 409);
      const big = mkStore({ buyValue: 12_000 });
      let msg = "";
      await approveBatch(big.store, mkBroker().broker, req).catch((e) => { msg = e.message; });
      check("a large batch needs the typed confirmation", /PLACE 2 ORDERS/.test(msg) && confirmationPhrase({ buyValue: 12_000, sellValue: 0, orderCount: 2 }) === "PLACE 2 ORDERS" && confirmationPhrase({ buyValue: 100, sellValue: 0, orderCount: 2 }) === null);
      const ok = await approveBatch(big.store, mkBroker().broker, { ...req, confirmation: "place 2 orders" });
      check("typed confirmation accepted (case-insensitive)", ok.outcome === "placed");
      const day = mkStore();
      let dmsg = "";
      await approveBatch({ ...day.store, committedValueSince: async () => 49_000 }, mkBroker().broker, req).catch((e) => { dmsg = e.message; });
      check("the daily limit counts what was already sent today", /daily limit/.test(dmsg));
      // Another batch approved at the same moment: the first read sees nothing, the read after the claim sees both.
      const race = mkStore();
      const raceBroker = mkBroker();
      let reads = 0, rmsg = "";
      await approveBatch({ ...race.store, committedValueSince: async () => (reads++ === 0 ? 0 : 49_000 + 1_500) }, raceBroker.broker, req).catch((e) => { rmsg = e.message; });
      check("a batch approved alongside another is checked again after its claim, and released when over the daily limit", /daily limit/.test(rmsg) && raceBroker.placed.length === 0 && race.batch.status === "proposed" && race.batch.idemKey === null, { rmsg, status: race.batch.status });
      const capped = mkStore();
      let cmsg = "";
      await approveBatch(capped.store, mkBroker().broker, { ...req, maxOrderUsd: 400 }).catch((e) => { cmsg = e.message; });
      check("the per-order limit is checked again at approval", /per-order limit/.test(cmsg) && capped.batch.status === "proposed", cmsg);
      const mkt = mkStore();
      mkt.orders[0].orderType = "Market";
      let mmsg = "";
      await approveBatch(mkt.store, mkBroker().broker, { ...req, market: marketState(new Date("2026-10-10T15:00:00Z")) }).catch((e) => { mmsg = e.message; });
      check("market orders are refused while the market is closed", /market is closed/.test(mmsg), mmsg);
    }
    const mk = (h: Record<string, string>) => new Request("https://youbank.test/api/copy/batches/7", { method: "POST", headers: h });
    check("approvals only from YouBank's own pages: JSON, not marked cross-site", sameSiteJson(mk({ "content-type": "application/json", "sec-fetch-site": "same-origin" })) && sameSiteJson(mk({ "content-type": "application/json" }))
      && !sameSiteJson(mk({ "content-type": "application/json", "sec-fetch-site": "same-site" })) && !sameSiteJson(mk({ "content-type": "application/json", "sec-fetch-site": "cross-site" })) && !sameSiteJson(mk({ "content-type": "text/plain" })));
    const id = clientOrderId(7, 0);
    check("client order ids are canonical UUIDs, stable per order, distinct per position", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) && id === clientOrderId(7, 0) && id !== clientOrderId(7, 1) && id !== clientOrderId(8, 0));
  }

  console.log("\nmarket hours");
  {
    check("Easter 2026 and 2027", easter(2026) === "2026-04-05" && easter(2027) === "2027-03-28");
    const h26 = holidays(2026);
    check("2026 holidays: Good Friday, Juneteenth, Independence Day observed on Friday 3 July, Thanksgiving", h26.has("2026-04-03") && h26.has("2026-06-19") && h26.has("2026-07-03") && h26.has("2026-11-26") && h26.has("2026-01-19") && h26.has("2026-02-16") && h26.has("2026-05-25") && h26.has("2026-09-07") && h26.size === 10, [...h26]);
    check("New Year's Day on a Saturday is not observed (2022)", !holidays(2021).has("2021-12-31") && !holidays(2022).has("2021-12-31"));
    check("Christmas on a Sunday is observed Monday (2022)", holidays(2022).has("2022-12-26"));
    check("early closes: day after Thanksgiving and Christmas Eve 2026", earlyCloses(2026).has("2026-11-27") && earlyCloses(2026).has("2026-12-24") && !earlyCloses(2026).has("2026-07-03"));
    check("open on a Tuesday at 11:00 New York (summer time)", marketState(new Date("2026-10-13T15:00:00Z")).open);
    check("closed before 9:30 and on Saturdays", marketState(new Date("2026-10-13T13:00:00Z")).reason === "before open" && marketState(new Date("2026-10-10T15:00:00Z")).reason === "weekend");
    const thx = marketState(new Date("2026-11-26T15:00:00Z"));
    check("closed on Thanksgiving; next open Friday", thx.reason === "holiday" && thx.nextOpen === "2026-11-27 09:30 ET", thx);
    check("the early close at 13:00 (winter time)", !marketState(new Date("2026-11-27T18:30:00Z")).open && marketState(new Date("2026-11-27T17:30:00Z")).open);
    check("next trading day skips weekends and holidays", nextTradingDay("2026-07-03") === "2026-07-06" && isTradingDay("2026-07-06") && !isTradingDay("2026-07-04"));
  }

  console.log("\nSnapTrade request signing");
  {
    // Fixtures computed with the signing code of snaptrade-typescript-sdk 12.2.17 (requestAfterHook).
    const KEY = "YOUR-CONSUMER-KEY with spaces/é";
    check("canonical JSON sorts keys at every depth", canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } }) === '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
    check("register user (body, partner query)", signRequest(KEY, "/snapTrade/registerUser", "clientId=YOUBANK-TEST&timestamp=1760000000", { userId: "yb-abc123" }) === "Tacdeojvn9ZpqY+2GZBmQ0oDSl+v8ZLARtiRnr2Ka7A=");
    check("list accounts (no body, user query with an escaped secret)", signRequest(KEY, "/accounts", "clientId=YOUBANK-TEST&userId=yb-abc123&userSecret=s3cr%2Bt&timestamp=1760000000", null) === "TkgDN8d2+o8aR/cmFKLMkdExvMRapT81/oBcmnw7lHw=");
    check("order impact (nested body)", signRequest(KEY, "/trade/impact", "clientId=YOUBANK-TEST&userId=yb-abc123&userSecret=s3cr%2Bt&timestamp=1760000000", { account_id: "acc-1", action: "BUY", universal_symbol_id: "sym-1", order_type: "Limit", time_in_force: "Day", price: 101.25, units: 3, nested: { b: 2, a: [{ z: 1, y: 2 }] } }) === "5kjxjtU+hNp/IuT3U/JFG9e1DqzklmFhvZ7+PyM3YbA=");
    check("the query is built in the order it is signed", buildQuery("YOUBANK-TEST", { userId: "yb-abc123", userSecret: "s3cr+t" }, [["state", "all"], ["skip", undefined]], 1760000000) === "clientId=YOUBANK-TEST&userId=yb-abc123&userSecret=s3cr%2Bt&state=all&timestamp=1760000000");
    check("broker reasons pass when plain, not when they look internal", brokerReason({ detail: "Insufficient buying power" }) === "Insufficient buying power" && brokerReason({ detail: "Traceback (most recent call last)" }) === "" && brokerReason({ message: "see https://x" }) === "");
  }


  console.log("\npaper copies, polling and settings");
  {
    const s0 = paperRebalance(null, [{ ticker: "A", weight: 0.5 }, { ticker: "B", weight: 0.5 }], { A: 100, B: 50 }, "2026-01-05", null, "Started", 10_000);
    check("a paper copy starts fully invested at the day's prices", near(s0.events[0].units.A, 50) && near(s0.events[0].units.B, 100) && near(s0.events[0].cash, 0));
    const s1 = paperRebalance(s0, [{ ticker: "C", weight: 1 }], { A: 110, B: 50, C: 20 }, "2026-02-14", "acc-1", "New 13F", 10_000);
    check("a new filing rebalances at that day's prices (gains carried over)", near(s1.events[1].units.C, (50 * 110 + 100 * 50) / 20) && !s1.events[1].units.A && s1.startedAt === "2026-01-05");
    const s2 = paperRebalance(s1, [{ ticker: "D", weight: 1 }], { D: 10 }, "2026-05-15", "acc-2", "New 13F", 10_000);
    check("a holding with no price that day is kept, not sold at zero", near(s2.events[2].units.C, s1.events[1].units.C) && !s2.events[2].units.D);
    const cal = ["2026-01-05", "2026-01-06", "2026-02-14", "2026-02-15"];
    const curve = paperCurve(s1, { A: cal.map((date, i) => ({ date, close: 100 + i * 10 })), B: cal.map((date) => ({ date, close: 50 })), C: cal.map((date, i) => ({ date, close: i < 3 ? 20 : 22 })) }, cal);
    check("the paper record values each day's holdings", curve.length === 4 && near(curve[0].value, 10_000) && near(curve[1].value, 50 * 110 + 5000) && near(curve[3].value, s1.events[1].units.C * 22), curve);
    check("filing season: the weeks around 14 November, not mid-October", inFilingSeason("2026-11-10") && inFilingSeason("2026-11-18") && !inFilingSeason("2026-10-14") && inFilingSeason("2027-02-14"));
    check("polling: every pass in season, every three hours otherwise", pollDue(new Date("2026-11-10T12:00:00Z"), Date.now()) && !pollDue(new Date("2026-10-14T12:00:00Z"), Date.parse("2026-10-14T11:00:00Z")) && pollDue(new Date("2026-10-14T12:00:00Z"), Date.parse("2026-10-14T08:00:00Z")));
    const idx = parseFormIndex([
      "Form Type   Company Name                                                  CIK         Date Filed  File Name",
      "-------------------------------------------------------------------------------------------------------",
      "13F-HR      BERKSHIRE HATHAWAY INC                                        1067983     20251114    edgar/data/1067983/0000950123-25-008343.txt",
      "13F-HR/A    SCION ASSET MANAGEMENT, LLC                                   1649339     2025-11-20  edgar/data/1649339/0001649339-25-000007.txt",
      "13F-NT      SOMEONE ELSE LLC                                              1234567     20251114    edgar/data/1234567/0001234567-25-000001.txt",
    ].join("\n"));
    check("EDGAR form index: 13F-HR and 13F-HR/A lines, daily and quarterly date formats", idx.length === 2 && idx[0].cik === "0001067983" && idx[0].filedOn === "2025-11-14" && idx[1].form === "13F-HR/A" && idx[1].name === "SCION ASSET MANAGEMENT, LLC" && idx[1].accession === "0001649339-25-000007", idx);
    const c = cleanCopy({ funds: [{ cik: "1067983", name: "Berkshire", weight: 1 }], sizing: { kind: "pct", amount: 500 }, trading: { maxOrderUsd: 1e9, orderType: "Market" } }, { maxOrderUsd: 25_000, maxDayUsd: 50_000, paperCopies: 10, liveCopies: 2, liveCopiesMulti: 10, proposalMinutes: 15 });
    check("copy settings: paper copies are sized in dollars; per-order limits capped by the server", c.mode === "paper" && c.sizing.kind === "usd" && c.trading.maxOrderUsd === 25_000 && c.trading.orderType === "Market" && c.funds[0].cik === "0001067983" && c.name === "Berkshire Hathaway copy");
    let threw = false; try { cleanCopy({ funds: [] }); } catch { threw = true; }
    check("a copy needs a fund", threw);
    const live = cleanCopy({ mode: "live", funds: [{ cik: "1", weight: 1 }, { cik: "2", weight: 3 }], sizing: { kind: "pct", amount: 25 }, accountId: "acc" });
    check("a live copy can be sized as a share of the account", live.sizing.kind === "pct" && live.sizing.amount === 25 && live.accountId === "acc" && live.trading.orderType === "Limit");
    check("audit CSV escapes payloads", auditCsv([{ createdAt: new Date("2026-10-13T15:00:00Z"), actor: "a@b.co", action: "approve", portfolioId: 1, batchId: 2, orderId: null, ip: "1.2.3.4", payload: { orders: [{ ticker: "AAPL" }] } }]).split("\n")[1] === '2026-10-13T15:00:00.000Z,a@b.co,approve,1,2,,1.2.3.4,"{""orders"":[{""ticker"":""AAPL""}]}"');
    const pos = positionsOf({ balances: [{ currency: { code: "USD" }, cash: 1234.5 }], positions: [{ symbol: { symbol: { id: "x", symbol: "BRK.B" } }, units: 3, price: 400 }, { symbol: { symbol: { id: "y", symbol: "SWVXX" } }, units: 100, price: 1, cash_equivalent: true }] });
    check("broker positions: tickers in SEC form, money-market sweep left as cash", pos.cash === 1234.5 && pos.positions.length === 1 && pos.positions[0].ticker === "BRK-B" && near(pos.total, 2434.5), pos);
    check("curated funds: ten-digit CIKs, no duplicates, the owner's starter list included", CURATED.every((f) => /^\d{10}$/.test(f.cik)) && new Set(CURATED.map((f) => f.cik)).size === CURATED.length && ["berkshire", "pershing", "appaloosa", "baupost", "greenlight", "third point", "scion", "lone pine", "tiger global", "duquesne"].every((m) => CURATED.some((f) => f.match === m)) && padCik("CIK1067983") === "0001067983" && padCik("abc") === "");
    check("premium: broker is Pro and metered with its per-use note, blends and more copies are Deal Team perks", featureById("copytrade.broker")?.minPlan === "pro" && !!featureById("copytrade.broker")?.perUse && !featureById("copytrade.broker")?.inAiAllowance && featureById("copytrade.blends")?.minPlan === "team" && featureById("copytrade.multi")?.minPlan === "team" && COPYTRADE_FEATURES.length === 3);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
