/**
 * Slice B of the market-data layer ("semantics"): canonical symbols, one XBRL concept resolver, the
 * normalization bug fixes, schema validation at every provider boundary and provenance on values.
 * Offline: every provider answer is a hand-written fixture shaped like the provider's documented
 * response (field names as the parsing code and research notes read them), served by a stubbed fetch.
 * No real provider data is fetched. Sections load their modules on their own, so one missing piece fails
 * its own checks and not the whole run.
 *   pnpm exec tsx scripts/test-normalize.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.YOUBANK_NO_DISK_CACHE = "1";
process.env.FMP_API_KEY = "test-key";
delete process.env.MARKET_BACKUP;
delete process.env.MARKET_DATA_DELAYED_MINUTES;

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const section = async (name: string, fn: () => Promise<void>) => {
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { fail++; console.log(`  FAIL ${name} could not run  -> ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`); }
};
const kindOf = async (p: Promise<unknown>): Promise<string> => p.then(() => "no error", (e: unknown) => (e as { kind?: string })?.kind ?? (e instanceof Error ? e.name : "thrown"));
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ---------------- A stubbed fetch: fixtures by URL ---------------- */

type Route = { match: RegExp; body: unknown; status?: number; text?: boolean };
let routes: Route[] = [];
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  const r = routes.find((x) => x.match.test(url));
  if (!r) return new Response("not found", { status: 404 });
  return new Response(r.text ? String(r.body) : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": r.text ? "text/plain" : "application/json" } });
}) as typeof fetch;
const serve = (...rs: Route[]) => { routes = rs; calls.length = 0; };

/* ---------------- Company-facts fixtures ---------------- */

type RF = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
type Facts = { cik: number; entityName: string; facts: Record<string, Record<string, { units: Record<string, RF[]> }>> };

/** One calendar fiscal year as filed: three 10-Q quarters (with 6- and 9-month YTD) and the 10-K year. */
function yearRows(y: number, annual: number, accn = "acc", share = [0.22, 0.24, 0.26, 0.28]): RF[] {
  const q = share.map((s) => Math.round(annual * s));
  const row = (start: string, end: string, val: number, fp: string, form: string, filed: string, a: string): RF => ({ start, end, val, accn: a, fy: y, fp, form, filed });
  return [
    row(`${y}-01-01`, `${y}-03-31`, q[0], "Q1", "10-Q", `${y}-05-01`, `${accn}-${y}q1`),
    row(`${y}-04-01`, `${y}-06-30`, q[1], "Q2", "10-Q", `${y}-08-01`, `${accn}-${y}q2`),
    row(`${y}-01-01`, `${y}-06-30`, q[0] + q[1], "Q2", "10-Q", `${y}-08-01`, `${accn}-${y}q2`),
    row(`${y}-07-01`, `${y}-09-30`, q[2], "Q3", "10-Q", `${y}-11-01`, `${accn}-${y}q3`),
    row(`${y}-01-01`, `${y}-09-30`, q[0] + q[1] + q[2], "Q3", "10-Q", `${y}-11-01`, `${accn}-${y}q3`),
    row(`${y}-01-01`, `${y}-12-31`, annual, "FY", "10-K", `${y + 1}-02-20`, `${accn}-${y}fy`),
  ];
}
const years = (from: number, to: number, base: number, accn = "acc") => Array.from({ length: to - from + 1 }, (_, i) => yearRows(from + i, base * (1 + 0.1 * i), accn)).flat();
const cfOf = (byTax: Record<string, Record<string, RF[]>>, unit = "USD"): Facts => ({
  cik: 1, entityName: "Fixture Co", facts: Object.fromEntries(Object.entries(byTax).map(([t, cs]) => [t, Object.fromEntries(Object.entries(cs).map(([c, rows]) => [c, { units: { [unit]: rows } }]))])),
});

const REV_606 = "RevenueFromContractWithCustomerExcludingAssessedTax";
const FIXTURES: Record<string, { cf: Facts; total2025: number }> = {
  // Moved from the pre-2018 tag to the ASC 606 tag when it took effect.
  asc606: { cf: cfOf({ "us-gaap": { SalesRevenueNet: years(2015, 2017, 1e9), [REV_606]: years(2018, 2025, 1.331e9) } }), total2025: Math.round(1.331e9 * 1.7) },
  // Kept the legacy whole-line tag throughout.
  legacy: { cf: cfOf({ "us-gaap": { Revenues: years(2016, 2025, 2e9) } }), total2025: Math.round(2e9 * 1.9) },
  // Reports total revenue only under a company extension element (the Exxon pattern).
  extension: { cf: cfOf({ "us-gaap": {}, xom: { TotalRevenuesAndOtherIncome: years(2019, 2025, 3e9) } }), total2025: Math.round(3e9 * 1.6) },
  // Product company on the goods-revenue tag only.
  goods: { cf: cfOf({ "us-gaap": { SalesRevenueGoodsNet: years(2019, 2025, 5e8) } }), total2025: Math.round(5e8 * 1.6) },
  // ASC 606 tag is a component (80%); the whole line is Revenues, in the same filings.
  subset: { cf: cfOf({ "us-gaap": { [REV_606]: years(2019, 2025, 8e8, "same"), Revenues: years(2019, 2025, 1e9, "same") } }), total2025: Math.round(1e9 * 1.6) },
};

