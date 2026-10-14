"use client";

import { useCallback, useEffect, useState } from "react";
import type { Command } from "@/lib/functions";
import type { FtsHit } from "@/lib/edgar/fulltext";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { StatTile } from "../StatTile";
import { Select } from "@/components/ui/Select";
import { errorMessage, fetchJson, isAbort } from "@/lib/client/errors";

type Result = { total: number; matched: number; rows: FtsHit[]; query: { phrase: string; keywords: string; from: string; to: string; forms: string[] } };

const SECTOR_KEYWORDS: Record<string, string> = {
  "Technology": "software cloud data platform", "Healthcare": "healthcare pharmaceutical medical device", "Energy & power": "oil gas midstream utility renewable",
  "Financials": "bank insurance asset management fintech", "Consumer & retail": "consumer retail restaurant brand", "Industrials": "industrial manufacturing aerospace distribution",
  "Media & telecom": "media telecom broadband streaming", "Real estate": "REIT real estate hotel gaming",
};
const PHRASES = [
  { v: '"agreement and plan of merger"', label: "Merger agreements" },
  { v: '"definitive proxy statement" "merger consideration"', label: "Merger proxies" },
  { v: '"tender offer" "merger"', label: "Tender offers" },
  { v: '"asset purchase agreement"', label: "Asset purchases" },
];
const short = (s: string) => s.replace(/\s+\(CIK.*$/, "").replace(/\s+\([A-Z.\-]{1,6}(,\s*[A-Z.\-]{1,8})*\)\s*$/, "").trim();

type Engine = {
  query: { name: string; method: string };
  results: { id: number; targetName: string; acquirerName: string; announcedAt: string | null; evUsdMm: number | null; evEbitda: number | null; premiumUnaffected: number | null; why: string[]; sources: { url: string }[] }[];
  range: { evEbitda: { n: number; median: number; p25: number; p75: number } | null };
  bandText: string;
};

/**
 * PREC: the Precedent Engine's set for the company (Edge's deal database: deals like this one, every term
 * quoted from EDGAR merger filings, with the multiple range and its tested band) when the database covers
 * the sector, and today's live EDGAR search as "Find more".
 */
export function PrecScreen({ onRun, ticker }: { onRun?: (c: Command) => void; ticker?: string }) {
  const [tab, setTab] = useState<"engine" | "edgar">(ticker ? "engine" : "edgar");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1 text-[11px]" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "engine"} onClick={() => setTab("engine")} className={`ctl px-2 py-0.5 ${tab === "engine" ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>Deal database</button>
        <button type="button" role="tab" aria-selected={tab === "edgar"} onClick={() => setTab("edgar")} className={`ctl px-2 py-0.5 ${tab === "edgar" ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>Find more (EDGAR)</button>
      </div>
      <div className="min-h-0 flex-1">{tab === "engine" ? <EngineSet ticker={ticker} onMore={() => setTab("edgar")} /> : <EdgarSearch onRun={onRun} ticker={ticker} />}</div>
    </div>
  );
}

function EngineSet({ ticker, onMore }: { ticker?: string; onMore: () => void }) {
  // The answer is kept with the ticker it was for, so a new ticker shows the loading state without resetting state in the effect.
  const [got, setGot] = useState<{ ticker: string; res: Engine | null; error: string | null }>({ ticker: "", res: null, error: null });
  useEffect(() => {
    if (!ticker) return;
    const c = new AbortController();
    fetchJson<Engine>("/api/edge/deals/similar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, k: 15 }), signal: c.signal })
      .then((res) => setGot({ ticker, res, error: null })).catch((e) => { if (!isAbort(e)) setGot({ ticker, res: null, error: errorMessage(e) }); });
    return () => c.abort();
  }, [ticker]);
  const res = got.ticker === ticker ? got.res : null, error = got.ticker === ticker ? got.error : null;
  if (!ticker) return <div className="p-3 text-[11px] text-muted">Give a ticker: PREC finds deals like that company.</div>;
  if (error) return <div className="space-y-2 p-3 text-[11px]"><p className="text-muted">{/beta|Edge/i.test(error) ? "The deal database is part of Edge (beta). Switch Edge on in Settings, or use Find more." : error}</p><button type="button" onClick={onMore} className="ctl border border-line px-2 py-1 text-muted hover:text-fg">Find more on EDGAR</button></div>;
  if (!res) return <div className="flex flex-col gap-2 p-3">{[1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-5 ctl" />)}</div>;
  const r = res.range.evEbitda;
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-3 gap-2 p-3">
        <StatTile label="Precedents" value={String(res.results.length)} delta={res.query.name} />
        <StatTile label="EV/EBITDA median" value={r ? `${r.median.toFixed(1)}x` : "—"} delta={r ? `IQR ${r.p25.toFixed(1)}x–${r.p75.toFixed(1)}x · ${r.n}` : "no multiples yet"} />
        <StatTile label="Tested band" value={res.bandText.match(/(\d+\.\dx to \d+\.\dx)/)?.[1] ?? "—"} delta={res.bandText.includes("covered") ? res.bandText.split(". ").pop() ?? "" : "not tested yet"} />
      </div>
      <div className="table-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line-strong"><th className="py-1.5 pl-3 text-left font-normal">Announced</th><th className="py-1.5 text-left font-normal">Target / buyer</th><th className="py-1.5 text-right font-normal">EV/EBITDA</th><th className="py-1.5 text-right font-normal">Premium</th><th className="py-1.5 pl-3 pr-3 text-left font-normal">Why similar</th></tr></thead>
          <tbody>
            {res.results.map((d) => (
              <tr key={d.id} className="border-b border-line/50 hover:bg-elevated/70">
                <td className="num py-1 pl-3 text-muted">{d.announcedAt?.slice(0, 10) ?? "—"}</td>
                <td className="max-w-[260px] truncate py-1"><a href={d.sources[0]?.url} target="_blank" rel="noreferrer" className="font-semibold hover:text-info">{d.targetName || "Not read yet"}</a><span className="text-muted"> / {d.acquirerName || "—"}</span></td>
                <td className="num py-1 text-right">{d.evEbitda ? `${d.evEbitda.toFixed(1)}x` : "—"}</td>
                <td className="num py-1 text-right">{d.premiumUnaffected !== null ? `${Math.round(d.premiumUnaffected * 100)}%` : "—"}</td>
                <td className="max-w-[260px] truncate py-1 pl-3 pr-3 text-muted">{d.why.slice(0, 3).join(" · ")}</td>
              </tr>
            ))}
            {!res.results.length && <tr><td colSpan={5} className="p-3 text-[11px] text-muted">The deal database does not cover this sector yet. <button type="button" onClick={onMore} className="text-info hover:underline">Find more on EDGAR</button>.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">Edge&apos;s deal database: terms quoted from EDGAR merger filings and checked; {res.query.method}. {res.bandText}</div>
    </div>
  );
}

/** Precedent transactions sourced live from EDGAR merger disclosure; terms are extracted by the AI workflow. */
function EdgarSearch({ onRun, ticker }: { onRun?: (c: Command) => void; ticker?: string }) {
  const { profile } = useWorkspace();
  const [keywords, setKeywords] = useState(SECTOR_KEYWORDS[profile.sectors[0] ?? ""] ?? "");
  const [phrase, setPhrase] = useState(PHRASES[0].v);
  const [from, setFrom] = useState(() => new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10));
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    const p = new URLSearchParams({ q: keywords, phrase, from });
    fetchJson<Result>(`/api/precedents?${p}`, { signal })
      .then(setRes)
      .catch((e) => { if (!isAbort(e)) setError(errorMessage(e)); })
      // A newer search took over: its own answer ends the spinner.
      .finally(() => { if (!signal.aborted) setLoading(false); });
  }, [keywords, phrase, from]);

  useEffect(() => { const c = new AbortController(); const t = setTimeout(() => load(c.signal), 250); return () => { clearTimeout(t); c.abort(); }; }, [load]);

  const years = res ? [...new Set(res.rows.map((r) => r.filed.slice(0, 4)))].sort().reverse() : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px]">
        <Select value={phrase} onChange={(v) => setPhrase(v)} className="ctl border border-line bg-elevated px-1.5 py-1 text-fg focus:border-accent/60 focus:outline-none">
          {PHRASES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </Select>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="sector keywords" className="ctl w-48 border border-line bg-bg px-2 py-1 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <input type="date" aria-label="Filed since" value={from} onChange={(e) => setFrom(e.target.value)} className="num ctl border border-line bg-bg px-1.5 py-1 text-fg focus:border-accent/60 focus:outline-none" />
        {onRun && <button type="button" onClick={() => onRun({ ticker: ticker ?? "SNOW", fn: "TOOL", arg: "precedent-transactions" })} className="ctl border border-accent/50 px-2 py-1 text-accent hover:bg-accent-soft">✦ Extract terms and multiples</button>}
        <span className="ml-auto text-muted">{loading ? "searching EDGAR…" : res ? `${res.rows.length} issuers · ${res.total.toLocaleString()} matching filings` : ""}</span>
      </div>

      {res && (
        <div className="grid grid-cols-3 gap-2 p-3">
          <StatTile label="Issuers found" value={String(res.rows.length)} delta={`since ${from}`} />
          <StatTile label="Matching filings" value={res.total.toLocaleString()} delta="EDGAR full text" />
          <StatTile label="Years covered" value={years.length ? `${years[years.length - 1]}–${years[0]}` : "—"} delta={res.query.forms.join(", ")} />
        </div>
      )}

      <div className="table-scroll min-h-0 flex-1 overflow-auto">
        {error && <div className="p-3 text-[11px] text-neg">{error}</div>}
        {!res && !error && <div className="flex flex-col gap-2 p-3">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer h-5 ctl" style={{ animationDelay: `${i * 60}ms` }} />)}</div>}
        {res && (
          <table className="w-full whitespace-nowrap text-[11.5px]">
            <thead className="sticky top-0 z-10 bg-panel text-[10px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line-strong">
                <th className="py-1.5 pl-3 text-left font-normal">Disclosed</th>
                <th className="py-1.5 text-left font-normal">Issuer (target or acquirer)</th>
                <th className="py-1.5 text-left font-normal">Form</th>
                <th className="py-1.5 text-left font-normal">Document</th>
                <th className="py-1.5 pr-3 text-right font-normal">Open</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {res.rows.map((r) => (
                <tr key={r.accession} className="border-b border-line/50 hover:bg-elevated/70">
                  <td className="num py-1 pl-3 text-muted">{r.filed}</td>
                  <td className="max-w-[260px] truncate py-1 font-semibold" title={r.entity}>{short(r.entity)}</td>
                  <td className="py-1"><span className={`num rounded px-1.5 text-[10px] ${r.form.startsWith("DEFM") || r.form.startsWith("S-4") ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{r.form}</span></td>
                  <td className="max-w-[240px] truncate py-1 text-muted" title={r.description}>{r.description || "—"}</td>
                  <td className="py-1 pr-3 text-right"><a href={r.url} target="_blank" rel="noreferrer" className="text-muted hover:text-info">filing ↗</a> <a href={r.index} target="_blank" rel="noreferrer" className="ml-2 text-muted hover:text-info">index ↗</a></td>
                </tr>
              ))}
              {res.rows.length === 0 && <tr><td colSpan={5} className="p-3 text-[11px] text-muted">No matching disclosure. Widen the date range or change the keywords.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">
        Live from EDGAR full-text search across merger proxies, S-4s and 8-Ks since 2001. Deal values, premiums and multiples are not tagged in these filings, so the AI workflow reads each document and computes them with the target&apos;s XBRL facts.
      </div>
    </div>
  );
}
