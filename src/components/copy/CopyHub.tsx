"use client";

/**
 * Fund copies: discover 13F filers (the curated list and a search of every filer), follow them, run
 * paper copies for free, and with Pro connect a broker and run live copies whose orders you approve.
 * Tabs: Discover, My copies, Following, Brokerage, Activity (the audit log).
 */
import { lazyPanel, useIdlePreload } from "@/components/ui/lazyPanel";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { NOT_ADVICE_SHORT, TIMING } from "@/lib/copytrade/disclosures";
import type { CuratedFund } from "@/lib/copytrade/funds";
import { useSubNav, useViewInUrl } from "@/lib/subnav";
import { call, json, shortCik, usd } from "./client";
import { ConsentProvider, useConsent } from "./Consent";
import type { Account, CopyDraft, Plan } from "./CopyEditor";
import { useTabInView } from "@/components/ui/useTabInView";

// A copy's dashboard (its editor and charts with it) loads when a copy is opened, not with the list.
const CopyDetail = lazyPanel(() => import("./CopyDetail").then((m) => m.CopyDetail), () => <div className="shimmer h-64 rounded-md" />);

type Tab = "discover" | "copies" | "following" | "broker" | "activity";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "discover", label: "Discover", icon: "Search" },
  { id: "copies", label: "My copies", icon: "Copy" },
  { id: "following", label: "Following", icon: "Bell" },
  { id: "broker", label: "Brokerage", icon: "Landmark" },
  { id: "activity", label: "Activity", icon: "ScrollText" },
];

type CopyRow = CopyDraft & { id: number; status: string; createdAt: string; paper: { startCash: number; startedAt: string; positions: number; lastRebalance: string } | null };
type Hub = { copies: CopyRow[]; consents: { terms: boolean; trading: boolean }; plan: Plan; setup: { ready: boolean; trading: boolean; reason: string | null; tradingEnabled: boolean; maxOrderUsd: number; maxDayUsd: number } };

export function CopyHub(props: { initialTab?: string; initialCopy?: number | null; review?: boolean; connected?: boolean }) {
  return <ConsentProvider><HubInner {...props} /></ConsentProvider>;
}

function HubInner({ initialTab, initialCopy, review, connected }: { initialTab?: string; initialCopy?: number | null; review?: boolean; connected?: boolean }) {
  useIdlePreload([CopyDetail]);
  const [tab, setTab] = useState<Tab>(initialCopy ? "copies" : (TABS.find((t) => t.id === initialTab)?.id ?? "discover"));
  const tabRow = useTabInView<HTMLElement>(tab);
  const [hub, setHub] = useState<Hub | null>(null);
  const [selected, setSelected] = useState<number | null>(initialCopy ?? null);
  const [error, setError] = useState<string | null>(null);
  useSubNav("/app/copy", (v) => { if (TABS.some((t) => t.id === v)) setTab(v as Tab); });
  useViewInUrl("/app/copy", "tab", tab, "discover");
  const load = useCallback(() => fetchJson<Hub>("/api/copy/copies").then(setHub).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  return (
    // The page scrolls inside itself, as every workspace does: the frame around it never scrolls.
    <div className="h-full overflow-auto">
    <div className="mx-auto max-w-6xl p-3 sm:p-4">
      <div className="mb-3">
        <h1 className="display text-[26px] leading-tight text-fg sm:text-[30px]">Fund copies</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] text-muted">See what well-known funds disclose in their 13F filings, test how copying them would have gone, follow them on paper for free, and with Pro place the matching orders in your own brokerage account, approving each batch yourself.</p>
      </div>
      <p className="mb-3 flex gap-2 rounded-md border border-line bg-elevated p-2.5 text-[11.5px] leading-relaxed text-muted"><Icon name="Hourglass" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{TIMING}</p>
      <nav ref={tabRow} className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" aria-label="Fund copies">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] ${tab === t.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}><Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}{t.id === "copies" && hub ? ` (${hub.copies.length})` : ""}</button>
        ))}
      </nav>
      {error && <p className="mb-3 rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {tab === "discover" && <Discover />}
      {tab === "copies" && <Copies hub={hub} selected={selected} onSelect={setSelected} review={review} reload={load} />}
      {tab === "following" && <Following />}
      {tab === "broker" && <Broker hub={hub} connected={connected} reload={load} />}
      {tab === "activity" && <Activity />}
      <p className="mt-4 text-[11px] text-muted">{NOT_ADVICE_SHORT}</p>
    </div>
    </div>
  );
}

