"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { addr as A1, parseAddr, parseRange } from "@/lib/studio/address";
import { NUMBER_FORMATS } from "@/lib/studio/format";
import { addSheet, deleteSheet, formatRange, renameSheet, type Patch } from "@/lib/studio/ops";
import { tasksFor } from "@/lib/studio/roles";
import type { SemDiff } from "@/lib/studio/checkpoints";
import { newId, type CellStyle } from "@/lib/studio/types";
import { DeckView } from "./DeckView";
import { Grid, cellSel, selRange, type Sel } from "./Grid";
import { useStudio, type LogItem } from "./useStudio";

const TOOL: Record<string, string> = {
  read_range: "Reading", write_cells: "Writing cells", format_cells: "Formatting", fill: "Filling formulas", insert_or_delete: "Moving rows and columns",
  clear_range: "Clearing", sheets: "Arranging sheets", build_model: "Building the model from SEC data", company_data: "Pulling SEC financials",
  audit_model: "Auditing the model", banker_format: "Banker formatting", sensitivity_table: "Computing a data table", goal_seek: "Goal seek",
  refresh_data_tables: "Refreshing data tables", add_slide: "Adding a slide", update_slide: "Updating a slide", delete_slide: "Deleting a slide",
  build_deck: "Building the deck", tie_out_deck: "Tying out the deck", brand_check: "Brand check", checkpoint: "Checkpoint", resolve_comment: "Resolving a comment",
  search_companies: "Looking up companies", get_xbrl_series: "Reading XBRL facts", search_filing: "Searching a filing", read_filing: "Reading a filing",
  get_trading_comps: "Pulling comps", calc: "Calculating", web_search: "Searching the web",
};

const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

