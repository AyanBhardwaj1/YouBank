"use client";

/**
 * Browser wallets, without a wallet SDK. Client only.
 *
 * - EVM (MetaMask, Coinbase Wallet, Rabby…): EIP-6963 discovery (each installed wallet announces
 *   itself, so several can coexist), falling back to the legacy window.ethereum; EIP-1193 requests.
 * - Solana (Phantom, Solflare, Backpack…): the Wallet Standard registry, falling back to Phantom's
 *   legacy window.phantom.solana.
 *
 * What YouBank asks a wallet for: its address (to read balances), and, for notarizing, one
 * zero-value transaction to the person's own address on Base, which the wallet shows them and they
 * approve or decline. Never a signature over anything that could move funds, never a key.
 */
import { BASE_PARAMS } from "@/lib/crypto/chains";
import { notaryCalldata } from "@/lib/crypto/notary";

export type Eip1193 = { request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown> };
export type EvmWallet = { id: string; name: string; icon: string; provider: Eip1193 };

type Announce = CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 }>;

/** The EVM wallets installed in this browser (waits briefly for their announcements). */
export function discoverEvmWallets(waitMs = 350): Promise<EvmWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map<string, EvmWallet>();
    const on = (e: Event) => {
      const d = (e as Announce).detail;
      if (d?.info?.uuid && d.provider) found.set(d.info.rdns || d.info.uuid, { id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", on);
      const legacy = (window as unknown as { ethereum?: Eip1193 & { isMetaMask?: boolean; isCoinbaseWallet?: boolean } }).ethereum;
      if (!found.size && legacy) found.set("legacy", { id: "legacy", name: legacy.isCoinbaseWallet ? "Coinbase Wallet" : legacy.isMetaMask ? "MetaMask" : "Browser wallet", icon: "", provider: legacy });
      resolve([...found.values()]);
    }, waitMs);
  });
}

/** A wallet error as a sentence a person can act on. */
export function walletMessage(e: unknown): string {
  const code = (e as { code?: number })?.code;
  if (code === 4001) return "You declined in your wallet. Nothing was sent.";
  if (code === -32002) return "Your wallet is already waiting for an answer: open it to approve or decline.";
  if (code === 4100) return "Your wallet has not allowed this site yet: approve the connection first.";
  const m = e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? String((e as { message: string }).message) : "";
  if (/insufficient funds/i.test(m)) return "The wallet has no ETH on Base for the fee (a fraction of a cent). Add a little ETH on Base and try again.";
  if (/user (rejected|denied)/i.test(m)) return "You declined in your wallet. Nothing was sent.";
  return "The wallet did not complete that. Try again, or try another wallet.";
}

export async function connectEvm(w: EvmWallet): Promise<string> {
  const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("The wallet shared no account");
  return accounts[0];
}

/** Switch the wallet to Base, adding Base first if the wallet does not know it. */
export async function ensureBase(w: EvmWallet): Promise<void> {
  const current = String(await w.provider.request({ method: "eth_chainId" }).catch(() => "")).toLowerCase();
  if (current === BASE_PARAMS.chainId) return;
  try {
    await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_PARAMS.chainId }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await w.provider.request({ method: "wallet_addEthereumChain", params: [BASE_PARAMS] });
  }
}

/**
 * Ask the wallet to record a hash: a transaction from the person to themselves on Base, value zero,
 * the hash as readable calldata. The wallet shows it and the person decides. Returns the tx hash.
 */
export async function sendNotary(w: EvmWallet, from: string, sha256: string): Promise<string> {
  await ensureBase(w);
  const hash = await w.provider.request({ method: "eth_sendTransaction", params: [{ from, to: from, value: "0x0", data: notaryCalldata(sha256) }] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet returned no transaction");
  return hash;
}

/* ---------------- Solana ---------------- */

type StandardWallet = { name: string; icon: string; chains?: readonly string[]; features: Record<string, unknown> };
export type SolWallet = { id: string; name: string; icon: string; connect: () => Promise<string> };

/** Solana wallets via the Wallet Standard, else Phantom's legacy provider. */
export function discoverSolanaWallets(waitMs = 350): Promise<SolWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map<string, SolWallet>();
    const register = (...ws: StandardWallet[]) => {
      for (const w of ws) {
        if (!w?.chains?.some((c) => c.startsWith("solana:"))) continue;
        const feature = w.features["standard:connect"] as { connect?: () => Promise<{ accounts: { address: string }[] }> } | undefined;
        if (!feature?.connect) continue;
        found.set(w.name, { id: w.name, name: w.name, icon: w.icon, connect: async () => { const r = await feature.connect!(); const a = r.accounts?.[0]?.address; if (!a) throw new Error("The wallet shared no account"); return a; } });
      }
      return () => undefined;
    };
    const onRegister = (e: Event) => { const cb = (e as CustomEvent<(api: { register: typeof register }) => void>).detail; if (typeof cb === "function") cb({ register }); };
    window.addEventListener("wallet-standard:register-wallet", onRegister);
    try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } })); } catch { /* old browsers */ }
    setTimeout(() => {
      window.removeEventListener("wallet-standard:register-wallet", onRegister);
      const phantom = (window as unknown as { phantom?: { solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString(): string } }> } } }).phantom?.solana;
      if (!found.size && phantom?.isPhantom) found.set("Phantom", { id: "Phantom", name: "Phantom", icon: "", connect: async () => (await phantom.connect()).publicKey.toString() });
      resolve([...found.values()]);
    }, waitMs);
  });
}
