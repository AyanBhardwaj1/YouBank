"use client";

/**
 * Crypto in the terminal: CRYP (the market), TOKEN (one token in depth), DEFI (value locked, fees and
 * revenue), STBL (stablecoins and their flows), YLD (yields), BTCN (the Bitcoin network and mining
 * economics), RAISE (venture rounds), UNLK (token unlocks), TRSY (companies' crypto holdings from SEC
 * filings), RWA (tokenized real-world assets) and WALLET (a read-only look at any public address).
 * The Crypto page shows the same screens in tabs.
 *
 * Everything here runs on free sources. Two things are premium and start only on a click: "Pro data"
 * (CoinGecko Pro, DefiLlama Pro) on TOKEN, RAISE and UNLK, and deep wallet analytics.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Command } from "@/lib/functions";
import type { Cite } from "@/lib/crypto/sources";
import type { BitcoinView } from "@/lib/crypto/bitcoin";
import type { Raise, TreasuryRow, Unlock } from "@/lib/crypto/deals";
import type { Cashflow, ChainTvl, Pool, Protocol, RwaKind, RwaRow, Stablecoin } from "@/lib/crypto/defi";
import type { GlobalStats, TokenRow } from "@/lib/crypto/market";
import type { TokenView } from "@/lib/crypto/token";
import type { WalletView } from "@/lib/crypto/wallet";
import { addressUrl, shortAddress, txUrl, type ChainKey } from "@/lib/crypto/chains";
import { Sparkline } from "@/components/charts/Sparkline";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { AiRead, AskAi, BarList, DataTable, fdate, fp, Frame, fsp, fx, Heat, Hint, Pill, Section, SeriesChart, Tile, Tiles, tone, useTerminal, Why, type Column } from "../kit";

type Props = { onRun?: (c: Command) => void; arg?: string };

/* ---------------- Formatting ---------------- */

