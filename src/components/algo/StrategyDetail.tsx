"use client";

/**
 * One strategy: its dashboard (equity against the benchmark, positions, risk usage, batches waiting for
 * approval, orders with their lifecycle, and every decision with its reasons), its backtests, its settings,
 * and its mode with the live checklist. Every control here is also checked on the server.
 */
import { lazyPanel } from "@/components/ui/lazyPanel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { LinesChart } from "@/components/copy/charts";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { useAlgoConsent } from "./AlgoConsent";
import { BacktestPanel, type BacktestView } from "./BacktestPanel";
import { RiskGauges, Stat, type Gauge } from "./charts";
import { call, json, MODE_LABEL, MODE_TONE, newKey, num, pct, SIGNAL_LABEL, usd, when, type Hub, type Unmet } from "./client";

// The builder (and the strategy schema it validates with, zod included) loads when a strategy is created or edited.
const StrategyEditor = lazyPanel(() => import("./StrategyEditor").then((m) => m.StrategyEditor), () => <div className="shimmer h-72 rounded-md" />);

type Order = { id: number; at?: string; symbol: string; action: string; units: number; orderType: string; limitPrice: number | null; estValue: number; status: string; filledUnits: number; fillPrice: number | null; error: string | null; slice: number; slices: number; notBefore?: string | null; clientOrderId: string };
type Batch = { id: number; status: string; open: boolean; source: string; confirmation: string | null; createdAt: string; approvedAt: string | null; expiresAt: string; buyValue: number; sellValue: number; orderCount: number; orders: Order[] };
type Detail = {
  id: number; name: string; mode: string; status: string; kill: boolean; killReason: string | null; spec: Record<string, unknown> & { signal: { type: string }; universe: string[]; benchmark: string; capitalUsd: number; assetClass: string };
  connection: string | null; accountId: string | null; riskConfirmedAt: string | null; paperStartedAt: string | null; backtests: number;
  equity: number; cash: number | null; realized: number | null; curve: { date: string; value: number }[]; benchmarkCurve: { date: string; value: number }[];
  positions: { symbol: string; units: number; price: number; value: number; weight: number; avgCost: number | null }[];
  batches: Batch[]; orders: Order[]; decisions: { id: number; at: string; source: string; mode: string; target: Record<string, number>; notes: string; orders: number }[];
  risk: Gauge[]; backtest: { at: string; result: BacktestView } | null;
  connections: { ref: string; broker: string; env: string; label: string; status: string; note: string | null }[];
  live: { approval: Unmet[]; autonomous: Unmet[]; phrase: string; integrity: { grade: string; warnings: string[] } | null };
};

const STATUS_TONE: Record<string, string> = { filled: "text-pos", accepted: "text-info", partially_filled: "text-info", pending: "text-muted", scheduled: "text-muted", submitting: "text-info", rejected: "text-neg", blocked: "text-neg", unknown: "text-neg font-semibold", canceled: "text-muted", expired: "text-muted" };

