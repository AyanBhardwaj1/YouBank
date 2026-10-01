"use client";

/**
 * A ground change's site month by month: the clearest Sentinel-2 image of each month for two years,
 * played like a film (or stepped by hand), with the two months the detector compared marked on the
 * scrubber. Images load ahead of the playhead; nothing plays by itself for people who prefer less motion.
 */
import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { Frame } from "@/lib/edge/timelapse";
import { useApi } from "./client";

export function Timelapse({ detection, before, after }: { detection: number; before?: string; after?: string }) {
  const { data, error } = useApi<{ frames: Frame[] }>(`/api/edge/timelapse?detection=${detection}`);
  const reduce = useReducedMotion();
  const frames = useMemo(() => data?.frames ?? [], [data]);
  const [at, setAt] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const started = useRef(false);

  // Start on the newest month; play once everything has arrived (unless motion is reduced).
  useEffect(() => {
    if (!frames.length || started.current) return;
    started.current = true;
    queueMicrotask(() => { setAt(frames.length - 1); setPlaying(!reduce); });
  }, [frames.length, reduce]);

  // Load the frames ahead of time, newest first and four at a time (each is rendered on request upstream).
  useEffect(() => {
    let live = true;
    const queue = frames.map((_, k) => k).reverse();
    const next = () => {
      const k = queue.shift();
      if (k === undefined || !live) return;
      const img = new Image();
      img.onload = () => { if (live) setLoaded((s) => new Set(s).add(k)); next(); };
      img.onerror = () => next();
      img.src = frames[k].url;
    };
    for (let n = 0; n < 4; n++) next();
    return () => { live = false; };
  }, [frames]);

  // Step a month at a time; wait on a frame that has not arrived.
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setAt((i) => { const next = (i + 1) % frames.length; return loaded.has(next) ? next : i; }), 650);
    return () => clearInterval(t);
  }, [playing, frames.length, loaded]);

  if (error) return <p className="text-[11.5px] text-neg">{error}</p>;
  if (!data) return <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding the clearest image of each month…</p>;
  if (!frames.length) return <p className="text-[11.5px] text-muted">No clear Sentinel-2 images of this site in the last two years.</p>;
  const i = at < 0 ? frames.length - 1 : at;
  const mark = (d?: string) => (d ? frames.findIndex((f) => f.month === d.slice(0, 7)) : -1);
  const bi = mark(before), ai = mark(after);
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-elevated">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frames[i].url} alt={`The site in ${frames[i].month}`} className="h-full w-full object-cover" />
        <span className="num absolute left-2 top-2 rounded bg-bg/80 px-1.5 py-0.5 text-[11px] font-semibold">{frames[i].month}</span>
        {(i === bi || i === ai) && <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-fg">{i === bi ? "Before" : "After"}</span>}
        {loaded.size < frames.length && <span className="absolute bottom-2 left-2 rounded bg-bg/80 px-1.5 py-0.5 text-[10.5px] text-muted">Loading {loaded.size} of {frames.length}</span>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} className="ctl flex h-7 w-7 shrink-0 items-center justify-center border border-line hover:border-accent/50">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="relative flex-1">
          <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setAt(Number(e.target.value)); }} aria-label="Month" className="w-full accent-[var(--accent)]" />
          {[bi, ai].filter((x) => x >= 0).map((x) => <span key={x} className="pointer-events-none absolute -top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${(x / Math.max(1, frames.length - 1)) * 100}%` }} />)}
        </div>
        <span className="num shrink-0 text-[10.5px] text-muted">{frames[0].month} to {frames[frames.length - 1].month}</span>
      </div>
      <p className="text-[10.5px] text-faint">The clearest Sentinel-2 image of each month (10 m), contains modified Copernicus Sentinel data. Dots mark the two months the detector compared.</p>
    </div>
  );
}
