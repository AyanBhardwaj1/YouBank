/**
 * Read-only access to the chains, server side. Public endpoints by default, each overridable from the
 * environment (a private or paid node is faster and not rate limited):
 *
 *   ETH_RPC_URL, BASE_RPC_URL, ARBITRUM_RPC_URL, OPTIMISM_RPC_URL, POLYGON_RPC_URL, SOLANA_RPC_URL,
 *   MEMPOOL_API_URL (a self-hosted mempool.space)
 *
 * Nothing here signs anything: the server holds no keys. Transactions are signed in the person's own
 * wallet, in the browser; the server only reads them back to verify.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { ChainKey } from "./chains";

type EvmKey = Exclude<ChainKey, "bitcoin" | "solana">;

const EVM: Record<EvmKey, { env: string; fallback: string; chain: typeof mainnet | typeof base | typeof arbitrum | typeof optimism | typeof polygon }> = {
  ethereum: { env: "ETH_RPC_URL", fallback: "https://ethereum-rpc.publicnode.com", chain: mainnet },
  base: { env: "BASE_RPC_URL", fallback: "https://mainnet.base.org", chain: base },
  arbitrum: { env: "ARBITRUM_RPC_URL", fallback: "https://arb1.arbitrum.io/rpc", chain: arbitrum },
  optimism: { env: "OPTIMISM_RPC_URL", fallback: "https://mainnet.optimism.io", chain: optimism },
  polygon: { env: "POLYGON_RPC_URL", fallback: "https://polygon-rpc.com", chain: polygon },
};

export const rpcUrl = (key: EvmKey) => process.env[EVM[key].env]?.trim() || EVM[key].fallback;
export const solanaRpcUrl = () => process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
export const mempoolUrl = () => (process.env.MEMPOOL_API_URL?.trim() || "https://mempool.space/api").replace(/\/$/, "");

const clients = new Map<EvmKey, PublicClient>();

/** A viem client for an EVM chain (multicall batching on, so many balance reads cost one request). */
export function evmClient(key: EvmKey): PublicClient {
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: EVM[key].chain, transport: http(rpcUrl(key), { timeout: 12_000, retryCount: 1 }), batch: { multicall: true } }) as PublicClient;
    clients.set(key, c);
  }
  return c;
}

export const isEvmKey = (k: ChainKey): k is EvmKey => Object.prototype.hasOwnProperty.call(EVM, k);
