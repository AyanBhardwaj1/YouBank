"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { resolveChart, resolveMarker, resolveTable, resolveValue } from "@/lib/studio/deck";
import type { Engine } from "@/lib/studio/engine";
import type { Patch } from "@/lib/studio/ops";
import { SLIDE_H, SLIDE_W, newId, type DeckTheme, type Slide, type SlideEl, type StudioComment, type StudioDocData } from "@/lib/studio/types";
import { Chart } from "./Charts";

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function Element({ el, engine, theme, pt }: { el: SlideEl; engine: Engine; theme: DeckTheme; pt: (n: number) => number }) {
  const font = `${theme.font || "Arial"}, Arial, sans-serif`;
  if (el.type === "text") {
    const lines = el.text.split("\n");
    return (
      <div style={{ fontFamily: font, fontSize: pt(el.size ?? 14), fontWeight: el.bold ? 700 : 400, color: el.color ?? "#1F1F1F", textAlign: el.align ?? "left", lineHeight: 1.3, overflow: "hidden", height: "100%" }}>
        {lines.map((l, i) => {
          const bullet = /^\s*[-•]\s+/.test(l);
          return <p key={i} style={{ margin: `0 0 ${pt(5)}px`, paddingLeft: bullet ? pt(14) : 0, position: "relative" }}>{bullet && <span style={{ position: "absolute", left: 0, color: theme.accent }}>•</span>}{l.replace(/^\s*[-•]\s+/, "") || " "}</p>;
        })}
      </div>
    );
  }
  if (el.type === "table") {
    const rows = el.link ? resolveTable(el.link, engine) : (el.rows ?? []).map((r) => r.map((t) => ({ text: t, value: t as never })));
    if (!rows) return <div className="grid h-full place-items-center text-[11px] text-neg" style={{ background: "#FEF2F2" }}>Link broken: the range no longer exists</div>;
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const first = Math.min(0.42, Math.max(0.24, 3 / (cols + 2)));
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontFamily: font, fontSize: pt(el.size ?? 10) }}>
        <colgroup><col style={{ width: `${first * 100}%` }} />{Array.from({ length: cols - 1 }, (_, i) => <col key={i} style={{ width: `${((1 - first) / Math.max(1, cols - 1)) * 100}%` }} />)}</colgroup>
        <tbody>
          {rows.map((r, i) => {
            const head = el.header !== false && i === 0;
            return (
              <tr key={i} style={{ background: head ? theme.primary : undefined }}>
                {Array.from({ length: cols }, (_, j) => {
                  const c = r[j] as { text: string; bold?: boolean; align?: string; fill?: string } | undefined;
                  return <td key={j} style={{ padding: `${pt(2)}px ${pt(4)}px`, borderBottom: "1px solid #E5E7EB", color: head ? "#fff" : "#1F1F1F", fontWeight: head || c?.bold ? 700 : 400, textAlign: j === 0 ? "left" : ((c?.align as "left" | "right" | "center") ?? "right"), background: !head && c?.fill ? c.fill : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c?.text ?? ""}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (el.type === "metric") {
    const v = el.link ? resolveValue(el.link, engine, el.nf) : null;
    return (
      <div style={{ height: "100%", background: "#F3F5F9", border: "1px solid #E1E6EF", borderRadius: pt(5), padding: `${pt(7)}px ${pt(11)}px`, fontFamily: font, display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
        <div style={{ fontSize: pt(10), color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{el.label}</div>
        <div style={{ fontSize: pt(24), fontWeight: 700, color: theme.primary, whiteSpace: "nowrap" }}>{v ? v.text : el.value ?? "–"}</div>
      </div>
    );
  }
  if (el.type === "chart") return <Chart kind={el.kind} data={resolveChart(el, engine)} title={el.title} nf={el.nf} marker={resolveMarker(el, engine)} primary={theme.primary} accent={theme.accent} w={el.w} h={el.h} />;
  return <div style={{ height: "100%", background: el.fill ?? "#F3F5F9", border: `1px solid ${el.line ?? el.fill ?? "#F3F5F9"}` }} />;
}

/** One slide at any size: every measurement is in points of a 13.33 × 7.5 inch page, scaled to the box. */
export function SlideView({ slide, index, theme, engine, width, selected, onSelectEl, onMoveEl, readOnly, flash }: {
  slide: Slide; index: number; theme: DeckTheme; engine: Engine; width: number; selected?: string | null;
  onSelectEl?: (id: string | null) => void; onMoveEl?: (id: string, box: { x: number; y: number; w: number; h: number }) => void; readOnly?: boolean; flash?: boolean;
}) {
  const height = (width * SLIDE_H) / SLIDE_W;
  const pt = (n: number) => (n * width) / (SLIDE_W * 72);
  const font = `${theme.font || "Arial"}, Arial, sans-serif`;
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "size"; sx: number; sy: number; box: { x: number; y: number; w: number; h: number } } | null>(null);
  const [live, setLive] = useState<{ id: string; box: { x: number; y: number; w: number; h: number } } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const inch = width / SLIDE_W;
    const mv = (e: MouseEvent) => {
      const dx = (e.clientX - drag.sx) / inch, dy = (e.clientY - drag.sy) / inch;
      const b = drag.mode === "move" ? { ...drag.box, x: Math.max(0, Math.min(SLIDE_W - drag.box.w, drag.box.x + dx)), y: Math.max(0, Math.min(SLIDE_H - drag.box.h, drag.box.y + dy)) } : { ...drag.box, w: Math.max(0.5, drag.box.w + dx), h: Math.max(0.3, drag.box.h + dy) };
      setLive({ id: drag.id, box: { x: Math.round(b.x * 20) / 20, y: Math.round(b.y * 20) / 20, w: Math.round(b.w * 20) / 20, h: Math.round(b.h * 20) / 20 } });
    };
    const up = () => { setLive((l) => { if (l) onMoveEl?.(l.id, l.box); return null; }); setDrag(null); };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up, { once: true });
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [drag, onMoveEl, width]);

  if (slide.layout === "title" || slide.layout === "section") {
    return (
      <div style={{ width, height, background: theme.primary, position: "relative", overflow: "hidden", fontFamily: font, boxShadow: flash ? `0 0 0 3px ${theme.accent}` : undefined }}>
        <div style={{ position: "absolute", left: pct(0.8, SLIDE_W), top: pct(2.3, SLIDE_H), width: pct(11.7, SLIDE_W), height: pct(1.2, SLIDE_H), display: "flex", alignItems: "flex-end", color: "#fff", fontWeight: 700, fontSize: pt(slide.layout === "title" ? 40 : 32), lineHeight: 1.1 }}>{slide.title}</div>
        <div style={{ position: "absolute", left: pct(0.8, SLIDE_W), top: pct(3.62, SLIDE_H), width: pct(1.3, SLIDE_W), height: Math.max(2, pt(4.3)), background: theme.accent }} />
        {slide.subtitle && <div style={{ position: "absolute", left: pct(0.8, SLIDE_W), top: pct(3.85, SLIDE_H), width: pct(11.7, SLIDE_W), color: "#D9DEE8", fontSize: pt(18) }}>{slide.subtitle}</div>}
        {theme.confidential && <div style={{ position: "absolute", left: pct(0.8, SLIDE_W), top: pct(6.75, SLIDE_H), color: "#AAB4C6", fontSize: pt(10) }}>Strictly private and confidential</div>}
      </div>
    );
  }
  return (
    <div style={{ width, height, background: "#fff", position: "relative", overflow: "hidden", fontFamily: font, boxShadow: flash ? `0 0 0 3px ${theme.accent}` : undefined }} onMouseDown={() => onSelectEl?.(null)}>
      <div style={{ position: "absolute", left: pct(0.5, SLIDE_W), top: pct(0.28, SLIDE_H), width: pct(12.33, SLIDE_W), height: pct(0.7, SLIDE_H), display: "flex", alignItems: "center", fontSize: pt(24), fontWeight: 700, color: theme.primary, whiteSpace: "nowrap", overflow: "hidden" }}>{slide.title}</div>
      <div style={{ position: "absolute", left: pct(0.5, SLIDE_W), top: pct(1.02, SLIDE_H), width: pct(12.33, SLIDE_W), height: Math.max(1, pt(1.5)), background: theme.accent }} />
      {slide.elements.map((el) => {
        const b = live?.id === el.id ? live.box : el;
        const sel = selected === el.id;
        return (
          <div key={el.id}
            onMouseDown={(e) => { if (readOnly || !onSelectEl) return; e.stopPropagation(); onSelectEl(el.id); setDrag({ id: el.id, mode: "move", sx: e.clientX, sy: e.clientY, box: { x: el.x, y: el.y, w: el.w, h: el.h } }); }}
            style={{ position: "absolute", left: pct(b.x, SLIDE_W), top: pct(b.y, SLIDE_H), width: pct(b.w, SLIDE_W), height: pct(b.h, SLIDE_H), outline: sel ? "2px solid #1A73E8" : undefined, cursor: onSelectEl && !readOnly ? "move" : undefined }}>
            <Element el={el} engine={engine} theme={theme} pt={pt} />
            {sel && !readOnly && <span onMouseDown={(e) => { e.stopPropagation(); setDrag({ id: el.id, mode: "size", sx: e.clientX, sy: e.clientY, box: { x: el.x, y: el.y, w: el.w, h: el.h } }); }} style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, background: "#1A73E8", cursor: "nwse-resize" }} />}
          </div>
        );
      })}
      {slide.sources && <div style={{ position: "absolute", left: pct(0.5, SLIDE_W), top: pct(6.88, SLIDE_H), width: pct(10.8, SLIDE_W), fontSize: pt(8), color: "#7F7F7F", lineHeight: 1.25 }}>{slide.sources}</div>}
      <div style={{ position: "absolute", right: pct(0.5, SLIDE_W), top: pct(6.95, SLIDE_H), fontSize: pt(9), color: "#7F7F7F" }}>{theme.confidential ? "Confidential   " : ""}{index + 1}</div>
    </div>
  );
}

export function DeckView({ doc, engine, current, setCurrent, onEdit, comments, readOnly, flashSlide }: {
  doc: StudioDocData; engine: Engine; current: string | null; setCurrent: (id: string) => void;
  onEdit: (patches: Patch[], label?: string) => void; comments: StudioComment[]; readOnly?: boolean; flashSlide: string | null;
}) {
  const deck = doc.deck;
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  const [selEl, setSelEl] = useState<string | null>(null);
  const id = current && deck.slides[current] ? current : deck.order[0] ?? null;
  const slide = id ? deck.slides[id] : null;
  const index = id ? deck.order.indexOf(id) : -1;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(el.clientWidth - 48, ((el.clientHeight - 90) * SLIDE_W) / SLIDE_H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const upsert = (s: Slide, label: string) => onEdit([{ op: "slide_upsert", slide: s }], label);
  const moveSlide = (dir: -1 | 1) => {
    if (!id) return;
    const order = [...deck.order];
    const i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onEdit([{ op: "deck_order", order }], "Reordered slides");
  };
  const addBlank = () => {
    const s: Slide = { id: newId("sl"), layout: "content", title: "New slide", elements: [{ id: newId("el"), type: "text", x: 0.5, y: 1.35, w: 12.33, h: 5.3, text: "- Point one\n- Point two", size: 16 }] };
    onEdit([{ op: "slide_upsert", slide: s, index: index + 1 }], "Added a slide");
    setCurrent(s.id);
  };
  const slideComments = comments.filter((c) => !c.resolved && c.target.kind === "slide" && id && c.target.slide === id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!slide || !selEl || readOnly) return;
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement).closest("input,textarea")) {
        e.preventDefault();
        upsert({ ...slide, elements: slide.elements.filter((x) => x.id !== selEl) }, "Removed an element");
        setSelEl(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, selEl, readOnly]);

  if (!deck.order.length) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <Icon name="Presentation" className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 text-[13px] font-semibold">No slides yet</p>
          <p className="mt-1 text-[12px] text-muted">Ask the agent to &ldquo;make a valuation deck&rdquo; or &ldquo;add a slide with the comps table&rdquo;. Tables, charts and figures stay linked to the model, so they update as it changes.</p>
          {!readOnly && <button type="button" onClick={addBlank} className="mt-4 ctl border border-line px-3 py-1.5 text-[12px] hover:border-accent/60">Add a blank slide</button>}
        </div>
      </div>
    );
  }
  const selected = slide?.elements.find((x) => x.id === selEl);
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[196px] shrink-0 overflow-y-auto border-r border-line bg-panel p-2">
        {deck.order.map((sid, i) => (
          <button key={sid} type="button" onClick={() => { setCurrent(sid); setSelEl(null); }} className={`mb-2 flex w-full items-start gap-1.5 text-left ${sid === id ? "" : "opacity-80 hover:opacity-100"}`}>
            <span className="num w-4 shrink-0 pt-0.5 text-[10px] text-muted">{i + 1}</span>
            <span className={`block overflow-hidden rounded-sm ${sid === id ? "ring-2 ring-accent" : "ring-1 ring-line"}`}>
              <SlideView slide={deck.slides[sid]} index={i} theme={deck.theme} engine={engine} width={160} flash={flashSlide === sid} />
            </span>
          </button>
        ))}
        {!readOnly && <button type="button" onClick={addBlank} className="mt-1 w-full ctl border border-dashed border-line py-1.5 text-[11px] text-muted hover:border-accent/60 hover:text-fg">+ Slide</button>}
      </div>
      <div ref={box} className="flex min-w-0 flex-1 flex-col items-center overflow-auto bg-bg/40 p-6">
        {slide && (
          <>
            <div className="mb-2 flex w-full max-w-[1200px] flex-wrap items-center gap-2 text-[11.5px]">
              {readOnly ? <span className="font-semibold">{slide.title}</span> : (
                <input value={slide.title} onChange={(e) => upsert({ ...slide, title: e.target.value }, "Retitled a slide")} className="min-w-[220px] flex-1 ctl border border-line bg-bg px-2 py-1 text-[12px] font-semibold outline-none focus:border-accent/60" />
              )}
              {!readOnly && <>
                <button type="button" title="Move up" onClick={() => moveSlide(-1)} className="ctl border border-line px-1.5 py-1 hover:border-accent/60">↑</button>
                <button type="button" title="Move down" onClick={() => moveSlide(1)} className="ctl border border-line px-1.5 py-1 hover:border-accent/60">↓</button>
                <button type="button" onClick={() => { const t = window.prompt("Comment on this slide (the agent can turn it):"); if (t && id) onEdit([{ op: "comments", comments: [...comments, { id: newId("cm"), target: { kind: "slide", slide: id }, text: t, author: "you", at: new Date().toISOString() }] }], "Commented on a slide"); }} className="ctl border border-line px-2 py-1 hover:border-accent/60">Comment</button>
                <button type="button" onClick={() => { if (id && window.confirm("Delete this slide?")) { onEdit([{ op: "slide_delete", id }], "Deleted a slide"); } }} className="ctl border border-line px-2 py-1 text-muted hover:border-neg/60 hover:text-neg">Delete</button>
              </>}
            </div>
            <div className="shadow-lg"><SlideView slide={slide} index={index} theme={deck.theme} engine={engine} width={Math.max(320, w)} selected={selEl} onSelectEl={setSelEl} readOnly={readOnly} flash={flashSlide === id}
              onMoveEl={(eid, b) => upsert({ ...slide, elements: slide.elements.map((x) => (x.id === eid ? { ...x, ...b } : x)) }, "Moved an element")} /></div>
            {selected?.type === "text" && !readOnly && (
              <textarea value={selected.text} onChange={(e) => upsert({ ...slide, elements: slide.elements.map((x) => (x.id === selected.id ? { ...x, text: e.target.value } as SlideEl : x)) }, "Edited slide text")} rows={4} className="mt-3 w-full max-w-[1200px] ctl border border-line bg-bg p-2 text-[12px] outline-none focus:border-accent/60" />
            )}
            {selected && selected.type !== "text" && "link" in selected && selected.link && (
              <p className="mt-2 text-[11px] text-muted">Linked to <span className="num text-fg">{doc.workbook.sheets[selected.link.sheet]?.name}!{selected.link.range}</span>: it updates when the model changes. Delete removes it.</p>
            )}
            {slideComments.length > 0 && (
              <ul className="mt-3 w-full max-w-[1200px] space-y-1">
                {slideComments.map((c) => <li key={c.id} className="ctl border border-accent/40 bg-accent-soft px-2 py-1 text-[11.5px]"><span className="text-muted">Comment: </span>{c.text}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
