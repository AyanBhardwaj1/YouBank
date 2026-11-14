/**
 * Prediction markets (src/lib/predict): the pure parts, against trimmed venue responses in
 * scripts/fixtures/predict (see SOURCES.json there for each endpoint). No network, no database.
 *   pnpm exec tsx scripts/test-predict.ts
 *   pnpm exec tsx scripts/test-predict.ts --live   also reads each venue once and checks the parsers on the answer
 */
import { readFileSync } from "node:fs";
import { calibration, calibrationLine } from "@/lib/book/forecast";
import { categorize } from "@/lib/predict/categories";
import { bookExposure, exposureLine, predictSignalsFor } from "@/lib/predict/exposure";
import { COMPANIES, explicitTickers, mapMarket, mergeAi, touched, validTicker } from "@/lib/predict/mapping";
import { counterparts, features, matchAcross, matchScore, MATCH_MIN } from "@/lib/predict/match";
import { geminiEvents, impliedProb, kalshiBook, kalshiCandles, kalshiEvents, kalshiMarkets, manifoldMarkets, marketLabel, polymarketBook, polymarketEvents, polymarketHistory } from "@/lib/predict/normalize";
import { DEFAULT_FILTERS, filterMarkets, filtersToParams, matchesQuery, parseFilters } from "@/lib/predict/query";
import { annualised, spreadBetween, takerFee } from "@/lib/predict/spread";
import { slim, LIST_MAX, parseKey } from "@/lib/predict/store";
import type { Market } from "@/lib/predict/types";
import { alertText, asForecastItems, brier, forecastRefusal, moveAlert, normalizeForecastP, normalizeThreshold, type StoredForecast } from "@/lib/predict/watch-rules";
import { moveSignals, predictProbSignal, predictSignals } from "@/lib/quant/adapters/predict";
import { validateSignal } from "@/lib/quant/validate";
import { forbiddenIn } from "@/lib/quant/words";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); }
};
const fx = (name: string): unknown => JSON.parse(readFileSync(`scripts/fixtures/predict/${name}`, "utf8"));
const near = (a: number | null | undefined, b: number, eps = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) < eps;
const NOW = Date.parse("2026-11-14T12:00:00Z");

/** A market for the hand-written cases. */
const mk = (over: Partial<Market> & Pick<Market, "venue" | "title">): Market => ({
  key: `${over.venue}:${over.id ?? over.title.slice(0, 12).replace(/\W/g, "")}`, id: over.id ?? over.title.slice(0, 12).replace(/\W/g, ""), eventId: "e", outcome: "", question: over.title, category: categorize(over.title),
  prob: 0.5, change24h: null, bid: null, ask: null, volume24h: 1000, volume: 10_000, liquidity: null, openInterest: null, closeTime: "2026-12-31T00:00:00.000Z",
  status: "open", result: null, url: "https://example.com/m", rules: "", realMoney: true, ...over,
});

/* ---------------- Normalisation per venue ---------------- */

console.log("Kalshi");
const kalshi = kalshiEvents(fx("kalshi-events.json"));
const kC25 = kalshi.find((m) => m.id === "KXFEDDECISION-26DEC-C25")!;
ok("every nested market is read (two Fed, two CPI, recession, tariff)", kalshi.length === 6, kalshi.map((m) => m.id));
ok("key, event, series and venue link", kC25.key === "kalshi:KXFEDDECISION-26DEC-C25" && kC25.eventId === "KXFEDDECISION-26DEC" && kC25.seriesId === "KXFEDDECISION" && kC25.url === "https://kalshi.com/markets/kxfeddecision", kC25);
ok("the yes price is the mid of bid 0.61 and ask 0.63", near(kC25.prob, 0.62) && near(kC25.bid, 0.61) && near(kC25.ask, 0.63), kC25);
ok("24h change = last minus previous price (0.62 - 0.56)", near(kC25.change24h, 0.06), kC25.change24h);
ok("volume in contracts is turned into dollars at the price (182,000 x 0.62)", kC25.volume24h === 112840 && kC25.openInterest === 1650000, kC25);
ok("the outcome is the yes sub-title; the title is the event's", kC25.outcome === "Cut 25bps" && kC25.title === "Fed decision in December 2026?" && /cut rates by 25bps/.test(kC25.question));
ok("category: the Fed", kC25.category === "fed");
ok("the rules join primary and secondary", /exactly 25 basis points/.test(kC25.rules) && /FOMC statement/.test(kC25.rules));
const rec = kalshi.find((m) => m.id === "KXRECSSNBER-26")!;
ok("a single-market event has no outcome label", rec.outcome === "" && marketLabel(rec) === "Recession in 2026?", rec);
const cpi = kalshi.find((m) => m.id === "KXCPIYOY-26NOV-T3.0")!;
ok("CPI: economy, outcome 'Above 3.0%'", cpi.category === "economy" && cpi.outcome === "Above 3.0%", cpi);
const tariff = kalshi.find((m) => m.id.startsWith("KXTARIFFCHN"))!;
ok("a tariff question filed under Politics is categorised as tariffs", tariff.category === "tariffs", tariff.category);
const settled = kalshiMarkets(fx("kalshi-market-settled.json"))[0];
ok("a finalized market with result yes is resolved yes at probability 1", settled.status === "resolved" && settled.result === "yes" && settled.prob === 1 && settled.change24h === null, settled);
const candles = kalshiCandles(fx("kalshi-candles.json"));
ok("candlesticks: closing trades, the bid/ask mid where no trade, in time order", candles.length === 5 && near(candles[2].p, 0.55) && near(candles[4].p, 0.62) && candles[0].t < candles[4].t && candles[0].t === 1794268800000, candles);
const kb = kalshiBook(fx("kalshi-orderbook.json"))!;
ok("order book: yes bids best first; no bids become yes asks at 1 - price", near(kb.bids[0][0], 0.61) && kb.bids[0][1] === 2500 && near(kb.asks[0][0], 0.63) && near(kb.asks[2][0], 0.65), kb);
ok("an empty or odd answer reads as nothing, never a throw", kalshiEvents(null).length === 0 && kalshiEvents({ events: [{ markets: [{}] }] }).length === 0 && kalshiBook({}) === null && kalshiCandles("x").length === 0);

