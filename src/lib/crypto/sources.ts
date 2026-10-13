/**
 * Where crypto figures come from, named the way every other YouBank screen names its sources. Each
 * view returns the `Cite`s it used, so a screen's "Models and sources" and the assistant's citations
 * point at the same pages. Pure data, safe to import on the client.
 *
 * `SourceInfo` has the same shape as Edge's map sources (src/lib/edge/sources/eia.ts): a stable key,
 * a name a reader would recognise, the endpoint or page, the licence and the vintage.
 */
export type SourceInfo = { key: string; name: string; url: string; license: string; vintage: string };

/** One figure's provenance on a screen: which source, which page, as of when. */
export type Cite = { name: string; url: string; asOf?: string };

export const COINGECKO: SourceInfo = {
  key: "coingecko",
  name: "CoinGecko",
  url: "https://www.coingecko.com/",
  license: "Free public API; attribution requested (\"Data provided by CoinGecko\")",
  vintage: "live, cached a few minutes",
};

export const DEFILLAMA: SourceInfo = {
  key: "defillama",
  name: "DefiLlama",
  url: "https://defillama.com/",
  license: "Free open API; data is open source (attribution appreciated)",
  vintage: "live, cached up to an hour",
};

export const MEMPOOL: SourceInfo = {
  key: "mempool",
  name: "mempool.space",
  url: "https://mempool.space/",
  license: "Free public API (open-source explorer)",
  vintage: "live, cached about a minute",
};

export const SEC_XBRL: SourceInfo = {
  key: "sec-xbrl-frames",
  name: "SEC XBRL frames (crypto assets at fair value, ASU 2023-08)",
  url: "https://www.sec.gov/edgar/sec-api-documentation",
  license: "Public domain (U.S. Government work)",
  vintage: "latest quarter filed",
};

export const PUBLIC_RPC: SourceInfo = {
  key: "public-rpc",
  name: "Public blockchain nodes (JSON-RPC)",
  url: "https://ethereum.org/en/developers/docs/apis/json-rpc/",
  license: "The chain's own public ledger",
  vintage: "latest block",
};

export const ETHERSCAN: SourceInfo = {
  key: "etherscan",
  name: "Etherscan-family explorer APIs",
  url: "https://docs.etherscan.io/",
  license: "Free API key; attribution requested (\"Powered by Etherscan\")",
  vintage: "latest block",
};

export const FILINGS_SITES: SourceInfo = {
  key: "crypto-sites",
  name: "Bitcoin mining and crypto data-centre sites from company filings, with EIA's power estimate",
  url: "https://www.eia.gov/todayinenergy/detail.php?id=61364",
  license: "Company filings and EIA analysis are public; locations are to the town, not the fence line",
  vintage: "filings through mid-2025",
};

/** A link to a token or protocol page, for a cite. */
export const coingeckoCoin = (id: string): Cite => ({ name: "CoinGecko", url: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` });
export const llamaProtocol = (slug: string): Cite => ({ name: "DefiLlama", url: `https://defillama.com/protocol/${encodeURIComponent(slug)}` });
export const llamaPage = (path: string): Cite => ({ name: "DefiLlama", url: `https://defillama.com/${path}` });
