/**
 * Crypto tests: address checks, notarization calldata and verification, every API parser (against
 * fixtures shaped like CoinGecko, DefiLlama, mempool.space, SEC frames, Etherscan, Alchemy and Dune),
 * portfolio risk, valuation math, the mining-site data, the Newsroom and directory converters, and
 * the Studio crypto templates (which must agree with the valuation math and pass the model audit).
 * Offline: no network needed.   pnpm exec tsx scripts/test-crypto.ts
 */
import { base58Decode, isBase58Btc, isBech32Btc, isSolana, parseAddress } from "@/lib/crypto/address";
import { CHAINS, EVM_CHAINS, isChainKey, shortAddress, txUrl } from "@/lib/crypto/chains";
import { canonicalJson, checkNotaryTx, notaryCalldata, NOTARY_PREFIX, parseNotaryCalldata, sha256Hex } from "@/lib/crypto/notary";
import { parseChart, parseCoin, parseGlobal, parseMarkets } from "@/lib/crypto/market";
import { mergeCashflows, parsePools, parseProtocols, parseStablecoins, rwaKind } from "@/lib/crypto/defi";
import { mergeTreasuries, parseRaises, parseUnlocks, recentFrames, topInvestors } from "@/lib/crypto/deals";
import { miningEconomics, parseHashrate, parsePools as parseMiningPools, subsidyAt } from "@/lib/crypto/bitcoin";
import { alignedReturns, maxDrawdown, portfolioRisk, quantile, type Holding } from "@/lib/crypto/risk";
import { multipleValue, quartiles, stakingYield, tokenDcf } from "@/lib/crypto/valuation";
import { multiples, priceStats } from "@/lib/crypto/token";
import { parseBtcTxs, parseEtherscanTxs } from "@/lib/crypto/wallet";
import { parseTransfers } from "@/lib/crypto/deep";
import { parseDune } from "@/lib/crypto/dune";
import { estimatedGwh, filingsUrl, sitePopupHtml, SITES, sitesGeoJson, siteTotals } from "@/lib/crypto/sites";
import { raiseItems, unlockItems } from "@/lib/crypto/news";
import { peerFin } from "@/lib/crypto/studio-data";
import { trailText } from "@/lib/crypto/studio-trail";
import { raisesToStartups } from "@/lib/vc/sources/defillama";
import { CRYPTO_FEATURES } from "@/lib/billing/features/crypto";
import { featureById } from "@/lib/billing/features";
import { buildCryptoComps, buildStakingYield, buildTokenDcf, buildTokenMultiples, ILLUSTRATIVE_PEERS, ILLUSTRATIVE_TOKEN, isCryptoTemplate } from "@/lib/studio/crypto-templates";
import { TEMPLATES, workbookOf } from "@/lib/studio/templates";
import { Engine } from "@/lib/studio/engine";
import { auditWorkbook } from "@/lib/studio/audit";
import { applyPatch, refreshSensitivities } from "@/lib/studio/ops";
import { emptyDeck, type SheetData, type StudioDocData } from "@/lib/studio/types";
import { parseCommand } from "@/lib/functions";
import { isCryptoFn, PRO_FNS } from "@/lib/crypto/views";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`); }
};
const near = (a: unknown, b: number, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* ---------------- Addresses ---------------- */
{
  const v = parseAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  check("EVM: a checksummed address passes", v.kind === "evm" && v.address === "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", v);
  check("EVM: lowercase is accepted and checksummed", (parseAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045") as { address?: string }).address === "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  check("EVM: a broken checksum is refused", parseAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046").kind === null && parseAddress("0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045").kind === null);
  check("EVM: too short is refused", parseAddress("0x1234").kind === null);
  check("ENS names", parseAddress("Vitalik.eth").kind === "ens" && (parseAddress("Vitalik.eth") as { address: string }).address === "vitalik.eth");
  check("Bitcoin: the genesis address (Base58Check)", isBase58Btc("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa") && parseAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa").kind === "bitcoin");
  check("Bitcoin: a typo fails the checksum", !isBase58Btc("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb") && parseAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb").kind === null);
  check("Bitcoin: P2SH (3…)", isBase58Btc("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"));
  check("Bitcoin: Bech32 (BIP 173 example, upper case)", isBech32Btc("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"));
  check("Bitcoin: Taproot Bech32m (BIP 350 example)", isBech32Btc("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"));
  check("Bitcoin: Bech32 with a typo fails", !isBech32Btc("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"));
  check("Bitcoin: mixed case Bech32 is invalid", !isBech32Btc("bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"));
  check("Solana: the USDC mint is a 32-byte key", isSolana("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") && parseAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").kind === "solana");
  check("base58: leading 1s are zero bytes", base58Decode("11")!.length === 2 && base58Decode("0OIl") === null);
  check("nonsense is refused with a plain message", (parseAddress("hello world") as { error?: string }).error?.startsWith("Not an address") === true);
  check("short display", shortAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045") === "0xd8dA…6045");
  check("chains: EVM chains carry chain ids and checksummed tokens", EVM_CHAINS.every((k) => CHAINS[k].chainId && CHAINS[k].tokens.every((t) => parseAddress(t.address).kind === "evm")));
  check("chains: Solana mints are valid keys", CHAINS.solana.tokens.every((t) => isSolana(t.address)));
  check("explorer links", txUrl("base", "0xabc") === "https://basescan.org/tx/0xabc");
}

/* ---------------- Notarization ---------------- */
const SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
async function notary() {
  check("SHA-256 of \"abc\" (FIPS 180-2 vector)", (await sha256Hex("abc")) === SHA);
  check("SHA-256 of bytes equals of text", (await sha256Hex(new TextEncoder().encode("abc"))) === SHA);
  const data = notaryCalldata(SHA);
  check("calldata is the readable prefix and hash", Buffer.from(data.slice(2), "hex").toString("utf8") === `${NOTARY_PREFIX}${SHA}`);
  check("calldata round trip", parseNotaryCalldata(data) === SHA && parseNotaryCalldata(notaryCalldata(SHA.toUpperCase())) === SHA);
  check("other calldata is not a notarization", parseNotaryCalldata("0x") === null && parseNotaryCalldata("0xa9059cbb") === null);
  let threw = false; try { notaryCalldata("1234"); } catch { threw = true; }
  check("a malformed hash is refused", threw);
  const me = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const good = { from: me, to: me.toLowerCase(), value: BigInt(0), input: data, status: "success" as const, blockNumber: BigInt(123) };
  check("verify: a good self-transaction", checkNotaryTx(good, SHA, me).ok);
  check("verify: pending", (checkNotaryTx({ ...good, status: "pending" }, SHA) as { pending?: boolean }).pending === true);
  check("verify: reverted", !checkNotaryTx({ ...good, status: "reverted" }, SHA).ok);
  check("verify: sent elsewhere", !checkNotaryTx({ ...good, to: "0x0000000000000000000000000000000000000001" }, SHA).ok);
  check("verify: carrying value", !checkNotaryTx({ ...good, value: BigInt(1) }, SHA).ok);
  check("verify: a different file", !checkNotaryTx(good, "0".repeat(64)).ok);
  check("verify: from someone else", !checkNotaryTx(good, SHA, "0x0000000000000000000000000000000000000001").ok);
  check("chains: only real chain keys, never inherited names", isChainKey("base") && !isChainKey("toString") && !isChainKey("constructor") && !isChainKey("__proto__"));
  check("canonical JSON ignores key order", canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }) === canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }) && canonicalJson({ a: undefined, b: 1 }) === '{"b":1}');
  const doc = { id: 7, title: "Model", workbook: { order: ["s"], sheets: { s: { id: "s", name: "A", cells: { A1: { v: 1 } } } } }, deck: { order: [] } };
  const ev = [{ id: 1, actor: "u", actorName: "Ann", label: "Edit", at: "2026-10-01T00:00:00.000Z", patches: [{ op: "x", b: 1, a: 2 }] }];
  const t1 = trailText(doc, ev), t2 = trailText({ ...doc, workbook: { sheets: { s: { cells: { A1: { v: 1 } }, name: "A", id: "s" } }, order: ["s"] } }, [{ ...ev[0], patches: [{ a: 2, b: 1, op: "x" }] }]);
  check("Studio trail: the same model hashes the same whatever the key order", t1 === t2);
  check("Studio trail: an edit changes it", trailText({ ...doc, title: "Model v2" }, ev) !== t1 && trailText(doc, [...ev, { ...ev[0], id: 2 }]) !== t1);
}

/* ---------------- CoinGecko ---------------- */
{
  const rows = parseMarkets([
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", image: "x", market_cap_rank: 1, current_price: 100000, market_cap: 2e12, fully_diluted_valuation: 2.1e12, total_volume: 5e10, price_change_percentage_24h_in_currency: 1.5, price_change_percentage_7d_in_currency: -2, price_change_percentage_30d_in_currency: "10", price_change_percentage_1y_in_currency: null, circulating_supply: 19.9e6, total_supply: 19.9e6, max_supply: 21e6, ath_change_percentage: -5, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => 90000 + i) } },
    { symbol: "bad" },
  ]);
  check("markets: one valid row", rows.length === 1);
  check("markets: percents become decimals", near(rows[0].d1, 0.015) && near(rows[0].d7, -0.02) && near(rows[0].d30, 0.1) && rows[0].y1 === null);
  check("markets: sparkline thinned to 42 points, ends kept", rows[0].spark.length === 42 && rows[0].spark[0] === 90000 && rows[0].spark[41] === 90167);
  check("markets: symbol upper case", rows[0].symbol === "BTC");
  const g = parseGlobal({ data: { total_market_cap: { usd: 3.5e12 }, total_volume: { usd: 1e11 }, market_cap_percentage: { btc: 57.2, eth: 11.1 }, market_cap_change_percentage_24h_usd: -1.2, active_cryptocurrencies: 17000, updated_at: 1790000000 } });
  check("global: dominance and change", near(g.btcDominance, 0.572) && near(g.change24h, -0.012) && g.totalMarketCap === 3.5e12 && g.updatedAt.startsWith("2026"));
  const c = parseCoin({ id: "uniswap", symbol: "uni", name: "Uniswap", categories: ["Decentralized Exchange (DEX)", null], description: { en: "<a href='x'>Uniswap</a> is a   DEX." }, links: { homepage: ["", "https://uniswap.org"] }, platforms: { ethereum: "0x1f98", "": "" }, market_data: { current_price: { usd: 8 }, market_cap: { usd: 5e9 }, fully_diluted_valuation: { usd: 8e9 }, circulating_supply: 6e8, total_supply: 1e9, max_supply: 1e9, ath: { usd: 44 }, price_change_percentage_24h: 2 } });
  check("coin: description stripped of HTML", c.description === "Uniswap is a DEX." && c.homepage === "https://uniswap.org" && c.categories.length === 1 && Object.keys(c.platforms).length === 1 && near(c.d1, 0.02));
  const ch = parseChart({ prices: [[Date.UTC(2026, 0, 1, 1), 10], [Date.UTC(2026, 0, 1, 23), 11], [Date.UTC(2026, 0, 2), 12], [Date.UTC(2026, 0, 3), 0]] });
  check("chart: one close per day (the last), bad prices dropped", ch.length === 2 && ch[0].close === 11 && ch[1].date === "2026-01-02");
}

/* ---------------- DefiLlama ---------------- */
{
  const ps = parseProtocols([{ name: "Aave", slug: "aave", symbol: "AAVE", category: "Lending", chains: ["Ethereum", "Base"], tvl: 2e10, change_1d: 1, change_7d: -3, mcap: 4e9, gecko_id: "aave" }, { name: "Tiny", symbol: "-", tvl: 5 }, { name: "Lido", slug: "lido", category: "Liquid Staking", tvl: 3e10, gecko_id: "lido-dao" }]);
  check("protocols: sorted by TVL", ps[0].slug === "lido" && ps[1].slug === "aave" && near(ps[1].d7, -0.03) && ps[2].symbol === "");
  const cf = mergeCashflows({ protocols: [{ name: "aave", displayName: "Aave", slug: "aave", category: "Lending", total24h: 1e6, total30d: 3e7, total1y: 4e8 }, { name: "z", total30d: 0 }] }, { protocols: [{ slug: "aave", total30d: 4e6, total1y: 5e7 }] }, { protocols: [{ slug: "aave", total30d: 1e6 }] });
  check("cash flows: fees, revenue and holders' revenue joined by slug", cf.length === 1 && cf[0].revenue30d === 4e6 && cf[0].holdersRevenue30d === 1e6 && cf[0].name === "Aave");
  const st = parseStablecoins({ peggedAssets: [{ name: "Tether", symbol: "USDT", pegType: "peggedUSD", pegMechanism: "fiat-backed", circulating: { peggedUSD: 110e9 }, circulatingPrevDay: { peggedUSD: 109e9 }, circulatingPrevWeek: { peggedUSD: 100e9 }, circulatingPrevMonth: {}, price: 1.0002, chainCirculating: { Ethereum: { current: { peggedUSD: 60e9 } }, Tron: { current: { peggedUSD: 50e9 } } } }, { name: "Dust", circulating: { peggedUSD: 10 } }] });
  check("stablecoins: supply change and chains", st.length === 1 && near(st[0].d7, 0.1) && st[0].d30 === null && st[0].pegType === "USD" && st[0].chains[0].chain === "Ethereum");
  const pools = parsePools({ data: [{ pool: "a", project: "aave-v3", chain: "Ethereum", symbol: "USDC", tvlUsd: 1e9, apy: 5, apyBase: 4, apyReward: 1, stablecoin: true, ilRisk: "no" }, { pool: "b", tvlUsd: 0 }] });
  check("pools: APYs as decimals, empty pools dropped", pools.length === 1 && near(pools[0].apy, 0.05) && pools[0].stable);
  check("RWA kinds", rwaKind({ name: "BlackRock BUIDL", category: "RWA", slug: "blackrock-buidl" }) === "treasuries" && rwaKind({ name: "Maple", category: "RWA Lending", slug: "maple" }) === "private credit" && rwaKind({ name: "Paxos Gold", category: "RWA", slug: "paxos-gold" }) === "commodities" && rwaKind({ name: "Obscure", category: "RWA Lending", slug: "obscure" }) === "private credit" && rwaKind({ name: "Obscure", category: "RWA", slug: "obscure" }) === "other");
}

/* ---------------- Deals ---------------- */
{
  const now = Date.UTC(2026, 9, 5);
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
  const rs = parseRaises({ raises: [
    { date: day("2026-10-01"), name: "Alpha", round: "Series A", amount: 25, valuation: 250, chains: ["Base"], category: "DEX", leadInvestors: ["Paradigm"], otherInvestors: ["Coinbase Ventures"], source: "https://x.com/a" },
    { date: day("2026-10-03"), name: "Beta", round: "Seed", amount: 5, chains: [], sector: "Infra", leadInvestors: ["Paradigm", "a16z crypto"], otherInvestors: [] },
    { date: day("2026-09-01"), name: "Gamma", round: "Seed", amount: null, leadInvestors: ["a16z crypto"] },
  ] });
  check("raises: newest first, millions to dollars", rs[0].name === "Beta" && rs[1].amountUsd === 25e6 && rs[1].valuationUsd === 250e6 && rs[2].amountUsd === null);
  const ti = topInvestors(rs);
  check("top investors by rounds led", ti[0].name === "Paradigm" && ti[0].rounds === 2 && ti[0].usd === 30e6 && ti[1].name === "a16z crypto");
  const un = parseUnlocks([
    { name: "Arbitrum", gecko_id: "arbitrum", tPrice: 0.5, circSupply: 4e9, mcap: 2e9, nextEvent: { date: now / 1000 + 5 * 86400, toUnlock: 9.2e7 } },
    { name: "Old", nextEvent: { date: now / 1000 - 10 * 86400, toUnlock: 1 } },
    { name: "Soon", token: "coingecko:soon", tPrice: 1, circSupply: 1e6, nextEvent: { date: now / 1000 + 86400, toUnlock: 1e5 } },
  ], now);
  check("unlocks: past events dropped, soonest first", un.length === 2 && un[0].name === "Soon" && un[0].geckoId === "soon");
  check("unlocks: value and share of circulating", near(un[1].nextUsd, 4.6e7) && near(un[1].nextShare, 0.023));
  check("frames: the last four reportable quarters", JSON.stringify(recentFrames(new Date("2026-10-05T00:00:00Z"))) === JSON.stringify(["CY2026Q2I", "CY2026Q1I", "CY2025Q4I", "CY2025Q3I"]) && recentFrames(new Date("2026-02-20T00:00:00Z"))[0] === "CY2025Q4I");
  const tr = mergeTreasuries([
    { period: "CY2026Q2I", concept: "CryptoAssetFairValueNoncurrent", frame: { data: [{ cik: 1050446, entityName: "Strategy Inc", end: "2026-06-30", val: 7e10, accn: "a" }, { cik: 2, entityName: "Two", end: "2026-06-30", val: 100 }] } },
    { period: "CY2026Q2I", concept: "CryptoAssetFairValueCurrent", frame: { data: [{ cik: 2, entityName: "Two", end: "2026-06-30", val: 50 }] } },
    { period: "CY2026Q1I", concept: "CryptoAssetFairValueNoncurrent", frame: { data: [{ cik: 1050446, entityName: "Strategy Inc", end: "2026-03-31", val: 5e10 }, { cik: 3, entityName: "Three", end: "2026-03-31", val: 900 }] } },
  ], new Map([["0001050446", "MSTR"]]));
  check("treasuries: newest quarter per company, current plus noncurrent", tr[0].ticker === "MSTR" && tr[0].fairValue === 7e10 && tr[0].asOf === "2026-06-30" && tr.find((r) => r.name === "Two")?.fairValue === 150 && tr.find((r) => r.name === "Three")?.asOf === "2026-03-31");
}

/* ---------------- Bitcoin ---------------- */
{
  check("subsidy: 50, then halvings", subsidyAt(0) === 50 && subsidyAt(840_000) === 3.125 && subsidyAt(1_050_000) === 1.5625);
  const e = miningEconomics({ hashrateEhs: 1000, feesPerBlock: 0.025, subsidy: 3.125, priceUsd: 100_000, efficiencyJth: 20, powerUsdKwh: 0.05 });
  // 144 x 3.15 = 453.6 BTC a day; $45.36M over 1,000,000 PH/s = $45.36 per PH/s per day.
  check("mining: daily BTC and hashprice", near(e.dailyBtc, 453.6, 1e-12) && near(e.hashpriceUsdPh, 45.36, 1e-12));
  // 20 J/TH x 86,400 s / 3.6e6 = 0.48 kWh per TH per day; $0.04536 / 0.48 = $0.0945 per kWh.
  check("mining: breakeven power price", near(e.kwhPerThDay, 0.48, 1e-12) && near(e.breakevenUsdKwh, 0.0945, 1e-9) && near(e.marginPerThDay, 0.04536 - 0.024, 1e-9));
  check("mining: network draw at that efficiency", near(e.networkGw, 20, 1e-12) && near(e.feeShare, 0.025 / 3.15, 1e-12));
  const h = parseHashrate({ hashrates: [{ timestamp: 1780000000, avgHashrate: 9e20 }, { timestamp: 1780086400, avgHashrate: 0 }], currentHashrate: 1e21, currentDifficulty: 1.2e14 });
  check("hashrate: EH/s, zeros dropped", h.series.length === 1 && near(h.series[0].ehs, 900) && near(h.currentEhs, 1000));
  const mp = parseMiningPools({ pools: [{ name: "Foundry", blockCount: 300 }, { name: "AntPool", blockCount: 200 }], blockCount: 1000 });
  check("pools: share of blocks", mp[0].name === "Foundry" && near(mp[0].share, 0.3));
}

/* ---------------- Risk ---------------- */
{
  check("quantile interpolates", near(quantile([1, 2, 3, 4], 0.5), 2.5) && quantile([], 0.5) === null);
  check("drawdown", near(maxDrawdown([100, 120, 60, 90]), -0.5));
  const days = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  let a = 100, b = 50;
  const btc = days.map((date, i) => ({ date, close: (a *= 1 + (i % 2 ? 0.02 : -0.019)) }));
  const eth = days.map((date, i) => ({ date, close: (b *= 1 + (i % 3 ? 0.03 : -0.05)) }));
  const { returns } = alignedReturns({ btc, eth: eth.slice(10) });
  check("aligned returns use only shared dates", returns.btc.length === 109 && returns.eth.length === 109);
  const H = (asset: string, symbol: string, chain: string, valueUsd: number, stable = false, costUsd: number | null = null): Holding => ({ asset, symbol, chain, quantity: 1, priceUsd: valueUsd, valueUsd, stable, costUsd });
  const r = portfolioRisk([H("bitcoin", "BTC", "bitcoin", 6000, false, 4000), H("ethereum", "ETH", "ethereum", 2000), H("ethereum", "ETH", "base", 1000), H("usd-coin", "USDC", "base", 1000, true)], { bitcoin: btc, ethereum: eth });
  check("risk: weights aggregate across chains and sum to one", r.weights.length === 3 && near(r.weights.reduce((s, w) => s + w.weight, 0), 1) && near(r.weights[1].weight, 0.3));
  check("risk: HHI and effective holdings", near(r.hhi, 0.36 + 0.09 + 0.01) && near(r.effectiveN, 1 / 0.46));
  check("risk: stablecoin share and chains", near(r.stableShare, 0.1) && r.chains[0].chain === "bitcoin" && near(r.chains.find((c) => c.chain === "base")!.weight, 0.2));
  check("risk: volatility and VaR are positive and ordered", (r.vol ?? 0) > 0 && (r.var95 ?? 0) > 0 && (r.es95 ?? 0) >= (r.var95 ?? 0) && r.days === 119 && r.historyCoverage === 1);
  check("risk: P&L only where a cost was entered", r.pnl !== null && r.pnl.gainUsd === 2000 && near(r.pnl.gainPct, 0.5) && near(r.pnl.covered, 0.6));
  const thin = portfolioRisk([H("bitcoin", "BTC", "bitcoin", 100)], { bitcoin: btc.slice(0, 10) });
  check("risk: too little history gives no volatility rather than a wrong one", thin.vol === null && thin.var95 === null);
  const ps = priceStats(eth, btc);
  check("token stats: drawdown negative, correlation in range", (ps.maxDrawdown ?? 0) < 0 && Math.abs(ps.corrBtc90 ?? 2) <= 1);
  const lev = btc.map((p, i) => ({ date: p.date, close: i === 0 ? 100 : 0 }));
  let x = 100; for (let i = 1; i < lev.length; i++) { x *= 1 + 2 * (btc[i].close / btc[i - 1].close - 1); lev[i].close = x; }
  const ls = priceStats(lev, btc);
  check("token stats: a 2x-leveraged copy has beta 2 and correlation 1", near(ls.betaBtc90, 2, 1e-6) && near(ls.corrBtc90, 1, 1e-9));
  const m = multiples(1000, 2000, { name: "x", slug: "x", category: "", fees24h: null, fees30d: 30, fees1y: null, revenue30d: 3, revenue1y: null, holdersRevenue30d: null }, 500);
  check("multiples annualise 30 days", near(m.mcapToFees, 1000 / 365) && near(m.fdvToRevenue, 2000 / 36.5) && m.mcapToHoldersRevenue === null && near(m.mcapToTvl, 2));
}

/* ---------------- Valuation ---------------- */
{
  const mv = multipleValue({ annualMetricUsd: 90, multiple: 25, circulating: 400, fullyDiluted: 1000 });
  check("multiple valuation", mv.value === 2250 && near(mv.perToken, 5.625) && near(mv.perTokenFd, 2.25));
  const d = tokenDcf({ baseCashflowUsd: 100, growthY1: 0.2, growthY5: 0.2, discountRate: 0.2, terminalGrowth: 0, circulating: 100, supplyGrowth: 0 });
  // Constant 20% growth discounted at 20%: every year's PV is 100; terminal 248.832/0.2 discounted 5 years = 500.
  check("token DCF: textbook case", near(d.value, 1000, 1e-9) && near(d.perToken, 10, 1e-9) && near(d.terminalShare, 0.5, 1e-9));
  const capped = tokenDcf({ baseCashflowUsd: 10, growthY1: 0.1, growthY5: 0.05, discountRate: 0.3, terminalGrowth: 0.02, circulating: 90, supplyGrowth: 0.1, maxSupply: 100 });
  check("token DCF: supply growth stops at the cap", capped.supply[4] === 100 && near(capped.supply[0], 99));
  let threw = false; try { tokenDcf({ baseCashflowUsd: 1, growthY1: 0, growthY5: 0, discountRate: 0.03, terminalGrowth: 0.03, circulating: 1, supplyGrowth: 0 }); } catch { threw = true; }
  check("token DCF: discount rate must exceed growth", threw);
  const st = stakingYield({ supply: 120, issuanceRate: 0.01, stakingRatio: 0.25, feesToStakersUsd: 600, priceUsd: 3000, burnRate: 0.005 });
  // Staked 30; new 1.2; fees 0.2 tokens; nominal (1.2+0.2)/30.
  check("staking: nominal, real, dilution", near(st.nominal, 1.4 / 30) && near(st.inflation, 0.005) && near(st.real, (1 + 1.4 / 30) / 1.005 - 1) && near(st.nonStakerDilution, 1 / 1.005 - 1));
  const q = quartiles([4, null, 1, 3, 2]);
  check("quartiles match QUARTILE.INC", q.median === 2.5 && q.q1 === 1.75 && q.q3 === 3.25 && q.n === 4);
}

/* ---------------- Wallet, indexer and Dune parsers ---------------- */
{
  const me = "bc1qme";
  const btc = parseBtcTxs([
    { txid: "t1", status: { block_time: 1790000000 }, vin: [{ prevout: { scriptpubkey_address: "bc1qother", value: 50000 } }], vout: [{ scriptpubkey_address: me, value: 40000 }, { scriptpubkey_address: "bc1qother", value: 9000 }] },
    { txid: "t2", status: {}, vin: [{ prevout: { scriptpubkey_address: me, value: 40000 } }], vout: [{ scriptpubkey_address: "bc1qshop", value: 30000 }, { scriptpubkey_address: me, value: 9000 }] },
  ], me);
  check("bitcoin activity: net in and out per transaction", btc[0].direction === "in" && near(btc[0].amount, 0.0004) && btc[0].counterparty === "bc1qother" && btc[1].direction === "out" && near(btc[1].amount, 0.00031) && btc[1].counterparty === "bc1qshop");
  const ev = parseEtherscanTxs({ result: [{ hash: "0x1", from: "0xAA", to: "0xbb", value: "1000000000000000000", timeStamp: "1790000000" }, { hash: "0x2", from: "0xcc", to: "0xaa", value: "0", timeStamp: "1790000001" }] }, "0xaa", "ethereum");
  check("etherscan activity", ev[0].direction === "out" && ev[0].amount === 1 && ev[0].counterparty === "0xbb" && ev[1].direction === "in" && ev[0].symbol === "ETH");
  const tr = parseTransfers({ transfers: [{ hash: "0x1", from: "0xA", to: "0xme", value: 5, asset: "USDC", metadata: { blockTimestamp: "2026-10-01T00:00:00Z" } }, { hash: "0x2", from: "0xme", to: "0xme", value: 1 }] }, "base", "0xME", "in");
  check("indexer transfers: self-transfers dropped", tr.length === 1 && tr[0].counterparty === "0xA" && tr[0].asset === "USDC");
  const du = parseDune({ execution_ended_at: "2026-10-01T00:00:00Z", result: { rows: [{ day: "2026-09-30", usd: 12.5 }], metadata: { column_names: ["day", "usd"], total_row_count: 900 } } }, 42);
  check("dune results", du.columns.join() === "day,usd" && du.rowCount === 900 && du.source.url === "https://dune.com/queries/42");
}

/* ---------------- Mining sites ---------------- */
{
  const g = sitesGeoJson();
  check("sites: one feature per site, [lon, lat]", g.features.length === SITES.length && g.features.every((f, i) => f.geometry.coordinates[0] === SITES[i].lon && f.geometry.coordinates[1] === SITES[i].lat));
  check("sites: unique ids and plausible coordinates", new Set(SITES.map((s) => s.id)).size === SITES.length && SITES.every((s) => Math.abs(s.lat) <= 70 && Math.abs(s.lon) <= 180));
  check("sites: filter by kind", sitesGeoJson(["hpc_conversion"]).features.every((f) => f.properties.kind === "hpc_conversion") && sitesGeoJson(["hpc_conversion"]).features.length > 0);
  check("sites: every one links to its operator's filings", g.features.every((f) => f.properties.source.startsWith("https://www.sec.gov/") && f.properties.approximate));
  check("sites: energy estimate", near(estimatedGwh(100), 744.6) && estimatedGwh(null) === null && siteTotals().mw > 0);
  check("sites: filings link drops a parenthetical", filingsUrl("Bitfarms (Stronghold)").includes("company=Bitfarms&"));
  const html = sitePopupHtml({ name: "<script>x</script>", operator: "A & B", ticker: "", kind: "bitcoin_mining", status: "operating", city: "X", region: "TX", country: "US", capacityMw: null, estGwh: null, power: "grid", note: "", source: "javascript:alert(1)" });
  check("popup escapes everything and only links https", !html.includes("<script>") && html.includes("&lt;script&gt;") && html.includes("A &amp; B") && !html.includes("javascript:") && html.includes("Capacity not stated"));
}

/* ---------------- Newsroom and directory ---------------- */
{
  const now = new Date("2026-10-05T12:00:00Z");
  const raises = [
    { date: "2026-10-04", name: "Alpha", round: "Series A", amountUsd: 25e6, valuationUsd: null, chains: ["Base"], sector: "", category: "DEX", leads: ["Paradigm"], others: [], source: "https://example.com/alpha?utm_source=x" },
    { date: "2026-10-04", name: "Small", round: "Seed", amountUsd: 1e6, valuationUsd: null, chains: [], sector: "", category: "", leads: [], others: [], source: "" },
    { date: "2026-08-01", name: "Alpha", round: "Seed", amountUsd: 3e6, valuationUsd: null, chains: ["Base"], sector: "", category: "DEX", leads: ["a16z crypto"], others: ["Coinbase Ventures"], source: "" },
  ];
  const items = raiseItems(raises, now);
  check("news: only recent rounds of $5M or more", items.length === 1 && items[0].title === "Alpha raises $25.0M in a Series A round led by Paradigm" && items[0].tags.includes("crypto") && items[0].meta.category === "funding");
  check("news: tracking parameters stripped from the link", !items[0].url.includes("utm_source"));
  const un = unlockItems([{ name: "Arbitrum", geckoId: "arbitrum", price: 0.5, mcap: 1, circulating: 4e9, maxSupply: 1e10, nextDate: "2026-10-08", nextTokens: 9.2e7, nextUsd: 4.6e7, nextShare: 0.023, perDay: null, locked: null }, { name: "Later", geckoId: null, price: 1, mcap: 1, circulating: 1, maxSupply: 1, nextDate: "2026-12-01", nextTokens: 1, nextUsd: 1e9, nextShare: 1, perDay: null, locked: null }], now);
  check("news: unlocks this week that matter", un.length === 1 && un[0].title === "Arbitrum unlocks 2.3% of circulating supply (about $46.0M) on 2026-10-08");
  const dir = raisesToStartups(raises, 0, now);
  const alpha = dir.find((d) => d.name === "Alpha")!;
  check("directory: one entry per project with rounds summed", dir.length === 2 && alpha.raisedUsd === 28e6 && alpha.fundingStage === "Series A" && (alpha.investors ?? []).includes("Coinbase Ventures") && alpha.sourceDate === "2026-10-04");
  check("directory: days filter", raisesToStartups(raises, 1, now).length === 2 && raisesToStartups(raises, 1, new Date("2026-11-30T00:00:00Z")).length === 0);
}

/* ---------------- Plans, functions ---------------- */
{
  check("premium: crypto features registered with honest costs", CRYPTO_FEATURES.length === 3 && CRYPTO_FEATURES.every((f) => f.area === "crypto" && f.id.startsWith("crypto.") && f.metered && (f.costPerUseUsd ?? 0) > 0 && featureById(f.id) === f));
  check("terminal: TOKEN keeps its argument", (() => { const r = parseCommand("TOKEN eth", "SNOW"); return r.ok && r.command.fn === "TOKEN" && r.command.arg === "eth" && r.command.ticker === ""; })());
  check("terminal: WALLET keeps the address's case", (() => { const r = parseCommand("WALLET 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", ""); return r.ok && r.command.arg === "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; })());
  check("terminal: crypto codes need no ticker", (() => { const r = parseCommand("DEFI", "SNOW"); return r.ok && r.command.ticker === ""; })());
  check("terminal: data functions and Pro screens", ["crypto", "token", "defi", "stables", "yields", "btc", "raises", "unlocks", "treasuries", "rwa"].every(isCryptoFn) && !isCryptoFn("price") && !isCryptoFn("constructor") && PRO_FNS.has("token") && !PRO_FNS.has("treasuries"));
}

/* ---------------- Studio templates ---------------- */
const docOf = (sheets: SheetData[]): StudioDocData => ({ title: "t", workbook: workbookOf(sheets), deck: emptyDeck(), comments: [] });
const sheetId = (d: StudioDocData, name: string) => d.workbook.order.find((x) => d.workbook.sheets[x].name === name)!;
const errorsOf = (e: Engine) => auditWorkbook(e).filter((i) => i.severity === "error");
const warningsOf = (e: Engine) => auditWorkbook(e).filter((i) => i.kind === "hardcoded_number" || i.kind === "inconsistent_formula" || i.kind === "empty_reference");
function studio() {
  check("templates: registered in the gallery", ["token_multiples", "token_dcf", "staking_yield", "crypto_comps"].every((id) => isCryptoTemplate(id) && TEMPLATES.some((t) => t.id === id)) && !isCryptoTemplate("dcf"));
  const T = ILLUSTRATIVE_TOKEN;
  {
    const b = buildTokenMultiples(T);
    const doc = docOf(b.sheets), e = new Engine(doc.workbook), id = sheetId(doc, "Token multiples");
    check("multiples: market cap and FDV", e.get(id, "C8") === 1000 && e.get(id, "C9") === 2500);
    check("multiples: market cap / fees", near(e.get(id, "C16"), 1000 / 300));
    const mid = multipleValue({ annualMetricUsd: T.revenue, multiple: 25, circulating: T.circulating, fullyDiluted: T.fullyDiluted });
    check("multiples: implied price agrees with the valuation math", near(e.get(id, "D26"), mid.perTokenFd!), [e.get(id, "D26"), mid.perTokenFd]);
    check("multiples: no audit errors or typed-in numbers", errorsOf(e).length === 0 && warningsOf(e).length === 0, auditWorkbook(e).slice(0, 4));
    const zero = docOf(buildTokenMultiples({ ...T, fees: 0, revenue: 0, holdersRevenue: 0 }).sheets), ez = new Engine(zero.workbook);
    check("multiples: a token without fees shows NM, not errors", ez.get(sheetId(zero, "Token multiples"), "C16") === "NM" && errorsOf(ez).length === 0);
  }
  {
    const b = buildTokenDcf(T);
    const doc = docOf(b.sheets), e = new Engine(doc.workbook), id = sheetId(doc, "Token DCF");
    const supplyGrowth = e.get(id, "C13") as number;
    const ref = tokenDcf({ baseCashflowUsd: T.holdersRevenue, growthY1: 0.3, growthY5: 0.08, discountRate: 0.25, terminalGrowth: 0.03, circulating: T.circulating, supplyGrowth, maxSupply: T.fullyDiluted });
    check("token DCF: value per token agrees with the valuation math", near(e.get(id, "C28"), ref.perToken!, 1e-9), [e.get(id, "C28"), ref.perToken]);
    check("token DCF: network value and terminal share agree", near(e.get(id, "C27"), ref.value, 1e-9) && near(e.get(id, "C30"), ref.terminalShare!, 1e-9));
    check("token DCF: no audit errors or typed-in numbers", errorsOf(e).length === 0 && warningsOf(e).length === 0, auditWorkbook(e).slice(0, 4));
    for (const p of refreshSensitivities(doc, e)) applyPatch(doc, p, e);
    check("token DCF: the sensitivity centre equals the model", near(e.get(id, "E37"), e.get(id, "C28") as number, 1e-9), [e.get(id, "E37"), e.get(id, "C28")]);
  }
  {
    const b = buildStakingYield(T);
    const doc = docOf(b.sheets), e = new Engine(doc.workbook), id = sheetId(doc, "Staking yield");
    const ref = stakingYield({ supply: T.circulating, issuanceRate: 0.03, stakingRatio: 0.3, feesToStakersUsd: T.holdersRevenue, priceUsd: T.price, burnRate: 0 });
    check("staking: nominal and real yield agree with the math", near(e.get(id, "C18"), ref.nominal) && near(e.get(id, "C20"), ref.real) && near(e.get(id, "C22"), ref.nonStakerDilution));
    check("staking: no audit errors or typed-in numbers", errorsOf(e).length === 0 && warningsOf(e).length === 0, auditWorkbook(e).slice(0, 4));
    for (const p of refreshSensitivities(doc, e)) applyPatch(doc, p, e);
    check("staking: the sensitivity centre equals the model", near(e.get(id, "E33"), e.get(id, "C20") as number, 1e-9), [e.get(id, "E33"), e.get(id, "C20")]);
  }
  {
    const b = buildCryptoComps(T, ILLUSTRATIVE_PEERS);
    const doc = docOf(b.sheets), e = new Engine(doc.workbook), id = sheetId(doc, "Crypto comps");
    const fdvRev = ILLUSTRATIVE_PEERS.map((p) => (p.price * p.fullyDiluted) / p.revenue);
    check("comps: median FDV / revenue", near(e.evaluate(b.anchors.medianFdvRevenue.split("!")[1], id), quartiles(fdvRev).median!, 1e-9));
    check("comps: a peer with no holders' revenue is NM", e.get(id, "M8") === "NM");
    const implied = e.evaluate(b.anchors.revPriceMid.split("!")[1], id);
    check("comps: implied price is median multiple x revenue / fully diluted supply", near(implied, (quartiles(fdvRev).median! * T.revenue) / T.fullyDiluted, 1e-9), implied);
    check("comps: no audit errors", errorsOf(e).length === 0, errorsOf(e).slice(0, 3));
    const one = docOf(buildCryptoComps(T, []).sheets);
    check("comps: no peers still builds without errors", errorsOf(new Engine(one.workbook)).length === 0);
  }
  const pf = peerFin({ id: "aave", symbol: "AAVE", name: "Aave", image: "", rank: 1, price: 200, marketCap: 3e9, fdv: 3.2e9, volume24h: 1, d1: 0, d7: 0, d30: 0, y1: 0, circulating: 15e6, total: 16e6, max: 16e6, athChange: 0, spark: [] },
    { name: "Aave", slug: "aave", symbol: "AAVE", category: "Lending", chains: [], tvl: 2e10, d1: 0, d7: 0, mcap: 3e9, geckoId: "aave", url: "" },
    { name: "Aave", slug: "aave", category: "Lending", fees24h: 0, fees30d: 3e7, fees1y: 0, revenue30d: 6e6, revenue1y: 0, holdersRevenue30d: 3e6 });
  check("studio data: peers in millions, cash flows annualised", pf.circulating === 15 && pf.fullyDiluted === 16 && near(pf.fees, 365) && near(pf.revenue, 73) && near(pf.holdersRevenue, 36.5) && pf.tvl === 20000);
}

async function main() {
  await notary();
  studio();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
