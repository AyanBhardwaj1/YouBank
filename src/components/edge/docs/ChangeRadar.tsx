"use client";

/**
 * The change radar. For a company's filings: what its latest 10-K or 10-Q added, dropped and reworded
 * in a section against the one before, with word-level edits. For any two documents the person can
 * read (two quarters' calls, two versions of a data-room file): what is new and what is gone by
 * meaning, edits when they are versions of one text, and how each speaker's hedging and tone moved.
 */
import { ArrowRight, ExternalLink, Loader2, Minus, Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { post, useApi } from "@/components/news/client";
import { clockOf, wordDiff } from "@/lib/edge/docs/text";
import { onTabKeys, tabProps } from "../tabs";
import { errorText, type ChangeRow, type DocCompare, type Library, type Radar, type ViewTarget } from "./client";

const TONE: Record<ChangeRow["status"], { label: string; bar: string; text: string; icon: typeof Plus }> = {
  added: { label: "Added", bar: "bg-pos", text: "text-pos", icon: Plus },
  removed: { label: "Removed", bar: "bg-neg", text: "text-neg", icon: Minus },
  changed: { label: "Reworded", bar: "bg-info", text: "text-info", icon: Repeat },
};

function Counts({ c }: { c: { added: number; removed: number; changed: number; unchanged: number } }) {
  const total = c.added + c.removed + c.changed + c.unchanged || 1;
  const seg = (n: number, cls: string, label: string) => (n ? <div className={`${cls} h-full`} style={{ width: `${(n / total) * 100}%` }} title={`${n} ${label}`} /> : null);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line-strong" aria-hidden>{seg(c.added, "bg-pos", "added")}{seg(c.changed, "bg-info", "reworded")}{seg(c.removed, "bg-neg", "removed")}{seg(c.unchanged, "bg-chart-dim", "unchanged")}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
        <span className="text-pos">{c.added} added</span><span className="text-info">{c.changed} reworded</span><span className="text-neg">{c.removed} removed</span><span className="text-muted">{c.unchanged} unchanged</span>
      </div>
    </div>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="text-[12px] leading-relaxed">
      {wordDiff(before, after).map((p, i) => (
        <span key={i} className={p.t === "add" ? "rounded-[2px] bg-pos/15 text-pos" : p.t === "del" ? "rounded-[2px] bg-neg/10 text-neg line-through decoration-neg/60" : ""}>{p.s}{" "}</span>
      ))}
    </p>
  );
}

