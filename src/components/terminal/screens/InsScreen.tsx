"use client";

import { useEffect, useMemo, useState } from "react";
import type { InsiderTx } from "@/lib/edgar/insiders";
import { StatTile } from "../StatTile";
import { HBar } from "@/components/charts/HBar";

const money = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);

/** Form 4 insider transactions with buy/sell summary and net activity by insider. */
export function InsScreen({ ticker }: { ticker: string }) {
  const [rows, setRows] = useState<InsiderTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyOpenMarket, setOnlyOpenMarket] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/company/${ticker}/insiders?limit=20`, { signal: ctrl.signal }).then((r) => r.json()).then((r) => { if (r.error) setError(r.error); else setRows(r.transactions); }).catch(() => {});
    return () => ctrl.abort();
  }, [ticker]);
  const list = useMemo(() => (rows ?? []).filter((t) => !t.derivative && (!onlyOpenMarket || t.code === "P" || t.code === "S")), [rows, onlyOpenMarket]);
  const stats = useMemo(() => {
    const buys = list.filter((t) => t.code === "P"), sells = list.filter((t) => t.code === "S");
    const val = (ts: InsiderTx[]) => ts.reduce((a, t) => a + (t.shares ?? 0) * (t.price ?? 0), 0);
    const byOwner = new Map<string, number>();
    for (const t of list) if (t.code === "P" || t.code === "S") byOwner.set(t.owner, (byOwner.get(t.owner) ?? 0) + (t.code === "P" ? 1 : -1) * (t.shares ?? 0) * (t.price ?? 0));
    return { buys: buys.length, sells: sells.length, buyVal: val(buys), sellVal: val(sells), byOwner: [...byOwner.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8) };
  }, [list]);

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-4">
        <StatTile label="Open-market buys" value={String(stats.buys)} delta={stats.buyVal ? money(stats.buyVal) : undefined} deltaGood />
        <StatTile label="Open-market sales" value={String(stats.sells)} delta={stats.sellVal ? money(stats.sellVal) : undefined} deltaGood={false} />
        <StatTile label="Net insider flow" value={money(stats.buyVal - stats.sellVal)} deltaGood={stats.buyVal - stats.sellVal >= 0} hint="Purchases less sales in the filings shown; excludes awards, exercises, and tax withholding" />
        <StatTile label="Filings read" value={String(new Set((rows ?? []).map((t) => t.url)).size)} delta="latest Form 4s" />
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 pb-1.5 text-[11px]">
        <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={onlyOpenMarket} onChange={(e) => setOnlyOpenMarket(e.target.checked)} /> open-market only (P/S)</label>
        <span className="ml-auto text-muted">Non-derivative transactions, SEC Form 4</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows && !error && <div className="p-3 text-[11px] text-muted">Reading Form 4 filings…</div>}
        {error && <div className="p-3 text-[11px] text-neg">{error}</div>}
        {rows && rows.length === 0 && <div className="p-3 text-[11px] text-muted">No recent Form 4 filings.</div>}
        <table className="w-full whitespace-nowrap text-[11px]">
          <thead className="sticky top-0 z-10 bg-panel text-[10px] uppercase tracking-wider text-muted">
            <tr className="border-b border-line-strong"><th className="py-1.5 pl-3 text-left font-normal">Date</th><th className="py-1.5 text-left font-normal">Insider</th><th className="py-1.5 text-left font-normal">Role</th><th className="py-1.5 text-left font-normal">Type</th><th className="py-1.5 pr-2 text-right font-normal">Shares</th><th className="py-1.5 pr-2 text-right font-normal">Price</th><th className="py-1.5 pr-2 text-right font-normal">Value</th><th className="py-1.5 pr-3 text-right font-normal">Owned after</th></tr>
          </thead>
          <tbody className="stagger">
            {list.map((t, i) => (
              <tr key={i} className="border-b border-line/50 hover:bg-elevated/70">
                <td className="py-1 pl-3 text-muted">{t.date}</td>
                <td className="py-1 font-sans">{t.owner}</td>
                <td className="max-w-[160px] truncate py-1 font-sans text-muted" title={t.relationship}>{t.relationship}</td>
                <td className="py-1"><span className={`rounded px-1.5 font-sans text-[10px] ${t.code === "P" ? "bg-pos/15 text-pos" : t.code === "S" ? "bg-neg/15 text-neg" : "bg-elevated text-muted"}`}>{t.codeLabel}</span></td>
                <td className="py-1 pr-2 text-right">{t.shares?.toLocaleString("en-US") ?? "—"}</td>
                <td className="py-1 pr-2 text-right">{t.price ? `$${t.price.toFixed(2)}` : "—"}</td>
                <td className="py-1 pr-2 text-right">{t.shares && t.price ? money(t.shares * t.price) : "—"}</td>
                <td className="py-1 pr-3 text-right"><a href={t.url} target="_blank" rel="noreferrer" className="hover:text-info hover:underline">{t.owned?.toLocaleString("en-US") ?? "—"}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.byOwner.length > 0 && (
          <div className="border-t border-line p-3">
            <HBar title="Net open-market value by insider" data={stats.byOwner.map(([o, v]) => ({ key: o, label: o.split(" ").slice(-1)[0].slice(0, 10), value: Math.abs(v), note: v >= 0 ? "net buyer" : "net seller", emphasis: v >= 0 }))} format={(v) => (v === null ? "n/a" : money(v))} />
          </div>
        )}
      </div>
    </div>
  );
}
