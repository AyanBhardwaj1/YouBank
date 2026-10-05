/**
 * A read-only portfolio: the balances behind a set of addresses, priced, with risk. Server only.
 *
 * Free sources only, and only reads:
 * - EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon): the native coin plus the major tokens
 *   listed in ./chains, read from public nodes in one multicall per chain;
 * - Bitcoin: confirmed and pending balance from mempool.space;
 * - Solana: SOL and the listed SPL tokens from the public RPC.
 * Finding every token a wallet holds needs an indexer; that is the premium deep analytics (./deep).
 * Recent activity comes from mempool.space for Bitcoin and, when ETHERSCAN_API_KEY is set (a free
 * key), from Etherscan's multichain API for Ethereum and Base.
 */
import { erc20Abi, formatUnits, getAddress } from "viem";
import { cacheJson } from "@/lib/cache";
import { normalize } from "viem/ens";
import { parseAddress } from "./address";
import { CHAINS, EVM_CHAINS, type ChainKey } from "./chains";
import { arr, cachedJson, CryptoDataError, fetchJson, MIN, num, postJson, str } from "./http";
import { simplePrices, tokenHistory } from "./market";
import { evmClient, isEvmKey, mempoolUrl, solanaRpcUrl } from "./rpc";
import { portfolioRisk, type Holding, type RiskView, type Series } from "./risk";
import { ETHERSCAN, MEMPOOL, PUBLIC_RPC, type Cite } from "./sources";

export type WalletInput = { address: string; label?: string };
export type Balance = { chain: ChainKey; symbol: string; name: string; asset: string; quantity: number; stable: boolean };
export type Activity = { chain: ChainKey; hash: string; at: string; direction: "in" | "out" | "self"; amount: number | null; symbol: string; counterparty: string };

/** ENS name to address, on Ethereum. */
export async function resolveEns(name: string): Promise<string> {
  const addr = await cacheJson(`crypto:ens:${name}`, 60 * MIN, async () => (await evmClient("ethereum").getEnsAddress({ name: normalize(name) })) ?? "").catch(() => "");
  if (!addr) throw new CryptoDataError(`${name} does not resolve to an address.`, 404);
  return getAddress(addr);
}

