"use client";

/**
 * The read-only portfolio: connect a wallet or paste addresses, see holdings, profit and loss and
 * risk; keep a watchlist of other wallets (a fund, a treasury, a whale). Deep analytics (every token,
 * transfers, counterparties) is premium and runs only when asked.
 *
 * Connecting a wallet only shares its address. YouBank never asks it to sign or send anything here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { DataTable, Section } from "@/components/terminal/kit";
import { PortfolioBody, px, usd } from "@/components/terminal/screens/CryptoScreens";
import { addressUrl, shortAddress, type ChainKey } from "@/lib/crypto/chains";
import type { DeepView } from "@/lib/crypto/deep";
import type { WalletView } from "@/lib/crypto/wallet";
import { connectEvm, discoverEvmWallets, discoverSolanaWallets, walletMessage, type EvmWallet, type SolWallet } from "./wallets";

type Saved = { id: number; address: string; kind: string; label: string; role: string; source: string };
type Loaded = { addresses: Saved[]; costs: Record<string, number>; view: WalletView | null };

const EXAMPLES = [
  { address: "vitalik.eth", label: "Vitalik Buterin (public ENS)" },
  { address: "0x00000000219ab540356cBB839Cbe05303d7705Fa", label: "Ethereum staking deposit contract" },
  { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", label: "Bitcoin genesis address" },
];

async function post(body: unknown) {
  const res = await fetch("/api/crypto/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "That did not save. Try again.");
  return j;
}

export function Portfolio({ role }: { role: "own" | "watch" }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [evm, setEvm] = useState<EvmWallet[] | null>(null);
  const [sol, setSol] = useState<SolWallet[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crypto/wallet?role=${role}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not load your wallets");
      setData(j as Loaded); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your wallets"); } finally { setLoading(false); }
  }, [role]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    if (role !== "own") return;
    void discoverEvmWallets().then(setEvm);
    void discoverSolanaWallets().then(setSol);
  }, [role]);

  const add = async (a: string, l: string, source: "pasted" | "connected" = "pasted") => {
    setBusy("add"); setError(null);
    try { await post({ action: "add", address: a, label: l, role, source }); setAddress(""); setLabel(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const connect = async (name: string, get: () => Promise<string>) => {
    setBusy(name); setError(null);
    try { const a = await get(); await add(a, name, "connected"); } catch (e) { setError(walletMessage(e)); } finally { setBusy(null); }
  };
  const remove = async (id: number) => { await post({ action: "remove", id }).catch(() => null); await load(); };

  const mine = (data?.addresses ?? []).filter((a) => a.role === role);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {role === "own" && (
          <div className="ctl border border-line bg-panel p-3">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Icon name="Wallet" className="h-4 w-4 text-accent" /> Connect a wallet</h3>
            <p className="mt-1 text-[11.5px] text-muted">Shares the wallet&apos;s address only, to read its balances. Nothing is signed or sent.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {evm === null && sol === null ? <span className="text-[11px] text-faint">Looking for wallets in this browser…</span> : null}
              {(evm ?? []).map((w) => <WalletButton key={w.id} name={w.name} icon={w.icon} busy={busy === w.name} onClick={() => connect(w.name, () => connectEvm(w))} />)}
              {(sol ?? []).map((w) => <WalletButton key={w.id} name={`${w.name} (Solana)`} icon={w.icon} busy={busy === w.name} onClick={() => connect(w.name, w.connect)} />)}
              {evm?.length === 0 && sol?.length === 0 && <span className="text-[11px] text-muted">No wallet extension found. Paste an address instead, or install MetaMask, Coinbase Wallet or Phantom.</span>}
            </div>
          </div>
        )}
        <div className="ctl border border-line bg-panel p-3">
          <h3 className="text-[12.5px] font-semibold">{role === "own" ? "Or paste an address" : "Watch a wallet"}</h3>
          <p className="mt-1 text-[11.5px] text-muted">Ethereum and L2 (0x…), ENS (name.eth), Bitcoin and Solana addresses. Read-only.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (address.trim()) void add(address, label); }} className="mt-2 flex flex-wrap gap-1.5">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address or name.eth" className="ctl min-w-[220px] flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="ctl w-[150px] border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
            <button type="submit" disabled={busy === "add" || !address.trim()} className="ctl bg-accent px-3 py-1 text-[12px] font-semibold text-bg disabled:opacity-40">{busy === "add" ? "Adding…" : "Add"}</button>
          </form>
          {role === "watch" && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
              <span className="text-faint">Examples:</span>
              {EXAMPLES.map((x) => <button key={x.address} type="button" onClick={() => void add(x.address, x.label)} className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-accent">{x.label}</button>)}
            </div>
          )}
        </div>
      </div>
      {error && <p className="text-[12px] text-neg">{error}</p>}

      {mine.length > 0 && (
        <Section title={role === "own" ? "Your wallets" : "Watched wallets"} right={<button type="button" onClick={() => void load()} className="text-muted hover:text-fg">{loading ? "Refreshing…" : "Refresh"}</button>}>
          <ul className="divide-y divide-line ctl border border-line bg-panel text-[12px]">
            {mine.map((a) => {
              const chain: ChainKey = a.kind === "bitcoin" ? "bitcoin" : a.kind === "solana" ? "solana" : "ethereum";
              const err = data?.view?.wallets.find((w) => w.input === a.address)?.error;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="w-[150px] truncate font-medium">{a.label || "Wallet"}</span>
                  <a href={a.kind === "ens" ? `https://app.ens.domains/${a.address}` : addressUrl(chain, a.address)} target="_blank" rel="noreferrer" className="num text-info hover:underline" title={a.address}>{a.kind === "ens" ? a.address : shortAddress(a.address)}</a>
                  <span className="rounded border border-line px-1 text-[10px] text-muted">{a.kind}</span>
                  {a.source === "connected" && <span className="text-[10px] text-faint">connected</span>}
                  {err && <span className="text-[11px] text-neg">{err}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {a.kind !== "bitcoin" && <DeepButton address={a.address} />}
                    <button type="button" onClick={() => void remove(a.id)} className="text-[11px] text-muted hover:text-neg">Remove</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {loading && !data ? <div className="shimmer h-40 ctl" /> : data?.view ? (
        <div className="@container">
          <PortfolioBody view={data.view} extra={role === "own" ? <Costs view={data.view} costs={data.costs} onSaved={load} /> : undefined} />
        </div>
      ) : mine.length === 0 ? (
        <p className="ctl border border-dashed border-line px-3 py-4 text-[12px] text-muted">{role === "own" ? "Connect a wallet or paste an address to see your holdings, profit and loss, and risk." : "Add wallets to follow: a fund, a DAO treasury, an exchange's cold wallet. Their balances and recent activity show here."}</p>
      ) : null}
    </div>
  );
}

function WalletButton({ name, icon, busy, onClick }: { name: string; icon: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] hover:border-accent/60 disabled:opacity-60">
      {/^data:image\//.test(icon) ? <span aria-hidden className="h-4 w-4 rounded-sm bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${icon}")` }} /> : <Icon name="Wallet" className="h-4 w-4 text-muted" />}
      {busy ? "Waiting for the wallet…" : name}
    </button>
  );
}

/** What the person paid for each asset in total, for profit and loss. */
function Costs({ view, costs, onSaved }: { view: WalletView; costs: Record<string, number>; onSaved: () => void }) {
  const assets = useMemo(() => {
    const by = new Map<string, { asset: string; symbol: string; qty: number; usd: number; price: number | null; stable: boolean }>();
    for (const h of view.holdings) { const e = by.get(h.asset) ?? { asset: h.asset, symbol: h.symbol, qty: 0, usd: 0, price: h.priceUsd, stable: h.stable }; e.qty += h.quantity; e.usd += h.valueUsd; by.set(h.asset, e); }
    return [...by.values()].filter((a) => !a.stable && a.usd > 0).sort((a, b) => b.usd - a.usd);
  }, [view]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!assets.length) return null;
  const save = async () => {
    setSaving(true);
    for (const [asset, v] of Object.entries(draft)) await post({ action: "cost", asset, costUsd: v.trim() ? Number(v.replace(/[$,\s]/g, "")) : null }).catch(() => null);
    setSaving(false); setDraft({}); onSaved();
  };
  return (
    <details className="ctl border border-line bg-panel px-3 py-2 text-[12px]">
      <summary className="cursor-pointer select-none font-semibold">What you paid (for profit and loss)</summary>
      <p className="mt-1 text-[11px] text-muted">YouBank cannot see purchase prices. Enter the total you paid for each asset across these wallets; leave blank to skip.</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => (
          <label key={a.asset} className="flex items-center gap-2">
            <span className="w-[70px] font-medium">{a.symbol}</span>
            <span className="text-[10.5px] text-faint">now {usd(a.usd)} at {px(a.price)}</span>
            <input inputMode="decimal" placeholder={costs[a.asset] ? `$${Math.round(costs[a.asset]).toLocaleString("en-US")}` : "$ total"} value={draft[a.asset] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [a.asset]: e.target.value }))} className="ctl ml-auto w-[110px] border border-line bg-bg px-2 py-0.5 text-right outline-none focus:border-accent/60" />
          </label>
        ))}
      </div>
      <button type="button" disabled={saving || !Object.keys(draft).length} onClick={() => void save()} className="ctl mt-2 border border-line px-2.5 py-1 text-[11.5px] hover:border-accent/60 disabled:opacity-40">{saving ? "Saving…" : "Save costs"}</button>
    </details>
  );
}

