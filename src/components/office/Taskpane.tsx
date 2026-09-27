"use client";
/// <reference types="office-js" />

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, docSettings, loadOffice, ndjson, NotConnected, openInBrowser, request, token } from "@/lib/office/client";
import { applyPatches, currentSelection, EXCEL_API, focusRange, readSnapshot, sheetIds, writeWorkbook } from "@/lib/office/excel";
import { insertDeck, linkedSlides, PPT_API, refreshDeck, selectedSlideId, unlinkSelected } from "@/lib/office/powerpoint";
import type { StudioStreamEvent } from "@/lib/studio/agent";
import type { Issue } from "@/lib/studio/audit";
import type { TieIssue } from "@/lib/studio/deck";
import type { LintIssue } from "@/lib/studio/lint";
import { applyPatch, applyWithUndo, renameSheet, type Patch } from "@/lib/studio/ops";
import type { Snapshot } from "@/lib/studio/sync";
import type { StudioDocData } from "@/lib/studio/types";

type Me = { name: string; email: string };
type DocMeta = { id: number; title: string; kind: string; ticker: string; sheets: number; slides: number; updatedAt: string; mine: boolean };
type Ev = { id: number; patches: Patch[]; undo?: Patch[]; actor: string; actorName: string; runId: string; label: string };
type Line = { k: "tool" | "change" | "note" | "error" | "text"; text: string; done?: boolean; name?: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TOOLS: Record<string, string> = {
  read_range: "Reading", write_cells: "Writing cells", format_cells: "Formatting", fill: "Filling formulas", insert_or_delete: "Moving rows and columns",
  clear_range: "Clearing", sheets: "Arranging sheets", build_model: "Building the model from SEC data", company_data: "Pulling SEC financials",
  audit_model: "Auditing", banker_format: "Banker formatting", sensitivity_table: "Computing a data table", goal_seek: "Goal seek",
  refresh_data_tables: "Refreshing data tables", add_slide: "Adding a slide", update_slide: "Updating a slide", delete_slide: "Deleting a slide",
  build_deck: "Building the deck", tie_out_deck: "Tying out the deck", brand_check: "Brand check", checkpoint: "Checkpoint", resolve_comment: "Resolving a comment",
  search_companies: "Looking up companies", get_xbrl_series: "Reading XBRL facts", search_filing: "Searching a filing", read_filing: "Reading a filing",
  get_trading_comps: "Pulling comps", calc: "Calculating", web_search: "Searching the web",
};
const TEMPLATES = [
  { id: "dcf", label: "DCF" }, { id: "comps", label: "Trading comps" }, { id: "valuation", label: "Valuation pack" }, { id: "lbo", label: "LBO" },
] as const;

/* ---------------- Shell ---------------- */

export function Taskpane() {
  const [env, setEnv] = useState<{ host: "Excel" | "PowerPoint" | null; ok: boolean } | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void loadOffice().then(async ({ host }) => {
      if (!live) return;
      if (host !== "Excel" && host !== "PowerPoint") { setEnv({ host: null, ok: false }); return; }
      const ok = host === "Excel" ? Office.context.requirements.isSetSupported("ExcelApi", EXCEL_API) : Office.context.requirements.isSetSupported("PowerPointApi", PPT_API);
      setEnv({ host, ok });
      if (!token.get()) { setMe(null); return; }
      try { setMe((await api<{ user: Me }>("/api/office/me")).user); }
      catch (e) { if (e instanceof NotConnected) token.clear(); setMe(null); }
    });
    return () => { live = false; };
  }, []);

  const signOut = useCallback(() => { token.clear(); setMe(null); }, []);

  let body: React.ReactNode;
  if (!env) body = <Centered>Starting…</Centered>;
  else if (!env.host) body = <Outside />;
  else if (!env.ok) body = <Centered>This version of {env.host} is too old for YouBank. Update Office, or use {env.host} on the web.</Centered>;
  else if (me === undefined) body = <Centered>Connecting…</Centered>;
  else if (me === null) body = <Connect host={env.host} onConnected={setMe} />;
  else body = env.host === "Excel" ? <ExcelPane me={me} onSignOut={signOut} /> : <PowerPointPane me={me} onSignOut={signOut} />;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg text-[12.5px] text-fg">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/office/icon-32.png" alt="" className="h-5 w-5" />
        <span className="text-[13px] font-semibold">YouBank</span>
        {env?.host && <span className="text-[11px] text-muted">for {env.host}</span>}
        {me && <button type="button" onClick={signOut} className="ml-auto text-[11px] text-muted underline hover:text-fg" title={me.email}>Disconnect</button>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid flex-1 place-items-center px-6 text-center text-[12.5px] text-muted">{children}</div>;
}

function Outside() {
  return (
    <div className="space-y-2 px-4 py-6 text-[12.5px]">
      <p className="font-semibold">Open this from Excel or PowerPoint.</p>
      <p className="text-muted">This page is the YouBank add-in. Install it once, then click YouBank on the Home tab.</p>
      <a href="/app/office" className="inline-block ctl bg-accent px-3 py-1.5 font-semibold text-bg">How to install</a>
    </div>
  );
}