async function main() {
  const t0 = Date.now();

  /* ================= B1: canonical symbols ================= */
  await section("B1 canonical symbols", async () => {
    const { canonical, forFmp, forNasdaq, forSec } = await import("@/lib/market/symbols");
    for (const s of ["BRK.B", "BRK-B", "BRK/B", "brk b", "  Brk.b "]) check(`canonical(${JSON.stringify(s)}) is BRK.B`, canonical(s) === "BRK.B", canonical(s));
    check("FMP spells a share class with a dash", forFmp("BRK.B") === "BRK-B" && forFmp("brk/b") === "BRK-B");
    check("Nasdaq spells it with a dot", forNasdaq("BRK-B") === "BRK.B" && forNasdaq("BRK B") === "BRK.B");
    check("SEC's ticker file spells it with a dash", forSec("BRK.B") === "BRK-B");
    check("plain tickers only change case", canonical(" aapl ") === "AAPL" && forFmp("aapl") === "AAPL" && forSec("msft") === "MSFT");
    check("indices are left alone", canonical("^GSPC") === "^GSPC" && forFmp("^gspc") === "^GSPC" && forNasdaq("^DJI") === "^DJI");
    check("crypto and FX pairs are left alone", canonical("BTCUSD") === "BTCUSD" && canonical("btc-usd") === "BTC-USD" && canonical("EURUSD") === "EURUSD");
    check("FMP's crypto spelling drops the dash", forFmp("BTC-USD") === "BTCUSD");
    check("an exchange suffix is not a share class", canonical("000001.SS") === "000001.SS");

    const { findTicker } = await import("@/lib/edgar/tickers");
    const map = new Map([["BRK-B", { cik: "0001067983", ticker: "BRK-B", name: "BERKSHIRE HATHAWAY INC" }]]);
    check("DES BRK.B finds Berkshire in SEC's ticker map", findTicker(map, "BRK.B")?.cik === "0001067983");
    check("DES brk/b finds it too", findTicker(map, "brk/b")?.cik === "0001067983");

    const fmp = await import("@/lib/market/fmp");
    serve({ match: /historical-price-eod\/full\?symbol=BRK-B/, body: [{ symbol: "BRK-B", date: "2026-10-20", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] });
    await fmp.history("BRK.B").catch(() => []);
    check("FMP is asked for BRK-B when the caller says BRK.B", calls.some((u) => /symbol=BRK-B/.test(u)), calls);

    const { dataSymbol } = await import("@/lib/algo/data");
    const { historyFrom } = await import("@/lib/market/data");
    serve({ match: /historical-price-eod\/light\?symbol=BF-B/, body: [{ symbol: "BF-B", date: "2026-10-20", price: 40, volume: 1 }] });
    const got = await historyFrom(dataSymbol("BF-B"), "2026-01-01", true).catch(() => null);
    check("algo's symbol reaches FMP as BF-B (no longer misses FMP)", calls.some((u) => /light\?symbol=BF-B/.test(u)) && got?.source === "FMP", calls.slice(0, 3));

    const nasdaq = await import("@/lib/market/nasdaq");
    serve({ match: /\/quote\/BRK\.B\/info\?assetclass=stocks/, body: { data: { symbol: "BRK.B", companyName: "Berkshire Hathaway Inc. Class B Common Stock", primaryData: { lastSalePrice: "$480.10", netChange: "+1.10", percentageChange: "+0.23%", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } } });
    const nq = await nasdaq.nasdaqQuote("BRK-B");
    check("Nasdaq is asked for BRK.B when the caller says BRK-B", nq?.price === 480.1 && calls.every((u) => !/BRK-B/.test(u)), calls);

    const copy = src("src/lib/copytrade/prices.ts"), bars = src("src/lib/quant/pit/bars.ts");
    check("copy trading no longer tries spellings one by one", !/variants\(/.test(copy) && /canonical\(/.test(copy));
    check("quant no longer tries spellings one by one", !/variants/.test(bars) && /canonical\(/.test(bars));
  });

  /* ================= B2: one XBRL concept resolver ================= */
  await section("B2 one concept resolver (FCST and DES agree)", async () => {
    const { ltmAt, quarterAt, quarterEnds, latestEnd } = await import("@/lib/edgar/facts");
    const { pickRevenue } = await import("@/lib/company");
    const { forecastRevenue } = await import("@/lib/terminal/fundamentals");
    const { annualPanel } = await import("@/lib/inference/fundamentals");
    for (const [name, { cf, total2025 }] of Object.entries(FIXTURES)) {
      const des = pickRevenue(cf as never), fc = forecastRevenue(cf as never);
      check(`${name}: DES finds revenue`, !!des, des?.concept);
      check(`${name}: FCST finds revenue`, !!fc, fc?.concept);
      if (!des || !fc) continue;
      const end = latestEnd(des.rows) as string;
      check(`${name}: LTM to 2025 is the whole line`, ltmAt(des.rows, "2025-12-31")?.value === total2025, ltmAt(des.rows, "2025-12-31")?.value);
      const ends = quarterEnds(des.rows, end, 28);
      const same = ends.every((e) => quarterAt(des.rows, e) === quarterAt(fc.rows, e));
      check(`${name}: FCST quarters equal DES quarters (${ends.length})`, same && des.concept === fc.concept, { des: des.concept, fc: fc.concept });
      const panel = annualPanel(cf as never, 6);
      check(`${name}: QUAL/IRAT annual revenue equals DES`, panel.at(-1)?.revenue === total2025, panel.at(-1)?.revenue);
    }
    check("asc606: one history across the tag change (2015 on)", (forecastRevenue(FIXTURES.asc606.cf as never)?.rows ?? []).some((r) => r.end === "2015-12-31"));

    const { mergeFrames } = await import("@/lib/market/frames");
    const { CHAINS } = await import("@/lib/edgar/concepts");
    const tags = CHAINS.revenue.tags.map((t: { tag: string }) => t.tag);
    const frames = tags.map((t: string) => t === REV_606 ? { period: "CY2025", tag: t, values: { "1": 800 }, names: { "1": "X" } } : t === "Revenues" ? { period: "CY2025", tag: t, values: { "1": 1000 }, names: { "1": "X" } } : null);
    check("EQS takes the whole line when the ASC 606 tag is a component", mergeFrames(tags, "CY2025", frames, CHAINS.revenue).values["1"] === 1000);

    const { sharesOutstanding, marketCapMm } = await import("@/lib/company");
    const dei = (vals: number[]) => cfOf({ dei: { EntityCommonStockSharesOutstanding: vals.map((v) => ({ end: "2026-07-25", val: v, accn: "brk-q2", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-03" })) } }, "shares");
    const brk = sharesOutstanding(dei([550_000, 1_300_000_000]) as never, {});
    check("shares: two classes are summed for the count", (typeof brk === "number" ? brk : brk?.total) === 1_300_550_000);
    check("market cap is never summed shares x one class's price", marketCapMm(0, 480, brk as never) === null, marketCapMm(0, 480, brk as never));
    const one = sharesOutstanding(dei([1_000_000_000]) as never, {});
    check("market cap from shares for a single class", marketCapMm(0, 50, one as never) === 50_000, marketCapMm(0, 50, one as never));
    check("the feed's market cap wins", marketCapMm(2e12, 480, brk as never) === 2_000_000);
  });

  /* ================= B3: bug fixes ================= */
  await section("B3 fiscal labels (no Q0)", async () => {
    const { fiscalLabel, fyeMonthOf } = await import("@/lib/edgar/facts");
    check("52-week September year ending Oct 1 is Q4 FY23", fiscalLabel("2023-10-01", 9) === "Q4 FY23", fiscalLabel("2023-10-01", 9));
    check("January retailer year ending Feb 3 is Q4 FY24", fiscalLabel("2024-02-03", 1) === "Q4 FY24", fiscalLabel("2024-02-03", 1));
    check("calendar quarters unchanged", fiscalLabel("2024-03-31", 12) === "Q1 FY24" && fiscalLabel("2024-12-31", 12) === "Q4 FY24");
    check("Apple's June quarter is Q3", fiscalLabel("2024-06-29", 9) === "Q3 FY24");
    check("a Dec quarter for a Sept FYE is Q1 of next FY", fiscalLabel("2023-12-30", 9) === "Q1 FY24");
    check("no label is ever Q0", ["2023-10-01", "2023-10-28", "2024-02-03", "2024-11-02"].every((d) => [1, 2, 9, 10, 12].every((m) => !/Q0|Q5/.test(fiscalLabel(d, m)))));
    check("a fiscal year end of 0203 is a January year end", fyeMonthOf("0203") === 1 && fyeMonthOf("1231") === 12 && fyeMonthOf("") === 12);
  });

  await section("B3 EPS surprise sign", async () => {
    const { epsSurprise } = await import("@/lib/market/units");
    check("beat on a negative estimate is positive (-0.05 vs -0.10: +50%)", epsSurprise(-0.05, -0.10) === 0.5, epsSurprise(-0.05, -0.10));
    check("miss on a negative estimate is negative (-0.20 vs -0.10: -100%)", epsSurprise(-0.2, -0.1) === -1, epsSurprise(-0.2, -0.1));
    check("beat on a positive estimate", Math.abs((epsSurprise(0.12, 0.1) ?? 0) - 0.2) < 1e-12);
    check("estimate of zero: surprise is undefined (null)", epsSurprise(0.05, 0) === null);
    check("no estimate: null", epsSurprise(0.05, null) === null);
  });

  await section("B3 changePct is a fraction everywhere", async () => {
    const { quoteProfile } = await import("@/lib/market/data");
    serve({ match: /\/profile\?symbol=CHGA/, body: [{ symbol: "CHGA", price: 100, marketCap: 1e9, change: 1.5, changePercentage: 1.5, range: "80-120", companyName: "Chg A", cik: "1", exchange: "NASDAQ", exchangeFullName: "Nasdaq", industry: "x", sector: "y", website: "", description: "" }] });
    const p = await quoteProfile("CHGA");
    check("FMP's percent change becomes a fraction at the boundary", p?.changePct === 0.015, p && { changePct: p.changePct });
    const { fmtChange, NA } = await import("@/lib/market/units");
    check("one display formatter: +1.50%", fmtChange(0.015) === "+1.50%" && fmtChange(-0.0023) === "-0.23%" && fmtChange(null) === NA, fmtChange(0.015));
    const files = ["src/components/terminal/Tape.tsx", "src/components/terminal/Rail.tsx", "src/components/terminal/Terminal.tsx", "src/components/terminal/screens/DesScreen.tsx", "src/components/workspace/HomeDashboard.tsx", "src/lib/meetings/copilot.ts"];
    check("UI and copilot format the change through fmtChange", files.every((f) => /fmtChange\(/.test(src(f)) && !/changePct\.toFixed|chg\.toFixed|Math\.abs\(chg\)\.toFixed|Math\.abs\(i\.chg\)/.test(src(f))), files.filter((f) => !/fmtChange\(/.test(src(f))));
    check("snapshot no longer divides by 100", !/changePct \/ 100/.test(src("src/lib/terminal/snapshot.ts")));
    check("AI tool sends a formatted change, not a raw percent", /change_today: fmtChange\(/.test(src("src/lib/ai/tools.ts")));
  });

  await section("B3 silent zeros become null", async () => {
    const { quoteProfile } = await import("@/lib/market/data");
    serve(
      { match: /\/profile\?symbol=NZRO/, body: [] },
      { match: /\/quote\/NZRO\/info/, body: { data: { symbol: "NZRO", companyName: "Nzro Inc. Common Stock", exchange: "NASDAQ-GS", primaryData: { lastSalePrice: "$12.00", netChange: "N/A", percentageChange: "N/A", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } } },
      { match: /\/quote\/NZRO\/summary/, body: { data: { summaryData: { Exchange: { value: "NASDAQ-GS" } } } } },
    );
    const p = await quoteProfile("NZRO");
    check("Nasdaq backup: missing market cap is null, not 0", p !== null && p.marketCap === null, p && { marketCap: p.marketCap });
    check("Nasdaq backup: missing change is null, not 0", p !== null && p.change === null && p.changePct === null, p && { change: p.change, changePct: p.changePct });
    const { cashPlusInvestments } = await import("@/lib/company");
    check("no cash concept at all: cash is null, not $0", cashPlusInvestments(null, null) === null, cashPlusInvestments(null, null));
    check("cash plus short-term investments still adds", cashPlusInvestments(2e6, 1e6) === 3);
    const { fromNasdaqMover } = await import("@/lib/terminal/markets");
    const m = fromNasdaqMover({ symbol: "X", name: "X", price: 5, change: null, changePct: null, volume: null });
    check("a mover with no change reads as null, not 0", m.change === null && m.changePct === null, m);
    const { trailingEps } = await import("@/lib/market/units");
    check("trailing EPS with a missing quarter is null, not a 3-quarter sum", trailingEps([1, null, 1, 1]) === null && trailingEps([1, 1, 1, 1]) === 4 && trailingEps([1, 1]) === null);
    check("analyst counts are null when nobody reported them", /counts: nt \? \{ buy: nt\.buy, hold: nt\.hold, sell: nt\.sell \} : null/.test(src("src/lib/terminal/street.ts")) && !/factNum\(r, "buy"\) \?\? 0/.test(src("src/lib/terminal/street.ts")));
    check("researched dividend left blank stays blank", !/factNum\(r, "annualDividend"\) \?\? 0/.test(src("src/lib/terminal/street.ts")));
  });

  await section("B3 DDIS uses one filing for every bucket", async () => {
    const { maturityLadder } = await import("@/lib/terminal/fundamentals");
    const inst = (end: string, val: number, accn: string, filed: string): RF => ({ end, val, accn, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed });
    const cf = cfOf({ "us-gaap": {
      LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths: [inst("2021-12-31", 100e6, "k21", "2022-02-20"), inst("2025-12-31", 300e6, "k25", "2026-02-20")],
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo: [inst("2025-12-31", 400e6, "k25", "2026-02-20")],
      // Stopped tagging this bucket after 2021: its old value must not join the 2025 ladder.
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive: [inst("2021-12-31", 900e6, "k21", "2022-02-20")],
    } });
    const l = maturityLadder(cf as never);
    check("ladder is from the 2025 10-K only", l.asOf === "2025-12-31" && l.ladder.length === 2 && !l.ladder.some((b) => b.bucket === "Year 5"), l);
    check("total excludes the stale 2021 bucket", l.ladder.reduce((a, b) => a + b.amount, 0) === 700, l.ladder);
  });

  await section("B3 market days in New York (NYSE calendar)", async () => {
    const cal = await import("@/lib/market/calendar");
    check("2026 Thanksgiving, Good Friday and Juneteenth are closed", !cal.isTradingDay("2026-11-26") && !cal.isTradingDay("2026-04-03") && !cal.isTradingDay("2026-06-19"));
    check("2026 early closes: Nov 27, Dec 24", cal.isEarlyClose("2026-11-27") && cal.isEarlyClose("2026-12-24") && !cal.isEarlyClose("2026-07-02"));
    check("2027: Good Friday Mar 26, Juneteenth Jun 18, early close Nov 26", !cal.isTradingDay("2027-03-26") && !cal.isTradingDay("2027-06-18") && cal.isEarlyClose("2027-11-26"));
    check("2025: President Carter's day of mourning was closed", !cal.isTradingDay("2025-01-09"));
    const mh = await import("@/lib/copytrade/markethours");
    const disagree: string[] = [];
    for (const y of [2025, 2026, 2027]) for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (s !== "2025-01-09" && cal.isTradingDay(s) !== mh.isTradingDay(s)) disagree.push(s);
      if (cal.isEarlyClose(s) !== mh.earlyCloses(y).has(s)) disagree.push(`early ${s}`);
    }
    check("the 2025-2027 table agrees with the exchange's holiday rules", disagree.length === 0, disagree);
    const nyEvening = new Date("2026-01-01T02:00:00Z"); // 21:00 ET on 31 Dec
    check("at 9 pm ET on New Year's Eve the market day is still Dec 31 (not UTC's Jan 1)", cal.marketDate(nyEvening) === "2025-12-31", cal.marketDate(nyEvening));
    check("latest trading day on New Year's Day morning is Dec 31", cal.latestTradingDay(new Date("2026-01-01T15:00:00Z")) === "2025-12-31");
    check("latest trading day before the open is the previous session", cal.latestTradingDay(new Date("2026-10-21T12:00:00Z")) === "2026-10-20");
    check("market year at New Year's Eve evening is the old year", cal.marketYear(nyEvening) === 2025);
    const { quoteTtl } = await import("@/lib/market/fmp");
    check("quote cache is long on Thanksgiving (market closed)", quoteTtl(new Date("2026-11-26T16:00:00Z")) === 30 * 60_000, quoteTtl(new Date("2026-11-26T16:00:00Z")));
    check("quote cache is long after a 1 pm early close", quoteTtl(new Date("2026-11-27T18:30:00Z")) === 30 * 60_000);
    check("quote cache is a minute in a normal session", quoteTtl(new Date("2026-10-21T15:00:00Z")) === 60_000);
    check("Nasdaq's trade time in ET becomes an instant", cal.parseEtStamp("Oct 20, 2026 4:00 PM ET") === "2026-10-20T20:00:00.000Z" && cal.parseEtStamp("DATA AS OF Jul 2, 2026 9:45 AM ET") === "2026-07-02T13:45:00.000Z", cal.parseEtStamp("Oct 20, 2026 4:00 PM ET"));
    check("clock in ET", cal.etClock("2026-10-20T14:42:00Z") === "10:42 ET" && cal.etClock("2026-01-20T15:05:00Z") === "10:05 ET");
    check("a quote from yesterday's close is fresh before today's open", !cal.isStaleQuote("2026-10-20T20:00:00Z", new Date("2026-10-21T12:00:00Z")));
    check("a quote from two sessions back is stale", cal.isStaleQuote("2026-10-16T20:00:00Z", new Date("2026-10-21T12:00:00Z")));
    check("an hour-old quote in the session is stale", cal.isStaleQuote("2026-10-21T14:00:00Z", new Date("2026-10-21T15:30:00Z")));
    const files = ["src/lib/terminal/markets.ts", "src/lib/terminal/street.ts", "src/lib/market/nasdaq.ts"];
    check("market-date code no longer uses UTC today", files.every((f) => !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|new Date\(\)\.getUTCFullYear\(\)|new Date\(\)\.toISOString\(\)\.slice\(0, 4\)/.test(src(f))), files.filter((f) => /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|getUTCFullYear\(\)/.test(src(f))));
  });

  await section("B3 ETF stand-ins are labelled", async () => {
    const { historyFrom } = await import("@/lib/market/data");
    const { withProvenance } = await import("@/lib/market/provenance");
    serve(
      { match: /historical-price-eod\/light\?symbol=%5EGSPC/, body: "Restricted Endpoint", text: true, status: 402 },
      { match: /\/quote\/SPY\/info\?assetclass=stocks/, body: { data: null } },
      { match: /\/quote\/SPY\/info\?assetclass=etf/, body: { data: { symbol: "SPY", primaryData: { lastSalePrice: "$670.00" } } } },
      { match: /\/quote\/SPY\/historical/, body: { data: { tradesTable: { rows: [{ date: "10/20/2026", close: "$670.00", volume: "1,000", open: "$668.00", high: "$671.00", low: "$667.00" }, { date: "10/17/2026", close: "$665.00", volume: "1,000", open: "$664.00", high: "$666.00", low: "$663.00" }] } } } },
    );
    const run = await withProvenance(() => historyFrom("^GSPC", "2026-10-01", true));
    check("the S&P 500 via SPY is labelled in the data", run.value.via === "SPY" && run.value.label === "S&P 500 via SPY", { via: run.value.via, label: run.value.label });
    check("and in the sources note", run.notes.includes("S&P 500 via SPY"), run.notes);
    const ms = src("src/components/terminal/screens/MarketScreens.tsx");
    check("the board shows the stand-in label beside the level", /r\.label/.test(ms));
    check("board rows carry the label", /label: got\.label/.test(src("src/lib/terminal/markets.ts")));
  });

  await section("B3 one Form 4 parser, one cache key", async () => {
    const xml = `<ownershipDocument><documentType>4</documentType><periodOfReport>2026-10-01</periodOfReport>
<issuer><issuerCik>0000320193</issuerCik><issuerName>Apple Inc.</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>0001</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isOfficer>true</isOfficer><officerTitle>CFO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares>1,000</transactionShares><transactionPricePerShare><value>250.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction></nonDerivativeTable>
<derivativeTable><derivativeTransaction><securityTitle><value>Option</value></securityTitle><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>500</value></transactionShares><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></derivativeTransaction></derivativeTable></ownershipDocument>`;
    const { parseInsiderXml } = await import("@/lib/edgar/insiders");
    const tx = parseInsiderXml(xml, { filed: "2026-10-02", index: "https://www.sec.gov/x/" });
    const sale = tx.find((t) => !t.derivative);
    check("INS reads shares written without a <value> wrapper", sale?.shares === 1000, sale);
    check("INS keeps the acquired/disposed code", (sale as { acquired?: boolean } | undefined)?.acquired === false);
    check("INS keeps derivative lines", tx.some((t) => t.derivative && t.shares === 500));
    const { parseForm4 } = await import("@/lib/quant/insiders/parse");
    const f4 = parseForm4(xml);
    check("INSC and INS read the same line", f4.lines[0]?.shares === sale?.shares && f4.lines[0]?.price === sale?.price && f4.lines[0]?.ownedAfter === sale?.owned);
    check("INSC still reads non-derivative lines only", f4.lines.length === 1);
    const { form4CacheKey } = await import("@/lib/edgar/form4");
    check("one cache key per filing", form4CacheKey("0000320193-26-000001") === "form4-0000320193-26-000001.json");
    check("INS and INSC fetch through the same helper", /form4Xml\(/.test(src("src/lib/edgar/insiders.ts")) && /form4Xml\(/.test(src("src/lib/quant/insiders/store.ts")));
  });

  /* ================= B4: schema validation at every boundary ================= */
  await section("B4 drift becomes a schema failure, never NaN or 0", async () => {
    const fmp = await import("@/lib/market/fmp");
    serve({ match: /historical-price-eod\/full\?symbol=DRFT/, body: [{ symbol: "DRFT", date: "2026-10-20", open: 1, high: 1, low: 1, adjClose: 1, volume: 1 }] });
    check("FMP history: a renamed close is a schema failure", await kindOf(fmp.history("DRFT")) === "schema", await kindOf(fmp.history("DRFT")));
    serve({ match: /\/quote\?symbol=DRFQ/, body: [{ symbol: "DRFQ", lastPrice: 10, changePercentage: 1 }] });
    check("FMP quote: a renamed price gives no quote rather than an undefined price", (await fmp.quote("DRFQ")) === null);
    serve({ match: /\/earnings\?symbol=DRFE/, body: [{ reportDate: "2026-10-20", epsActual: 1 }] });
    check("FMP earnings: drift is a schema failure", await kindOf(fmp.earnings("DRFE")) === "schema");
    serve({ match: /\/profile\?symbol=DRFP/, body: [{ symbol: "DRFP", lastPrice: 10 }] });
    const { fmpProfile } = await import("@/lib/fmp/client");
    check("FMP profile: drift is a schema failure", await kindOf(fmpProfile("DRFP")) === "schema");

    const nasdaq = await import("@/lib/market/nasdaq");
    serve(
      { match: /\/quote\/DRFN\/info\?assetclass=stocks/, body: { data: { symbol: "DRFN", primaryData: { lastSalePrice: "$5.00" } } } },
      { match: /\/quote\/DRFN\/historical/, body: { data: { tradesTable: { rows: [{ date: "10/20/2026", closePrice: "$5.00", volume: "1", open: "$5", high: "$5", low: "$5" }] } } } },
    );
    check("Nasdaq history: a renamed close is a schema failure", await kindOf(nasdaq.nasdaqHistory("DRFN", "2026-01-01")) === "schema");
    serve({ match: /\/analyst\/DRFT\/targetprice/, body: { data: { consensusOverview: { priceTarget: "high" } } } });
    check("Nasdaq targets: drift is a schema failure", await kindOf(nasdaq.nasdaqTargets("DRFT")) === "schema");

    const facts = await import("@/lib/edgar/facts");
    const bad = { cik: 1, entityName: "X", facts: { "us-gaap": { Revenues: { units: { USD: [{ start: "2025-01-01", end: "2025-12-31", value: 5, accn: "a", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01" }] } } } } };
    check("SEC companyfacts: a renamed val is a schema failure", await kindOf(Promise.resolve().then(() => facts.rowsFor(bad as never, "us-gaap", "Revenues"))) === "schema");
    check("SEC companyfacts: a broken envelope is a schema failure", await kindOf(Promise.resolve().then(() => facts.parseCompanyFacts({ cik: 1, entityName: "X", fact: {} }))) === "schema");
    const { parseTickerFile } = await import("@/lib/edgar/tickers");
    check("SEC tickers file: drift is a schema failure", await kindOf(Promise.resolve().then(() => parseTickerFile({ 0: { cik: 1, ticker: "A", title: "A" } }))) === "schema");
    check("SEC tickers file: the real shape parses", parseTickerFile({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }).get("AAPL")?.cik === "0000320193");
    const { parseSubmissions } = await import("@/lib/edgar/submissions");
    check("SEC submissions: missing filings is a schema failure", await kindOf(Promise.resolve().then(() => parseSubmissions({ cik: "1", name: "X", sic: "", sicDescription: "", fiscalYearEnd: "1231", tickers: [], exchanges: [] }))) === "schema");
    const { parseFrame } = await import("@/lib/market/frames");
    check("SEC frames: a renamed val is a schema failure", await kindOf(Promise.resolve().then(() => parseFrame({ data: [{ accn: "a", cik: 1, entityName: "X", loc: "US-CA", end: "2025-12-31", value: 1 }] }))) === "schema");

    const { parseTreasuryCsv } = await import("@/lib/market/treasury");
    check("Treasury CSV: the real shape parses", parseTreasuryCsv(`Date,"1 Mo","10 Yr"\n10/20/2026,4.10,4.05\n`)[0]?.yields["10 Yr"] === 4.05);
    check("Treasury CSV: a missing Date column is a schema failure", await kindOf(Promise.resolve().then(() => parseTreasuryCsv(`Record Date,"1 Mo"\n10/20/2026,4.10\n`))) === "schema");
    const { parseFredCsv } = await import("@/lib/market/fred");
    check("FRED CSV: the real shape parses ('.' skipped)", parseFredCsv("observation_date,UNRATE\n2026-08-01,4.3\n2026-09-01,.\n", "UNRATE").length === 1);
    check("FRED CSV: a changed layout is a schema failure", await kindOf(Promise.resolve().then(() => parseFredCsv("<html>moved</html>", "UNRATE"))) === "schema");
    const { parseBls } = await import("@/lib/market/bls");
    check("BLS: the real shape parses", parseBls({ status: "REQUEST_SUCCEEDED", Results: { series: [{ seriesID: "LNS14000000", data: [{ year: "2026", period: "M09", value: "4.3" }] }] } }).LNS14000000?.[0]?.value === 4.3);
    check("BLS: drift is a schema failure", await kindOf(Promise.resolve().then(() => parseBls({ status: "REQUEST_SUCCEEDED", Results: { series: [{ seriesID: "X", observations: [] }] } }))) === "schema");

    const cg = await import("@/lib/crypto/market");
    check("CoinGecko markets: rows without ids are a schema failure", await kindOf(Promise.resolve().then(() => cg.parseMarkets([{ symbol: "btc" }]))) === "schema");
    check("CoinGecko chart: a renamed prices field is a schema failure", await kindOf(Promise.resolve().then(() => cg.parseChart({ price: [[1, 2]] }))) === "schema");
    check("CoinGecko global: drift is a schema failure", await kindOf(Promise.resolve().then(() => cg.parseGlobal({ stats: {} }))) === "schema");
    const llama = await import("@/lib/crypto/defi");
    check("DefiLlama protocols: drift is a schema failure", await kindOf(Promise.resolve().then(() => llama.parseProtocols({ protocols: [] }))) === "schema");
  });

  /* ================= Canonical shapes (for Slice C adapters) ================= */
  await section("canonical shapes and conversions", async () => {
    const c = await import("@/lib/market/canonical");
    check("percent to fraction", c.pctToFraction(1.5) === 0.015 && c.pctToFraction(null) === null && c.pctToFraction(Number.NaN) === null && c.pctToFraction("+0.58%") === 0.0058);
    check("thousands to units", c.thousandsToUnits(1234.5) === 1_234_500 && c.thousandsToUnits(null) === null);
    check("epoch seconds and milliseconds to ISO", c.epochToIso(1792512000) === "2026-10-20T16:00:00.000Z" && c.epochToIso(1792512000000) === "2026-10-20T16:00:00.000Z" && c.epochToIso(0) === null);
    check("exchange-local New York time to ISO", c.nyLocalToIso("2026-10-20", "16:00") === "2026-10-20T20:00:00.000Z" && c.nyLocalToIso("2026-01-20", "09:30") === "2026-01-20T14:30:00.000Z");
    check("ISO date from US and long forms", c.isoDay("10/20/2026") === "2026-10-20" && c.isoDay("Oct 20, 2026") === "2026-10-20" && c.isoDay("2026-10-20T00:00:00Z") === "2026-10-20" && c.isoDay("soon") === null);
    const fmp = await import("@/lib/market/fmp");
    serve({ match: /\/quote\?symbol=CANQ/, body: [{ symbol: "CANQ", name: "C", price: 10, changePercentage: 2, change: 0.2, volume: 1, dayLow: 9, dayHigh: 11, yearHigh: 12, yearLow: 8, marketCap: 1e9, priceAvg50: 10, priceAvg200: 10, exchange: "NYSE", open: 10, previousClose: 9.8, timestamp: 1792512000 }] });
    const q = await fmp.fmpQuote("CANQ");
    check("FMP quote maps to the canonical Quote", q?.symbol === "CANQ" && q.price === 10 && q.changePct === 0.02 && q.source === "FMP" && q.asOf === "2026-10-20T16:00:00.000Z", q);
    const nasdaq = await import("@/lib/market/nasdaq");
    serve({ match: /\/quote\/CANN\/info\?assetclass=stocks/, body: { data: { symbol: "CANN", companyName: "N", primaryData: { lastSalePrice: "$20.00", netChange: "+0.20", percentageChange: "+1.01%", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } } });
    const nq = await nasdaq.nasdaqQuote("CANN");
    check("Nasdaq quote maps to the same Quote shape", nq?.changePct === 0.0101 && nq.source === "Nasdaq" && nq.delayed === true && nq.asOf === "2026-10-20T20:00:00.000Z", nq);
  });

  /* ================= B5: provenance on values ================= */
  await section("B5 provenance", async () => {
    const { noteSource, withProvenance } = await import("@/lib/market/provenance");
    const run = await withProvenance(async () => {
      noteSource("FMP", undefined, { asOf: "2026-10-21T14:00:00.000Z", fetchedAt: "2026-10-21T14:01:00.000Z" });
      noteSource("Nasdaq", "AAPL from Nasdaq", { asOf: "2026-10-20T20:00:00.000Z", delayed: true, stale: true });
      return 1;
    });
    const meta = (run as { meta?: { asOf?: string; stale?: boolean; delayed?: boolean } }).meta;
    check("the collector keeps the oldest as-of and the flags", meta?.asOf === "2026-10-20T20:00:00.000Z" && meta?.stale === true && meta?.delayed === true, meta);
    const { sourceHeaders } = await import("@/lib/market/source-header");
    const h = JSON.parse(sourceHeaders(run)["x-data-sources"] ?? "{}");
    check("x-data-sources carries providers, notes, as-of and flags", h.providers?.join() === "FMP,Nasdaq" && h.notes?.[0] === "AAPL from Nasdaq" && h.asOf === "2026-10-20T20:00:00.000Z" && h.stale === true && h.delayed === true, h);
    process.env.MARKET_DATA_DELAYED_MINUTES = "15";
    const h2 = JSON.parse(sourceHeaders({ providers: ["FMP"], notes: [], meta: {} })["x-data-sources"] ?? "{}");
    check("MARKET_DATA_DELAYED_MINUTES marks feed prices as delayed by N minutes", h2.delayed === true && h2.delayedMinutes === 15, h2);
    const h3 = JSON.parse(sourceHeaders({ providers: ["SEC EDGAR"], notes: [], meta: {} })["x-data-sources"] ?? "{}");
    check("filings are never marked delayed", h3.delayed === undefined, h3);
    delete process.env.MARKET_DATA_DELAYED_MINUTES;
    check("no sources, no header", Object.keys(sourceHeaders({ providers: [], notes: [], meta: {} })).length === 0);
    check("/api/companies sends x-data-sources like the terminal", /sourceHeaders\(/.test(src("src/app/api/companies/route.ts")) && /sourceHeaders\(/.test(src("src/app/api/terminal/[fn]/route.ts")));

    const { fmpProfile } = await import("@/lib/fmp/client");
    serve({ match: /\/profile\?symbol=ASOF/, body: [{ symbol: "ASOF", price: 10, marketCap: 1e9, change: 0.1, changePercentage: 1, range: "5-15", companyName: "As Of", cik: "1", exchange: "NYSE", exchangeFullName: "NYSE", industry: "", sector: "", website: "", description: "" }] });
    const first = await fmpProfile("ASOF");
    await new Promise((r) => setTimeout(r, 25));
    const second = await fmpProfile("ASOF");
    check("as-of from a cache hit equals the original fetch time", !!first && first.fetchedAt === second?.fetchedAt, { first: first?.fetchedAt, second: second?.fetchedAt });

    const { quoteProfile } = await import("@/lib/market/data");
    serve(
      { match: /\/profile\?symbol=NQTM/, body: [] },
      { match: /\/quote\/NQTM\/info/, body: { data: { symbol: "NQTM", companyName: "N", exchange: "NYSE", primaryData: { lastSalePrice: "$20.00", netChange: "+0.20", percentageChange: "+1.01%", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } } },
      { match: /\/quote\/NQTM\/summary/, body: { data: { summaryData: { MarketCap: { value: "2,000,000,000" } } } } },
    );
    const pr = await withProvenance(() => quoteProfile("NQTM"));
    check("Nasdaq's trade time is the price's as-of (not now)", pr.value?.asOf === "2026-10-20T20:00:00.000Z", pr.value?.asOf);
    check("a non-real-time Nasdaq quote is noted as delayed", (pr as { meta?: { delayed?: boolean } }).meta?.delayed === true && pr.value?.delayed === true);
    serve({ match: /\/quote\?symbol=TSQ/, body: [{ symbol: "TSQ", name: "T", price: 10, changePercentage: 2, change: 0.2, volume: 1, dayLow: 9, dayHigh: 11, yearHigh: 12, yearLow: 8, marketCap: 1e9, priceAvg50: 10, priceAvg200: 10, exchange: "NYSE", open: 10, previousClose: 9.8, timestamp: 1792512000 }] });
    const { quotes } = await import("@/lib/market/data");
    const qr = await withProvenance(() => quotes(["TSQ"]));
    check("FMP's quote timestamp is the as-of", qr.meta?.asOf === new Date(1792512000 * 1000).toISOString() && qr.value.TSQ?.changePct === 0.02, { meta: qr.meta, q: qr.value.TSQ });

    const tools = src("src/lib/ai/tools.ts"), inf = src("src/lib/ai/inference-tools.ts"), studio = src("src/lib/studio/inference-tools.ts");
    check("AI price citation names the source that answered", /c\.price\.source/.test(tools) && !/price and market cap, FMP,/.test(tools));
    check("WACC citation names the feeds that answered", /withProvenance/.test(inf.slice(inf.indexOf("costOfCapitalTool"))) && !/prices from Financial Modeling Prep`/.test(inf));
    check("Studio risk check cites the feeds that answered", !/"Prices: Financial Modeling Prep \(when on the plan\)"/.test(studio));
    const kit = src("src/components/terminal/kit.tsx");
    check("badges: Delayed, Stale · as of, Backup source", /Delayed/.test(kit) && /Stale · as of/.test(kit) && /Backup source/.test(kit));
    check("badges name the source that answered", /answeredBy/.test(kit));
    check("DES shows the price badges", /PriceBadges/.test(src("src/components/terminal/screens/DesScreen.tsx")));
  });

  /* ================= Review regressions (each failed before its fix) ================= */
  await section("review: foreign listings keep their exchange suffix", async () => {
    const { canonical, forFmp, forNasdaq, forSec, hasExchangeSuffix } = await import("@/lib/market/symbols");
    for (const s of ["SHOP.TO", "VOD.L", "SAP.DE", "BHP.AX", "NESN.SW", "MC.PA", "0700.HK"]) check(`${s} is a listing, not a class: FMP and Nasdaq get ${s}`, canonical(s) === s && forFmp(s) === s && forNasdaq(s) === s && hasExchangeSuffix(s), [canonical(s), forFmp(s), forNasdaq(s)]);
    check("share classes are still classes (BF.B, MKC.V, BAC-PL, BRK/B)", forFmp("BF.B") === "BF-B" && forFmp("MKC.V") === "MKC-V" && forSec("BAC-PL") === "BAC-PL" && canonical("BRK/B") === "BRK.B" && !hasExchangeSuffix("BRK.B"));
    const fmp = await import("@/lib/market/fmp");
    serve({ match: /historical-price-eod\/full\?symbol=SHOP\.TO/, body: [{ symbol: "SHOP.TO", date: "2026-10-20", open: 150, high: 152, low: 149, close: 151, volume: 10 }] });
    const bars = await fmp.history("shop.to").catch(() => []);
    check("GP SHOP.TO asks FMP for SHOP.TO (not SHOP-TO) and gets bars", bars.length === 1 && calls.some((u) => /symbol=SHOP\.TO/.test(u)), calls);
  });

  await section("review: Nasdaq's normal answers are not drift", async () => {
    const nasdaq = await import("@/lib/market/nasdaq");
    serve({ match: /\/quote\/FLAT\/info\?assetclass=stocks/, body: { data: { symbol: "FLAT", companyName: "Flat Co. Common Stock", exchange: "NYSE", primaryData: { lastSalePrice: "$12.00", netChange: "UNCH", percentageChange: "UNCH", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false, volume: "1,234" } } } });
    const q = await nasdaq.nasdaqQuote("FLAT").catch((e: unknown) => e);
    check("an unchanged quote (netChange UNCH) is a quote with no change, not a schema failure", !!q && (q as { price?: number }).price === 12 && (q as { change?: unknown }).change === null && (q as { changePct?: unknown }).changePct === null, q);
    const row = (symbol: string, change: string, pct: string) => ({ symbol, name: symbol, lastSalePrice: "$10.00", lastSaleChange: change, change: pct });
    serve({ match: /\/marketmovers/, body: { data: { asOf: "Oct 20, 2026", STOCKS: { MostActiveByShareVolume: { table: { rows: [row("AA", "UNCH", "1,000")] } }, MostAdvanced: { table: { rows: [row("BB", "+1.00", "+11.11%")] } }, MostDeclined: { table: { rows: [row("CC", "-1.00", "-9.09%")] } }, MostActiveByDollarVolume: null } } } });
    const m = await nasdaq.nasdaqMovers().catch((e: unknown) => e);
    check("movers with an UNCH row and another null table parse", !!m && (m as { actives?: unknown[] }).actives?.length === 1 && (m as { gainers: { changePct: number }[] }).gainers[0]?.changePct === 0.1111, m);
    serve({ match: /\/analyst\/NMTG\/earnings-forecast/, body: { data: { quarterlyForecast: { rows: [{ fiscalEnd: "Dec 2026", consensusEPSForecast: "NM", highEPSForecast: "--", lowEPSForecast: "($0.05)", noOfEstimates: "N/A" }] }, yearlyForecast: null } } });
    const f = await nasdaq.nasdaqEpsForecast("NMTG").catch((e: unknown) => e);
    check("forecast words (NM, --, N/A) read as null, not drift", !!f && (f as { quarterly: { consensus: unknown }[] }).quarterly?.[0]?.consensus === null, f);
  });

  await section("review: FMP numbers written as text are numbers", async () => {
    const fmp = await import("@/lib/market/fmp");
    serve({ match: /\/quote\?symbol=TXTQ/, body: [{ symbol: "TXTQ", name: "T", price: "10.50", changePercentage: "1.2", change: "0.12", volume: "", exchange: "NYSE", timestamp: 1792512000 }] });
    const q = await fmp.fmpQuote("TXTQ");
    check("a quote with numeric text parses to numbers (and a fraction change)", q?.price === 10.5 && q.changePct === 0.012 && q.volume === null, q);
    serve({ match: /\/quote\?symbol=TXTB/, body: [{ symbol: "TXTB", price: "ten" }] });
    check("non-numeric text is still drift (no quote, never NaN)", (await fmp.quote("TXTB")) === null);
  });

  await section("review: off-session quotes are not flagged stale by New York's clock", async () => {
    const { nyseSession, quotes } = await import("@/lib/market/data");
    const { withProvenance } = await import("@/lib/market/provenance");
    check("NYSE-session symbols", nyseSession("AAPL") && nyseSession("brk-b") && nyseSession("^GSPC"));
    check("not NYSE-session: foreign index, foreign listing, FX, crypto, commodity", !nyseSession("^N225") && !nyseSession("^GDAXI") && !nyseSession("SHOP.TO") && !nyseSession("EURUSD") && !nyseSession("BTCUSD") && !nyseSession("GCUSD") && !nyseSession("000001.SS"));
    const old = 1577984400; // 2020-01-02: behind any session
    const qrow = (symbol: string) => ({ symbol, name: symbol, price: 100, changePercentage: 0.5, exchange: "X", timestamp: old });
    serve({ match: /\/quote\?symbol=%5EN225/, body: [qrow("^N225")] });
    const n = await withProvenance(() => quotes(["^N225"]));
    check("a Nikkei quote from Tokyo's close is not marked stale on the board", n.value["^N225"]?.price === 100 && !n.meta.stale, n.meta);
    serve({ match: /\/quote\?symbol=OLDQ/, body: [qrow("OLDQ")] });
    const u = await withProvenance(() => quotes(["OLDQ"]));
    check("a US quote that far behind is still stale", u.meta.stale === true, u.meta);
  });

  await section("review: a bank's total net revenue is the whole line", async () => {
    const { resolveRevenue, CHAINS } = await import("@/lib/edgar/concepts");
    const { ltmAt, latestEnd } = await import("@/lib/edgar/facts");
    // Fees under the ASC 606 tag (20%), total net revenue under RevenuesNetOfInterestExpense, in the same filings.
    const bank = cfOf({ "us-gaap": { [REV_606]: years(2019, 2025, 2e8, "bank"), RevenuesNetOfInterestExpense: years(2019, 2025, 1e9, "bank") } });
    const r = resolveRevenue(bank as never);
    const end = r ? latestEnd(r.rows) : null;
    const ltm = r && end ? ltmAt(r.rows, end)?.value : null;
    check("DES/FCST revenue for a bank is total net revenue, not fee income", ltm === Math.round(1e9 * 1.6), { concept: r?.concept, ltm });
    const { mergeFrames } = await import("@/lib/market/frames");
    const fr = (tag: string, v: number) => ({ period: "CY2025", tag, values: { "1": v }, names: { "1": "Bank" } });
    const m = mergeFrames([REV_606, "Revenues", "RevenuesNetOfInterestExpense"], "CY2025", [fr(REV_606, 200), null, fr("RevenuesNetOfInterestExpense", 1000)], CHAINS.revenue);
    check("EQS frames agree for the bank", m.values["1"] === 1000, m.values);
    const both = mergeFrames([REV_606, "Revenues", "RevenuesNetOfInterestExpense"], "CY2025", [fr(REV_606, 200), fr("Revenues", 900), fr("RevenuesNetOfInterestExpense", 1000)], CHAINS.revenue);
    check("with Revenues reported too, Revenues stays the whole line", both.values["1"] === 900, both.values);
  });

  await section("review: smaller fixes", async () => {
    const { parseTreasuryCsv } = await import("@/lib/market/treasury");
    check("an empty Treasury year (early January) is no rows, not a schema failure", (await Promise.resolve().then(() => parseTreasuryCsv("")).catch(() => "threw")) instanceof Array);
    const cal = await import("@/lib/market/calendar");
    check("a Nasdaq stamp with a prefix still gives its time", cal.parseEtStamp("Closed at Oct 20, 2026 4:00 PM ET") === "2026-10-20T20:00:00.000Z", cal.parseEtStamp("Closed at Oct 20, 2026 4:00 PM ET"));
    check("after 2027 the exchange rules stand in (Good Friday 2028 closed, a normal Monday open)", !cal.isTradingDay("2028-04-14") && cal.isTradingDay("2028-10-16"));
    const { parseOrThrow } = await import("@/lib/market/validate");
    const { z } = await import("zod");
    const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
    const Rows = z.array(z.object({ close: z.number() }));
    for (const bad of [[{ close: "x" }], [{ close: 1 }, { close: "x" }], [{ close: 1 }, { close: 1 }, { close: "x" }]]) { try { parseOrThrow(Rows, bad, "Test", "rows"); } catch { /* expected */ } }
    console.warn = warn;
    check("one bad row at a different index per answer is logged once", warned === 1, warned);
    check("the demo snapshot stays in percent (the landing demo prints it with %)", /changePct \* 1e7\) \/ 1e5/.test(src("scripts/snapshot.ts")));
    const { STUDENT_PACK } = await import("@/lib/workflows/packs/student");
    const lbo = STUDENT_PACK.find((t) => t.id === "paper-lbo-timed") as unknown as { prefill: (c: unknown) => { entryMultiple: number } };
    const multiClass = { ltm: { adjEbitda: 100, ebitda: 100 }, price: { last: 50, marketCap: null }, balance: { debt: 300, cash: 50 } };
    check("paper LBO with no market cap uses the default multiple, not debt alone (2.5x)", lbo.prefill(multiClass).entryMultiple === 10, lbo.prefill(multiClass));
  });

  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed (${Date.now() - t0} ms)`);
  process.exit(fail ? 1 : 0);
}

void main();
