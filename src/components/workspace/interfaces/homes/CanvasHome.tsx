"use client";

/**
 * Canvas's Home: a board you move around, as in a design tool. The greeting is the board's title, the
 * question box a sticky note, and each widget a frame on the board with its name above it and selection
 * handles when the pointer or the keyboard is on it. Drag the empty board (or scroll) to pan, ⌘/Ctrl and
 * scroll (or + and −) to zoom, 0 to fit; Tab into a frame off screen and the board brings it into view.
 * A minimap in the corner shows the frames and where you are, and a click there takes you to that spot.
 * Panning and zooming change one transform, never the layout. While arranging, and on a phone, the board
 * simply flows down the page.
 */
import { animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

const BOARD_W = 1360;
const MIN = 0.35, MAX = 1.6;
type Rect = { id: string; x: number; y: number; w: number; h: number };

export default function CanvasHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  const reduce = useReducedMotion();
  const view = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const x = useMotionValue(16), y = useMotionValue(8), s = useMotionValue(1);
  const [pct, setPct] = useState(100);
  const [rects, setRects] = useState<{ nodes: Rect[]; w: number; h: number }>({ nodes: [], w: BOARD_W, h: 900 });
  const [vp, setVp] = useState({ x: 16, y: 8, s: 1, w: 1200, h: 800 });
  const [panning, setPanning] = useState(false);
  // The dots of the board move and scale with it, so panning feels like moving the surface itself.
  const dot = useTransform(s, (v) => 22 * v);
  const dots = useMotionTemplate`${x}px ${y}px`;
  const dotSize = useMotionTemplate`${dot}px ${dot}px`;

  const sync = useCallback(() => {
    const v = view.current;
    if (v) setVp({ x: x.get(), y: y.get(), s: s.get(), w: v.clientWidth, h: v.clientHeight });
  }, [x, y, s]);
  useMotionValueEvent(s, "change", (v) => { setPct(Math.round(v * 100)); sync(); });
  useMotionValueEvent(x, "change", sync);
  useMotionValueEvent(y, "change", sync);

  const go = useCallback((nx: number, ny: number, ns = s.get(), smooth = true) => {
    const opts = reduce || !smooth ? { duration: 0 } : { type: "spring" as const, stiffness: 260, damping: 32 };
    void animate(x, nx, opts); void animate(y, ny, opts); void animate(s, ns, opts);
  }, [x, y, s, reduce]);

  /** Zoom by `f` around a point in the view (its centre by default). */
  const zoom = useCallback((f: number, cx?: number, cy?: number, smooth = true) => {
    const v = view.current;
    if (!v) return;
    const px = cx ?? v.clientWidth / 2, py = cy ?? v.clientHeight / 2;
    const cur = s.get(), next = Math.min(MAX, Math.max(MIN, cur * f));
    const k = next / cur;
    go(px - (px - x.get()) * k, py - (py - y.get()) * k, next, smooth);
  }, [s, x, y, go]);

  const fit = useCallback(() => {
    const v = view.current, b = board.current;
    if (!v || !b) return;
    const k = Math.min(1, (v.clientWidth - 48) / b.offsetWidth, (v.clientHeight - 48) / b.offsetHeight);
    const ns = Math.max(MIN, k);
    go((v.clientWidth - b.offsetWidth * ns) / 2, 24, ns);
  }, [go]);

  // The frames' places on the board, for the minimap (measured after layout, never during render).
  useEffect(() => {
    const b = board.current;
    if (!b || arranging) return;
    const measure = () => {
      const nodes = [...b.querySelectorAll<HTMLElement>("[data-node]")].map((n) => ({ id: n.dataset.node!, x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight }));
      setRects({ nodes, w: b.offsetWidth, h: b.offsetHeight });
      sync();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    window.addEventListener("resize", sync);
    return () => { ro.disconnect(); window.removeEventListener("resize", sync); };
  }, [arranging, widgets.length, sync]);

  // Wheel: scroll pans, ⌘/Ctrl + scroll (and a pinch) zooms around the pointer. Not passive, so the page does not scroll too.
  useEffect(() => {
    const v = view.current;
    if (!v || arranging || !window.matchMedia("(min-width: 768px)").matches) return;
    const onWheel = (e: WheelEvent) => {
      // A scrollable list inside a frame keeps its own scroll.
      const inner = (e.target as HTMLElement).closest(".overflow-auto, .table-scroll, textarea");
      if (inner && inner !== v && !e.ctrlKey && !e.metaKey && inner.scrollHeight > inner.clientHeight) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top, false);
      else { x.set(x.get() - e.deltaX); y.set(y.get() - e.deltaY); }
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [arranging, zoom, x, y]);

  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !window.matchMedia("(min-width: 768px)").matches || (e.target as HTMLElement).closest("[data-node], .cv-sticky, a, button, input, textarea, select, .cv-hud, .cv-mini")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: x.get(), y: y.get() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) { x.set(d.x + e.clientX - d.px); y.set(d.y + e.clientY - d.py); }
  };
  const endDrag = () => { drag.current = null; setPanning(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = 90;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => go(x.get() + step, y.get()), ArrowRight: () => go(x.get() - step, y.get()),
      ArrowUp: () => go(x.get(), y.get() + step), ArrowDown: () => go(x.get(), y.get() - step),
      "+": () => zoom(1.2), "=": () => zoom(1.2), "-": () => zoom(1 / 1.2), "0": fit,
    };
    const m = moves[e.key];
    if (m) { e.preventDefault(); m(); }
  };

  // Tab into a frame that is off screen: bring it into view.
  const onFocus = (e: React.FocusEvent) => {
    const v = view.current, t = e.target as HTMLElement;
    if (!v || t === v) return;
    const node = t.closest<HTMLElement>("[data-node]") ?? t;
    const vr = v.getBoundingClientRect(), r = node.getBoundingClientRect();
    if (r.left >= vr.left && r.right <= vr.right && r.top >= vr.top && r.bottom <= vr.bottom) return;
    const tr = t.getBoundingClientRect();
    go(x.get() + (vr.left + vr.width / 2) - (tr.left + tr.width / 2), y.get() + (vr.top + vr.height / 3) - (tr.top + tr.height / 2));
  };

  const mini = 172 / rects.w;
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <div className="flex items-center gap-2 text-[12px] font-medium text-muted"><span className="inline-block h-2 w-2 rotate-45 border-[1.5px] border-current" aria-hidden />Home · {today}</div>
        <h1 className="mt-1 text-[44px] leading-none">{hello}{name}.</h1>
        <DayLine className="mt-2 text-[14px]" />
        <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-2 -ml-2" />
      </div>
      <div className="cv-sticky w-[340px] max-w-full p-4">
        <div className="mb-2 text-[12px] font-semibold text-[#5c4a00]">Ask anything</div>
        <AskBox className="flex items-center gap-2 border-b border-[#bfa646] pb-1" icon={false} placeholder="A company, a deal, a number…"
          inputClass="min-w-0 flex-1 bg-transparent text-[14px] text-[#2b2300] outline-none placeholder:text-[#7a6a2a]" button="rounded-md bg-[#2b2300] px-2.5 py-1 text-[12px] font-semibold text-[#fff4b8] disabled:opacity-40" />
      </div>
    </div>
  );
  const nodes = widgets.map((w) => (
    <section key={w.id} data-node={w.id} aria-label={WIDGET_LABEL[w.id]} className="cv-node yb-narrow mb-12 break-inside-avoid">
      <div className="cv-label">{WIDGET_LABEL[w.id]}</div>
      <div className="cv-frame"><i className="cv-handle" /><i className="cv-handle" /><i className="cv-handle" /><i className="cv-handle" /><WidgetIn w={w} facts={facts} brief={brief} roomy /></div>
    </section>
  ));

  if (arranging) {
    return (
      <div className="home-wall h-full overflow-auto">
        <div className="mx-auto max-w-[1280px] px-8 py-8">{header}<ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-8" /><div className="mt-6 grid gap-6 lg:grid-cols-2">{widgets.map((w) => <WidgetIn key={w.id} w={w} facts={facts} brief={brief} roomy />)}</div></div>
      </div>
    );
  }

  return (
    <motion.div ref={view} className={`cv-view home-wall ${panning ? "cv-panning" : ""}`} tabIndex={0} role="region" style={{ backgroundPosition: dots, backgroundSize: dotSize }}
      aria-label="Your board. Drag or use the arrow keys to move around, plus and minus to zoom, 0 to fit."
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown} onFocus={onFocus}>
      <motion.div ref={board} className="cv-board" style={{ x, y, scale: s, width: BOARD_W }}>
        <div className="px-10 pb-16 pt-10">
          {header}
          <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-8" />
          <div className="mt-12 [column-gap:56px] [columns:3_380px]">{nodes}</div>
        </div>
      </motion.div>
      <div className="cv-hud bottom-4 left-4" role="toolbar" aria-label="Zoom">
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Icon name="ChevronDown" className="h-4 w-4" /></button>
        <span className="num min-w-[44px] text-center text-[12px] text-muted" aria-live="polite">{pct}%</span>
        <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in"><Icon name="ChevronUp" className="h-4 w-4" /></button>
        <button type="button" onClick={fit} className="text-[12px] font-medium">Fit</button>
        <button type="button" onClick={() => go(16, 8, 1)} className="text-[12px] font-medium">100%</button>
      </div>
      <div className="cv-mini" aria-hidden>
        <svg viewBox={`0 0 ${rects.w * mini} ${rects.h * mini}`} onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const bx = ((e.clientX - r.left) / r.width) * rects.w, by = ((e.clientY - r.top) / r.height) * rects.h;
          go(vp.w / 2 - bx * vp.s, vp.h / 2 - by * vp.s);
        }}>
          <rect x={0} y={0} width={rects.w * mini} height={rects.h * mini} fill="#f3f3f1" rx={3} />
          {rects.nodes.map((n) => <rect key={n.id} x={n.x * mini} y={n.y * mini} width={n.w * mini} height={n.h * mini} rx={1.5} fill="#ffffff" stroke="#c6c6bf" strokeWidth={0.6} />)}
          <rect x={(-vp.x / vp.s) * mini} y={(-vp.y / vp.s) * mini} width={(vp.w / vp.s) * mini} height={(vp.h / vp.s) * mini} fill="rgba(79,70,229,.08)" stroke="#4f46e5" strokeWidth={1.2} rx={2} />
        </svg>
      </div>
    </motion.div>
  );
}
