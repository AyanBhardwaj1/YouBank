/**
 * Crypto tools for the assistant, so it can answer questions about tokens, DeFi, stablecoins,
 * Bitcoin, crypto deals, treasuries, tokenized assets and wallets with figures it cites. Each tool
 * registers its sources with `ctx.addSource` and returns their ids next to the numbers, the same way
 * the SEC tools do. All of them use free sources; none signs or moves anything.
 */
import { z } from "zod";
import { def, type ToolCtx, type ToolDef } from "@/lib/ai/tools";
import { bitcoinView } from "./bitcoin";
import type { Cite } from "./sources";
import { marketsView, raisesView, rwaView, stablesView, treasuriesView, unlocksView, defiView } from "./views";
import { tokenView } from "./token";
import { walletView } from "./wallet";
import { multipleValue, stakingYield, tokenDcf } from "./valuation";

const r = (v: number | null | undefined, d = 4) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(d + 2)) : null);
const cite = (ctx: ToolCtx, sources: Cite[]) => sources.map((s) => ctx.addSource(`${s.name}${s.asOf ? `, ${s.asOf.slice(0, 16)}Z` : ""}`, s.url));
const J = (x: unknown) => JSON.stringify(x);

export const cryptoMarketTool = def({
  name: "get_crypto_market",
  description: "The crypto market now (CoinGecko, DefiLlama): total market cap, bitcoin and ether dominance, DeFi TVL, stablecoin supply, and the largest tokens with price, market cap, FDV, volume and 1d/7d/30d/1y changes (decimals: 0.05 = 5%).",
  schema: z.object({ limit: z.number().int().min(5).max(100).optional().describe("How many tokens, by market cap (default 25)") }),
  run: async ({ limit }, ctx) => {
    const v = await marketsView();
    return J({ sources: cite(ctx, v.sources), global: v.global, defi_tvl_usd: v.defiTvl, defi_tvl_change_30d: r(v.defiTvl30), stablecoin_supply_usd: v.stablecoinSupply, stablecoin_change_30d: r(v.stablecoin30),
      tokens: v.tokens.slice(0, limit ?? 25).map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, rank: t.rank, price: t.price, market_cap: t.marketCap, fdv: t.fdv, volume_24h: t.volume24h, d1: r(t.d1), d7: r(t.d7), d30: r(t.d30), y1: r(t.y1) })) });
  },
});

export const tokenTool = def({
  name: "get_token",
  description: "One token in depth: price and supply (circulating, total, max), a year's volatility, max drawdown, 90-day beta and correlation to bitcoin, its DeFi protocol's TVL, fees, revenue and holders' revenue (30 days and 1 year), market cap and FDV multiples of annualised fees and revenue, and the next scheduled unlock. Takes a symbol (UNI) or CoinGecko id (uniswap).",
  schema: z.object({ token: z.string().describe("Symbol or CoinGecko id, e.g. ETH, AAVE, uniswap") }),
  run: async ({ token }, ctx) => {
    const v = await tokenView(token);
    return J({ sources: cite(ctx, v.sources), token: { id: v.info.id, symbol: v.info.symbol, name: v.info.name, categories: v.info.categories, description: v.info.description.slice(0, 400) },
      market: { price: v.info.price, market_cap: v.info.marketCap, fdv: v.info.fdv, volume_24h: v.info.volume24h, circulating: v.info.circulating, total_supply: v.info.total, max_supply: v.info.max, ath: v.info.ath, d1: r(v.info.d1), d30: r(v.info.d30), y1: r(v.info.y1) },
      risk: { vol_1y: r(v.stats.vol365), vol_90d: r(v.stats.vol90), max_drawdown_1y: r(v.stats.maxDrawdown), beta_to_btc_90d: r(v.stats.betaBtc90), corr_to_btc_90d: r(v.stats.corrBtc90) },
      protocol: v.protocol, cashflows_usd: v.cash, multiples: Object.fromEntries(Object.entries(v.multiples).map(([k, x]) => [k, r(x)])), next_unlock: v.unlock,
      notes: "Multiples annualise the last 30 days (x 365/30). Holders' revenue is what reaches tokenholders; fees include what goes to liquidity providers." });
  },
});

export const defiTool = def({
  name: "get_defi_overview",
  description: "DeFi from DefiLlama: total value locked by chain and by category, the largest protocols with TVL and 1d/7d changes, and the protocols earning the most fees and revenue (30 days and 1 year).",
  schema: z.object({ limit: z.number().int().min(5).max(40).optional() }),
  run: async ({ limit }, ctx) => {
    const v = await defiView();
    const n = limit ?? 15;
    return J({ sources: cite(ctx, v.sources), chains: v.chains.slice(0, n), categories: v.categories, protocols: v.protocols.slice(0, n).map((p) => ({ name: p.name, category: p.category, tvl: p.tvl, d1: r(p.d1), d7: r(p.d7), chains: p.chains.slice(0, 5) })), top_earners: v.cashflows.slice(0, n) });
  },
});