function Rows({ rows }: { rows: ChangeRow[] }) {
  const [filter, setFilter] = useState<"all" | ChangeRow["status"]>("all");
  const [limit, setLimit] = useState(25);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(["all", "added", "changed", "removed"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full border px-2 py-0.5 text-[11px] ${filter === f ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {f === "all" ? `All (${rows.length})` : `${TONE[f].label} (${rows.filter((r) => r.status === f).length})`}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.slice(0, limit).map((r, i) => {
          const t = TONE[r.status];
          return (
            <li key={i} className="flex gap-2.5 rounded-md border border-line p-2.5">
              <span className={`w-1 shrink-0 rounded-full ${t.bar}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={`mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider ${t.text}`}><t.icon className="h-3 w-3" />{t.label}{r.status === "changed" && <span className="font-normal normal-case tracking-normal text-muted">· {Math.round(r.similarity * 100)}% the same wording</span>}</div>
                {r.status === "changed" && r.before ? <Diff before={r.before} after={r.text} /> : <p className={`text-[12px] leading-relaxed ${r.status === "removed" ? "text-muted" : ""}`}>{r.text}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length > limit && <button type="button" onClick={() => setLimit((l) => l + 25)} className="mt-2 text-[12px] text-accent hover:underline">Show more ({shown.length - limit} left)</button>}
    </div>
  );
}

function FilingRadar({ initial, suggest }: { initial?: { ticker: string; form?: string; section?: string } | null; suggest: string[] }) {
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [form, setForm] = useState(initial?.form ?? "10-K");
  const [section, setSection] = useState(initial?.section ?? "risk");
  const [asked, setAsked] = useState<string | null>(initial?.ticker ? `ticker=${encodeURIComponent(initial.ticker)}&form=${initial.form ?? "10-K"}&section=${initial.section ?? "risk"}` : null);
  const radar = useApi<Radar>(asked ? `/api/edge/changes?${asked}` : null);
  const go = (t = ticker) => { const x = t.trim().toUpperCase(); if (x) { setTicker(x); setAsked(`ticker=${encodeURIComponent(x)}&form=${form}&section=${section}`); } };
  const r = radar.data;
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex flex-wrap items-center gap-2 text-[12px]">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. ET" className="ctl w-[130px] border border-line bg-bg px-2 py-1 uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Ticker" />
        <Select value={form} onChange={setForm} aria-label="Filing" className="ctl border border-line bg-bg px-2 py-1 text-left"><option value="10-K">10-K, year on year</option><option value="10-Q">10-Q, quarter on quarter</option></Select>
        <Select value={section} onChange={setSection} aria-label="Section" className="ctl border border-line bg-bg px-2 py-1 text-left"><option value="risk">Risk factors</option><option value="mdna">Management&apos;s discussion</option><option value="all">The whole filing</option></Select>
        <button type="submit" disabled={!ticker.trim()} className="ctl bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-50">Compare</button>
        {suggest.filter((t) => t !== ticker).slice(0, 5).map((t) => <button key={t} type="button" onClick={() => go(t)} className="num rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">{t}</button>)}
      </form>
      {asked && radar.loading && <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading both filings and matching paragraphs…</div>}
      {radar.error && <p className="text-[12px] text-neg">{radar.error} <button type="button" onClick={radar.reload} className="text-accent hover:underline">Try again</button></p>}
      {r && (
        <div className={`panel rise space-y-3 p-3 transition-opacity ${radar.loading ? "opacity-50" : ""}`}>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-semibold">{r.name}</span>
            {r.prior && r.current ? (
              <span className="flex flex-wrap items-center gap-1.5 text-muted">
                <a href={r.prior.url} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-0.5 hover:text-fg">{r.form} {r.prior.filed}<ExternalLink className="h-3 w-3" /></a>
                <ArrowRight className="h-3 w-3" />
                <a href={r.current.url} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-0.5 hover:text-fg">{r.form} {r.current.filed}<ExternalLink className="h-3 w-3" /></a>
              </span>
            ) : null}
          </div>
          {r.current && <Counts c={r.counts} />}
          {r.summary.length > 0 && <ul className="space-y-1 border-l-2 border-accent pl-3 text-[12.5px] leading-relaxed">{r.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          {r.current && !r.rows.length && <p className="text-[12px] text-muted">No paragraph in this section changed.</p>}
          {r.rows.length > 0 && <Rows rows={r.rows} />}
        </div>
      )}
    </div>
  );
}

function Passage({ p, onCite, tone }: { p: DocCompare["newInB"][number]; onCite: (t: ViewTarget) => void; tone: "pos" | "neg" }) {
  return (
    <li>
      <button type="button" onClick={() => onCite({ chunkId: p.chunkId })} className={`w-full rounded-md border px-2.5 py-2 text-left text-[12px] leading-relaxed transition hover:border-accent/60 ${tone === "pos" ? "border-pos/30" : "border-neg/30"}`}>
        <div className="mb-0.5 flex gap-2 text-[10.5px] text-muted">
          {p.tStart !== null && <span className="num">{clockOf(p.tStart)}</span>}{p.speaker && <span>{p.speaker}</span>}{p.page > 0 && <span className="num">p. {p.page}</span>}
          <span className="ml-auto num" title="How far this passage is from anything in the other document (0 to 1)">novelty {p.novelty.toFixed(2)}</span>
        </div>
        <span className="line-clamp-5">{p.text}</span>
      </button>
    </li>
  );
}

function DocsRadar({ onCite }: { onCite: (t: ViewTarget) => void }) {
  const lib = useApi<Library>("/api/edge/docs");
  const docs = [...(lib.data?.docs ?? []), ...(lib.data?.filings ?? [])].filter((d) => d.status === "ready");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DocCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null); setRes(null);
    try { setRes(await post<DocCompare>("/api/edge/changes", { a: Number(a), b: Number(b) })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const option = (d: Library["docs"][number]) => <option key={d.id} value={String(d.id)}>{d.title.slice(0, 80)}{d.source === "audio" ? " (recording)" : ""}</option>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted">Earlier</span>
        <Select value={a} onChange={setA} searchable aria-label="Earlier document" menuWidth={320} className="ctl max-w-[260px] border border-line bg-bg px-2 py-1 text-left"><option value="">Pick a document</option>{docs.map(option)}</Select>
        <span className="text-muted">Later</span>
        <Select value={b} onChange={setB} searchable aria-label="Later document" menuWidth={320} className="ctl max-w-[260px] border border-line bg-bg px-2 py-1 text-left"><option value="">Pick a document</option>{docs.map(option)}</Select>
        <button type="button" disabled={!a || !b || a === b || busy} onClick={() => void run()} className="ctl flex items-center gap-1 bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}Compare</button>
      </div>
      {!docs.length && lib.data && <p className="text-[12px] text-muted">Upload or import two documents first, such as two quarters&apos; earnings calls.</p>}
      {lib.error && !lib.data && <p className="text-[12px] text-neg">Could not load your documents: {lib.error} <button type="button" onClick={lib.reload} className="text-accent hover:underline">Try again</button></p>}
      {error && <p className="text-[12px] text-neg">{error}</p>}
      {res && (
        <div className="panel rise space-y-4 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="font-semibold">{res.a.title}</span><ArrowRight className="h-3.5 w-3.5 text-muted" /><span className="font-semibold">{res.b.title}</span>
            <span className="ml-auto text-[11px] text-muted" title="The average distance from each passage to its closest match on the other side">{res.distance < 0.25 ? "Mostly the same material" : res.distance < 0.4 ? "Some new material" : "Largely different material"} · {res.distance.toFixed(2)}</span>
          </div>
          {res.summary.length > 0 && (
            <ul className="space-y-1.5 border-l-2 border-accent pl-3 text-[12.5px] leading-relaxed">
              {res.summary.map((s, i) => <li key={i}>{s.text} <button type="button" onClick={() => onCite({ chunkId: s.chunkId, quote: s.quote })} className="text-[11.5px] text-accent hover:underline">“{s.quote}”</button></li>)}
            </ul>
          )}
          {res.tone && res.tone.length > 0 && (
            <div className="overflow-x-auto">
              <div className="mb-1 text-[11.5px] font-semibold">Hedging and tone, speaker by speaker</div>
              <table className="w-full text-[11.5px]">
                <thead><tr className="text-left text-muted"><th className="font-normal">Speaker</th><th className="text-right font-normal">Hedging</th><th className="text-right font-normal">Change</th><th className="text-right font-normal">Tone</th><th className="text-right font-normal">Change</th></tr></thead>
                <tbody>{res.tone.map((t) => (
                  <tr key={t.speaker} className="border-t border-line">
                    <td className="py-1 font-sans">{t.speaker}</td>
                    <td className="text-right">{t.after.hedging.toFixed(2)}</td><td className={`text-right ${t.hedging > 0.05 ? "text-neg" : t.hedging < -0.05 ? "text-pos" : "text-muted"}`}>{t.hedging >= 0 ? "+" : ""}{t.hedging.toFixed(2)}</td>
                    <td className="text-right">{t.after.tone.toFixed(2)}</td><td className={`text-right ${t.tone > 0.05 ? "text-pos" : t.tone < -0.05 ? "text-neg" : "text-muted"}`}>{t.tone >= 0 ? "+" : ""}{t.tone.toFixed(2)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-1 text-[10.5px] text-faint">More hedging reads as less certainty. Scored per turn by a language model; listen before concluding.</p>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div><div className="mb-1 flex items-center gap-1 text-[11.5px] font-semibold text-pos"><Plus className="h-3.5 w-3.5" />New in the later one</div><ul className="space-y-1.5">{res.newInB.map((p) => <Passage key={p.chunkId} p={p} onCite={onCite} tone="pos" />)}</ul></div>
            <div><div className="mb-1 flex items-center gap-1 text-[11.5px] font-semibold text-neg"><Minus className="h-3.5 w-3.5" />Only in the earlier one</div><ul className="space-y-1.5">{res.goneFromA.map((p) => <Passage key={p.chunkId} p={p} onCite={onCite} tone="neg" />)}</ul></div>
          </div>
          {res.paragraphs && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="text-[11.5px] font-semibold">Edits, paragraph by paragraph</div>
              <Counts c={res.paragraphs.counts} />
              <Rows rows={res.paragraphs.rows} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChangeRadar({ onCite, suggest, initial }: { onCite: (t: ViewTarget) => void; suggest: string[]; initial?: { ticker: string; form?: string; section?: string } | null }) {
  const [mode, setMode] = useState<"filings" | "docs">("filings");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5" role="tablist" aria-label="What to compare" onKeyDown={onTabKeys}>
          {(["filings", "docs"] as const).map((m) => <button key={m} type="button" {...tabProps(mode === m)} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-0.5 text-[12px] ${mode === m ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{m === "filings" ? "A company's filings" : "Two documents or calls"}</button>)}
        </div>
        <span className="text-[11.5px] text-muted">{mode === "filings" ? "The latest filing against the one before, paragraph by paragraph." : "What is new, what is gone, and how the speakers' confidence moved."}</span>
      </div>
      {mode === "filings" ? <FilingRadar initial={initial} suggest={suggest} /> : <DocsRadar onCite={onCite} />}
    </div>
  );
}

