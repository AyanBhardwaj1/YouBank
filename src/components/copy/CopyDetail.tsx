"use client";

/**
 * One copy. A paper copy shows its record against SPY, its holdings and its rebalances. A live copy shows
 * its targets, what it holds through its own filled orders, and the review-and-approve flow: build the
 * orders (nothing is sent), read every line, then approve once. Large batches ask for a typed
 * confirmation; a double tap or a retry carries the same key and sends nothing twice.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PremiumGate } from "@/components/billing/Premium";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { HYPOTHETICAL, NOT_ADVICE_SHORT, TIMING } from "@/lib/copytrade/disclosures";
import type { Proposal } from "@/lib/copytrade/rebalance";
import { LinesChart } from "./charts";
import { call, json, newKey, num, pct, usd } from "./client";
import { useConsent } from "./Consent";
import { CopyEditor, type CopyDraft, type Plan } from "./CopyEditor";

type Order = { id: number; seq: number; ticker: string; action: "BUY" | "SELL"; units: number; orderType: string; limitPrice: number | null; estValue: number; status: string; brokerageOrderId: string | null; error: string | null; filledUnits?: number; fillPrice?: number | null };
type Batch = { id: number; status: string; createdAt: string; approvedAt: string | null; expiresAt: string; buyValue: number; sellValue: number; orderCount: number; confirmation: string | null; orders: Order[] };
type Perf = { startCash: number; startedAt: string; value: number; gain: number; gainPct: number; curve: { date: string; value: number }[]; spy: { date: string; value: number }[]; metrics: { cagr: number; volatility: number; maxDrawdown: number; sharpe: number | null; beta: number | null } | null; holdings: { ticker: string; units: number; price: number | null; value: number }[]; cash: number; events: { date: string; label: string; positions: number }[] };
type Detail = { copy: CopyDraft & { id: number; status: string; managed: Record<string, number>; createdAt: string }; targets: { targets: { ticker: string; weight: number; name: string }[]; funds: { cik: string; period: string | null; coverage: number | null }[] }; performance: Perf | null; batches: Batch[] };
type Review = { batchId: number; proposal: Proposal; confirmation: string | null; expiresAt: string; market: { open: boolean; reason: string; nextOpen: string; closesAt: string | null }; trading: boolean; account: { brokerage: string; name: string; number: string; fractional: boolean } | null; targets: { ticker: string; weight: number; name: string }[]; unresolved: string[] };

const STATUS_STYLE = (s: string) => (/EXECUTED|placed|ACCEPTED|PARTIAL$/i.test(s) ? "text-pos" : /reject|FAILED|CANCEL|EXPIRED/i.test(s) ? "text-neg" : /unknown/i.test(s) ? "text-accent" : "text-muted");

export function CopyDetail({ id, plan, startReview, onChanged }: { id: number; plan: Plan | null; startReview?: boolean; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState(newKey);
  const consent = useConsent();

  const load = useCallback(() => fetchJson<Detail>(`/api/copy/copies/${id}`).then(setD).catch((e) => setError(errorMessage(e))), [id]);
  useEffect(() => { void load(); }, [load]);

  const propose = useCallback(async () => {
    setBusy("propose"); setError(null); setResult(null);
    try { setReview(await call<Review>(`/api/copy/copies/${id}/propose`, json("POST"), consent)); setKey(newKey()); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }, [id, consent]);
  useEffect(() => {
    if (!(startReview && d?.copy.mode === "live" && plan?.broker)) return;
    const t = setTimeout(() => void propose(), 0);
    return () => clearTimeout(t);
  }, [startReview, d?.copy.mode, plan?.broker, propose]);

  const approve = async () => {
    if (!review) return;
    let confirmation = "";
    if (review.confirmation) {
      const typed = await promptDialog({ title: "Approve a large batch", body: `This sends ${review.proposal.orders.length} orders worth about ${usd(review.proposal.summary.buys + review.proposal.summary.sells, false)} to ${review.account?.brokerage ?? "your broker"}. Type ${review.confirmation} to approve.`, label: "Confirmation", match: review.confirmation, confirmLabel: "Approve and send" });
      if (!typed) return;
      confirmation = typed;
    } else if (!(await confirmDialog({ title: "Send these orders?", body: `${review.proposal.orders.length} orders go to ${review.account?.brokerage ?? "your broker"} now. You decide; nothing else is sent.`, confirmLabel: "Approve and send" }))) return;
    setBusy("approve"); setError(null);
    try {
      const r = await call<{ outcome: string; message: string }>(`/api/copy/batches/${review.batchId}`, json("POST", { idempotencyKey: key, confirmation }), consent);
      setResult(r.message); setReview(null); await load(); onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!review) return;
    await fetchJson(`/api/copy/batches/${review.batchId}`, json("DELETE")).catch(() => undefined);
    setReview(null);
  };
  const refresh = async (batchId: number) => { setBusy(`refresh-${batchId}`); try { await fetchJson(`/api/copy/batches/${batchId}`); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); } };
  const setStatus = async (status: "paused" | "active") => { try { await fetchJson(`/api/copy/copies/${id}`, json("PATCH", { status })); await load(); onChanged(); } catch (e) { setError(errorMessage(e)); } };
  const close = async () => {
    if (!(await confirmDialog({ title: "Close this copy?", body: d?.copy.mode === "live" ? "Unsent proposals are canceled. Shares already bought stay in your account; nothing is sold." : "Its paper record is removed from your list.", tone: "danger", confirmLabel: "Close copy" }))) return;
    try { await fetchJson(`/api/copy/copies/${id}`, json("DELETE")); onChanged(); } catch (e) { setError(errorMessage(e)); }
  };

  const lines = useMemo(() => d?.performance ? [
    { name: "Paper copy", points: d.performance.curve, color: "var(--chart-1)" },
    { name: "SPY (same money)", points: d.performance.spy, color: "var(--chart-emphasis)" },
  ] : [], [d]);

  if (!d) return error ? <p className="panel p-4 text-[12.5px] text-neg">{error}</p> : <div className="shimmer h-64 rounded-md" />;
  const c = d.copy;
  const p = d.performance;
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-start justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-fg">{c.name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ${c.mode === "live" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{c.mode}</span>
            {c.status === "paused" && <span className="rounded-full bg-elevated px-2 py-0.5 text-[10.5px] text-muted">Paused</span>}
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{c.funds.map((f) => `${f.name}${c.funds.length > 1 ? ` ${f.weight}` : ""}`).join(" · ")} · top {c.rules.topN || "all"} · {c.sizing.kind === "pct" ? `${c.sizing.amount}% of the account` : usd(c.sizing.amount, false)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing(true)} className="ctl border border-line px-2.5 py-1.5 text-[12px] text-fg hover:border-line-strong">Settings</button>
          <button onClick={() => setStatus(c.status === "paused" ? "active" : "paused")} className="ctl border border-line px-2.5 py-1.5 text-[12px] text-fg hover:border-line-strong">{c.status === "paused" ? "Resume" : "Pause"}</button>
          <button onClick={close} className="ctl border border-line px-2.5 py-1.5 text-[12px] text-neg hover:border-neg/50">Close</button>
        </div>
      </div>
      {error && <p className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {result && <p className="rounded-md border border-pos/40 bg-pos/10 p-2.5 text-[12px] text-pos">{result}</p>}

      {c.mode === "paper" && p && (
        <div className="panel p-3.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Value</div><div className="num text-[18px] font-semibold text-fg">{usd(p.value, false)}</div></div>
            <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Since {p.startedAt}</div><div className={`num text-[18px] font-semibold ${p.gain >= 0 ? "text-pos" : "text-neg"}`}>{pct(p.gainPct, 1, true)}</div></div>
            <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Max drawdown</div><div className="num text-[18px] font-semibold text-fg">{pct(p.metrics?.maxDrawdown)}</div></div>
            <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Beta to SPY</div><div className="num text-[18px] font-semibold text-fg">{p.metrics?.beta?.toFixed(2) ?? "–"}</div></div>
          </div>
          <div className="mt-3"><LinesChart title="Paper copy and SPY, same starting money" lines={lines} format={(v) => usd(v)} /></div>
          <p className="mt-2 text-[11px] text-muted">Paper results are hypothetical: fractional shares at each day&apos;s prices, no fees, taxes or dividends. {HYPOTHETICAL.split(". ").slice(-1)[0]}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-[12px] font-semibold text-fg">Holdings</h3>
              <ul className="space-y-1 text-[11.5px]">{p.holdings.slice(0, 20).map((h) => <li key={h.ticker} className="flex justify-between gap-2"><span className="text-fg">{h.ticker} <span className="text-muted">{num(h.units, 3)} sh</span></span><span className="num text-muted">{usd(h.value, false)}</span></li>)}<li className="flex justify-between border-t border-line pt-1 text-muted"><span>Cash</span><span className="num">{usd(p.cash, false)}</span></li></ul>
            </div>
            <div>
              <h3 className="mb-1 text-[12px] font-semibold text-fg">Rebalances</h3>
              <ul className="space-y-1 text-[11.5px]">{p.events.map((e, i) => <li key={`${e.date}-${i}`} className="flex justify-between gap-2"><span className="text-fg">{e.label}</span><span className="text-muted">{e.date} · {e.positions} positions</span></li>)}</ul>
              <p className="mt-2 text-[11px] text-muted">{TIMING}</p>
            </div>
          </div>
        </div>
      )}

      {c.mode === "live" && (
        <PremiumGate feature="copytrade.broker">
          <div className="panel p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold text-fg">Orders</h3>
                <p className="text-[11.5px] text-muted">When a fund files, you get a notice. Build the orders, check them, approve them. Nothing is sent without your approval.</p>
              </div>
              <button onClick={propose} disabled={busy === "propose" || c.status !== "active"} className="ctl flex items-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"><Icon name="ListChecks" className="h-3.5 w-3.5" />{busy === "propose" ? "Building…" : "Review orders"}</button>
            </div>
            {review && <ReviewPanel review={review} busy={busy === "approve"} onApprove={approve} onCancel={cancel} />}
            {d.batches.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1.5 text-[12px] font-semibold text-fg">Recent batches</h4>
                <ul className="space-y-2">
                  {d.batches.map((b) => (
                    <li key={b.id} className="rounded-md border border-line p-2.5 text-[11.5px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-fg">#{b.id} · {new Date(b.createdAt).toLocaleString()} · <span className={STATUS_STYLE(b.status)}>{b.status}</span></span>
                        <span className="flex items-center gap-2 text-muted">{b.orderCount} orders · buys {usd(b.buyValue)} · sells {usd(b.sellValue)}{b.approvedAt && <button onClick={() => refresh(b.id)} className="text-accent hover:underline">{busy === `refresh-${b.id}` ? "Checking…" : "Check status"}</button>}</span>
                      </div>
                      {b.approvedAt && b.orders.length > 0 && <ul className="mt-1.5 space-y-0.5">{b.orders.map((o) => <li key={o.id} className="flex flex-wrap justify-between gap-2"><span className="text-fg">{o.action} {num(o.units, 4)} {o.ticker} <span className="text-muted">{o.limitPrice ? `limit ${o.limitPrice}` : o.orderType.toLowerCase()}</span></span><span className={STATUS_STYLE(o.status)}>{o.status}{o.filledUnits ? ` · filled ${num(o.filledUnits, 4)}${o.fillPrice ? ` @ ${o.fillPrice}` : ""}` : ""}{o.error ? ` · ${o.error}` : ""}</span></li>)}</ul>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Object.keys(c.managed ?? {}).length > 0 && <p className="mt-3 text-[11px] text-muted">Held by this copy (from its filled orders): {Object.entries(c.managed).map(([t, u]) => `${t} ${num(u, 4)}`).join(", ")}. Other positions in the account are yours alone.</p>}
          </div>
        </PremiumGate>
      )}

      <div className="panel p-3.5">
        <h3 className="mb-1.5 text-[12px] font-semibold text-fg">Targets now</h3>
        {d.targets.targets.length ? (
          <ul className="grid gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">{d.targets.targets.map((t) => <li key={t.ticker} className="flex justify-between gap-2"><span className="truncate text-fg">{t.ticker} <span className="text-muted">{t.name}</span></span><span className="num text-fg">{pct(t.weight)}</span></li>)}</ul>
        ) : <p className="text-[11.5px] text-muted">No targets yet: the fund&apos;s filings are still being read.</p>}
        <p className="mt-2 text-[11px] text-muted">From {d.targets.funds.map((f) => `the quarter ended ${f.period ?? "–"}${f.coverage !== null ? ` (${pct(f.coverage, 0)} of value mapped to tickers)` : ""}`).join("; ")}. {NOT_ADVICE_SHORT}</p>
      </div>

      {editing && <CopyEditor draft={{ ...c, id: c.id }} plan={plan} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); onChanged(); }} />}
    </div>
  );
}

function ReviewPanel({ review, busy, onApprove, onCancel }: { review: Review; busy: boolean; onApprove: () => void; onCancel: () => void }) {
  const p = review.proposal;
  const [ack, setAck] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const expired = Date.parse(review.expiresAt) < now;
  const hasSells = p.orders.some((o) => o.action === "SELL");
  return (
    <div className="mt-3 rounded-md border border-accent/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <span className="text-fg"><b>{p.orders.length} orders</b> for {review.account?.brokerage} {review.account?.name} {review.account?.number}{review.account?.fractional ? " (fractional shares)" : " (whole shares)"}</span>
        <span className={review.market.open ? "text-pos" : "text-muted"}>{review.market.open ? `Market open until ${review.market.closesAt}` : `Market closed (${review.market.reason}); opens ${review.market.nextOpen}. Limit orders wait for the open.`}</span>
      </div>
      {!review.trading && <p className="mt-2 rounded-md bg-elevated p-2 text-[11.5px] text-muted"><Icon name="Lock" className="mr-1 inline h-3 w-3" />Real trading is switched off on this server, so these orders are for review only.</p>}
      {p.orders.length > 0 ? (
        <div className="-mx-1 mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11.5px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="px-1 py-1 font-medium">Order</th><th className="px-1 text-right font-medium">Shares</th><th className="px-1 text-right font-medium">Last</th><th className="px-1 text-right font-medium">Limit</th><th className="px-1 text-right font-medium">Estimate</th><th className="px-1 font-medium">Why</th></tr></thead>
            <tbody>{p.orders.map((o) => (
              <tr key={`${o.ticker}-${o.action}`} className="border-t border-line">
                <td className="px-1 py-1.5"><span className={`font-sans font-semibold ${o.action === "BUY" ? "text-pos" : "text-neg"}`}>{o.action === "BUY" ? "Buy" : "Sell"}</span> <span className="text-fg">{o.ticker}</span></td>
                <td className="px-1 text-right text-fg">{num(o.units, 4)}</td>
                <td className="px-1 text-right text-muted">{o.price.toFixed(2)}</td>
                <td className="px-1 text-right text-muted">{o.limitPrice ?? "market"}</td>
                <td className="px-1 text-right text-fg">{usd(o.estValue, false)}</td>
                <td className="px-1 font-sans text-muted">{({ new: "New position", add: "Add", trim: "Trim", exit: "Exit" } as Record<string, string>)[o.reason]}{o.fromOutside ? ` (${num(o.fromOutside, 4)} of your own shares)` : ""}{o.taxCaution ? " · tax" : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-[12px] text-muted">Nothing to do: the copy already matches its targets within your minimum order size.</p>}
      <div className="mt-2 grid gap-2 text-[11.5px] sm:grid-cols-3">
        <div className="rounded-md bg-elevated p-2"><div className="text-muted">Buys</div><div className="num text-fg">{usd(p.summary.buys, false)}</div></div>
        <div className="rounded-md bg-elevated p-2"><div className="text-muted">Sells</div><div className="num text-fg">{usd(p.summary.sells, false)}</div></div>
        <div className="rounded-md bg-elevated p-2"><div className="text-muted">Cash after (estimate)</div><div className="num text-fg">{usd(p.summary.cashAfterEst, false)}</div></div>
      </div>
      {(p.warnings.length > 0 || p.skipped.length > 0) && (
        <ul className="mt-2 space-y-1 text-[11.5px] text-muted">
          {p.warnings.map((w) => <li key={w} className="flex gap-1.5"><Icon name="AlertTriangle" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{w}</li>)}
          {p.skipped.map((s) => <li key={`${s.ticker}${s.reason}`} className="flex gap-1.5"><Icon name="X" className="mt-0.5 h-3 w-3 shrink-0" />{s.ticker}: {s.reason}</li>)}
        </ul>
      )}
      {p.orders.length > 0 && (
        <>
          <label className="mt-3 flex items-start gap-2 text-[11.5px] text-fg"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I checked these orders. I understand they are my decision, prices can move before they fill{hasSells ? ", and sells can realise taxable gains or losses" : ""}.</label>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {expired && <span className="text-[11.5px] text-muted">These prices are out of date. Build the orders again.</span>}
            <button onClick={onCancel} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Cancel</button>
            <button onClick={onApprove} disabled={!ack || busy || expired || !review.trading} className="ctl flex items-center gap-1.5 bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"><Icon name="Check" className="h-3.5 w-3.5" />{busy ? "Sending…" : "Approve and send"}</button>
          </div>
        </>
      )}
    </div>
  );
}