export const stablecoinsTool = def({
  name: "get_stablecoins",
  description: "Stablecoins from DefiLlama: total supply, net flows over 1, 7 and 30 days (dollars minted minus redeemed), supply by coin with peg mechanism and price, and by chain.",
  schema: z.object({}),
  run: async (_input, ctx) => {
    const v = await stablesView();
    return J({ sources: cite(ctx, v.sources), total_supply_usd: v.total, net_flows_usd: v.flows, by_chain: v.chains, coins: v.coins.slice(0, 15).map((c) => ({ symbol: c.symbol, name: c.name, supply: c.supply, mechanism: c.mechanism, price: c.price, d7: r(c.d7), d30: r(c.d30) })) });
  },
});

export const raisesTool = def({
  name: "get_crypto_raises",
  description: "Crypto venture rounds from DefiLlama: date, project, round, amount, valuation when disclosed, category, chains, lead and other investors, and the source article. Filter by words in the project, category, sector or investor names.",
  schema: z.object({ query: z.string().optional().describe("e.g. 'Paradigm', 'restaking', 'RWA'"), days: z.number().int().min(1).max(730).optional() }),
  run: async ({ query, days }, ctx) => {
    const v = await raisesView();
    const cut = new Date(Date.now() - (days ?? 90) * 86_400_000).toISOString().slice(0, 10);
    const q = query?.toLowerCase().trim();
    const rows = v.raises.filter((x) => x.date >= cut && (!q || [x.name, x.category, x.sector, ...x.leads, ...x.others].some((s) => s.toLowerCase().includes(q)))).slice(0, 40);
    const ids = cite(ctx, v.sources);
    return J({ sources: ids, rounds: rows.map((x) => ({ ...x, source: x.source ? ctx.addSource(`${x.name} ${x.round} (${x.date})`, x.source) : ids[0] })), stats_last_90d: v.stats, top_leads_90d: v.investors.slice(0, 8) });
  },
});

export const unlocksTool = def({
  name: "get_token_unlocks",
  description: "Scheduled token unlocks in the next 60 days (DefiLlama): date, tokens unlocking, their value at today's price and their share of circulating supply. Large unlocks relative to circulating supply often weigh on price.",
  schema: z.object({ minUsd: z.number().optional().describe("Only unlocks worth at least this many dollars") }),
  run: async ({ minUsd }, ctx) => {
    const v = await unlocksView();
    return J({ sources: cite(ctx, v.sources), total_usd: v.totalUsd, unlocks: v.unlocks.filter((u) => (u.nextUsd ?? 0) >= (minUsd ?? 0)).slice(0, 40).map((u) => ({ name: u.name, date: u.nextDate, tokens: u.nextTokens, usd: u.nextUsd, share_of_circulating: r(u.nextShare) })) });
  },
});

export const treasuriesTool = def({
  name: "get_crypto_treasuries",
  description: "Public companies' crypto holdings at fair value, from SEC XBRL filings (ASU 2023-08 concepts CryptoAssetFairValue, current and noncurrent): company, ticker, value and the quarter it was reported. Companies that still carry crypto as an impaired intangible are not included.",
  schema: z.object({ limit: z.number().int().min(5).max(100).optional() }),
  run: async ({ limit }, ctx) => {
    const v = await treasuriesView();
    return J({ sources: cite(ctx, v.sources), total_usd: v.total, btc_price: v.btcPrice, companies: v.rows.slice(0, limit ?? 25).map((x) => ({ ticker: x.ticker, name: x.name, fair_value_usd: x.fairValue, as_of: x.asOf, filing: ctx.addSource(`${x.name} crypto assets at fair value, ${x.asOf} (SEC)`, x.url) })) });
  },
});

export const bitcoinTool = def({
  name: "get_bitcoin_network",
  description: "The Bitcoin network now (mempool.space): block height, fee rates (sat/vB), mempool size, hashrate and its 3-month trend, the next difficulty adjustment, mining pools' shares over a week, fees per block, and mining economics: hashprice ($/PH/day) and the power price at which an S21-class machine (17.5 J/TH) breaks even.",
  schema: z.object({}),
  run: async (_input, ctx) => {
    const v = await bitcoinView();
    return J({ sources: cite(ctx, v.sources), height: v.height, fees_sat_vb: v.fees, mempool: v.mempool, hashrate_ehs: r(v.hashrate.currentEhs), hashrate_90d_ago_ehs: r(v.hashrate.series[0]?.ehs), difficulty_adjustment: v.adjustment, pools: v.pools.slice(0, 8), reward: v.reward, price_usd: v.priceUsd, economics: v.economics });
  },
});

