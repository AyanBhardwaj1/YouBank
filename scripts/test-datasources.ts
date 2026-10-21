/**
 * Checks for free sources, per-person source choice and bring-your-own keys (docs/data-layer.md, "Free
 * sources & your own keys"): registry metadata (C2), the free adapters' mapping into the canonical shapes
 * through zod (C1), keyed data kept to its owner (C3), preferences and the settings API (C4), field-level
 * fallthrough and attribution (C5). Every upstream is a stubbed fetch with synthetic payloads built from
 * the providers' documented shapes: nothing leaves the machine, and nothing here is live data.
 *
 * Checks that need Postgres run when DATABASE_URL points at a LOCAL database with the schema (0029
 * included) and are skipped otherwise:
 *   pnpm exec tsx scripts/test-datasources.ts
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/yb_src pnpm exec tsx scripts/test-datasources.ts
 *   ONLY=C3 pnpm exec tsx scripts/test-datasources.ts
 */
import { randomUUID } from "node:crypto";

process.env.FMP_API_KEY ??= "test-key";
process.env.YOUBANK_NO_DISK_CACHE = "1";
process.env.MARKET_BACKUP = "on";
process.env.EMAIL_TOKEN_SECRET ??= "test-secret-for-datasources-0123456789";
process.env.EIA_API_KEY ??= "eia-owner-key";
process.env.BEA_API_KEY ??= "bea-owner-key";
delete process.env.OPENAI_API_KEY;

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)?.slice(0, 600)}` : ""}`); }
};
async function section(name: string, fn: () => Promise<void> | void) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  console.log(name);
  try { await fn(); } catch (e) { check(`${name}: ran without throwing`, false, e instanceof Error ? `${e.name}: ${e.message} ${e.stack?.split("\n")[1] ?? ""}` : String(e)); }
}
const uid = () => randomUUID().slice(0, 8).toUpperCase();
setInterval(() => undefined, 1_000);

function localDb(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname); } catch { return false; }
}


/* ---------------- The stubbed network (documented shapes; synthetic values) ---------------- */

/** Keys used in these tests: each provider answers with a price that names the key (A's 111.111, B's 222.222). */
const KEYS = {
  tiingoA: "tiingoKeyAAAAAAAAAAAAAAAAAAAAAAA1", tiingoB: "tiingoKeyBBBBBBBBBBBBBBBBBBBBBBB2", finnhubA: "finnhubKeyAAAAAAAA1", twelveA: "twelveKeyAAAAAAAAAAAA1",
  alphaA: "ALPHAKEYAAAAAAA1", fmpA: "fmpUserKeyAAAAAAAAAAAAAA1",
};
/** Values no other fixture produces, so a keyed answer is recognisable wherever it lands. */
const MARK: Record<string, number> = { [KEYS.tiingoA]: 111.111, [KEYS.tiingoB]: 222.222, [KEYS.finnhubA]: 333.333, [KEYS.twelveA]: 444.444, [KEYS.alphaA]: 555.555, [KEYS.fmpA]: 666.666 };
const calls: string[] = [];
/** Per URL substring: a forced answer (a status, a hang, a network error, or a body). */
const forced: Record<string, "503" | "401" | "neterr" | "neterr-url" | { body: unknown; status?: number }> = {};
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const netErr = (msg = "fetch failed") => Object.assign(new TypeError(msg), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });

function tradingDays(n: number): string[] {
  const out: string[] = []; const d = new Date();
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out.reverse();
}
const DAYS = tradingDays(400);
const after = (from: string) => DAYS.filter((d) => d >= from);

/** The key a request carries, wherever the provider takes it. */
function keyOf(url: string, h: Headers): string {
  const a = h.get("authorization") ?? "", f = h.get("x-finnhub-token") ?? "";
  return /^Token /.test(a) ? a.slice(6) : /^apikey /.test(a) ? a.slice(7) : f || (/[?&]apikey=([^&]+)/.exec(url)?.[1] ?? "");
}

function tiingo(url: string, key: string): Response {
  if (!MARK[key]) return json({ detail: "Invalid token." }, 401);
  const m = MARK[key];
  if (url.includes("/api/test")) return json({ message: "You successfully sent a request" });
  if (url.includes("/prices")) return json(after(/startDate=([^&]+)/.exec(url)?.[1] ?? DAYS[0]).map((date) => ({ date: `${date}T00:00:00.000Z`, open: m, high: m, low: m, close: m, volume: 10, adjClose: m, splitFactor: 1, divCash: 0 })));
  if (url.includes("/iex/")) return json([{ ticker: "X", last: m, tngoLast: m, prevClose: m - 1, timestamp: new Date().toISOString(), lastSaleTimestamp: new Date().toISOString() }]);
  return json({ ticker: "X", name: "Tiingo Co", exchangeCode: "NASDAQ", description: "From Tiingo" });
}
function finnhub(url: string, key: string): Response {
  if (!MARK[key]) return json({ error: "Invalid API key" }, 401);
  const m = MARK[key];
  if (url.includes("/quote")) return json({ c: m, d: 1, dp: 1.5, h: m, l: m, o: m, pc: m - 1, t: Math.floor(Date.now() / 1000) });
  if (url.includes("/stock/recommendation")) return json([{ period: "2026-10-01", strongBuy: 5, buy: 10, hold: 7, sell: 1, strongSell: 0, symbol: "X" }]);
  if (url.includes("/stock/earnings")) return json([{ actual: 1.5, estimate: 1.4, period: "2026-06-30", quarter: 2, year: 2026, symbol: "X" }]);
  return json({ name: "Finnhub Co", exchange: "NASDAQ NMS", finnhubIndustry: "Technology", marketCapitalization: 3000, weburl: "https://x.example" });
}
function twelve(url: string, key: string): Response {
  if (!MARK[key]) return json({ code: 401, message: "apikey is incorrect", status: "error" });
  const m = MARK[key];
  if (url.includes("/api_usage")) return json({ timestamp: "x", current_usage: 1, plan_limit: 8 });
  if (url.includes("/quote")) return json({ symbol: "X", name: "X", close: String(m), previous_close: String(m - 1), percent_change: "1.2", timestamp: Math.floor(Date.now() / 1000) });
  return json({ meta: { symbol: "X" }, values: after(/start_date=([^&]+)/.exec(url)?.[1] ?? DAYS[0]).map((d) => ({ datetime: d, open: String(m), high: String(m), low: String(m), close: String(m), volume: "5" })), status: "ok" });
}
function alpha(url: string, key: string): Response {
  if (!MARK[key]) return json({ "Error Message": "Invalid API call." });
  const m = MARK[key], fn = /function=([A-Z_]+)/.exec(url)?.[1];
  if (fn === "GLOBAL_QUOTE") return json({ "Global Quote": { "01. symbol": "X", "05. price": String(m), "07. latest trading day": DAYS[DAYS.length - 1], "10. change percent": "1.2%" } });
  if (fn === "TIME_SERIES_DAILY") return json({ "Meta Data": {}, "Time Series (Daily)": Object.fromEntries(DAYS.slice(-100).map((d) => [d, { "1. open": String(m), "2. high": String(m), "3. low": String(m), "4. close": String(m), "5. volume": "9" }])) });
  return json({ "Error Message": "unknown function" });
}
function fmpOwner(url: string): Response {
  const sym = decodeURIComponent(/symbol=([^&]+)/.exec(url)?.[1] ?? "");
  if (url.includes("/profile")) return json([{ symbol: sym, price: 100, marketCap: 1e10, change: 1, changePercentage: 1, range: "80-120", companyName: "Owner FMP Co", cik: "1", exchange: "NASDAQ", exchangeFullName: "", industry: "Tech", sector: "Technology", website: "", description: "" }]);
  if (url.includes("/quote")) return json([{ symbol: sym, name: sym, price: 100, changePercentage: 1, change: 1, volume: 1, exchange: "X", previousClose: 99, timestamp: Math.floor(Date.now() / 1000) }]);
  if (url.includes("historical-price-eod/full")) return json(after(/from=([^&]+)/.exec(url)?.[1] ?? DAYS[0]).map((date) => ({ symbol: sym, date, open: 100, high: 100, low: 100, close: 100, volume: 1 })).reverse());
  return json([]);
}
function fmpUser(url: string, key: string): Response {
  if (!MARK[key]) return json({ "Error Message": "Invalid API KEY. Feel free to create a Free API Key." }, 401);
  const sym = decodeURIComponent(/symbol=([^&]+)/.exec(url)?.[1] ?? "");
  if (url.includes("/quote")) return json([{ symbol: sym, name: sym, price: MARK[key], changePercentage: 1, change: 1, volume: 1, exchange: "X", previousClose: 1, timestamp: Math.floor(Date.now() / 1000) }]);
  if (url.includes("/profile")) return json([{ symbol: sym, price: MARK[key], marketCap: 1e9, change: 1, changePercentage: 1, range: "1-2", companyName: "User FMP Co", cik: "1", exchange: "NASDAQ", exchangeFullName: "", industry: "", sector: "", website: "", description: "Your-key description" }]);
  return json([]);
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const h = new Headers(init?.headers);
  calls.push(url);
  const f = Object.entries(forced).find(([k]) => url.includes(k))?.[1];
  if (f === "503") return new Response("down", { status: 503 });
  if (f === "401") return json({ error: "unauthorized" }, 401);
  if (f === "neterr") throw netErr();
  if (f === "neterr-url") throw netErr(`fetch failed for ${url} with ${h.get("authorization") ?? ""}`);
  if (f) return json(f.body, f.status ?? 200);
  const key = keyOf(url, h);
  if (url.includes("api.tiingo.com")) return tiingo(url, key);
  if (url.includes("finnhub.io")) return finnhub(url, key);
  if (url.includes("api.twelvedata.com")) return twelve(url, key);
  if (url.includes("alphavantage.co")) return alpha(url, key);
  if (url.includes("financialmodelingprep.com")) return key === "test-key" ? fmpOwner(url) : fmpUser(url, key);
  const fixture = FIXTURES.find(([m]) => m.test(url));
  if (fixture) return typeof fixture[1] === "function" ? (fixture[1] as (u: string) => Response | Promise<Response>)(url) : json(fixture[1]);
  if (url.includes("api.nasdaq.com")) return json({ data: null });
  throw netErr();
}) as typeof fetch;

