"use client";

/**
 * The force network: companies, people, funds, subsidiaries and advisers pulled together by their
 * links and pushed apart by one another, drawn on a canvas. Wheel or pinch to zoom, drag the empty
 * space to pan, drag a node to pin it, hover to read it, click to select. A highlighted path (a reason
 * for a prediction) stays bright while everything else fades. With reduced motion the layout settles
 * before it is drawn.
 */
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, LINK_COLOR, LINK_LABEL, NODE_COLOR, type GEdge, type GNode } from "./client";

type P = { x: number; y: number; vx: number; vy: number; pinned: boolean };
const RADIUS: Record<string, number> = { company: 8, person: 4.5, fund: 5.5, subsidiary: 3.5, firm: 5 };
const LENGTH: Record<string, number> = { director: 55, officer: 55, insider: 55, holder: 85, subsidiary: 45, acquired: 120, bought_assets: 110, supplies: 100, advised: 80 };

/** A node's radius: by kind, larger for the company in focus, and scaled by influence when known. Pure. */
export function radiusOf(n: Pick<GNode, "kind" | "id" | "rank">, focus: number): number {
  return (RADIUS[n.kind] ?? 5) * (n.id === focus ? 1.5 : 1) * (n.rank !== undefined ? 0.75 + 0.9 * Math.sqrt(n.rank) : 1);
}

/** The drawn entities as the keyboard list reads them: the company in focus first, then by how many drawn links touch each, then by name. Pure. */
export function entityList(nodes: GNode[], links: Pick<GEdge, "s" | "d">[], focus: number): { n: GNode; c: number }[] {
  const count = new Map<number, number>();
  for (const l of links) { count.set(l.s, (count.get(l.s) ?? 0) + 1); count.set(l.d, (count.get(l.d) ?? 0) + 1); }
  return nodes.map((n) => ({ n, c: count.get(n.id) ?? 0 })).sort((a, b) => Number(b.n.id === focus) - Number(a.n.id === focus) || b.c - a.c || a.n.name.localeCompare(b.n.name));
}