/** Premium: every token and the latest transfers for one address, on a click. */
function DeepButton({ address }: { address: string }) {
  const [state, setState] = useState<{ busy: boolean; data?: DeepView; error?: string; open: boolean }>({ busy: false, open: false });
  const run = async () => {
    setState({ busy: true, open: true });
    try {
      const res = await fetch("/api/crypto/deep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Deep analytics did not finish");
      setState({ busy: false, data: j as DeepView, open: true });
    } catch (e) { setState({ busy: false, error: e instanceof Error ? e.message : "Deep analytics did not finish", open: true }); }
  };
  return (
    <>
      <PremiumGate feature="crypto.wallet-deep" fallback={<span className="inline-flex items-center gap-1 text-[10.5px] text-muted">Deep analytics <PremiumBadge feature="crypto.wallet-deep" /></span>}>
        <button type="button" disabled={state.busy} onClick={() => void run()} title="Every token and recent transfers, from paid indexers (part of your plan)" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60">
          {state.busy ? "Running deep analytics…" : "Deep analytics"} <PremiumBadge feature="crypto.wallet-deep" />
        </button>
      </PremiumGate>
      {state.open && (state.error || state.data) && (
        <div className="basis-full">
          {state.error && <p className="text-[11px] text-neg">{state.error}</p>}
          {state.data && <DeepResult d={state.data} onClose={() => setState({ busy: false, open: false })} />}
        </div>
      )}
    </>
  );
}