/** URL pattern -> body (or a function of the URL). Filled in below, per source. */
const FIXTURES: [RegExp, unknown][] = [];


/* ---------------- Fixtures: SEC, Treasury, FRED, BLS, BEA, EIA, ECB, World Bank, CFTC ---------------- */

/** Quarter ends going back from the last full quarter: 2026-09-30, 2026-06-30, … */
const QUARTER_ENDS = ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31"];
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const qRow = (end: string, val: number, i: number) => ({ start: addDaysIso(end, -90), end, val, accn: `0000320193-26-0000${i}`, fy: Number(end.slice(0, 4)), fp: "Q", form: "10-Q", filed: addDaysIso(end, 30) });
const companyFacts = () => ({
  cik: 320193, entityName: "Apple Inc.",
  facts: { "us-gaap": {
    EarningsPerShareDiluted: { units: { "USD/shares": QUARTER_ENDS.map((e, i) => qRow(e, Number((1.6 - i * 0.05).toFixed(2)), i)) } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: QUARTER_ENDS.map((e, i) => qRow(e, 90e9 - i * 1e9, i)) } },
    CommonStockDividendsPerShareDeclared: { units: { "USD/shares": QUARTER_ENDS.map((e, i) => qRow(e, 0.26, i)) } },
  } },
});
const submissions = () => {
  const eightKs = QUARTER_ENDS.map((e) => addDaysIso(e, 28));
  const forms = [...eightKs.map(() => "8-K"), "8-K"], dates = [...eightKs, addDaysIso(QUARTER_ENDS[0], 40)], items = [...eightKs.map(() => "2.02,9.01"), "5.02"];
  return {
    cik: "320193", name: "Apple Inc.", sic: "3571", sicDescription: "Electronic Computers", fiscalYearEnd: "0928", tickers: ["AAPL"], exchanges: ["Nasdaq"],
    addresses: { business: { city: "CUPERTINO", stateOrCountry: "CA" } },
    filings: { recent: { accessionNumber: forms.map((_, i) => `0000320193-26-00010${i}`), filingDate: dates, reportDate: dates, form: forms, primaryDocument: forms.map(() => "a.htm"), primaryDocDescription: forms.map(() => "8-K"), items } },
  };
};
const fredCsv = (url: string) => {
  const id = /id=([^&]+)/.exec(url)?.[1] ?? "X";
  const base = id === "DEXUSEU" ? 1.08 : id.startsWith("DGS") ? 4 + id.length / 100 : 50;
  return new Response(`observation_date,${id}\n${DAYS.slice(-60).map((d, i) => `${d},${(base + i / 1000).toFixed(4)}`).join("\n")}\n`, { status: 200 });
};
const months = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2026, 8 - i, 1)); return { year: String(d.getUTCFullYear()), period: `M${String(d.getUTCMonth() + 1).padStart(2, "0")}` }; });
const blsAnswer = () => ({
  status: "REQUEST_SUCCEEDED",
  Results: { series: ["CUUR0000SA0", "CUUR0000SA0L1E", "LNS14000000", "CES0000000001", "CES0500000003", "CUSR0000SA0", "CUSR0000SA0L1E"].map((id) => ({ seriesID: id, data: months(60).map((m, i) => ({ ...m, value: String(300 - i * 0.5) })) })) },
});
const beaAnswer = (url: string) => {
  const table = /TableName=([^&]+)/.exec(url)?.[1];
  const rows = table === "T10106"
    ? [2022, 2023, 2024, 2025].flatMap((y) => [1, 2, 3, 4].map((q) => ({ LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: `${y}Q${q}`, DataValue: String(22_000_000 + y * 10 + q).replace(/\B(?=(\d{3})+(?!\d))/g, ","), UNIT_MULT: "6" })))
    : months(30).map((m) => ({ LineNumber: "25", LineDescription: "PCE excluding food and energy", TimePeriod: `${m.year}${m.period}`, DataValue: "124.5", UNIT_MULT: "0" }));
  return json({ BEAAPI: { Request: {}, Results: { Data: [...rows, { LineNumber: "2", LineDescription: "Personal consumption expenditures", TimePeriod: "2025Q1", DataValue: "1", UNIT_MULT: "6" }] } } });
};
const eiaAnswer = (url: string) => {
  const id = decodeURIComponent(/facets%5Bseries%5D%5B%5D=([^&]+)/.exec(url)?.[1] ?? /facets\[series\]\[\]=([^&]+)/.exec(url)?.[1] ?? "RWTC");
  return json({ response: { total: "40", frequency: "daily", data: DAYS.slice(-40).map((d, i) => ({ period: d, series: id, value: id === "RNGWHHD" ? 3 + i / 100 : 70 + i / 10, units: "$/BBL" })) }, apiVersion: "2.1.8" });
};
const ecbCsv = () => new Response(["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE", ...DAYS.slice(-20).flatMap((d) => [`EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,${d},1.10`, `EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,${d},165.0`])].join("\n"), { status: 200 });
const cotRows = () => [
  { market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.", report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", cftc_contract_market_code: "088691", noncomm_positions_long_all: "300000", noncomm_positions_short_all: "60000", open_interest_all: "500000" },
  { market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.", report_date_as_yyyy_mm_dd: "2026-10-06T00:00:00.000", cftc_contract_market_code: "088691", noncomm_positions_long_all: "290000", noncomm_positions_short_all: "65000", open_interest_all: "490000" },
  { market_and_exchange_names: "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE", report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", cftc_contract_market_code: "067651", noncomm_positions_long_all: "400000", noncomm_positions_short_all: "150000", open_interest_all: "1800000" },
];
const ftsAnswer = () => ({ hits: { total: { value: 3 }, hits: [
  { _id: "0001193125-26-000001:d1.htm", _source: { display_names: ["Target Co  (TGT1)  (CIK 0000000001)"], ciks: ["0000000001"], form: "8-K", file_date: DAYS[DAYS.length - 2], items: ["1.01", "9.01"] } },
  { _id: "0001193125-26-000002:d2.htm", _source: { display_names: ["Other Co (CIK 0000000002)"], ciks: ["0000000002"], form: "8-K", file_date: DAYS[DAYS.length - 3], items: ["5.02"] } },
  { _id: "0001193125-26-000003:d3.htm", _source: { display_names: ["Apple Inc. (AAPL) (CIK 0000320193)"], ciks: ["0000320193"], form: "425", file_date: DAYS[DAYS.length - 1] } },
] } });
let pinkSheetXlsx: ArrayBuffer | null = null;
async function buildPinkSheet(): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Monthly Prices");
  ws.addRow(["World Bank Commodity Price Data (The Pink Sheet)"]);
  ws.addRow(["", "Crude oil, WTI", "Gold", "Copper", "Maize"]);
  ws.addRow(["", "($/bbl)", "($/troy oz)", "($/mt)", "($/mt)"]);
  ws.addRow(["", "CRUDE_WTI", "GOLD", "COPPER", "MAIZE"]);
  for (let i = 0; i < 24; i++) { const d = new Date(Date.UTC(2024, 9 + i, 1)); ws.addRow([`${d.getUTCFullYear()}M${String(d.getUTCMonth() + 1).padStart(2, "0")}`, 70 + i, 2400 + i * 10, 9000 + i * 10, 200]); }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const treasuryCsv = () => new Response(['Date,"1 Mo","3 Mo","6 Mo","1 Yr","2 Yr","5 Yr","10 Yr","30 Yr"', ...DAYS.slice(-30).reverse().map((d) => { const [y, m, dd] = d.split("-"); return `${m}/${dd}/${y},4.3,4.2,4.1,4.0,3.8,3.9,4.2,4.6`; })].join("\n"), { status: 200 });

FIXTURES.push(
  [/company_tickers_exchange\.json/, { fields: ["cik", "name", "ticker", "exchange"], data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"], [789019, "Microsoft Corp", "MSFT", "Nasdaq"]] }],
  [/company_tickers\.json/, { 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, 1: { cik_str: 789019, ticker: "MSFT", title: "Microsoft Corp" } }],
  [/submissions\/CIK0000320193\.json/, submissions()],
  [/companyfacts\/CIK0000320193\.json/, companyFacts()],
  [/efts\.sec\.gov/, ftsAnswer()],
  [/home\.treasury\.gov/, () => treasuryCsv()],
  [/fredgraph\.csv/, fredCsv],
  [/api\.bls\.gov/, blsAnswer()],
  [/apps\.bea\.gov/, beaAnswer],
  [/api\.eia\.gov/, eiaAnswer],
  [/data-api\.ecb\.europa\.eu/, () => ecbCsv()],
  [/frankfurter\.app/, (u: string) => json({ rates: Object.fromEntries(DAYS.slice(-20).map((d) => [d, { [/to=([A-Z]{3})/.exec(u)?.[1] ?? "USD"]: 1.09 }])) })],
  [/thedocs\.worldbank\.org/, async () => new Response(pinkSheetXlsx ??= await buildPinkSheet(), { status: 200 })],
  [/publicreporting\.cftc\.gov/, cotRows()],
);

/* ---------------- C2 registry metadata ---------------- */

async function testMetadata() {
  const { REGISTRY, USER_KEY_ADAPTERS } = await import("@/lib/market/registry");
  const { DATASETS, SOURCES } = await import("@/lib/market/sources-meta");
  const all = [...Object.entries(REGISTRY), ...Object.entries(USER_KEY_ADAPTERS)].flatMap(([d, list]) => (list as unknown as Record<string, unknown>[]).map((a) => ({ d, a })));
  const LICENCES = ["public", "attribution", "owner-licensed", "user-key", "unverified"];
  const bad = all.filter(({ a }) => !LICENCES.includes(a.licence as string) || typeof a.attribution !== "string" || !(a.attribution as string).trim()
    || !(a.delayedMinutes === null || typeof a.delayedMinutes === "number") || !Array.isArray(a.fields) || ("browserOnly" in a && typeof a.browserOnly !== "boolean"));
  check("C2 every adapter declares a licence, attribution text, delayed minutes and the fields it fills", all.length > 30 && bad.length === 0, bad.slice(0, 5).map(({ d, a }) => `${d}:${a.id}`));
  const unknownIds = all.filter(({ a }) => !Object.hasOwn(SOURCES, a.id as string));
  check("C2 every adapter id is in the source catalogue (one label and licence per id)", unknownIds.length === 0, unknownIds.map(({ d, a }) => `${d}:${a.id}`));
  const uncovered = Object.entries(REGISTRY).filter(([d, list]) => !(list as unknown as { licence: string }[]).some((a) => ["public", "attribution", "owner-licensed"].includes(a.licence)) && !DATASETS[d as keyof typeof DATASETS]?.noFreeSource);
  check("C2 every dataset has a public, attribution or owner-licensed source, or an explicit \"no free source\" note", uncovered.length === 0, uncovered.map(([d]) => d));
  const keyed = Object.values(USER_KEY_ADAPTERS).flat() as unknown as { licence: string; keyProvider?: string }[];
  check("C2 bring-your-own-key adapters are licence user-key and name their key", keyed.length >= 15 && keyed.every((a) => a.licence === "user-key" && !!a.keyProvider), keyed.length);
  const defaults = Object.values(REGISTRY).flat() as unknown as { licence: string }[];
  check("C2 no user-key adapter is in a shared default chain", defaults.every((a) => a.licence !== "user-key"));
  const crypto = [...REGISTRY.crypto, ...REGISTRY["crypto-market"], ...REGISTRY.defi].filter((a) => a.id !== "fmp") as unknown as { id: string; licence: string }[];
  check("C2 crypto adapters are marked licence unverified", crypto.length >= 3 && crypto.every((a) => a.licence === "unverified"), crypto.map((a) => `${a.id}:${a.licence}`));
  const fred = REGISTRY.macro.find((a) => a.id === "fred") as unknown as { licence: string; persistentCache?: boolean } | undefined;
  check("C2 FRED is attribution and declares no persistent cache", fred?.licence === "attribution" && fred.persistentCache === false, fred);
}


/* ---------------- C1 free-first adapters ---------------- */

async function run<T>(fn: () => Promise<T>) {
  const { withProvenance } = await import("@/lib/market/provenance");
  const { withMode } = await import("@/lib/market/budgets");
  return withProvenance(() => withMode("interactive", fn));
}

async function testSecProfile() {
  const { sicSector, secProfile } = await import("@/lib/market/sec-sources");
  check("C1 SIC -> sector: 3571 computers, 7372 software are IT; 2834 drugs Health Care; 6022 banks Financials; 1311 oil Energy; 4911 Utilities; 6798 REITs Real Estate",
    sicSector("3571") === "Information Technology" && sicSector(7372) === "Information Technology" && sicSector("2834") === "Health Care" && sicSector("6022") === "Financials"
    && sicSector("1311") === "Energy" && sicSector("4911") === "Utilities" && sicSector("6798") === "Real Estate" && sicSector("") === null && sicSector("9999") === null);
  const p = await secProfile("AAPL");
  check("C1 SEC profile: name, exchange (company_tickers_exchange), SIC industry and SIC-based sector, city; no price, with the reason",
    p?.data.name === "Apple Inc." && p.data.exchange === "Nasdaq" && p.data.industry === "Electronic Computers" && p.data.sector === "Information Technology" && p.data.city === "CUPERTINO"
    && p.data.price === null && p.data.marketCap === null && /no market price/i.test(p.reasons?.price ?? ""), p);
  const { fromChain } = await import("@/lib/market/registry");
  const r = await run(() => fromChain("profile", { symbol: "AAPL" }, { prefer: ["sec"] }));
  const f = r.value.fields ?? {};
  check("C5 SEC first for the profile: price filled from the next source (FMP) with per-field provenance; description stays empty with SEC's reason",
    r.value.by.id === "sec" && r.value.data.price === 100 && (f.price as { id?: string }).id === "fmp" && r.value.data.description === null && /no short business description/.test((f.description as { reason?: string }).reason ?? ""), { by: r.value.by.id, price: r.value.data.price, fields: f });
  check("C5 the per-field provenance is in the header data (fields)", (r.fields["profile.price"] as { id?: string })?.id === "fmp" && "reason" in (r.fields["profile.description"] ?? {}), r.fields);
}

async function testSecEarningsDividends() {
  const { secEarnings, secDividendData, reportDateFor } = await import("@/lib/market/sec-sources");
  check("C1 an 8-K Item 2.02 within 75 days dates the quarter; none after: no date", reportDateFor("2026-06-30", ["2026-07-28", "2026-10-28"]) === "2026-07-28" && reportDateFor("2026-06-30", ["2026-10-28"]) === null);
  const e = await secEarnings("AAPL");
  const q = e?.data.quarters ?? [];
  check("C1 SEC earnings: reported EPS and revenue by quarter, newest first, dated by the results 8-K", q.length >= 6 && q[0].epsActual === 1.6 && q[0].revenueActual === 90e9 && q[0].date === addDaysIso("2026-09-30", 28) && q[0].datedBy === "report", q.slice(0, 2));
  check("C1 SEC earnings: no estimates, flagged as needing a key source (never zero)", q.every((x) => x.epsEstimated === null) && e?.data.next === null && /licensed source/.test(e?.reasons?.annual ?? ""), e?.reasons);
  const d = await secDividendData("AAPL");
  check("C1 SEC dividends: per share by fiscal quarter, with pay and ex dates flagged as not available", (d?.data.payments.length ?? 0) >= 4 && d!.data.payments.every((p) => p.payDate === null && p.amount === 0.26) && d!.data.basis === "fiscal quarter" && /not structured data/.test(d!.reasons?.payDate ?? ""), d?.reasons);
  // EE through the chain with FMP and Nasdaq out: SEC answers (before AI research), and the empty estimates say why.
  forced["financialmodelingprep.com/stable/earnings"] = "503";
  try {
    const { earningsView } = await import("@/lib/terminal/street");
    const r = await run(() => earningsView("AAPL"));
    check("C1 EE answers from SEC filings when FMP fails: quarters with no estimate, next null", r.value.quarters.length >= 6 && r.value.quarters[0].epsEstimated === null && r.value.next === null && r.sources.some((x) => x.id === "sec"), { n: r.value.quarters.length, sources: r.sources });
    check("C5 EE's empty estimates carry the reason in the header data", /licensed source/.test((r.fields["earnings.annual"] as { reason?: string })?.reason ?? ""), r.fields);
  } finally { delete forced["financialmodelingprep.com/stable/earnings"]; }
}

async function testSecDeals() {
  const { dealsFromFts, secDeals } = await import("@/lib/market/sec-sources");
  const deals = await secDeals();
  check("C1 MA from SEC full-text search: 8-K Item 1.01 kept, an 8-K without 1.01/2.01 left out, a 425 kept and named", deals.length === 2 && deals.some((d) => d.targetedCompanyName.startsWith("8-K")) && deals.some((d) => d.targetedCompanyName.startsWith("425") && d.symbol === "AAPL"), deals.map((d) => d.targetedCompanyName));
  let kind = "";
  try { dealsFromFts({ hits: { hits: [{ _id: 5 }] } }, new Map()); } catch (e) { kind = (e as { kind?: string }).kind ?? ""; }
  check("C1 MA: a drifted search answer is a schema failure, not an empty list", kind === "schema", kind);
  forced["financialmodelingprep.com/stable/mergers"] = "503";
  try {
    const { dealsView } = await import("@/lib/terminal/markets");
    const r = await run(() => dealsView());
    check("C1 MA falls back to the SEC adapter when FMP fails", r.value.via === "SEC EDGAR merger filings" && r.value.deals.length === 2, r.value.via);
  } finally { delete forced["financialmodelingprep.com/stable/mergers"]; }
}

async function testCurveAndMacro() {
  const { fromChain } = await import("@/lib/market/registry");
  const { sharedMap } = await import("@/lib/shared");
  forced["home.treasury.gov"] = "503";
  try {
    const r = await run(() => fromChain("curve", {}));
    check("C1 GC: Treasury down -> the Fed's H.15 (via FRED) answers, with its attribution", r.value.by.id === "h15" && r.value.data.length > 10 && r.value.data[0].yields["10 Yr"] !== undefined && /H\.15/.test(r.value.by.attribution ?? ""), { by: r.value.by.id, rows: r.value.data.length });
  } finally { delete forced["home.treasury.gov"]; }
  const mem = sharedMap<string, unknown>("cache:mem");
  check("C1 FRED is never cached: no cache entry holds a FRED series after it answered", ![...mem.keys()].some((k) => /fred/i.test(k)), [...mem.keys()].filter((k) => /fred/i.test(k)));
  const before = calls.filter((c) => c.includes("fredgraph")).length;
  await run(() => fromChain("curve", {}).catch(() => null));
  forced["home.treasury.gov"] = "503";
  try { await run(() => fromChain("curve", {}, { prefer: ["h15"] })); } finally { delete forced["home.treasury.gov"]; }
  check("C1 FRED per request only: a second request fetches its series again", calls.filter((c) => c.includes("fredgraph")).length - before >= 11, calls.filter((c) => c.includes("fredgraph")).length - before);
  const ids: Record<string, string> = {};
  for (const sId of ["CPIAUCSL", "PAYEMS", "GDPC1", "PCEPILFE", "DCOILWTICO", "DGS10", "T10Y2Y", "BAA10Y", "ICSA"]) {
    const a = await run(() => fromChain("macro", { series: sId }));
    ids[sId] = `${a.value.by.id}:${a.value.data.length}`;
  }
  check("C1 ECO: originals first (BLS, BEA, EIA, Treasury); FRED only for series no original covers", /^bls:/.test(ids.CPIAUCSL) && /^bls:/.test(ids.PAYEMS) && /^bea:/.test(ids.GDPC1) && /^bea:/.test(ids.PCEPILFE) && /^eia:/.test(ids.DCOILWTICO)
    && /^treasury:/.test(ids.DGS10) && /^treasury:/.test(ids.T10Y2Y) && /^fred:/.test(ids.BAA10Y) && /^fred:/.test(ids.ICSA) && Object.values(ids).every((v) => !v.endsWith(":0")), ids);
  const saved = process.env.BEA_API_KEY;
  delete process.env.BEA_API_KEY;
  try {
    const a = await run(() => fromChain("macro", { series: "GDPC1" }));
    check("C1 ECO: without the owner's BEA key, GDP falls back to FRED (attributed), with no noise in the header", a.value.by.id === "fred" && /FRED/.test(a.value.by.attribution ?? "") && a.skipped.length === 0, { by: a.value.by.id, skipped: a.skipped });
  } finally { process.env.BEA_API_KEY = saved; }
  const { parseBea } = await import("@/lib/market/macro-sources");
  let kind = "";
  try { parseBea({ BEAAPI: { Results: { Data: [{ LineDesc: "renamed", TimePeriod: "2025Q1", DataValue: "1" }] } } }, "GDPC1"); } catch (e) { kind = (e as { kind?: string }).kind ?? ""; }
  check("C1 BEA drift (a renamed field) is a schema failure", kind === "schema", kind);
  const { macroView } = await import("@/lib/terminal/macro");
  const m = await run(() => macroView());
  const cpi = m.value.series.find((x) => x.id === "CPIAUCSL"), baa = m.value.series.find((x) => x.id === "BAA10Y");
  check("C5 ECO series name the source that answered and its credit (BLS for CPI; FRED for Moody's spread)", cpi?.answeredBy?.id === "bls" && /Bureau of Labor Statistics/.test(cpi.answeredBy.attribution) && baa?.answeredBy?.id === "fred", { cpi: cpi?.answeredBy, baa: baa?.answeredBy });
}

async function testFxCommoditiesCot() {
  const { fromChain } = await import("@/lib/market/registry");
  const { parseEcbCsv, crossFromEuro } = await import("@/lib/market/free");
  const perEuro = parseEcbCsv(["KEY,CURRENCY,TIME_PERIOD,OBS_VALUE", "x,USD,2026-10-20,1.10", "x,JPY,2026-10-20,165"].join("\n"));
  const cross = crossFromEuro(perEuro, "USD", "JPY")[0]?.close ?? 0;
  check("C1 ECB direct: per-euro rates by column name; USDJPY derived as JPY per EUR over USD per EUR", Math.abs(cross - 150) < 1e-9 && crossFromEuro(perEuro, "EUR", "USD")[0]?.close === 1.1, cross);
  forced["financialmodelingprep.com/stable/historical-price-eod/full?symbol=EURUSD"] = "503";
  forced["frankfurter.app"] = "503";
  try {
    const a = await run(() => fromChain("fx", { symbol: "EURUSD", from: DAYS[DAYS.length - 10] }));
    check("C1 FX: FMP and Frankfurter down -> the ECB's own data API answers (still the ECB adapter)", a.value.by.id === "ecb" && a.value.data.at(-1)?.close === 1.1, { by: a.value.by.id, last: a.value.data.at(-1) });
    forced["data-api.ecb.europa.eu"] = "503";
    forced["financialmodelingprep.com/stable/historical-price-eod/full?symbol=GBPUSD"] = "503";
    const b = await run(() => fromChain("fx", { symbol: "GBPUSD", from: DAYS[DAYS.length - 30] }));
    check("C1 FX: the ECB down too -> the Fed's H.10 (via FRED), attributed", b.value.by.id === "h10" && (b.value.data.at(-1)?.close ?? 0) > 1 && /H\.10/.test(b.value.by.attribution ?? ""), b.value.by);
  } finally { for (const k of ["financialmodelingprep.com/stable/historical-price-eod/full?symbol=EURUSD", "financialmodelingprep.com/stable/historical-price-eod/full?symbol=GBPUSD", "frankfurter.app", "data-api.ecb.europa.eu"]) delete forced[k]; }
  forced["historical-price-eod"] = "503";
  try {
    const wti = await run(() => fromChain("commodity", { symbol: "CLUSD", from: DAYS[DAYS.length - 30] }));
    check("C1 CMDTY: FMP down -> the EIA's WTI spot answers, labelled spot", wti.value.by.id === "eia" && wti.value.label === "WTI crude: EIA spot price" && wti.value.data.length > 10, { by: wti.value.by.id, label: wti.value.label });
    const { sourcesBody } = await import("@/lib/market/source-header");
    const { badgeModel } = await import("@/lib/market/badges");
    const header = sourcesBody(wti);
    check("C5 the EIA's required credit is in the header (x-data-sources attributions)", !!header?.attributions?.includes("Source: U.S. Energy Information Administration"), header?.attributions);
    check("C5 and in the badge the screen renders", !!badgeModel(header ?? undefined)?.attributions.includes("Source: U.S. Energy Information Administration"), badgeModel(header ?? undefined));
    const gold = await run(() => fromChain("commodity", { symbol: "GCUSD", from: "2025-01-01" }));
    check("C1 CMDTY: FMP and the gold ETF down -> the World Bank's monthly Pink Sheet, read by code, labelled monthly", gold.value.by.id === "worldbank" && gold.value.via === "World Bank monthly" && gold.value.data.at(-1)?.close === 2400 + 23 * 10, { by: gold.value.by.id, last: gold.value.data.at(-1) });
    const copper = await run(() => fromChain("commodity", { symbol: "HGUSD", from: "2025-01-01" }));
    check("C1 Pink Sheet units: copper $/mt -> $/lb", Math.abs((copper.value.data.at(-1)?.close ?? 0) - (9000 + 230) / 2204.62) < 1e-6, copper.value.data.at(-1));
    const { commodities } = await import("@/lib/terminal/markets");
    const board = await run(() => commodities());
    const gc = board.value.find((r) => r.symbol === "GCUSD");
    check("C1 CMDTY board: a monthly row has no daily move or z-score; COT positioning attached (net non-commercial, weekly change)", gc?.cadence === "monthly" && gc.d1 === null && gc.z === null && gc.positioning?.net === 240_000 && gc.positioning.netChange === 15_000, gc && { cadence: gc.cadence, d1: gc.d1, pos: gc.positioning });
  } finally { delete forced["historical-price-eod"]; }
  const { parseCot } = await import("@/lib/market/cftc");
  let kind = "";
  try { parseCot([{ market: "renamed" }]); } catch (e) { kind = (e as { kind?: string }).kind ?? ""; }
  check("C1 CFTC drift is a schema failure", kind === "schema", kind);
}



async function testForModel() {
  const { fromChain } = await import("@/lib/market/registry");
  const { forModel, withDataUser, NOT_FOR_AI } = await import("@/lib/market/user-context");
  const { withProvenance } = await import("@/lib/market/provenance");
  const { withMode } = await import("@/lib/market/budgets");
  const before = calls.filter((c) => c.includes("fredgraph")).length;
  const m = await run(() => forModel(() => fromChain("macro", { series: "BAA10Y" }).catch((e) => e)));
  check("C1 for a model (AI tools, the AI read) FRED never answers: a FRED-only series has no source, and FRED is not called", m.value instanceof Error && calls.filter((c) => c.includes("fredgraph")).length === before, String(m.value));
  const cpi = await run(() => forModel(() => fromChain("macro", { series: "CPIAUCSL" })));
  check("C1 for a model, the original publisher still answers (BLS)", cpi.value.by.id === "bls");
  forced["financialmodelingprep.com/stable/historical-price-eod/full?symbol=USDCHF"] = "503"; forced["frankfurter.app"] = "503"; forced["data-api.ecb.europa.eu"] = "503";
  try {
    const A = person(`al-${uid()}`, { tiingo: KEYS.tiingoA }, { fx: ["h10"] });
    const r = await withProvenance(() => withMode("interactive", () => withDataUser(A, () => forModel(() => fromChain("fx", { symbol: "USDCHF", from: from30() }).catch((e) => e)))));
    check("C1/C3 for a model: H.10 via FRED is refused and no one's keys or order apply", r.value instanceof Error && !r.sources.length && !calls.some((c) => c.includes("DEXSZUS")), { v: String(r.value), skipped: r.skipped });
  } finally { for (const k of ["financialmodelingprep.com/stable/historical-price-eod/full?symbol=USDCHF", "frankfurter.app", "data-api.ecb.europa.eu"]) delete forced[k]; }
  void NOT_FOR_AI;
}

/* ---------------- C3 bring-your-own keys ---------------- */

import type { DataUser } from "@/lib/market/user-context";
import type { KeyProvider } from "@/lib/market/sources-meta";

/** A person for the data layer, without the database (the store builds the same shape). */
function person(id: string, keys: Partial<Record<KeyProvider, string>>, order: DataUser["order"] = {}, override?: DataUser["override"]): DataUser {
  return { userId: id, order, keyed: new Set(Object.keys(keys) as KeyProvider[]), key: async (p) => keys[p] ?? null, ...(override ? { override } : {}) };
}
async function as<T>(u: DataUser, fn: () => Promise<T>, interactive = true) {
  const { withProvenance } = await import("@/lib/market/provenance");
  const { withMode } = await import("@/lib/market/budgets");
  const { withDataUser } = await import("@/lib/market/user-context");
  return withProvenance(() => (interactive ? withMode("interactive", () => withDataUser(u, fn)) : withDataUser(u, fn)));
}
const from30 = () => DAYS[DAYS.length - 30];
const tiingoCalls = () => calls.filter((c) => c.includes("api.tiingo.com")).length;

async function testIsolation() {
  const { historyFrom } = await import("@/lib/market/data");
  const sym = `K${uid()}`.slice(0, 6);
  const A = person(`alice-${uid()}`, { tiingo: KEYS.tiingoA }, { "daily-bars": ["tiingo"] });
  const B = person(`bob-${uid()}`, {}, { "daily-bars": ["tiingo"] });
  const B2 = person(`bob2-${uid()}`, { tiingo: KEYS.tiingoB }, { "daily-bars": ["tiingo"] });
  const a = await as(A, () => historyFrom(sym, from30()));
  check("C3 user A's own key answers A's request (Tiingo first in A's order), marked as A's key", a.value.by?.id === "tiingo" && a.value.data.at(-1)?.close === 111.111 && a.sources.some((x) => x.yourKey), { by: a.value.by, last: a.value.data.at(-1)?.close });
  const n0 = tiingoCalls();
  const b = await as(B, () => historyFrom(sym, from30()));
  check("C3 user B, same symbol, same order, no key: never A's answer; the shared default answers; Tiingo skipped with the reason", b.value.data.at(-1)?.close === 100 && b.value.by?.id === "fmp" && tiingoCalls() === n0 && b.skipped.some((k) => k.id === "tiingo" && /Needs your Tiingo key/.test(k.reason)), { last: b.value.data.at(-1)?.close, skipped: b.skipped });
  const b2 = await as(B2, () => historyFrom(sym, from30()));
  check("C3 user B with their own Tiingo key gets their own answer (222.222), not A's cached one (111.111): caches are per person and provider", b2.value.data.at(-1)?.close === 222.222 && tiingoCalls() === n0 + 1, b2.value.data.at(-1)?.close);
  const a2 = await as(A, () => historyFrom(sym, from30()));
  check("C3 A's second request is served from A's own partition (no new call)", a2.value.data.at(-1)?.close === 111.111 && tiingoCalls() === n0 + 1);
}

async function testGlobalCachesUntouched() {
  const { historyFrom, quotes } = await import("@/lib/market/data");
  const { getCompanyData } = await import("@/lib/company");
  const { sharedMap } = await import("@/lib/shared");
  const sym = `G${uid()}`.slice(0, 6);
  const A = person(`alice-${uid()}`, { tiingo: KEYS.tiingoA, fmp: KEYS.fmpA }, { "daily-bars": ["tiingo"], quote: ["fmp-key"], profile: ["fmp-key"] });
  await as(A, async () => { await historyFrom(sym, from30()); await quotes([sym]); });
  const company = await as(A, () => getCompanyData("AAPL"));
  check("C3 the shared company record never takes A's keyed price (666.666): it is built public-only", company.value?.price?.last === 100, company.value?.price);
  const mem = sharedMap<string, { value: string }>("cache:mem");
  const leaked = [...mem.entries()].filter(([, v]) => /"close":111\.111|"price":666\.666|"price":111\.111/.test(v.value)).map(([k]) => k);
  check("C3 no shared cache entry (memory layer) holds keyed data", leaked.length === 0, leaked);
  const byo = sharedMap<string, unknown>("byo:mem");
  const { keyedPrefix } = await import("@/lib/market/byo/cache");
  if (!localDb()) check("C3 keyed data sits only in A's own partitions (byo:v1:<A>:<provider>:…)", byo.size > 0 && [...byo.keys()].every((k) => k.startsWith("byo:v1:")) && [...byo.keys()].some((k) => k.startsWith(keyedPrefix(A.userId, "tiingo"))), [...byo.keys()].slice(0, 4));
  if (localDb()) {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const rows = (await db!.execute<{ key: string }>(sql`select key from kv_cache where value like '%"close":111.111%' or value like '%"price":666.666%'`)).rows;
    const shared = rows.filter((r) => !r.key.startsWith("byo:v1:"));
    check("C3(db) keyed data sits only in A's own partitions in kv_cache (byo:v1:<A>:<provider>:…)", rows.length > 0 && rows.some((r) => r.key.startsWith(keyedPrefix(A.userId, "tiingo"))), rows.map((r) => r.key).slice(0, 3));
    check("C3(db) no kv_cache row outside the byo: partitions holds keyed data", shared.length === 0, shared);
    const cc = (await db!.execute<{ n: number }>(sql`select count(*)::int as n from company_cache where data::text like '%666.666%'`)).rows;
    check("C3(db) company_cache never holds keyed data", cc[0]?.n === 0, cc);
  }
}

async function testBackgroundRefusal() {
  const { historyFrom } = await import("@/lib/market/data");
  const { publicOnly, NOT_IN_BACKGROUND } = await import("@/lib/market/user-context");
  const sym = `J${uid()}`.slice(0, 6);
  const A = person(`alice-${uid()}`, { tiingo: KEYS.tiingoA }, { "daily-bars": ["tiingo"] });
  const n0 = tiingoCalls();
  const bg = await as(A, () => historyFrom(sym, from30()), false);
  check("C3 background mode (jobs, crons, Inngest) refuses keyed adapters: no call with the key, the shared default answers, the reason is stated", tiingoCalls() === n0 && bg.value.by?.id === "fmp" && bg.skipped.some((k) => k.id === "tiingo" && k.reason === NOT_IN_BACKGROUND), bg.skipped);
  const pub = await as(A, () => publicOnly(() => historyFrom(sym, from30())));
  check("C3 public-only code (shared caches, exports, shared views) never uses the person's keys or order", tiingoCalls() === n0 && pub.value.by?.id === "fmp" && !pub.sources.some((x) => x.yourKey));
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  walk("src");
  const users = files.filter((f) => /withDataUser\(/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/^src\//, ""));
  const allowed = ["lib/market/user-context.ts", "lib/market/byo/settings.ts", "app/api/terminal/[fn]/route.ts"];
  check("C3 only person-facing request paths set a data user (no job, cron, Inngest function or export does)", users.every((f) => allowed.includes(f)), users);
}

async function testPurge() {
  const { historyFrom } = await import("@/lib/market/data");
  const { purgeKeyed, keyedPrefix } = await import("@/lib/market/byo/cache");
  const { sharedMap } = await import("@/lib/shared");
  const sym = `P${uid()}`.slice(0, 6);
  const A = person(`alice-${uid()}`, { tiingo: KEYS.tiingoA }, { "daily-bars": ["tiingo"] });
  await as(A, () => historyFrom(sym, from30()));
  const mine = () => [...sharedMap<string, unknown>("byo:mem").keys()].filter((k) => k.startsWith(keyedPrefix(A.userId, "tiingo"))).length;
  const before = localDb() ? -1 : mine();
  const n = await purgeKeyed(A.userId, "tiingo");
  check("C3 purge removes the person's cached data from that provider", n >= 1 && mine() === 0 && (before === -1 || before >= 1), { before, purged: n });
  const n0 = tiingoCalls();
  await as(A, () => historyFrom(sym, from30()));
  check("C3 after a purge the next request asks the provider again (nothing kept)", tiingoCalls() === n0 + 1);
}

async function testNoKeyLeaks() {
  const { historyFrom, quotes } = await import("@/lib/market/data");
  const { sourceHeaders } = await import("@/lib/market/source-header");
  const { bufferedRollups } = await import("@/lib/market/stats");
  const { fromChain } = await import("@/lib/market/registry");
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ["log", "warn", "error"] as const) console[k] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  const errors: string[] = [], headers: string[] = [];
  try {
    const bad = person(`eve-${uid()}`, { tiingo: "tiingoKeyWRONGWRONGWRONGWRONGWR9", alphavantage: KEYS.alphaA, fmp: KEYS.fmpA, finnhub: KEYS.finnhubA }, { "daily-bars": ["tiingo", "alphavantage"], quote: ["fmp-key", "finnhub"], profile: ["finnhub"] });
    forced["alphavantage.co"] = "neterr-url";
    forced["financialmodelingprep.com/stable/quote?symbol=Z"] = "neterr-url";
    const keep = (e: unknown) => { errors.push(`${(e as Error).message} ${(e as Error).stack} ${String((e as Error).cause ?? "")}`); return null; };
    const r1 = await as(bad, () => historyFrom(`Z${uid()}`.slice(0, 5), from30()).catch(keep));
    const r2 = await as(bad, () => quotes([`Z${uid()}`.slice(0, 5)]).catch(keep));
    const r3 = await as(bad, () => fromChain("profile", { symbol: "AAPL" }).catch(keep));
    headers.push(...[r1, r2, r3].map((r) => JSON.stringify(sourceHeaders(r, 1))));
    const { keyedJson } = await import("@/lib/market/byo/http");
    for (const key of [KEYS.alphaA, "tiingoKeyWRONGWRONGWRONGWRONGWR9"]) {
      await keyedJson({ provider: key === KEYS.alphaA ? "alphavantage" : "tiingo", op: "t", key, url: key === KEYS.alphaA ? `https://www.alphavantage.co/query?function=X&apikey=${key}` : "https://api.tiingo.com/api/test", headers: { Authorization: `Token ${key}` } })
        .catch((e) => errors.push(`${(e as Error).message} ${(e as Error).stack} ${String((e as Error).cause ?? "")}`));
    }
  } finally {
    Object.assign(console, orig);
    delete forced["alphavantage.co"]; delete forced["financialmodelingprep.com/stable/quote?symbol=Z"];
  }
  const all = [...logs, ...errors, ...headers, JSON.stringify(bufferedRollups())].join("\n");
  const found = [...Object.values(KEYS), "tiingoKeyWRONGWRONGWRONGWRONGWR9"].filter((k) => all.includes(k));
  check("C3 keys never appear in logs, errors (message, stack, cause), response headers or the stats", errors.length >= 2 && headers.length === 3 && found.length === 0, { found, errors: errors.map((e) => e.slice(0, 80)) });
  check("C3 a refused key reads as such, in words (no key, no URL)", errors.some((e) => /Tiingo refused your key/.test(e)), errors.map((e) => e.slice(0, 80)));
}


/* ---------------- C4 preferences ---------------- */

async function testPrefsOrder() {
  const { resolveChain, planChain } = await import("@/lib/market/registry");
  const { historyFrom } = await import("@/lib/market/data");
  const { withDataUser } = await import("@/lib/market/user-context");
  const A = person(`alice-${uid()}`, { tiingo: KEYS.tiingoA }, { "daily-bars": ["nasdaq", "fmp"] });
  const { withMode } = await import("@/lib/market/budgets");
  const ids = (u: DataUser) => withMode("interactive", () => withDataUser(u, async () => planChain("daily-bars", { symbol: "X", from: from30() }).run.map((a) => a.id)));
  check("C4 the person's order goes first; their keyed sources follow the defaults", JSON.stringify(await ids(A)) === '["nasdaq","fmp","tiingo"]', await ids(A));
  check("C4 without a person the default order applies (and no keyed source)", JSON.stringify(resolveChain("daily-bars").map((a) => a.id)) === '["fmp","nasdaq"]');
  const sym = `O${uid()}`.slice(0, 6);
  const nasdaq: [RegExp, unknown] = [/api\.nasdaq\.com/, (u: string) => u.includes("/info") ? json({ data: { symbol: sym, companyName: "O Co", exchange: "NASDAQ-GS", primaryData: { lastSalePrice: "$50.00", netChange: "+1.00", percentageChange: "+2.04%", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } })
    : json({ data: { tradesTable: { rows: DAYS.slice(-40).map((d) => { const [y, m, dd] = d.split("-"); return { date: `${m}/${dd}/${y}`, close: "$50.00", volume: "1", open: "$50.00", high: "$50.00", low: "$50.00" }; }) } } })];
  FIXTURES.unshift(nasdaq);
  try {
    const r = await as(A, () => historyFrom(sym, from30()));
    check("C4 the order is honoured by fromChain: Nasdaq (first in the person's order) answers, FMP is not asked", r.value.by?.id === "nasdaq" && !calls.some((c) => c.includes(`symbol=${sym}`) && c.includes("financialmodelingprep")), r.value.by);
  } finally { FIXTURES.splice(FIXTURES.indexOf(nasdaq), 1); }
  const C = person(`carol-${uid()}`, {}, { "daily-bars": ["tiingo", "fmp"] });
  const r = await as(C, () => historyFrom(`Q${uid()}`.slice(0, 6), from30()));
  const D = person(`dee-${uid()}`, {}, { "daily-bars": ["fmp", "tiingo", "finnhub"] });
  const dr = await as(D, () => historyFrom(`Q${uid()}`.slice(0, 6), from30()));
  check("C4 a source without a key ranked after the one that answered is not reported (no noise on every answer)", dr.value.by?.id === "fmp" && dr.skipped.length === 0, dr.skipped);
  check("C4 an ineligible source (no key) is skipped with the stated reason; the next eligible one answers", r.value.by?.id === "fmp" && r.skipped.some((k) => k.id === "tiingo" && /Needs your Tiingo key/.test(k.reason)), r.skipped);
}

async function testSourceSyntax() {
  const { parseCommand } = await import("@/lib/functions");
  const a = parseCommand("AAPL GP @tiingo", "MSFT"), b = parseCommand("GP @sec", "MSFT"), c = parseCommand("AAPL GP @nope", "MSFT"), d = parseCommand("AI what did @elon say", "MSFT");
  check("C4 `AAPL GP @tiingo` parses as AAPL GP with source tiingo", a.ok && a.command.ticker === "AAPL" && a.command.fn === "GP" && a.command.source === "tiingo", a);
  check("C4 @source with the active ticker; an unknown @source is refused in words; @text inside a question stays text", b.ok && b.command.ticker === "MSFT" && b.command.source === "sec" && !c.ok && /Unknown data source "@nope"/.test(c.error) && d.ok && d.command.arg === "what did @elon say" && !d.command.source, { b, c, d });
  const { historyFrom } = await import("@/lib/market/data");
  const { fromChain } = await import("@/lib/market/registry");
  const V = person(`dan-${uid()}`, { tiingo: KEYS.tiingoA }, {}, { dataset: "daily-bars", id: "tiingo" });
  const r = await as(V, async () => ({ bars: await historyFrom(`V${uid()}`.slice(0, 6), from30()), quote: await fromChain("quote", { symbol: `V${uid()}`.slice(0, 6) }) }));
  check("C4 a view's source (@tiingo on GP) applies to that view's dataset only: bars from Tiingo, the quote from the default", r.value.bars.by?.id === "tiingo" && r.value.quote.by.id === "fmp", { bars: r.value.bars.by?.id, quote: r.value.quote.by.id });
  const W = person(`erin-${uid()}`, {}, {}, { dataset: "curve", id: "tiingo" });
  const w = await as(W, () => fromChain("curve", {}));
  check("C4 a view's source that does not serve the dataset is skipped with the reason", ["treasury", "h15"].includes(w.value.by.id) && w.skipped.some((k) => k.id === "tiingo" && /Does not provide treasury curve/.test(k.reason)), w.skipped);
}

async function testValidation() {
  const { validateOrder, checkKeyShape } = await import("@/lib/market/byo/settings");
  const status = (f: () => unknown) => { try { f(); return 200; } catch (e) { return (e as { status?: number }).status ?? 500; } };
  check("C4 a well-formed order validates", JSON.stringify(validateOrder({ order: { "daily-bars": ["tiingo", "fmp", "tiingo"] } })) === '{"daily-bars":["tiingo","fmp"]}');
  check("C4 malformed orders are 400s: wrong shape, unknown dataset, a source not in that dataset, a staged dataset, extra fields",
    [() => validateOrder(null), () => validateOrder({ order: { nope: ["fmp"] } }), () => validateOrder({ order: { curve: ["tiingo"] } }), () => validateOrder({ order: { news: ["gdelt"] } }), () => validateOrder({ order: {}, userId: "x" })].every((f) => status(f) === 400));
  check("C4 key shapes are allowlisted before anything is sent", status(() => checkKeyShape("tiingo", "short")) === 400 && status(() => checkKeyShape("tiingo", "abc$%^&*()def123456789012")) === 400 && status(() => checkKeyShape("tiingo", KEYS.tiingoA)) === 200);
  const { planWarning } = await import("@/lib/market/sources-meta");
  check("C3 a team member adding an individual-plan FMP, Alpha Vantage or Finnhub key is warned; Tiingo, business plans and non-members are not",
    !!planWarning("fmp", "individual", true) && !!planWarning("alphavantage", "individual", true) && !!planWarning("finnhub", "individual", true)
    && !planWarning("tiingo", "individual", true) && !planWarning("fmp", "business", true) && !planWarning("fmp", "individual", false));
}

async function testKeyAndChainTests() {
  const { testKey } = await import("@/lib/market/byo/settings");
  const ok = await testKey("tiingo", KEYS.tiingoA), bad = await testKey("tiingo", "tiingoKeyWRONGWRONGWRONGWRONGWR9");
  check("C4 key test: a working key answers ok with its time; a refused one says so, without the key", ok.ok && ok.ms >= 0 && !bad.ok && /refused your key/.test(bad.message ?? "") && !JSON.stringify(bad).includes("WRONG"), { ok, bad });
  const tw = await testKey("twelvedata", KEYS.twelveA), fh = await testKey("finnhub", KEYS.finnhubA), av = await testKey("alphavantage", KEYS.alphaA), fm = await testKey("fmp", KEYS.fmpA);
  check("C4 key tests for Twelve Data, Finnhub, Alpha Vantage and FMP", tw.ok && fh.ok && av.ok && fm.ok, { tw, fh, av, fm });
}

async function testStoreDb() {
  const { saveKey, removeKey, saveOrder, loadSettings, dataUserFor, forgetSettings } = await import("@/lib/market/byo/store");
  const { settingsView, testChain } = await import("@/lib/market/byo/settings");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const alice = `alice-${uid()}`, bob = `bob-${uid()}`;
  await saveOrder(alice, { "daily-bars": ["tiingo", "fmp"] });
  await saveKey(alice, "tiingo", KEYS.tiingoA, "individual");
  const [row] = (await db!.execute<{ keys_enc: string; key_meta: unknown }>(sql`select keys_enc, key_meta from user_data_sources where user_id = ${alice}`)).rows;
  check("C4(db) keys are encrypted at rest: the row holds neither the key nor any part beyond the last four", !!row && row.keys_enc.startsWith("v1.") && !row.keys_enc.includes(KEYS.tiingoA) && !JSON.stringify(row.key_meta).includes(KEYS.tiingoA.slice(0, -4)) && JSON.stringify(row.key_meta).includes(KEYS.tiingoA.slice(-4)), row && { enc: row.keys_enc.slice(0, 8), meta: row.key_meta });
  const view = await settingsView(alice);
  check("C4(db) the settings view shows the last four and the plan, never the key; order first in the dataset", !JSON.stringify(view).includes(KEYS.tiingoA) && view.keys[0]?.last4 === KEYS.tiingoA.slice(-4) && view.keys[0].plan === "individual" && view.datasets.find((d) => d.id === "daily-bars")?.sources[0].id === "tiingo", view.keys);
  const bobView = await settingsView(bob);
  check("C4(db) another person's prefs and keys are not readable: Bob's view is his own (empty)", bobView.keys.length === 0 && !bobView.datasets.some((d) => d.customized) && (await loadSettings(bob)).order["daily-bars"] === undefined);
  const u = await dataUserFor(alice);
  check("C4(db) the data user reads the order and which keys exist, and decrypts the key only when asked", u.keyed.has("tiingo") && u.order["daily-bars"]?.[0] === "tiingo" && (await u.key("tiingo")) === KEYS.tiingoA);
  const t = await testChain(alice, "daily-bars");
  check("C4(db) Test: the person's chain on its sample says which source answered and how long it took", t.ok && t.answeredBy?.id === "tiingo" && t.answeredBy.yourKey === true && t.ms >= 0 && t.header?.yourKey === true, t);
  const before = (await db!.execute<{ n: number }>(sql`select count(*)::int as n from kv_cache where key like 'byo:v1:%'`)).rows;
  const r = await removeKey(alice, "tiingo");
  forgetSettings(alice);
  const after = (await db!.execute<{ n: number }>(sql`select count(*)::int as n from kv_cache where key like 'byo:v1:%'`)).rows;
  check("C3(db) removing a key purges the person's cached data from that provider (kv_cache rows gone)", r.removed && r.purged >= 1 && after[0].n === before[0].n - r.purged && !(await loadSettings(alice)).keyMeta.tiingo, { r, before: before[0].n, after: after[0].n });
  const t2 = await testChain(alice, "daily-bars");
  check("C4(db) after removal the chain skips Tiingo with the reason and the default answers", t2.ok && t2.answeredBy?.id === "fmp" && !!t2.header?.skipped?.some((k) => k.id === "tiingo"), t2);
}

async function testRouteDb() {
  process.env.YOUBANK_DEV_USER = `ann${uid().toLowerCase()}`;
  const route = await import("@/app/api/settings/data-sources/route");
  const call = async (method: "GET" | "PUT" | "POST" | "DELETE", body?: unknown, qs = "") => {
    const req = new Request(`http://localhost/api/settings/data-sources${qs}`, { method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    const res = await (route as unknown as Record<string, (r: Request) => Promise<Response>>)[method](req);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null, cache: res.headers.get("cache-control") };
  };
  const bad1 = await call("PUT", "{not json"), bad2 = await call("PUT", { order: { "daily-bars": ["nope"] } }), bad3 = await call("PUT", { order: { curve: ["tiingo"] } });
  check("C4(route) a malformed PUT returns 400 with words", bad1.status === 400 && bad2.status === 400 && bad3.status === 400 && /not a source/.test(String(bad2.body?.error)), [bad1.status, bad2.status, bad3.status, bad2.body?.error]);
  await call("PUT", { order: { quote: ["nasdaq", "fmp"] } });
  const ok = await call("PUT", { order: { "daily-bars": ["nasdaq", "fmp"] } });
  check("C4(route) a PUT for one dataset keeps the others' order (the page saves one at a time); an empty list resets it",
    (ok.body?.datasets as { id: string; customized: boolean }[]).find((d) => d.id === "quote")?.customized === true
    && (await call("PUT", { order: { quote: [] } })).body?.datasets !== undefined && !((await call("GET")).body?.datasets as { id: string; customized: boolean }[]).find((d) => d.id === "quote")?.customized, ok.status);
  check("C4(route) PUT saves the order and answers with the view (no-store)", ok.status === 200 && (ok.body?.datasets as { id: string; sources: { id: string }[] }[]).find((d) => d.id === "daily-bars")?.sources[0].id === "nasdaq" && ok.cache === "no-store", ok.status);
  const save = await call("POST", { action: "save-key", provider: "tiingo", key: KEYS.tiingoA, plan: "business" });
  check("C4(route) save-key tests the key, saves it and never sends it back", save.status === 200 && !JSON.stringify(save.body).includes(KEYS.tiingoA) && JSON.stringify(save.body).includes(KEYS.tiingoA.slice(-4)), save.status);
  const refused = await call("POST", { action: "save-key", provider: "finnhub", key: "finnhubKeyWRONGWRONG", plan: "individual" });
  check("C4(route) a key that does not work is not saved (400 with the provider's words)", refused.status === 400 && /did not work/.test(String(refused.body?.error)), refused.body);
  const badPost = await call("POST", { action: "save-key", provider: "massive", key: "x".repeat(20), plan: "individual" });
  check("C4(route) providers are allowlisted (Massive is not offered): 400", badPost.status === 400, badPost.status);
  const me = process.env.YOUBANK_DEV_USER;
  process.env.YOUBANK_DEV_USER = `bea${uid().toLowerCase()}`;
  const other = await call("GET");
  check("C4(route) another signed-in person reads only their own settings", other.status === 200 && (other.body?.keys as unknown[]).length === 0 && !(other.body?.datasets as { customized: boolean }[]).some((d) => d.customized), other.status);
  process.env.YOUBANK_DEV_USER = me;
  const del = await call("DELETE", undefined, "?provider=tiingo"), delBad = await call("DELETE", undefined, "?provider=../etc");
  check("C4(route) DELETE removes the key; an unknown provider is a 400", del.status === 200 && del.body?.removed === true && delBad.status === 400, [del.status, delBad.status]);
  delete process.env.YOUBANK_DEV_USER;
}

/**
 * Review fix: a pasted key is checked from YouBank's address, and accounts are free to make, so the check
 * must not be an oracle for stolen keys: a day's cap per person and an hour's cap per address, on top of
 * the per-minute limit (which alone allows 14,400 checks a day per account).
 */
async function testKeyCheckLimits() {
  const route = await import("@/app/api/settings/data-sources/route");
  const { db } = await import("@/db");
  const { schema } = await import("@/db");
  const post = async (user: string, ip: string, body: unknown) => {
    process.env.YOUBANK_DEV_USER = user;
    const req = new Request("http://localhost/api/settings/data-sources", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-real-ip": ip } });
    return (await route.POST(req)).status;
  };
  try {
    // One person who has already checked a day's worth of pasted keys (the counter, as the limiter keeps it).
    const heavy = `hv${uid().toLowerCase()}`;
    await db!.insert(schema.kvCache).values({ key: `rate:data-sources-key:dev-${heavy}:${Math.floor(Date.now() / 86_400_000)}`, value: "20", expiresAt: new Date(Date.now() + 86_400_000) })
      .onConflictDoUpdate({ target: schema.kvCache.key, set: { value: "20" } });
    const dayCapped = await post(heavy, `10.1.${Math.floor(Math.random() * 250)}.1`, { action: "test-key", provider: "tiingo", key: KEYS.tiingoA });
    check("C3(review) a person past a day's pasted-key checks is refused (429), whatever the minute's count", dayCapped === 429, dayCapped);
    // Many fresh accounts from one address, each well under its own per-minute limit.
    const ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push(await post(`ip${i}${uid().toLowerCase()}`, ip, { action: "test-key", provider: "tiingo", key: `tiingoKeyGUESS${String(i).padStart(4, "0")}XXXXXXXXXXXXX` }));
    check("C3(review) one address cannot check pasted keys at scale through many accounts: past 30 an hour it is refused (429)", statuses.slice(0, 30).every((s) => s === 200) && statuses[30] === 429, statuses.slice(-3));
    const saved = await post(heavy, ip, { action: "test-chain", dataset: "quote" });
    check("C3(review) the caps are for pasted keys only: a chain test still runs", saved === 200, saved);
  } finally { delete process.env.YOUBANK_DEV_USER; }
}

/* ---------------- C5 field-level fallthrough ---------------- */

async function testMerge() {
  const { mergeFields, FIELD_SPECS, isEmptyValue } = await import("@/lib/market/fields");
  const spec = FIELD_SPECS.profile!;
  const sec = { data: { name: "Apple Inc.", price: null, marketCap: null, sector: "Information Technology", description: "", low52: null, high52: null, changePct: null }, source: { id: "sec", label: "SEC EDGAR" }, reasons: { description: "Not in filings" } };
  const tiingo = { data: { name: "Apple", price: 230, marketCap: null, description: "", changePct: 0 }, source: { id: "tiingo", label: "Tiingo (your key)", yourKey: true } };
  const fmp = { data: { price: 229, marketCap: 3.4e12, description: "", changePct: 0.01 }, source: { id: "fmp", label: "Financial Modeling Prep" } };
  const m = mergeFields(sec as never, [tiingo, fmp] as never, spec);
  const d = m.data as Record<string, unknown>, f = m.fields as Record<string, { id?: string; yourKey?: boolean; reason?: string }>;
  check("C5 merge: each empty field from the first later source that has it (price from Tiingo, market cap from FMP), the first source's own fields kept",
    d.name === "Apple Inc." && d.price === 230 && f.price.id === "tiingo" && f.price.yourKey === true && d.marketCap === 3.4e12 && f.marketCap.id === "fmp" && d.sector === "Information Technology" && !f.name && !f.sector, { d, f });
  check("C5 merge: a zero is a value (change 0 from Tiingo), never treated as missing", d.changePct === 0 && f.changePct.id === "tiingo" && !isEmptyValue(0));
  check("C5 merge: no source has it -> null with the first source's reason (never a silent zero or blank)", d.description === null && f.description.reason === "Not in filings" && d.website === null && typeof f.website.reason === "string", { desc: d.description, f: f.description, w: f.website });
  const { badgeModel } = await import("@/lib/market/badges");
  const b = badgeModel({ providers: ["SEC EDGAR", "Tiingo"], notes: [], sources: [{ id: "sec", label: "SEC EDGAR", provider: "SEC EDGAR", licence: "public" }, { id: "tiingo", label: "Tiingo (your key)", provider: "Tiingo", yourKey: true, licence: "user-key" }], yourKey: true, stale: true, asOf: "2026-10-20T14:42:00Z", delayed: true, delayedMinutes: 15, attributions: ["Source: U.S. Securities and Exchange Commission (EDGAR)"], fields: { "profile.price": { id: "tiingo", label: "Tiingo (your key)", yourKey: true }, "profile.description": { reason: "Not in filings" } }, skipped: [{ dataset: "quote", id: "finnhub", label: "Finnhub (your key)", reason: "Needs your Finnhub key (Settings → Data sources)." }] });
  check("C5 badges: source names, Your key, Delayed 15 min, Stale · as of, the credit, per-field notes and skipped sources",
    !!b && b.names.join() === "SEC EDGAR,Tiingo (your key)" && ["Your key", "Delayed 15 min", "Stale · as of 10:42 ET"].every((t) => b.chips.some((c) => c.text === t)) && b.attributions[0].startsWith("Source: U.S. Securities")
    && b.fieldNotes.includes("Price from Tiingo (your key)") && b.fieldNotes.includes("Description: — Not in filings") && /Finnhub \(your key\) skipped: Needs your Finnhub key/.test(b.skipped[0]), b);
  const { sourceHeaders } = await import("@/lib/market/source-header");
  const h = sourceHeaders({ providers: ["EIA"], notes: ["WTI — spot · EIA"], sources: [{ id: "eia", label: "U.S. Energy Information Administration", provider: "EIA", licence: "public", attribution: "Source: U.S. Energy Information Administration" }] })["x-data-sources"];
  check("C5 the header carries the attribution, and is ASCII-only (a valid header value) yet parses back to the same text", /^[\x20-\x7e]*$/.test(h) && JSON.parse(h).attributions[0] === "Source: U.S. Energy Information Administration" && JSON.parse(h).notes[0] === "WTI — spot · EIA", h);
}

/* ---------------- Main ---------------- */

async function main() {
  const { overrideBudgets } = await import("@/lib/market/budgets");
  overrideBudgets("interactive", { hedgeDelayMs: 200, fmpTimeoutMs: 600, nasdaqTimeoutMs: 600, freeTimeoutMs: 600, secTimeoutMs: 600, macroTimeoutMs: 600, fmpSlotTries: 2, researchMs: 300 });
  overrideBudgets("background", { fmpTimeoutMs: 800, nasdaqTimeoutMs: 800, freeTimeoutMs: 800, secTimeoutMs: 800, macroTimeoutMs: 800, fmpSlotTries: 2, researchMs: 300 });
  if (localDb()) {
    // A run starts from an empty cache: a copy an earlier run left (the Treasury's curve, say) would be
    // served stale when a check takes its source down, and the check would read the wrong source.
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`delete from kv_cache where key not like 'rate:%'`);
    await db!.execute(sql`delete from company_cache`);
  }
  await section("C2 registry metadata", testMetadata);
  await section("C1 SEC profile and the SIC sector map", testSecProfile);
  await section("C1 SEC earnings actuals and dividends", testSecEarningsDividends);
  await section("C1 SEC merger filings", testSecDeals);
  await section("C1 curve and economy: originals first, FRED last and uncached", testCurveAndMacro);
  await section("C1 currencies, commodities and COT", testFxCommoditiesCot);
  await section("C1 nothing a model reads comes from FRED", testForModel);
  const { breakers } = await import("@/lib/market/breaker");
  const resetAll = async () => { for (const b of ["fmp", "nasdaq", "treasury", "fred", "ecb", "sec", "eia", "worldbank", "cftc", "bea", "bls"]) await breakers.reset(b); };
  await resetAll();
  await section("C3 user A's keyed answer never reaches user B", testIsolation);
  await section("C3 global caches untouched by keyed fetches", testGlobalCachesUntouched);
  await resetAll();
  await section("C3 background and shared code refuse keyed adapters", testBackgroundRefusal);
  await section("C3 removing a key purges its cache", testPurge);
  await section("C3 keys never in logs, headers, errors or stats", testNoKeyLeaks);
  await resetAll();
  await section("C4 preferences: the order is honoured, ineligible sources skipped with a reason", testPrefsOrder);
  await section("C4 @source and the view's source", testSourceSyntax);
  await section("C4 input validation", testValidation);
  await section("C4 key and chain tests", testKeyAndChainTests);
  if (localDb()) await section("C4 storage: encrypted keys, prefs, purge (Postgres)", testStoreDb);
  if (localDb()) await section("C4 the settings route: 400s, owner-only, keys never returned", testRouteDb);
  if (localDb()) await section("C3 review: pasted-key checks are capped per person per day and per address", testKeyCheckLimits);
  await section("C5 field-level fallthrough and badges", testMerge);
  if (!localDb()) console.log("database checks skipped (set DATABASE_URL to a local database to run them)");
  console.log(`\n${pass} passed, ${fail} failed`);
  const { pgClient } = await import("@/db");
  await pgClient?.end({ timeout: 1 }).catch(() => undefined);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
void uid;