function Discover() {
  const [curated, setCurated] = useState<CuratedFund[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ cik: string; name: string; latestFiled: string | null; curated: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchJson<{ curated: CuratedFund[] }>("/api/copy/funds").then((r) => setCurated(r.curated)).catch((e) => setError(errorMessage(e))); }, []);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => fetchJson<{ results: typeof results }>(`/api/copy/funds?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then((r) => setResults(r.results)).catch((e) => { if ((e as Error).name !== "AbortError") setError(errorMessage(e)); }), 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every 13F filer by name or CIK" className="ctl w-full border border-line bg-panel py-2.5 pl-9 pr-3 text-[13px] text-fg outline-none focus:border-accent" />
      </div>
      {error && <p className="text-[12px] text-neg">{error}</p>}
      {results && q.trim().length >= 2 && (
        <ul className="panel divide-y divide-line">
          {results.length ? results.map((r) => (
            <li key={r.cik}><Link href={`/app/copy/fund/${r.cik}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-elevated"><span className="min-w-0 truncate text-[12.5px] text-fg">{r.name}{r.curated && <Icon name="Star" className="ml-1.5 inline h-3 w-3 text-accent" />}</span><span className="shrink-0 text-[11px] text-muted">CIK {shortCik(r.cik)}{r.latestFiled ? ` · last 13F ${r.latestFiled}` : ""}</span></Link></li>
          )) : <li className="px-3 py-2.5 text-[12px] text-muted">No 13F filer by that name yet. Try fewer words, or the CIK from EDGAR. The directory fills from EDGAR&apos;s indexes each quarter.</li>}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {curated.map((f) => (
          <Link key={f.cik} href={`/app/copy/fund/${f.cik}`} className="panel group p-3 transition hover:border-line-strong">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-[13.5px] font-semibold text-fg group-hover:text-accent">{f.name}</div><div className="truncate text-[11.5px] text-muted">{f.manager}</div></div>
              <Icon name="ChevronRight" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            </div>
            <div className="mt-2 text-[11px] text-muted">{f.style}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Copies({ hub, selected, onSelect, review, reload }: { hub: Hub | null; selected: number | null; onSelect: (id: number | null) => void; review?: boolean; reload: () => void }) {
  if (!hub) return <div className="shimmer h-40 rounded-md" />;
  if (!hub.copies.length) return (
    <div className="panel p-6 text-center">
      <Icon name="Copy" className="mx-auto h-6 w-6 text-accent" />
      <p className="mt-2 text-[13px] text-fg">No copies yet.</p>
      <p className="mt-1 text-[12px] text-muted">Open a fund from Discover and choose &quot;Copy this fund&quot;. Paper copies are free; live copies with your broker are part of Pro.</p>
    </div>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <ul className="space-y-1.5">
        {hub.copies.map((c) => (
          <li key={c.id}>
            <button onClick={() => onSelect(c.id)} className={`panel w-full p-2.5 text-left ${selected === c.id ? "border-accent" : "hover:border-line-strong"}`}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-[12.5px] font-semibold text-fg">{c.name}</span><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${c.mode === "live" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{c.mode}</span></div>
              <div className="mt-0.5 truncate text-[11px] text-muted">{c.status === "paused" ? "Paused · " : ""}{c.paper ? `${usd(c.paper.startCash)} since ${c.paper.startedAt}` : c.funds.map((f) => f.name).join(" + ")}</div>
            </button>
          </li>
        ))}
        <li className="px-1 pt-1 text-[11px] text-muted">Paper copies: up to {hub.plan.paperCopies}. Live copies: up to {hub.plan.liveCopies}{hub.plan.liveCopies <= 2 && <> (more with <PremiumBadge feature="copytrade.multi" />)</>}.</li>
      </ul>
      <div>{selected ? <CopyDetail key={selected} id={selected} plan={hub.plan} startReview={review} onChanged={() => { reload(); }} /> : <p className="panel p-4 text-[12px] text-muted">Choose a copy.</p>}</div>
    </div>
  );
}

function Following() {
  const [rows, setRows] = useState<{ cik: string; name: string | null; latestFiled: string | null; latestPeriod: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetchJson<{ follows: NonNullable<typeof rows> }>("/api/copy/follows").then((r) => setRows(r.follows)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  const unfollow = async (cik: string) => { await fetchJson("/api/copy/follows", json("DELETE", { cik })).catch(() => undefined); void load(); };
  if (error) return <p className="text-[12px] text-neg">{error}</p>;
  if (!rows) return <div className="shimmer h-32 rounded-md" />;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">You get an alert in the bell (and by push, if you turned it on in Settings, under News and alerts) the moment a fund you follow files a 13F or an amendment.</p>
      {rows.length ? (
        <ul className="panel divide-y divide-line">{rows.map((r) => (
          <li key={r.cik} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <Link href={`/app/copy/fund/${r.cik}`} className="min-w-0 truncate text-[12.5px] text-fg hover:text-accent">{r.name ?? `CIK ${shortCik(r.cik)}`}</Link>
            <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted">{r.latestFiled ? `last 13F ${r.latestFiled}` : "not read yet"}<button onClick={() => unfollow(r.cik)} className="text-muted hover:text-neg">Unfollow</button></span>
          </li>
        ))}</ul>
      ) : <p className="panel p-4 text-[12px] text-muted">You do not follow any funds yet. Use Follow on a fund&apos;s page.</p>}
    </div>
  );
}

function Broker({ hub, connected, reload }: { hub: Hub | null; connected?: boolean; reload: () => void }) {
  const [state, setState] = useState<{ setup: Hub["setup"]; connected: boolean; accounts: Account[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const consent = useConsent();
  const load = useCallback(() => fetchJson<NonNullable<typeof state>>("/api/copy/broker").then(setState).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  const connect = async () => {
    setBusy(true); setError(null);
    try { const r = await call<{ url: string }>("/api/copy/broker", json("POST", {}), consent); window.location.href = r.url; }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const disconnect = async () => {
    if (!(await confirmDialog({ title: "Disconnect your brokers?", body: "Every brokerage connection is removed and your live copies are paused. Orders already sent stay with your broker; your shares stay where they are.", tone: "danger", confirmLabel: "Disconnect" }))) return;
    try { await fetchJson("/api/copy/broker", json("DELETE")); await load(); reload(); } catch (e) { setError(errorMessage(e)); }
  };
  const ready = state?.setup.ready ?? hub?.setup.ready;
  const allowed = hub?.plan.broker;
  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">Your brokerage <PremiumBadge feature="copytrade.broker" /></h2>
            <p className="mt-1 text-[12px] text-muted">Connect Schwab, Fidelity, Robinhood, Webull, Interactive Brokers, E*TRADE and about twenty more through SnapTrade. YouBank reads your positions and cash, and sends orders only when you approve a batch. It never holds or moves your money. You can disconnect at any time.</p>
          </div>
          {state?.connected ? (
            <div className="flex gap-2">
              <button onClick={connect} disabled={busy} className="ctl border border-line px-3 py-2 text-[12.5px] text-fg hover:border-line-strong">Add another broker</button>
              <button onClick={disconnect} className="ctl border border-line px-3 py-2 text-[12.5px] text-neg hover:border-neg/50">Disconnect</button>
            </div>
          ) : (
            <button onClick={connect} disabled={busy || !ready || !allowed} className="ctl flex items-center gap-1.5 bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"><Icon name="Landmark" className="h-3.5 w-3.5" />{!ready ? "Not set up yet" : busy ? "Opening…" : "Connect a broker"}</button>
          )}
        </div>
        {connected && <p className="mt-3 rounded-md border border-pos/40 bg-pos/10 p-2 text-[12px] text-pos">Connected. Your accounts are below; it can take a minute for a new connection&apos;s positions to appear.</p>}
        {!allowed && hub && <p className="mt-3 text-[12px] text-muted">Connecting a broker and placing copy orders are part of the Pro plan. <Link href="/app/settings?tab=plan" className="text-accent hover:underline">See plans</Link>. Paper copies and alerts stay free.</p>}
        {state?.setup.reason && ready && <p className="mt-3 flex gap-2 text-[12px] text-muted"><Icon name="Lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{state.setup.reason}</p>}
        {error && <p className="mt-3 text-[12px] text-neg">{error}</p>}
      </div>
      {state?.connected && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {state.accounts.map((a) => (
            <li key={a.id} className="panel p-3">
              <div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold text-fg">{a.brokerage}</span><span className="num text-[13px] text-fg">{usd(a.total)}</span></div>
              <div className="mt-0.5 text-[11.5px] text-muted">{a.name} {a.number}{a.paper ? " · the broker's own paper account" : ""}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10.5px]">
                <span className={`rounded-full px-2 py-0.5 ${a.trading ? "bg-pos/15 text-pos" : "bg-elevated text-muted"}`}>{a.trading ? "Trading allowed" : "Read only at this broker"}</span>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-muted">{a.fractional ? "Fractional shares" : "Whole shares only"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hub && <p className="text-[11px] text-muted">Safety limits on this server: at most {usd(hub.setup.maxOrderUsd, false)} per order and {usd(hub.setup.maxDayUsd, false)} a day across copies; each copy can set lower limits. {hub.setup.tradingEnabled ? "" : "Real trading is switched off here."}</p>}
    </div>
  );
}

function Activity() {
  const [rows, setRows] = useState<{ id: number; at: string; actor: string; action: string; portfolioId: number | null; batchId: number | null; orderId: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchJson<{ entries: NonNullable<typeof rows> }>("/api/copy/audit").then((r) => setRows(r.entries)).catch((e) => setError(errorMessage(e))); }, []);
  const words: Record<string, string> = { "consent-terms": "Accepted how copies work", "consent-trading": "Accepted the risks of real orders", "copy-create": "Created a copy", "copy-update": "Changed a copy", "copy-pause": "Paused a copy", "copy-resume": "Resumed a copy", "copy-close": "Closed a copy", "paper-rebalance": "Paper copy rebalanced", "broker-register": "Registered with SnapTrade", "broker-connect-start": "Opened the broker connection", "broker-disconnect": "Disconnected brokers", propose: "Built orders for review", approve: "Approved a batch", "order-placed": "Order sent to the broker", "order-rejected": "Order turned down", "order-unknown": "Order not confirmed by the broker", "order-status": "Order status changed", "batch-cancel": "Canceled a batch" };
  if (error) return <p className="text-[12px] text-neg">{error}</p>;
  if (!rows) return <div className="shimmer h-32 rounded-md" />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">Everything you and YouBank did with your copies, kept permanently: consents, connections, proposals, approvals and every order with its exact payload.</p>
        <a href="/api/copy/audit?format=csv" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-fg hover:border-line-strong"><Icon name="Download" className="h-3.5 w-3.5" />Download CSV</a>
      </div>
      {rows.length ? (
        <ul className="panel divide-y divide-line">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
            <span className="text-fg">{words[r.action] ?? r.action}{r.batchId ? ` · batch #${r.batchId}` : ""}{r.portfolioId ? ` · copy #${r.portfolioId}` : ""}</span>
            <span className="text-[11px] text-muted">{new Date(r.at).toLocaleString()} · {r.actor === "system" ? "YouBank" : r.actor}</span>
          </li>
        ))}</ul>
      ) : <p className="panel p-4 text-[12px] text-muted">Nothing yet.</p>}
    </div>
  );
}