export const rwaTool = def({
  name: "get_rwa_tokenization",
  description: "Tokenized real-world assets (DefiLlama RWA categories, CoinGecko RWA tokens): value locked by kind (tokenized treasuries, private credit, commodities, real estate) and the largest protocols, e.g. BlackRock BUIDL, Ondo, Franklin, Maple, Centrifuge.",
  schema: z.object({}),
  run: async (_input, ctx) => {
    const v = await rwaView();
    return J({ sources: cite(ctx, v.sources), total_tvl_usd: v.total, by_kind: v.kinds, protocols: v.rows.slice(0, 25).map((p) => ({ name: p.name, kind: p.kind, tvl: p.tvl, d7: r(p.d7), chains: p.chains.slice(0, 4) })) });
  },
});

export const walletTool = def({
  name: "get_wallet_portfolio",
  description: "Read-only balances for public blockchain addresses (Ethereum and L2 0x addresses, ENS names, Bitcoin, Solana) with dollar values and risk: concentration, stablecoin share, chain exposure, one-year volatility and one-day 95% value at risk at today's weights. Covers native coins and major tokens only. Never asks for or uses keys.",
  schema: z.object({ addresses: z.array(z.string()).min(1).max(6) }),
  run: async ({ addresses }, ctx) => {
    const v = await walletView(addresses.map((address) => ({ address })));
    return J({ sources: cite(ctx, v.sources), wallets: v.wallets, holdings: v.holdings.slice(0, 30).map((h) => ({ symbol: h.symbol, chain: h.chain, quantity: r(h.quantity, 6), usd: r(h.valueUsd) })), risk: { total_usd: v.risk.totalUsd, largest: v.risk.largest, effective_holdings: r(v.risk.effectiveN), stable_share: r(v.risk.stableShare), vol_1y: r(v.risk.vol), var95_1d: r(v.risk.var95), es95_1d: r(v.risk.es95), max_drawdown_1y: r(v.risk.maxDrawdown), chains: v.risk.chains } });
  },
});

export const tokenValuationTool = def({
  name: "token_valuation",
  description: "Exact token valuation math. method 'multiple': annual fees or revenue x a multiple, per circulating and fully diluted token. 'dcf': holders' cash flows for five years with fading growth, a terminal value, discounted, divided by supply at year 5 after dilution. 'staking': nominal and real staking yield and non-staker dilution. Rates as decimals.",
  schema: z.object({
    method: z.enum(["multiple", "dcf", "staking"]),
    annualMetricUsd: z.number().optional(), multiple: z.number().optional(), circulating: z.number().optional(), fullyDiluted: z.number().optional(),
    baseCashflowUsd: z.number().optional(), growthY1: z.number().optional(), growthY5: z.number().optional(), discountRate: z.number().optional(), terminalGrowth: z.number().optional(), supplyGrowth: z.number().optional(), maxSupply: z.number().optional(),
    supply: z.number().optional(), issuanceRate: z.number().optional(), stakingRatio: z.number().optional(), feesToStakersUsd: z.number().optional(), priceUsd: z.number().optional(), burnRate: z.number().optional(),
  }),
  run: async (i) => {
    try {
      if (i.method === "multiple") return J(multipleValue({ annualMetricUsd: i.annualMetricUsd ?? 0, multiple: i.multiple ?? 0, circulating: i.circulating ?? 0, fullyDiluted: i.fullyDiluted }));
      if (i.method === "dcf") return J(tokenDcf({ baseCashflowUsd: i.baseCashflowUsd ?? 0, growthY1: i.growthY1 ?? 0.2, growthY5: i.growthY5 ?? 0.05, discountRate: i.discountRate ?? 0.25, terminalGrowth: i.terminalGrowth ?? 0.03, circulating: i.circulating ?? 0, supplyGrowth: i.supplyGrowth ?? 0, maxSupply: i.maxSupply }));
      return J(stakingYield({ supply: i.supply ?? 0, issuanceRate: i.issuanceRate ?? 0, stakingRatio: i.stakingRatio ?? 0, feesToStakersUsd: i.feesToStakersUsd ?? 0, priceUsd: i.priceUsd ?? 0, burnRate: i.burnRate }));
    } catch (e) {
      return J({ error: e instanceof Error ? e.message : String(e) });
    }
  },
});

export const CRYPTO_TOOLS = [cryptoMarketTool, tokenTool, defiTool, stablecoinsTool, raisesTool, unlocksTool, treasuriesTool, bitcoinTool, rwaTool, walletTool, tokenValuationTool] as unknown as ToolDef<unknown>[];
