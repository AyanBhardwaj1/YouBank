"use client";

/**
 * Create or change a copy: which fund (or a blend, Deal Team), paper or live (Pro), its size, the clone
 * rules (top N, minimum weight, excluded tickers and sectors) and, for live copies, the account and the
 * order safety settings. The server checks every plan and limit again; this form only explains them.
 */
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { NOT_ADVICE_SHORT, TIMING } from "@/lib/copytrade/disclosures";
import { SECTOR_LABEL } from "@/lib/copytrade/funds";
import { call, json } from "./client";
import { Modal, useConsent } from "./Consent";

export type FundRef = { cik: string; name: string; weight: number };
export type CopyDraft = {
  id?: number; name: string; mode: "paper" | "live"; funds: FundRef[];
  rules: { topN: number; minWeight: number; excludeTickers: string[]; excludeSectors: string[] };
  sizing: { kind: "usd" | "pct"; amount: number };
  trading: { orderType: "Limit" | "Market"; limitBandPct: number; maxOrderUsd: number; maxDayUsd: number; minOrderUsd: number; sellOutside: boolean; useSaleProceeds: boolean; cashBufferPct: number };
  accountId: string | null;
};
export type Plan = { broker: boolean; blends: boolean; liveCopies: number; paperCopies: number };
export type Account = { id: string; name: string; number: string; institution: string; paper: boolean; total: number | null; trading: boolean; fractional: boolean; brokerage: string };

export const newDraft = (funds: FundRef[]): CopyDraft => ({
  name: "", mode: "paper", funds, rules: { topN: 20, minWeight: 0, excludeTickers: [], excludeSectors: [] }, sizing: { kind: "usd", amount: 10_000 },
  trading: { orderType: "Limit", limitBandPct: 0.5, maxOrderUsd: 5_000, maxDayUsd: 10_000, minOrderUsd: 5, sellOutside: false, useSaleProceeds: true, cashBufferPct: 0.5 }, accountId: null,
});

const field = "ctl w-full border border-line bg-bg px-2.5 py-2 text-[12.5px] text-fg outline-none focus:border-accent";
const label = "mb-1 block text-[11px] font-medium text-muted";

