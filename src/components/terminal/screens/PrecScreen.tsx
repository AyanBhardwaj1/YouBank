"use client";

import { useCallback, useEffect, useState } from "react";
import type { Command } from "@/lib/functions";
import type { FtsHit } from "@/lib/edgar/fulltext";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { StatTile } from "../StatTile";

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

/** Precedent transactions sourced live from EDGAR merger disclosure; terms are extracted by the AI workflow. */
export function PrecScreen({ onRun, ticker }: { onRun?: (c: Command) => void; ticker?: string }) {
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
    fetch(`/api/precedents?${p}`, { signal }).then((r) => r.json()).then((r) => { if (r.error) setError(r.error); else setRes(r); }).catch(() => {}).finally(() => setLoading(false));
  }, [keywords, phrase, from]);

  useEffect(() => { const c = new AbortController(); const t = setTimeout(() => load(c.signal), 250); return () => { clearTimeout(t); c.abort(); }; }, [load]);

  const years = res ? [...new Set(res.rows.map((r) => r.filed.slice(0, 4)))].sort().reverse() : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px]">
        <select value={phrase} onChange={(e) => setPhrase(e.target.value)} className="ctl border border-line bg-elevated px-1.5 py-1 text-fg focus:border-accent/60 focus:outline-none">
          {PHRASES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="sector keywords" className="ctl w-48 border border-line bg-bg px-2 py-1 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num ctl border border-line bg-bg px-1.5 py-1 text-fg focus:border-accent/60 focus:outline-none" />
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

      <div className="min-h-0 flex-1 overflow-auto">
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