function cssVar(name: string, fallback: string) {
  return typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function ForceGraph({ nodes, links, focus, highlight, onSelect, height = 520 }: {
  nodes: GNode[]; links: GEdge[]; focus: number; highlight?: { nodes: Set<number>; links: Set<number> } | null; onSelect?: (n: GNode) => void; height?: number;
}) {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pos = useRef(new Map<number, P>());
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const alpha = useRef(1);
  const drag = useRef<{ node: number | null; x: number; y: number; moved: boolean } | null>(null);
  const hl = useRef(highlight);
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);
  const redraw = useRef<() => void>(() => undefined);

  useEffect(() => { hl.current = highlight; redraw.current(); }, [highlight]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Keep positions of nodes already placed; new nodes start near a neighbour (or on a ring by kind).
    const P = pos.current;
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const neighbour = new Map<number, number>();
    for (const l of links) { if (!neighbour.has(l.s)) neighbour.set(l.s, l.d); if (!neighbour.has(l.d)) neighbour.set(l.d, l.s); }
    nodes.forEach((n, i) => {
      if (P.has(n.id)) return;
      const near = P.get(neighbour.get(n.id) ?? -1);
      const ring = n.kind === "company" ? 160 : n.kind === "subsidiary" ? 120 : 90;
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 + i * 0.37;
      P.set(n.id, near ? { x: near.x + Math.cos(a) * 30, y: near.y + Math.sin(a) * 30, vx: 0, vy: 0, pinned: false } : n.id === focus ? { x: 0, y: 0, vx: 0, vy: 0, pinned: true } : { x: Math.cos(a) * ring, y: Math.sin(a) * ring, vx: 0, vy: 0, pinned: false });
    });
    const f = P.get(focus);
    if (f) { f.x = 0; f.y = 0; f.pinned = true; }
    alpha.current = 1;
    if (!view.current.tx && !view.current.ty) view.current = { k: 1, tx: width / 2, ty: height / 2 };
    const list = nodes.map((n) => n.id);
    const degree = new Map<number, number>();
    for (const l of links) { degree.set(l.s, (degree.get(l.s) ?? 0) + 1); degree.set(l.d, (degree.get(l.d) ?? 0) + 1); }

    const tick = () => {
      const a = alpha.current;
      // Repulsion (all pairs; the views stay under a few hundred nodes).
      for (let i = 0; i < list.length; i++) {
        const p = P.get(list[i])!;
        for (let j = i + 1; j < list.length; j++) {
          const q = P.get(list[j])!;
          let dx = q.x - p.x, dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
          if (d2 > 90_000) continue;
          const force = (a * 900) / d2;
          const fx = dx * force, fy = dy * force;
          p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
        }
      }
      // Springs along links, weaker for hubs so a 400-subsidiary parent does not collapse into a ball.
      for (const l of links) {
        const p = P.get(l.s), q = P.get(l.d);
        if (!p || !q) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const k = (a * 0.08 * (d - (LENGTH[l.kind] ?? 80))) / d / Math.sqrt(Math.min(degree.get(l.s) ?? 1, degree.get(l.d) ?? 1));
        p.vx += dx * k; p.vy += dy * k; q.vx -= dx * k; q.vy -= dy * k;
      }
      for (const id of list) {
        const p = P.get(id)!;
        if (p.pinned) { p.vx = 0; p.vy = 0; continue; }
        p.vx -= p.x * 0.002 * a; p.vy -= p.y * 0.002 * a;
        p.vx *= 0.6; p.vy *= 0.6;
        p.x += p.vx; p.y += p.vy;
      }
      alpha.current = Math.max(0, a * 0.985 - 0.0005);
    };

    // Theme colours, read once here rather than on every frame.
    const fg = cssVar("--fg", "#e6e8eb"), bg = cssVar("--panel", "#111");
    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.floor(width * ratio)) { c.width = Math.floor(width * ratio); c.height = Math.floor(height * ratio); c.style.width = `${width}px`; c.style.height = `${height}px`; }
      const { k, tx, ty } = view.current;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(tx, ty); ctx.scale(k, k);
      const lit = hl.current;
      for (const l of links) {
        const p = P.get(l.s), q = P.get(l.d);
        if (!p || !q) continue;
        const on = !lit || lit.links.has(l.id);
        ctx.globalAlpha = on ? (lit ? 0.95 : 0.45) : 0.08;
        ctx.strokeStyle = LINK_COLOR[l.kind] ?? "#888";
        ctx.lineWidth = (lit && on ? 2.2 : 1) / Math.sqrt(k);
        ctx.setLineDash(l.ended ? [4 / k, 3 / k] : []);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        const p = P.get(n.id);
        if (!p) continue;
        const on = !lit || lit.nodes.has(n.id);
        const r = radiusOf(n, focus);
        ctx.globalAlpha = on ? 1 : 0.15;
        ctx.fillStyle = NODE_COLOR[n.kind] ?? "#999";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (n.id === focus || (lit && on)) { ctx.lineWidth = 2 / k; ctx.strokeStyle = fg; ctx.stroke(); }
        const label = n.kind === "company" || n.id === focus || (lit && on);
        if (label && k > 0.45) {
          ctx.font = `${n.id === focus ? 600 : 500} ${11 / Math.max(0.8, k)}px var(--font-sans, system-ui)`;
          ctx.lineWidth = 3 / k; ctx.strokeStyle = bg; ctx.fillStyle = fg;
          const text = (n.ticker && n.kind === "company" ? n.ticker : n.name).slice(0, 28);
          ctx.strokeText(text, p.x + r + 3, p.y + 4); ctx.fillText(text, p.x + r + 3, p.y + 4);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    redraw.current = draw;

    let raf = 0;
    if (reduce) { for (let i = 0; i < 320 && alpha.current > 0.002; i++) tick(); draw(); }
    else {
      const loop = () => { if (alpha.current > 0.002) { tick(); tick(); draw(); raf = requestAnimationFrame(loop); } else draw(); };
      raf = requestAnimationFrame(loop);
    }

    const toWorld = (ev: { clientX: number; clientY: number }) => { const r = c.getBoundingClientRect(); const { k, tx, ty } = view.current; return { x: (ev.clientX - r.left - tx) / k, y: (ev.clientY - r.top - ty) / k, sx: ev.clientX - r.left, sy: ev.clientY - r.top }; };
    const hit = (x: number, y: number) => { let best: number | null = null, bd = Infinity; for (const n of nodes) { const p = P.get(n.id); if (!p) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; const r = radiusOf(n, focus) + 4 / view.current.k; if (d < r * r && d < bd) { bd = d; best = n.id; } } return best; };
    const kick = () => { if (reduce) { draw(); return; } alpha.current = Math.max(alpha.current, 0.25); cancelAnimationFrame(raf); const loop = () => { if (alpha.current > 0.002) { tick(); draw(); raf = requestAnimationFrame(loop); } else draw(); }; raf = requestAnimationFrame(loop); };

    const down = (ev: PointerEvent) => { const w = toWorld(ev); drag.current = { node: hit(w.x, w.y), x: ev.clientX, y: ev.clientY, moved: false }; c.setPointerCapture(ev.pointerId); };
    const move = (ev: PointerEvent) => {
      const w = toWorld(ev);
      const d = drag.current;
      if (d) {
        if (Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) > 3) d.moved = true;
        if (d.node !== null) { const p = P.get(d.node)!; p.x = w.x; p.y = w.y; p.pinned = true; kick(); }
        else { view.current.tx += ev.clientX - d.x; view.current.ty += ev.clientY - d.y; d.x = ev.clientX; d.y = ev.clientY; draw(); }
        return;
      }
      const id = hit(w.x, w.y);
      c.style.cursor = id !== null ? "pointer" : "grab";
      setHover(id !== null ? { node: byId.get(id)!, x: w.sx, y: w.sy } : null);
    };
    const up = (ev: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved && d.node !== null) onSelect?.(byId.get(d.node)!);
      try { c.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const v = view.current, k2 = Math.max(0.2, Math.min(4, v.k * Math.exp(-ev.deltaY * 0.0015)));
      v.tx = sx - ((sx - v.tx) * k2) / v.k; v.ty = sy - ((sy - v.ty) * k2) / v.k; v.k = k2;
      draw();
    };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); c.addEventListener("pointerup", up); c.addEventListener("wheel", wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("wheel", wheel); };
  }, [nodes, links, focus, width, height, reduce, onSelect]);

  // The way in for the keyboard and screen readers, to whom the canvas is a picture: every drawn entity, most
  // connected first, with its kind and how many drawn links touch it. Hidden until focus moves into it; a
  // company with a ticker opens. Built only when the drawing changes, not on every hover.
  const list = useMemo(() => {
    const rows = entityList(nodes, links, focus);
    const opens = (n: GNode) => !!onSelect && n.kind === "company" && !!n.ticker && n.id !== focus;
    return (
      <div className="sr-only focus-within:not-sr-only">
        <div tabIndex={0} role="group" aria-label="Entities in the network" className="absolute right-2 top-2 z-20 max-h-[calc(100%-1rem)] w-[290px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border border-line bg-panel p-1.5 text-[11.5px] shadow-lg">
          <p className="px-1.5 pb-1 text-[10.5px] text-muted">{nodes.length} entities and {links.length} links, most connected first{rows.some((r) => opens(r.n)) ? "; choose a company to open it" : ""}.</p>
          <ul>
            {rows.map(({ n, c }) => {
              const row = (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_COLOR[n.kind] ?? "#999" }} />
                  <span className="min-w-0 flex-1 truncate">{n.name}{n.ticker ? ` (${n.ticker})` : ""}</span>
                  <span className="shrink-0 text-[10.5px] text-muted">{KIND_LABEL[n.kind]?.split(" ")[0] ?? n.kind} · {c} link{c === 1 ? "" : "s"}{n.id === focus ? " · in focus" : highlight?.nodes.has(n.id) ? " · on the highlighted path" : ""}</span>
                </>
              );
              return <li key={n.id}>{opens(n) ? <button type="button" onClick={() => onSelect?.(n)} className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-elevated focus:bg-elevated">{row}</button> : <div className="flex items-center gap-1.5 px-1.5 py-0.5">{row}</div>}</li>;
            })}
          </ul>
        </div>
      </div>
    );
  }, [nodes, links, focus, highlight, onSelect]);

  const kinds = [...new Set(nodes.map((n) => n.kind))];
  const linkKinds = [...new Set(links.map((l) => l.kind))];
  return (
    <div ref={wrap} className="relative w-full overflow-hidden rounded-lg border border-line bg-bg" style={{ height }}>
      <canvas ref={canvas} className="block touch-none" role="img" aria-label={`Relationship network of ${nodes.length} entities and ${links.length} links`} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] shadow-lg" style={{ left: Math.min(hover.x + 12, (width || 400) - 270), top: Math.min(hover.y + 12, height - 60) }}>
          <div className="font-semibold">{hover.node.name}{hover.node.ticker ? ` (${hover.node.ticker})` : ""}</div>
          <div className="text-muted">{KIND_LABEL[hover.node.kind] ?? hover.node.kind}{hover.node.sub ? ` · ${hover.node.sub}` : ""}</div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-panel/85 px-2 py-1 text-[10.5px] text-muted">
        {kinds.map((k) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: NODE_COLOR[k] }} />{KIND_LABEL[k]?.split(" ")[0] ?? k}</span>)}
        {linkKinds.map((k) => <span key={`l${k}`} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: LINK_COLOR[k] }} />{LINK_LABEL[k] ?? k}</span>)}
        {nodes.some((n) => n.rank !== undefined) && <span className="text-faint">Larger dots carry more weight across the whole graph</span>}
      </div>
      {list}
    </div>
  );
}