export function StrategyDetail({ id, hub, onBack, reloadHub }: { id: number; hub: Hub; onBack: () => void; reloadHub: () => void }) {
  const ask = useAlgoConsent();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"overview" | "backtest" | "settings">("overview");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => fetchJson<Detail>(`/api/algo/strategies/${id}`).then(setD).catch((e) => setError(errorMessage(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await load(); reloadHub(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  if (!d) return <div className="space-y-2">{error ? <p className="text-[12px] text-neg">{error}</p> : <div className="shimmer h-60 rounded-md" />}</div>;
  const proposed = d.batches.filter((b) => b.open);
  const live = d.mode === "live_approval" || d.mode === "live_auto";
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg"><Icon name="ArrowLeft" className="h-3.5 w-3.5" />All strategies</button>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[20px] font-semibold text-fg">{d.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className={`rounded-full border px-2 py-0.5 ${MODE_TONE[d.mode] ?? ""}`}>{MODE_LABEL[d.mode] ?? d.mode}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-muted">{SIGNAL_LABEL[d.spec.signal.type] ?? d.spec.signal.type}</span>
            <span className="text-muted">{d.spec.universe.join(", ")} · vs {d.spec.benchmark}</span>
            {d.status === "paused" && <span className="rounded-full border border-line px-2 py-0.5 text-muted">Paused</span>}
            {d.kill && <span className="rounded-full border border-neg/50 bg-neg/10 px-2 py-0.5 font-semibold text-neg">Kill switch on{d.killReason ? `: ${d.killReason}` : ""}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button disabled={!!busy || d.status !== "active" || d.mode === "backtest"} onClick={() => act("run", () => call(`/api/algo/strategies/${id}/run`, json("POST", {}), ask))} className="ctl flex items-center gap-1 border border-line px-2.5 py-1.5 text-[12px] text-fg hover:bg-elevated disabled:opacity-50"><Icon name="Play" className="h-3.5 w-3.5" />{busy === "run" ? "Running…" : "Run now"}</button>
          <button disabled={!!busy} onClick={() => act("pause", () => call(`/api/algo/strategies/${id}`, json("PATCH", { status: d.status === "active" ? "paused" : "active" }), ask))} className="ctl flex items-center gap-1 border border-line px-2.5 py-1.5 text-[12px] text-fg hover:bg-elevated"><Icon name={d.status === "active" ? "Pause" : "Play"} className="h-3.5 w-3.5" />{d.status === "active" ? "Pause" : "Resume"}</button>
          <button disabled={!!busy} onClick={async () => { if (d.kill || await confirmDialog({ title: "Turn on this strategy's kill switch?", body: "It stops placing orders and its unsent batches are canceled. Orders already at the broker stay there.", confirmLabel: "Turn on", tone: "danger" })) await act("kill", () => call(`/api/algo/strategies/${id}/kill`, json("POST", { on: !d.kill }), ask)); }} className={`ctl flex items-center gap-1 border px-2.5 py-1.5 text-[12px] ${d.kill ? "border-line text-fg" : "border-neg/50 text-neg hover:bg-neg/10"}`}><Icon name="Square" className="h-3.5 w-3.5" />{d.kill ? "Turn kill switch off" : "Kill switch"}</button>
          <button disabled={!!busy || !d.positions.length} onClick={async () => {
            const phrase = `CLOSE ${d.name.toUpperCase()}`;
            const typed = live ? await promptDialog({ title: "Sell everything this strategy holds?", body: "Only this strategy's own holdings are sold; your other positions are never touched. Sales can realise taxable gains or losses.", label: `Type ${phrase}`, match: phrase, confirmLabel: "Sell all", tone: "danger" }) : (await confirmDialog({ title: "Sell everything this paper strategy holds?", confirmLabel: "Sell all", tone: "danger" })) ? "" : null;
            if (typed !== null) await act("close", () => call(`/api/algo/strategies/${id}/liquidate`, json("POST", { confirmation: typed }), ask));
          }} className="ctl flex items-center gap-1 border border-line px-2.5 py-1.5 text-[12px] text-fg hover:bg-elevated disabled:opacity-50"><Icon name="X" className="h-3.5 w-3.5" />Close all</button>
        </div>
      </header>
      {error && <p className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      <nav className="-mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {(["overview", "backtest", "settings"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`ctl shrink-0 px-3 py-1.5 text-[12.5px] ${tab === t ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated"}`}>{t === "overview" ? (d.mode === "paper" ? "Paper dashboard" : live ? "Live dashboard" : "Overview") : t === "backtest" ? "Backtest" : "Settings and mode"}</button>)}
      </nav>
      {tab === "overview" && (
        <div className="space-y-3">
          {proposed.map((b) => <ApproveBatch key={b.id} batch={b} onDone={() => { void load(); reloadHub(); }} />)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Equity" value={usd(d.equity, false)} interval={d.mode === "paper" ? "paper account" : `capital ${usd(d.spec.capitalUsd, false)}`} />
            <Stat label="Return" value={pct(d.equity / d.spec.capitalUsd - 1, 2)} interval={d.curve.length > 1 ? `since ${d.curve[0].date}` : null} />
            <Stat label="Cash" value={d.cash === null ? "–" : usd(d.cash, false)} />
            <Stat label="Realised P&L" value={d.realized === null ? "–" : usd(d.realized, false)} />
          </div>
          <div className="panel p-3">{d.curve.length > 1 ? <LinesChart title={d.mode === "paper" ? "Paper equity, indexed to 100 (simulated fills on real prices)" : "Equity, indexed to 100"} lines={[{ name: "Strategy", points: d.curve, color: "var(--accent)" }, { name: d.spec.benchmark, points: d.benchmarkCurve, color: "var(--chart-dim)" }]} /> : <p className="text-[12px] text-muted">The curve starts after the first day&apos;s mark. {d.status === "active" && d.mode !== "backtest" ? "Ticks follow the strategy's schedule; Run now decides at once." : ""}</p>}</div>
          <section className="panel p-3"><h3 className="mb-2 text-[12.5px] font-semibold text-fg">Risk limits used</h3><RiskGauges gauges={d.risk} /></section>
          <section className="panel p-3">
            <h3 className="mb-2 text-[12.5px] font-semibold text-fg">Positions {live ? "(this strategy's own; your other holdings are never touched)" : ""}</h3>
            {d.positions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[12px]"><thead><tr className="text-left text-muted"><th className="py-1">Symbol</th><th className="text-right">Units</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">Weight</th></tr></thead>
              <tbody>{d.positions.map((p) => <tr key={p.symbol} className="border-t border-line"><td className="py-1.5 font-semibold text-fg">{p.symbol}</td><td className="num text-right">{num(p.units, 4)}</td><td className="num text-right">{p.price ? p.price.toFixed(2) : "–"}</td><td className="num text-right">{usd(p.value, false)}</td><td className="num text-right">{pct(p.weight)}</td></tr>)}</tbody></table></div> : <p className="text-[12px] text-muted">No positions.</p>}
          </section>
          <section className="panel p-3">
            <h3 className="mb-2 text-[12.5px] font-semibold text-fg">Orders</h3>
            {d.orders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12px]"><thead><tr className="text-left text-muted"><th className="py-1">When</th><th>Order</th><th className="text-right">Limit</th><th className="text-right">Filled</th><th>Status</th><th /></tr></thead>
              <tbody>{d.orders.map((o) => (
                <tr key={o.id} className="border-t border-line align-top">
                  <td className="py-1.5 text-muted">{when(o.at)}</td>
                  <td><span className={o.action === "BUY" ? "text-pos" : "text-neg"}>{o.action}</span> {num(o.units, 4)} {o.symbol}{o.slices > 1 ? <span className="text-muted"> · slice {o.slice + 1}/{o.slices}</span> : null}{o.error && <div className="max-w-[320px] text-[11px] text-muted">{o.error}</div>}</td>
                  <td className="num text-right">{o.limitPrice?.toFixed(2) ?? "mkt"}</td>
                  <td className="num text-right">{o.filledUnits ? `${num(o.filledUnits, 4)} @ ${o.fillPrice?.toFixed(2) ?? "–"}` : "–"}</td>
                  <td className={STATUS_TONE[o.status] ?? "text-fg"}>{o.status === "unknown" ? "unknown: check your broker" : o.status.replace("_", " ")}</td>
                  <td className="text-right">{["accepted", "partially_filled", "scheduled", "pending"].includes(o.status) && <button onClick={() => act(`cancel-${o.id}`, () => call(`/api/algo/orders/${o.id}`, json("DELETE", {}), ask))} className="text-[11px] text-muted underline hover:text-fg">Cancel</button>}</td>
                </tr>
              ))}</tbody></table></div> : <p className="text-[12px] text-muted">No orders yet.</p>}
            <p className="mt-2 text-[11px] text-muted">An order marked unknown got no answer from the broker. It is never sent again automatically; the next tick asks the broker what happened.</p>
          </section>
          <section className="panel p-3">
            <h3 className="mb-2 text-[12.5px] font-semibold text-fg">Decisions and why</h3>
            {d.decisions.length ? <ul className="space-y-2">{d.decisions.map((x) => <li key={x.id} className="border-t border-line pt-2 text-[12px]"><div className="flex flex-wrap justify-between gap-2 text-muted"><span>{when(x.at)} · {x.source === "engine" ? "its rules" : x.source === "agent" ? "your instruction via the agent" : "you"}</span><span>{x.orders} order{x.orders === 1 ? "" : "s"} · {Object.entries(x.target).map(([k, v]) => `${k} ${pct(v, 0)}`).join(", ") || "cash"}</span></div><p className="mt-1 leading-relaxed text-fg">{x.notes}</p></li>)}</ul> : <p className="text-[12px] text-muted">No decisions yet.</p>}
          </section>
        </div>
      )}
      {tab === "backtest" && <BacktestPanel strategyId={id} initial={d.backtest?.result ?? null} />}
      {tab === "settings" && (
        <div className="space-y-3">
          <ModePanel d={d} hub={hub} onChanged={() => { void load(); reloadHub(); }} />
          <section className="panel p-3"><h3 className="mb-2 text-[13px] font-semibold text-fg">Edit the strategy</h3><StrategyEditor templates={hub.templates} initial={d.spec as never} strategyId={id} riskConfirmed={!!d.riskConfirmedAt} onSaved={() => { void load(); reloadHub(); }} onCancel={() => setTab("overview")} /></section>
          <button onClick={async () => { if (await confirmDialog({ title: "Archive this strategy?", body: "It stops, its unsent batches are canceled and it leaves the list. Its audit log stays.", confirmLabel: "Archive", tone: "danger" })) await act("archive", async () => { await call(`/api/algo/strategies/${id}`, json("DELETE", {}), ask); onBack(); }); }} className="text-[12px] text-neg underline">Archive strategy</button>
        </div>
      )}
    </div>
  );
}

/** Approve a proposed batch once: a fresh key per screen, the typed phrase for large batches, a tick of the box. */
function ApproveBatch({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const ask = useAlgoConsent();
  const key = useMemo(() => newKey(), []);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phrase = batch.confirmation;
  const approve = async () => {
    setBusy(true); setError(null);
    try { const r = await call<{ message: string; blocked: { ticker: string; reasons: string[] }[] }>(`/api/algo/batches/${batch.id}`, json("POST", { idempotencyKey: key, confirmation: typed }), ask); setResult(`${r.message}${r.blocked.length ? ` Blocked by the risk engine: ${r.blocked.map((b) => `${b.ticker} (${b.reasons[0]})`).join("; ")}` : ""}`); onDone(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel border-accent/50 p-3">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Icon name="Bell" className="h-3.5 w-3.5 text-accent" />{batch.orderCount} order{batch.orderCount === 1 ? "" : "s"} waiting for your approval <span className="text-[11px] font-normal text-muted">expires {when(batch.expiresAt)}</span></h3>
      <ul className="mt-2 divide-y divide-line text-[12px]">{batch.orders.filter((o) => o.status === "pending" || o.status === "scheduled").map((o) => <li key={o.id} className="flex justify-between gap-2 py-1"><span><span className={o.action === "BUY" ? "text-pos" : "text-neg"}>{o.action}</span> {num(o.units, 4)} {o.symbol}{o.slices > 1 ? ` (slice ${o.slice + 1}/${o.slices}${o.notBefore ? `, ${when(o.notBefore)}` : ""})` : ""}</span><span className="num text-muted">{o.limitPrice ? `limit ${o.limitPrice.toFixed(2)}` : "market"} · ≈{usd(o.estValue, false)}</span></li>)}</ul>
      <p className="mt-2 text-[11px] text-muted">Buys ≈{usd(batch.buyValue, false)}, sells ≈{usd(batch.sellValue, false)}. The risk engine checks each order again before it goes; later TWAP slices go at their times under this approval. Sells can realise taxable gains or losses.</p>
      {result ? <p className="mt-2 text-[12px] text-fg">{result}</p> : (
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2 text-[12px] text-fg"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />I checked these orders and want them sent to my broker.</label>
          {phrase && <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${phrase}`} className="ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px]" />}
          {error && <p className="text-[12px] text-neg">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={async () => { try { await call(`/api/algo/batches/${batch.id}`, json("DELETE", {}), ask); onDone(); } catch (e) { setError(errorMessage(e)); } }} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted">Cancel batch</button>
            <button onClick={approve} disabled={busy || !checked || (!!phrase && typed.trim().toUpperCase() !== phrase)} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Sending…" : "Approve and send"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The mode switch with the live checklist, the account picker and the typed confirmations. */
function ModePanel({ d, hub, onChanged }: { d: Detail; hub: Hub; onChanged: () => void }) {
  const ask = useAlgoConsent();
  const [mode, setMode] = useState(d.mode);
  const [conn, setConn] = useState(d.connection ?? "paper");
  const [accounts, setAccounts] = useState<{ id: string; name: string; number: string; paper: boolean; type: string; tradingAllowed: boolean }[]>([]);
  const [account, setAccount] = useState(d.accountId ?? "");
  const [typed, setTyped] = useState("");
  const [override, setOverride] = useState("");
  const [unmet, setUnmet] = useState<Unmet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (conn === "paper") return;
    let live = true;
    fetchJson<{ accounts: typeof accounts }>(`/api/algo/connections/accounts?ref=${encodeURIComponent(conn)}`).then((r) => { if (live) setAccounts(r.accounts); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [conn]);
  const list = mode === "live_auto" ? d.live.autonomous : mode === "live_approval" ? d.live.approval : [];
  const saveAccount = async () => {
    setBusy(true); setError(null);
    try { await call(`/api/algo/strategies/${d.id}`, json("PATCH", { connection: conn, accountId: conn === "paper" ? null : account }), ask); onChanged(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const switchMode = async () => {
    setBusy(true); setError(null); setUnmet(null);
    try {
      if (mode === "live_approval" || mode === "live_auto") { if (!hub.consents.live && !(await ask("live"))) return; }
      const res = await fetch(`/api/algo/strategies/${d.id}/mode`, json("POST", { mode, typed, gradeOverride: override || undefined }));
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(body.unmet)) setUnmet(body.unmet);
      else if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "The mode could not be changed.");
      else onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel space-y-3 p-3">
      <h3 className="text-[13px] font-semibold text-fg">Mode</h3>
      <div className="grid gap-2 sm:grid-cols-4">
        {(["backtest", "paper", "live_approval", "live_auto"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-md border p-2.5 text-left ${mode === m ? "border-accent bg-accent-soft" : "border-line hover:bg-elevated"}`}>
            <div className="flex items-center justify-between gap-1 text-[12.5px] font-semibold text-fg">{MODE_LABEL[m]}{m === "live_approval" && <PremiumBadge feature="algo.live" />}{m === "live_auto" && <PremiumBadge feature="algo.autonomous" />}</div>
            <div className="mt-1 text-[11px] text-muted">{m === "backtest" ? "Only backtests; nothing runs on a schedule." : m === "paper" ? "Simulated fills on real prices. The default." : m === "live_approval" ? "Real orders, each batch waits for your tap." : `Trades within its limits without asking, after ${hub.server.minPaperDays} days on paper.`}</div>
          </button>
        ))}
      </div>
      {(mode === "live_approval" || mode === "live_auto") && (
        <div className="space-y-2 rounded-md border border-line p-2.5">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[11.5px] text-muted">Connection<select value={conn} onChange={(e) => { setConn(e.target.value); setAccount(""); setAccounts([]); }} className="ctl mt-1 w-full border border-line bg-panel px-2 py-2 text-[12.5px] text-fg">{d.connections.map((c) => <option key={c.ref} value={c.ref}>{c.label}</option>)}</select></label>
            {conn !== "paper" && <label className="text-[11.5px] text-muted">Account<select value={account} onChange={(e) => setAccount(e.target.value)} className="ctl mt-1 w-full border border-line bg-panel px-2 py-2 text-[12.5px] text-fg"><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.tradingAllowed}>{a.name} {a.number}{a.paper ? " (paper)" : ""}{a.type !== "unknown" ? ` · ${a.type}` : ""}{a.tradingAllowed ? "" : " · no trading"}</option>)}</select></label>}
            <div className="flex items-end"><button onClick={saveAccount} disabled={busy || d.mode.startsWith("live") || (conn !== "paper" && !account)} className="ctl w-full border border-line px-3 py-2 text-[12.5px] text-fg hover:bg-elevated disabled:opacity-50">Use this account</button></div>
          </div>
          {d.mode.startsWith("live") && <p className="text-[11px] text-muted">Move the strategy to paper to change its account.</p>}
          <h4 className="text-[12px] font-semibold text-fg">Before it can trade for real</h4>
          {list.length ? <ul className="space-y-1 text-[12px]">{list.map((u) => <li key={u.key} className="flex gap-1.5 text-fg"><Icon name="X" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neg" />{u.message}</li>)}</ul> : <p className="flex items-center gap-1.5 text-[12px] text-pos"><Icon name="Check" className="h-3.5 w-3.5" />Everything is in place{mode === "live_auto" ? " except the typed confirmation" : ""}.</p>}
          {d.live.integrity && <p className="text-[11.5px] text-muted">Quant integrity grade {d.live.integrity.grade}.{["D", "F"].includes(d.live.integrity.grade) ? ` Type OVERRIDE GRADE ${d.live.integrity.grade} to trade it live anyway (it is logged).` : ""}</p>}
          {d.live.integrity && ["D", "F"].includes(d.live.integrity.grade) && <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder={`OVERRIDE GRADE ${d.live.integrity.grade}`} className="ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px]" />}
          {mode === "live_auto" && (
            <div className="rounded-md border border-neg/40 bg-neg/5 p-2.5 text-[12px]">
              <p className="font-semibold text-fg">{hub.consentTexts.autonomous.title}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{hub.consentTexts.autonomous.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${d.live.phrase}`} className="ctl mt-2 w-full border border-line bg-panel px-2.5 py-2 text-[13px]" />
            </div>
          )}
        </div>
      )}
      {unmet && <ul className="space-y-1 rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-fg">{unmet.map((u) => <li key={u.key}>{u.message}</li>)}</ul>}
      {error && <p className="text-[12px] text-neg">{error}</p>}
      <div className="flex justify-end"><button onClick={switchMode} disabled={busy || mode === d.mode} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Checking…" : `Switch to ${MODE_LABEL[mode].toLowerCase()}`}</button></div>
    </section>
  );
}