export function StudioWorkspace({ id, initialAsk = null, initialTab = "model", initialSlide = null }: { id: number; initialAsk?: string | null; initialTab?: "model" | "deck"; initialSlide?: number | null }) {
  const { profile } = useWorkspace();
  const st = useStudio(id);
  const { doc, engine, meta } = st;
  const [tab, setTab] = useState<"model" | "deck">(initialTab);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(cellSel(1, 1));
  const [slide, setSlide] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [showTypes, setShowTypes] = useState(false);
  const [effort, setEffort] = useState<"fast" | "balanced" | "thorough">("balanced");
  const [prompt, setPrompt] = useState("");
  const [side, setSide] = useState<"agent" | "checks" | "history">("agent");
  const logEnd = useRef<HTMLDivElement | null>(null);
  const docInput = useRef<HTMLInputElement | null>(null);
  const docKind = useRef<"markup" | "extract">("markup");
  const [docMenu, setDocMenu] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [cpName, setCpName] = useState("");
  const [diffs, setDiffs] = useState<Record<number, SemDiff>>({});

  const readOnly = false;
  // While the agent works and "Follow agent" is on, the view goes where the agent is writing.
  const following = follow && st.agent.running ? st.lastWhere() : null;
  const tabNow = following?.where ?? tab;
  const sheetNow = following?.where === "model" && following.sheet && doc?.workbook.sheets[following.sheet] ? following.sheet : sheetId;
  const linkedSlide = !slide && initialSlide && doc ? doc.deck.order[initialSlide - 1] ?? null : null;
  const slideNow = following?.where === "deck" && following.slide ? following.slide : slide ?? linkedSlide;
  const sheet = doc && (sheetNow && doc.workbook.sheets[sheetNow] ? doc.workbook.sheets[sheetNow] : doc.workbook.sheets[doc.workbook.order[0]]);
  /** When a run ends, stay where the agent finished. */
  const settle = () => {
    const w = st.lastWhere();
    if (!follow || !w) return;
    setTab(w.where);
    if (w.sheet) setSheetId(w.sheet);
    if (w.slide) setSlide(w.slide);
  };
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [st.agent.log.length, st.agent.text]);

  const edit = useCallback((p: Patch[], label?: string) => { void st.edit(p, label); }, [st]);
  const style = useCallback((s: CellStyle) => { if (doc && sheet) edit([formatRange(doc, sheet.name, selRange(sel), s)], `Formatted ${sheet.name}!${selRange(sel)}`); }, [doc, sheet, sel, edit]);

  const runPrompt = (text: string) => {
    const t = text.trim();
    if (!t || st.agent.running) return;
    setPrompt("");
    setSide("agent");
    void st.run(t, { effort, selection: sheet ? { sheet: sheet.id, range: selRange(sel) } : undefined }).then(settle);
  };

  const tasks = useMemo(() => tasksFor(profile.role, meta?.ticker ?? ""), [profile.role, meta?.ticker]);

  // Arriving from "Describe what you need": start the agent as soon as the model is open.
  const asked = useRef(false);
  useEffect(() => {
    if (!initialAsk || asked.current || !doc || !meta) return;
    asked.current = true;
    window.history.replaceState(null, "", `/app/studio/${id}`);
    void st.run(initialAsk, { effort }).then(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk, doc, meta]);
  const openComments = doc?.comments.filter((c) => !c.resolved) ?? [];

  if (st.error && !doc) return <div className="p-6 text-[12.5px] text-neg">{st.error} <Link href="/app/studio" className="underline">Back to Studio</Link></div>;
  if (!doc || !engine || !meta || !sheet) return <div className="grid h-full place-items-center text-[12px] text-muted">Opening the model…</div>;

  const active = sheet.cells[A1(sel.ar, sel.ac)];
  const addComment = () => {
    const t = window.prompt(`Comment on ${sheet.name}!${selRange(sel)} (the agent can turn it):`);
    if (t) edit([{ op: "comments", comments: [...doc.comments, { id: newId("cm"), target: { kind: "cell", sheet: sheet.id, cell: A1(sel.ar, sel.ac) }, text: t, author: meta.me.name, at: new Date().toISOString() }] }], "Commented on a cell");
  };
  const go = (sheetName: string, cell: string) => {
    const sid = doc.workbook.order.find((x) => doc.workbook.sheets[x].name === sheetName);
    const p = parseAddr(cell);
    if (sid && p) { setTab("model"); setSheetId(sid); setSel(cellSel(p.r, p.c)); }
  };

  const pickDocument = (kind: "markup" | "extract") => { docKind.current = kind; setDocMenu(false); docInput.current?.click(); };
  const onDocument = async (f: File) => {
    const kind = docKind.current;
    setReading(kind === "markup" ? `Reading the markup in ${f.name}…` : `Extracting tables from ${f.name}…`);
    try {
      const r = await st.readDocument(kind, f);
      if (kind === "markup") {
        st.setNotice(r.added ? `Added ${r.added} comment${r.added === 1 ? "" : "s"} from ${f.name}${r.unplaced ? ` (${r.unplaced} placed on the nearest page)` : ""}${r.illegible ? `; ${r.illegible} mark${r.illegible === 1 ? " was" : "s were"} unreadable` : ""}. Turn them from Checks.` : `No reviewer marks found in ${f.name}.`);
        if (r.added) setSide("checks");
      } else {
        st.setNotice(`Extracted ${r.tables} table${r.tables === 1 ? "" : "s"}, ${r.figures} figures, to ${r.sheet?.name}. Each figure is a blue input tagged with its page.`);
        if (r.sheet) { setTab("model"); setSheetId(r.sheet.id); }
      }
    } catch (e) { st.setError(e instanceof Error ? e.message : String(e)); }
    finally { setReading(null); }
  };
  const compare = async (cid: number) => {
    if (diffs[cid]) { setDiffs((d) => { const n = { ...d }; delete n[cid]; return n; }); return; }
    try { const r = await st.compareCheckpoint(cid); setDiffs((d) => ({ ...d, [cid]: r.diff })); } catch (e) { st.setError(e instanceof Error ? e.message : String(e)); }
  };
  const fixable = st.lint?.filter((i) => i.fix).length ?? 0;

  const intake = meta.intake as null | { file: string; sheets: { name: string; cells: number; formulas: number; hidden: boolean }[]; unsupported: { fn: string; count: number }[]; externalLinks: number; dropped: string[]; warnings: string[] };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        <Link href="/app/studio" className="text-[11.5px] text-muted hover:text-fg">Studio</Link>
        <span className="text-muted">/</span>
        <input value={doc.title} onChange={(e) => edit([{ op: "title", title: e.target.value }], "Renamed")} className="min-w-[160px] max-w-[360px] flex-1 bg-transparent text-[13px] font-semibold outline-none" />
        <div className="flex overflow-hidden ctl border border-line text-[11.5px]">
          {(["model", "deck"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`flex items-center gap-1.5 px-2.5 py-1 ${tabNow === t ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              <Icon name={t === "model" ? "FileSpreadsheet" : "Presentation"} className="h-3.5 w-3.5" />{t === "model" ? `Model · ${doc.workbook.order.length}` : `Deck · ${doc.deck.order.length}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow agent</label>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">
          {st.saving ? "Saving…" : "Saved"}
          <a href={`/api/studio/${id}/export?format=xlsx`} className="ctl border border-line px-2 py-1 text-fg hover:border-accent/60"><Icon name="Download" className="mr-1 inline h-3.5 w-3.5" />Excel</a>
          <a href={`/api/studio/${id}/export?format=pptx`} className="ctl border border-line px-2 py-1 text-fg hover:border-accent/60"><Icon name="Download" className="mr-1 inline h-3.5 w-3.5" />PowerPoint</a>
          <Link href="/app/office" title="Work on this model inside Excel and PowerPoint, live" className="ctl border border-line px-2 py-1 text-fg hover:border-accent/60"><Icon name="FileSpreadsheet" className="mr-1 inline h-3.5 w-3.5" />Excel add-in</Link>
          <span className="relative">
            <button type="button" disabled={!!reading} onClick={() => setDocMenu((v) => !v)} className="ctl border border-line px-2 py-1 text-fg hover:border-accent/60 disabled:opacity-50"><Icon name="Upload" className="mr-1 inline h-3.5 w-3.5" />{reading ? "Reading…" : "From a document"}</button>
            {docMenu && (
              <span className="absolute right-0 top-full z-20 mt-1 flex w-[270px] flex-col ctl border border-line bg-panel p-1 text-left shadow-lg">
                <button type="button" onClick={() => pickDocument("markup")} className="ctl px-2 py-1.5 text-left hover:bg-elevated"><span className="block text-[12px] text-fg">Marked-up printout → comments</span><span className="block text-[10.5px]">A PDF or phone photo of the MD&apos;s pen marks; each becomes a comment on its cell or slide.</span></button>
                <button type="button" onClick={() => pickDocument("extract")} className="ctl px-2 py-1.5 text-left hover:bg-elevated"><span className="block text-[12px] text-fg">Data-room PDF → tables</span><span className="block text-[10.5px]">Financial tables from a CIM or accounts, as sourced inputs on a new sheet.</span></button>
              </span>
            )}
            <input ref={docInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onDocument(f); }} />
          </span>
          {meta.mine && meta.teams.length > 0 && (
            <select value={meta.teamId ?? ""} onChange={(e) => { void fetch(`/api/studio/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ share: e.target.value ? Number(e.target.value) : null }) }).then(() => st.reload()); }} className="ctl border border-line bg-bg px-1.5 py-1 text-[11px] text-fg">
              <option value="">Private</option>
              {meta.teams.map((t) => <option key={t.id} value={t.id}>Shared: {t.name}</option>)}
            </select>
          )}
        </span>
      </div>
      {reading && <div className="flex items-center gap-1.5 bg-accent-soft px-3 py-1 text-[11.5px]"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />{reading}</div>}
      {(st.error || st.notice) && <div className={`px-3 py-1 text-[11.5px] ${st.error ? "bg-neg/10 text-neg" : "bg-accent-soft text-fg"}`}>{st.error ?? st.notice} <button type="button" className="ml-2 underline" onClick={() => { st.setError(null); st.setNotice(null); }}>Dismiss</button></div>}

      <div className="flex min-h-0 flex-1">
        {/* Model or deck */}
        <div className="flex min-w-0 flex-1 flex-col">
          {tabNow === "model" ? (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-2 py-1 text-[11.5px]">
                <select value={active?.s?.nf ?? "General"} onChange={(e) => style({ nf: e.target.value === "General" ? undefined : e.target.value })} className="ctl border border-line bg-bg px-1.5 py-0.5 text-[11.5px]">
                  {NUMBER_FORMATS.map((f) => <option key={f.nf} value={f.nf}>{f.label}</option>)}
                  {active?.s?.nf && !NUMBER_FORMATS.some((f) => f.nf === active.s?.nf) && <option value={active.s.nf}>{active.s.nf}</option>}
                </select>
                <button type="button" onClick={() => style({ b: !active?.s?.b })} className={`ctl border border-line px-2 py-0.5 font-bold ${active?.s?.b ? "bg-accent-soft text-accent" : ""}`}>B</button>
                <button type="button" onClick={() => style({ i: !active?.s?.i })} className={`ctl border border-line px-2 py-0.5 italic ${active?.s?.i ? "bg-accent-soft text-accent" : ""}`}>I</button>
                <span className="mx-1 h-4 w-px bg-line" />
                <button type="button" title="Input (blue)" onClick={() => style({ color: "#0000FF" })} className="ctl border border-line px-2 py-0.5" style={{ color: "#3B6BFF" }}>Input</button>
                <button type="button" title="Formula (black)" onClick={() => style({ color: "#000000" })} className="ctl border border-line px-2 py-0.5">Formula</button>
                <button type="button" title="Link to another sheet (green)" onClick={() => style({ color: "#008000" })} className="ctl border border-line px-2 py-0.5" style={{ color: "#2E9E4F" }}>Link</button>
                <button type="button" title="Key output" onClick={() => style({ fill: active?.s?.fill === "#FFF2CC" ? undefined : "#FFF2CC", b: true })} className="ctl border border-line px-2 py-0.5">Key</button>
                <button type="button" title="Total: bold with a top border" onClick={() => style({ b: true, bt: "thin" })} className="ctl border border-line px-2 py-0.5">Total</button>
                <span className="mx-1 h-4 w-px bg-line" />
                <button type="button" onClick={() => st.undoLast()} className="ctl border border-line px-2 py-0.5" title="Undo (Cmd/Ctrl+Z)">Undo</button>
                <button type="button" onClick={addComment} className="ctl border border-line px-2 py-0.5">Comment</button>
                <label className="ml-1 flex items-center gap-1 text-[11px] text-muted" title="Tint cells by type: inputs blue, links green, formulas grey, numbers typed into formulas orange"><input type="checkbox" checked={showTypes} onChange={(e) => setShowTypes(e.target.checked)} /> Cell types</label>
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => void st.action("format").then(() => st.setNotice("Applied banker formatting."))} className="ctl border border-line px-2 py-0.5 hover:border-accent/60">Format</button>
                  <button type="button" onClick={() => { setSide("checks"); void st.action("audit"); }} className="ctl border border-line px-2 py-0.5 hover:border-accent/60">Audit</button>
                  {doc.workbook.order.some((x) => doc.workbook.sheets[x].sens?.length) && <button type="button" onClick={() => void st.action("refresh")} className="ctl border border-line px-2 py-0.5 hover:border-accent/60">Refresh tables</button>}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <Grid engine={engine} sheet={sheet} flash={st.flash} focus={st.focus} follow={follow} sel={sel} setSel={setSel} onEdit={edit} onUndo={() => st.undoLast()} comments={doc.comments} showTypes={showTypes} readOnly={readOnly} onStyle={style} now={st.clock} agentActive={st.agent.running} />
              </div>
              <div className="flex items-center gap-0.5 overflow-x-auto border-t border-line bg-panel px-1.5 py-1 text-[11.5px]">
                {doc.workbook.order.map((sid) => (
                  <button key={sid} type="button" onClick={() => setSheetId(sid)} onDoubleClick={() => { const n = window.prompt("Rename sheet", doc.workbook.sheets[sid].name); if (n && n !== doc.workbook.sheets[sid].name) edit(renameSheet(doc, doc.workbook.sheets[sid].name, n)); }}
                    className={`ctl whitespace-nowrap px-2.5 py-0.5 ${sid === sheet.id ? "bg-bg font-semibold text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{doc.workbook.sheets[sid].name}</button>
                ))}
                <button type="button" title="Add a sheet" onClick={() => { const { patch, sheet: s } = addSheet(doc, "Sheet"); edit([patch]); setSheetId(s.id); }} className="ctl px-2 py-0.5 text-muted hover:text-fg">+</button>
                {doc.workbook.order.length > 1 && <button type="button" title="Delete this sheet" onClick={() => { if (window.confirm(`Delete sheet "${sheet.name}"? Formulas pointing at it will show #REF!.`)) { edit(deleteSheet(doc, sheet.name)); setSheetId(null); } }} className="ml-auto ctl px-2 py-0.5 text-muted hover:text-neg">Delete sheet</button>}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1">
              <DeckView doc={doc} engine={engine} current={slideNow} setCurrent={setSlide} onEdit={edit} comments={doc.comments} readOnly={readOnly} flashSlide={st.agent.running ? st.focusSlide : null} />
            </div>
          )}
        </div>

        {/* Agent */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-[11.5px]">
            {(["agent", "checks", "history"] as const).map((t) => (
              <button key={t} type="button" onClick={() => { setSide(t); if (t === "history") void st.loadCheckpoints().catch(() => undefined); }} className={`ctl px-2 py-0.5 ${side === t ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
                {t === "agent" ? "Agent" : t === "checks" ? `Checks${st.health && st.health.errors ? ` · ${st.health.errors}` : ""}` : "History"}
              </button>
            ))}
            {st.health && (
              <button type="button" onClick={() => { setSide("checks"); void st.action("audit"); }} className={`ml-auto ctl px-2 py-0.5 text-[11px] ${st.health.errors ? "bg-neg/15 text-neg" : "bg-pos/15 text-pos"}`}>
                {st.health.errors ? `${st.health.errors} error${st.health.errors === 1 ? "" : "s"}` : "No errors"}{st.health.warnings ? ` · ${st.health.warnings} warning${st.health.warnings === 1 ? "" : "s"}` : ""}
              </button>
            )}
          </div>

          {side === "agent" && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px]">
                {intake && !st.agent.log.length && !st.chat.length && (
                  <div className="mb-3 ctl border border-line bg-bg/50 p-2.5 text-[11.5px]">
                    <p className="font-semibold">Intake report: {intake.file}</p>
                    <p className="mt-1 text-muted">{intake.sheets.length} sheet{intake.sheets.length === 1 ? "" : "s"}, {intake.sheets.reduce((n, s) => n + s.cells, 0).toLocaleString()} cells, {intake.sheets.reduce((n, s) => n + s.formulas, 0).toLocaleString()} formulas.</p>
                    {intake.unsupported.length > 0 && <p className="mt-1">Functions shown with the file&apos;s saved values: {intake.unsupported.map((u) => `${u.fn} (${u.count})`).join(", ")}.</p>}
                    {intake.externalLinks > 0 && <p className="mt-1 text-neg">{intake.externalLinks} link{intake.externalLinks === 1 ? "" : "s"} to other workbooks: values kept, formulas noted in the cell source.</p>}
                    {intake.warnings.map((w) => <p key={w} className="mt-1">{w}</p>)}
                    {intake.dropped.length > 0 && <p className="mt-1 text-muted">Not imported: {intake.dropped.join("; ")}.</p>}
                    <button type="button" onClick={() => runPrompt("Review this uploaded model like a VP: audit it, list the ten most important issues with cell references, and fix the clear-cut ones.")} className="mt-2 ctl bg-accent px-2 py-1 text-[11.5px] font-semibold text-bg">Review this file</button>
                  </div>
                )}
                {!st.agent.log.length && !st.chat.length && (
                  <div>
                    <p className="text-[11.5px] text-muted">Tell the agent what to build or change. You&apos;ll watch it work in the {tabNow === "model" ? "sheet" : "deck"}, and every change can be undone.</p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {tasks.map((t) => <button key={t} type="button" onClick={() => runPrompt(t)} className="ctl border border-line bg-bg/50 px-2 py-1.5 text-left text-[11.5px] hover:border-accent/60">{t}</button>)}
                    </div>
                    {openComments.length > 0 && <p className="mt-3 text-[11px] text-muted">{openComments.length} open comment{openComments.length === 1 ? "" : "s"}. Try &ldquo;Turn all open comments&rdquo;.</p>}
                  </div>
                )}
                {st.chat.map((m, i) => (
                  m.role === "user"
                    ? <p key={i} className="mt-3 ctl bg-accent-soft px-2 py-1.5 text-[12px] font-medium">{m.content}</p>
                    : <p key={i} className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">{m.content}</p>
                ))}
                {(st.agent.running || st.agent.log.length > 0) && <RunLog log={st.agent.log} running={st.agent.running} />}
                {st.agent.running && st.agent.text && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">{st.agent.text}</p>}
                {!st.agent.running && st.agent.runId && st.agent.stats && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
                    <span>{st.agent.stats.cells ?? 0} cells · {st.agent.stats.slides ?? 0} slides · {st.agent.stats.seconds ?? 0}s{st.agent.model ? ` · ${st.agent.model}` : ""}</span>
                    <button type="button" onClick={() => void st.undoRun(st.agent.runId!)} className="underline hover:text-fg">Undo this run</button>
                  </div>
                )}
                <div ref={logEnd} />
              </div>
              <div className="border-t border-line p-2">
                <textarea
                  value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runPrompt(prompt); } }}
                  placeholder={tabNow === "model" ? `e.g. "Build a DCF for ${meta.ticker || "NVDA"}", "add a 10-year projection", "fix the circularity"` : `e.g. "add a slide with the comps table", "turn the comments"`}
                  className="w-full resize-none ctl border border-line bg-bg px-2 py-1.5 text-[12px] outline-none focus:border-accent/60"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="flex overflow-hidden ctl border border-line text-[10.5px]">
                    {(["fast", "balanced", "thorough"] as const).map((e) => <button key={e} type="button" onClick={() => setEffort(e)} className={`px-2 py-0.5 capitalize ${effort === e ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{e}</button>)}
                  </div>
                  <span className="text-[10.5px] text-muted">{selRange(sel)} on {sheet.name}</span>
                  {st.agent.running
                    ? <button type="button" onClick={st.stop} className="ml-auto ctl border border-neg/50 px-2.5 py-1 text-[11.5px] text-neg">Stop</button>
                    : <button type="button" disabled={!prompt.trim()} onClick={() => runPrompt(prompt)} className="ml-auto ctl bg-accent px-3 py-1 text-[11.5px] font-semibold text-bg disabled:opacity-40">Run ⌘↵</button>}
                </div>
              </div>
            </>
          )}

          {side === "checks" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11.5px]">
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void st.action("audit")} className="ctl border border-line px-2 py-1 hover:border-accent/60">Audit the model</button>
                <button type="button" onClick={() => void st.action("tieout")} className="ctl border border-line px-2 py-1 hover:border-accent/60">Tie out the deck</button>
                <button type="button" onClick={() => void st.action("lint")} className="ctl border border-line px-2 py-1 hover:border-accent/60">Brand check</button>
              </div>
              {st.lint && (
                <div className="mt-3">
                  <p className="font-semibold">Brand check: {st.lint.length === 0 ? "the deck is ready to send" : `${st.lint.length} item${st.lint.length === 1 ? "" : "s"}`}</p>
                  <ul className="mt-1 space-y-1">
                    {st.lint.map((i) => (
                      <li key={i.key} className="flex items-start gap-1.5">
                        <button type="button" onClick={() => { setTab("deck"); setSlide(i.slide); }} className="min-w-0 flex-1 text-left hover:text-fg">
                          <span className={`mr-1.5 ctl px-1 text-[9.5px] uppercase ${i.severity === "error" ? "bg-neg/15 text-neg" : i.severity === "warning" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{i.severity}</span>
                          <span className="text-muted">{i.slideTitle}:</span> {i.message}
                        </button>
                        {i.fix && <button type="button" onClick={() => void st.action("lint_fix", { keys: [i.key] })} className="shrink-0 text-[10.5px] text-accent underline">{i.fixLabel ?? "Fix"}</button>}
                      </li>
                    ))}
                  </ul>
                  {fixable > 1 && <button type="button" onClick={() => void st.action("lint_fix")} className="mt-2 ctl bg-accent px-2 py-1 font-semibold text-bg">Fix all {fixable}</button>}
                </div>
              )}
              {st.issues && (
                <div className="mt-3">
                  <p className="font-semibold">Model audit: {st.issues.filter((i) => i.severity === "error").length} errors, {st.issues.filter((i) => i.severity === "warning").length} warnings</p>
                  {st.issues.length === 0 && <p className="mt-1 text-pos">No issues found.</p>}
                  <ul className="mt-1 space-y-1">
                    {st.issues.slice(0, 80).map((i, k) => (
                      <li key={k}><button type="button" onClick={() => go(i.sheet, i.cell)} className="w-full text-left hover:text-fg">
                        <span className={`mr-1.5 ctl px-1 text-[9.5px] uppercase ${i.severity === "error" ? "bg-neg/15 text-neg" : i.severity === "warning" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{i.severity}</span>
                        <span className="num">{i.sheet}!{i.cell}</span> <span className="text-muted">{i.message}</span>
                      </button></li>
                    ))}
                  </ul>
                  {st.issues.some((i) => i.severity !== "info") && <button type="button" onClick={() => runPrompt("Fix the errors and warnings the audit found. Leave intentional items alone and say why.")} className="mt-2 ctl bg-accent px-2 py-1 font-semibold text-bg">Ask the agent to fix these</button>}
                </div>
              )}
              {st.ties && (
                <div className="mt-4">
                  <p className="font-semibold">Deck tie-out: {st.ties.length === 0 ? "every figure ties to the model" : `${st.ties.length} item${st.ties.length === 1 ? "" : "s"}`}</p>
                  <ul className="mt-1 space-y-1">
                    {st.ties.map((t, k) => (
                      <li key={k}><button type="button" onClick={() => { setTab("deck"); setSlide(t.slide); }} className="w-full text-left hover:text-fg">
                        <span className={`mr-1.5 ctl px-1 text-[9.5px] uppercase ${t.severity === "error" ? "bg-neg/15 text-neg" : "bg-accent-soft text-accent"}`}>{t.severity}</span>
                        <span className="text-muted">{t.slideTitle}:</span> {t.message}
                      </button></li>
                    ))}
                  </ul>
                </div>
              )}
              {openComments.length > 0 && (
                <div className="mt-4">
                  <p className="font-semibold">Open comments</p>
                  <ul className="mt-1 space-y-1">{openComments.map((c) => <li key={c.id} className="text-muted">{c.target.kind === "cell" ? `${doc.workbook.sheets[c.target.sheet]?.name}!${c.target.cell}` : `Slide ${doc.deck.order.indexOf(c.target.slide) + 1}`}: <span className="text-fg">{c.text}</span></li>)}</ul>
                  <button type="button" onClick={() => runPrompt("Turn all open comments: make each change in the model or deck, keep links intact, and resolve each comment saying what you did.")} className="mt-2 ctl bg-accent px-2 py-1 font-semibold text-bg">Turn the comments</button>
                </div>
              )}
            </div>
          )}

          {side === "history" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11.5px]">
              <p className="font-semibold">Checkpoints</p>
              <p className="text-[10.5px] text-muted">Save the model and deck as they are now (&ldquo;Sent to MD&rdquo;), then see exactly what moved since.</p>
              <div className="mt-1 flex gap-1">
                <input value={cpName} onChange={(e) => setCpName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && cpName.trim()) { void st.saveCheckpoint(cpName.trim()).then(() => setCpName("")).catch((x) => st.setError(String(x))); } }} placeholder="Name, e.g. Sent to MD" className="min-w-0 flex-1 ctl border border-line bg-bg px-2 py-1 outline-none focus:border-accent/60" />
                <button type="button" disabled={!cpName.trim()} onClick={() => void st.saveCheckpoint(cpName.trim()).then(() => setCpName("")).catch((x) => st.setError(String(x)))} className="ctl bg-accent px-2 py-1 font-semibold text-bg disabled:opacity-40">Save</button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {(st.checkpoints ?? []).map((c) => (
                  <li key={c.id} className="ctl border border-line bg-bg/40 p-2">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-[10.5px] text-muted">{c.createdByName || "Someone"} · {ago(c.createdAt)}</p>
                    <div className="mt-1 flex gap-3 text-[10.5px]">
                      <button type="button" onClick={() => void compare(c.id)} className="text-muted underline hover:text-fg">{diffs[c.id] ? "Hide changes" : "What changed since"}</button>
                      <button type="button" onClick={() => { if (window.confirm(`Go back to "${c.name}"? The model and deck return to that point, as one change you can undo.`)) void st.restoreCheckpoint(c.id).then((ok) => st.setNotice(ok ? `Restored "${c.name}".` : "Nothing to restore: no changes since.")).catch((x) => st.setError(String(x))); }} className="text-muted underline hover:text-fg">Restore</button>
                    </div>
                    {diffs[c.id] && <DiffView d={diffs[c.id]} go={go} />}
                  </li>
                ))}
                {st.checkpoints && !st.checkpoints.length && <li className="text-muted">None yet.</li>}
              </ul>
              <p className="mt-4 font-semibold">Agent runs</p>
              <ul className="mt-1 space-y-2">
                {meta.runs.map((r) => (
                  <li key={r.id} className="ctl border border-line bg-bg/40 p-2">
                    <p className="font-medium">{r.instruction}</p>
                    <p className="mt-0.5 text-[10.5px] text-muted">{r.status} · {ago(r.startedAt)}{r.stats?.cells ? ` · ${r.stats.cells} cells` : ""}{r.stats?.slides ? ` · ${r.stats.slides} slides` : ""}</p>
                    {r.status === "done" && <button type="button" onClick={() => void st.undoRun(r.id)} className="mt-1 text-[10.5px] underline text-muted hover:text-fg">Undo this run</button>}
                  </li>
                ))}
                {!meta.runs.length && <li className="text-muted">No runs yet.</li>}
              </ul>
              <p className="mt-4 font-semibold">Every change</p>
              <ul className="mt-1 space-y-1">
                {meta.history.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-2">
                    <span><span className={h.actor === "agent" ? "text-accent" : "text-fg"}>{h.actor === "agent" ? "Agent" : h.actorName || "Someone"}</span> <span className="text-muted">{h.label}</span></span>
                    <button type="button" onClick={() => void st.undoEvent(h.id)} className="shrink-0 text-[10.5px] text-muted underline hover:text-fg">Undo</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RunLog({ log, running }: { log: LogItem[]; running: boolean }) {
  return (
    <ol className="mt-2 space-y-1 border-l border-line pl-2.5">
      {log.map((l, i) => {
        if (l.k === "tool") return <li key={i} className="flex items-center gap-1.5 text-[11.5px]">{l.done || !running ? <Icon name="Check" className="h-3 w-3 text-pos" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}<span>{TOOL[l.name] ?? l.name}</span></li>;
        if (l.k === "change") return <li key={i} className="num text-[10.5px] text-muted">↳ {l.label}</li>;
        if (l.k === "note") return <li key={i} className="text-[11px] italic text-muted">{l.text}</li>;
        return <li key={i} className="text-[11.5px] text-neg">{l.text}</li>;
      })}
      {running && <li className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Working…</li>}
    </ol>
  );
}

function DiffView({ d, go }: { d: SemDiff; go: (sheet: string, cell: string) => void }) {
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const sh = d.sheets, sl = d.slides;
  const empty = !d.outputs.length && !d.inputs.length && !d.formulas.length && !d.text && !sh.added.length && !sh.removed.length && !sh.renamed.length && !sl.added.length && !sl.removed.length && !sl.changed.length;
  return (
    <div className="mt-2 space-y-1.5 border-t border-line pt-1.5 text-[10.5px]">
      {empty && <p className="text-muted">No changes since this checkpoint.</p>}
      {d.outputs.length > 0 && (
        <div>
          <p className="font-semibold">Key outputs</p>
          <ul>{d.outputs.slice(0, 14).map((o, i) => (
            <li key={i} className="flex justify-between gap-2"><span className="truncate">{o.name}</span><span className="num shrink-0">{o.before} → <b>{o.after}</b>{o.change !== null && <span className={o.change >= 0 ? " text-pos" : " text-neg"}> {pct(o.change)}</span>}</span></li>
          ))}</ul>
        </div>
      )}
      {d.inputs.length > 0 && (
        <div>
          <p className="font-semibold">Inputs changed · {d.inputs.length}</p>
          <ul>{d.inputs.slice(0, 14).map((x, i) => (
            <li key={i}><button type="button" onClick={() => go(x.sheet, x.cell)} className="num hover:text-fg">{x.sheet}!{x.cell}</button> <span className="text-muted">{x.label}</span> {x.before} → {x.after}</li>
          ))}</ul>
        </div>
      )}
      {d.formulas.length > 0 && <p><span className="font-semibold">Formulas changed · {d.formulas.length}</span> <span className="text-muted">{d.formulas.slice(0, 6).map((x) => `${x.sheet}!${x.cell}`).join(", ")}{d.formulas.length > 6 ? "…" : ""}</span></p>}
      {d.text > 0 && <p className="text-muted">{d.text} label{d.text === 1 ? "" : "s"} edited</p>}
      {(sh.added.length > 0 || sh.removed.length > 0 || sh.renamed.length > 0) && <p><span className="font-semibold">Sheets</span> <span className="text-muted">{[...sh.added.map((x) => `+${x}`), ...sh.removed.map((x) => `−${x}`), ...sh.renamed.map((x) => `${x.from}→${x.to}`)].join(", ")}</span></p>}
      {(sl.added.length > 0 || sl.removed.length > 0 || sl.changed.length > 0) && <p><span className="font-semibold">Slides</span> <span className="text-muted">{[...sl.added.map((x) => `+${x}`), ...sl.removed.map((x) => `−${x}`), ...sl.changed.map((x) => `~${x}`)].join(", ")}</span></p>}
    </div>
  );
}

export { parseRange };
