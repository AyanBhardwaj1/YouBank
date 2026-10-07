"use client";

/**
 * The 60-second recap: the desk's day as a run of animated slides, drawn on a canvas in the browser
 * (1080 by 1350, the 4:5 shape social feeds favour). Nothing is encoded on our side:
 * - it plays here, with taps or arrow keys to move between slides;
 * - "Save images" draws every slide at rest and hands them to the system share sheet (or downloads
 *   them), as an image sequence;
 * - "Record video" plays it once while the browser's own MediaRecorder captures the canvas, on this
 *   machine, to a WebM file (MP4 where the browser records only that), on the person's click.
 * Colours and type come from the theme, so the recap wears the person's style. With motion off the
 * slides cut instead of animating.
 */
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recapMs, recapSlides, slideAt, wrapText, type RecapSlide, type RecapStory } from "@/lib/news/recap";
import { figureBars } from "@/lib/news/storyviz";
import type { StoryCard as Story } from "@/lib/news/views";
import { Icon } from "@/components/ui/Icon";
import { fmtPct, fmtUsd, useMotionLevel, type Spark } from "./client";
import { SECTOR_HUE, sectorOf } from "./DataArt";

const CW = 1080, CH = 1350;

type Theme = { bg: string; panel: string; elevated: string; line: string; fg: string; muted: string; faint: string; accent: string; accentFg: string; pos: string; neg: string; chart: string; sans: string; serif: string; mono: string };

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  const font = (css: string) => { const el = document.createElement("span"); el.style.fontFamily = css; document.body.appendChild(el); const f = getComputedStyle(el).fontFamily; el.remove(); return f; };
  return {
    bg: v("--bg", "#0a0c0f"), panel: v("--panel", "#101318"), elevated: v("--elevated", "#171b22"), line: v("--line", "#242a33"), fg: v("--fg", "#d7dde6"), muted: v("--muted", "#7d8794"), faint: v("--faint", "#4d5866"),
    accent: v("--accent", "#f5a623"), accentFg: v("--accent-fg", "#0a0c0f"), pos: v("--pos", "#3fb950"), neg: v("--neg", "#f85149"), chart: v("--chart-1", "#3987e5"),
    sans: font("var(--font-sans)"), serif: font("var(--font-display)"), mono: font("var(--font-mono)"),
  };
}

/** A colour at an opacity, for canvas gradients (which take no CSS variables or color-mix). */
function alpha(color: string, a: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }
  const r = color.match(/^rgba?\(([^)]+)\)$/i);
  if (r) { const [x, y, z] = r[1].split(",").map((v) => v.trim()); return `rgba(${x}, ${y}, ${z}, ${a})`; }
  return `rgba(128, 128, 128, ${a})`;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
/** 0 to 1 over [a, b] of a slide's progress. */
const span = (p: number, a: number, b: number) => ease((p - a) / (b - a));

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, alpha = 1, align: CanvasTextAlign = "left") {
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, alpha = 1) {
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2)); ctx.fill(); ctx.globalAlpha = 1;
}