const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
/** Dollars, compact: $1.23T, $45.6B, $789M, $12.3K. */
export const usd = (v: number | null | undefined) => (!ok(v) ? "—" : `${v < 0 ? "-" : ""}$${big(Math.abs(v))}`);
const big = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
/** A token price: cents for most, more digits for sub-dollar tokens. */
export const px = (v: number | null | undefined) => (!ok(v) ? "—" : v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toPrecision(3)}`);
const qty = (v: number | null | undefined) => (!ok(v) ? "—" : v >= 1e6 ? big(v) : v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 4 }));
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** "Sources" for Why, from a view's cites. */
const named = (cs: Cite[] | undefined) => (cs ?? []).map((c) => `${c.name}${c.asOf ? ` (${c.asOf.slice(0, 16).replace("T", " ")} UTC)` : ""}`);

function CiteLinks({ sources }: { sources: Cite[] }) {
  return <div className="flex flex-wrap gap-x-2 text-[10.5px] text-faint">{sources.map((s) => <a key={s.url + s.name} href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{s.name} ↗</a>)}</div>;
}

/* ---------------- Pro data (premium, on click) ---------------- */

/**
 * "Pro data": recompute this screen from the paid feeds. Shown to everyone with its plan badge; the
 * server checks the plan before calling anything paid.
 */
function ProData<T>({ fn: key, q, onData }: { fn: string; q?: string; onData: (d: T) => void }) {
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try {
      const res = await fetch("/api/crypto/pro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn: key, q }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Pro data is not available right now");
      onData(j as T);
      setState({ busy: false, done: true });
    } catch (e) { setState({ busy: false, error: e instanceof Error ? e.message : "Pro data is not available right now" }); }
  };
  const locked = <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted">Pro data <PremiumBadge feature="crypto.pro-data" /></span>;
  return (
    <PremiumGate feature="crypto.pro-data" fallback={locked}>
      <span className="inline-flex items-center gap-1.5">
        <button type="button" disabled={state.busy || state.done} onClick={run} title="Recompute from CoinGecko Pro and DefiLlama Pro (part of your plan; it calls a paid API)"
          className="ctl inline-flex items-center gap-1 border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-accent/50 hover:text-accent disabled:opacity-60">
          {state.busy ? "Loading Pro data…" : state.done ? "Showing Pro data" : "Pro data"}
        </button>
        <PremiumBadge feature="crypto.pro-data" />
        {state.error && <span className="text-[10.5px] text-neg">{state.error}</span>}
      </span>
    </PremiumGate>
  );
}

/** A 14px token logo from CoinGecko's CDN (too small to be worth Next's image pipeline). */
function Logo({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-3.5 w-3.5 rounded-full" />;
}

/* ---------------- CRYP ---------------- */

type MarketsData = { global: GlobalStats | null; tokens: TokenRow[]; defiTvl: number | null; defiTvl30: number | null; stablecoinSupply: number | null; stablecoin30: number | null; sources: Cite[] };

export function tokenColumns(): Column<TokenRow>[] {
  return [
    { key: "rank", label: "#", value: (r) => r.rank, render: (r) => <span className="text-faint">{r.rank ?? "—"}</span> },
    { key: "name", label: "Token", align: "left", value: (r) => r.name, render: (r) => <span className="inline-flex items-center gap-1.5">{r.image && <Logo src={r.image} />}<span className="text-fg">{r.name}</span> <span className="num text-[10px] text-faint">{r.symbol}</span></span> },
    { key: "price", label: "Price", value: (r) => r.price, render: (r) => px(r.price) },
    { key: "d1", label: "1D", value: (r) => r.d1, render: (r) => <Heat v={r.d1} scale={0.05} /> },
    { key: "d7", label: "7D", value: (r) => r.d7, render: (r) => <Heat v={r.d7} scale={0.1} /> },
    { key: "d30", label: "30D", value: (r) => r.d30, render: (r) => <Heat v={r.d30} scale={0.2} /> },
    { key: "y1", label: "1Y", value: (r) => r.y1, render: (r) => <Heat v={r.y1} scale={0.6} /> },
    { key: "mcap", label: "Market cap", value: (r) => r.marketCap, render: (r) => usd(r.marketCap) },
    { key: "fdv", label: "FDV", title: "Fully diluted value: price times maximum (or total) supply", value: (r) => r.fdv, render: (r) => usd(r.fdv) },
    { key: "float", label: "Float", title: "Market cap as a share of FDV: how much of the supply trades today", value: (r) => (ok(r.marketCap) && ok(r.fdv) && r.fdv > 0 ? r.marketCap / r.fdv : null), render: (r) => (ok(r.marketCap) && ok(r.fdv) && r.fdv > 0 ? fp(r.marketCap / r.fdv, 0) : "—") },
    { key: "vol", label: "Volume 24h", value: (r) => r.volume24h, render: (r) => usd(r.volume24h) },
    { key: "spark", label: "7 days", sortable: false, value: () => null, render: (r) => <Sparkline values={r.spark} width={70} height={18} stroke={(r.d7 ?? 0) >= 0 ? "var(--pos)" : "var(--neg)"} /> },
  ];
}

export function CrypScreen({ onRun }: Props) {
  const q = useTerminal<MarketsData>("crypto");
  return (
    <Frame q={q} what="the crypto market">
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Crypto market cap" value={usd(d.global?.totalMarketCap)} sub={d.global?.change24h !== null && d.global?.change24h !== undefined ? `${fsp(d.global.change24h)} today` : undefined} subTone={tone(d.global?.change24h)} />
            <Tile label="Bitcoin dominance" value={fp(d.global?.btcDominance)} sub={`Ether ${fp(d.global?.ethDominance)}`} />
            <Tile label="Volume, 24 hours" value={usd(d.global?.totalVolume)} />
            <Tile label="DeFi value locked" value={usd(d.defiTvl)} sub={ok(d.defiTvl30) ? `${fsp(d.defiTvl30)} in 30 days` : undefined} subTone={tone(d.defiTvl30)} />
            <Tile label="Stablecoin supply" value={usd(d.stablecoinSupply)} sub={ok(d.stablecoin30) ? `${fsp(d.stablecoin30)} in 30 days` : undefined} subTone={tone(d.stablecoin30)} />
            <Tile label="Tokens tracked" value={d.global?.coins ? d.global.coins.toLocaleString("en-US") : "—"} sub="by CoinGecko" />
          </Tiles>
          <div className="flex flex-wrap justify-end gap-1.5"><AiRead fn="crypto" params={{}} /><AskAi onRun={onRun} ticker="" question="What is driving the crypto market this week? Use get_crypto_market and get_stablecoins, and cite the figures." /></div>
          <Hint skill="CRYP">The largest tokens by market cap. <b>Float</b> is market cap over fully diluted value: a low float means much of the supply has yet to unlock, which weighs on price as it does. Stablecoin supply rising is new dollars arriving on chain. Click a row for the token&apos;s page.</Hint>
          <DataTable rows={d.tokens} rowKey={(r) => r.id} columns={tokenColumns()} onRow={(r) => onRun?.({ ticker: "", fn: "TOKEN", arg: r.id, via: "click" })} />
          <Why items={[["Market cap and FDV", "Market cap is price times circulating supply; FDV uses the maximum supply (or total where there is no cap). Both from CoinGecko."], ["Changes", "Percent changes in US dollars over the period, from CoinGecko's daily prices."]]} sources={[...named(d.sources), "Data provided by CoinGecko"]} />
        </div>
      )}
    </Frame>
  );
}

/* ---------------- TOKEN ---------------- */

export function TokenScreen({ onRun, arg }: Props) {
  const q0 = (arg ?? "").trim();
  if (!q0) return <TokenPicker onRun={onRun} />;
  return <TokenBody key={q0} q0={q0} onRun={onRun} />;
}

function TokenPicker({ onRun }: Props) {
  const q = useTerminal<MarketsData>("crypto");
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) onRun?.({ ticker: "", fn: "TOKEN", arg: text.trim(), via: "typed" }); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="A token: ETH, solana, AAVE…" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
        <button type="submit" className="ctl border border-line px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-accent">Open</button>
      </form>
      <div className="flex flex-wrap gap-1.5">{(q.data?.tokens ?? []).slice(0, 24).map((t) => <button key={t.id} type="button" onClick={() => onRun?.({ ticker: "", fn: "TOKEN", arg: t.id, via: "click" })} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-accent">{t.symbol}</button>)}</div>
    </div>
  );
}

function TokenBody({ q0, onRun }: { q0: string; onRun?: (c: Command) => void }) {
  const q = useTerminal<TokenView>("token", { q: q0 });
  const [pro, setPro] = useState<TokenView | null>(null);
  return (
    <Frame q={pro ? { ...q, data: pro } : q} what={`the token ${q0.toUpperCase()}`}>
      {(d) => {
        const i = d.info, s = d.stats, m = d.multiples;
        const supplyBase = i.max ?? i.total;
        return (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><span className="text-[15px] font-semibold">{i.name}</span> <span className="num text-muted">{i.symbol}</span> {i.categories.slice(0, 3).map((c) => <Pill key={c}>{c}</Pill>)}</div>
              <div className="flex flex-wrap items-center gap-1.5"><ProData<TokenView> fn="token" q={q0} onData={setPro} /><AiRead fn="token" params={{ q: q0 }} /><AskAi onRun={onRun} ticker="" question={`Value ${i.name} (${i.symbol}) on its fees and revenue against its peers. Use get_token and get_defi_overview, show the multiples with token_valuation, and cite every figure.`} /></div>
            </div>
            <Tiles>
              <Tile label="Price" value={px(i.price)} sub={`${fsp(i.d1)} today`} subTone={tone(i.d1)} />
              <Tile label="Market cap" value={usd(i.marketCap)} sub={`FDV ${usd(i.fdv)}`} />
              <Tile label="Circulating" value={qty(i.circulating)} sub={ok(i.circulating) && ok(supplyBase) && supplyBase > 0 ? `${fp(i.circulating / supplyBase, 0)} of ${i.max ? "max" : "total"} supply` : "no supply cap"} />
              <Tile label="Volatility, 1 year" value={fp(s.vol365, 0)} sub={`90 days ${fp(s.vol90, 0)}`} />
              <Tile label="Worst drawdown, 1 year" value={fp(s.maxDrawdown, 0)} subTone="text-neg" sub={`from ATH ${ok(i.ath) && ok(i.price) ? fsp(i.price / i.ath - 1, 0) : "—"}`} />
              <Tile label="Beta to bitcoin" value={ok(s.betaBtc90) ? s.betaBtc90.toFixed(2) : "—"} sub={ok(s.corrBtc90) ? `correlation ${s.corrBtc90.toFixed(2)}, 90 days` : "90 days"} />
            </Tiles>
            <Hint skill="TOKEN">A token is valued like an early-stage company with a public price: what its network earns (fees), what the protocol keeps (revenue), and what reaches holders. Multiples annualise the last 30 days. A big gap between market cap and FDV means future unlocks; check the next one below.</Hint>
            {d.history.length > 2 && (
              <Section title="Price, one year">
                <SeriesChart x={d.history.map((h) => h.date)} lines={[{ name: i.symbol, values: d.history.map((h) => h.close), color: "var(--chart-1)" }]} format={(v) => px(v)} height={190} xLabel={(x) => fdate(x, true)} />
              </Section>
            )}
            <div className="grid gap-4 @4xl:grid-cols-2">
              <Section title={d.protocol ? `Protocol: ${d.protocol.name}` : "Protocol"}>
                {d.protocol ? (
                  <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                    <Tile label="Value locked" value={usd(d.protocol.tvl)} sub={d.protocol.category} />
                    <Tile label="Fees, 30 days" value={usd(d.cash?.fees30d)} sub={`1 year ${usd(d.cash?.fees1y)}`} />
                    <Tile label="Revenue, 30 days" value={usd(d.cash?.revenue30d)} sub={`1 year ${usd(d.cash?.revenue1y)}`} />
                    <Tile label="To holders, 30 days" value={usd(d.cash?.holdersRevenue30d)} sub="buybacks, burns, staking" />
                  </div>
                ) : <p className="text-[11.5px] text-muted">No DeFi protocol on DefiLlama carries this token, so there are no fees or revenue to value it on. Layer 1 coins are valued on their network&apos;s fees instead (see DEFI).</p>}
              </Section>
              <Section title="Valuation multiples (annualised)">
                <DataTable rows={[
                  { k: "Market cap / fees", v: m.mcapToFees }, { k: "FDV / fees", v: m.fdvToFees }, { k: "Market cap / revenue", v: m.mcapToRevenue }, { k: "FDV / revenue", v: m.fdvToRevenue },
                  { k: "Market cap / holders' revenue", v: m.mcapToHoldersRevenue }, { k: "Market cap / value locked", v: m.mcapToTvl },
                ]} rowKey={(r) => r.k} columns={[{ key: "k", label: "Multiple", align: "left", value: (r) => r.k }, { key: "v", label: "", value: (r) => r.v, render: (r) => fx(r.v, 1) }]} />
              </Section>
            </div>
            {d.unlock && (
              <Section title="Next unlock">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
                  <span className="num font-semibold">{d.unlock.nextDate}</span>
                  <span>{qty(d.unlock.nextTokens)} {i.symbol}, about {usd(d.unlock.nextUsd)}</span>
                  <span className={ok(d.unlock.nextShare) && d.unlock.nextShare > 0.02 ? "font-semibold text-chart-emphasis" : "text-muted"}>{fp(d.unlock.nextShare, 1)} of circulating supply</span>
                </div>
              </Section>
            )}
            {i.description && <Section title="About"><p className="text-[11.5px] leading-relaxed text-fg/85">{i.description.slice(0, 700)}{i.description.length > 700 ? "…" : ""}</p>{i.homepage && <a href={i.homepage} target="_blank" rel="noreferrer" className="text-[11px] text-info hover:underline">{host(i.homepage)} ↗</a>}</Section>}
            {Object.keys(i.platforms).length > 0 && (
              <Section title="Contracts">
                <div className="flex flex-wrap gap-1.5 text-[10.5px]">{Object.entries(i.platforms).slice(0, 8).map(([k, v]) => <span key={k} className="rounded border border-line px-1.5 py-0.5"><span className="text-muted">{k}</span> <span className="num">{shortAddress(v)}</span></span>)}</div>
              </Section>
            )}
            <Why items={[
              ["Volatility", "Standard deviation of daily returns times the square root of 365 (crypto trades every day)."],
              ["Beta and correlation to bitcoin", "Ordinary least squares on the last 90 daily returns both had."],
              ["Multiples", "Market cap and FDV over the last 30 days of fees, revenue and holders' revenue, times 365/30. Fees are what users pay; revenue is the protocol's share; holders' revenue is what reaches tokenholders."],
              ["Data", d.tier === "pro" ? "This view used CoinGecko Pro." : "Free CoinGecko and DefiLlama data, cached a few minutes."],
            ]} sources={named(d.sources)} />
          </div>
        );
      }}
    </Frame>
  );
}

/* ---------------- DEFI ---------------- */

type DefiData = { chains: ChainTvl[]; protocols: Protocol[]; categories: { category: string; tvl: number; protocols: number }[]; history: { date: string; tvl: number }[]; cashflows: Cashflow[]; sources: Cite[] };

export function DefiScreen({ onRun }: Props) {
  const q = useTerminal<DefiData>("defi");
  return (
    <Frame q={q} what="DeFi">
      {(d) => {
        const total = d.chains.reduce((s, c) => s + c.tvl, 0);
        const last = d.history.at(-1)?.tvl ?? null, prev30 = d.history.at(-31)?.tvl ?? null;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Value locked" value={usd(last ?? total)} sub={ok(last) && ok(prev30) ? `${fsp(last / prev30 - 1)} in 30 days` : undefined} subTone={ok(last) && ok(prev30) ? tone(last - prev30) : undefined} />
              <Tile label="Largest chain" value={d.chains[0]?.name ?? "—"} sub={total ? `${fp((d.chains[0]?.tvl ?? 0) / total, 0)} of the top 20` : undefined} />
              <Tile label="Largest category" value={d.categories[0]?.category ?? "—"} sub={usd(d.categories[0]?.tvl)} />
              <Tile label="Top fee earner, 30 days" value={d.cashflows[0]?.name ?? "—"} sub={usd(d.cashflows[0]?.fees30d)} />
            </Tiles>
            <div className="flex justify-end gap-1.5"><AiRead fn="defi" params={{}} /><AskAi onRun={onRun} ticker="" question="Which DeFi protocols earn the most for their tokenholders relative to their market cap? Use get_defi_overview and get_token, and cite the figures." /></div>
            <Hint skill="DEFI">Value locked is what users have deposited; fees are what they pay to use a protocol. A protocol with high fees relative to its value locked is earning on its capital. Click a protocol with a token to open it.</Hint>
            {d.history.length > 2 && <Section title="DeFi value locked, one year"><SeriesChart x={d.history.map((h) => h.date)} lines={[{ name: "TVL", values: d.history.map((h) => h.tvl), color: "var(--chart-1)" }]} format={usd} height={170} xLabel={(x) => fdate(x, true)} /></Section>}
            <div className="grid gap-4 @4xl:grid-cols-2">
              <Section title="By chain"><BarList format={usd} rows={d.chains.slice(0, 12).map((c) => ({ label: c.name, value: c.tvl }))} /></Section>
              <Section title="By category"><BarList format={usd} rows={d.categories.slice(0, 12).map((c) => ({ label: c.category, value: c.tvl, sub: `${c.protocols} protocols` }))} /></Section>
            </div>
            <Section title="Protocols">
              <DataTable rows={d.protocols} rowKey={(r) => r.slug} max={40} onRow={(r) => r.geckoId && onRun?.({ ticker: "", fn: "TOKEN", arg: r.geckoId, via: "click" })} columns={[
                { key: "name", label: "Protocol", align: "left", value: (r) => r.name, render: (r) => <span><span className="text-fg">{r.name}</span> {r.symbol && <span className="num text-[10px] text-faint">{r.symbol}</span>}</span> },
                { key: "cat", label: "Category", align: "left", value: (r) => r.category },
                { key: "tvl", label: "Value locked", value: (r) => r.tvl, render: (r) => usd(r.tvl) },
                { key: "d1", label: "1D", value: (r) => r.d1, render: (r) => <Heat v={r.d1} scale={0.05} /> },
                { key: "d7", label: "7D", value: (r) => r.d7, render: (r) => <Heat v={r.d7} scale={0.1} /> },
                { key: "mcap", label: "Token mkt cap", value: (r) => r.mcap, render: (r) => usd(r.mcap) },
                { key: "chains", label: "Chains", value: (r) => r.chains.length, render: (r) => <span className="text-muted" title={r.chains.join(", ")}>{r.chains.length}</span> },
              ]} />
            </Section>
            <Section title="Fees and revenue, last 30 days">
              <DataTable rows={d.cashflows} rowKey={(r) => r.slug} max={30} columns={[
                { key: "name", label: "Protocol", align: "left", value: (r) => r.name },
                { key: "cat", label: "Category", align: "left", value: (r) => r.category },
                { key: "fees", label: "Fees", value: (r) => r.fees30d, render: (r) => usd(r.fees30d) },
                { key: "rev", label: "Revenue", value: (r) => r.revenue30d, render: (r) => usd(r.revenue30d) },
                { key: "hold", label: "To holders", value: (r) => r.holdersRevenue30d, render: (r) => usd(r.holdersRevenue30d) },
                { key: "take", label: "Take rate", title: "Revenue as a share of fees", value: (r) => (ok(r.revenue30d) && ok(r.fees30d) && r.fees30d ? r.revenue30d / r.fees30d : null), render: (r) => (ok(r.revenue30d) && ok(r.fees30d) && r.fees30d ? fp(r.revenue30d / r.fees30d, 0) : "—") },
                { key: "y", label: "Fees, 1 year", value: (r) => r.fees1y, render: (r) => usd(r.fees1y) },
              ]} />
            </Section>
            <Why items={[["Value locked", "DefiLlama sums each protocol's deposits from its contracts, excluding staking, pool-2 and borrowed amounts by default."], ["Fees and revenue", "DefiLlama's fee adapters: fees are paid by users; revenue is the part the protocol keeps; holders' revenue is what reaches tokenholders."]]} sources={named(d.sources)} />
          </div>
        );
      }}
    </Frame>
  );
}

/* ---------------- STBL ---------------- */

type StablesData = { coins: Stablecoin[]; total: number; flows: { d1: number; d7: number; d30: number }; chains: { chain: string; supply: number }[]; history: { date: string; supply: number }[]; sources: Cite[] };

export function StblScreen({ onRun }: Props) {
  const q = useTerminal<StablesData>("stables");
  return (
    <Frame q={q} what="stablecoins">
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Stablecoin supply" value={usd(d.total)} />
            <Tile label="Net flow, 1 day" value={usd(d.flows.d1)} subTone={tone(d.flows.d1)} sub={d.flows.d1 >= 0 ? "minted" : "redeemed"} />
            <Tile label="Net flow, 7 days" value={usd(d.flows.d7)} subTone={tone(d.flows.d7)} sub={d.flows.d7 >= 0 ? "minted" : "redeemed"} />
            <Tile label="Net flow, 30 days" value={usd(d.flows.d30)} subTone={tone(d.flows.d30)} sub={d.flows.d30 >= 0 ? "minted" : "redeemed"} />
            <Tile label="Largest" value={d.coins[0]?.symbol ?? "—"} sub={d.total ? `${fp((d.coins[0]?.supply ?? 0) / d.total, 0)} share` : undefined} />
            <Tile label="Largest chain" value={d.chains[0]?.chain ?? "—"} sub={usd(d.chains[0]?.supply)} />
          </Tiles>
          <div className="flex justify-end gap-1.5"><AiRead fn="stables" params={{}} /><AskAi onRun={onRun} ticker="" question="What do stablecoin flows say about money moving into or out of crypto? Use get_stablecoins and cite the figures." /></div>
          <Hint skill="STBL">A stablecoin is minted when someone deposits dollars with the issuer and burned when they redeem, so supply growth is fresh money arriving on chain and shrinking supply is money leaving. Flows are the change in supply, coin by coin.</Hint>
          {d.history.length > 2 && <Section title="Total supply, one year"><SeriesChart x={d.history.map((h) => h.date)} lines={[{ name: "Supply", values: d.history.map((h) => h.supply), color: "var(--chart-2)" }]} format={usd} height={170} xLabel={(x) => fdate(x, true)} /></Section>}
          <div className="grid gap-4 @4xl:grid-cols-[2fr_1fr]">
            <Section title="Coins">
              <DataTable rows={d.coins} rowKey={(r) => r.symbol + r.name} columns={[
                { key: "sym", label: "Coin", align: "left", value: (r) => r.symbol, render: (r) => <span><span className="text-fg">{r.symbol}</span> <span className="text-[10px] text-faint">{r.name}</span></span> },
                { key: "mech", label: "Backing", align: "left", value: (r) => r.mechanism },
                { key: "supply", label: "Supply", value: (r) => r.supply, render: (r) => usd(r.supply) },
                { key: "d7", label: "7D", value: (r) => r.d7, render: (r) => <Heat v={r.d7} scale={0.03} /> },
                { key: "d30", label: "30D", value: (r) => r.d30, render: (r) => <Heat v={r.d30} scale={0.08} /> },
                { key: "price", label: "Price", title: "Below $0.99 or above $1.01 is a peg worth watching", value: (r) => r.price, render: (r) => <span className={ok(r.price) && r.pegType === "USD" && Math.abs(r.price - 1) > 0.01 ? "font-semibold text-neg" : ""}>{ok(r.price) ? `$${r.price.toFixed(4)}` : "—"}</span> },
              ]} />
            </Section>
            <Section title="By chain"><BarList format={usd} rows={d.chains.map((c) => ({ label: c.chain, value: c.supply }))} /></Section>
          </div>
          <Why items={[["Flows", "The change in each coin's circulating supply over the period, summed. Bridging between chains moves supply between chains without changing the total."]]} sources={named(d.sources)} />
        </div>
      )}
    </Frame>
  );
}

/* ---------------- YLD ---------------- */

export function YldScreen({ onRun }: Props) {
  const [stable, setStable] = useState(false);
  const q = useTerminal<{ pools: Pool[]; sources: Cite[] }>("yields", stable ? { stable: "1" } : {});
  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-3 text-[11px]">
        <button type="button" onClick={() => setStable(false)} className={`rounded-full border px-2 py-0.5 ${!stable ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>All pools</button>
        <button type="button" onClick={() => setStable(true)} className={`rounded-full border px-2 py-0.5 ${stable ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>Stablecoins only</button>
        <span className="ml-auto"><AskAi onRun={onRun} ticker="" question="Where is the best risk-adjusted stablecoin yield in DeFi right now, and what are the risks? Cite the figures." /></span>
      </div>
      <Frame q={q} what="DeFi yields">
        {(d) => (
          <div className="flex flex-col gap-3 p-3">
            <Hint skill="YLD">The largest pools by value locked. Base APY comes from fees and interest; reward APY is paid in incentive tokens and tends not to last. High yields usually pay for a risk: impermanent loss, smart-contract risk, or a token that can fall.</Hint>
            <DataTable rows={d.pools} rowKey={(r) => r.pool} max={100} columns={[
              { key: "project", label: "Project", align: "left", value: (r) => r.project },
              { key: "symbol", label: "Pool", align: "left", value: (r) => r.symbol, render: (r) => <span className="block max-w-[160px] truncate" title={r.symbol}>{r.symbol}</span> },
              { key: "chain", label: "Chain", align: "left", value: (r) => r.chain },
              { key: "tvl", label: "Value locked", value: (r) => r.tvl, render: (r) => usd(r.tvl) },
              { key: "apy", label: "APY", value: (r) => r.apy, render: (r) => fp(r.apy, 2) },
              { key: "base", label: "Base", value: (r) => r.apyBase, render: (r) => fp(r.apyBase, 2) },
              { key: "reward", label: "Reward", value: (r) => r.apyReward, render: (r) => <span className="text-muted">{fp(r.apyReward, 2)}</span> },
              { key: "il", label: "IL risk", title: "Impermanent loss risk (two volatile assets in one pool)", value: (r) => r.ilRisk, render: (r) => (r.ilRisk === "yes" ? <Pill kind="warn">yes</Pill> : <span className="text-faint">{r.ilRisk || "—"}</span>) },
            ]} />
            <Why items={[["APY", "DefiLlama's annual percentage yield, compounding included, split into base (fees, interest) and reward (incentive tokens)."]]} sources={named(d.sources)} />
          </div>
        )}
      </Frame>
    </div>
  );
}

/* ---------------- BTCN ---------------- */

export function BtcnScreen({ onRun }: Props) {
  const q = useTerminal<BitcoinView>("btc");
  return (
    <Frame q={q} what="the Bitcoin network">
      {(d) => {
        const e = d.economics;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Block height" value={d.height ? d.height.toLocaleString("en-US") : "—"} sub={`subsidy ${d.reward.subsidy} BTC`} />
              <Tile label="Fee, next block" value={ok(d.fees.fastest) ? `${d.fees.fastest} sat/vB` : "—"} sub={ok(d.fees.hour) ? `within an hour ${d.fees.hour}` : undefined} />
              <Tile label="Mempool" value={ok(d.mempool.count) ? d.mempool.count.toLocaleString("en-US") : "—"} sub={ok(d.mempool.vsizeMb) ? `${d.mempool.vsizeMb.toFixed(0)} vMB waiting` : undefined} />
              <Tile label="Hashrate" value={ok(d.hashrate.currentEhs) ? `${d.hashrate.currentEhs.toFixed(0)} EH/s` : "—"} sub={d.hashrate.series.length > 1 ? `${fsp((d.hashrate.currentEhs ?? 0) / d.hashrate.series[0].ehs - 1)} in 3 months` : undefined} />
              <Tile label="Next difficulty change" value={fsp(d.adjustment.change)} sub={d.adjustment.eta ? `around ${d.adjustment.eta.slice(0, 10)}` : undefined} subTone={tone(d.adjustment.change)} />
              <Tile label="Hashprice" value={ok(e?.hashpriceUsdPh) ? `$${e.hashpriceUsdPh.toFixed(1)}` : "—"} sub="per PH/s per day" />
            </Tiles>
            <div className="flex justify-end gap-1.5"><AiRead fn="btc" params={{}} /><AskAi onRun={onRun} ticker="" question="How profitable is bitcoin mining right now, and which listed miners are most exposed? Use get_bitcoin_network and cite the figures." /></div>
            <Hint skill="BTCN">Miners earn the block subsidy plus fees, shared across the network&apos;s hashrate: that is hashprice. When it falls below what a machine costs to run, the least efficient miners switch off, hashrate drops, and the next difficulty adjustment makes mining easier.</Hint>
            {e && (
              <Section title="Mining economics">
                <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
                  <Tile label="Paid to miners, a day" value={`${e.dailyBtc.toFixed(0)} BTC`} sub={usd(e.dailyUsd)} />
                  <Tile label="Fees' share of rewards" value={fp(e.feeShare)} />
                  <Tile label={`Breakeven power, ${e.efficiencyJth} J/TH`} value={ok(e.breakevenUsdKwh) ? `$${e.breakevenUsdKwh.toFixed(3)}/kWh` : "—"} sub="above this, the machine loses money" />
                  <Tile label="Network draw if all S21-class" value={`${e.networkGw.toFixed(1)} GW`} sub="a floor: older machines use more" />
                </div>
              </Section>
            )}
            <div className="grid gap-4 @4xl:grid-cols-[2fr_1fr]">
              {d.hashrate.series.length > 2 && <Section title="Hashrate, three months"><SeriesChart x={d.hashrate.series.map((h) => h.date)} lines={[{ name: "EH/s", values: d.hashrate.series.map((h) => h.ehs), color: "var(--chart-1)" }]} format={(v) => `${v.toFixed(0)} EH/s`} height={170} xLabel={(x) => fdate(x)} /></Section>}
              <Section title="Pools, last week"><BarList format={(v) => fp(v, 1)} rows={d.pools.slice(0, 10).map((p) => ({ label: p.name, value: p.share, sub: `${p.blocks} blocks` }))} /></Section>
            </div>
            <p className="text-[11px] text-muted">See the mining sites and their power on the map: <Link href="/app/crypto?tab=map" className="text-accent hover:underline">Crypto → Mining map</Link>.</p>
            <Why items={[
              ["Hashprice", "Daily BTC to miners (144 blocks x (subsidy + the last day's average fees)) times the price, divided by network hashrate in PH/s."],
              ["Breakeven power price", "Revenue per TH/s per day divided by the energy a machine at the stated efficiency uses per TH/s per day (J/TH x 86,400 / 3.6 million kWh)."],
            ]} sources={named(d.sources)} />
          </div>
        );
      }}
    </Frame>
  );
}

/* ---------------- RAISE ---------------- */

type RaisesData = { raises: Raise[]; stats: { rounds30: number; usd30: number; rounds90: number; usd90: number }; categories: { category: string; rounds: number; usd: number }[]; investors: { name: string; rounds: number; usd: number }[]; sources: Cite[] };

export function RaiseScreen({ onRun }: Props) {
  const q = useTerminal<RaisesData>("raises");
  const [pro, setPro] = useState<RaisesData | null>(null);
  const [filter, setFilter] = useState("");
  return (
    <Frame q={pro ? { ...q, data: pro } : q} what="crypto venture rounds">
      {(d) => {
        const f = filter.trim().toLowerCase();
        const rows = f ? d.raises.filter((r) => [r.name, r.category, r.sector, r.round, ...r.leads, ...r.others].some((s) => s.toLowerCase().includes(f))) : d.raises;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Rounds, 30 days" value={String(d.stats.rounds30)} sub={usd(d.stats.usd30)} />
              <Tile label="Rounds, 90 days" value={String(d.stats.rounds90)} sub={usd(d.stats.usd90)} />
              <Tile label="Busiest lead, 90 days" value={d.investors[0]?.name ?? "—"} sub={d.investors[0] ? `${d.investors[0].rounds} rounds` : undefined} />
              <Tile label="Hottest category, 90 days" value={d.categories[0]?.category ?? "—"} sub={usd(d.categories[0]?.usd)} />
            </Tiles>
            <div className="flex flex-wrap items-center justify-end gap-1.5"><ProData<RaisesData> fn="raises" onData={setPro} /><AiRead fn="raises" params={{}} /><AskAi onRun={onRun} ticker="" question="Summarise crypto venture activity over the last 90 days: who is leading rounds, in which categories, and at what sizes. Use get_crypto_raises and cite the rounds." /></div>
            <Hint skill="RAISE">Disclosed venture rounds in crypto projects. Many rounds never disclose a valuation; where one is given it is shown. Lead investors set the terms; the rest followed. The private-markets directory lists these projects too.</Hint>
            <div className="grid gap-4 @4xl:grid-cols-2">
              <Section title="By category, 90 days"><BarList format={usd} rows={d.categories.map((c) => ({ label: c.category, value: c.usd, sub: `${c.rounds} rounds` }))} /></Section>
              <Section title="Most active leads, 90 days"><BarList format={(v) => `${v} rounds`} rows={d.investors.map((x) => ({ label: x.name, value: x.rounds, sub: usd(x.usd) }))} /></Section>
            </div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: a project, category or investor…" className="ctl border border-line bg-bg px-2 py-1 text-[11.5px] outline-none focus:border-accent/60" />
            <DataTable rows={rows} rowKey={(r, i) => `${r.date}-${r.name}-${i}`} max={150} columns={[
              { key: "date", label: "Date", align: "left", value: (r) => r.date },
              { key: "name", label: "Project", align: "left", value: (r) => r.name, render: (r) => <span className="text-fg">{r.name}</span> },
              { key: "round", label: "Round", align: "left", value: (r) => r.round },
              { key: "amt", label: "Raised", value: (r) => r.amountUsd, render: (r) => usd(r.amountUsd) },
              { key: "val", label: "Valuation", value: (r) => r.valuationUsd, render: (r) => usd(r.valuationUsd) },
              { key: "cat", label: "Category", align: "left", value: (r) => r.category || r.sector },
              { key: "lead", label: "Led by", align: "left", value: (r) => r.leads.join(", "), render: (r) => <span className="block max-w-[200px] truncate" title={[...r.leads, ...r.others].join(", ")}>{r.leads.join(", ") || <span className="text-faint">undisclosed</span>}</span> },
              { key: "src", label: "", sortable: false, value: () => null, render: (r) => (r.source ? <a href={r.source} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-info hover:underline">source</a> : null) },
            ]} />
            <Why items={[["Coverage", "DefiLlama's raises database, compiled from announcements and press; amounts in US dollars as announced."]]} sources={named(d.sources)} />
          </div>
        );
      }}
    </Frame>
  );
}

/* ---------------- UNLK ---------------- */

type UnlocksData = { unlocks: Unlock[]; totalUsd: number; sources: Cite[] };

export function UnlkScreen({ onRun }: Props) {
  const q = useTerminal<UnlocksData>("unlocks");
  const [pro, setPro] = useState<UnlocksData | null>(null);
  return (
    <Frame q={pro ? { ...q, data: pro } : q} what="token unlocks">
      {(d) => {
        const big3 = [...d.unlocks].sort((a, b) => (b.nextShare ?? 0) - (a.nextShare ?? 0)).slice(0, 3);
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Unlocking, next 60 days" value={usd(d.totalUsd)} sub={`${d.unlocks.length} tokens`} />
              {big3.map((u) => <Tile key={u.name} label={`${u.name}, ${u.nextDate}`} value={fp(u.nextShare, 1)} sub={`of circulating, ${usd(u.nextUsd)}`} subTone="text-chart-emphasis" />)}
            </Tiles>
            <div className="flex flex-wrap items-center justify-end gap-1.5"><ProData<UnlocksData> fn="unlocks" onData={setPro} /><AiRead fn="unlocks" params={{}} /><AskAi onRun={onRun} ticker="" question="Which upcoming token unlocks are largest relative to circulating supply and trading volume, and which tokens look most exposed? Cite the figures." /></div>
            <Hint skill="UNLK">Tokens held by teams and investors are released on a schedule. An unlock that adds several percent to circulating supply is new supply that often meets thin demand. The share column puts unlocks of different sizes on one scale.</Hint>
            <DataTable rows={d.unlocks} rowKey={(r, i) => `${r.name}-${i}`} max={120} onRow={(r) => r.geckoId && onRun?.({ ticker: "", fn: "TOKEN", arg: r.geckoId, via: "click" })} columns={[
              { key: "date", label: "Date", align: "left", value: (r) => r.nextDate },
              { key: "name", label: "Token", align: "left", value: (r) => r.name },
              { key: "tokens", label: "Tokens", value: (r) => r.nextTokens, render: (r) => qty(r.nextTokens) },
              { key: "usd", label: "Value now", value: (r) => r.nextUsd, render: (r) => usd(r.nextUsd) },
              { key: "share", label: "% of circulating", value: (r) => r.nextShare, render: (r) => <span className={ok(r.nextShare) && r.nextShare >= 0.02 ? "font-semibold text-chart-emphasis" : ""}>{fp(r.nextShare, 2)}</span> },
              { key: "mcap", label: "Market cap", value: (r) => r.mcap, render: (r) => usd(r.mcap) },
            ]} />
            <Why items={[["Schedules", "DefiLlama's emissions data, from each project's published vesting schedule. Value uses today's price; the price on the day will differ."]]} sources={named(d.sources)} />
          </div>
        );
      }}
    </Frame>
  );
}

/* ---------------- TRSY ---------------- */

type TreasuriesData = { rows: TreasuryRow[]; periods: string[]; total: number; btcPrice: number | null; ethPrice: number | null; sources: Cite[] };

export function TrsyScreen({ onRun }: Props) {
  const q = useTerminal<TreasuriesData>("treasuries");
  return (
    <Frame q={q} what="companies' crypto holdings">
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Reported crypto, fair value" value={usd(d.total)} sub={`${d.rows.length} companies`} />
            <Tile label="Largest holder" value={d.rows[0]?.ticker || d.rows[0]?.name || "—"} sub={usd(d.rows[0]?.fairValue)} />
            <Tile label="Bitcoin" value={px(d.btcPrice)} sub="price now" />
            <Tile label="Ether" value={px(d.ethPrice)} sub="price now" />
          </Tiles>
          <div className="flex justify-end gap-1.5"><AiRead fn="treasuries" params={{}} /><AskAi onRun={onRun} ticker="" question="Which public companies hold the most crypto on their balance sheets, and how large is it relative to their market cap? Use get_crypto_treasuries and get_company_financials, and cite the filings." /></div>
          <Hint skill="TRSY">What companies report holding in crypto at fair value in their latest 10-Q or 10-K (the accounting rule ASU 2023-08 requires fair value). Values are as of the quarter end, not today. Click a row with a ticker to open the company.</Hint>
          <DataTable rows={d.rows} rowKey={(r) => r.cik} onRow={(r) => r.ticker && onRun?.({ ticker: r.ticker, fn: "DES", via: "click" })} columns={[
            { key: "ticker", label: "Ticker", align: "left", value: (r) => r.ticker, render: (r) => <span className="num font-semibold text-accent">{r.ticker || "—"}</span> },
            { key: "name", label: "Company", align: "left", value: (r) => r.name, render: (r) => <span className="block max-w-[240px] truncate">{r.name}</span> },
            { key: "fv", label: "Crypto at fair value", value: (r) => r.fairValue, render: (r) => usd(r.fairValue) },
            { key: "asof", label: "As of", value: (r) => r.asOf },
            { key: "link", label: "", sortable: false, value: () => null, render: (r) => <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-info hover:underline">SEC</a> },
          ]} />
          <Why items={[["Source", `SEC XBRL frames for CryptoAssetFairValue (current and noncurrent) in ${d.periods.join(", ")}; each company's newest quarter is shown.`], ["Not included", "Companies that still carry crypto as an impaired intangible asset (before adopting ASU 2023-08) and foreign filers that do not tag these concepts."]]} sources={named(d.sources)} />
        </div>
      )}
    </Frame>
  );
}

