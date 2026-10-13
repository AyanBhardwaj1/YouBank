"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, X } from "lucide-react";
import { addr as A1, colName, parseRange } from "@/lib/studio/address";
import type { Engine } from "@/lib/studio/engine";
import { translateFormula } from "@/lib/studio/formula";
import { cellFromInput, type Patch } from "@/lib/studio/ops";
import type { CellData, CellStyle, SheetData, StudioComment } from "@/lib/studio/types";
import { isErr } from "@/lib/studio/values";
import type { Flash } from "./useStudio";
import { useCoarsePointer } from "@/components/ui/useMedia";

/** A selection: the active cell (ar, ac) and the rectangle around it. */
export type Sel = { ar: number; ac: number; r1: number; c1: number; r2: number; c2: number };
export const selRange = (s: Sel) => (s.r1 === s.r2 && s.c1 === s.c2 ? A1(s.r1, s.c1) : `${A1(s.r1, s.c1)}:${A1(s.r2, s.c2)}`);
export const cellSel = (r: number, c: number): Sel => ({ ar: r, ac: c, r1: r, c1: c, r2: r, c2: c });

const ROW_H = 22, HEAD_H = 22, RH_W = 46, DEF_W = 88;
const P = { bg: "#FFFFFF", grid: "#E3E6EA", head: "#F3F4F6", headSel: "#E3EAF7", headText: "#5F6670", sel: "#1A73E8", text: "#1F1F1F", agent: "#E8930C" };
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

type Props = {
  engine: Engine; sheet: SheetData; flash: Flash;
  focus: { sheet: string; range: string; at: number } | null; follow: boolean;
  sel: Sel; setSel: (s: Sel) => void;
  onEdit: (patches: Patch[], label?: string) => void; onUndo: () => void;
  comments: StudioComment[]; showTypes: boolean; readOnly?: boolean;
  onStyle: (s: CellStyle) => void;
  /** The animation clock (performance.now() at the last tick) and whether the agent is working. */
  now: number; agentActive: boolean;
};

const borderCss = (b?: CellStyle["bb"]) => (b === "double" ? "3px double #1F1F1F" : b === "medium" ? "2px solid #1F1F1F" : b === "thin" ? "1px solid #1F1F1F" : undefined);

