"use client";

/**
 * The other scenario tabs: company what-ifs (a company's own history run forward under a shock), tables
 * (a synthetic copy with its realism, or missing cells filled with ranges), practice data (fictional
 * companies), and the saved list.
 */
import { Download, FileSpreadsheet, Loader2, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { ago, api, post, useApi, useNow } from "@/components/news/client";
import type { CompanyResult } from "@/lib/edge/scen/company";
import type { MarketResult } from "@/lib/edge/scen/market";
import type { PracticeKit } from "@/lib/edge/scen/practice";
import type { Realism } from "@/lib/edge/scen/stats";
import type { Filled, TableIn } from "@/lib/edge/scen/tables";
import { MarketResultView } from "./MarketTab";
import { money, pct, RealismPanel, SyntheticTag } from "./parts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Slider({ label, value, onChange, min, max, step = 0.01, fmt }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; fmt: (v: number) => string }) {
  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-0.5 text-[11.5px] text-muted">
      <span className="flex justify-between">{label}<span className="num text-fg">{fmt(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </label>
  );
}

function Bands({ r }: { r: CompanyResult }) {
  const rows: { label: string; key: "revenue" | "ebitda" | "fcf"; last: number | null }[] = [
    { label: "Revenue", key: "revenue", last: r.base.revenue }, { label: "EBITDA", key: "ebitda", last: r.history[r.history.length - 1].ebitda }, { label: "Free cash flow", key: "fcf", last: null },
  ];
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const ys = r.years.filter((y) => y[row.key]);
        if (!ys.length) return null;
        const all = ys.flatMap((y) => [y[row.key]!.p5, y[row.key]!.p95]).concat(row.last ?? [], 0);
        const lo = Math.min(...all), hi = Math.max(...all), x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
        return (
          <div key={row.key}>
            <div className="mb-1 text-[11.5px] font-semibold">{row.label}{row.last !== null ? <span className="font-normal text-muted"> · FY{r.base.year} {money(row.last)}</span> : null}</div>
            <div className="space-y-1">{ys.map((y) => { const b = y[row.key]!; return (
              <div key={y.year} className="grid grid-cols-[44px_minmax(0,1fr)_170px] items-center gap-2 text-[11px]">
                <span className="num text-muted">{y.year}</span>
                <span className="relative h-3 rounded-full bg-line">
                  {lo < 0 && <span className="absolute inset-y-0 w-px bg-faint" style={{ left: `${x(0)}%` }} />}
                  {row.last !== null && <span className="absolute -top-0.5 h-4 w-px bg-fg/60" style={{ left: `${x(row.last)}%` }} title={`FY${r.base.year}`} />}
                  <span className="absolute inset-y-0 rounded-full bg-accent/35" style={{ left: `${x(b.p5)}%`, width: `${Math.max(1, x(b.p95) - x(b.p5))}%` }} />
                  <span className="absolute inset-y-[-2px] w-1 rounded-full bg-accent" style={{ left: `calc(${x(b.p50)}% - 2px)` }} />
                </span>
                <span className="num text-right">{money(b.p5)} · <b>{money(b.p50)}</b> · {money(b.p95)}</span>
              </div>
            ); })}</div>
          </div>
        );
      })}
    </div>
  );
}