async function evmBalances(address: `0x${string}`): Promise<Balance[]> {
  const out: Balance[] = [];
  await Promise.all(EVM_CHAINS.map(async (key) => {
    if (!isEvmKey(key)) return;
    const c = CHAINS[key], client = evmClient(key);
    const [native, tokens] = await Promise.all([
      client.getBalance({ address }).catch(() => null),
      client.multicall({ contracts: c.tokens.map((t) => ({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf" as const, args: [address] as const })), allowFailure: true }).catch(() => []),
    ]);
    if (native && native > BigInt(0)) out.push({ chain: key, symbol: c.native.symbol, name: `${c.native.symbol} on ${c.name}`, asset: c.native.coingecko, quantity: Number(formatUnits(native, c.native.decimals)), stable: false });
    tokens.forEach((r, i) => {
      const t = c.tokens[i];
      if (r && r.status === "success" && typeof r.result === "bigint" && r.result > BigInt(0)) out.push({ chain: key, symbol: t.symbol, name: t.name, asset: t.coingecko, quantity: Number(formatUnits(r.result, t.decimals)), stable: !!t.stable });
    });
  }));
  return out;
}

async function btcBalance(address: string): Promise<Balance[]> {
  const r = await fetchJson<{ chain_stats?: Record<string, unknown>; mempool_stats?: Record<string, unknown> }>(`${mempoolUrl()}/address/${address}`, { source: "mempool.space" });
  const sats = (s?: Record<string, unknown>) => (num(s?.funded_txo_sum) ?? 0) - (num(s?.spent_txo_sum) ?? 0);
  const total = sats(r.chain_stats) + sats(r.mempool_stats);
  return total > 0 ? [{ chain: "bitcoin", symbol: "BTC", name: "Bitcoin", asset: "bitcoin", quantity: total / 1e8, stable: false }] : [];
}

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function solBalances(address: string): Promise<{ balances: Balance[]; unpriced: number }> {
  const url = solanaRpcUrl();
  const [bal, toks] = await Promise.all([
    postJson<{ result?: { value?: number } }>(url, { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }, { source: "the Solana network" }),
    postJson<{ result?: { value?: { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }[] } }>(url, { jsonrpc: "2.0", id: 2, method: "getTokenAccountsByOwner", params: [address, { programId: SPL_TOKEN }, { encoding: "jsonParsed" }] }, { source: "the Solana network" }).catch(() => ({ result: { value: [] } })),
  ]);
  const out: Balance[] = [];
  const lamports = num(bal.result?.value) ?? 0;
  if (lamports > 0) out.push({ chain: "solana", symbol: "SOL", name: "Solana", asset: "solana", quantity: lamports / 1e9, stable: false });
  let unpriced = 0;
  for (const a of toks.result?.value ?? []) {
    const info = a.account?.data?.parsed?.info;
    const qty = num(info?.tokenAmount?.uiAmount) ?? 0;
    if (qty <= 0) continue;
    const t = CHAINS.solana.tokens.find((x) => x.address === info?.mint);
    if (t) out.push({ chain: "solana", symbol: t.symbol, name: t.name, asset: t.coingecko, quantity: qty, stable: !!t.stable });
    else unpriced++;
  }
  return { balances: out, unpriced };
}

export type WalletView = {
  wallets: { input: string; address: string; kind: string; label: string; error?: string }[];
  holdings: Holding[];
  risk: RiskView;
  unpricedTokens: number;
  activity: Activity[];
  sources: Cite[];
  asOf: string;
};

/** Balances of one address on every chain it can live on, cached two minutes. */
async function balancesOf(kind: string, address: string): Promise<{ balances: Balance[]; unpriced: number }> {
  return cacheJson(`crypto:wallet:v1:${address.toLowerCase()}`, 2 * MIN, async () => {
    if (kind === "evm") return { balances: await evmBalances(address as `0x${string}`), unpriced: 0 };
    if (kind === "bitcoin") return { balances: await btcBalance(address), unpriced: 0 };
    return solBalances(address);
  });
}

/** The portfolio across wallets: holdings, prices, risk and recent activity. `costs` are what the person says they paid, by asset. */
export async function walletView(inputs: WalletInput[], costs: Record<string, number> = {}): Promise<WalletView> {
  const wallets: WalletView["wallets"] = [];
  const all: Balance[] = [];
  let unpriced = 0;
  const activity: Activity[] = [];
  for (const w of inputs.slice(0, 12)) {
    const p = parseAddress(w.address);
    if (!p.kind) { wallets.push({ input: w.address, address: "", kind: "", label: w.label ?? "", error: p.error }); continue; }
    try {
      const address = p.kind === "ens" ? await resolveEns(p.address) : p.address;
      const kind = p.kind === "ens" ? "evm" : p.kind;
      const b = await balancesOf(kind, address);
      all.push(...b.balances); unpriced += b.unpriced;
      wallets.push({ input: w.address, address, kind, label: w.label ?? "" });
      activity.push(...(await recentActivity(kind, address).catch(() => [])));
    } catch (e) {
      wallets.push({ input: w.address, address: p.address, kind: p.kind, label: w.label ?? "", error: e instanceof CryptoDataError ? e.message : "Could not read this address just now" });
    }
  }
  const prices = await simplePrices(all.map((b) => b.asset)).catch(() => ({} as Record<string, { usd: number; d1: number | null }>));
  // Costs are per asset (what the person paid for all of it); split across chains by quantity.
  const qtyByAsset = new Map<string, number>();
  for (const b of all) qtyByAsset.set(b.asset, (qtyByAsset.get(b.asset) ?? 0) + b.quantity);
  const holdings: Holding[] = all.map((b) => {
    const px = prices[b.asset]?.usd ?? (b.stable ? 1 : null);
    const cost = costs[b.asset];
    return { asset: b.asset, symbol: b.symbol, chain: b.chain, quantity: b.quantity, priceUsd: px, valueUsd: px !== null ? b.quantity * px : 0, stable: b.stable, costUsd: typeof cost === "number" && cost > 0 ? (cost * b.quantity) / (qtyByAsset.get(b.asset) || 1) : null };
  }).sort((a, b) => b.valueUsd - a.valueUsd);

  // A year of history for the largest non-stable assets (each cached six hours), for volatility and VaR.
  const risky = [...new Set(holdings.filter((h) => !h.stable && h.valueUsd > 0).map((h) => h.asset))].slice(0, 6);
  const series: Record<string, Series> = {};
  for (const id of risky) { const s = await tokenHistory(id).catch(() => null); if (s?.length) series[id] = s; }
  const asOf = new Date().toISOString();
  return {
    wallets, holdings, risk: portfolioRisk(holdings, series), unpricedTokens: unpriced,
    activity: activity.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25),
    sources: [
      { name: PUBLIC_RPC.name, url: PUBLIC_RPC.url, asOf },
      ...(wallets.some((w) => w.kind === "bitcoin") ? [{ name: MEMPOOL.name, url: MEMPOOL.url, asOf }] : []),
      { name: "CoinGecko prices", url: "https://www.coingecko.com/", asOf },
      ...(process.env.ETHERSCAN_API_KEY && activity.some((a) => a.chain !== "bitcoin") ? [{ name: ETHERSCAN.name, url: "https://etherscan.io/", asOf }] : []),
    ],
    asOf,
  };
}

/* ---------------- Recent activity ---------------- */

/** The last transactions touching a Bitcoin address, with the net change for it. Pure, for tests. */
export function parseBtcTxs(raw: unknown, address: string): Activity[] {
  return arr<Record<string, unknown>>(raw).slice(0, 10).map((tx) => {
    const vin = arr<Record<string, unknown>>(tx.vin), vout = arr<Record<string, unknown>>(tx.vout);
    const spent = vin.reduce((s, i) => s + (str((i.prevout as Record<string, unknown> | undefined)?.scriptpubkey_address) === address ? num((i.prevout as Record<string, unknown>).value) ?? 0 : 0), 0);
    const got = vout.reduce((s, o) => s + (str(o.scriptpubkey_address) === address ? num(o.value) ?? 0 : 0), 0);
    const net = got - spent;
    const other = net >= 0 ? str((vin[0]?.prevout as Record<string, unknown> | undefined)?.scriptpubkey_address) : str(vout.find((o) => str(o.scriptpubkey_address) !== address)?.scriptpubkey_address);
    const t = num((tx.status as Record<string, unknown> | undefined)?.block_time);
    return { chain: "bitcoin" as const, hash: str(tx.txid), at: t ? new Date(t * 1000).toISOString() : new Date().toISOString(), direction: net > 0 ? "in" as const : net < 0 ? "out" as const : "self" as const, amount: Math.abs(net) / 1e8, symbol: "BTC", counterparty: other };
  });
}

/** Etherscan v2 txlist rows (native transfers). Pure, for tests. */
export function parseEtherscanTxs(raw: unknown, address: string, chain: ChainKey): Activity[] {
  const me = address.toLowerCase();
  return arr<Record<string, unknown>>((raw as { result?: unknown })?.result).slice(0, 10).map((tx) => {
    const from = str(tx.from).toLowerCase(), to = str(tx.to).toLowerCase();
    const t = num(tx.timeStamp);
    return { chain, hash: str(tx.hash), at: t ? new Date(t * 1000).toISOString() : "", direction: from === me && to === me ? "self" as const : from === me ? "out" as const : "in" as const, amount: (num(tx.value) ?? 0) / 1e18, symbol: CHAINS[chain].native.symbol, counterparty: from === me ? str(tx.to) : str(tx.from) };
  }).filter((a) => a.hash);
}

async function recentActivity(kind: string, address: string): Promise<Activity[]> {
  if (kind === "bitcoin") return cachedJson(`${mempoolUrl()}/address/${address}/txs`, { key: `crypto:btctxs:${address}`, ttlMs: 2 * MIN, source: "mempool.space" }, (raw: unknown) => parseBtcTxs(raw, address));
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (kind !== "evm" || !key) return [];
  const out: Activity[] = [];
  for (const chain of ["ethereum", "base"] as const) {
    const id = CHAINS[chain].chainId;
    const rows = await cachedJson(`https://api.etherscan.io/v2/api?chainid=${id}&module=account&action=txlist&address=${address}&page=1&offset=10&sort=desc&apikey=${key}`,
      { key: `crypto:etherscan:${id}:${address.toLowerCase()}`, ttlMs: 2 * MIN, source: "Etherscan" }, (raw: unknown) => parseEtherscanTxs(raw, address, chain)).catch(() => []);
    out.push(...rows);
  }
  return out;
}
