/**
 * Premium: deep wallet analytics ("crypto.wallet-deep"). Server only, and only from a route that has
 * already called requireFeature, when a person clicks "Run deep analytics".
 *
 * Uses paid indexers, billed by compute units:
 * - Alchemy (ALCHEMY_API_KEY) for EVM chains: every ERC-20 the wallet holds (not just the listed
 *   majors), and its last transfers in and out with counterparties;
 * - Helius (HELIUS_API_KEY) for Solana: every fungible token, priced by Helius where it can.
 * A chain whose key is missing is skipped and named in `skipped`, so the free view still stands.
 */
import { formatUnits, hexToBigInt } from "viem";
import { parseAddress } from "./address";
import { CHAINS, type ChainKey } from "./chains";
import { arr, CryptoDataError, num, postJson, str } from "./http";
import { simplePrices } from "./market";
import type { Cite } from "./sources";
import { resolveEns } from "./wallet";

const ALCHEMY_NET: Partial<Record<ChainKey, string>> = { ethereum: "eth-mainnet", base: "base-mainnet", arbitrum: "arb-mainnet", optimism: "opt-mainnet", polygon: "polygon-mainnet" };

export type DeepToken = { chain: ChainKey; contract: string; symbol: string; name: string; quantity: number; priceUsd: number | null; valueUsd: number | null };
export type DeepTransfer = { chain: ChainKey; hash: string; at: string; direction: "in" | "out"; asset: string; amount: number | null; counterparty: string };
export type DeepView = {
  address: string;
  tokens: DeepToken[];
  transfers: DeepTransfer[];
  counterparties: { address: string; transfers: number; chains: string[] }[];
  /** The oldest transfer among those shown (not necessarily the wallet's first). */
  oldestShown: string | null;
  skipped: string[];
  sources: Cite[];
};

type Rpc<T> = { result?: T; error?: { message?: string } };

async function alchemy<T>(net: string, method: string, params: unknown[]): Promise<T> {
  const key = process.env.ALCHEMY_API_KEY!.trim();
  const r = await postJson<Rpc<T>>(`https://${net}.g.alchemy.com/v2/${key}`, { jsonrpc: "2.0", id: 1, method, params }, { source: "Alchemy", timeoutMs: 20_000 });
  if (!r.result) throw new CryptoDataError("Alchemy did not return this wallet's tokens. Try again in a minute.");
  return r.result;
}

/** Alchemy transfer rows, normalised for one wallet. Pure, for tests. */
export function parseTransfers(raw: unknown, chain: ChainKey, me: string, direction: "in" | "out"): DeepTransfer[] {
  return arr<Record<string, unknown>>((raw as { transfers?: unknown })?.transfers).map((t) => ({
    chain, hash: str(t.hash), at: str((t.metadata as Record<string, unknown> | undefined)?.blockTimestamp), direction, asset: str(t.asset) || "token",
    amount: num(t.value), counterparty: direction === "in" ? str(t.from) : str(t.to),
  })).filter((t) => t.hash && t.counterparty.toLowerCase() !== me.toLowerCase());
}

async function evmDeep(address: string, chain: ChainKey, net: string) {
  const balances = await alchemy<{ tokenBalances?: { contractAddress: string; tokenBalance: string | null }[] }>(net, "alchemy_getTokenBalances", [address, "erc20"]);
  const nonzero = (balances.tokenBalances ?? []).filter((b) => b.tokenBalance && b.tokenBalance !== "0x" && hexToBigInt(b.tokenBalance as `0x${string}`) > BigInt(0)).slice(0, 60);
  const tokens: DeepToken[] = [];
  for (const b of nonzero) {
    const meta = await alchemy<{ decimals?: number | null; symbol?: string | null; name?: string | null }>(net, "alchemy_getTokenMetadata", [b.contractAddress]).catch(() => null);
    if (!meta || meta.decimals === null || meta.decimals === undefined) continue;
    tokens.push({ chain, contract: b.contractAddress, symbol: str(meta.symbol) || "?", name: str(meta.name), quantity: Number(formatUnits(hexToBigInt(b.tokenBalance as `0x${string}`), meta.decimals)), priceUsd: null, valueUsd: null });
  }
  const q = (dir: "toAddress" | "fromAddress") => alchemy<unknown>(net, "alchemy_getAssetTransfers", [{ fromBlock: "0x0", toBlock: "latest", [dir]: address, category: ["external", "erc20"], withMetadata: true, excludeZeroValue: true, maxCount: "0x19", order: "desc" }]).catch(() => ({}));
  const [inc, out] = await Promise.all([q("toAddress"), q("fromAddress")]);
  return { tokens, transfers: [...parseTransfers(inc, chain, address, "in"), ...parseTransfers(out, chain, address, "out")] };
}