function Connect({ host, onConnected }: { host: string; onConnected: (m: Me) => void }) {
  const [p, setP] = useState<{ code: string; poll: string; approveUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setErr(null); setBusy(true);
    try { setP(await api("/api/office/pair/start", { json: { host } })); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!p) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api<{ status: string; token?: string; user?: Me }>("/api/office/pair/poll", { json: { poll: p.poll } });
        if (r.status === "approved" && r.token && r.user) { token.set(r.token); onConnected(r.user); return; }
        if (r.status === "expired") { setP(null); setErr("That code expired. Get a new one."); return; }
      } catch { /* keep trying */ }
      if (!stop) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(timer); };
  }, [p, onConnected]);

  return (
    <div className="space-y-3 px-4 py-5">
      <p className="text-[14px] font-semibold">Connect {host} to YouBank</p>
      <p className="text-muted">The agent builds and edits models right here, cell by cell, while you watch. Connect once with a code; you can disconnect this {host} any time from YouBank.</p>
      {!p ? (
        <button type="button" disabled={busy} onClick={() => void start()} className="ctl bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-50">{busy ? "Getting a code…" : "Get a connection code"}</button>
      ) : (
        <div className="space-y-2">
          <div className="ctl border border-line bg-panel py-3 text-center font-mono text-[22px] font-semibold tracking-[0.2em]">{p.code}</div>
          <button type="button" onClick={() => openInBrowser(p.approveUrl)} className="w-full ctl bg-accent px-3 py-1.5 font-semibold text-bg">Approve in your browser</button>
          <p className="text-[11.5px] text-muted">Or open <span className="text-fg">{location.origin}/office/connect</span> and enter the code.</p>
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Waiting for approval…</p>
          <button type="button" onClick={() => { setP(null); setErr(null); }} className="text-[11px] text-muted underline">Start over</button>
        </div>
      )}
      {err && <p className="text-neg">{err}</p>}
    </div>
  );
}

/* ---------------- Shared: the agent's run log ---------------- */

function RunLog({ lines, running }: { lines: Line[]; running: boolean }) {
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines.length]);
  return (
    <div>
    <ol className="space-y-1 border-l border-line pl-2.5">
      {lines.map((l, i) => {
        if (l.k === "tool") return <li key={i} className="flex items-center gap-1.5">{l.done || !running ? <span className="text-pos">✓</span> : <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}<span>{TOOLS[l.name ?? ""] ?? l.name}</span></li>;
        if (l.k === "change") return <li key={i} className="font-mono text-[10.5px] text-muted">↳ {l.text}</li>;
        if (l.k === "note") return <li key={i} className="text-[11px] italic text-muted">{l.text}</li>;
        if (l.k === "text") return <li key={i} className="whitespace-pre-wrap leading-relaxed">{l.text}</li>;
        return <li key={i} className="text-neg">{l.text}</li>;
      })}
      {running && <li className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Working…</li>}
    </ol>
    <div ref={end} />
    </div>
  );
}

