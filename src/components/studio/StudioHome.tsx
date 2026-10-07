"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { confirmDialog } from "@/components/ui/Dialog";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { STUDIO_ROLES } from "@/lib/studio/roles";
import { TEMPLATES, type TemplateId } from "@/lib/studio/templates";
import { errorMessage, fetchJson } from "@/lib/client/errors";

type DocItem = { id: number; title: string; kind: string; ticker: string; updatedAt: string; sheets: number; slides: number; mine: boolean; teamId: number | null };

const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const ICON: Record<string, string> = { dcf: "LineChart", comps: "Table", valuation: "Presentation", lbo: "Landmark", merger: "Handshake", cap_table: "PieChart", blank: "FileSpreadsheet", upload: "Upload", token_multiples: "Coins", token_dcf: "LineChart", staking_yield: "Percent", crypto_comps: "Table" };

export function StudioHome() {
  const router = useRouter();
  const { profile } = useWorkspace();
  const role = STUDIO_ROLES[profile.role];
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [ticker, setTicker] = useState(profile.firmTicker ?? "");
  const [acquirer, setAcquirer] = useState("");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // A failed list says so, rather than looking like "no models yet".
    fetchJson<{ docs?: DocItem[] }>("/api/studio").then((d) => setDocs(d.docs ?? [])).catch((e) => { setDocs([]); setError(`Your models could not be listed. ${errorMessage(e)}`); });
  }, []);

  const ordered = [...role.templates, ...TEMPLATES.map((t) => t.id).filter((t) => !role.templates.includes(t))]
    .map((id) => TEMPLATES.find((t) => t.id === id)!).filter(Boolean);

  const create = async (template: TemplateId, extra: Record<string, unknown> = {}) => {
    const t = TEMPLATES.find((x) => x.id === template)!;
    if (template === "comps" && !ticker.trim()) { setError("Enter a ticker for trading comps."); return; }
    setBusy(template); setError(null);
    try {
      const res = await fetch("/api/studio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template, ticker: t.ticker ? ticker : undefined, acquirer: template === "merger" ? acquirer : undefined, ...extra }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create the model");
      router.push(`/app/studio/${body.id}${extra.ask ? `?ask=${encodeURIComponent(String(extra.ask))}` : ""}`);
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  };

  const upload = async (f: File) => {
    setBusy("upload"); setError(null);
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch("/api/studio/import", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      router.push(`/app/studio/${body.id}`);
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  };

  const start = () => { if (ask.trim()) void create("blank", { title: ask.trim().slice(0, 80), ask: ask.trim() }); };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Icon name="FileSpreadsheet" className="h-5 w-5 text-accent" />Studio</h1>
            <p className="mt-1 max-w-[70ch] text-[12.5px] text-muted">Live models and decks. Tell the agent what you need and watch it build the workbook and the slides, cell by cell, from SEC data. Every figure on a slide stays linked to the model, every change can be undone, and you can take it all to Excel and PowerPoint. {role.lead}</p>
          </div>
        </div>

        <div className="mt-5 ctl border border-accent/40 bg-accent-soft/40 p-3">
          <label className="text-[12px] font-semibold">Describe what you need</label>
          <div className="mt-1.5 flex gap-2">
            <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") start(); }} placeholder={`e.g. "Build an LBO for Datadog at 12x with 5x leverage and an IC deck"`} className="min-w-0 flex-1 ctl border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent/60" />
            <button type="button" disabled={!ask.trim() || !!busy} onClick={start} className="ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-bg disabled:opacity-40">{busy === "blank" ? "Starting…" : "Build it"}</button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold">Start from a template</h2>
              <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker (e.g. SNOW)" className="w-[150px] ctl border border-line bg-bg px-2 py-1 text-[12px] uppercase outline-none focus:border-accent/60" />
              <span className="text-[11px] text-muted">Filled from SEC XBRL filings and market data. Leave blank for illustrative inputs.</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ordered.map((t) => (
                <div key={t.id} className="flex flex-col ctl border border-line bg-panel p-3">
                  <div className="flex items-center gap-2"><Icon name={ICON[t.id] ?? "FileSpreadsheet"} className="h-4 w-4 text-accent" /><span className="text-[12.5px] font-semibold">{t.label}</span></div>
                  <p className="mt-1 flex-1 text-[11.5px] text-muted">{t.blurb}</p>
                  {t.id === "merger" && <input value={acquirer} onChange={(e) => setAcquirer(e.target.value.toUpperCase())} placeholder="Acquirer ticker" className="mt-2 ctl border border-line bg-bg px-2 py-1 text-[11.5px] uppercase outline-none" />}
                  <button type="button" disabled={!!busy} onClick={() => void create(t.id)} className="mt-2 ctl border border-line px-2 py-1 text-[11.5px] hover:border-accent/60 disabled:opacity-50">{busy === t.id ? "Building…" : t.ticker && ticker ? `Build for ${ticker}` : "Open"}</button>
                </div>
              ))}
            </div>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
            className={`flex flex-col items-center justify-center ctl border-2 border-dashed p-5 text-center ${drag ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}
          >
            <Icon name="Upload" className="h-6 w-6 text-muted" />
            <p className="mt-2 text-[12.5px] font-semibold">Bring your own workbook</p>
            <p className="mt-1 text-[11.5px] text-muted">Drop an .xlsx, .xlsm or .csv. It opens as a live model with an intake report: what it contains, what could not be kept, and a one-click review.</p>
            <input ref={file} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <button type="button" disabled={!!busy} onClick={() => file.current?.click()} className="mt-3 ctl border border-line px-3 py-1.5 text-[12px] hover:border-accent/60">{busy === "upload" ? "Reading…" : "Choose a file"}</button>
          </div>
        </div>
        {error && <p className="mt-3 text-[12px] text-neg">{error}</p>}

        <Link href="/app/office" className="mt-4 flex items-center gap-3 ctl border border-line bg-panel px-3 py-2.5 hover:border-accent/60">
          <Icon name="FileSpreadsheet" className="h-5 w-5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">Work inside Excel and PowerPoint</span>
            <span className="block text-[11.5px] text-muted">Install the YouBank add-in and the agent edits your own workbook live; your edits sync back here, and decks in PowerPoint refresh from the model.</span>
          </span>
          <Icon name="ArrowRight" className="h-4 w-4 shrink-0 text-muted" />
        </Link>

        <h2 className="mt-7 text-[13px] font-semibold">Your models</h2>
        {docs === null ? <p className="mt-2 text-[12px] text-muted">Loading…</p> : docs.length === 0 ? (
          <p className="mt-2 ctl border border-dashed border-line px-3 py-4 text-[12px] text-muted">Nothing yet. Pick a template, drop in a file, or describe what you need.</p>
        ) : (
          <div className="mt-2 overflow-hidden ctl border border-line">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2 last:border-b-0 hover:bg-elevated">
                <Icon name={ICON[d.kind] ?? "FileSpreadsheet"} className="h-4 w-4 shrink-0 text-muted" />
                <Link href={`/app/studio/${d.id}`} className="min-w-0 flex-1 truncate text-[12.5px] font-medium hover:text-accent">{d.title}</Link>
                {d.ticker && <span className="num text-[11px] text-muted">{d.ticker}</span>}
                <span className="text-[11px] text-muted">{d.sheets} sheet{d.sheets === 1 ? "" : "s"} · {d.slides} slide{d.slides === 1 ? "" : "s"}</span>
                {d.teamId && <span className="ctl bg-accent-soft px-1.5 text-[10px] text-accent">team</span>}
                <span className="w-[70px] text-right text-[11px] text-muted">{ago(d.updatedAt)}</span>
                {d.mine && <button type="button" title="Delete" onClick={async () => { if (!(await confirmDialog({ title: `Delete "${d.title}"?`, body: d.teamId ? "It is removed for your team too." : undefined, confirmLabel: "Delete", tone: "danger" }))) return; await fetch(`/api/studio/${d.id}`, { method: "DELETE" }); setDocs((x) => x?.filter((y) => y.id !== d.id) ?? null); }} className="text-[11px] text-muted hover:text-neg">Delete</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