export function Grid(props: Props) {
  const { engine, sheet, flash, focus, follow, sel, setSel, onEdit, onUndo, comments, showTypes, readOnly, onStyle, now, agentActive } = props;
  const box = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 900, h: 600 });
  // "touch" is the phone editor: a bar docked above the on-screen keyboard (TouchEditBar) in place of the
  // in-cell box, which a keyboard would cover and a finger could not place a cursor in.
  const [editing, setEditing] = useState<{ text: string; from: "cell" | "bar" | "touch" } | null>(null);
  const coarse = useCoarsePointer();
  const [resize, setResize] = useState<{ c: number; x: number; w: number } | null>(null);
  const dragging = useRef(false);
  const clip = useRef<{ text: string; sheet: string; r: number; c: number; cells: (CellData | undefined)[][] } | null>(null);

  const used = engine.usedRange(sheet.id);
  const nRows = Math.max(used.rows + 40, 80), nCols = Math.min(200, Math.max(used.cols + 6, 20));
  const width = useCallback((c: number) => sheet.cols?.[colName(c)] ?? DEF_W, [sheet.cols]);
  const xs = useMemo(() => { const a = [0]; for (let c = 1; c <= nCols + 1; c++) a.push(a[c - 1] + width(c)); return a; }, [nCols, width]);
  const colX = (c: number) => xs[c - 1];
  const totalW = xs[nCols], totalH = nRows * ROW_H;
  const fr = sheet.freeze?.rows ?? 0, fc = sheet.freeze?.cols ?? 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el);
    setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
    return () => ro.disconnect();
  }, []);

  // Follow the agent: bring what it is writing into view.
  useEffect(() => {
    if (!follow || !focus || focus.sheet !== sheet.id || !box.current) return;
    const r = parseRange(focus.range);
    if (!r) return;
    const el = box.current;
    const y = (r.r1 - 1) * ROW_H, x = colX(r.c1);
    const outY = y < el.scrollTop + fr * ROW_H || y + ROW_H > el.scrollTop + el.clientHeight - HEAD_H;
    const outX = x < el.scrollLeft + (fc ? colX(fc + 1) : 0) || x + width(r.c1) > el.scrollLeft + el.clientWidth - RH_W;
    if (outY || outX) el.scrollTo({ top: outY ? Math.max(0, y - 3 * ROW_H) : el.scrollTop, left: outX ? Math.max(0, x - 2 * DEF_W) : el.scrollLeft, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.at, follow, sheet.id]);

  const r0 = Math.max(1, Math.floor(view.top / ROW_H) + 1), rN = Math.min(nRows, Math.ceil((view.top + view.h) / ROW_H) + 1);
  let c0 = 1;
  while (c0 < nCols && xs[c0] < view.left) c0++;
  let cN = c0;
  while (cN < nCols && xs[cN - 1] < view.left + view.w) cN++;

  const merges = useMemo(() => {
    const top = new Map<string, { w: number; h: number }>(), hidden = new Set<string>();
    for (const m of sheet.merges ?? []) {
      const r = parseRange(m);
      if (!r) continue;
      let w = 0;
      for (let c = r.c1; c <= r.c2; c++) w += width(c);
      top.set(A1(r.r1, r.c1), { w, h: (r.r2 - r.r1 + 1) * ROW_H });
      for (let rr = r.r1; rr <= r.r2; rr++) for (let cc = r.c1; cc <= r.c2; cc++) if (rr !== r.r1 || cc !== r.c1) hidden.add(A1(rr, cc));
    }
    return { top, hidden };
  }, [sheet.merges, width]);

  const commented = useMemo(() => new Set(comments.filter((c) => !c.resolved && c.target.kind === "cell" && c.target.sheet === sheet.id).map((c) => (c.target as { cell: string }).cell)), [comments, sheet.id]);

  /* ---------------- Positions (frozen panes stay put while the rest scrolls) ---------------- */
  const px = (c: number) => RH_W + colX(c) + (c <= fc ? view.left : 0);
  const py = (r: number) => HEAD_H + (r - 1) * ROW_H + (r <= fr ? view.top : 0);
  const zOf = (r: number, c: number) => (r <= fr && c <= fc ? 4 : r <= fr || c <= fc ? 3 : 1);

  /* ---------------- Editing ---------------- */
  const active = A1(sel.ar, sel.ac);
  const activeCell = sheet.cells[active];
  const rawText = (cell?: CellData) => (cell?.f !== undefined ? `=${cell.f}` : cell?.v === undefined || cell.v === null ? "" : String(cell.v));

  const commit = useCallback((text: string) => {
    setEditing(null);
    if (readOnly) return;
    const prev = sheet.cells[active];
    if (rawText(prev) === text) return;
    onEdit([{ op: "cells", sheet: sheet.id, cells: { [active]: cellFromInput(text, prev) } }], `Edited ${sheet.name}!${active}`);
  }, [active, onEdit, readOnly, sheet]);

  const move = (dr: number, dc: number, extend = false) => {
    const r = Math.min(nRows, Math.max(1, (extend ? (dr ? (sel.ar === sel.r1 ? sel.r2 : sel.r1) : sel.ar) : sel.ar) + dr));
    const c = Math.min(nCols, Math.max(1, (extend ? (dc ? (sel.ac === sel.c1 ? sel.c2 : sel.c1) : sel.ac) : sel.ac) + dc));
    if (extend) setSel({ ...sel, r1: Math.min(sel.ar, r), r2: Math.max(sel.ar, r), c1: Math.min(sel.ac, c), c2: Math.max(sel.ac, c) });
    else setSel(cellSel(r, c));
    reveal(r, c);
    return { r, c };
  };

  /** Scroll so a cell is in view, above the keyboard and the touch editor when they cover the grid. */
  const reveal = (r: number, c: number) => {
    const el = box.current;
    if (!el) return;
    const y = (r - 1) * ROW_H, x = colX(c);
    const h = el.clientHeight - hiddenBelow(el);
    if (y < el.scrollTop + fr * ROW_H) el.scrollTop = y - fr * ROW_H;
    if (y + ROW_H > el.scrollTop + h - HEAD_H - 4) el.scrollTop = y + ROW_H - h + HEAD_H + 4;
    if (x < el.scrollLeft && c > fc) el.scrollLeft = x;
    if (x + width(c) > el.scrollLeft + el.clientWidth - RH_W) el.scrollLeft = x + width(c) - el.clientWidth + RH_W + 4;
  };

  const clearSel = () => {
    if (readOnly) return;
    const cells: Record<string, CellData | null> = {};
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
      const a = A1(r, c), prev = sheet.cells[a];
      if (prev && (prev.v !== undefined || prev.f !== undefined)) cells[a] = prev.s ? { s: prev.s } : null;
    }
    if (Object.keys(cells).length) onEdit([{ op: "cells", sheet: sheet.id, cells }], `Cleared ${sheet.name}!${selRange(sel)}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); onUndo(); return; }
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); onStyle({ b: !activeCell?.s?.b }); return; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); onStyle({ i: !activeCell?.s?.i }); return; }
    if (mod) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(-1, 0, e.shiftKey); return;
      case "ArrowDown": e.preventDefault(); move(1, 0, e.shiftKey); return;
      case "ArrowLeft": e.preventDefault(); move(0, -1, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); move(0, 1, e.shiftKey); return;
      case "Tab": e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return;
      case "Enter": case "F2": e.preventDefault(); if (!readOnly) setEditing({ text: rawText(activeCell), from: "cell" }); return;
      case "Backspace": case "Delete": e.preventDefault(); clearSel(); return;
    }
    if (e.key.length === 1 && !readOnly) { e.preventDefault(); setEditing({ text: e.key, from: "cell" }); }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const rows: string[] = [], cells: (CellData | undefined)[][] = [];
    for (let r = sel.r1; r <= sel.r2; r++) {
      const line: string[] = [], row: (CellData | undefined)[] = [];
      for (let c = sel.c1; c <= sel.c2; c++) { const cell = sheet.cells[A1(r, c)]; row.push(cell); line.push(cell?.f !== undefined ? `=${cell.f}` : engine.display(sheet.id, A1(r, c)).text.trim()); }
      rows.push(line.join("\t")); cells.push(row);
    }
    const text = rows.join("\n");
    e.clipboardData.setData("text/plain", text);
    clip.current = { text, sheet: sheet.id, r: sel.r1, c: sel.c1, cells };
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || readOnly) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const out: Record<string, CellData | null> = {};
    const c0p = clip.current;
    if (c0p && c0p.text === text) {
      // From this grid: formulas move with the paste, formats come along.
      c0p.cells.forEach((row, i) => row.forEach((cell, j) => {
        const a = A1(sel.ar + i, sel.ac + j);
        out[a] = !cell ? null : cell.f !== undefined ? { ...cell, f: translateFormula(cell.f, sel.ar - c0p.r, sel.ac - c0p.c) } : { ...cell };
      }));
    } else {
      text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, i) => line.split("\t").forEach((v, j) => {
        const a = A1(sel.ar + i, sel.ac + j);
        out[a] = cellFromInput(v, sheet.cells[a]);
      }));
    }
    onEdit([{ op: "cells", sheet: sheet.id, cells: out }], `Pasted into ${sheet.name}!${A1(sel.ar, sel.ac)}`);
  };

  /* ---------------- Column resize ---------------- */
  useEffect(() => {
    if (!resize) return;
    const moveH = (e: MouseEvent) => setResize((r) => (r ? { ...r, w: Math.max(24, Math.min(640, r.w + e.movementX)) } : r));
    const up = () => {
      setResize((r) => { if (r && !readOnly) onEdit([{ op: "sheet_meta", sheet: sheet.id, cols: { [colName(r.c)]: Math.round(r.w) } }], `Resized column ${colName(r.c)}`); return null; });
    };
    window.addEventListener("mousemove", moveH);
    window.addEventListener("mouseup", up, { once: true });
    return () => { window.removeEventListener("mousemove", moveH); window.removeEventListener("mouseup", up); };
  }, [resize, onEdit, readOnly, sheet.id]);

  /* ---------------- Mouse selection ---------------- */
  const cellAt = (clientX: number, clientY: number) => {
    const el = box.current!;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - RH_W + el.scrollLeft, y = clientY - rect.top - HEAD_H + el.scrollTop;
    let c = 1;
    while (c < nCols && xs[c] <= x) c++;
    return { r: Math.min(nRows, Math.max(1, Math.floor(y / ROW_H) + 1)), c };
  };
  /** Phones: open the editor docked above the keyboard, and keep the cell in view once the keyboard is up. */
  const startTouchEdit = () => {
    if (readOnly) return;
    setEditing({ text: rawText(activeCell), from: "touch" });
    window.setTimeout(() => reveal(sel.ar, sel.ac), 380);
  };
  /** Commit, step to the next cell, and keep editing there, so a column of inputs goes in without the keyboard closing. */
  const commitAndMove = (dr: number, dc: number) => {
    if (editing) commit(editing.text);
    const { r, c } = move(dr, dc);
    // At the sheet's edge the move stays on this cell, whose `sheet.cells` entry is still the value from
    // before the commit; reloading it would put the old text back in the box and save it on the way out.
    const same = r === sel.ar && c === sel.ac;
    setEditing({ text: same && editing ? editing.text : rawText(sheet.cells[A1(r, c)]), from: "touch" });
  };
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).dataset.nosel) return;
    const { r, c } = cellAt(e.clientX, e.clientY);
    // On a touch screen, tapping the cell that is already selected starts editing it (a double tap does too).
    const again = coarse && !editing && !e.shiftKey && r === sel.ar && c === sel.ac && sel.r1 === sel.r2 && sel.c1 === sel.c2;
    // The touch editor commits when it loses focus, which this tap causes; committing here as well would save twice.
    if (editing && editing.from !== "touch") commit(editing.text);
    if (e.shiftKey) setSel({ ...sel, r1: Math.min(sel.ar, r), r2: Math.max(sel.ar, r), c1: Math.min(sel.ac, c), c2: Math.max(sel.ac, c) });
    else setSel(cellSel(r, c));
    dragging.current = !coarse;
    box.current?.focus({ preventScroll: true });
    if (again) startTouchEdit();
  };
  /* The selection handle (touch): drag the dot at the selection's corner to cover a range. */
  const handleDrag = useRef(false);
  const onHandleDown = (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); handleDrag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!handleDrag.current) return;
    const { r, c } = cellAt(e.clientX, e.clientY);
    setSel({ ...sel, r1: Math.min(sel.ar, r), r2: Math.max(sel.ar, r), c1: Math.min(sel.ac, c), c2: Math.max(sel.ac, c) });
  };
  const onOver = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const { r, c } = cellAt(e.clientX, e.clientY);
    setSel({ ...sel, r1: Math.min(sel.ar, r), r2: Math.max(sel.ar, r), c1: Math.min(sel.ac, c), c2: Math.max(sel.ac, c) });
  };
  useEffect(() => { const up = () => { dragging.current = false; }; window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);

  /* ---------------- Cells ---------------- */
  const rows: number[] = [];
  for (let r = 1; r <= Math.min(fr, nRows); r++) rows.push(r);
  for (let r = Math.max(r0, fr + 1); r <= rN; r++) rows.push(r);
  const cols: number[] = [];
  for (let c = 1; c <= Math.min(fc, nCols); c++) cols.push(c);
  for (let c = Math.max(c0, fc + 1); c <= cN; c++) cols.push(c);

  const nodes: React.ReactNode[] = [];
  for (const r of rows) {
    for (const c of cols) {
      const a = A1(r, c);
      if (merges.hidden.has(a)) continue;
      const cell = sheet.cells[a];
      const fl = flash.get(`${sheet.id}!${a}`);
      const merged = merges.top.get(a);
      const typeTint = showTypes && cell ? (cell.f !== undefined ? (/!/.test(cell.f) ? "rgba(0,128,0,.16)" : /\d\.\d|\*\s*\d{2,}|[+\-*/]\s*\d{2,}/.test(cell.f) ? "rgba(232,147,12,.25)" : "rgba(0,0,0,.05)") : typeof cell.v === "number" ? "rgba(0,0,255,.12)" : undefined) : undefined;
      const base = { position: "absolute" as const, left: px(c), top: py(r), height: merged?.h ?? ROW_H, zIndex: zOf(r, c) };
      const frozenBg = r <= fr || c <= fc ? P.bg : undefined;
      if (!cell && !fl && !typeTint) { if (frozenBg) nodes.push(<div key={a} style={{ ...base, width: merged?.w ?? width(c), background: frozenBg, borderRight: `1px solid ${P.grid}`, borderBottom: `1px solid ${P.grid}` }} />); continue; }
      const s = cell?.s ?? {};
      const d: { text: string; color?: string; value: unknown } = cell ? engine.display(sheet.id, a) : { text: "", value: null };
      const value = d.value;
      const isNum = typeof value === "number";
      const hide = fl && fl.hidden && fl.at > now;
      let w = merged?.w ?? width(c);
      const align = s.al ?? (isNum ? "right" : typeof value === "boolean" || isErr(value) ? "center" : "left");
      if (!merged && typeof value === "string" && align === "left" && !s.wrap) {
        for (let k = c + 1; k <= Math.min(nCols, c + 8) && !sheet.cells[A1(r, k)] && !(k <= fc && c > fc); k++) w += width(k);
      }
      nodes.push(
        <div key={a} style={{
          ...base, width: w, padding: `0 4px 0 ${4 + (s.indent ?? 0) * 10}px`, overflow: "hidden", whiteSpace: s.wrap ? "normal" : "nowrap", textOverflow: "clip",
          lineHeight: `${ROW_H - 1}px`, fontFamily: FONT, fontSize: s.size ? Math.round(s.size * 1.08) : 12, fontWeight: s.b ? 700 : 400, fontStyle: s.i ? "italic" : "normal",
          textDecoration: s.u ? "underline" : undefined, textAlign: align, color: isErr(value) ? "#C00000" : d.color ?? s.color ?? P.text,
          background: typeTint ?? s.fill ?? frozenBg, borderTop: borderCss(s.bt), borderBottom: borderCss(s.bb) ?? (frozenBg ? `1px solid ${P.grid}` : undefined), borderRight: frozenBg ? `1px solid ${P.grid}` : undefined,
        }}>
          {fl && !hide && <span className="studio-glow" style={{ animationDelay: `${Math.round(fl.at - now)}ms` }} />}
          <span style={{ position: "relative" }}>{hide ? "" : d.text}</span>
          {cell?.src && <span title={`Source: ${cell.src}`} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, borderTop: "6px solid #3B82F6", borderRight: "6px solid transparent" }} />}
          {commented.has(a) && <span title={comments.find((x) => x.target.kind === "cell" && x.target.cell === a && x.target.sheet === sheet.id)?.text} style={{ position: "absolute", right: 0, top: 0, width: 0, height: 0, borderTop: "7px solid #E8930C", borderLeft: "7px solid transparent" }} />}
        </div>,
      );
    }
  }

  /* ---------------- Overlays ---------------- */
  const rectBox = (r1: number, c1: number, r2: number, c2: number) => {
    const x1 = px(c1), y1 = py(r1);
    const x2 = (c2 <= fc ? view.left : 0) + RH_W + xs[c2], y2 = (r2 <= fr ? view.top : 0) + HEAD_H + r2 * ROW_H;
    return { left: x1, top: y1, width: Math.max(2, x2 - x1), height: Math.max(2, y2 - y1) };
  };
  const agentRect = agentActive && focus && focus.sheet === sheet.id ? parseRange(focus.range) : null;
  const colSelected = (c: number) => c >= sel.c1 && c <= sel.c2, rowSelected = (r: number) => r >= sel.r1 && r <= sel.r2;
  const editBox = rectBox(sel.ar, sel.ac, sel.ar, sel.ac);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <span className="num w-[76px] shrink-0 ctl border border-line bg-bg px-2 py-0.5 text-center text-[11.5px]">{selRange(sel)}</span>
        <span className="text-[12px] italic text-muted">fx</span>
        <input
          className="num min-w-0 flex-1 ctl border border-line bg-bg px-2 py-0.5 text-[12px] outline-none focus:border-accent/60"
          value={editing ? editing.text : rawText(activeCell)} readOnly={readOnly || coarse} spellCheck={false}
          aria-label={`Contents of ${selRange(sel)}`}
          onClick={() => { if (coarse && !editing) startTouchEdit(); }}
          onFocus={() => { if (!editing && !readOnly && !coarse) setEditing({ text: rawText(activeCell), from: "bar" }); }}
          onChange={(e) => setEditing({ text: e.target.value, from: "bar" })}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(editing?.text ?? ""); box.current?.focus(); move(1, 0); }
            if (e.key === "Escape") { setEditing(null); box.current?.focus(); }
          }}
          onBlur={() => { if (editing?.from === "bar") commit(editing.text); }}
        />
      </div>
      <div
        ref={box} tabIndex={0} onKeyDown={onKey} onCopy={onCopy} onCut={(e) => { onCopy(e); clearSel(); }} onPaste={onPaste}
        onScroll={(e) => { const t = e.currentTarget; setView((v) => ({ ...v, top: t.scrollTop, left: t.scrollLeft })); }}
        onMouseDown={onDown} onMouseMove={onOver} onDoubleClick={() => { if (readOnly) return; if (coarse) { if (!editing) startTouchEdit(); } else setEditing({ text: rawText(activeCell), from: "cell" }); }}
        className="relative min-h-0 flex-1 overflow-auto outline-none" style={{ background: P.bg, cursor: "cell" }}
      >
        <div style={{
          position: "relative", width: RH_W + totalW, height: HEAD_H + totalH,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_H - 1}px, ${P.grid} ${ROW_H - 1}px, ${P.grid} ${ROW_H}px)`, backgroundPosition: `0 ${HEAD_H}px`,
        }}>
          {cols.map((c) => <div key={`v${c}`} style={{ position: "absolute", left: px(c) + width(c) - 1, top: HEAD_H + view.top, width: 1, height: view.h, background: P.grid, zIndex: c <= fc ? 3 : 0 }} />)}
          {nodes}
          <div style={{ position: "absolute", pointerEvents: "none", zIndex: 5, ...rectBox(sel.r1, sel.c1, sel.r2, sel.c2), border: `2px solid ${P.sel}`, background: sel.r1 === sel.r2 && sel.c1 === sel.c2 ? "transparent" : "rgba(26,115,232,.08)" }} />
          {coarse && !editing && !readOnly && (() => {
            const b = rectBox(sel.r1, sel.c1, sel.r2, sel.c2);
            return (
              <span data-nosel="1" role="presentation" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={() => { handleDrag.current = false; }} onPointerCancel={() => { handleDrag.current = false; }}
                style={{ position: "absolute", zIndex: 8, left: b.left + b.width - 16, top: b.top + b.height - 16, width: 32, height: 32, touchAction: "none", display: "grid", placeItems: "center" }}>
                <span data-nosel="1" style={{ width: 12, height: 12, borderRadius: 999, background: P.sel, border: "2px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
              </span>
            );
          })()}
          {agentRect && (
            <div className="studio-cursor" style={{ position: "absolute", pointerEvents: "none", zIndex: 6, ...rectBox(agentRect.r1, agentRect.c1, Math.min(agentRect.r2, nRows), Math.min(agentRect.c2, nCols)), border: `2px solid ${P.agent}`, boxShadow: `0 0 0 3px rgba(232,147,12,.18)` }}>
              <span style={{ position: "absolute", top: -17, left: -2, background: P.agent, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, fontFamily: FONT, whiteSpace: "nowrap" }}>Agent</span>
            </div>
          )}
          {editing?.from === "cell" && (
            <input
              autoFocus spellCheck={false} value={editing.text} data-nosel="1"
              onChange={(e) => setEditing({ text: e.target.value, from: "cell" })}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(editing.text); box.current?.focus(); move(1, 0); }
                else if (e.key === "Tab") { e.preventDefault(); commit(editing.text); box.current?.focus(); move(0, e.shiftKey ? -1 : 1); }
                else if (e.key === "Escape") { e.preventDefault(); setEditing(null); box.current?.focus(); }
              }}
              onBlur={() => commit(editing.text)}
              style={{ position: "absolute", zIndex: 8, left: editBox.left, top: editBox.top, height: ROW_H, minWidth: editBox.width, width: Math.min(520, Math.max(editBox.width, editing.text.length * 7.2 + 14)), fontFamily: FONT, fontSize: 12, padding: "0 4px", border: `2px solid ${P.sel}`, outline: "none", background: "#fff", color: P.text }}
            />
          )}
          {/* Column letters */}
          <div style={{ position: "absolute", left: 0, top: view.top, width: RH_W + totalW, height: HEAD_H, zIndex: 9, background: P.head, borderBottom: `1px solid ${P.grid}` }} />
          {cols.map((c) => (
            <div key={`h${c}`} data-nosel="1" onMouseDown={(e) => { e.stopPropagation(); setSel({ ar: 1, ac: c, r1: 1, c1: c, r2: nRows, c2: c }); }}
              style={{ position: "absolute", left: px(c), top: view.top, width: resize?.c === c ? resize.w : width(c), height: HEAD_H, zIndex: c <= fc ? 11 : 10, background: colSelected(c) ? P.headSel : P.head, borderRight: `1px solid ${P.grid}`, borderBottom: `1px solid ${P.grid}`, color: P.headText, font: `600 11px ${FONT}`, textAlign: "center", lineHeight: `${HEAD_H}px`, userSelect: "none" }}>
              {colName(c)}
              <span data-nosel="1" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResize({ c, x: e.clientX, w: width(c) }); }} style={{ position: "absolute", right: -3, top: 0, width: 6, height: HEAD_H, cursor: "col-resize", zIndex: 12 }} />
            </div>
          ))}
          {/* Row numbers */}
          {rows.map((r) => (
            <div key={`r${r}`} data-nosel="1" onMouseDown={(e) => { e.stopPropagation(); setSel({ ar: r, ac: 1, r1: r, c1: 1, r2: r, c2: nCols }); }}
              style={{ position: "absolute", left: view.left, top: py(r), width: RH_W, height: ROW_H, zIndex: r <= fr ? 11 : 10, background: rowSelected(r) ? P.headSel : P.head, borderRight: `1px solid ${P.grid}`, borderBottom: `1px solid ${P.grid}`, color: P.headText, font: `11px ${FONT}`, textAlign: "center", lineHeight: `${ROW_H}px`, userSelect: "none" }}>
              {r}
            </div>
          ))}
          <div style={{ position: "absolute", left: view.left, top: view.top, width: RH_W, height: HEAD_H, zIndex: 13, background: P.head, borderRight: `1px solid ${P.grid}`, borderBottom: `1px solid ${P.grid}` }} />
          {fr > 0 && <div style={{ position: "absolute", left: view.left, top: view.top + HEAD_H + fr * ROW_H - 1, width: view.w, height: 2, background: "#B8BEC6", zIndex: 7 }} />}
          {fc > 0 && <div style={{ position: "absolute", left: view.left + RH_W + colX(fc + 1) - 1, top: view.top, width: 2, height: view.h, background: "#B8BEC6", zIndex: 7 }} />}
        </div>
      </div>
      {editing?.from === "touch" && createPortal(
        <TouchEditBar address={`${sheet.name}!${active}`} text={editing.text} onChange={(text) => setEditing({ text, from: "touch" })}
          onMove={commitAndMove} onDone={() => { commit(editing.text); box.current?.focus({ preventScroll: true }); }} onCancel={() => { setEditing(null); box.current?.focus({ preventScroll: true }); }} />,
        document.body,
      )}
    </div>
  );
}

