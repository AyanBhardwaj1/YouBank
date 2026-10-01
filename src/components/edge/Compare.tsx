"use client";

/**
 * Two satellite crops of the same ground a year apart, one over the other, with a handle to wipe
 * between them, and the detected change drawn over the newer one (amber for new bare ground, blue for
 * new dark surfaces such as ponds and tanks). Keyboard: focus the handle and use the arrow keys, Home
 * and End. If the imagery service cannot render a crop, the card says so instead of showing a blank.
 */
import { useCallback, useRef, useState } from "react";
import { Eye, EyeOff, ImageOff } from "lucide-react";

type Shot = { url: string; date: string };

export function Compare({ before, after, overlay, label, height = "aspect-square" }: { before: Shot; after: Shot; overlay?: string; label: string; height?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(50);
  const [showChange, setShowChange] = useState(true);
  const [loaded, setLoaded] = useState(0);
  const [broken, setBroken] = useState(false);
  const [attempt, setTry] = useState(0);
  const src = (url: string) => (attempt ? `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}` : url);

  const moveTo = useCallback((clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 1 || e.pointerType === "touch") moveTo(e.clientX);
  };

  return (
    <div className="relative select-none">
      <div ref={box} className={`relative ${height} w-full cursor-ew-resize touch-pan-y overflow-hidden rounded-[inherit] bg-elevated`} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
        {loaded < 2 && !broken && <div className="shimmer absolute inset-0" aria-hidden />}
        {broken && (
          <div onPointerDown={(e) => e.stopPropagation()} className="absolute inset-0 z-10 flex cursor-default flex-col items-center justify-center gap-1.5 bg-elevated p-4 text-center text-[11.5px] text-muted">
            <ImageOff className="h-5 w-5" />
            <span>The satellite images did not load (the imagery service renders them on request and may be busy).</span>
            <button type="button" onClick={() => { setBroken(false); setLoaded(0); setTry((n) => n + 1); }} className="text-accent hover:underline">Try again</button>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- satellite crops rendered on request by the imagery service */}
        <img src={src(before.url)} alt={`${label}, ${before.date}`} loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded((n) => n + 1)} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img src={src(after.url)} alt={`${label}, ${after.date}`} loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded((n) => n + 1)} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element -- the change mask, a small generated PNG */}
          {overlay && showChange && <img src={overlay} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]" />}
        </div>
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
          <div className="absolute inset-y-0 -ml-px w-0.5 bg-white/85 shadow-[0_0_8px_rgba(0,0,0,0.6)]" />
          <button
            type="button" aria-label="Wipe between the older and newer image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} role="slider"
            aria-valuetext={pos <= 0 ? `All ${after.date}` : pos >= 100 ? `All ${before.date}` : `${Math.round(pos)}% ${before.date}, the rest ${after.date}`}
            onKeyDown={(e) => {
              const to = e.key === "ArrowLeft" ? pos - 5 : e.key === "ArrowRight" ? pos + 5 : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
              if (to !== null) { e.preventDefault(); setPos(Math.max(0, Math.min(100, to))); }
            }}
            className="pointer-events-auto absolute top-1/2 -ml-3.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-black/55 text-[10px] text-white shadow-lg backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >⇆</button>
        </div>
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">{before.date}</span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">{after.date}</span>
      </div>
      {overlay && (
        <button type="button" onClick={() => setShowChange((v) => !v)} className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10.5px] text-white backdrop-blur hover:bg-black/75">
          {showChange ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {showChange ? "Change shown" : "Change hidden"}
        </button>
      )}
    </div>
  );
}