/* ---------------- RWA ---------------- */

type RwaData = { rows: RwaRow[]; kinds: { kind: RwaKind; tvl: number; protocols: number }[]; total: number; tokens: TokenRow[]; sources: Cite[] };

export function RwaScreen({ onRun }: Props) {
  const q = useTerminal<RwaData>("rwa");
  return (
    <Frame q={q} what="tokenized real-world assets">
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Tokenized RWAs, value locked" value={usd(d.total)} sub={`${d.rows.length} protocols`} />
            {d.kinds.slice(0, 4).map((k) => <Tile key={k.kind} label={k.kind} value={usd(k.tvl)} sub={`${k.protocols} protocols`} />)}
          </Tiles>
          <div className="flex justify-end gap-1.5"><AiRead fn="rwa" params={{}} /><AskAi onRun={onRun} ticker="" question="How big is tokenization of treasuries and private credit, who are the largest issuers, and how fast is it growing? Use get_rwa_tokenization and cite the figures." /></div>
          <Hint skill="RWA">Real-world assets brought on chain: tokenized Treasury bill funds (BlackRock BUIDL, Franklin, Ondo), private credit (Maple, Centrifuge), gold and real estate. The kind is read from each protocol&apos;s name and category, so check the protocol for its exact structure.</Hint>
          <div className="grid gap-4 @4xl:grid-cols-[1fr_2fr]">
            <Section title="By kind"><BarList format={usd} rows={d.kinds.map((k) => ({ label: k.kind, value: k.tvl, sub: `${k.protocols} protocols` }))} /></Section>
            <Section title="Protocols">
              <DataTable rows={d.rows} rowKey={(r) => r.slug} max={50} onRow={(r) => r.geckoId && onRun?.({ ticker: "", fn: "TOKEN", arg: r.geckoId, via: "click" })} columns={[
                { key: "name", label: "Protocol", align: "left", value: (r) => r.name },
                { key: "kind", label: "Kind", align: "left", value: (r) => r.kind },
                { key: "tvl", label: "Value locked", value: (r) => r.tvl, render: (r) => usd(r.tvl) },
                { key: "d7", label: "7D", value: (r) => r.d7, render: (r) => <Heat v={r.d7} scale={0.1} /> },
                { key: "chains", label: "Chains", align: "left", value: (r) => r.chains.slice(0, 3).join(", ") },
              ]} />
            </Section>
          </div>
          {d.tokens.length > 0 && <Section title="RWA tokens (CoinGecko category)"><DataTable rows={d.tokens} rowKey={(r) => r.id} max={20} columns={tokenColumns().filter((c) => !["spark", "y1"].includes(c.key))} onRow={(r) => onRun?.({ ticker: "", fn: "TOKEN", arg: r.id, via: "click" })} /></Section>}
          <Why items={[["Classification", "DefiLlama's RWA and RWA Lending categories; YouBank sorts each protocol into treasuries, private credit, commodities or real estate from its name."]]} sources={named(d.sources)} />
        </div>
      )}
    </Frame>
  );
}