/** Stream an agent run: every event goes to `on`; returns when the run ends. */
async function streamRun(docId: number, body: Record<string, unknown>, signal: AbortSignal, on: (e: StudioStreamEvent) => void) {
  const res = await request(`/api/studio/${docId}/agent`, { json: body, signal });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The agent could not start (${res.status})`);
  for await (const e of ndjson<StudioStreamEvent>(res)) on(e);
}

function useRunLog() {
  const [lines, setLines] = useState<Line[]>([]);
  const add = useCallback((l: Line) => setLines((x) => [...x.slice(-150), l]), []);
  const onEvent = useCallback((e: StudioStreamEvent) => {
    switch (e.t) {
      case "tool":
        if (e.status === "start") add({ k: "tool", name: e.name, text: "" });
        else setLines((x) => { const i = x.map((l) => l.k === "tool" && l.name === e.name && !l.done).lastIndexOf(true); if (i < 0) return x; const n = [...x]; n[i] = { ...n[i], done: true }; return n; });
        break;
      case "patch": add({ k: "change", text: e.label }); break;
      case "note": add({ k: "note", text: e.text }); break;
      case "text": setLines((x) => (x[x.length - 1]?.k === "text" ? [...x.slice(0, -1), { k: "text", text: x[x.length - 1].text + e.text }] : [...x, { k: "text", text: e.text }])); break;
      case "error": add({ k: "error", text: e.message }); break;
      default: break;
    }
  }, [add]);
  return { lines, setLines, add, onEvent };
}

function Prompt({ placeholder, running, onRun, onStop, tasks }: { placeholder: string; running: boolean; onRun: (t: string) => void; onStop: () => void; tasks?: string[] }) {
  const [text, setText] = useState("");
  const go = (t: string) => { if (!t.trim() || running) return; setText(""); onRun(t.trim()); };
  return (
    <div className="border-t border-line bg-panel p-2">
      {tasks && !running && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {tasks.map((t) => <button key={t} type="button" onClick={() => go(t)} className="ctl border border-line bg-bg px-1.5 py-0.5 text-left text-[10.5px] hover:border-accent/60">{t}</button>)}
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(text); } }}
        className="w-full resize-none ctl border border-line bg-bg px-2 py-1.5 text-[12px] outline-none focus:border-accent/60" />
      <div className="mt-1 flex justify-end">
        {running
          ? <button type="button" onClick={onStop} className="ctl border border-neg/50 px-2.5 py-1 text-neg">Stop</button>
          : <button type="button" disabled={!text.trim()} onClick={() => go(text)} className="ctl bg-accent px-3 py-1 font-semibold text-bg disabled:opacity-40">Run ⌘↵</button>}
      </div>
    </div>
  );
}

/** Pick a YouBank document to link. */
function DocList({ filter, onPick }: { filter?: (d: DocMeta) => boolean; onPick: (d: DocMeta) => void }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ docs: DocMeta[] }>("/api/studio").then((r) => setDocs(r.docs)).catch((e) => setErr(msg(e))); }, []);
  if (err) return <p className="text-neg">{err}</p>;
  if (!docs) return <p className="text-muted">Loading your models…</p>;
  const list = filter ? docs.filter(filter) : docs;
  if (!list.length) return <p className="text-muted">Nothing here yet.</p>;
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto">
      {list.map((d) => (
        <li key={d.id}><button type="button" onClick={() => onPick(d)} className="w-full ctl border border-line bg-panel px-2 py-1.5 text-left hover:border-accent/60">
          <span className="block truncate font-medium">{d.title}</span>
          <span className="text-[10.5px] text-muted">{d.sheets} sheet{d.sheets === 1 ? "" : "s"} · {d.slides} slide{d.slides === 1 ? "" : "s"}{d.ticker ? ` · ${d.ticker}` : ""}{d.mine ? "" : " · shared"}</span>
        </button></li>
      ))}
    </ul>
  );
}

const docTitle = () => {
  try { const u = Office.context.document.url; const base = u ? decodeURIComponent(u.split(/[\\/]/).pop() ?? "") : ""; return base.replace(/\.[^.]+$/, "") || null; } catch { return null; }
};

/* ---------------- Excel ---------------- */

function ExcelPane({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [docId, setDocId] = useState<number | null>(() => (docSettings.get<string>("youbankOrigin") === location.origin ? docSettings.get<number>("youbankDocId") : null));
  if (!docId) return <ExcelStart onLinked={setDocId} onSignOut={onSignOut} />;
  return <ExcelLinked key={docId} docId={docId} me={me} onUnlink={() => { void docSettings.set({ youbankDocId: null, youbankCursor: null, youbankOrigin: null }); setDocId(null); }} onSignOut={onSignOut} />;
}

async function linkWorkbook(id: number, cursor: number) {
  await docSettings.set({ youbankDocId: id, youbankCursor: cursor, youbankOrigin: location.origin });
}

function ExcelStart({ onLinked, onSignOut }: { onLinked: (id: number) => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<"menu" | "build" | "open">("menu");
  const [template, setTemplate] = useState<string>("dcf");
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DocMeta | null>(null);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setErr(null); setBusy(label);
    try { await fn(); } catch (e) { if (e instanceof NotConnected) onSignOut(); else setErr(msg(e)); } finally { setBusy(null); }
  };
  /** Put a Studio document into this workbook and link them. */
  const load = async (id: number) => {
    const d = await api<{ doc: StudioDocData; cursor: number }>(`/api/studio/${id}`);
    const r = await Excel.run((ctx) => writeWorkbook(ctx, d.doc));
    await linkWorkbook(id, d.cursor);
    if (r.failed.length) setErr(`Excel did not accept: ${r.failed.slice(0, 6).join(", ")}${r.failed.length > 6 ? "…" : ""}`);
    onLinked(id);
  };
  const useThis = () => guard("Reading this workbook…", async () => {
    const { snapshot } = await Excel.run((ctx) => readSnapshot(ctx));
    const r = await api<{ id: number }>("/api/studio", { json: { snapshot, title: docTitle() ?? "Excel workbook" } });
    const d = await api<{ cursor: number }>(`/api/studio/${r.id}`);
    await linkWorkbook(r.id, d.cursor);
    onLinked(r.id);
  });
  const build = () => guard("Building from SEC data…", async () => {
    const r = await api<{ id: number }>("/api/studio", { json: { template, ticker: ticker.trim() || undefined } });
    await load(r.id);
  });
  const open = (d: DocMeta) => guard("Loading the model into Excel…", async () => {
    const empty = await Excel.run(async (ctx) => {
      const wss = ctx.workbook.worksheets;
      wss.load("items/name");
      await ctx.sync();
      const used = wss.items.map((w) => w.getUsedRangeOrNullObject(true));
      used.forEach((u) => u.load("address"));
      await ctx.sync();
      return used.every((u) => u.isNullObject);
    });
    if (!empty && confirm?.id !== d.id) { setConfirm(d); return; }
    setConfirm(null);
    await load(d.id);
  });

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
      {mode === "menu" && (
        <>
          <p className="text-[13.5px] font-semibold">Link this workbook to YouBank</p>
          <p className="text-muted">Once linked, the agent edits this workbook live, your edits here sync back, and a deck in PowerPoint can stay tied to the numbers.</p>
          <button type="button" onClick={() => setMode("build")} className="w-full ctl bg-accent px-3 py-2 text-left font-semibold text-bg">Build a model here<span className="block text-[11px] font-normal opacity-80">DCF, comps, LBO or a valuation pack from SEC filings</span></button>
          <button type="button" disabled={!!busy} onClick={useThis} className="w-full ctl border border-line bg-panel px-3 py-2 text-left hover:border-accent/60">Use this workbook as it is<span className="block text-[11px] text-muted">A blank sheet or your own model; the agent works on what is here</span></button>
          <button type="button" onClick={() => setMode("open")} className="w-full ctl border border-line bg-panel px-3 py-2 text-left hover:border-accent/60">Open a YouBank model here<span className="block text-[11px] text-muted">Bring a Studio model into this workbook</span></button>
        </>
      )}
      {mode === "build" && (
        <div className="space-y-2">
          <button type="button" onClick={() => setMode("menu")} className="text-[11px] text-muted underline">Back</button>
          <p className="font-semibold">Build a model from SEC data</p>
          <div className="grid grid-cols-2 gap-1">
            {TEMPLATES.map((t) => <button key={t.id} type="button" onClick={() => setTemplate(t.id)} className={`ctl border px-2 py-1.5 ${template === t.id ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel"}`}>{t.label}</button>)}
          </div>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker, e.g. NVDA" className="w-full ctl border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent/60" />
          <button type="button" disabled={!!busy || !ticker.trim()} onClick={build} className="w-full ctl bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40">Build it in this workbook</button>
        </div>
      )}
      {mode === "open" && (
        <div className="space-y-2">
          <button type="button" onClick={() => setMode("menu")} className="text-[11px] text-muted underline">Back</button>
          <p className="font-semibold">Your YouBank models</p>
          <DocList filter={(d) => d.sheets > 0} onPick={(d) => void open(d)} />
          {confirm && (
            <div className="ctl border border-accent/60 bg-accent-soft p-2">
              <p>This workbook already has data. Sheets named like the model&apos;s will be replaced; your other sheets stay and sync to YouBank.</p>
              <div className="mt-1.5 flex gap-2"><button type="button" onClick={() => void open(confirm)} className="ctl bg-accent px-2 py-1 font-semibold text-bg">Continue</button><button type="button" onClick={() => setConfirm(null)} className="text-muted underline">Cancel</button></div>
            </div>
          )}
        </div>
      )}
      {busy && <p className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />{busy}</p>}
      {err && <p className="text-neg">{err}</p>}
    </div>
  );
}