console.log("Polymarket");
const poly = polymarketEvents(fx("polymarket-events.json"));
const p25 = poly.find((m) => m.id === "601234")!;
ok("binary markets in events are read; the two-team game too", poly.length === 5, poly.map((m) => m.id));
ok("JSON-in-string outcomes, prices and token ids are parsed", p25.tokenId?.startsWith("713210456") === true && near(p25.prob, 0.655), p25);
ok("bid, ask and the day's change", near(p25.bid, 0.65) && near(p25.ask, 0.66) && near(p25.change24h, 0.075), p25);
ok("event title, outcome from groupItemTitle, link to the event", p25.title === "Fed decision in December?" && p25.outcome === "25 bps decrease" && p25.url === "https://polymarket.com/event/fed-decision-in-december-2026");
ok("volume, liquidity, close time", p25.volume24h === 820111.4 && p25.liquidity === 905433.5 && p25.closeTime === "2026-12-09T00:00:00.000Z");
ok("tags decide the category where the title is broad", p25.category === "fed" && poly.find((m) => m.id === "611002")!.category === "sports");
ok("a two-team game's yes side is the first team", poly.find((m) => m.id === "611002")!.outcome === "Lakers");
const pres = polymarketEvents([fx("polymarket-market-resolved.json")])[0];
ok("a closed market at 1/0 is resolved yes; its event comes from `events`", pres.status === "resolved" && pres.result === "yes" && pres.prob === 1 && pres.title === "Fed decision in October?", pres);
ok("a closed market not at 1/0 is closed, unscored", polymarketEvents([{ id: "9", question: "Q?", outcomes: "[\"Yes\",\"No\"]", outcomePrices: "[\"0.5\",\"0.5\"]", closed: true }])[0].status === "closed");
const ph = polymarketHistory(fx("polymarket-history.json"));
ok("prices-history in seconds becomes milliseconds", ph.length === 5 && ph[0].t === 1794268800000 && near(ph[4].p, 0.655), ph);
const pb = polymarketBook(fx("polymarket-book.json"))!;
ok("book: bids high to low, asks low to high", near(pb.bids[0][0], 0.65) && near(pb.asks[0][0], 0.66) && pb.asks[0][1] === 7300 && pb.bids.length === 3, pb);
ok("a non-binary or broken market is left out", polymarketEvents([{ id: "1", question: "Who wins?", outcomes: "[\"A\",\"B\",\"C\"]", outcomePrices: "[\"0.2\",\"0.3\",\"0.5\"]" }, { id: "2", outcomes: "not json" }]).length === 0);

console.log("Gemini");
const gem = geminiEvents(fx("gemini-events.json"));
const g25 = gem.find((m) => m.id === "GEMI-FEDDEC26-CUT25")!;
ok("one market per contract, keyed by instrument symbol", gem.length === 3 && g25.key === "gemini:GEMI-FEDDEC26-CUT25" && g25.eventId === "FEDDEC26", gem.map((m) => m.key));
ok("prices from contract.prices (decimal strings)", near(g25.prob, 0.64) && near(g25.bid, 0.63) && near(g25.ask, 0.65));
ok("the contract label is the outcome; a lone 'Yes' contract has none", g25.outcome === "Cut 25 bps" && gem.find((m) => m.id.endsWith("YES"))!.outcome === "");
ok("a null last trade falls back to the mid", near(gem.find((m) => m.id.endsWith("YES"))!.prob, 0.425));
ok("the documented variants are accepted (events, eventTicker, symbol)", geminiEvents({ events: [{ eventTicker: "X1", name: "Will X happen?", contracts: [{ symbol: "S1", bestBid: "0.2", bestAsk: "0.3" }] }] })[0]?.key === "gemini:S1");

