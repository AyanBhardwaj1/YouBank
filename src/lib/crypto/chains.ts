/**
 * The chains YouBank reads, with what each needs: its kind (EVM, Bitcoin, Solana), the explorer for
 * links, the CoinGecko id of its native coin, DefiLlama's name for it, and the major tokens whose
 * balances a read-only portfolio checks without an indexer. Pure data, safe on the client; RPC
 * endpoints (with their environment overrides) live in ./rpc, server side.
 *
 * Token contracts are the canonical, issuer-published addresses. A portfolio only reads balances of
 * these; finding every token a wallet holds needs an indexer (Alchemy, Helius), which is the premium
 * deep analytics.
 */

export type ChainKey = "bitcoin" | "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "solana";
export type ChainKind = "evm" | "bitcoin" | "solana";

export type TokenDef = { symbol: string; name: string; address: string; decimals: number; coingecko: string; stable?: boolean };

export type Chain = {
  key: ChainKey;
  name: string;
  kind: ChainKind;
  /** EIP-155 chain id, for EVM chains. */
  chainId?: number;
  native: { symbol: string; decimals: number; coingecko: string };
  /** Block explorer base, without a trailing slash. */
  explorer: string;
  /** DefiLlama's chain name, for TVL. */
  llama: string;
  tokens: TokenDef[];
};

const T = (symbol: string, name: string, address: string, decimals: number, coingecko: string, stable = false): TokenDef => ({ symbol, name, address, decimals, coingecko, ...(stable ? { stable } : {}) });

export const CHAINS: Record<ChainKey, Chain> = {
  bitcoin: { key: "bitcoin", name: "Bitcoin", kind: "bitcoin", native: { symbol: "BTC", decimals: 8, coingecko: "bitcoin" }, explorer: "https://mempool.space", llama: "Bitcoin", tokens: [] },
  ethereum: {
    key: "ethereum", name: "Ethereum", kind: "evm", chainId: 1, native: { symbol: "ETH", decimals: 18, coingecko: "ethereum" }, explorer: "https://etherscan.io", llama: "Ethereum",
    tokens: [
      T("USDC", "USD Coin", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "usd-coin", true),
      T("USDT", "Tether", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6, "tether", true),
      T("DAI", "Dai", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18, "dai", true),
      T("PYUSD", "PayPal USD", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", 6, "paypal-usd", true),
      T("WETH", "Wrapped Ether", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "ethereum"),
      T("stETH", "Lido staked ETH", "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", 18, "staked-ether"),
      T("WBTC", "Wrapped Bitcoin", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "wrapped-bitcoin"),
      T("cbBTC", "Coinbase Wrapped BTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8, "coinbase-wrapped-btc"),
      T("LINK", "Chainlink", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18, "chainlink"),
      T("UNI", "Uniswap", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18, "uniswap"),
    ],
  },
  base: {
    key: "base", name: "Base", kind: "evm", chainId: 8453, native: { symbol: "ETH", decimals: 18, coingecko: "ethereum" }, explorer: "https://basescan.org", llama: "Base",
    tokens: [
      T("USDC", "USD Coin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "usd-coin", true),
      T("DAI", "Dai", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", 18, "dai", true),
      T("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18, "ethereum"),
      T("cbBTC", "Coinbase Wrapped BTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8, "coinbase-wrapped-btc"),
    ],
  },
  arbitrum: {
    key: "arbitrum", name: "Arbitrum", kind: "evm", chainId: 42161, native: { symbol: "ETH", decimals: 18, coingecko: "ethereum" }, explorer: "https://arbiscan.io", llama: "Arbitrum",
    tokens: [
      T("USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6, "usd-coin", true),
      T("USDT", "Tether", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6, "tether", true),
      T("WETH", "Wrapped Ether", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18, "ethereum"),
      T("ARB", "Arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18, "arbitrum"),
    ],
  },
  optimism: {
    key: "optimism", name: "Optimism", kind: "evm", chainId: 10, native: { symbol: "ETH", decimals: 18, coingecko: "ethereum" }, explorer: "https://optimistic.etherscan.io", llama: "OP Mainnet",
    tokens: [
      T("USDC", "USD Coin", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6, "usd-coin", true),
      T("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18, "ethereum"),
      T("OP", "Optimism", "0x4200000000000000000000000000000000000042", 18, "optimism"),
    ],
  },
  polygon: {
    key: "polygon", name: "Polygon PoS", kind: "evm", chainId: 137, native: { symbol: "POL", decimals: 18, coingecko: "polygon-ecosystem-token" }, explorer: "https://polygonscan.com", llama: "Polygon",
    tokens: [T("USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6, "usd-coin", true)],
  },
  solana: {
    key: "solana", name: "Solana", kind: "solana", native: { symbol: "SOL", decimals: 9, coingecko: "solana" }, explorer: "https://solscan.io", llama: "Solana",
    tokens: [
      T("USDC", "USD Coin", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6, "usd-coin", true),
      T("USDT", "Tether", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6, "tether", true),
      T("JUP", "Jupiter", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", 6, "jupiter-exchange-solana"),
    ],
  },
};

export const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];
export const EVM_CHAINS = CHAIN_KEYS.filter((k) => CHAINS[k].kind === "evm");
export const isChainKey = (v: unknown): v is ChainKey => typeof v === "string" && v in CHAINS;

/** User-signed actions (notarizing) default to Base: cents in fees, Ethereum's security model. */
export const NOTARY_CHAIN: ChainKey = "base";

/** Base's parameters for wallet_addEthereumChain, for wallets that do not know it yet. */
export const BASE_PARAMS = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export const txUrl = (chain: ChainKey, hash: string) => (chain === "bitcoin" ? `${CHAINS.bitcoin.explorer}/tx/${hash}` : `${CHAINS[chain].explorer}/tx/${hash}`);
export const addressUrl = (chain: ChainKey, address: string) => (chain === "solana" ? `${CHAINS.solana.explorer}/account/${address}` : `${CHAINS[chain].explorer}/address/${address}`);