/**
 * The live link between this workbook and a Studio document. Everything that writes to Excel goes
 * through one queue, so the agent's edits land in order; the person's edits are read back on a short
 * debounce and sent as a sync once the workbook has every newer change (so a sync never undoes one).
 */
function useExcelLink(docId: number, onSignOut: () => void) {
  const mirror = useRef<StudioDocData | null>(null);
  const cursor = useRef(0);
  const applied = useRef(new Set<number>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const lastWrite = useRef(0);
  const running = useRef(false);
  const dirty = useRef(new Set<string>());
  const needFull = useRef(false);
  const wsNames = useRef(new Map<string, string>());
  const deferredFocus = useRef<{ sheet: string; range: string } | null>(null);
  /** Nothing is pulled or synced until the workbook has caught up (or the person chose which copy wins). */
  const ready = useRef(false);
  const [meta, setMeta] = useState<{ title: string; ticker: string } | null>(null);
  const [status, setStatus] = useState("Opening…");
  const [error, setError] = useState<string | null>(null);
  const [needsChoice, setNeedsChoice] = useState(false);

  const fail = useCallback((e: unknown) => { if (e instanceof NotConnected) onSignOut(); else setError(msg(e)); }, [onSignOut]);

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T | undefined> => {
    pending.current++;
    const p = chain.current.then(job).catch((e) => { fail(e); return undefined; }).finally(() => { pending.current--; lastWrite.current = Date.now(); });
    chain.current = p;
    return p;
  }, [fail]);

  const writeToExcel = useCallback((patches: Patch[]) => enqueue(async () => {
    if (!mirror.current) return;
    const r = await Excel.run((ctx) => applyPatches(ctx, mirror.current!, patches));
    if (r.failed.length) setError(`Excel did not accept: ${r.failed.slice(0, 5).join(", ")}${r.failed.length > 5 ? "…" : ""}. They are still in YouBank.`);
    const f = deferredFocus.current;
    if (f && mirror.current.workbook.sheets[f.sheet]) { deferredFocus.current = null; await Excel.run((ctx) => focusRange(ctx, mirror.current!.workbook.sheets[f.sheet].name, f.range)).catch(() => undefined); }
  }), [enqueue]);

  const focus = useCallback((sheet: string, range: string) => enqueue(async () => {
    const s = mirror.current?.workbook.sheets[sheet];
    if (!s) { deferredFocus.current = { sheet, range }; return; }
    await Excel.run((ctx) => focusRange(ctx, s.name, range)).catch(() => undefined);
  }), [enqueue]);

  const saveCursor = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistCursor = useCallback(() => {
    if (saveCursor.current) clearTimeout(saveCursor.current);
    saveCursor.current = setTimeout(() => { void docSettings.set({ youbankCursor: cursor.current }); }, 3000);
  }, []);

  /** Apply changes made elsewhere (the browser, a teammate, an agent run started in Studio). */
  const pull = useCallback(async () => {
    if (!ready.current) return;
    for (let page = 0; page < 30; page++) {
      const r = await api<{ events: Ev[]; more: boolean }>(`/api/studio/${docId}/events?since=${cursor.current}`);
      const fresh = r.events.filter((e) => !applied.current.has(e.id));
      if (fresh.length) await writeToExcel(fresh.flatMap((e) => e.patches));
      for (const e of r.events) { applied.current.delete(e.id); cursor.current = Math.max(cursor.current, e.id); }
      if (r.events.length) persistCursor();
      if (!r.more) break;
    }
  }, [docId, writeToExcel, persistCursor]);

  /** Send the person's edits: catch up first, then snapshot, then sync; retried if something landed in between. */
  const syncing = useRef(false);
  const flush = useCallback(async (full = false) => {
    if (syncing.current || !mirror.current || !ready.current) return;
    syncing.current = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        await pull();
        await chain.current;
        // Sheets renamed in Excel: rename them in Studio too, so links from the deck keep working.
        const ids = await Excel.run((ctx) => sheetIds(ctx));
        for (const [wid, name] of ids) {
          const was = wsNames.current.get(wid);
          const m = mirror.current;
          if (was && was !== name && m && Object.values(m.workbook.sheets).some((s) => s.name === was) && !Object.values(m.workbook.sheets).some((s) => s.name === name)) {
            const patches = renameSheet(m, was, name);
            const undo = applyWithUndo(m, patches);
            const r = await api<{ eventId: number }>(`/api/studio/${docId}`, { method: "PATCH", json: { patches, undo, label: `Renamed ${was} to ${name} in Excel` } });
            applied.current.add(r.eventId);
          }
        }
        const m = mirror.current;
        const structure = [...ids.values()].join("\n") !== m.workbook.order.map((id) => m.workbook.sheets[id]?.name).join("\n");
        wsNames.current = ids;
        const only = full || needFull.current || structure ? undefined : new Set(dirty.current);
        if (only && !only.size) return;
        const taken = new Set(dirty.current);
        setStatus("Syncing…");
        const { snapshot } = await Excel.run((ctx) => readSnapshot(ctx, only));
        const res = await request(`/api/studio/${docId}/sync`, { json: { snapshot: snapshot as Snapshot, base: cursor.current } });
        const data = (await res.json().catch(() => null)) as { event: { id: number; patches: Patch[] } | null; error?: string } | null;
        if (res.status === 409) continue;
        if (!res.ok) throw new Error(data?.error ?? `Sync failed (${res.status})`);
        for (const d of taken) dirty.current.delete(d);
        if (!only) needFull.current = false;
        if (data?.event) { applied.current.add(data.event.id); for (const p of data.event.patches) applyPatch(m, p); }
        setStatus("In sync");
        return;
      }
      setStatus("Busy; will sync shortly");
    } catch (e) { fail(e); setStatus("Not synced"); }
    finally { syncing.current = false; }
  }, [docId, pull, fail]);

  // Open: catch up with changes made while the workbook was closed, then send any made in Excel meanwhile.
  useEffect(() => {
    let live = true;
    (async () => {
      const d = await api<{ doc: StudioDocData; cursor: number; ticker: string }>(`/api/studio/${docId}`);
      if (!live) return;
      setMeta({ title: d.doc.title, ticker: d.ticker });
      const stored = docSettings.get<number>("youbankCursor");
      if (stored === null || stored === undefined) { mirror.current = d.doc; cursor.current = d.cursor; setNeedsChoice(true); setStatus("Choose which copy to keep"); return; }
      if (stored < d.cursor) {
        setStatus("Catching up with changes made in YouBank…");
        const events: Ev[] = [];
        for (let since = stored, page = 0; page < 20; page++) {
          const r = await api<{ events: Ev[]; more: boolean }>(`/api/studio/${docId}/events?since=${since}&undo=1`);
          events.push(...r.events);
          if (!r.more || !r.events.length) break;
          since = r.events[r.events.length - 1].id;
        }
        const base = structuredClone(d.doc);
        for (const e of [...events].reverse()) for (const p of e.undo ?? []) applyPatch(base, p);
        mirror.current = base;
        await writeToExcel(events.flatMap((e) => e.patches));
      }
      mirror.current = d.doc;
      cursor.current = d.cursor;
      persistCursor();
      wsNames.current = await Excel.run((ctx) => sheetIds(ctx));
      ready.current = true;
      await flush(true);
    })().catch(fail);
    return () => { live = false; };
  }, [docId, writeToExcel, flush, fail, persistCursor]);

  // Watch the workbook: an edit marks its sheet; a quiet second later the sheet is synced.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let handlers: OfficeExtension.EventHandlerResult<Excel.WorksheetChangedEventArgs> | null = null;
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (running.current || pending.current) schedule(); else void flush(); }, 1200); };
    void Excel.run(async (ctx) => {
      handlers = ctx.workbook.worksheets.onChanged.add(async (e) => {
        if (e.source === "Remote" || e.triggerSource === "ThisLocalAddin") return;
        if (e.triggerSource === undefined && (pending.current > 0 || Date.now() - lastWrite.current < 700)) return;
        dirty.current.add(e.worksheetId);
        schedule();
      });
      await ctx.sync();
    }).catch(() => undefined);
    // New, renamed, deleted or moved sheets, and changes from elsewhere, are picked up on a slow beat.
    const beat = setInterval(() => {
      if (running.current || pending.current || syncing.current || document.hidden || !mirror.current) return;
      void Excel.run((ctx) => sheetIds(ctx)).then((ids) => {
        const names = [...ids.values()].join("\n"), mine = mirror.current!.workbook.order.map((id) => mirror.current!.workbook.sheets[id]?.name).join("\n");
        if (names !== mine) { needFull.current = true; void flush(); } else void pull().catch(() => undefined);
      }).catch(() => undefined);
    }, 4000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(beat);
      const h = handlers;
      if (h) void Excel.run(h.context, async (ctx) => { h.remove(); await ctx.sync(); }).catch(() => undefined);
    };
  }, [flush, pull]);

  const control = useMemo(() => ({
    sheetIdByName: (name: string) => (mirror.current ? Object.values(mirror.current.workbook.sheets).find((s) => s.name === name)?.id : undefined),
    markApplied: (id: number) => { applied.current.add(id); },
    setRunning: (v: boolean) => { running.current = v; },
    /** Take a fresh copy of the document as the new baseline (after loading it into Excel). */
    rebase: (doc: StudioDocData, at: number) => { mirror.current = doc; cursor.current = at; },
    cursorNow: () => cursor.current,
    start: () => { ready.current = true; },
    settled: () => chain.current,
  }), []);

  return { ...control, meta, status, setStatus, error, setError, needsChoice, setNeedsChoice, enqueue, writeToExcel, focus, flush, pull, fail, persistCursor };
}