console.log("Manifold");
const mani = manifoldMarkets(fx("manifold-markets.json"));
ok("binary markets only, play money", mani.length === 2 && mani.every((m) => !m.realMoney && m.venue === "manifold"), mani.map((m) => m.id));
ok("probability, 24h volume, close time from milliseconds", near(mani[0].prob, 0.6) && mani[0].volume24h === 820.1 && mani[0].closeTime === "2026-12-09T18:00:00.000Z");

console.log("Implied probability");
ok("mid of a tight book", impliedProb(0.4, 0.42, 0.5) === 0.41);
ok("a wide book (more than 10 points) falls back to the last trade", impliedProb(0.1, 0.9, 0.35) === 0.35);
ok("no trade and a wide book: the mid anyway", impliedProb(0.1, 0.9, null) === 0.5);

/* ---------------- Matching ---------------- */

console.log("Matching: true matches");
const all = [...kalshi, ...poly, ...gem, ...mani];
const pairs = matchAcross(all);
const has = (a: string, b: string) => pairs.some((p) => (p.a.key === a && p.b.key === b) || (p.a.key === b && p.b.key === a));
ok("Fed 25 bp cut: Kalshi and Polymarket", has("kalshi:KXFEDDECISION-26DEC-C25", "polymarket:601234"), pairs.map((p) => [p.a.key, p.b.key, p.confidence]));
ok("Fed hold: Kalshi 'Hold' and Polymarket 'No change'", has("kalshi:KXFEDDECISION-26DEC-H0", "polymarket:601235"));
ok("Fed 25 bp cut: Kalshi and Gemini", has("kalshi:KXFEDDECISION-26DEC-C25", "gemini:GEMI-FEDDEC26-CUT25"));
ok("CPI above 3.0%: Kalshi and Polymarket", has("kalshi:KXCPIYOY-26NOV-T3.0", "polymarket:604411"));
ok("Recession in 2026: Kalshi and Polymarket, with the different windows noted", has("kalshi:KXRECSSNBER-26", "polymarket:516710") && pairs.find((p) => p.a.key === "kalshi:KXRECSSNBER-26" || p.b.key === "kalshi:KXRECSSNBER-26")!.reasons.some((r) => /days apart/.test(r)));
ok("Fed cut: Kalshi and Manifold (the play-money reference)", has("kalshi:KXFEDDECISION-26DEC-C25", "manifold:aB3dE5fG7h"));
ok("a confident match scores high", (pairs.find((p) => has(p.a.key, p.b.key) && [p.a.key, p.b.key].includes("polymarket:601234"))?.confidence ?? 0) >= 0.9);