/** How much of the grid's lower edge the touch editor (and the keyboard under it) covers. */
function hiddenBelow(el: HTMLElement): number {
  const bar = document.querySelector<HTMLElement>("[data-touch-edit]");
  return bar ? Math.max(0, el.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) : 0;
}

/** Characters a phone keyboard hides behind a mode switch, but formulas are made of. */
const KEYS = ["=", "+", "-", "*", "/", "(", ")", ",", ":", "$", "%", "SUM(", "AVERAGE(", "IF("];

/**
 * The phone's cell editor, docked above the on-screen keyboard: the cell's address, its contents in a
 * full-width box, a row of formula keys, and arrows that save and step to the next cell without the
 * keyboard closing. Return saves and moves down, as in Excel; leaving the box saves; the cross discards.
 */
function TouchEditBar({ address, text, onChange, onMove, onDone, onCancel }: {
  address: string; text: string; onChange: (t: string) => void; onMove: (dr: number, dc: number) => void; onDone: () => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [address]);
  // Buttons act on pointer-down and keep the focus in the box, so the keyboard never drops between taps.
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const insert = (k: string) => {
    const el = input.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length, to = el.selectionEnd ?? at;
    el.setRangeText(k, at, to, "end");
    onChange(el.value);
  };
  const key = "grid h-9 min-w-9 shrink-0 place-items-center ctl border border-line bg-elevated px-2.5 font-mono text-[13px] text-fg active:bg-raised";
  return (
    <div data-touch-edit="" className="fixed inset-x-0 z-[75] border-t border-line-strong bg-panel px-safe shadow-[0_-8px_24px_rgba(0,0,0,.25)]" style={{ bottom: "var(--kb)" }}>
      <div className="flex items-center gap-2 px-2 pt-2">
        <span className="num max-w-[38%] shrink-0 truncate ctl bg-accent-soft px-2 py-1 text-[12px] font-semibold text-accent">{address}</span>
        <input ref={input} value={text} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" enterKeyHint="next"
          aria-label={`Edit ${address}`} className="num h-10 min-w-0 flex-1 ctl border border-accent/60 bg-bg px-2 text-fg outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onMove(1, 0); } else if (e.key === "Escape") { e.preventDefault(); cancelled.current = true; onCancel(); } }}
          onBlur={() => { if (!cancelled.current) onDone(); }} />
        <button type="button" aria-label="Discard the change" onPointerDown={keep} onMouseDown={keep} onClick={() => { cancelled.current = true; onCancel(); }} className="grid h-10 w-10 shrink-0 place-items-center ctl text-muted active:bg-elevated"><X className="h-5 w-5" /></button>
        <button type="button" aria-label="Save" onPointerDown={keep} onMouseDown={keep} onClick={() => { cancelled.current = true; onDone(); }} className="grid h-10 w-10 shrink-0 place-items-center ctl bg-accent text-accent-fg"><Check className="h-5 w-5" /></button>
      </div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-2 py-2 pb-[max(8px,var(--safe-b))]">
        {([[-1, 0, ArrowUp, "up"], [1, 0, ArrowDown, "down"], [0, -1, ArrowLeft, "left"], [0, 1, ArrowRight, "right"]] as const).map(([dr, dc, I, name]) => (
          <button key={name} type="button" aria-label={`Save and move ${name}`} onPointerDown={keep} onMouseDown={keep} onClick={() => onMove(dr, dc)} className={key}><I className="h-4 w-4" /></button>
        ))}
        <span className="mx-0.5 w-px shrink-0 bg-line" aria-hidden />
        {KEYS.map((k) => <button key={k} type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => insert(k)} className={key}>{k}</button>)}
      </div>
    </div>
  );
}