export function CopyEditor({ draft: initial, plan, onClose, onSaved }: { draft: CopyDraft; plan: Plan | null; onClose: () => void; onSaved: (id: number) => void }) {
  const [d, setD] = useState<CopyDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ cik: string; name: string }[]>([]);
  const consent = useConsent();
  const set = <K extends keyof CopyDraft>(k: K, v: CopyDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (d.mode !== "live" || accounts) return;
    fetchJson<{ accounts: Account[] }>("/api/copy/broker").then((r) => setAccounts(r.accounts)).catch(() => setAccounts([]));
  }, [d.mode, accounts]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => fetchJson<{ results: { cik: string; name: string }[] }>(`/api/copy/funds?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then((r) => setHits(r.results.slice(0, 6))).catch(() => undefined), 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = { ...d, rules: { ...d.rules, minWeight: d.rules.minWeight } };
      const r = await call<{ id: number }>(d.id ? `/api/copy/copies/${d.id}` : "/api/copy/copies", json(d.id ? "PATCH" : "POST", body), consent);
      onSaved(r.id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const blend = d.funds.length > 1;
  return (
    <Modal title={d.id ? "Copy settings" : "Copy a fund"} onClose={onClose} wide>
      <p className="mb-3 flex gap-2 rounded-md border border-line bg-elevated p-2.5 text-[11.5px] leading-relaxed text-muted"><Icon name="Hourglass" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{TIMING}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3">
          <div>
            <span className={label}>Fund{blend ? "s (a blend)" : ""}</span>
            <ul className="space-y-1.5">
              {d.funds.map((f, i) => (
                <li key={f.cik} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{f.name || `CIK ${Number(f.cik)}`}</span>
                  {blend && <input type="number" min={1} max={100} value={f.weight} onChange={(e) => set("funds", d.funds.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} className={`${field} w-16 text-right`} aria-label="Weight" />}
                  {d.funds.length > 1 && <button onClick={() => set("funds", d.funds.filter((_, j) => j !== i))} className="ctl p-1 text-muted hover:text-neg" aria-label="Remove"><Icon name="X" className="h-3.5 w-3.5" /></button>}
                </li>
              ))}
            </ul>
            {!d.id && (
              <div className="mt-2">
                <div className="flex items-center gap-2 text-[11px] text-muted">Add a fund to make a blend <PremiumBadge feature="copytrade.blends" /></div>
                {plan?.blends ? (
                  <>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 13F filers" className={`${field} mt-1`} />
                    {q.trim().length >= 2 && hits.filter((h) => !d.funds.some((f) => f.cik === h.cik)).map((h) => (
                      <button key={h.cik} onClick={() => { set("funds", [...d.funds, { cik: h.cik, name: h.name, weight: 1 }]); setQ(""); setHits([]); }} className="mt-1 block w-full truncate rounded px-2 py-1.5 text-left text-[12px] text-fg hover:bg-elevated">{h.name}</button>
                    ))}
                  </>
                ) : <p className="mt-1 text-[11px] text-muted">Blends of several funds are part of the Deal Team plan.</p>}
              </div>
            )}
          </div>
          <div>
            <span className={label}>Name</span>
            <input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={blend ? "Fund blend" : `${d.funds[0]?.name ?? "Fund"} copy`} className={field} />
          </div>
          {!d.id && (
            <div>
              <span className={label}>Kind</span>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => set("mode", "paper")} className={`ctl border p-2.5 text-left ${d.mode === "paper" ? "border-accent bg-accent-soft" : "border-line"}`}><div className="text-[12.5px] font-semibold text-fg">Paper</div><div className="text-[11px] text-muted">Free. Pretend money, tracked from today.</div></button>
                <button onClick={() => set("mode", "live")} className={`ctl border p-2.5 text-left ${d.mode === "live" ? "border-accent bg-accent-soft" : "border-line"}`}><div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">Live <PremiumBadge feature="copytrade.broker" /></div><div className="text-[11px] text-muted">Your broker. You approve every batch.</div></button>
              </div>
            </div>
          )}
          <div>
            <span className={label}>Size</span>
            <div className="flex gap-2">
              {d.mode === "live" && (
                <select value={d.sizing.kind} onChange={(e) => set("sizing", { kind: e.target.value as "usd" | "pct", amount: e.target.value === "pct" ? 10 : 10_000 })} className={`${field} w-36`}>
                  <option value="usd">Dollar amount</option><option value="pct">% of account</option>
                </select>
              )}
              <input type="number" min={d.sizing.kind === "pct" ? 1 : 100} value={d.sizing.amount} onChange={(e) => set("sizing", { ...d.sizing, amount: Number(e.target.value) })} className={field} aria-label="Amount" />
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className={label}>Largest positions to hold</span>
              <select value={d.rules.topN} onChange={(e) => set("rules", { ...d.rules, topN: Number(e.target.value) })} className={field}>
                {[5, 10, 15, 20, 30, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}<option value={0}>All</option>
              </select>
            </div>
            <div>
              <span className={label}>Skip positions under</span>
              <select value={d.rules.minWeight} onChange={(e) => set("rules", { ...d.rules, minWeight: Number(e.target.value) })} className={field}>
                {[0, 0.005, 0.01, 0.02, 0.03, 0.05].map((n) => <option key={n} value={n}>{n ? `${n * 100}%` : "No minimum"}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span className={label}>Never hold these tickers</span>
            <input value={d.rules.excludeTickers.join(", ")} onChange={(e) => set("rules", { ...d.rules, excludeTickers: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="e.g. TSLA, BRK.B" className={field} />
          </div>
          <div>
            <span className={label}>Leave out sectors</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SECTOR_LABEL).filter(([k]) => k !== "other").map(([k, v]) => {
                const on = d.rules.excludeSectors.includes(k);
                return <button key={k} onClick={() => set("rules", { ...d.rules, excludeSectors: on ? d.rules.excludeSectors.filter((s) => s !== k) : [...d.rules.excludeSectors, k] })} className={`rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-neg/60 bg-neg/10 text-neg" : "border-line text-muted hover:text-fg"}`}>{v}</button>;
              })}
            </div>
          </div>
          {d.mode === "live" && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <div>
                <span className={label}>Brokerage account</span>
                {accounts === null ? <p className="text-[11.5px] text-muted">Loading accounts…</p> : accounts.length ? (
                  <select value={d.accountId ?? ""} onChange={(e) => set("accountId", e.target.value || null)} className={field}>
                    <option value="">Choose an account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.trading}>{a.brokerage} {a.name} {a.number}{a.paper ? " (broker's paper account)" : ""}{!a.trading ? " (no trading)" : ""}</option>)}
                  </select>
                ) : <p className="text-[11.5px] text-muted">Connect a broker first, under Brokerage.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className={label}>Order type</span><select value={d.trading.orderType} onChange={(e) => set("trading", { ...d.trading, orderType: e.target.value as "Limit" | "Market" })} className={field}><option value="Limit">Limit (recommended)</option><option value="Market">Market</option></select></div>
                <div><span className={label}>Limit band</span><select value={d.trading.limitBandPct} onChange={(e) => set("trading", { ...d.trading, limitBandPct: Number(e.target.value) })} className={field} disabled={d.trading.orderType === "Market"}>{[0.1, 0.25, 0.5, 1, 2].map((n) => <option key={n} value={n}>{n}% from last price</option>)}</select></div>
                <div><span className={label}>Most per order ($)</span><input type="number" min={10} value={d.trading.maxOrderUsd} onChange={(e) => set("trading", { ...d.trading, maxOrderUsd: Number(e.target.value) })} className={field} /></div>
                <div><span className={label}>Most per day ($)</span><input type="number" min={10} value={d.trading.maxDayUsd} onChange={(e) => set("trading", { ...d.trading, maxDayUsd: Number(e.target.value) })} className={field} /></div>
                <div><span className={label}>Smallest order ($)</span><input type="number" min={1} value={d.trading.minOrderUsd} onChange={(e) => set("trading", { ...d.trading, minOrderUsd: Number(e.target.value) })} className={field} /></div>
                <div><span className={label}>Keep in cash</span><select value={d.trading.cashBufferPct} onChange={(e) => set("trading", { ...d.trading, cashBufferPct: Number(e.target.value) })} className={field}>{[0, 0.5, 1, 2, 5].map((n) => <option key={n} value={n}>{n}% of cash</option>)}</select></div>
              </div>
              <label className="flex items-start gap-2 text-[11.5px] text-fg"><input type="checkbox" checked={d.trading.useSaleProceeds} onChange={(e) => set("trading", { ...d.trading, useSaleProceeds: e.target.checked })} className="mt-0.5" />Let buys use the money from this batch&apos;s sells</label>
              <label className="flex items-start gap-2 text-[11.5px] text-fg"><input type="checkbox" checked={d.trading.sellOutside} onChange={(e) => set("trading", { ...d.trading, sellOutside: e.target.checked })} className="mt-0.5" /><span>Count shares I already own in the fund&apos;s tickers toward this copy, and allow selling them. <span className="text-muted">Off by default: positions you hold outside the copy are never sold. Holdings in other tickers are never touched either way.</span></span></label>
            </div>
          )}
        </section>
      </div>
      <p className="mt-3 text-[11px] text-muted">{NOT_ADVICE_SHORT}</p>
      {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Cancel</button>
        <button onClick={save} disabled={busy || !d.funds.length} className="ctl bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Saving…" : d.id ? "Save" : d.mode === "paper" ? "Start paper copy" : "Create live copy"}</button>
      </div>
    </Modal>
  );
}