/** Draw one slide at `p` (0 to 1 through it); `still` draws it at rest. */
export function drawSlide(ctx: CanvasRenderingContext2D, th: Theme, slides: RecapSlide[], index: number, p: number, still = false) {
  const s = slides[index];
  const q = still ? 1 : p;
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, CW, CH);
  const hue = s.kind === "story" ? (SECTOR_HUE[sectorOf(s.story.tags) ?? ""] ?? th.accent) : th.accent;
  // A soft glow in the slide's colour, drifting a little as it plays.
  const g = ctx.createRadialGradient(CW * (0.85 - 0.1 * q), CH * 0.08, 40, CW * 0.8, CH * 0.1, CW * 1.1);
  g.addColorStop(0, alpha(hue, 0.33)); g.addColorStop(1, alpha(hue, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  // Progress segments, as in a story viewer.
  const segW = (CW - 120 - (slides.length - 1) * 10) / slides.length;
  slides.forEach((_, i) => { round(ctx, 60 + i * (segW + 10), 44, segW, 8, 4, th.line); round(ctx, 60 + i * (segW + 10), 44, segW * (i < index ? 1 : i === index ? q : 0), 8, 4, th.fg, 0.9); });
  text(ctx, "YOUBANK NEWSROOM", 60, 118, `700 26px ${th.sans}`, th.muted);
  const fadeUp = (a: number, b: number) => ({ alpha: span(q, a, b), dy: (1 - span(q, a, b)) * 30 });

  if (s.kind === "title") {
    const f1 = fadeUp(0, 0.25), f2 = fadeUp(0.12, 0.4);
    text(ctx, s.date.toUpperCase(), 60, 330 + f1.dy, `700 30px ${th.sans}`, th.accent, f1.alpha);
    ["Your " + s.desk, "day in", "60 seconds"].forEach((l, i) => text(ctx, l, 60, 450 + i * 118 + f2.dy, `500 ${s.desk.length > 18 && i === 0 ? 76 : 104}px ${th.serif}`, th.fg, f2.alpha));
    const stats = [{ n: s.stories, l: "stories" }, { n: s.sources, l: "outlets" }, { n: s.deals, l: "deals" }];
    stats.forEach((st, i) => {
      const k = span(q, 0.35 + i * 0.1, 0.75 + i * 0.08);
      const x = 60 + i * 330;
      round(ctx, x, 940, 300, 230, 28, th.elevated, k);
      text(ctx, String(Math.round(st.n * k)), x + 34, 1080, `700 96px ${th.mono}`, th.fg, k);
      text(ctx, st.l, x + 36, 1132, `500 32px ${th.sans}`, th.muted, k);
    });
  } else if (s.kind === "story") {
    const st = s.story;
    const f1 = fadeUp(0, 0.18), f2 = fadeUp(0.08, 0.3), f3 = fadeUp(0.2, 0.42);
    text(ctx, `${s.n} / ${s.of}  ·  ${st.categoryLabel.toUpperCase()}`, 60, 230 + f1.dy, `700 28px ${th.sans}`, hue, f1.alpha);
    const lines = wrapText(st.headline, 24, 5);
    lines.forEach((l, i) => text(ctx, l, 60, 330 + i * 86 + f2.dy, `500 74px ${th.serif}`, th.fg, f2.alpha));
    let y = 330 + lines.length * 86 + 30;
    if (st.bullet) wrapText(st.bullet, 46, 3).forEach((l, i) => text(ctx, l, 60, y + 40 + i * 46 + f3.dy, `400 34px ${th.sans}`, th.muted, f3.alpha));
    y = Math.max(y + 200, 930);
    const k = span(q, 0.3, 0.75);
    if (st.closes.length > 1) {
      const min = Math.min(...st.closes), max = Math.max(...st.closes), r = max - min || 1;
      const up = (st.closes[st.closes.length - 1] ?? 0) >= (st.closes[0] ?? 0);
      const col = up ? th.pos : th.neg;
      const n = Math.max(2, Math.ceil(st.closes.length * k));
      ctx.lineWidth = 7; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = col; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = 60 + (i / (st.closes.length - 1)) * (CW - 120), yy = y + 300 - ((st.closes[i] - min) / r) * 260; if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
      ctx.stroke();
      text(ctx, st.tickers[0] ?? "", 60, y - 10, `700 34px ${th.mono}`, th.fg, k);
      if (st.change !== null) text(ctx, `${fmtPct(st.change, 1)} today`, CW - 60, y - 10, `700 34px ${th.mono}`, st.change >= 0 ? th.pos : th.neg, k, "right");
    } else if (st.figure) {
      text(ctx, st.figure.label.toUpperCase().slice(0, 40), 60, y + 40, `700 28px ${th.sans}`, th.muted, k);
      text(ctx, st.figure.value.slice(0, 18), 60, y + 190, `700 ${st.figure.value.length > 10 ? 110 : 150}px ${th.mono}`, th.fg, k);
    } else {
      const outlets = Math.max(1, Math.min(14, st.sourceCount));
      for (let i = 0; i < outlets; i++) round(ctx, 60 + i * 68, y + 120, 52, 140 * Math.min(1, k * 1.4 - i * 0.04), 14, hue, 0.35 + 0.65 * ((i + 1) / outlets));
      text(ctx, outlets === 1 ? "One source so far" : `Covered by ${st.sourceCount} outlets`, 60, y + 330, `500 34px ${th.sans}`, th.muted, k);
    }
  } else if (s.kind === "deals") {
    const f = fadeUp(0, 0.2);
    text(ctx, "Deals on the wire", 60, 300 + f.dy, `500 92px ${th.serif}`, th.fg, f.alpha);
    text(ctx, `${fmtUsd(s.totalUsd)} across the ${s.deals.length} largest`, 60, 370 + f.dy, `400 34px ${th.sans}`, th.muted, f.alpha);
    const max = Math.max(...s.deals.map((d) => d.valueUsd ?? 0), 1);
    s.deals.forEach((d, i) => {
      const k = span(q, 0.15 + i * 0.08, 0.55 + i * 0.08), y = 520 + i * 150;
      text(ctx, wrapText(d.label, 30, 1)[0] ?? "", 60, y, `500 36px ${th.sans}`, th.fg, k);
      round(ctx, 60, y + 22, CW - 120, 40, 20, th.elevated);
      round(ctx, 60, y + 22, (CW - 120) * ((d.valueUsd ?? 0) / max) * k, 40, 20, th.accent);
      text(ctx, fmtUsd(d.valueUsd), CW - 60, y, `700 36px ${th.mono}`, th.fg, k, "right");
    });
  } else if (s.kind === "movers") {
    const f = fadeUp(0, 0.2);
    text(ctx, "How the names moved", 60, 300 + f.dy, `500 88px ${th.serif}`, th.fg, f.alpha);
    text(ctx, "One-day change, companies in today's stories", 60, 370 + f.dy, `400 32px ${th.sans}`, th.muted, f.alpha);
    const max = Math.max(...s.movers.map((m) => Math.abs(m.change)), 0.01);
    const mid = CW / 2 + 60;
    ctx.fillStyle = th.line; ctx.fillRect(mid - 1, 470, 2, s.movers.length * 120);
    s.movers.forEach((m, i) => {
      const k = span(q, 0.15 + i * 0.07, 0.55 + i * 0.07), y = 490 + i * 120, w = (Math.abs(m.change) / max) * (CW / 2 - 200) * k;
      text(ctx, m.symbol, 60, y + 52, `700 40px ${th.mono}`, th.fg, k);
      round(ctx, m.change >= 0 ? mid : mid - w, y + 18, w, 48, 12, m.change >= 0 ? th.pos : th.neg);
      text(ctx, fmtPct(m.change, 1), m.change >= 0 ? mid + w + 16 : mid - w - 16, y + 56, `700 32px ${th.mono}`, m.change >= 0 ? th.pos : th.neg, k, m.change >= 0 ? "left" : "right");
    });
  } else {
    const f = fadeUp(0, 0.3);
    text(ctx, "That's the day.", 60, 560 + f.dy, `500 110px ${th.serif}`, th.fg, f.alpha);
    text(ctx, "Every story, its sources and charts,", 60, 660 + f.dy, `400 40px ${th.sans}`, th.muted, f.alpha);
    text(ctx, "ranked for your desk:", 60, 712 + f.dy, `400 40px ${th.sans}`, th.muted, f.alpha);
    const k = span(q, 0.3, 0.6);
    round(ctx, 60, 820, 600, 110, 55, th.accent, k);
    text(ctx, "Read more on YouBank", 110, 893, `700 40px ${th.sans}`, th.accentFg, k);
    text(ctx, s.url.replace(/^https?:\/\//, ""), 60, 1010, `500 32px ${th.mono}`, th.faint, k);
  }
}

type Props = { stories: Story[]; sparks: Map<string, Spark | null>; deskLabel: string; deals: { headline: string; valueUsd: number | null; kind: string }[]; now: number; onClose: () => void };

export function Recap({ stories, sparks, deskLabel, deals, now, onClose }: Props) {
  const level = useMotionLevel();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rec, setRec] = useState<{ on: boolean; note: string | null }>({ on: false, note: null });
  const theme = useRef<Theme | null>(null);

  const slides = useMemo(() => {
    const top: RecapStory[] = stories.slice(0, 5).map((s) => {
      const tk = s.tickers.find((x) => sparks.get(x)?.closes?.length);
      const sp = tk ? sparks.get(tk)! : null;
      const fig = s.summary ? figureBars(s.summary.numbers)[0] ?? s.summary.numbers[0] ?? null : null;
      return { id: s.id, headline: s.headline, category: s.category, categoryLabel: s.categoryLabel, tags: s.tags, tickers: tk ? [tk, ...s.tickers.filter((x) => x !== tk)] : s.tickers, sourceCount: s.sourceCount, bullet: s.summary?.bullets?.[0] ?? "", figure: fig ? { label: fig.label, value: fig.value } : null, change: sp?.change ?? null, closes: sp?.closes ?? [] };
    });
    const movers = [...new Set(stories.slice(0, 60).flatMap((s) => s.tickers.slice(0, 1)))].map((sym) => ({ symbol: sym, change: sparks.get(sym)?.change ?? NaN })).filter((m) => Number.isFinite(m.change));
    const date = now ? new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
    return recapSlides({ desk: deskLabel, date, stories: top, deals: deals.map((d) => ({ label: d.headline, valueUsd: d.valueUsd, kind: d.kind })), movers, storyCount: stories.length, sourceCount: new Set(stories.flatMap((s) => s.sources.map((x) => x.name))).size, url: typeof window !== "undefined" ? `${window.location.origin}/news` : "youbank" });
  }, [stories, sparks, deskLabel, deals, now]);
  const total = recapMs(slides);
  const at = slideAt(slides, t);

  // Draw whenever time moves (or the theme changes).
  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    theme.current ??= readTheme();
    drawSlide(c, theme.current, slides, at.index, at.progress, level === "off");
  }, [slides, at.index, at.progress, level]);

  // The clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now2: number) => {
      const dt = now2 - last; last = now2;
      setT((x) => { const n = x + dt; if (n >= total) { setPlaying(false); return total; } return n; });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const jump = useCallback((i: number) => { const k = Math.max(0, Math.min(slides.length - 1, i)); setT(slides.slice(0, k).reduce((n, s) => n + s.ms, 0)); setPlaying(true); }, [slides]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !rec.on) onClose();
      else if (e.key === "ArrowRight") jump(at.index + 1);
      else if (e.key === "ArrowLeft") jump(at.index - 1);
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at.index, jump, onClose, rec.on]);

  const saveImages = async () => {
    const th = theme.current ?? readTheme();
    const off = document.createElement("canvas"); off.width = CW; off.height = CH;
    const ctx = off.getContext("2d")!;
    const files: File[] = [];
    for (let i = 0; i < slides.length; i++) {
      drawSlide(ctx, th, slides, i, 1, true);
      const blob = await new Promise<Blob | null>((r) => off.toBlob(r, "image/png"));
      if (blob) files.push(new File([blob], `youbank-recap-${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
    }
    try {
      if (navigator.canShare?.({ files })) { await navigator.share({ files, title: `${deskLabel} in 60 seconds` }); return; }
    } catch { /* dismissed, or sharing files is not allowed: download instead */ }
    for (const f of files) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
      await new Promise((r) => setTimeout(r, 250));
      URL.revokeObjectURL(a.href);
    }
  };

  const record = () => {
    const c = canvas.current;
    if (!c || typeof MediaRecorder === "undefined" || !c.captureStream) { setRec({ on: false, note: "This browser cannot record video. Save the images instead." }); return; }
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!type) { setRec({ on: false, note: "This browser cannot record video. Save the images instead." }); return; }
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 4_000_000 });
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `youbank-recap-${new Date().toISOString().slice(0, 10)}.${type.includes("mp4") ? "mp4" : "webm"}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setRec({ on: false, note: `Saved as ${type.includes("mp4") ? "MP4" : "WebM"} video, recorded on this device.` });
    };
    setT(0); setPlaying(true); setRec({ on: true, note: null });
    mr.start(500);
    setTimeout(() => mr.state !== "inactive" && mr.stop(), total + 300);
  };

  return (
    <motion.div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-bg/95 p-3 backdrop-blur-sm sm:p-6" initial={level === "off" ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="60-second recap">
      <div className="mb-2 flex w-full max-w-[520px] items-center justify-between gap-2 text-[12px]">
        <span className="flex items-center gap-1.5 font-semibold text-fg"><Icon name="Film" className="h-4 w-4 text-accent" />Your day in 60 seconds</span>
        <button type="button" onClick={onClose} disabled={rec.on} className="rounded-full border border-line p-1.5 text-muted hover:text-fg disabled:opacity-40" aria-label="Close the recap"><Icon name="X" className="h-4 w-4" /></button>
      </div>
      <div className="relative w-full max-w-[520px]" style={{ aspectRatio: `${CW} / ${CH}`, maxHeight: "calc(100dvh - 150px)" }}>
        <canvas ref={canvas} width={CW} height={CH} className="h-full w-full rounded-[18px] border border-line shadow-float" style={{ objectFit: "contain" }} aria-label={`Slide ${at.index + 1} of ${slides.length}`} />
        {!rec.on && <>
          <button type="button" className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous slide" onClick={() => jump(at.index - 1)} />
          <button type="button" className="absolute inset-y-0 right-0 w-2/3" aria-label="Next slide" onClick={() => jump(at.index + 1)} />
        </>}
        {rec.on && <span className="absolute left-3 top-16 flex items-center gap-1.5 rounded-full bg-neg px-2.5 py-1 text-[11px] font-semibold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />Recording {Math.round(t / 1000)}s / {Math.round(total / 1000)}s</span>}
      </div>
      <div className="mt-3 flex w-full max-w-[520px] flex-wrap items-center justify-center gap-2 text-[12px]">
        <button type="button" onClick={() => (t >= total ? jump(0) : setPlaying((p) => !p))} disabled={rec.on} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 font-medium text-accent-fg disabled:opacity-50"><Icon name={playing ? "Pause" : t >= total ? "RefreshCw" : "Play"} className="h-3.5 w-3.5" />{playing ? "Pause" : t >= total ? "Replay" : "Play"}</button>
        <button type="button" onClick={saveImages} disabled={rec.on} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-fg hover:border-accent/50 disabled:opacity-50"><Icon name="Image" className="h-3.5 w-3.5" />Save images</button>
        <button type="button" onClick={record} disabled={rec.on} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-fg hover:border-accent/50 disabled:opacity-50"><Icon name="Video" className="h-3.5 w-3.5" />{rec.on ? "Recording…" : "Record video"}</button>
      </div>
      {rec.note && <p className="mt-2 text-[11.5px] text-muted">{rec.note}</p>}
    </motion.div>
  );
}