console.log("Matching: false matches");
const kC = all.find((m) => m.key === "kalshi:KXFEDDECISION-26DEC-C25")!, pHold = all.find((m) => m.key === "polymarket:601235")!;
ok("a cut is not a hold", matchScore(kC, pHold).rejected !== undefined, matchScore(kC, pHold));
ok("CPI above 2.9% is not CPI above 3.0%", !has("kalshi:KXCPIYOY-26NOV-T2.9", "polymarket:604411") && /threshold/.test(matchScore(all.find((m) => m.id === "KXCPIYOY-26NOV-T2.9")!, all.find((m) => m.id === "604411")!).rejected ?? ""));
ok("nothing matches the basketball game", !pairs.some((p) => p.a.key === "polymarket:611002" || p.b.key === "polymarket:611002"));
const newsom = mk({ venue: "kalshi", title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?", closeTime: "2028-08-20T00:00:00Z" });
const shapiro = mk({ venue: "polymarket", title: "Will Josh Shapiro win the 2028 Democratic presidential nomination?", closeTime: "2028-08-21T00:00:00Z" });
ok("different candidates in the same race do not match", !!matchScore(newsom, shapiro).rejected, matchScore(newsom, shapiro));
const newsomPoly = mk({ venue: "polymarket", title: "Democratic Presidential Nominee 2028", outcome: "Gavin Newsom", question: "Will Gavin Newsom be the 2028 Democratic presidential nominee?", closeTime: "2028-08-21T00:00:00Z" });
ok("...while the same candidate worded differently does", (() => { const r = matchScore(newsom, newsomPoly); return !r.rejected && r.confidence >= MATCH_MIN; })(), matchScore(newsom, newsomPoly));
ok("different months do not match", !!matchScore(mk({ venue: "kalshi", title: "Fed decision in January 2027?", outcome: "Cut 25bps" }), mk({ venue: "polymarket", title: "Fed decision in March 2027?", outcome: "25 bps decrease" })).rejected);
ok("different years do not match", !!matchScore(mk({ venue: "kalshi", title: "US recession in 2026?" }), mk({ venue: "polymarket", title: "US recession in 2027?" })).rejected);
ok("above is not below", !!matchScore(mk({ venue: "kalshi", title: "Bitcoin above $100,000 on Dec 31, 2026?" }), mk({ venue: "polymarket", title: "Bitcoin below $100,000 on Dec 31, 2026?" })).rejected);
ok("$100k and $100,000 are the same threshold", (() => { const r = matchScore(mk({ venue: "kalshi", title: "Bitcoin above $100k on Dec 31, 2026?" }), mk({ venue: "gemini", title: "Bitcoin above $100,000 on December 31, 2026?" })); return !r.rejected && r.confidence >= MATCH_MIN; })());
ok("bitcoin is not ethereum", !!matchScore(mk({ venue: "kalshi", title: "Bitcoin above $5,000 on Dec 31, 2026?" }), mk({ venue: "polymarket", title: "Ethereum above $5,000 on Dec 31, 2026?" })).rejected || matchScore(mk({ venue: "kalshi", title: "Bitcoin above $5,000 on Dec 31, 2026?" }), mk({ venue: "polymarket", title: "Ethereum above $5,000 on Dec 31, 2026?" })).confidence < MATCH_MIN);
ok("closes more than 90 days apart: no match", !!matchScore(mk({ venue: "kalshi", title: "US recession in 2026?", closeTime: "2026-12-31T00:00:00Z" }), mk({ venue: "polymarket", title: "US recession in 2026?", closeTime: "2027-06-30T00:00:00Z" })).rejected);
ok("a day of the month is a date, not a threshold", !features(mk({ venue: "kalshi", title: "Bitcoin above $100,000 on Dec 31, 2026?" })).nums.has(31));
ok("one market per venue in counterparts, best first", (() => { const c = counterparts(kC, all); return c.length === 3 && new Set(c.map((x) => x.market.venue)).size === 3 && c[0].confidence >= c[2].confidence; })(), counterparts(kC, all).map((c) => [c.market.key, c.confidence]));
ok("same venue never pairs with itself", pairs.every((p) => p.a.venue !== p.b.venue));

/* ---------------- Spreads ---------------- */

console.log("Spreads and fees");
ok("Kalshi fee at 50 cents: 1.75 cents a contract", near(takerFee("kalshi", 0.5), 0.0175));
ok("Kalshi fee rounds up to the cent per order (100 contracts at 62 cents: $1.65)", near(takerFee("kalshi", 0.62), 0.0165));
ok("Kalshi fee at 3 cents: 20.4 cents on 100 contracts rounds up to 21", near(takerFee("kalshi", 0.03), 0.0021), takerFee("kalshi", 0.03));
ok("Polymarket fee at 50 cents: 1 cent (conservative rate)", near(takerFee("polymarket", 0.5), 0.01));
ok("Manifold cannot be traded for money", takerFee("manifold", 0.5) === null);
const s1 = spreadBetween({ venue: "kalshi", prob: 0.62, bid: 0.61, ask: 0.63, realMoney: true }, { venue: "polymarket", prob: 0.655, bid: 0.65, ask: 0.66, realMoney: true })!;
ok("yes on the cheaper venue, no on the dearer: cost 0.63 + 0.35 = 0.98, gross 2 points", s1.yesOn === "kalshi" && s1.noOn === "polymarket" && near(s1.cost, 0.98) && near(s1.gross, 0.02), s1);
ok("fees come off: 0.0165 (Kalshi yes at 0.63) + 0.0091 (Polymarket no at 0.35)", near(s1.fees, 0.0165 + 0.04 * 0.35 * 0.65, 1e-4) && near(s1.net, 0.02 - s1.fees, 1e-4), s1);
ok("the mid gap is B minus A", near(s1.gap, 0.035) && s1.quoted);
const s2 = spreadBetween({ venue: "kalshi", prob: 0.5, bid: 0.49, ask: 0.51, realMoney: true }, { venue: "polymarket", prob: 0.5, bid: 0.49, ask: 0.51, realMoney: true })!;
ok("the same price on both: negative net (no edge)", s2.net < 0 && s2.gross < 0, s2);
ok("without quotes, mids stand in and the spread is marked rough", spreadBetween({ venue: "kalshi", prob: 0.4, bid: null, ask: null, realMoney: true }, { venue: "gemini", prob: 0.5, bid: null, ask: null, realMoney: true })!.quoted === false);
ok("play money has no spread", spreadBetween({ venue: "kalshi", prob: 0.4, bid: 0.39, ask: 0.41, realMoney: true }, { venue: "manifold", prob: 0.5, bid: null, ask: null, realMoney: false }) === null);
ok("annualised: 2 points net on 0.98 for 25 days is about 30% a year", near(annualised(0.02, 0.98, 25), 0.298, 0.001) && annualised(0.02, 0.98, null) === null);

/* ---------------- Ticker mapping ---------------- */

console.log("Ticker mapping");
const fedCut = mapMarket(kC);
const t = (m: ReturnType<typeof mapMarket>) => touched(m);
ok("a Fed cut: homebuilders, REITs, utilities and long Treasuries up; the dollar down", (() => { const x = t(fedCut); return x.get("DHI")?.dir === 1 && x.get("VNQ")?.dir === 1 && x.get("XLU")?.dir === 1 && x.get("TLT")?.dir === 1 && x.get("UUP")?.dir === -1; })(), fedCut.rules);
ok("...and banks, with a mixed sign", t(fedCut).get("JPM")?.dir === 0 && t(fedCut).get("KRE")?.dir === 0);
ok("...and duration as a factor", fedCut.factors.some((f) => /Duration/.test(f.name) && f.dir === 1));
ok("a hold maps the other way from a cut", t(mapMarket(pHold)).get("DHI")?.dir === -1, mapMarket(pHold).rules);
const hike = mapMarket(mk({ venue: "kalshi", title: "Will the Fed hike rates by 25bps in March 2027?" }));
ok("a hike: rate-sensitive names down", t(hike).get("DHI")?.dir === -1 && hike.rules[0] === "A Fed rate hike", hike.rules);
const tar = mapMarket(tariff);
ok("tariffs on China: importers and retailers down, domestic steel up, China ADRs down", (() => { const x = t(tar); return x.get("WMT")?.dir === -1 && x.get("NUE")?.dir === 1 && x.get("BABA")?.dir === -1 && x.get("AAPL")?.dir === -1; })(), tar.rules);
const tarDeal = mapMarket(mk({ venue: "polymarket", title: "Will the US and China announce a trade deal lowering tariffs by June 30, 2027?" }));
ok("a trade deal lowering tariffs flips every sign", t(tarDeal).get("WMT")?.dir === 1 && t(tarDeal).get("NUE")?.dir === -1, tarDeal.rules);
const fda = mapMarket(mk({ venue: "kalshi", title: "Will the FDA approve Vertex's VX-880 by June 2027?" }));
ok("an FDA approval: the named company up, from the name table", t(fda).get("VRTX")?.dir === 1 && fda.tickers.find((x) => x.ticker === "VRTX")?.source === "explicit", fda);
const crl = mapMarket(mk({ venue: "kalshi", title: "Will the FDA issue a complete response letter rejecting Moderna (MRNA) flu shot?" }));
ok("an FDA rejection: the company down", t(crl).get("MRNA")?.dir === -1, crl.tickers);
const ftc = mapMarket(mk({ venue: "polymarket", title: "Will the FTC sue to block Kroger's merger with Albertsons?" }));
ok("an FTC challenge: both deal parties named, target down", t(ftc).get("KR") !== undefined && t(ftc).get("ACI")?.dir === -1 && ftc.rules.includes("A merger challenged or blocked"), ftc);
const gop = mapMarket(mk({ venue: "kalshi", title: "Will Republicans win the House in 2028?" }));
ok("an election: Republican control lifts energy and defense, weighs on clean energy", t(gop).get("XOM")?.dir === 1 && t(gop).get("LMT")?.dir === 1 && t(gop).get("ENPH")?.dir === -1, gop.rules);
const dem = mapMarket(mk({ venue: "kalshi", title: "Will Democrats win the Senate in 2028?" }));
ok("...and Democratic control the reverse", t(dem).get("ENPH")?.dir === 1 && t(dem).get("XOM")?.dir === -1, dem.rules);
ok("CPI above a level: Treasuries down, TIPS up; below flips", t(mapMarket(cpi)).get("TLT")?.dir === -1 && t(mapMarket(cpi)).get("TIP")?.dir === 1 && t(mapMarket(mk({ venue: "kalshi", title: "CPI below 2.5% in December 2026?" }))).get("TLT")?.dir === 1);
ok("bitcoin above: crypto equities up; below: down", t(mapMarket(mk({ venue: "gemini", title: "Bitcoin above $100,000 on December 31, 2026?" }))).get("COIN")?.dir === 1 && t(mapMarket(mk({ venue: "gemini", title: "Bitcoin below $80,000 on December 31, 2026?" }))).get("MSTR")?.dir === -1);
ok("oil above: energy up, airlines down", (() => { const x = t(mapMarket(mk({ venue: "kalshi", title: "Will WTI crude oil be above $90 on Dec 31, 2026?" }))); return x.get("XOM")?.dir === 1 && x.get("DAL")?.dir === -1; })());
ok("explicit tickers: $NVDA, (AAPL), NASDAQ: MSFT", JSON.stringify(explicitTickers("Will $NVDA close above Apple (AAPL) and NASDAQ: MSFT?").map((x) => x.ticker).sort()) === JSON.stringify(["AAPL", "MSFT", "NVDA"]));
ok("words in capitals that are not tickers are refused", explicitTickers("Will CPI (YOY) beat the FED and GDP (USA)? AI (GPT) news").length === 0 && validTicker("CPI") === null && validTicker("brk-b") === "BRK.B" && validTicker("TOOLONG") === null);
ok("'target rate' and lower-case 'delta' are not Target or Delta", explicitTickers("Will the Fed's target rate be cut? the delta variant").length === 0 && explicitTickers("Will Target cut prices?")[0]?.ticker === "TGT");
ok("a private company maps to its listed backer, marked mixed", (() => { const x = mapMarket(mk({ venue: "polymarket", title: "Will OpenAI release GPT-6 before July 2027?" })); return x.tickers[0]?.ticker === "MSFT" && x.tickers[0].dir === 0 && /private/.test(x.tickers[0].why); })());
ok("an earnings beat lifts the named company", (() => { const x = mapMarket(mk({ venue: "kalshi", title: "Will Nvidia beat Q4 FY2027 EPS estimates?" })); return x.tickers[0]?.ticker === "NVDA" && x.tickers[0].dir === 1; })());
ok("a sports game maps to nothing", (() => { const x = mapMarket(poly.find((m) => m.id === "611002")!); return !x.tickers.length && !x.sectors.length; })());
ok("every ticker in the name table and the rules is a valid ticker", Object.values(COMPANIES).every((v) => validTicker(v) === v) && [...t(fedCut).keys(), ...t(tar).keys(), ...t(gop).keys()].every((v) => validTicker(v) === v));
const merged = mergeAi(fedCut, [{ ticker: "dhi", direction: "up", why: "dup" }, { ticker: "RKT", direction: "up", why: "Mortgage originator: volumes rise as rates fall" }, { ticker: "CPI", direction: "down", why: "x" }, { ticker: "NOT A TICKER", direction: "up", why: "x" }]);
ok("AI additions: only new, valid tickers, marked as the AI's; the rules stay", merged.source === "rules+ai" && merged.tickers.filter((x) => x.source === "ai").map((x) => x.ticker).join() === "RKT" && t(merged).get("DHI")?.dir === 1, merged.tickers);
ok("AI with nothing new leaves the rules' mapping as it was", mergeAi(fedCut, [{ ticker: "DHI", direction: "down", why: "x" }]) === fedCut);

/* ---------------- Exposure and signals ---------------- */

console.log("Book exposure and predictSignalsFor");
const live = all.map((m) => ({ ...m }));
const exp = bookExposure([{ ticker: "DHI", direction: "long", weight: 4 }, { ticker: "WMT", direction: "short", weight: 2 }, { ticker: "JPM", direction: "long", weight: 5 }, { ticker: "ZZZZ", direction: "long", weight: 1 }], live);
const fedExp = exp.find((e) => e.key === "kalshi:KXFEDDECISION-26DEC-C25")!;
ok("a Fed cut market touches a long homebuilder (helps) and a bank (mixed)", fedExp.positions.find((p) => p.ticker === "DHI")?.effect === 1 && fedExp.positions.find((p) => p.ticker === "JPM")?.effect === 0, fedExp);
ok("weights: net = helped - hurt, gross = all touched", fedExp.netWeight === 4 && fedExp.grossWeight === 9, fedExp);
const tarExp = exp.find((e) => e.key.startsWith("kalshi:KXTARIFFCHN"))!;
ok("a short in an importer is helped by higher tariffs", tarExp.positions.find((p) => p.ticker === "WMT")?.effect === 1, tarExp);
ok("the sentence says what yes does", /helps DHI \(4\.0% of your book\)/.test(exposureLine(fedExp)) && /either way/.test(exposureLine(fedExp)), exposureLine(fedExp));
ok("sports and play money are left out", !exp.some((e) => e.venue === "manifold" || e.key === "polymarket:611002"));
ok("an empty book has no exposure", bookExposure([], live).length === 0);
const sig = predictSignalsFor(["DHI", "COIN", "cpi", "WMT"], live, { perTicker: 3 });
ok("predictSignalsFor: tickers in, events per ticker out; non-tickers dropped", Object.keys(sig).sort().join() === "COIN,DHI,WMT" && sig.DHI.length > 0 && sig.DHI.length <= 3, Object.keys(sig));
ok("...each with probability, direction and why", sig.DHI.every((e) => e.prob > 0 && e.prob < 1 && typeof e.why === "string" && [1, -1, 0].includes(e.dir)));
ok("...one per event across venues (the Fed cut listed on three venues counts once)", sig.DHI.filter((e) => /25/.test(e.label) && /Fed|fed/.test(e.label)).length === 1, sig.DHI.map((e) => e.label));
ok("...pressure = direction x 24h move", sig.DHI.every((e) => e.pressure === null || near(e.pressure, e.dir * (e.change24h ?? 0), 1e-4)));

console.log("Quant signals");
const now = new Date(NOW);
const ps = predictProbSignal(kC, "DHI", { dir: 1, why: "Homebuilders" }, now)!;
ok("a probability signal keeps the contract (validateSignal)", validateSignal(ps).ok, validateSignal(ps));
ok("p is the market price, the interval its bid and ask, the base rate the price a day earlier", near(ps.probability!.p, 0.62) && near(ps.probability!.low, 0.61) && near(ps.probability!.high, 0.63) && near(ps.probability!.baseRate, 0.56));
ok("the question says it is the event's probability, not the stock's return", /not DHI's return/.test(ps.probability!.question));
ok("the explanation reads as statistics, not advice", forbiddenIn(ps.explain).length === 0, ps.explain);
ok("an ETF is an ETF", predictProbSignal(kC, "TLT", { dir: 1, why: "Long Treasuries" }, now)!.instrument.assetClass === "etf");
ok("a closed or play-money market makes no signal", predictProbSignal({ ...kC, status: "closed" }, "DHI", { dir: 1, why: "x" }, now) === null && predictProbSignal(mani[0], "DHI", { dir: 1, why: "x" }, now) === null);
const allSigs = predictSignals(live, now);
const bad = allSigs.map((s) => validateSignal(s)).filter((v) => !v.ok);
ok("every signal built from the fixtures validates", allSigs.length > 10 && bad.length === 0, bad.slice(0, 3));
ok("signal ids are unique", new Set(allSigs.map((s) => s.id)).size === allSigs.length);
const mv = moveSignals(live, now);
ok("move scores are z-scores in [-3, 3] and validate", mv.length >= 5 && mv.every((s) => s.kind === "score" && s.score! >= -3 && s.score! <= 3 && validateSignal(s).ok), mv.slice(0, 2));
ok("too few markets with a move (a cross-section of one market is only its sign): no scores", moveSignals([kC], now).length === 0);

/* ---------------- Alerts ---------------- */

console.log("Move alerts");
ok("no base yet: the first look sets it, no alert", (() => { const d = moveAlert({ threshold: 0.05, baseProb: null }, { prob: 0.4, status: "open", result: null }); return !d.fire && d.nextBase === 0.4; })());
ok("4 points under a 5-point threshold: no alert, base kept", (() => { const d = moveAlert({ threshold: 0.05, baseProb: 0.4 }, { prob: 0.44, status: "open", result: null }); return !d.fire && d.nextBase === 0.4; })());
ok("exactly 5 points: alert, base moves", (() => { const d = moveAlert({ threshold: 0.05, baseProb: 0.4 }, { prob: 0.45, status: "open", result: null }); return d.fire && d.kind === "move" && near(d.move, 0.05) && d.nextBase === 0.45; })());
ok("a fall counts the same", moveAlert({ threshold: 0.1, baseProb: 0.6 }, { prob: 0.49, status: "open", result: null }).fire);
ok("a slow drift alerts once per threshold, not once a day", (() => { let base: number | null = 0.4, n = 0; for (const p of [0.42, 0.44, 0.46, 0.48, 0.5, 0.52]) { const d = moveAlert({ threshold: 0.05, baseProb: base }, { prob: p, status: "open", result: null }); if (d.fire) n++; base = d.nextBase; } return n === 2; })());
ok("swinging inside the band alerts never", (() => { let base: number | null = 0.5, n = 0; for (const p of [0.53, 0.47, 0.52, 0.48, 0.54]) { const d = moveAlert({ threshold: 0.1, baseProb: base }, { prob: p, status: "open", result: null }); if (d.fire) n++; base = d.nextBase; } return n === 0; })());
ok("resolution alerts once", moveAlert({ threshold: 0.05, baseProb: 0.6 }, { prob: 1, status: "resolved", result: "yes" }).kind === "resolved" && !moveAlert({ threshold: 0.05, baseProb: 1, resolvedSent: true }, { prob: 1, status: "resolved", result: "yes" }).fire);
ok("no price: no alert", !moveAlert({ threshold: 0.05, baseProb: 0.5 }, { prob: null, status: "open", result: null }).fire);
ok("thresholds snap to the allowed set from points or fractions", normalizeThreshold(5) === 0.05 && normalizeThreshold(0.12) === 0.1 && normalizeThreshold("x") === 0.05 && normalizeThreshold(50) === 0.2);
const txt = alertText("Fed decision in December 2026?: Cut 25bps", "Kalshi", { fire: true, move: 0.07, kind: "move", nextBase: 0.62 }, 0.62, null);
ok("the alert says the move, the price and that it is not advice", /\+7 pts to 62%/.test(txt.title) && /not advice/.test(txt.body), txt);

/* ---------------- Forecasts and Brier ---------------- */

console.log("Forecasts and Brier scores");
ok("Brier: 0.7 on a yes is 0.09; 0.7 on a no is 0.49; 0.5 is 0.25 either way", near(brier(0.7, 1), 0.09) && near(brier(0.7, 0), 0.49) && brier(0.5, 1) === 0.25 && brier(0.5, 0) === 0.25);
ok("probabilities from 1-99 or 0.01-0.99; 0 and 100 refused", normalizeForecastP(70) === 0.7 && normalizeForecastP(0.35) === 0.35 && normalizeForecastP(0) === null && normalizeForecastP(100) === null && normalizeForecastP("x") === null);
ok("no forecast on a closed market or within an hour of the close", forecastRefusal({ status: "closed", closeTime: null, prob: 0.5 }) !== null && forecastRefusal({ status: "open", closeTime: new Date(NOW + 30 * 60_000).toISOString(), prob: 0.5 }, NOW) !== null && forecastRefusal({ status: "open", closeTime: new Date(NOW + 86_400_000).toISOString(), prob: 0.5 }, NOW) === null);
const fs: StoredForecast[] = [
  { id: 1, marketKey: "kalshi:A", title: "A", venue: "kalshi", p: 0.8, marketP: 0.6, day: "2026-10-01", outcome: 1, resolvedAt: "2026-10-28T18:10:00Z" },
  { id: 2, marketKey: "kalshi:B", title: "B", venue: "kalshi", p: 0.3, marketP: 0.5, day: "2026-10-02", outcome: 0, resolvedAt: "2026-10-30T00:00:00Z" },
  { id: 3, marketKey: "polymarket:C", title: "C", venue: "polymarket", p: 0.6, marketP: 0.7, day: "2026-11-01", outcome: null, resolvedAt: null },
];
const items = asForecastItems(fs);
ok("each forecast is scored beside the market's price at the time", items.length === 6 && items.filter((x) => x.source === "Market price").length === 3);
const cal = calibration(items);
const you = cal.bySource.find((s) => s.source === "You")!, mkt = cal.bySource.find((s) => s.source === "Market price")!;
ok("the Book's calibration scores both: you 0.065, the market 0.205", near(you.brier, 0.065) && near(mkt.brier, 0.205), cal.bySource);
ok("open forecasts are counted, not scored", calibration(items.filter((x) => x.source === "You")).open === 1);
ok("the Book's calibration line reads it", /Brier 0\.065 over 2 resolved forecasts/.test(calibrationLine(calibration(items.filter((x) => x.source === "You")))));

/* ---------------- Browser filters ---------------- */

console.log("Browser filters and the address");
const f = parseFilters(new URLSearchParams("q=fed%20dec&venue=kalshi,polymarket,nope&cat=fed&sort=change&min=1000"));
ok("filters from the address, cleaned", f.q === "fed dec" && f.venues.join() === "kalshi,polymarket" && f.cat === "fed" && f.sort === "change" && f.minVolume === 1000, f);
ok("and back, defaults left out", filtersToParams(f).toString() === "q=fed+dec&venue=kalshi%2Cpolymarket&cat=fed&sort=change&min=1000" && filtersToParams(DEFAULT_FILTERS).toString() === "");
ok("unknown values fall back", parseFilters({ cat: "bogus", sort: "x" }).cat === "finance" && parseFilters({ sort: "x" }).sort === "volume");
ok("search: every word starts a word", matchesQuery(kC, "fed dec") && matchesQuery(kC, "25bps") && !matchesQuery(kC, "ecb"));
const fl = filterMarkets(live, { ...DEFAULT_FILTERS, q: "fed" }, NOW);
ok("the default view is finance: sports left out; sorted by 24h volume", !filterMarkets(live, DEFAULT_FILTERS, NOW).some((m) => m.category === "sports") && fl.every((m, i) => i === 0 || (fl[i - 1].volume24h ?? 0) >= (m.volume24h ?? 0)), fl.map((m) => m.key));
ok("biggest move first", (() => { const x = filterMarkets(live, { ...DEFAULT_FILTERS, sort: "change" }, NOW); return Math.abs(x[0].change24h ?? 0) >= Math.abs(x[1].change24h ?? 0) && near(Math.abs(x[0].change24h ?? 0), 0.08); })());
ok("closing soonest first", (() => { const x = filterMarkets(live, { ...DEFAULT_FILTERS, cat: "all", sort: "closing" }, NOW); return x[0].key === "polymarket:611002"; })());
ok("by venue", filterMarkets(live, { ...DEFAULT_FILTERS, venues: ["gemini"] }, NOW).every((m) => m.venue === "gemini"));
ok("resolved markets never list", !filterMarkets([...live, settled], { ...DEFAULT_FILTERS, cat: "all" }, NOW).some((m) => m.status !== "open"));
ok("keys parse; nonsense does not", parseKey("kalshi:KXFED-26DEC-C25")?.venue === "kalshi" && parseKey("polymarket:601234")?.id === "601234" && parseKey("evil:x") === null && parseKey("kalshi:../../etc") === null);
ok("the cached list is capped and its rules trimmed", (() => { const big = Array.from({ length: LIST_MAX + 10 }, (_, i) => ({ ...kC, key: `kalshi:X${i}`, volume24h: i, rules: "r".repeat(1_000) })); const s = slim(big); return s.length === LIST_MAX && s[0].volume24h === LIST_MAX + 9 && s[0].rules.length === 398; })());

/* ---------------- Live (optional) ---------------- */

async function live_() {
  const { loadMarkets } = await import("@/lib/predict/store");
  const r = await loadMarkets();
  console.log("live venues:", JSON.stringify(r.venues));
  for (const v of r.venues) ok(`live: ${v.venue} answered (or is reported unavailable without a throw)`, typeof v.ok === "boolean");
}

(async () => {
  if (process.argv.includes("--live")) await live_();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