function DeepResult({ d, onClose }: { d: DeepView; onClose: () => void }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-accent/30 bg-accent-soft/20 p-2">
      <div className="flex items-center justify-between text-[11px]"><span className="font-semibold">Deep analytics: {d.tokens.length} tokens, {d.transfers.length} recent transfers</span><button type="button" onClick={onClose} className="text-muted hover:text-fg">Close</button></div>
      {d.skipped.length > 0 && <p className="text-[10.5px] text-muted">Not covered: {d.skipped.join("; ")}.</p>}
      <DataTable rows={d.tokens} rowKey={(t, i) => `${t.chain}-${t.contract}-${i}`} max={40} empty="No tokens found." columns={[
        { key: "sym", label: "Token", align: "left", value: (t) => t.symbol, render: (t) => <span title={t.name}>{t.symbol}</span> },
        { key: "chain", label: "Chain", align: "left", value: (t) => t.chain },
        { key: "qty", label: "Quantity", value: (t) => t.quantity, render: (t) => t.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 }) },
        { key: "usd", label: "Value", value: (t) => t.valueUsd, render: (t) => usd(t.valueUsd) },
        { key: "c", label: "Contract", align: "left", value: (t) => t.contract, render: (t) => <a href={addressUrl(t.chain, t.contract)} target="_blank" rel="noreferrer" className="num text-info hover:underline">{shortAddress(t.contract)}</a> },
      ]} />
      {d.counterparties.length > 0 && (
        <div className="text-[11px]"><span className="font-semibold">Most frequent counterparties:</span> {d.counterparties.map((c) => `${shortAddress(c.address)} (${c.transfers})`).join(" · ")}</div>
      )}
      <p className="text-[10px] text-faint">Only listed major tokens are priced; others show their quantity. Sources: {d.sources.map((s) => s.name).join(", ")}.</p>
    </div>
  );
}