export function CompanyTab({ suggest, onSaved }: { suggest: string[]; onSaved: () => void }) {
  const [ticker, setTicker] = useState(suggest[0] ?? "");
  const [volume, setVolume] = useState(-0.15);
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0.05);
  const [persistence, setPersistence] = useState(0.5);
  const [years, setYears] = useState("3");
  const [uncertainty, setUncertainty] = useState("base");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<CompanyResult | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { const out = await post<{ result: CompanyResult }>("/api/edge/scenarios", { kind: "company", ticker: ticker.toUpperCase(), volume, price, cost, persistence, years: Number(years), uncertainty }); setR(out.result); onSaved(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const csv = r ? [r.table.columns.map((c) => c.name).join(","), ...r.table.rows.map((row) => row.join(","))].join("\n") : "";
  return (
    <div className="space-y-3">
      <div className="panel space-y-2.5 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2">
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker" className="ctl w-[110px] border border-line bg-bg px-2 py-1 uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Ticker" />
          {suggest.filter((t) => t !== ticker).slice(0, 5).map((t) => <button key={t} type="button" onClick={() => setTicker(t)} className="num rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">{t}</button>)}
          <label className="ml-auto flex items-center gap-1.5 text-muted">Years<Select value={years} onChange={setYears} aria-label="Years" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option></Select></label>
          <label className="flex items-center gap-1.5 text-muted">Uncertainty<Select value={uncertainty} onChange={setUncertainty} aria-label="Uncertainty" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="low">Low</option><option value="base">As history</option><option value="high">High</option></Select></label>
        </div>
        <div className="flex flex-wrap gap-4">
          <Slider label="Volumes" value={volume} onChange={setVolume} min={-0.5} max={0.5} fmt={(v) => pct(v, 0)} />
          <Slider label="Prices" value={price} onChange={setPrice} min={-0.5} max={0.5} fmt={(v) => pct(v, 0)} />
          <Slider label="Costs" value={cost} onChange={setCost} min={-0.3} max={0.5} fmt={(v) => pct(v, 0)} />
          <Slider label="Shock kept each year" value={persistence} onChange={setPersistence} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || !ticker.trim()} onClick={() => void run()} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Run the what-if</button>
          {error && <span className="text-[12px] text-neg">{error}</span>}
        </div>
      </div>
      {r && (
        <div className="panel rise space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{r.title}</h3><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`SYNTHETIC: ${r.recipe} Seed ${r.seed}\n${csv}`)}`} download={`${r.ticker}-what-if-synthetic.csv`} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11.5px] hover:border-accent/50"><Download className="h-3.5 w-3.5" />CSV for Studio</a></div>
          <SyntheticTag recipe={r.recipe} seed={r.seed} paths={r.paths} />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <Bands r={r} />
            <ul className="space-y-1.5">{r.odds.map((o) => <li key={o.label} className="rounded-md border border-line px-2 py-1.5"><div className="num text-[16px] font-semibold">{Math.round(o.value * 100)}%</div><div className="text-[11px] text-muted">{o.label}</div></li>)}</ul>
          </div>
          <p className="text-[10.5px] text-faint">History: {r.history.map((h) => `FY${h.year} ${money(h.revenue)}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

function TablePreview({ t, filled, max = 25 }: { t: TableIn; filled?: Filled[]; max?: number }) {
  const mark = useMemo(() => new Map((filled ?? []).map((f) => [`${f.row}:${f.col}`, f])), [filled]);
  const rows = filled?.length ? [...new Set(filled.map((f) => f.row))].slice(0, max).map((i) => ({ i, r: t.rows[i] })) : t.rows.slice(0, max).map((r, i) => ({ i, r }));
  const fmt = (v: unknown) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : Number(v.toFixed(3)).toString()) : String(v ?? ""));
  return (
    <div className="max-h-[360px] overflow-auto rounded-md border border-line">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-elevated"><tr>{t.columns.map((c) => <th key={c.name} className="whitespace-nowrap px-2 py-1 text-left font-sans font-semibold">{c.name}</th>)}</tr></thead>
        <tbody>{rows.map(({ i, r }) => (
          <tr key={i} className="border-t border-line">{r.map((v, j) => { const f = mark.get(`${i}:${j}`); return <td key={j} className={`whitespace-nowrap px-2 py-0.5 ${f ? "bg-accent-soft/60 text-accent" : ""}`} title={f ? `Estimate from ${f.from} similar rows${f.low !== null ? `: ${fmt(f.low)} to ${fmt(f.high)}` : ""}` : undefined}>{fmt(v)}{f && f.low !== null ? <span className="text-[9.5px] text-accent/70"> [{fmt(f.low)}–{fmt(f.high)}]</span> : null}</td>; })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function TablesTab({ onSaved }: { onSaved: () => void }) {
  const lib = useApi<{ docs: { fileId: number | null; title: string; mime: string; status: string }[] }>("/api/edge/docs");
  const files = (lib.data?.docs ?? []).filter((d) => d.fileId && /csv|spreadsheet|excel/.test(d.mime));
  const [csv, setCsv] = useState("");
  const [fileId, setFileId] = useState("");
  const [method, setMethod] = useState("auto");
  const [rows, setRows] = useState("1000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ kind: string; table: TableIn; filled?: Filled[]; realism?: Realism; method?: string; seed?: number; title: string } | null>(null);
  const go = async (kind: "synthetic" | "gap") => {
    setBusy(kind); setError(null);
    try {
      const body: Record<string, unknown> = { kind, method, rows: Number(rows) };
      if (fileId) body.fileId = Number(fileId); else body.csv = csv;
      const r = await post<{ result: typeof out }>("/api/edge/scenarios", body);
      setOut(r.result); onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const download = out ? `data:text/csv;charset=utf-8,${encodeURIComponent(`${out.table.synthetic ? `SYNTHETIC: ${out.table.synthetic.recipe} Seed ${out.table.synthetic.seed}\n` : ""}${[out.table.columns.map((c) => c.name).join(","), ...out.table.rows.map((r) => r.map((v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? "")).join(","))].join("\n")}`)}` : "";
  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-accent" />
          <Select value={fileId} onChange={setFileId} aria-label="A table from your library" className="ctl max-w-[320px] border border-line bg-bg px-2 py-1 text-left"><option value="">Paste a CSV below</option>{files.map((f) => <option key={f.fileId} value={String(f.fileId)}>{f.title}</option>)}</Select>
          <span className="text-[11px] text-muted">or a CSV or Excel file from your Documents library</span>
        </div>
        {!fileId && <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} placeholder={"company,sector,revenue,margin\nAcme,Midstream,1200,0.31\n..."} className="ctl w-full resize-y border border-line bg-bg px-2 py-1.5 font-mono text-[11.5px] outline-none placeholder:text-faint focus:border-accent/60" aria-label="CSV" />}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-muted">Method<Select value={method} onChange={setMethod} aria-label="Method" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="auto">Chosen by size</option><option value="statistical">Gaussian copula</option><option value="ctgan">CTGAN (ML service)</option></Select></label>
          <label className="flex items-center gap-1.5 text-muted">Rows<Select value={rows} onChange={setRows} aria-label="Rows" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="200">200</option><option value="1000">1,000</option><option value="5000">5,000</option></Select></label>
          <button type="button" disabled={!!busy || (!csv.trim() && !fileId)} onClick={() => void go("synthetic")} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy === "synthetic" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Make a synthetic copy</button>
          <button type="button" disabled={!!busy || (!csv.trim() && !fileId)} onClick={() => void go("gap")} className="ctl flex items-center gap-1.5 border border-line px-3 py-1 hover:border-accent/50 disabled:opacity-50">{busy === "gap" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Fill the gaps</button>
          {error && <span className="text-[12px] text-neg">{error}</span>}
        </div>
      </div>
      {out && (
        <div className="panel rise space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{out.title}</h3><a href={download} download={`${out.kind === "gap" ? "gaps-filled" : "synthetic"}.csv`} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11.5px] hover:border-accent/50"><Download className="h-3.5 w-3.5" />Download CSV</a></div>
          {out.table.synthetic && <SyntheticTag recipe={out.table.synthetic.recipe} seed={out.table.synthetic.seed} />}
          {out.realism && <RealismPanel r={out.realism} note="The synthetic table against the original: each numeric column's distribution, their correlations, and the categories' shares." />}
          {out.filled && <p className="text-[11.5px] text-muted">{out.filled.length} cells estimated; they are highlighted with their ranges. Estimates, not data.</p>}
          <TablePreview t={out.table} filled={out.filled} />
        </div>
      )}
    </div>
  );
}

export function PracticeTab({ onSaved }: { onSaved: () => void }) {
  const [count, setCount] = useState("6");
  const [sector, setSector] = useState("midstream");
  const [docs, setDocs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kit, setKit] = useState<{ result: PracticeKit; download: string | null } | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { setKit(await post<{ result: PracticeKit; download: string | null }>("/api/edge/scenarios", { kind: "practice", count: Number(count), sector, docs })); onSaved(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3 text-[12px]">
        <label className="flex items-center gap-1.5 text-muted">Companies<Select value={count} onChange={setCount} aria-label="Companies" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="3">3</option><option value="6">6</option><option value="10">10</option></Select></label>
        <label className="flex items-center gap-1.5 text-muted">Sector<Select value={sector} onChange={setSector} aria-label="Sector" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="midstream">Midstream</option><option value="upstream">Upstream</option><option value="refining">Refining</option><option value="mixed">Mixed energy</option></Select></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} className="accent-[var(--accent)]" />Write practice documents into my library</label>
        <button type="button" disabled={busy} onClick={() => void run()} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Make practice data</button>
        {error && <span className="text-[12px] text-neg">{error}</span>}
        <p className="w-full text-[11px] text-muted">Fully fictional companies for training and demos: invented names and people, numbers shaped like real {sector === "mixed" ? "energy" : sector} companies&apos; but belonging to none.</p>
      </div>
      {kit && (
        <div className="panel rise space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{kit.result.title}</h3>{kit.download && <a href={kit.download} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11.5px] hover:border-accent/50"><Download className="h-3.5 w-3.5" />Workbook (.xlsx)</a>}</div>
          <SyntheticTag recipe={kit.result.recipe} seed={kit.result.seed} fictional />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{kit.result.companies.map((c) => <li key={c.ticker} className="rounded-md border border-line p-2"><div className="text-[12.5px] font-semibold">{c.name} <span className="num text-[11px] text-muted">{c.ticker}</span></div><div className="text-[11px] text-muted">{c.hq} · {c.segments.join(", ")}</div><p className="mt-1 text-[11.5px]">{c.description}</p></li>)}</ul>
          <TablePreview t={kit.result.financials} max={15} />
          {kit.result.docs.length > 0 && <p className="text-[11.5px] text-muted">{kit.result.docs.length} practice documents are in your Documents library, marked [Fictional], ready to ask questions of.</p>}
        </div>
      )}
    </div>
  );
}

type Saved = { id: number; title: string; kind: string; driver: string; status: string; realism: number | null; updatedAt: string; mine: boolean };

export function SavedList({ nonce }: { nonce: number }) {
  const now = useNow();
  const list = useApi<{ scenarios: Saved[] }>(`/api/edge/scenarios?n=${nonce}`);
  const [open, setOpen] = useState<{ id: number; status: string; result: MarketResult | CompanyResult | Record<string, unknown>; kind: string } | null>(null);
  const show = (id: number) => { void api<{ id: number; status: string; result: MarketResult; kind: string }>(`/api/edge/scenarios/${id}`).then(setOpen); };
  const remove = async (s: Saved) => { if (await confirmDialog({ title: `Delete “${s.title}”?`, confirmLabel: "Delete", tone: "danger" })) { await api(`/api/edge/scenarios/${s.id}`, { method: "DELETE" }); list.reload(); if (open?.id === s.id) setOpen(null); } };
  return (
    <div className="space-y-3">
      {!list.data ? <div className="h-24 animate-pulse rounded-lg bg-elevated/40" /> : !list.data.scenarios.length ? <p className="text-[12px] text-muted">Scenarios you run are kept here.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">{list.data.scenarios.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
            <button type="button" onClick={() => show(s.id)} className="min-w-0 flex-1 text-left"><div className="truncate font-medium hover:text-accent">{s.title}</div><div className="text-[10.5px] text-muted">{s.kind}{s.driver !== "none" ? ` · ${s.driver}` : ""} · {s.status}{s.realism !== null ? ` · realism ${s.realism}` : ""}{now ? ` · ${ago(s.updatedAt, now)}` : ""}</div></button>
            {s.mine && <button type="button" onClick={() => void remove(s)} aria-label={`Delete ${s.title}`} className="ctl p-1 text-muted hover:text-neg"><Trash2 className="h-3.5 w-3.5" /></button>}
          </li>
        ))}</ul>
      )}
      {open?.kind === "market" && <MarketResultView r={open.result as MarketResult} id={open.id} status={open.status} />}
      {open && open.kind !== "market" && <p className="text-[12px] text-muted">Reopen {open.kind} scenarios from their tab to run them again; the saved result is kept with its seed.</p>}
    </div>
  );
}