async function solanaDeep(address: string): Promise<DeepToken[]> {
  const key = process.env.HELIUS_API_KEY!.trim();
  type Item = { id?: string; interface?: string; content?: { metadata?: { name?: string; symbol?: string } }; token_info?: { balance?: number; decimals?: number; symbol?: string; price_info?: { price_per_token?: number; total_price?: number } } };
  const r = await postJson<Rpc<{ items?: Item[] }>>(`https://mainnet.helius-rpc.com/?api-key=${key}`, { jsonrpc: "2.0", id: 1, method: "getAssetsByOwner", params: { ownerAddress: address, page: 1, limit: 100, displayOptions: { showFungible: true } } }, { source: "Helius", timeoutMs: 20_000 });
  return (r.result?.items ?? []).filter((i) => i.token_info?.balance && i.token_info.decimals !== undefined).map((i) => {
    const ti = i.token_info!;
    const qty = (ti.balance ?? 0) / 10 ** (ti.decimals ?? 0);
    return { chain: "solana" as const, contract: str(i.id), symbol: str(ti.symbol) || str(i.content?.metadata?.symbol) || "?", name: str(i.content?.metadata?.name), quantity: qty, priceUsd: num(ti.price_info?.price_per_token), valueUsd: num(ti.price_info?.total_price) };
  });
}

/** Every token and the latest transfers for one address. */
export async function deepWallet(raw: string): Promise<DeepView> {
  const p = parseAddress(raw);
  if (!p.kind || p.kind === "bitcoin") throw new CryptoDataError(p.kind === "bitcoin" ? "Deep analytics covers EVM chains and Solana; Bitcoin balances and history are already in the free view." : p.kind === null ? p.error : "Unsupported address", 400);
  const skipped: string[] = [];
  const tokens: DeepToken[] = [];
  const transfers: DeepTransfer[] = [];
  const sources: Cite[] = [];
  let address = p.address;
  if (p.kind === "ens") address = await resolveEns(p.address);
  if (p.kind === "evm" || p.kind === "ens") {
    if (!process.env.ALCHEMY_API_KEY?.trim()) skipped.push("EVM chains (ALCHEMY_API_KEY is not set)");
    else {
      for (const [chain, net] of Object.entries(ALCHEMY_NET) as [ChainKey, string][]) {
        const r = await evmDeep(address, chain, net).catch(() => null);
        if (!r) { skipped.push(CHAINS[chain].name); continue; }
        tokens.push(...r.tokens); transfers.push(...r.transfers);
      }
      sources.push({ name: "Alchemy (token balances and transfers)", url: "https://www.alchemy.com/", asOf: new Date().toISOString() });
    }
  } else if (p.kind === "solana") {
    if (!process.env.HELIUS_API_KEY?.trim()) skipped.push("Solana (HELIUS_API_KEY is not set)");
    else { tokens.push(...await solanaDeep(address)); sources.push({ name: "Helius (Solana assets)", url: "https://www.helius.dev/", asOf: new Date().toISOString() }); }
  }
  // Price what CoinGecko knows by contract-less symbol match is unreliable, so only the listed majors get a price here.
  const known = new Map<string, string>();
  for (const c of Object.values(CHAINS)) for (const t of c.tokens) known.set(`${c.key}:${t.address.toLowerCase()}`, t.coingecko);
  const ids = tokens.map((t) => known.get(`${t.chain}:${t.contract.toLowerCase()}`)).filter((x): x is string => !!x);
  const px = await simplePrices(ids).catch(() => ({} as Record<string, { usd: number }>));
  for (const t of tokens) {
    const id = known.get(`${t.chain}:${t.contract.toLowerCase()}`);
    if (id && px[id] && t.priceUsd === null) { t.priceUsd = px[id].usd; t.valueUsd = t.quantity * px[id].usd; }
  }
  const counts = new Map<string, { address: string; transfers: number; chains: Set<string> }>();
  for (const t of transfers) {
    const k = t.counterparty.toLowerCase();
    const e = counts.get(k) ?? { address: t.counterparty, transfers: 0, chains: new Set<string>() };
    e.transfers++; e.chains.add(CHAINS[t.chain].name); counts.set(k, e);
  }
  const dates = transfers.map((t) => t.at).filter(Boolean).sort();
  return {
    address, tokens: tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)), transfers: transfers.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60),
    counterparties: [...counts.values()].map((c) => ({ address: c.address, transfers: c.transfers, chains: [...c.chains] })).sort((a, b) => b.transfers - a.transfers).slice(0, 10),
    oldestShown: dates[0] ?? null, skipped, sources,
  };
}

/** Whether any deep source is configured (the panel says so instead of offering a button that cannot work). */
export const deepConfigured = () => !!(process.env.ALCHEMY_API_KEY?.trim() || process.env.HELIUS_API_KEY?.trim());