/* ---------------- WALLET ---------------- */

export function WalletScreen({ arg }: Props) {
  const [address, setAddress] = useState((arg ?? "").trim());
  const [view, setView] = useState<{ busy: boolean; data?: WalletView; error?: string }>({ busy: false });
  const read = async (a: string) => {
    if (!a.trim()) return;
    setView({ busy: true });
    try {
      const res = await fetch(`/api/crypto/wallet?address=${encodeURIComponent(a.trim())}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not read that address");
      setView({ busy: false, data: j.view ?? undefined, error: j.view?.wallets?.[0]?.error });
    } catch (e) { setView({ busy: false, error: e instanceof Error ? e.message : "Could not read that address" }); }
  };
  // WALLET <address> reads the address once when the panel opens.
  const opened = useRef(false);
  const first = useRef(read);
  useEffect(() => {
    if (opened.current || !arg?.trim()) return;
    opened.current = true;
    queueMicrotask(() => void first.current(arg));
  }, [arg]);
  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={(e) => { e.preventDefault(); void read(address); }} className="flex gap-2">
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… address, name.eth, a Bitcoin or Solana address" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
        <button type="submit" disabled={view.busy} className="ctl border border-line px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-accent disabled:opacity-50">{view.busy ? "Reading…" : "Read"}</button>
      </form>
      <p className="text-[11px] text-muted">Read-only: YouBank looks up public balances and never asks for a key. To save wallets, connect one, enter what you paid and see profit and loss, use <Link href="/app/crypto?tab=portfolio" className="text-accent hover:underline">Crypto → Portfolio</Link>.</p>
      {view.error && <p className="text-[11.5px] text-neg">{view.error}</p>}
      {view.data && <PortfolioBody view={view.data} />}
    </div>
  );
}

/** Holdings, risk and activity for a wallet view; shared by WALLET and the Portfolio tab. */
export function PortfolioBody({ view: v, extra }: { view: WalletView; extra?: ReactNode }) {
  const r = v.risk;
  return (
    <div className="flex flex-col gap-3">
      <Tiles>
        <Tile label="Value" value={usd(r.totalUsd)} sub={`${v.holdings.length} holdings`} />
        <Tile label="Largest holding" value={r.largest?.symbol ?? "—"} sub={r.largest ? fp(r.largest.weight, 0) : undefined} />
        <Tile label="Effective holdings" value={r.effectiveN ? r.effectiveN.toFixed(1) : "—"} sub="1 / Herfindahl" />
        <Tile label="Stablecoins" value={fp(r.stableShare, 0)} />
        <Tile label="Volatility, 1 year" value={fp(r.vol, 0)} sub={r.historyCoverage < 1 ? `${fp(r.historyCoverage, 0)} of risky value covered` : "at today's weights"} />
        <Tile label="1-day VaR, 95%" value={ok(r.var95) ? usd(r.var95 * r.totalUsd) : "—"} sub={ok(r.var95) ? `${fp(r.var95)}; worst 5% average ${fp(r.es95)}` : undefined} subTone="text-neg" />
      </Tiles>
      {r.pnl && <div className="rounded-md border border-line bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">Profit and loss on the {fp(r.pnl.covered, 0)} of value you entered a cost for: <span className={`num font-semibold ${tone(r.pnl.gainUsd)}`}>{usd(r.pnl.gainUsd)} ({fsp(r.pnl.gainPct)})</span> on a cost of {usd(r.pnl.costUsd)}.</div>}
      {extra}
      <div className="grid gap-4 @4xl:grid-cols-[2fr_1fr]">
        <Section title="Holdings">
          <DataTable rows={v.holdings} rowKey={(h, i) => `${h.chain}-${h.asset}-${i}`} empty="No balances found on the chains YouBank reads." columns={[
            { key: "sym", label: "Asset", align: "left", value: (h) => h.symbol, render: (h) => <span><span className="text-fg">{h.symbol}</span>{h.stable && <span className="ml-1 text-[9.5px] text-faint">stable</span>}</span> },
            { key: "chain", label: "Chain", align: "left", value: (h) => h.chain },
            { key: "qty", label: "Quantity", value: (h) => h.quantity, render: (h) => qty(h.quantity) },
            { key: "px", label: "Price", value: (h) => h.priceUsd, render: (h) => px(h.priceUsd) },
            { key: "usd", label: "Value", value: (h) => h.valueUsd, render: (h) => usd(h.valueUsd) },
            { key: "w", label: "Weight", value: (h) => (r.totalUsd ? h.valueUsd / r.totalUsd : null), render: (h) => fp(r.totalUsd ? h.valueUsd / r.totalUsd : null, 1) },
            { key: "pnl", label: "P&L", value: (h) => (ok(h.costUsd) ? h.valueUsd - h.costUsd : null), render: (h) => (ok(h.costUsd) ? <span className={tone(h.valueUsd - h.costUsd)}>{usd(h.valueUsd - h.costUsd)}</span> : <span className="text-faint">—</span>) },
          ]} />
          {v.unpricedTokens > 0 && <p className="mt-1 text-[10.5px] text-muted">{v.unpricedTokens} other Solana token{v.unpricedTokens === 1 ? "" : "s"} not shown: the free view prices the major tokens only. Deep analytics finds every token.</p>}
        </Section>
        <Section title="By chain"><BarList format={(x) => fp(x, 0)} rows={r.chains.map((c) => ({ label: c.chain, value: c.weight, sub: usd(c.usd) }))} /></Section>
      </div>
      {v.activity.length > 0 && (
        <Section title="Recent activity">
          <DataTable rows={v.activity} rowKey={(a, i) => `${a.hash}-${i}`} columns={[
            { key: "at", label: "When", align: "left", value: (a) => a.at, render: (a) => a.at.slice(0, 16).replace("T", " ") },
            { key: "chain", label: "Chain", align: "left", value: (a) => a.chain },
            { key: "dir", label: "", align: "left", value: (a) => a.direction, render: (a) => <Pill kind={a.direction === "in" ? "pos" : a.direction === "out" ? "neg" : "muted"}>{a.direction}</Pill> },
            { key: "amt", label: "Amount", value: (a) => a.amount, render: (a) => `${qty(a.amount)} ${a.symbol}` },
            { key: "cp", label: "Counterparty", align: "left", value: (a) => a.counterparty, render: (a) => (a.counterparty ? <a href={addressUrl(a.chain as ChainKey, a.counterparty)} target="_blank" rel="noreferrer" className="num text-info hover:underline">{shortAddress(a.counterparty)}</a> : "—") },
            { key: "tx", label: "", sortable: false, value: () => null, render: (a) => <a href={txUrl(a.chain as ChainKey, a.hash)} target="_blank" rel="noreferrer" className="text-info hover:underline">tx</a> },
          ]} />
        </Section>
      )}
      <Why items={[
        ["Coverage", "Native coins and the major tokens on Ethereum, Base, Arbitrum, Optimism and Polygon (read from public nodes), Bitcoin (mempool.space) and Solana (public RPC). Positions inside DeFi protocols and NFTs are not included."],
        ["Risk", "Daily returns of each holding over the last year, combined at today's weights. Value at risk is the 5th percentile of those daily portfolio returns (historical simulation); expected shortfall is the average beyond it. Stablecoins count as cash."],
        ["Profit and loss", "Only for assets where you entered what you paid; YouBank cannot see purchase prices."],
      ]} sources={named(v.sources)} />
      <CiteLinks sources={v.sources} />
    </div>
  );
}