function ExcelLinked({ docId, me, onUnlink, onSignOut }: { docId: number; me: Me; onUnlink: () => void; onSignOut: () => void }) {
  const link = useExcelLink(docId, onSignOut);
  const log = useRunLog();
  const [running, setRunning] = useState(false);
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<"agent" | "checks" | "more">("agent");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [cpName, setCpName] = useState("");
  const abort = useRef<AbortController | null>(null);

  const run = async (instruction: string) => {
    if (running) return;
    setRunning(true); link.setRunning(true); setTab("agent");
    log.setLines([{ k: "note", text: instruction }]);
    let text = "";
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await link.flush();
      const sel = await Excel.run((ctx) => currentSelection(ctx)).catch(() => null);
      const sheet = sel ? link.sheetIdByName(sel.sheet) : undefined;
      link.setStatus("Agent working…");
      await streamRun(docId, { instruction, selection: sheet ? { sheet, range: sel!.range } : undefined, history: chat.slice(-6) }, ctl.signal, (e) => {
        log.onEvent(e);
        if (e.t === "patch") { link.markApplied(e.id); void link.writeToExcel(e.patches); }
        else if (e.t === "focus" && follow) void link.focus(e.sheet, e.range);
        else if (e.t === "text") text += e.text;
        else if (e.t === "done" && e.runId) setLastRun(e.runId);
      });
      await link.settled();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) { if (e instanceof NotConnected) onSignOut(); else log.add({ k: "error", text: msg(e) }); }
    } finally {
      abort.current = null;
      link.setRunning(false);
      setRunning(false);
      setChat((c) => [...c, { role: "user" as const, content: instruction }, ...(text ? [{ role: "assistant" as const, content: text }] : [])].slice(-12));
      link.setStatus("In sync");
      void link.flush();
    }
  };

  const act = async (name: string, args: Record<string, unknown> = {}) => {
    await link.flush();
    const r = await api<{ events: { id: number; patches: Patch[]; label: string }[]; result: unknown }>(`/api/studio/${docId}/action`, { json: { action: name, args } });
    for (const e of r.events) { link.markApplied(e.id); void link.writeToExcel(e.patches); }
    await link.settled();
    return r.result;
  };
  const guard = (fn: () => Promise<void>) => { link.setError(null); fn().catch(link.fail); };

  const undoRun = () => guard(async () => {
    if (!lastRun) return;
    const r = await api<{ event: { id: number; patches: Patch[] } }>(`/api/studio/${docId}/undo`, { json: { runId: lastRun } });
    link.markApplied(r.event.id);
    await link.writeToExcel(r.event.patches);
    setLastRun(null);
    setNote("Undid the agent's last run.");
  });

  const choose = (keep: "youbank" | "excel") => guard(async () => {
    link.setNeedsChoice(false);
    if (keep === "youbank") {
      const d = await api<{ doc: StudioDocData; cursor: number }>(`/api/studio/${docId}`);
      await link.enqueue(() => Excel.run((ctx) => writeWorkbook(ctx, d.doc)));
      link.rebase(d.doc, d.cursor);
    }
    await docSettings.set({ youbankCursor: link.cursorNow() });
    link.start();
    await link.flush(true);
  });

  const ticker = link.meta?.ticker || "NVDA";
  const tasks = [`Build a DCF for ${ticker} with a sensitivity table`, "Audit this workbook and fix what is broken", "Format this sheet like a banker", "Explain what drives the selected cell"];

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 truncate font-medium" title={link.meta?.title}>{link.meta?.title ?? "…"}</span>
        <span className={`shrink-0 ${link.error ? "text-neg" : "text-muted"}`}>{link.status}</span>
      </div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1 text-[11.5px]">
        {(["agent", "checks", "more"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`ctl px-2 py-0.5 capitalize ${tab === t ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{t === "more" ? "Model" : t}</button>)}
        <label className="ml-auto flex items-center gap-1 text-[10.5px] text-muted"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow</label>
      </div>
      {link.error && <p className="border-b border-line bg-neg/10 px-3 py-1 text-[11.5px] text-neg">{link.error} <button type="button" className="underline" onClick={() => link.setError(null)}>Dismiss</button></p>}
      {note && <p className="border-b border-line bg-accent-soft px-3 py-1 text-[11.5px]">{note} <button type="button" className="underline" onClick={() => setNote(null)}>OK</button></p>}
      {link.needsChoice && (
        <div className="space-y-2 border-b border-line bg-accent-soft px-3 py-2 text-[11.5px]">
          <p>This workbook is linked to YouBank but has not synced here before. Which copy should win?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => choose("youbank")} className="ctl bg-accent px-2 py-1 font-semibold text-bg">Load from YouBank</button>
            <button type="button" onClick={() => choose("excel")} className="ctl border border-line bg-panel px-2 py-1">Keep this workbook</button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tab === "agent" && (log.lines.length ? (
          <>
            <RunLog lines={log.lines} running={running} />
            {!running && lastRun && <button type="button" onClick={undoRun} className="mt-2 text-[11px] text-muted underline hover:text-fg">Undo this run</button>}
          </>
        ) : (
          <div className="space-y-2 text-muted">
            <p>Ask for anything a banking analyst would do in this workbook. You&apos;ll see each change land in Excel as the agent makes it; every run can be undone.</p>
            <p className="text-[11px]">Connected as {me.name || me.email || "your YouBank account"}.</p>
          </div>
        ))}
        {tab === "checks" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => guard(async () => setIssues((await act("audit")) as Issue[]))} className="ctl border border-line px-2 py-1 hover:border-accent/60">Audit the model</button>
              <button type="button" onClick={() => guard(async () => { await act("format"); setNote("Applied banker formatting."); })} className="ctl border border-line px-2 py-1 hover:border-accent/60">Banker formatting</button>
              <button type="button" onClick={() => guard(async () => { await act("refresh"); setNote("Data tables recomputed."); })} className="ctl border border-line px-2 py-1 hover:border-accent/60">Refresh data tables</button>
            </div>
            {issues && (
              <>
                <p className="font-semibold">{issues.length ? `${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warning").length} warnings` : "No issues found."}</p>
                <ul className="space-y-1">
                  {issues.slice(0, 80).map((i, k) => (
                    <li key={k}><button type="button" onClick={() => void Excel.run((ctx) => focusRange(ctx, i.sheet, i.cell)).catch(() => undefined)} className="w-full text-left hover:text-fg">
                      <span className={`mr-1 ctl px-1 text-[9.5px] uppercase ${i.severity === "error" ? "bg-neg/15 text-neg" : i.severity === "warning" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{i.severity}</span>
                      <span className="font-mono">{i.sheet}!{i.cell}</span> <span className="text-muted">{i.message}</span>
                    </button></li>
                  ))}
                </ul>
                {issues.some((i) => i.severity !== "info") && <button type="button" onClick={() => void run("Fix the errors and warnings the audit found. Leave intentional items alone and say why.")} className="ctl bg-accent px-2 py-1 font-semibold text-bg">Ask the agent to fix these</button>}
              </>
            )}
          </div>
        )}
        {tab === "more" && (
          <div className="space-y-3">
            <div>
              <p className="font-semibold">Add a model from SEC data</p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {TEMPLATES.map((t) => <button key={t.id} type="button" disabled={running} onClick={() => guard(async () => { await act("template", { template: t.id, ticker }); setNote(`Added ${t.label} for ${ticker}.`); })} className="ctl border border-line bg-panel px-2 py-1 hover:border-accent/60 disabled:opacity-40">{t.label}</button>)}
              </div>
              <p className="mt-1 text-[10.5px] text-muted">For {ticker}. Ask the agent for another company.</p>
            </div>
            <div>
              <p className="font-semibold">Checkpoint</p>
              <p className="text-[11px] text-muted">Save the model as it is now, to compare against or go back to in YouBank.</p>
              <div className="mt-1 flex gap-1">
                <input value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="e.g. Sent to MD" className="min-w-0 flex-1 ctl border border-line bg-bg px-2 py-1 outline-none focus:border-accent/60" />
                <button type="button" disabled={!cpName.trim()} onClick={() => guard(async () => { await link.flush(); await api(`/api/studio/${docId}/checkpoints`, { json: { name: cpName.trim() } }); setNote(`Saved checkpoint "${cpName.trim()}".`); setCpName(""); })} className="ctl bg-accent px-2 py-1 font-semibold text-bg disabled:opacity-40">Save</button>
              </div>
            </div>
            <div className="space-y-1">
              <button type="button" onClick={() => openInBrowser(`${location.origin}/app/studio/${docId}`)} className="block text-accent underline">Open in YouBank Studio</button>
              <button type="button" onClick={() => guard(() => link.flush(true))} className="block text-muted underline hover:text-fg">Sync now</button>
              <button type="button" onClick={onUnlink} className="block text-muted underline hover:text-fg">Unlink this workbook</button>
            </div>
          </div>
        )}
      </div>
      <Prompt placeholder={`e.g. "Build an LBO for ${ticker}", "add a 10-year projection", "fix the circularity"`} running={running} onRun={(t) => void run(t)} onStop={() => abort.current?.abort()} tasks={log.lines.length ? undefined : tasks} />
    </>
  );
}

/* ---------------- PowerPoint ---------------- */

function PowerPointPane({ onSignOut }: { me: Me; onSignOut: () => void }) {
  const [docId, setDocId] = useState<number | null>(() => (docSettings.get<string>("youbankOrigin") === location.origin ? docSettings.get<number>("youbankDocId") : null));
  const [title, setTitle] = useState<string>("");
  const [linked, setLinked] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lint, setLint] = useState<LintIssue[] | null>(null);
  const [ties, setTies] = useState<TieIssue[] | null>(null);
  const [running, setRunning] = useState(false);
  const log = useRunLog();
  const abort = useRef<AbortController | null>(null);

  const guard = useCallback(async (label: string, fn: () => Promise<void>) => {
    setErr(null); setBusy(label);
    try { await fn(); } catch (e) { if (e instanceof NotConnected) onSignOut(); else setErr(msg(e)); } finally { setBusy(null); }
  }, [onSignOut]);

  const countLinked = useCallback(async (id: number) => {
    const l = await PowerPoint.run((ctx) => linkedSlides(ctx));
    setLinked(l.filter((s) => s.doc === String(id)).length);
  }, []);

  useEffect(() => {
    if (!docId) return;
    api<{ doc: StudioDocData }>(`/api/studio/${docId}`).then((d) => setTitle(d.doc.title)).catch((e) => { if (e instanceof NotConnected) onSignOut(); else setErr(msg(e)); });
    PowerPoint.run((ctx) => linkedSlides(ctx)).then((l) => setLinked(l.filter((x) => x.doc === String(docId)).length)).catch(() => undefined);
  }, [docId, onSignOut]);

  const deck = async (id: number) => api<{ base64: string; slides: string[] }>(`/api/studio/${id}/export?format=pptx&as=base64`);
  const insert = () => guard("Inserting the deck…", async () => {
    const d = await deck(docId!);
    if (!d.slides.length) throw new Error("This model has no slides yet. Ask the agent to build a deck.");
    const n = await PowerPoint.run(async (ctx) => insertDeck(ctx, d.base64, d.slides, docId!, await selectedSlideId(ctx)));
    setNote(`Inserted ${n} slide${n === 1 ? "" : "s"}, linked to the model.`);
    await countLinked(docId!);
  });
  const refresh = useCallback(() => guard("Refreshing from the model…", async () => {
    const d = await deck(docId!);
    const r = await PowerPoint.run((ctx) => refreshDeck(ctx, d.base64, d.slides, docId!));
    setNote(`Refreshed ${r.replaced} slide${r.replaced === 1 ? "" : "s"}${r.added ? `, added ${r.added}` : ""}${r.removed ? `, removed ${r.removed}` : ""}.`);
    await countLinked(docId!);
  }), [guard, docId, countLinked]);
  const act = async (name: string, args: Record<string, unknown> = {}) => (await api<{ result: unknown }>(`/api/studio/${docId}/action`, { json: { action: name, args } })).result;

  const run = async (instruction: string) => {
    if (running || !docId) return;
    setRunning(true); setErr(null);
    log.setLines([{ k: "note", text: instruction }]);
    const ctl = new AbortController();
    abort.current = ctl;
    let changed = false;
    try {
      await streamRun(docId, { instruction }, ctl.signal, (e) => { log.onEvent(e); if (e.t === "patch" && e.patches.some((p) => p.op.startsWith("slide") || p.op.startsWith("deck") || p.op === "cells")) changed = true; });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) { if (e instanceof NotConnected) onSignOut(); else log.add({ k: "error", text: msg(e) }); }
    } finally {
      abort.current = null;
      setRunning(false);
      if (changed && linked) await refresh();
    }
  };

  if (!docId) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <p className="text-[13.5px] font-semibold">Link this presentation to a YouBank model</p>
        <p className="text-muted">Slides come in with native tables and charts tied to the model. When the numbers change, refresh them here.</p>
        <DocList onPick={(d) => { void docSettings.set({ youbankDocId: d.id, youbankOrigin: location.origin }); setDocId(d.id); }} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 truncate font-medium">{title || "…"}</span>
        <span className="shrink-0 text-muted">{linked === null ? "" : `${linked} linked slide${linked === 1 ? "" : "s"}`}</span>
      </div>
      {err && <p className="border-b border-line bg-neg/10 px-3 py-1 text-[11.5px] text-neg">{err}</p>}
      {note && <p className="border-b border-line bg-accent-soft px-3 py-1 text-[11.5px]">{note} <button type="button" className="underline" onClick={() => setNote(null)}>OK</button></p>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {linked ? <button type="button" disabled={!!busy} onClick={refresh} className="ctl bg-accent px-2.5 py-1 font-semibold text-bg disabled:opacity-40">Refresh from the model</button>
            : <button type="button" disabled={!!busy} onClick={insert} className="ctl bg-accent px-2.5 py-1 font-semibold text-bg disabled:opacity-40">Insert the deck</button>}
          {!!linked && <button type="button" disabled={!!busy} onClick={insert} className="ctl border border-line px-2 py-1 hover:border-accent/60">Insert again</button>}
          <button type="button" disabled={!!busy} onClick={() => guard("Checking the deck…", async () => { setLint((await act("lint")) as LintIssue[]); setTies((await act("tieout")) as TieIssue[]); })} className="ctl border border-line px-2 py-1 hover:border-accent/60">Brand check and tie-out</button>
        </div>
        {busy && <p className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />{busy}</p>}
        {lint && (
          <div>
            <p className="font-semibold">Brand check: {lint.length ? `${lint.length} item${lint.length === 1 ? "" : "s"}` : "clean"}</p>
            <ul className="mt-1 space-y-1">
              {lint.map((i) => (
                <li key={i.key} className="flex items-start gap-1.5">
                  <span className={`mt-0.5 shrink-0 ctl px-1 text-[9.5px] uppercase ${i.severity === "error" ? "bg-neg/15 text-neg" : i.severity === "warning" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{i.severity}</span>
                  <span className="min-w-0 flex-1"><span className="text-muted">{i.slideTitle}:</span> {i.message}</span>
                  {i.fix && <button type="button" onClick={() => guard("Fixing…", async () => { setLint((await act("lint_fix", { keys: [i.key] })) as LintIssue[]); if (linked) await refresh(); })} className="shrink-0 text-[11px] text-accent underline">{i.fixLabel ?? "Fix"}</button>}
                </li>
              ))}
            </ul>
            {lint.filter((i) => i.fix).length > 1 && <button type="button" onClick={() => guard("Fixing…", async () => { setLint((await act("lint_fix")) as LintIssue[]); if (linked) await refresh(); })} className="mt-1.5 ctl bg-accent px-2 py-1 font-semibold text-bg">Fix all {lint.filter((i) => i.fix).length}</button>}
          </div>
        )}
        {ties && (
          <div>
            <p className="font-semibold">Tie-out: {ties.length ? `${ties.length} item${ties.length === 1 ? "" : "s"}` : "every figure ties to the model"}</p>
            <ul className="mt-1 space-y-1">{ties.map((t, k) => <li key={k}><span className="text-muted">{t.slideTitle}:</span> {t.message}</li>)}</ul>
          </div>
        )}
        {(running || log.lines.length > 0) && <RunLog lines={log.lines} running={running} />}
        <div className="space-y-1 border-t border-line pt-2 text-[11.5px]">
          <button type="button" onClick={() => guard("Unlinking…", async () => { const n = await PowerPoint.run((ctx) => unlinkSelected(ctx)); setNote(`${n} slide${n === 1 ? "" : "s"} will keep your edits and no longer refresh.`); await countLinked(docId); })} className="block text-muted underline hover:text-fg">Keep my edits on the selected slides</button>
          <button type="button" onClick={() => openInBrowser(`${location.origin}/app/studio/${docId}?tab=deck`)} className="block text-accent underline">Open in YouBank Studio</button>
          <button type="button" onClick={() => { void docSettings.set({ youbankDocId: null, youbankOrigin: null }); setDocId(null); setLinked(null); }} className="block text-muted underline hover:text-fg">Link a different model</button>
        </div>
      </div>
      <Prompt placeholder={'e.g. "add a slide with the comps table", "make the football field the second slide"'} running={running} onRun={(t) => void run(t)} onStop={() => abort.current?.abort()} />
    </>
  );
}
